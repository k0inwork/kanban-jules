//go:build js && wasm

package main

import (
	"context"
	"io"
	"sync"
	"syscall/js"

	"tractor.dev/wanix/fs"
	"tractor.dev/wanix/fs/fskit"
	"tractor.dev/wanix/web/jsutil"
)

// ToolFS exposes a generic tool-calling tunnel as a filesystem:
//
//	/#tools/list  → read to get JSON array of available tool definitions
//	/#tools/call  → write JSON {"name":"...", "params":{...}} to invoke a tool
//	/#tools/result → read to get JSON {"content":"...", "error":""} from last call
//
// The JS side must expose on window.boardVM.toolfs:
//
//	listTools()                    → Promise<string> (JSON array of tool schemas)
//	callTool(name, paramsJSON)     → Promise<string> (JSON {content, error})
type ToolFS struct {
	cfg      js.Value
	mu       sync.Mutex
	lastResp []byte
}

func NewToolFS(cfg js.Value) *ToolFS {
	return &ToolFS{cfg: cfg}
}

func (t *ToolFS) js() js.Value {
	return t.cfg.Get("toolfs")
}

// Open implements fs.FS.
func (t *ToolFS) Open(name string) (fs.File, error) {
	return t.OpenContext(context.Background(), name)
}

func (t *ToolFS) OpenContext(ctx context.Context, name string) (fs.File, error) {
	if !fs.ValidPath(name) {
		return nil, &fs.PathError{Op: "open", Path: name, Err: fs.ErrNotExist}
	}

	switch name {
	case ".":
		return fskit.DirFile(
			fskit.Entry(".", fs.ModeDir|0555),
			fskit.Entry("list", 0444),
			fskit.Entry("call", 0222),
			fskit.Entry("result", 0444),
		), nil
	case "list":
		// Dynamic: call JS to get current tool definitions
		resultVal, err := jsutil.AwaitErr(t.js().Call("listTools"))
		data := []byte("[]")
		if err == nil && resultVal.Truthy() {
			data = []byte(resultVal.String())
		}
		node := fskit.Entry("list", 0444, data)
		return node.Open(".")
	case "call":
		return &toolCallFile{
			Node: fskit.Entry("call", 0222),
			tfs:  t,
		}, nil
	case "result":
		t.mu.Lock()
		resp := t.lastResp
		t.mu.Unlock()
		if resp == nil {
			resp = []byte(`{"content":"","error":"no tool called yet"}`)
		}
		node := fskit.Entry("result", 0444, resp)
		return node.Open(".")
	}

	return nil, &fs.PathError{Op: "open", Path: name, Err: fs.ErrNotExist}
}

// Stat implements fs.StatFS.
func (t *ToolFS) Stat(name string) (fs.FileInfo, error) {
	return t.StatContext(context.Background(), name)
}

func (t *ToolFS) StatContext(ctx context.Context, name string) (fs.FileInfo, error) {
	if !fs.ValidPath(name) {
		return nil, &fs.PathError{Op: "stat", Path: name, Err: fs.ErrNotExist}
	}

	switch name {
	case ".":
		return fskit.Entry(".", fs.ModeDir|0555), nil
	case "list":
		return fskit.Entry("list", 0444), nil
	case "call":
		return fskit.Entry("call", 0222), nil
	case "result":
		return fskit.Entry("result", 0444), nil
	}

	return nil, &fs.PathError{Op: "stat", Path: name, Err: fs.ErrNotExist}
}

// ResolveFS allows the namespace to traverse into ToolFS.
func (t *ToolFS) ResolveFS(ctx context.Context, name string) (fs.FS, string, error) {
	return t, name, nil
}

// --- toolCallFile: writable file that calls callTool on close ---

type toolCallFile struct {
	*fskit.Node
	tfs *ToolFS
	buf []byte
}

func (f *toolCallFile) Stat() (fs.FileInfo, error) {
	return f.Node, nil
}

func (f *toolCallFile) Seek(offset int64, whence int) (int64, error) {
	return 0, nil
}

func (f *toolCallFile) Read(p []byte) (int, error) {
	return 0, io.EOF
}

func (f *toolCallFile) Write(b []byte) (int, error) {
	f.buf = append(f.buf, b...)
	return len(b), nil
}

func (f *toolCallFile) Close() error {
	if len(f.buf) > 0 {
		reqJSON := string(f.buf)
		f.buf = nil
		// Parse name and params from JSON
		// {"name":"...", "params":{...}}
		reqVal := js.Global().Get("JSON").Call("parse", reqJSON)
		toolName := reqVal.Get("name").String()
		paramsVal := reqVal.Get("params")
		paramsJSON := "{}"
		if paramsVal.Truthy() {
			paramsJSON = js.Global().Get("JSON").Call("stringify", paramsVal).String()
		}

		resultVal, err := jsutil.AwaitErr(f.tfs.js().Call("callTool", toolName, paramsJSON))
		resp := []byte(`{"content":"","error":"unknown error"}`)
		if err == nil && resultVal.Truthy() {
			resp = []byte(resultVal.String())
		} else if err != nil {
			resp = []byte(`{"content":"","error":"` + err.Error() + `"}`)
		}
		f.tfs.mu.Lock()
		f.tfs.lastResp = resp
		f.tfs.mu.Unlock()
	}
	return nil
}

var (
	_ fs.FS           = (*ToolFS)(nil)
	_ fs.OpenContextFS = (*ToolFS)(nil)
	_ fs.StatFS       = (*ToolFS)(nil)
)
