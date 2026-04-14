//go:build js && wasm

// Package idbfs provides a persistent filesystem backed by IndexedDB.
// Files are stored as records with {path, data, mode, modTime}.
// Designed to serve as the writable overlay for cowfs in wanix.
package idbfs

import (
	"bytes"
	"context"
	"errors"
	"io"
	"log"
	"os"
	"path"
	"sort"
	"strings"
	"sync"
	"syscall/js"
	"time"

	"tractor.dev/wanix/fs"
	"tractor.dev/wanix/fs/fskit"
)

// awaitIDB awaits an IDBRequest using onsuccess/onerror callbacks with a channel,
// bypassing the need for .then() or Promise wrapping. Go-held references to the
// callbacks prevent GC from collecting them before the request resolves.
func awaitIDB(req js.Value) (js.Value, error) {
	ch := make(chan js.Value, 2)

	successFn := js.FuncOf(func(_ js.Value, _ []js.Value) any {
		ch <- req.Get("result")
		ch <- js.Undefined()
		return nil
	})
	defer successFn.Release()

	errorFn := js.FuncOf(func(_ js.Value, _ []js.Value) any {
		ch <- js.Undefined()
		ch <- req.Get("error")
		return nil
	})
	defer errorFn.Release()

	req.Set("onsuccess", successFn)
	req.Set("onerror", errorFn)

	resolved := <-ch
	rejected := <-ch
	if rejected.Truthy() {
		return js.Undefined(), js.Error{Value: rejected}
	}
	return resolved, nil
}

// FS is an IndexedDB-backed filesystem.
type FS struct {
	dbName string
	store  string
	db     js.Value
	mu     sync.Mutex
}

// record represents a file stored in IndexedDB.
type record struct {
	path          string
	data          []byte
	mode          uint32
	modTime       int64
	isDir         bool
	symlinkTarget string
}

// New opens (or creates) an IndexedDB database and returns a filesystem.
func New(dbName string) *FS {
	return &FS{
		dbName: dbName,
		store:  "files",
	}
}

// Init opens the database connection. Must be called before any FS operations.
func (fsys *FS) Init() error {
	fsys.mu.Lock()
	defer fsys.mu.Unlock()

	if !fsys.db.IsUndefined() {
		log.Println("[idbfs] Init: already initialized")
		return nil
	}

	idb := js.Global().Get("indexedDB")
	if idb.IsUndefined() {
		log.Println("[idbfs] Init: ERROR indexedDB not available")
		return errors.New("indexedDB not available")
	}

	log.Printf("[idbfs] Init: opening database %q\n", fsys.dbName)
	req := idb.Call("open", fsys.dbName, 1)

	// Keep Go references to prevent GC from releasing callbacks
	// while the channel blocks waiting for the IDB open to resolve.
	upgradeFn := js.FuncOf(func(this js.Value, args []js.Value) any {
		event := args[0]
		db := event.Get("target").Get("result")
		log.Println("[idbfs] onupgradeneeded fired, creating object store", fsys.store)
		storeNames := db.Get("objectStoreNames")
		if !storeNames.Call("contains", fsys.store).Bool() {
			db.Call("createObjectStore", fsys.store, map[string]any{"keyPath": "path"})
			log.Println("[idbfs] object store created")
		} else {
			log.Println("[idbfs] object store already exists")
		}
		return nil
	})
	defer upgradeFn.Release()
	req.Set("onupgradeneeded", upgradeFn)

	blockFn := js.FuncOf(func(this js.Value, args []js.Value) any {
		ev := args[0]
		log.Printf("[idbfs] onblocked fired: %v\n", ev.Get("target").Get("error"))
		return nil
	})
	defer blockFn.Release()
	req.Set("onblocked", blockFn)

	result, err := awaitIDB(req)
	if err != nil {
		log.Printf("[idbfs] Init: open failed: %v\n", err)
		return err
	}

	if result.IsUndefined() {
		log.Println("[idbfs] Init: ERROR result is undefined")
		return errors.New("idbfs: open returned undefined")
	}

	log.Printf("[idbfs] Init: database opened, objectStoreNames=%v\n", result.Get("objectStoreNames"))
	fsys.db = result
	return nil
}

