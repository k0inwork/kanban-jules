//go:build js && wasm

package main

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"path"
	"strings"
	"syscall/js"
	"time"

	"tractor.dev/wanix/fs"
	"tractor.dev/wanix/fs/fskit"
	"tractor.dev/wanix/web/jsutil"
)

// BoardFS maps board API operations to a filesystem hierarchy:
//
//	/board/tasks/              → list tasks (dirs named by task ID)
//	/board/tasks/<id>          → read task as JSON
//	/board/tasks/<id>/update   → write JSON to update task fields
//	/board/artifacts/          → list artifacts
//	/board/artifacts/<name>    → read artifact content
//	/board/artifacts/<name>    → write to create/update artifact
//	/board/invoke              → write JSON {tool, args} to invoke a module tool
//	/board/invoke              → read last invocation result
//
// The JS side must expose on window.boardVM.boardfs:
//
//	listTasks()          → Promise<Array<{id,title,workflowStatus,...}>>
//	getTask(id)          → Promise<TaskJSON>
//	updateTask(id, data) → Promise<void>
//	listArtifacts()      → Promise<Array<{name}>>
//	readArtifact(name)   → Promise<string>
//	saveArtifact(name, content) → Promise<void>
//	invokeTool(tool, args)     → Promise<any>
type BoardFS struct {
	cfg        js.Value
	lastResult []byte
}

func NewBoardFS(cfg js.Value) *BoardFS {
	return &BoardFS{cfg: cfg}
}

func (b *BoardFS) js() js.Value {
	return b.cfg.Get("boardfs")
}

// pathParts splits a clean path into components, ignoring leading/trailing slashes.
func pathParts(name string) []string {
	if name == "." || name == "" {
		return nil
	}
	return strings.Split(strings.Trim(name, "/"), "/")
}

// Open implements fs.FS.
func (b *BoardFS) Open(name string) (fs.File, error) {
	return b.OpenContext(context.Background(), name)
}

func (b *BoardFS) OpenContext(ctx context.Context, name string) (fs.File, error) {
	if !fs.ValidPath(name) {
		return nil, &fs.PathError{Op: "open", Path: name, Err: fs.ErrNotExist}
	}

	parts := pathParts(name)

	// Root: /board/
	if len(parts) == 0 {
		return fskit.DirFile(
			fskit.Entry(".", fs.ModeDir|0555),
			fskit.Entry("tasks", fs.ModeDir|0555),
			fskit.Entry("artifacts", fs.ModeDir|0555),
			fskit.Entry("invoke", 0666),
		), nil
	}

	switch parts[0] {
	case "tasks":
		return b.openTasks(parts[1:])
	case "artifacts":
		return b.openArtifacts(parts[1:])
	case "invoke":
		return b.openInvoke()
	default:
		return nil, &fs.PathError{Op: "open", Path: name, Err: fs.ErrNotExist}
	}
}

func (b *BoardFS) openTasks(rest []string) (fs.File, error) {
	// /board/tasks/ → list all tasks
	if len(rest) == 0 {
		arrVal, err := jsutil.AwaitErr(b.js().Call("listTasks"))
		if err != nil || !arrVal.Truthy() {
			return nil, &fs.PathError{Op: "open", Path: "tasks", Err: fs.ErrNotExist}
		}
		entries := make([]fs.DirEntry, 0, arrVal.Length())
		for i := 0; i < arrVal.Length(); i++ {
			obj := arrVal.Index(i)
			id := obj.Get("id").String()
			entries = append(entries, fskit.Entry(id, fs.ModeDir|0555))
		}
		return fskit.DirFile(
			fskit.Entry("tasks", fs.ModeDir|0555),
			entries...,
		), nil
	}

	// /board/tasks/<id> → task JSON
	taskID := rest[0]
	if len(rest) == 1 {
		taskVal, err := jsutil.AwaitErr(b.js().Call("getTask", taskID))
		if err != nil || !taskVal.Truthy() {
			return nil, &fs.PathError{Op: "open", Path: "tasks/" + taskID, Err: fs.ErrNotExist}
		}
		data := jsonToBytes(taskVal)
		node := fskit.Entry(taskID, 0444, data)
		return node.Open(".")
	}

	// /board/tasks/<id>/update → writable file
	if rest[1] == "update" && len(rest) == 2 {
		return &boardUpdateFile{
			Node: fskit.Entry("update", 0222),
			board: b,
			taskID: taskID,
		}, nil
	}

	return nil, &fs.PathError{Op: "open", Path: "tasks/" + strings.Join(rest, "/"), Err: fs.ErrNotExist}
}

