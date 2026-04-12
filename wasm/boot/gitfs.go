//go:build js && wasm

package main

import (
	"context"
	"path"
	"syscall/js"

	"tractor.dev/wanix/fs"
	"tractor.dev/wanix/fs/fskit"
	"tractor.dev/wanix/web/jsutil"
)

// GitFs is a read-only fs.FS that proxies to the board's JavaScript GitFs service.
//
// The JS side must expose on window.boardVM.gitfs:
//
//	getFile(path)   → Promise<string>   (file content, already decoded)
//	listFiles(path) → Promise<Array<{name,path,type,size}>>
type GitFs struct {
	cfg js.Value
}

func NewGitFs(cfg js.Value) *GitFs {
	return &GitFs{cfg: cfg}
}

func (g *GitFs) js() js.Value {
	return g.cfg.Get("gitfs")
}

// Open implements fs.FS.
func (g *GitFs) Open(name string) (fs.File, error) {
	return g.OpenContext(context.Background(), name)
}

func (g *GitFs) OpenContext(ctx context.Context, name string) (fs.File, error) {
	if !fs.ValidPath(name) {
		return nil, &fs.PathError{Op: "open", Path: name, Err: fs.ErrNotExist}
	}
	if name == "." {
		return g.openDir(".")
	}

	// Try as file first: getFile returns content on success, throws on failure.
	contentVal, err := jsutil.AwaitErr(g.js().Call("getFile", name))
	if err == nil && contentVal.Truthy() {
		data := []byte(contentVal.String())
		node := fskit.Entry(path.Base(name), 0444, data)
		return node.Open(".")
	}

	// Try as directory
	return g.openDir(name)
}

func (g *GitFs) openDir(name string) (fs.File, error) {
	arrVal, err := jsutil.AwaitErr(g.js().Call("listFiles", name))
	if err != nil || !arrVal.Truthy() {
		return nil, &fs.PathError{Op: "open", Path: name, Err: fs.ErrNotExist}
	}

	dirName := name
	if name != "." {
		dirName = path.Base(name)
	}

	entries := make([]fs.DirEntry, 0, arrVal.Length())
	for i := 0; i < arrVal.Length(); i++ {
		obj := arrVal.Index(i)
		eName := obj.Get("name").String()
		eType := obj.Get("type").String()
		eSize := 0
		if !obj.Get("size").IsUndefined() {
			eSize = obj.Get("size").Int()
		}
		mode := fs.FileMode(0444)
		if eType == "dir" {
			mode = fs.ModeDir | 0555
		}
		entries = append(entries, fskit.Entry(eName, mode, eSize))
	}

	return fskit.DirFile(
		fskit.Entry(dirName, fs.ModeDir|0555),
		entries...,
	), nil
}

// Stat implements fs.StatFS.
func (g *GitFs) Stat(name string) (fs.FileInfo, error) {
	return g.StatContext(context.Background(), name)
}

func (g *GitFs) StatContext(ctx context.Context, name string) (fs.FileInfo, error) {
	if !fs.ValidPath(name) {
		return nil, &fs.PathError{Op: "stat", Path: name, Err: fs.ErrNotExist}
	}
	if name == "." {
		return fskit.Entry(".", fs.ModeDir|0555), nil
	}

	// Try as file
	contentVal, err := jsutil.AwaitErr(g.js().Call("getFile", name))
	if err == nil && contentVal.Truthy() {
		return fskit.Entry(path.Base(name), 0444, len(contentVal.String())), nil
	}

	// Must be a dir (verify it exists)
	arrVal, err := jsutil.AwaitErr(g.js().Call("listFiles", name))
	if err != nil || !arrVal.Truthy() {
		return nil, &fs.PathError{Op: "stat", Path: name, Err: fs.ErrNotExist}
	}
	return fskit.Entry(path.Base(name), fs.ModeDir|0555), nil
}

// ResolveFS allows the namespace to traverse into GitFs.
func (g *GitFs) ResolveFS(ctx context.Context, name string) (fs.FS, string, error) {
	return g, name, nil
}

var (
	_ fs.FS            = (*GitFs)(nil)
	_ fs.OpenContextFS  = (*GitFs)(nil)
	_ fs.StatFS        = (*GitFs)(nil)
)