// dbTx runs a transaction on the object store. Returns the store handle.
func (fsys *FS) dbTx(mode string) (js.Value, func(), error) {
	tx := fsys.db.Call("transaction", fsys.store, mode)
	store := tx.Call("objectStore", fsys.store)
	return store, func() {}, nil
}

// getRecord fetches a single record by path.
func (fsys *FS) getRecord(p string) (*record, error) {
	store, cleanup, err := fsys.dbTx("readonly")
	defer cleanup()
	if err != nil {
		return nil, err
	}

	req := store.Call("get", p)
	result, err := awaitIDB(req)
	if err != nil {
		return nil, err
	}
	if result.IsUndefined() {
		return nil, nil
	}

	rec := &record{
		path:    result.Get("path").String(),
		isDir:   result.Get("isDir").Bool(),
		mode:    uint32(result.Get("mode").Int()),
		modTime: int64(result.Get("modTime").Int()),
		data:    jsValueToBytes(result.Get("data")),
	}
	if t := result.Get("symlinkTarget"); !t.IsUndefined() && !t.IsNull() {
		rec.symlinkTarget = t.String()
	}
	return rec, nil
}

// putRecord writes a record to the store.
func (fsys *FS) putRecord(r *record) error {
	store, cleanup, err := fsys.dbTx("readwrite")
	defer cleanup()
	if err != nil {
		log.Printf("[idbfs] putRecord %q: dbTx error: %v\n", r.path, err)
		return err
	}

	obj := js.Global().Get("Object").New()
	obj.Set("path", r.path)
	obj.Set("isDir", r.isDir)
	obj.Set("mode", r.mode)
	obj.Set("modTime", r.modTime)
	obj.Set("data", bytesToJSValue(r.data))
	if r.symlinkTarget != "" {
		obj.Set("symlinkTarget", r.symlinkTarget)
	}

	_, err = awaitIDB(store.Call("put", obj))
	if err != nil {
		log.Printf("[idbfs] putRecord %q: put error: %v\n", r.path, err)
	} else {
		log.Printf("[idbfs] putRecord %q: OK (%d bytes, isDir=%v)\n", r.path, len(r.data), r.isDir)
	}
	return err
}

// deleteRecord removes a record by path.
func (fsys *FS) deleteRecord(p string) error {
	store, cleanup, err := fsys.dbTx("readwrite")
	defer cleanup()
	if err != nil {
		return err
	}

	_, err = awaitIDB(store.Call("delete", p))
	return err
}

// getAllPaths returns all paths in the store.
func (fsys *FS) getAllPaths() ([]string, error) {
	store, cleanup, err := fsys.dbTx("readonly")
	defer cleanup()
	if err != nil {
		return nil, err
	}

	req := store.Call("getAllKeys")
	result, err := awaitIDB(req)
	if err != nil {
		return nil, err
	}

	var paths []string
	n := result.Length()
	for i := 0; i < n; i++ {
		paths = append(paths, result.Index(i).String())
	}
	return paths, nil
}

// deleteByPrefix removes all records whose path starts with prefix.
func (fsys *FS) deleteByPrefix(prefix string) error {
	paths, err := fsys.getAllPaths()
	if err != nil {
		return err
	}
	for _, p := range paths {
		if strings.HasPrefix(p, prefix) {
			if err := fsys.deleteRecord(p); err != nil {
				return err
			}
		}
	}
	return nil
}

// Interface checks
var _ fs.FS = (*FS)(nil)
var _ fs.StatContextFS = (*FS)(nil)
var _ fs.ReadDirFS = (*FS)(nil)
var _ fs.OpenFileFS = (*FS)(nil)
var _ fs.RemoveFS = (*FS)(nil)
var _ fs.RenameFS = (*FS)(nil)
var _ fs.MkdirFS = (*FS)(nil)
var _ fs.MkdirAllFS = (*FS)(nil)
var _ fs.RemoveAllFS = (*FS)(nil)
var _ fs.TruncateFS = (*FS)(nil)
var _ fs.SymlinkFS  = (*FS)(nil)
var _ fs.ReadlinkFS = (*FS)(nil)