func (b *BoardFS) openArtifacts(rest []string) (fs.File, error) {
	// /board/artifacts/ → list all
	if len(rest) == 0 {
		arrVal, err := jsutil.AwaitErr(b.js().Call("listArtifacts"))
		if err != nil || !arrVal.Truthy() {
			return nil, &fs.PathError{Op: "open", Path: "artifacts", Err: fs.ErrNotExist}
		}
		entries := make([]fs.DirEntry, 0, arrVal.Length())
		for i := 0; i < arrVal.Length(); i++ {
			obj := arrVal.Index(i)
			name := obj.Get("name").String()
			entries = append(entries, fskit.Entry(name, 0444))
		}
		return fskit.DirFile(
			fskit.Entry("artifacts", fs.ModeDir|0555),
			entries...,
		), nil
	}

	// /board/artifacts/<name> → read content
	artifactName := rest[0]
	contentVal, err := jsutil.AwaitErr(b.js().Call("readArtifact", artifactName))
	if err != nil || !contentVal.Truthy() {
		return nil, &fs.PathError{Op: "open", Path: "artifacts/" + artifactName, Err: fs.ErrNotExist}
	}
	data := []byte(contentVal.String())
	node := fskit.Entry(artifactName, 0444, data)
	return node.Open(".")
}

func (b *BoardFS) openInvoke() (fs.File, error) {
	// Return last result as read-only, but writing triggers invocation
	if len(b.lastResult) > 0 {
		data := b.lastResult
		node := fskit.Entry("invoke", 0444, data)
		return node.Open(".")
	}
	// Empty — no invocations yet
	node := fskit.Entry("invoke", 0666, []byte(""))
	return node.Open(".")
}

// Stat implements fs.StatFS.
func (b *BoardFS) Stat(name string) (fs.FileInfo, error) {
	return b.StatContext(context.Background(), name)
}

func (b *BoardFS) StatContext(ctx context.Context, name string) (fs.FileInfo, error) {
	if !fs.ValidPath(name) {
		return nil, &fs.PathError{Op: "stat", Path: name, Err: fs.ErrNotExist}
	}

	parts := pathParts(name)
	switch {
	case len(parts) == 0:
		return fskit.Entry(".", fs.ModeDir|0555), nil
	case parts[0] == "tasks" && len(parts) == 1:
		return fskit.Entry("tasks", fs.ModeDir|0555), nil
	case parts[0] == "tasks" && len(parts) == 2:
		return fskit.Entry(parts[1], fs.ModeDir|0555), nil
	case parts[0] == "tasks" && len(parts) == 3 && parts[2] == "update":
		return fskit.Entry("update", 0222), nil
	case parts[0] == "artifacts" && len(parts) == 1:
		return fskit.Entry("artifacts", fs.ModeDir|0555), nil
	case parts[0] == "artifacts" && len(parts) == 2:
		return fskit.Entry(parts[1], 0444), nil
	case parts[0] == "invoke":
		return fskit.Entry("invoke", 0666), nil
	default:
		return nil, &fs.PathError{Op: "stat", Path: name, Err: fs.ErrNotExist}
	}
}

// ResolveFS allows the namespace to traverse into BoardFS.
func (b *BoardFS) ResolveFS(ctx context.Context, name string) (fs.FS, string, error) {
	return b, name, nil
}

// --- boardUpdateFile: writable file that calls updateTask on close ---

type boardUpdateFile struct {
	*fskit.Node
	board  *BoardFS
	taskID string
	buf    []byte
}

func (f *boardUpdateFile) Stat() (fs.FileInfo, error) {
	return f.Node, nil
}

func (f *boardUpdateFile) Read(p []byte) (int, error) {
	return 0, io.EOF
}

func (f *boardUpdateFile) Write(b []byte) (int, error) {
	f.buf = append(f.buf, b...)
	return len(b), nil
}

func (f *boardUpdateFile) Close() error {
	if len(f.buf) > 0 {
		// Parse the written data as JSON and pass to JS
		// The JS side handles partial updates
		jsonStr := string(f.buf)
		jsVal := js.Global().Get("JSON").Call("parse", jsonStr)
		_, err := jsutil.AwaitErr(f.board.js().Call("updateTask", f.taskID, jsVal))
		if err != nil {
			return fmt.Errorf("updateTask failed: %w", err)
		}
	}
	return nil
}

// --- helpers ---

func jsonToBytes(v js.Value) []byte {
	jsonStr := js.Global().Get("JSON").Call("stringify", v).String()
	return []byte(jsonStr)
}

var (
	_ fs.FS            = (*BoardFS)(nil)
	_ fs.OpenContextFS  = (*BoardFS)(nil)
	_ fs.StatFS        = (*BoardFS)(nil)
)

// Suppress unused imports
var (
	_ = context.Background
	_ = fmt.Sprintf
	_ = json.Marshal
	_ = path.Base
	_ = time.Now
)
