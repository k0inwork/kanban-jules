package session

import (
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
// Each session gets a directory with "in" and "out" files.
//
// Layout:
//
//	/sessions/
//	├── 0/
//	│   ├── in      (JS writes, mux reads)
//	│   └── out     (mux writes, JS reads)
//	├── 1/
//	│   ├── in
//	│   └── out
type SessionFS struct {
	mu       sync.Mutex
	sessions map[int]*sessionEntry
}

type sessionEntry struct {
	pipeFS   iofs.FS
	inFile   *pipe.PortFile  // JS→mux end
	outFile  *pipe.PortFile  // mux→JS end
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

	pfs, inFile, outFile := pipe.NewFS(true)
	s.sessions[id] = &sessionEntry{
		pipeFS:  pfs,
		inFile:  inFile,
		outFile: outFile,
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
		// Check if it's a direct session pipe request like "0/in" or "0/out"
		// or a session directory like "0"
		entry, err := s.resolvePath(name)
		if err != nil {
			return nil, err
		}
		return entry, nil
	}
}

func (s *SessionFS) resolvePath(name string) (iofs.File, error) {
	// Parse: "N" (session dir) or "N/in" or "N/out" or "N/status"
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
		return fskit.DirFile(
			fskit.Entry(parts[0], fs.ModeDir|0555),
			fskit.Entry("in", 0644),
			fskit.Entry("out", 0644),
		), nil
	}

	switch parts[1] {
	case "in":
		return entry.inFile, nil
	case "out":
		return entry.outFile, nil
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