func (fsys *FS) Open(name string) (fs.File, error) {
	return fsys.OpenContext(context.Background(), name)
}

func (fsys *FS) OpenContext(ctx context.Context, name string) (fs.File, error) {
	if !fs.ValidPath(name) {
		return nil, &fs.PathError{Op: "open", Path: name, Err: fs.ErrNotExist}
	}

	fsys.mu.Lock()
	defer fsys.mu.Unlock()

	name = path.Clean(name)

	// Root directory
	if name == "." {
		return fsys.openDir(".")
	}

	// Try to find an exact record
	rec, err := fsys.getRecord(name)
	if err != nil {
		return nil, &fs.PathError{Op: "open", Path: name, Err: err}
	}

	if rec != nil {
		if rec.isDir {
			return fsys.openDir(name)
		}
		f, err := fsys.openFile(rec)
		if err != nil {
			return nil, &fs.PathError{Op: "open", Path: name, Err: err}
		}
		return f, nil
	}

	// Check if it's an implicit directory (has children under it)
	paths, err := fsys.getAllPaths()
	if err != nil {
		return nil, &fs.PathError{Op: "open", Path: name, Err: err}
	}

	prefix := name + "/"
	for _, p := range paths {
		if strings.HasPrefix(p, prefix) {
			return fsys.openDir(name)
		}
	}

	return nil, &fs.PathError{Op: "open", Path: name, Err: fs.ErrNotExist}
}

func (fsys *FS) Stat(name string) (fs.FileInfo, error) {
	return fsys.StatContext(context.Background(), name)
}

func (fsys *FS) StatContext(ctx context.Context, name string) (fs.FileInfo, error) {
	if !fs.ValidPath(name) {
		return nil, &fs.PathError{Op: "stat", Path: name, Err: fs.ErrNotExist}
	}

	fsys.mu.Lock()
	defer fsys.mu.Unlock()

	name = path.Clean(name)

	if name == "." {
		return fskit.Entry(".", fs.ModeDir|0755), nil
	}

	rec, err := fsys.getRecord(name)
	if err != nil {
		return nil, &fs.PathError{Op: "stat", Path: name, Err: err}
	}

	if rec != nil {
		return recordToInfo(rec), nil
	}

	// Check implicit directory
	paths, err := fsys.getAllPaths()
	if err != nil {
		return nil, &fs.PathError{Op: "stat", Path: name, Err: err}
	}

	prefix := name + "/"
	for _, p := range paths {
		if strings.HasPrefix(p, prefix) {
			return fskit.Entry(path.Base(name), fs.ModeDir|0755), nil
		}
	}

	return nil, &fs.PathError{Op: "stat", Path: name, Err: fs.ErrNotExist}
}

func (fsys *FS) ReadDir(name string) ([]fs.DirEntry, error) {
	fsys.mu.Lock()
	defer fsys.mu.Unlock()
	return fsys.readDirLocked(name)
}

