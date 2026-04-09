//go:build js && wasm

package main

import (
	"context"
	"io"
	"log"
	"sync"
	"syscall/js"
	"time"

	"tractor.dev/wanix/fs"
	"tractor.dev/wanix/fs/fskit"
	"tractor.dev/wanix/web/jsutil"
)

// LLMFS exposes an LLM tunnel as a filesystem:
//
//	/#llm/prompt   → write to send a plain text prompt, read to get last prompt
//	/#llm/response → read to get the LLM response
//	/#llm/request  → write full OpenAI Chat Completions JSON, triggers structured API call
//	/#llm/result   → read to get the structured JSON response (with tool_calls etc.)
//
// The JS side must expose on window.boardVM.llmfs:
//
//	sendPrompt(prompt string) → Promise<string>   (returns text response)
//	sendRequest(json string) → Promise<string>    (returns structured JSON response)
type LLMFS struct {
	cfg      js.Value
	mu       sync.Mutex
	lastResp []byte
}

func NewLLMFS(cfg js.Value) *LLMFS {
	return &LLMFS{cfg: cfg}
}

func (l *LLMFS) js() js.Value {
	return l.cfg.Get("llmfs")
}

// Open implements fs.FS.
func (l *LLMFS) Open(name string) (fs.File, error) {
	return l.OpenContext(context.Background(), name)
}

func (l *LLMFS) OpenContext(ctx context.Context, name string) (fs.File, error) {
	log.Printf("[llmfs] OpenContext('%s')", name)
	if !fs.ValidPath(name) {
		return nil, &fs.PathError{Op: "open", Path: name, Err: fs.ErrNotExist}
	}

	switch name {
	case ".":
		return fskit.DirFile(
			fskit.Entry(".", fs.ModeDir|0555),
			fskit.Entry("prompt", 0666),
			fskit.Entry("response", 0444),
			fskit.Entry("request", 0666),
			fskit.Entry("result", 0444),
		), nil
	case "prompt":
		return &promptFile{
			Node: fskit.Entry("prompt", 0666),
			llm:  l,
		}, nil
	case "response":
		l.mu.Lock()
		resp := l.lastResp
		l.mu.Unlock()
		if resp == nil {
			resp = []byte("")
		}
		node := fskit.Entry("response", 0444, resp)
		return node.Open(".")
	case "request":
		return &requestFile{
			Node: fskit.Entry("request", 0666),
			llm:  l,
		}, nil
	case "result":
		l.mu.Lock()
		resp := l.lastResp
		l.mu.Unlock()
		if resp == nil {
			resp = []byte("{}")
		}
		node := fskit.Entry("result", 0444, resp)
		return node.Open(".")
	}

	return nil, &fs.PathError{Op: "open", Path: name, Err: fs.ErrNotExist}
}

// Stat implements fs.StatFS.
func (l *LLMFS) Stat(name string) (fs.FileInfo, error) {
	return l.StatContext(context.Background(), name)
}

func (l *LLMFS) StatContext(ctx context.Context, name string) (fs.FileInfo, error) {
	if !fs.ValidPath(name) {
		return nil, &fs.PathError{Op: "stat", Path: name, Err: fs.ErrNotExist}
	}

	switch name {
	case ".":
		return fskit.Entry(".", fs.ModeDir|0555), nil
	case "prompt":
		return fskit.Entry("prompt", 0666), nil
	case "response":
		return fskit.Entry("response", 0444), nil
	case "request":
		return fskit.Entry("request", 0666), nil
	case "result":
		return fskit.Entry("result", 0444), nil
	}

	return nil, &fs.PathError{Op: "stat", Path: name, Err: fs.ErrNotExist}
}

// ResolveFS allows the namespace to traverse into LLMFS.
func (l *LLMFS) ResolveFS(ctx context.Context, name string) (fs.FS, string, error) {
	return l, name, nil
}

// --- promptFile: writable file that calls sendPrompt on close ---

type promptFile struct {
	*fskit.Node
	llm *LLMFS
	buf []byte
}

func (f *promptFile) Stat() (fs.FileInfo, error) {
	return f.Node, nil
}

func (f *promptFile) Seek(offset int64, whence int) (int64, error) {
	return 0, nil
}

func (f *promptFile) Read(p []byte) (int, error) {
	return 0, io.EOF
}

func (f *promptFile) Write(b []byte) (int, error) {
	f.buf = append(f.buf, b...)
	return len(b), nil
}

func (f *promptFile) Close() error {
	if len(f.buf) > 0 {
		prompt := string(f.buf)
		f.buf = nil
		resultVal, err := jsutil.AwaitErr(f.llm.js().Call("sendPrompt", prompt))
		resp := []byte("")
		if err == nil && resultVal.Truthy() {
			resp = []byte(resultVal.String())
		} else if err != nil {
			resp = []byte("ERROR: " + err.Error())
		}
		ts := time.Now().Format("2006-01-02 15:04:05")
		resp = append([]byte("["+ts+"] "), resp...)
		f.llm.mu.Lock()
		f.llm.lastResp = resp
		f.llm.mu.Unlock()
	}
	return nil
}

// --- requestFile: writable file that calls sendRequest on close ---

type requestFile struct {
	*fskit.Node
	llm *LLMFS
	buf []byte
}

func (f *requestFile) Stat() (fs.FileInfo, error) {
	return f.Node, nil
}

func (f *requestFile) Seek(offset int64, whence int) (int64, error) {
	return 0, nil
}

func (f *requestFile) Read(p []byte) (int, error) {
	return 0, io.EOF
}

func (f *requestFile) Write(b []byte) (int, error) {
	f.buf = append(f.buf, b...)
	return len(b), nil
}

func (f *requestFile) Close() error {
	log.Printf("[llmfs] requestFile.Close() called, buf len=%d", len(f.buf))
	if len(f.buf) > 0 {
		reqJSON := string(f.buf)
		f.buf = nil
		log.Printf("[llmfs] calling sendRequest, json len=%d", len(reqJSON))
		jsObj := f.llm.js()
		log.Printf("[llmfs] js obj valid=%v", jsObj.Truthy())
		resultVal, err := jsutil.AwaitErr(jsObj.Call("sendRequest", reqJSON))
		log.Printf("[llmfs] sendRequest returned, err=%v, result valid=%v", err, resultVal.Truthy())
		resp := []byte("{}")
		if err == nil && resultVal.Truthy() {
			resp = []byte(resultVal.String())
			log.Printf("[llmfs] response len=%d", len(resp))
		} else if err != nil {
			resp = []byte(`{"error":"` + err.Error() + `"}`)
			log.Printf("[llmfs] error: %s", err.Error())
		}
		f.llm.mu.Lock()
		f.llm.lastResp = resp
		f.llm.mu.Unlock()
		log.Printf("[llmfs] lastResp set, len=%d", len(resp))
	}
	return nil
}

var (
	_ fs.FS           = (*LLMFS)(nil)
	_ fs.OpenContextFS = (*LLMFS)(nil)
	_ fs.StatFS       = (*LLMFS)(nil)
)
