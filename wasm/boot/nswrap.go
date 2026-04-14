//go:build js && wasm

package main

import (
	"context"
	"os"
	"path"
	"time"

	"tractor.dev/wanix/fs"
	"tractor.dev/wanix/vfs"
)

// nsWrapper wraps *vfs.NS to implement fs write interfaces that NS lacks.
//
// Problem: vfs.NS only implements Open/OpenContext/Stat/StatContext/ResolveFS.
// When fs.OpenFile(namespace, name, O_CREATE, perm) is called:
//   1. NS doesn't implement OpenFileFS → skip
//   2. ResolveTo[OpenFileFS] fails because OpenFile doesn't set "create" op context
//   3. Falls back to broken path: Create (works) → Close → Chmod → fs.Open (read-only!)
//   4. Returns read-only handle → writes produce NUL bytes (^@)
//
// Fix: implement OpenFileFS (and other write interfaces) on a wrapper that sets
// the correct op context before resolving through the namespace.
type nsWrapper struct {
	*vfs.NS
}

func wrapNS(ns *vfs.NS) *nsWrapper {
	return &nsWrapper{ns}
}

// resolveCtx builds a context with the appropriate op set for namespace resolution.
func (w *nsWrapper) resolveCtx(op string) context.Context {
	return fs.WithOp(fs.ContextFor(w.NS), op)
}

// --- OpenFileFS ---

func (w *nsWrapper) OpenFile(name string, flag int, perm fs.FileMode) (fs.File, error) {
	ctx := fs.ContextFor(w.NS)
	if flag&os.O_CREATE != 0 {
		ctx = fs.WithOp(ctx, "create")
	}
	if flag&(os.O_WRONLY|os.O_RDWR) == 0 {
		ctx = fs.WithReadOnly(ctx)
	}
	rfsys, rname, err := fs.ResolveTo[fs.OpenFileFS](w.NS, ctx, name)
	if err == nil {
		return rfsys.OpenFile(rname, flag, perm)
	}
	// Fall back to the standard fs.OpenFile which handles the broken path
	// for read-only opens and non-OpenFileFS filesystems.
	return fs.OpenFile(w.NS, name, flag, perm)
}

// --- CreateFS ---

func (w *nsWrapper) Create(name string) (fs.File, error) {
	ctx := w.resolveCtx("create")
	rfsys, rname, err := fs.ResolveTo[fs.CreateFS](w.NS, ctx, name)
	if err != nil {
		return nil, err
	}
	return rfsys.Create(rname)
}

// --- MkdirFS ---

func (w *nsWrapper) Mkdir(name string, perm fs.FileMode) error {
	ctx := w.resolveCtx("mkdir")
	rfsys, rname, err := fs.ResolveTo[fs.MkdirFS](w.NS, ctx, name)
	if err != nil {
		return err
	}
	return rfsys.Mkdir(rname, perm)
}

// --- MkdirAllFS ---

func (w *nsWrapper) MkdirAll(name string, perm fs.FileMode) error {
	ctx := w.resolveCtx("mkdir")
	rfsys, rname, err := fs.ResolveTo[fs.MkdirAllFS](w.NS, ctx, name)
	if err != nil {
		return err
	}
	return rfsys.MkdirAll(rname, perm)
}

// --- RemoveFS ---

func (w *nsWrapper) Remove(name string) error {
	rfsys, rname, err := fs.ResolveTo[fs.RemoveFS](w.NS, fs.ContextFor(w.NS), name)
	if err != nil {
		return err
	}
	return rfsys.Remove(rname)
}

// --- RemoveAllFS ---

func (w *nsWrapper) RemoveAll(name string) error {
	rfsys, rname, err := fs.ResolveTo[fs.RemoveAllFS](w.NS, fs.ContextFor(w.NS), name)
	if err != nil {
		return err
	}
	return rfsys.RemoveAll(rname)
}

// --- RenameFS ---

func (w *nsWrapper) Rename(oldname, newname string) error {
	ctx := fs.ContextFor(w.NS)

	oldfsys, oldrname, err := fs.ResolveTo[fs.RenameFS](w.NS, ctx, oldname)
	if err != nil {
		return err
	}

	// Use "create" op context for destination so namespace resolution
	// can find the binding even when the target file doesn't exist yet.
	// NS ResolveFS only allows "create"/"mkdir"/"symlink" ops for new-file lookup.
	newCtx := fs.WithOp(ctx, "create")
	newfsys, newrdir, err := fs.ResolveTo[fs.RenameFS](w.NS, newCtx, path.Dir(newname))
	if err != nil {
		return err
	}
	newFullName := path.Join(newrdir, path.Base(newname))

	if fs.Equal(oldfsys, newfsys) {
		return oldfsys.Rename(oldrname, newFullName)
	}
	// Cross-filesystem: copy + remove
	if err := fs.CopyFS(oldfsys, oldrname, newfsys, newFullName); err != nil {
		return err
	}
	return fs.RemoveAll(oldfsys, oldrname)
}

// --- TruncateFS ---

func (w *nsWrapper) Truncate(name string, size int64) error {
	rfsys, rname, err := fs.ResolveTo[fs.TruncateFS](w.NS, fs.ContextFor(w.NS), name)
	if err != nil {
		return err
	}
	return rfsys.Truncate(rname, size)
}

// --- ChmodFS ---

func (w *nsWrapper) Chmod(name string, mode fs.FileMode) error {
	rfsys, rname, err := fs.ResolveTo[fs.ChmodFS](w.NS, fs.ContextFor(w.NS), name)
	if err != nil {
		return err
	}
	return rfsys.Chmod(rname, mode)
}

// --- ChtimesFS ---

func (w *nsWrapper) Chtimes(name string, atime, mtime time.Time) error {
	rfsys, rname, err := fs.ResolveTo[fs.ChtimesFS](w.NS, fs.ContextFor(w.NS), name)
	if err != nil {
		return err
	}
	return rfsys.Chtimes(rname, atime, mtime)
}

// --- SymlinkFS ---

func (w *nsWrapper) Symlink(oldname, newname string) error {
	ctx := w.resolveCtx("symlink")
	rfsys, rname, err := fs.ResolveTo[fs.SymlinkFS](w.NS, ctx, newname)
	if err != nil {
		return err
	}
	return rfsys.Symlink(oldname, rname)
}

// --- ReadlinkFS ---

func (w *nsWrapper) Readlink(name string) (string, error) {
	ctx := fs.WithReadOnly(fs.ContextFor(w.NS))
	rfsys, rname, err := fs.ResolveTo[fs.ReadlinkFS](w.NS, ctx, name)
	if err != nil {
		return "", err
	}
	return rfsys.Readlink(rname)
}

// Interface checks
var (
	_ fs.OpenFileFS  = (*nsWrapper)(nil)
	_ fs.CreateFS    = (*nsWrapper)(nil)
	_ fs.MkdirFS     = (*nsWrapper)(nil)
	_ fs.MkdirAllFS  = (*nsWrapper)(nil)
	_ fs.RemoveFS    = (*nsWrapper)(nil)
	_ fs.RemoveAllFS = (*nsWrapper)(nil)
	_ fs.RenameFS    = (*nsWrapper)(nil)
	_ fs.TruncateFS  = (*nsWrapper)(nil)
	_ fs.ChmodFS     = (*nsWrapper)(nil)
	_ fs.ChtimesFS   = (*nsWrapper)(nil)
	_ fs.SymlinkFS   = (*nsWrapper)(nil)
	_ fs.ReadlinkFS  = (*nsWrapper)(nil)
)