// readDirLocked reads directory entries. Caller must hold fsys.mu.
func (fsys *FS) readDirLocked(name string) ([]fs.DirEntry, error) {
	if !fs.ValidPath(name) {
		return nil, &fs.PathError{Op: "readdir", Path: name, Err: fs.ErrNotExist}
	}

	name = path.Clean(name)

	paths, err := fsys.getAllPaths()
	if err != nil {
		return nil, &fs.PathError{Op: "readdir", Path: name, Err: err}
	}

	entrySet := make(map[string]bool) // name -> isDir
	prefix := ""
	if name != "." {
		prefix = name + "/"
	}

	for _, p := range paths {
		if name == "." {
			// Top-level entries
			i := strings.Index(p, "/")
			if i < 0 {
				entrySet[p] = false // file (will be corrected below)
			} else {
				entrySet[p[:i]] = true
			}
		} else if strings.HasPrefix(p, prefix) {
			rest := p[len(prefix):]
			i := strings.Index(rest, "/")
			if i < 0 {
				entrySet[rest] = false
			} else {
				entrySet[rest[:i]] = true
			}
		}
	}

	// Check if directories exist as explicit records
	for name := range entrySet {
		p := name
		if p != "." {
			p = path.Clean(p)
		}
		rec, err := fsys.getRecord(p)
		if err == nil && rec != nil && rec.isDir {
			entrySet[name] = true
		}
	}

	if len(entrySet) == 0 && name != "." {
		// Check if this directory itself exists
		rec, err := fsys.getRecord(name)
		if err != nil {
			return nil, &fs.PathError{Op: "readdir", Path: name, Err: err}
		}
		if rec == nil {
			// Check implicit
			parentPrefix := path.Dir(name)
			if parentPrefix != "." {
				parentPrefix += "/"
			}
			found := false
			for _, p := range paths {
				if strings.HasPrefix(p, parentPrefix) {
					found = true
					break
				}
			}
			if !found {
				return nil, &fs.PathError{Op: "readdir", Path: name, Err: fs.ErrNotExist}
			}
		}
		return []fs.DirEntry{}, nil
	}

	var entries []fs.DirEntry
	for name, isDir := range entrySet {
		if isDir {
			entries = append(entries, fskit.Entry(name, fs.ModeDir|0755))
		} else {
			entries = append(entries, fskit.Entry(name, 0644))
		}
	}
	sort.Slice(entries, func(i, j int) bool {
		return entries[i].Name() < entries[j].Name()
	})
	return entries, nil
}

func (fsys *FS) OpenFile(name string, flag int, perm fs.FileMode) (fs.File, error) {
	if !fs.ValidPath(name) {
		return nil, &fs.PathError{Op: "openfile", Path: name, Err: fs.ErrNotExist}
	}

	fsys.mu.Lock()
	defer fsys.mu.Unlock()

	name = path.Clean(name)
	isWrite := flag&(os.O_WRONLY|os.O_RDWR|os.O_CREATE|os.O_TRUNC) != 0

	if !isWrite {
		return fsys.openForRead(name)
	}

	// Writing
	rec, err := fsys.getRecord(name)
	if err != nil {
		return nil, &fs.PathError{Op: "openfile", Path: name, Err: err}
	}

	if rec != nil && rec.isDir {
		return nil, &fs.PathError{Op: "openfile", Path: name, Err: errors.New("is a directory")}
	}

	if flag&os.O_EXCL != 0 && rec != nil {
		return nil, &fs.PathError{Op: "openfile", Path: name, Err: fs.ErrExist}
	}

	var data []byte
	if rec != nil && flag&os.O_TRUNC == 0 {
		data = rec.data
	}

	mode := perm
	if rec != nil {
		mode = fs.FileMode(rec.mode)
	}

	// Persist the record immediately so subsequent Stat calls find it.
	// Without this, p9 Create calls info() which Stat's via the filesystem
	// and won't see the unflushed in-memory record.
	if rec == nil {
		if err := fsys.putRecord(&record{
			path:    name,
			data:    nil,
			mode:    uint32(mode),
			modTime: time.Now().UnixMilli(),
			isDir:   false,
		}); err != nil {
			return nil, &fs.PathError{Op: "openfile", Path: name, Err: err}
		}
	}

	return &writableFile{
		fsys:   fsys,
		name:   name,
		data:   data,
		offset: 0,
		dirty:  false,
		append: flag&os.O_APPEND != 0,
		mode:   mode,
	}, nil
}

func (fsys *FS) Mkdir(name string, perm fs.FileMode) error {
	if !fs.ValidPath(name) {
		return &fs.PathError{Op: "mkdir", Path: name, Err: fs.ErrInvalid}
	}

	fsys.mu.Lock()
	defer fsys.mu.Unlock()

	name = path.Clean(name)
	if name == "." {
		return &fs.PathError{Op: "mkdir", Path: name, Err: fs.ErrExist}
	}

	rec, err := fsys.getRecord(name)
	if err != nil {
		return &fs.PathError{Op: "mkdir", Path: name, Err: err}
	}
	if rec != nil {
		return &fs.PathError{Op: "mkdir", Path: name, Err: fs.ErrExist}
	}

	return fsys.putRecord(&record{
		path:    name,
		isDir:   true,
		mode:    uint32(perm),
		modTime: time.Now().UnixMilli(),
	})
}

