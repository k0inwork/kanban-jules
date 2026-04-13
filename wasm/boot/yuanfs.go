//go:build js && wasm

package main

import (
	"context"
	"io"
	"log"
	"sync"
	"syscall/js"

	"tractor.dev/wanix/fs"
	"tractor.dev/wanix/fs/fskit"
	"tractor.dev/wanix/web/jsutil"
)

// YuanFS exposes YUAN agent (running in almostnode) as a filesystem:
//
//	/#yuan/in     → write to send a user message to YUAN
//	/#yuan/out    → read triggers agent.run(msg) and returns the response text
//	/#yuan/status → read to get current status ("idle"|"running"|"error"|"not initialized")
//
// The JS side must expose on window.boardVM.yuan:
//
//	init()                        → Promise<void>   (create container, install packages, create agent)
//	send(msg string)              → Promise<string> (run agent with message, return response text)
//	status()                      → string          ("idle"|"running"|"error"|"not initialized")
type YuanFS struct {
	cfg      js.Value
	mu       sync.Mutex
	lastMsg  []byte
	lastResp []byte
}

func NewYuanFS(cfg js.Value) *YuanFS {
	return &YuanFS{cfg: cfg}
}

func (y *YuanFS) js() js.Value {
	return y.cfg.Get("yuan")
}

// callSend fires agent.run(msg) and returns the response text.
func (y *YuanFS) callSend(msgData []byte) []byte {
	msg := string(msgData)
	log.Printf("[yuanfs] callSend: msg len=%d", len(msg))

	jsObj := y.js()
	if !jsObj.Truthy() {
		return []byte("error: boardVM.yuan not configured")
	}

	resultVal, err := jsutil.AwaitErr(jsObj.Call("send", msg))
	resp := []byte("error: no response")
	if err == nil && resultVal.Truthy() {
		resp = []byte(resultVal.String())
		log.Printf("[yuanfs] response len=%d", len(resp))
	} else if err != nil {
		resp = []byte("error: " + err.Error())
		log.Printf("[yuanfs] error: %s", err.Error())
	}

	y.mu.Lock()
	y.lastResp = resp
	y.mu.Unlock()
	return resp
}

// callInit initializes the YUAN agent container.
func (y *YuanFS) callInit() error {
	jsObj := y.js()
	if !jsObj.Truthy() {
		return js.Error{Value: js.ValueOf("boardVM.yuan not configured")}
	}
	_, err := jsutil.AwaitErr(jsObj.Call("init"))
	return err
}

// getStatus returns the current YUAN status string.
func (y *YuanFS) getStatus() string {
	jsObj := y.js()
	if !jsObj.Truthy() {
		return "not configured"
	}
	val := jsObj.Call("status")
	if val.IsUndefined() {
		return "unknown"
	}
	return val.String()
}

// Open implements fs.FS.
func (y *YuanFS) Open(name string) (fs.File, error) {
	return y.OpenContext(context.Background(), name)
}

func (y *YuanFS) OpenContext(ctx context.Context, name string) (fs.File, error) {
	log.Printf("[yuanfs] OpenContext('%s')", name)
	if !fs.ValidPath(name) {
		return nil, &fs.PathError{Op: "open", Path: name, Err: fs.ErrNotExist}
	}

	switch name {
	case ".":
		return fskit.DirFile(
			fskit.Entry(".", fs.ModeDir|0555),
			fskit.Entry("in", 0222),
			fskit.Entry("out", 0444),
			fskit.Entry("status", 0444),
		), nil
	case "in":
		return &yuanInFile{
			Node: fskit.Entry("in", 0222),
			yuan: y,
		}, nil
	case "out":
		// Trigger agent.run() with accumulated message
		y.mu.Lock()
		msgData := y.lastMsg
		y.lastMsg = nil
		y.mu.Unlock()

		var resp []byte
		if len(msgData) > 0 {
			resp = y.callSend(msgData)
		} else {
			y.mu.Lock()
			resp = y.lastResp
			y.mu.Unlock()
			if resp == nil {
				resp = []byte("no message sent yet")
			}
		}
		node := fskit.Entry("out", 0444, resp)
		return node.Open(".")
	case "status":
		status := y.getStatus()
		node := fskit.Entry("status", 0444, []byte(status))
		return node.Open(".")
	}

	return nil, &fs.PathError{Op: "open", Path: name, Err: fs.ErrNotExist}
}

// Stat implements fs.StatFS.
func (y *YuanFS) Stat(name string) (fs.FileInfo, error) {
	return y.StatContext(context.Background(), name)
}

func (y *YuanFS) StatContext(ctx context.Context, name string) (fs.FileInfo, error) {
	if !fs.ValidPath(name) {
		return nil, &fs.PathError{Op: "stat", Path: name, Err: fs.ErrNotExist}
	}

	switch name {
	case ".":
		return fskit.Entry(".", fs.ModeDir|0555), nil
	case "in":
		return fskit.Entry("in", 0222), nil
	case "out":
		return fskit.Entry("out", 0444), nil
	case "status":
		return fskit.Entry("status", 0444), nil
	}

	return nil, &fs.PathError{Op: "stat", Path: name, Err: fs.ErrNotExist}
}

// ResolveFS allows namespace traversal.
func (y *YuanFS) ResolveFS(ctx context.Context, name string) (fs.FS, string, error) {
	return y, name, nil
}

// --- yuanInFile: writable file that accumulates message ---

type yuanInFile struct {
	*fskit.Node
	yuan *YuanFS
	buf  []byte
}

func (f *yuanInFile) Stat() (fs.FileInfo, error) { return f.Node, nil }

func (f *yuanInFile) Seek(offset int64, whence int) (int64, error) { return 0, nil }

func (f *yuanInFile) Read(p []byte) (int, error) { return 0, io.EOF }

func (f *yuanInFile) Write(b []byte) (int, error) {
	f.buf = append(f.buf, b...)
	return len(b), nil
}

func (f *yuanInFile) Close() error {
	if len(f.buf) > 0 {
		f.yuan.mu.Lock()
		f.yuan.lastMsg = append(f.yuan.lastMsg, f.buf...)
		f.yuan.mu.Unlock()
		f.buf = nil
	}
	return nil
}

var (
	_ fs.FS            = (*YuanFS)(nil)
	_ fs.OpenContextFS = (*YuanFS)(nil)
	_ fs.StatFS        = (*YuanFS)(nil)
)
