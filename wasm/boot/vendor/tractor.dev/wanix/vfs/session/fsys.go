package session

import (
	"bytes"
	"context"
	"fmt"
	iofs "io/fs"
	"sync"

	"tractor.dev/wanix/fs"
	"tractor.dev/wanix/fs/fskit"
	"tractor.dev/wanix/vfs"
	"tractor.dev/wanix/vfs/pipe"
)

// SessionFS manages named pipe pairs for terminal sessions.
// Each session gets a directory with "in", "out", and "response" files.
//
// Layout:
//
//	/sessions/
//	├── 0/
//	│   ├── in       (pipe: JS writes, mux reads)
//	│   ├── out      (pipe: mux writes, JS reads)
//	│   └── response (buffer: JS writes reply, mux reads+clears)
//	├── 1/
//	│   ├── in
//	│   └── out
type SessionFS struct {
	mu       sync.Mutex
	sessions map[int]*sessionEntry
}

type sessionEntry struct {
	pipeFS  iofs.FS
	inFile  *pipe.PortFile // JS→mux pipe end
	outFile *pipe.PortFile // mux→JS pipe end
	respBuf *bytes.Buffer  // response buffer: JS writes, mux reads+clears
	respMu  sync.Mutex
}

// respFile wraps a bytes.Buffer as an fs.File for the response channel.
// Read returns and clears available data. Write appends.
type respFile struct {
	entry *sessionEntry
	name  string
}

func (r *respFile) Close() error { return nil }

func (r *respFile) Read(p []byte) (int, error) {
	r.entry.respMu.Lock()
	defer r.entry.respMu.Unlock()
	if r.entry.respBuf.Len() == 0 {
		return 0, nil
	}
	n, err := r.entry.respBuf.Read(p)
	// If we read everything, reset the buffer
	if r.entry.respBuf.Len() == 0 {
		r.entry.respBuf.Reset()
	}
	return n, err
}

func (r *respFile) Write(p []byte) (int, error) {
	r.entry.respMu.Lock()
	defer r.entry.respMu.Unlock()
	return r.entry.respBuf.Write(p)
}

func (r *respFile) Stat() (iofs.FileInfo, error) {
	r.entry.respMu.Lock()
	defer r.entry.respMu.Unlock()
	return fskit.Entry(r.name, 0644, int64(r.entry.respBuf.Len())), nil
}

func (r *respFile) ReadAt(p []byte, off int64) (int, error) {
	return r.Read(p)
}

func (r *respFile) WriteAt(p []byte, off int64) (int, error) {
	return r.Write(p)
}

func (r *respFile) Seek(offset int64, whence int) (int64, error) {
	return 0, nil
}

// NewFS creates a new SessionFS.
func NewFS() *SessionFS {
	return &SessionFS{
		sessions: make(map[int]*sessionEntry),
	}
}

// Create adds a new session pipe pair and returns the filesystem.
func (s *SessionFS) Create(id int) (iofs.FS, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	if _, exists := s.sessions[id]; exists {
		return nil, fmt.Errorf("session %d already exists", id)
	}

	pfs, inFile, outFile := pipe.NewFS(false)
	s.sessions[id] = &sessionEntry{
		pipeFS:  pfs,
		inFile:  inFile,
		outFile: outFile,
		respBuf: &bytes.Buffer{},
	}
	return pfs, nil
}

// Remove tears down a session pipe pair.
func (s *SessionFS) Remove(id int) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	entry, exists := s.sessions[id]
	if !exists {
		return fmt.Errorf("session %d not found", id)
	}
	entry.inFile.Port.Close()
	entry.outFile.Port.Close()
	delete(s.sessions, id)
	return nil
}

// InFile returns the "in" PortFile for a session (JS writes to this).
func (s *SessionFS) InFile(id int) (*pipe.PortFile, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	entry, ok := s.sessions[id]
	if !ok {
		return nil, fmt.Errorf("session %d not found", id)
	}
	return entry.inFile, nil
}