func (fsys *FS) MkdirAll(name string, perm fs.FileMode) error {
	if !fs.ValidPath(name) {
		return &fs.PathError{Op: "mkdirall", Path: name, Err: fs.ErrInvalid}
	}

	fsys.mu.Lock()
	defer fsys.mu.Unlock()

	name = path.Clean(name)
	// Walk up creating parents
	parts := strings.Split(name, "/")
	for i := 1; i <= len(parts); i++ {
		dir := strings.Join(parts[:i], "/")
		if dir == "" {
			dir = "."
		}
		rec, err := fsys.getRecord(dir)
		if err != nil {
			return &fs.PathError{Op: "mkdirall", Path: dir, Err: err}
		}
		if rec == nil {
			if err := fsys.putRecord(&record{
				path:    dir,
				isDir:   true,
				mode:    uint32(perm),
				modTime: time.Now().UnixMilli(),
			}); err != nil {
				return &fs.PathError{Op: "mkdirall", Path: dir, Err: err}
			}
		}
	}
	return nil
}

func (fsys *FS) Chtimes(name string, atime, mtime time.Time) error {
	if !fs.ValidPath(name) {
		return &fs.PathError{Op: "chtimes", Path: name, Err: fs.ErrNotExist}
	}

	fsys.mu.Lock()
	defer fsys.mu.Unlock()

	name = path.Clean(name)
	rec, err := fsys.getRecord(name)
	if err != nil {
		return &fs.PathError{Op: "chtimes", Path: name, Err: err}
	}
	if rec == nil {
		return &fs.PathError{Op: "chtimes", Path: name, Err: fs.ErrNotExist}
	}

	rec.modTime = mtime.UnixMilli()
	if err := fsys.putRecord(rec); err != nil {
		return &fs.PathError{Op: "chtimes", Path: name, Err: err}
	}
	return nil
}

func (fsys *FS) Chmod(name string, mode fs.FileMode) error {
	if !fs.ValidPath(name) {
		return &fs.PathError{Op: "chmod", Path: name, Err: fs.ErrNotExist}
	}

	fsys.mu.Lock()
	defer fsys.mu.Unlock()

	name = path.Clean(name)
	rec, err := fsys.getRecord(name)
	if err != nil {
		return &fs.PathError{Op: "chmod", Path: name, Err: err}
	}
	if rec == nil {
		return &fs.PathError{Op: "chmod", Path: name, Err: fs.ErrNotExist}
	}

	rec.mode = uint32(mode)
	if err := fsys.putRecord(rec); err != nil {
		return &fs.PathError{Op: "chmod", Path: name, Err: err}
	}
	return nil
}

func (fsys *FS) Remove(name string) error {
	if !fs.ValidPath(name) {
		return &fs.PathError{Op: "remove", Path: name, Err: fs.ErrNotExist}
	}

	fsys.mu.Lock()
	defer fsys.mu.Unlock()

	name = path.Clean(name)
	if name == "." {
		return &fs.PathError{Op: "remove", Path: name, Err: fs.ErrInvalid}
	}

	rec, err := fsys.getRecord(name)
	if err != nil {
		return &fs.PathError{Op: "remove", Path: name, Err: err}
	}
	if rec == nil {
		return &fs.PathError{Op: "remove", Path: name, Err: fs.ErrNotExist}
	}

	// Check directory is empty
	if rec.isDir {
		paths, err := fsys.getAllPaths()
		if err != nil {
			return &fs.PathError{Op: "remove", Path: name, Err: err}
		}
		prefix := name + "/"
		for _, p := range paths {
			if strings.HasPrefix(p, prefix) {
				return &fs.PathError{Op: "remove", Path: name, Err: fs.ErrNotEmpty}
			}
		}
	}

	return fsys.deleteRecord(name)
}

func (fsys *FS) RemoveAll(name string) error {
	if !fs.ValidPath(name) {
		return &fs.PathError{Op: "removeall", Path: name, Err: fs.ErrNotExist}
	}

	fsys.mu.Lock()
	defer fsys.mu.Unlock()

	name = path.Clean(name)
	if name == "." {
		// Clear everything
		paths, err := fsys.getAllPaths()
		if err != nil {
			return err
		}
		for _, p := range paths {
			if err := fsys.deleteRecord(p); err != nil {
				return err
			}
		}
		return nil
	}

	return fsys.deleteByPrefix(name + "/")
}

func (fsys *FS) Rename(oldname, newname string) error {
	if !fs.ValidPath(oldname) || !fs.ValidPath(newname) {
		return &fs.PathError{Op: "rename", Path: oldname, Err: fs.ErrInvalid}
	}
	if oldname == newname {
		return nil
	}

	fsys.mu.Lock()
	defer fsys.mu.Unlock()

	oldname = path.Clean(oldname)
	newname = path.Clean(newname)

	oldRec, err := fsys.getRecord(oldname)
	if err != nil {
		return &fs.PathError{Op: "rename", Path: oldname, Err: err}
	}
	if oldRec == nil {
		return &fs.PathError{Op: "rename", Path: oldname, Err: fs.ErrNotExist}
	}

	if oldRec.isDir {
		// Rename directory and all children
		oldPrefix := oldname + "/"
		paths, err := fsys.getAllPaths()
		if err != nil {
			return &fs.PathError{Op: "rename", Path: oldname, Err: err}
		}
		for _, p := range paths {
			if p == oldname || strings.HasPrefix(p, oldPrefix) {
				newPath := newname + strings.TrimPrefix(p, oldname)
				if p == oldname {
					newPath = newname
				}
				rec, err := fsys.getRecord(p)
				if err != nil {
					return &fs.PathError{Op: "rename", Path: p, Err: err}
				}
				if rec != nil {
					rec.path = newPath
					if err := fsys.putRecord(rec); err != nil {
						return &fs.PathError{Op: "rename", Path: p, Err: err}
					}
					if p != newPath {
						if err := fsys.deleteRecord(p); err != nil {
							return &fs.PathError{Op: "rename", Path: p, Err: err}
						}
					}
				}
			}
		}
	} else {
		// Rename file
		oldRec.path = newname
		if err := fsys.putRecord(oldRec); err != nil {
			return &fs.PathError{Op: "rename", Path: oldname, Err: err}
		}
		if err := fsys.deleteRecord(oldname); err != nil {
			return &fs.PathError{Op: "rename", Path: oldname, Err: err}
		}
	}

	return nil
}

func (fsys *FS) Truncate(name string, size int64) error {
	if !fs.ValidPath(name) {
		return &fs.PathError{Op: "truncate", Path: name, Err: fs.ErrNotExist}
	}

	fsys.mu.Lock()
	defer fsys.mu.Unlock()

	name = path.Clean(name)

	rec, err := fsys.getRecord(name)
	if err != nil {
		return &fs.PathError{Op: "truncate", Path: name, Err: err}
	}
	if rec == nil {
		return &fs.PathError{Op: "truncate", Path: name, Err: fs.ErrNotExist}
	}
	if rec.isDir {
		return &fs.PathError{Op: "truncate", Path: name, Err: errors.New("is a directory")}
	}

	if size < 0 {
		return &fs.PathError{Op: "truncate", Path: name, Err: fs.ErrInvalid}
	}

	if size == int64(len(rec.data)) {
		return nil
	}

	var newData []byte
	if size > int64(len(rec.data)) {
		newData = make([]byte, size)
		copy(newData, rec.data)
	} else {
		newData = rec.data[:size]
	}

	rec.data = newData
	rec.modTime = time.Now().UnixMilli()
	return fsys.putRecord(rec)
}