// OutFile returns the "out" PortFile for a session (mux writes to this).
func (s *SessionFS) OutFile(id int) (*pipe.PortFile, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	entry, ok := s.sessions[id]
	if !ok {
		return nil, fmt.Errorf("session %d not found", id)
	}
	return entry.outFile, nil
}

var _ fs.FS = (*SessionFS)(nil)
var _ fs.OpenContextFS = (*SessionFS)(nil)

func (s *SessionFS) Open(name string) (iofs.File, error) {
	return s.OpenContext(context.Background(), name)
}

func (s *SessionFS) OpenContext(ctx context.Context, name string) (iofs.File, error) {
	if !fs.ValidPath(name) {
		return nil, &fs.PathError{Op: "open", Path: name, Err: fs.ErrNotExist}
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	switch name {
	case ".":
		var nodes []fs.DirEntry
		for id := range s.sessions {
			nodes = append(nodes, fskit.Entry(fmt.Sprintf("%d", id), fs.ModeDir|0555))
		}
		return fskit.DirFile(fskit.Entry(".", fs.ModeDir|0555), nodes...), nil
	default:
		entry, err := s.resolvePath(name)
		if err != nil {
			return nil, err
		}
		return entry, nil
	}
}

func (s *SessionFS) resolvePath(name string) (iofs.File, error) {
	parts := splitPath(name)
	if len(parts) == 0 {
		return nil, &fs.PathError{Op: "open", Path: name, Err: fs.ErrNotExist}
	}

	var sessionID int
	if _, err := fmt.Sscanf(parts[0], "%d", &sessionID); err != nil {
		return nil, &fs.PathError{Op: "open", Path: name, Err: fs.ErrNotExist}
	}

	entry, exists := s.sessions[sessionID]
	if !exists {
		return nil, &fs.PathError{Op: "open", Path: name, Err: fs.ErrNotExist}
	}

	if len(parts) == 1 {
		// Session directory listing
		entries := []fs.DirEntry{
			fskit.Entry("in", 0644),
			fskit.Entry("out", 0644),
			fskit.Entry("resp", 0644),
		}
		return fskit.DirFile(
			fskit.Entry(parts[0], fs.ModeDir|0555),
			entries...,
		), nil
	}

	switch parts[1] {
	case "in":
		return entry.inFile, nil
	case "out":
		return entry.outFile, nil
	case "response", "resp":
		return &respFile{entry: entry, name: "resp"}, nil
	default:
		return nil, &fs.PathError{Op: "open", Path: name, Err: fs.ErrNotExist}
	}
}

func splitPath(name string) []string {
	if name == "" || name == "." {
		return nil
	}
	var parts []string
	start := 0
	for i := 0; i < len(name); i++ {
		if name[i] == '/' {
			if i > start {
				parts = append(parts, name[start:i])
			}
			start = i + 1
		}
	}
	if start < len(name) {
		parts = append(parts, name[start:])
	}
	return parts
}

// Allocator allows binding a SessionFS via wanix's BindAllocator pattern.
type Allocator struct {
	fs *SessionFS
}

func NewAllocator() *Allocator {
	return &Allocator{fs: NewFS()}
}

func (a *Allocator) Open(name string) (iofs.File, error) {
	return a.OpenContext(context.Background(), name)
}

func (a *Allocator) OpenContext(ctx context.Context, name string) (iofs.File, error) {
	return fskit.RawNode(name, 0644).OpenContext(ctx, name)
}

func (a *Allocator) BindAllocFS(name string) (iofs.FS, error) {
	return a.fs, nil
}

// FS returns the underlying SessionFS for direct access (e.g. creating sessions).
func (a *Allocator) FS() *SessionFS {
	return a.fs
}

var _ vfs.BindAllocator = (*Allocator)(nil)