func (fsys *FS) Symlink(oldname, newname string) error {
	if !fs.ValidPath(newname) {
		return &fs.PathError{Op: "symlink", Path: newname, Err: fs.ErrNotExist}
	}

	fsys.mu.Lock()
	defer fsys.mu.Unlock()

	newname = path.Clean(newname)
	if newname == "." {
		return &fs.PathError{Op: "symlink", Path: newname, Err: fs.ErrInvalid}
	}

	rec, err := fsys.getRecord(newname)
	if err != nil {
		return &fs.PathError{Op: "symlink", Path: newname, Err: err}
	}
	if rec != nil {
		return &fs.PathError{Op: "symlink", Path: newname, Err: fs.ErrExist}
	}

	return fsys.putRecord(&record{
		path:          newname,
		mode:          uint32(0777),
		modTime:       time.Now().UnixMilli(),
		symlinkTarget: oldname,
	})
}

func (fsys *FS) Readlink(name string) (string, error) {
	if !fs.ValidPath(name) {
		return "", &fs.PathError{Op: "readlink", Path: name, Err: fs.ErrNotExist}
	}

	fsys.mu.Lock()
	defer fsys.mu.Unlock()

	name = path.Clean(name)
	rec, err := fsys.getRecord(name)
	if err != nil {
		return "", &fs.PathError{Op: "readlink", Path: name, Err: err}
	}
	if rec == nil {
		return "", &fs.PathError{Op: "readlink", Path: name, Err: fs.ErrNotExist}
	}
	if rec.symlinkTarget == "" {
		return "", &fs.PathError{Op: "readlink", Path: name, Err: errors.New("not a symlink")}
	}
	return rec.symlinkTarget, nil
}

// openDir opens a directory and returns a dirFile.
func (fsys *FS) openDir(name string) (fs.File, error) {
	entries, err := fsys.readDirLocked(name)
	if err != nil {
		return nil, err
	}
	return fskit.DirFile(fskit.Entry(path.Base(name), fs.ModeDir|0755), entries...), nil
}

// openForRead opens a file for reading.
func (fsys *FS) openForRead(name string) (fs.File, error) {
	if name == "." {
		return fsys.openDir(".")
	}

	rec, err := fsys.getRecord(name)
	if err != nil {
		return nil, &fs.PathError{Op: "open", Path: name, Err: err}
	}

	if rec != nil {
		if rec.isDir {
			return fsys.openDir(name)
		}
		f, err := fsys.openFile(rec)
		if err != nil {
			return nil, &fs.PathError{Op: "open", Path: name, Err: err}
		}
		return f, nil
	}

	// Check implicit directory
	paths, err := fsys.getAllPaths()
	if err != nil {
		return nil, &fs.PathError{Op: "open", Path: name, Err: err}
	}

	prefix := name + "/"
	for _, p := range paths {
		if strings.HasPrefix(p, prefix) {
			return fsys.openDir(name)
		}
	}

	return nil, &fs.PathError{Op: "open", Path: name, Err: fs.ErrNotExist}
}

// openFile returns a read-only file for a record.
func (fsys *FS) openFile(rec *record) (fs.File, error) {
	node := fskit.RawNode(rec, bytes.NewReader(rec.data))
	return node.Open(".")
}

// writableFile implements fs.File for writing to IndexedDB.
type writableFile struct {
	fsys   *FS
	name   string
	data   []byte
	offset int64
	dirty  bool
	append bool
	mode   fs.FileMode
	closed bool
	mu     sync.Mutex
}

var _ fs.File = (*writableFile)(nil)

func (f *writableFile) Stat() (fs.FileInfo, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	return &idbFileInfo{
		name: path.Base(f.name),
		size: int64(len(f.data)),
		mode: f.mode,
	}, nil
}

func (f *writableFile) Read(p []byte) (int, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.offset >= int64(len(f.data)) {
		return 0, io.EOF
	}
	n := copy(p, f.data[f.offset:])
	f.offset += int64(n)
	return n, nil
}

func (f *writableFile) Write(p []byte) (int, error) {
	f.mu.Lock()
	defer f.mu.Unlock()

	if f.closed {
		return 0, fs.ErrClosed
	}

	if f.append {
		f.data = append(f.data, p...)
		f.offset = int64(len(f.data))
	} else {
		end := f.offset + int64(len(p))
		if end > int64(len(f.data)) {
			newData := make([]byte, end)
			copy(newData, f.data)
			f.data = newData
		}
		copy(f.data[f.offset:], p)
		f.offset = end
	}

	f.dirty = true
	return len(p), nil
}

func (f *writableFile) ReadAt(p []byte, off int64) (int, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if off >= int64(len(f.data)) {
		return 0, io.EOF
	}
	n := copy(p, f.data[off:])
	if n < len(p) {
		return n, io.EOF
	}
	return n, nil
}

func (f *writableFile) WriteAt(p []byte, off int64) (int, error) {
	f.mu.Lock()
	defer f.mu.Unlock()

	if f.closed {
		return 0, fs.ErrClosed
	}

	end := off + int64(len(p))
	if end > int64(len(f.data)) {
		newData := make([]byte, end)
		copy(newData, f.data)
		f.data = newData
	}
	copy(f.data[off:], p)
	f.dirty = true
	return len(p), nil
}

func (f *writableFile) Seek(offset int64, whence int) (int64, error) {
	f.mu.Lock()
	defer f.mu.Unlock()

	var newOffset int64
	switch whence {
	case 0:
		newOffset = offset
	case 1:
		newOffset = f.offset + offset
	case 2:
		newOffset = int64(len(f.data)) + offset
	}
	if newOffset < 0 {
		return 0, fs.ErrInvalid
	}
	f.offset = newOffset
	return newOffset, nil
}

func (f *writableFile) Close() error {
	f.mu.Lock()
	defer f.mu.Unlock()

	if f.closed {
		return fs.ErrClosed
	}

	if f.dirty {
		log.Printf("[idbfs] writableFile.Close: flushing %q (%d bytes)\n", f.name, len(f.data))
		rec := &record{
			path:    f.name,
			data:    f.data,
			mode:    uint32(f.mode),
			modTime: time.Now().UnixMilli(),
			isDir:   false,
		}
		fsys := f.fsys
		fsys.mu.Lock()
		err := fsys.putRecord(rec)
		fsys.mu.Unlock()
		if err != nil {
			return err
		}
	}

	f.closed = true
	return nil
}

// idbFileInfo implements fs.FileInfo for an IndexedDB record.
type idbFileInfo struct {
	name   string
	size   int64
	mode   fs.FileMode
	mtime  time.Time
}

var _ fs.FileInfo = (*idbFileInfo)(nil)

func (fi *idbFileInfo) Name() string      { return fi.name }
func (fi *idbFileInfo) Size() int64       { return fi.size }
func (fi *idbFileInfo) Mode() fs.FileMode { return fi.mode }
func (fi *idbFileInfo) ModTime() time.Time {
	if fi.mtime.IsZero() {
		return time.Time{}
	}
	return fi.mtime
}
func (fi *idbFileInfo) IsDir() bool  { return fi.mode&fs.ModeDir != 0 }
func (fi *idbFileInfo) Sys() any     { return nil }

func recordToInfo(r *record) fs.FileInfo {
	mode := fs.FileMode(r.mode)
	if r.isDir {
		mode |= fs.ModeDir
	}
	if r.symlinkTarget != "" {
		mode |= fs.ModeSymlink
	}
	return &idbFileInfo{
		name:  path.Base(r.path),
		size:  int64(len(r.data)),
		mode:  mode,
		mtime: time.UnixMilli(r.modTime),
	}
}

// bytesToJSValue converts a Go byte slice to a JS Uint8Array.
func bytesToJSValue(b []byte) js.Value {
	if len(b) == 0 {
		return js.Global().Get("Uint8Array").New(0)
	}
	arr := js.Global().Get("Uint8Array").New(len(b))
	js.CopyBytesToJS(arr, b)
	return arr
}

// jsValueToBytes converts a JS Uint8Array to a Go byte slice.
func jsValueToBytes(v js.Value) []byte {
	if v.IsUndefined() || v.IsNull() {
		return nil
	}
	arr := js.Global().Get("Uint8Array").New(v)
	b := make([]byte, arr.Length())
	js.CopyBytesToGo(b, arr)
	return b
}
