//go:build js && wasm

package main

import (
	"fmt"
	"log"
	"strings"
	"syscall/js"

	"tractor.dev/wanix/fs"
)

// asyncFunc wraps a blocking Go function as a JS Promise via js.FuncOf.
// The blocking work runs in a new goroutine so the JS event loop stays free
// for IDB callbacks (prevents the classic Go-WASM deadlock where sync js.FuncOf
// blocks the JS thread -> IDB onsuccess never fires -> channel blocks forever).
func asyncFunc(fn func(this js.Value, args []js.Value) (any, error)) js.Func {
	return js.FuncOf(func(this js.Value, args []js.Value) any {
		handler := js.Global().Get("Promise").New(js.FuncOf(func(_ js.Value, promiseArgs []js.Value) any {
			resolve := promiseArgs[0]
			reject := promiseArgs[1]
			go func() {
				result, err := fn(this, args)
				if err != nil {
					reject.Invoke(js.Global().Get("Error").New(err.Error()))
				} else {
					resolve.Invoke(result)
				}
			}()
			return nil
		}))
		return handler
	})
}

// RegisterFSBridge exposes filesystem operations on boardVM.fsBridge so that
// the almostnode fs shim can route file_read/file_write/file_edit/glob/grep
// through the real v86 filesystem instead of the in-memory VFS.
//
// All methods return JS Promises because the underlying IDB operations are async
// and must not block the JS event loop (Go WASM deadlock prevention).
func RegisterFSBridge(cfg js.Value, ns *nsWrapper, vmID string) {
	// resolvePath: /home maps 1:1 to v86 /home, /workspace maps to v86 root (legacy).
	resolvePath := func(p string) string {
		// /workspace -> v86 root (legacy)
		if p == "/workspace" || p == "/workspace/" {
			return fmt.Sprintf("vm/%s/fsys", vmID)
		}
		if len(p) > len("/workspace/") && p[:len("/workspace/")] == "/workspace/" {
			return fmt.Sprintf("vm/%s/fsys/%s", vmID, p[len("/workspace/"):])
		}
		// /home -> v86 /home (1:1)
		if p == "/home" || p == "/home/" {
			return fmt.Sprintf("vm/%s/fsys/home", vmID)
		}
		if len(p) > len("/home/") && p[:len("/home/")] == "/home/" {
			return fmt.Sprintf("vm/%s/fsys/home/%s", vmID, p[len("/home/"):])
		}
		return p
	}

	bridge := map[string]any{

		"readFile": asyncFunc(func(_ js.Value, args []js.Value) (any, error) {
			p := resolvePath(args[0].String())
			data, err := fs.ReadFile(ns, p)
			if err != nil {
				return nil, fmt.Errorf("readFile %s: %w", p, err)
			}
			return js.ValueOf(string(data)), nil
		}),

		"stat": asyncFunc(func(_ js.Value, args []js.Value) (any, error) {
			p := resolvePath(args[0].String())
			info, err := fs.Stat(ns, p)
			obj := js.Global().Get("Object").New()
			if err != nil {
				obj.Set("exists", false)
				return obj, nil
			}
			obj.Set("exists", true)
			obj.Set("isDir", info.IsDir())
			obj.Set("size", info.Size())
			obj.Set("mode", int(info.Mode()))
			obj.Set("mtime", info.ModTime().UnixMilli())
			return obj, nil
		}),

		"writeFile": asyncFunc(func(_ js.Value, args []js.Value) (any, error) {
			p := resolvePath(args[0].String())
			data := args[1].String()
			if err := fs.WriteFile(ns, p, []byte(data), 0644); err != nil {
				return nil, fmt.Errorf("writeFile %s: %w", p, err)
			}
			return js.ValueOf(true), nil
		}),

		"mkdir": asyncFunc(func(_ js.Value, args []js.Value) (any, error) {
			p := resolvePath(args[0].String())
			if err := fs.MkdirAll(ns, p, 0755); err != nil {
				return nil, fmt.Errorf("mkdir %s: %w", p, err)
			}
			return js.ValueOf(true), nil
		}),

		"readdir": asyncFunc(func(_ js.Value, args []js.Value) (any, error) {
			p := resolvePath(args[0].String())
			entries, err := fs.ReadDir(ns, p)
			if err != nil {
				return nil, fmt.Errorf("readdir %s: %w", p, err)
			}
			arr := js.Global().Get("Array").New(len(entries))
			for i, e := range entries {
				arr.SetIndex(i, e.Name())
			}
			return arr, nil
		}),

		// exists(path) -> Promise<bool>
		"exists": asyncFunc(func(_ js.Value, args []js.Value) (any, error) {
			p := resolvePath(args[0].String())
			_, err := fs.Stat(ns, p)
			return js.ValueOf(err == nil), nil
		}),

		// rm(path) -> Promise<bool> — removes file or directory tree
		"rm": asyncFunc(func(_ js.Value, args []js.Value) (any, error) {
			p := resolvePath(args[0].String())
			if err := fs.RemoveAll(ns, p); err != nil {
				return nil, fmt.Errorf("rm %s: %w", p, err)
			}
			return js.ValueOf(true), nil
		}),

		// glob(pattern, root, maxResults) -> Promise<[string]>
		// Native Go glob: walks the filesystem in a single goroutine, no per-dir JS round-trips.
		// Supports *, ?, ** (globstar), and {a,b} brace expansion.
		"glob": asyncFunc(func(_ js.Value, args []js.Value) (any, error) {
			globPat := args[0].String()
			root := "/workspace"
			if len(args) > 1 && args[1].String() != "" {
				root = args[1].String()
			}
			maxResults := 100
			if len(args) > 2 && args[2].Int() > 0 {
				maxResults = args[2].Int()
			}
			resolvedRoot := resolvePath(root)
				log.Printf("[fsbridge] glob pat=%q root=%q resolved=%q", globPat, root, resolvedRoot)

				// Build ignore set (skip node_modules, .git, dist, build)
			ignoreDirs := map[string]bool{
				"node_modules": true,
				".git":         true,
				"dist":         true,
				"build":        true,
				".next":        true,
				"coverage":     true,
			}

			var matches []string
			err := fs.WalkDir(ns, resolvedRoot, func(walkPath string, d fs.DirEntry, err error) error {
				if err != nil {
					return nil
				}
				if len(matches) >= maxResults {
					return fs.SkipDir
				}
				// Skip ignored directories entirely
				if d.IsDir() && ignoreDirs[d.Name()] {
					return fs.SkipDir
				}
				// Compute relative path from root
				rel := walkPath[len(resolvedRoot):]
				if len(rel) > 0 && rel[0] == '/' {
					rel = rel[1:]
				}
				if rel == "" {
					return nil
				}
				if !d.IsDir() && globMatch(globPat, rel) {
					matches = append(matches, rel)
				}
				return nil
			})
			if err != nil && err != fs.SkipDir {
				return nil, fmt.Errorf("glob %s: %w", globPat, err)
			}

			arr := js.Global().Get("Array").New(len(matches))
			for i, m := range matches {
				arr.SetIndex(i, m)
			}
			return arr, nil
		}),

		// readdirWithInfo(path) -> Promise<[{name, isDir, size}]>
		"readdirWithInfo": asyncFunc(func(_ js.Value, args []js.Value) (any, error) {
			p := resolvePath(args[0].String())
			entries, err := fs.ReadDir(ns, p)
			if err != nil {
				return nil, fmt.Errorf("readdirWithInfo %s: %w", p, err)
			}
			arr := js.Global().Get("Array").New(len(entries))
			for i, e := range entries {
				obj := js.Global().Get("Object").New()
				obj.Set("name", e.Name())
				obj.Set("isDir", e.IsDir())
				info, infoErr := e.Info()
				if infoErr == nil {
					obj.Set("size", info.Size())
				} else {
					obj.Set("size", 0)
				}
				arr.SetIndex(i, obj)
			}
			return arr, nil
		}),
	}

	cfg.Set("fsBridge", bridge)
	log.Println("[fsbridge] registered on boardVM (async/promises)")
}

// globMatch matches a glob pattern against a path.
// Supports:
//   - * matches any non-separator chars
//   - ? matches a single non-separator char
//   - ** matches zero or more path segments (including /)
//   - {a,b} matches a or b
func globMatch(pattern, name string) bool {
	// Expand braces first: {a,b} -> try "a" and "b"
	if braceStart := strings.Index(pattern, "{"); braceStart >= 0 {
		braceEnd := strings.Index(pattern[braceStart:], "}")
		if braceEnd > 0 {
			braceEnd += braceStart
			prefix := pattern[:braceStart]
			suffix := pattern[braceEnd+1:]
			alternatives := strings.Split(pattern[braceStart+1:braceEnd], ",")
			for _, alt := range alternatives {
				if globMatch(prefix+alt+suffix, name) {
					return true
				}
			}
			return false
		}
	}
	return globMatchSegment(pattern, name)
}

// globMatchSegment does the core matching with *, ?, ** support.
func globMatchSegment(pattern, name string) bool {
	for len(pattern) > 0 || len(name) > 0 {
		if len(pattern) == 0 {
			return len(name) == 0
		}
		// **
		if len(pattern) >= 2 && pattern[:2] == "**" {
			rest := pattern[2:]
			// Skip trailing /
			if len(rest) > 0 && rest[0] == '/' {
				rest = rest[1:]
			}
			// ** matches zero or more segments: try matching rest at every position
			for i := 0; i <= len(name); i++ {
				if globMatchSegment(rest, name[i:]) {
					return true
				}
				// Only split at / boundaries for efficiency
				if i < len(name) && name[i] != '/' {
					continue
				}
			}
			return false
		}
		if len(name) == 0 {
			return false
		}
		switch pattern[0] {
		case '*':
			// * matches any chars within a single segment
			rest := pattern[1:]
			for i := 0; i <= len(name); i++ {
				if i < len(name) && name[i] == '/' {
					break // * does not cross /
				}
				if globMatchSegment(rest, name[i:]) {
					return true
				}
			}
			return false
		case '?':
			if name[0] == '/' {
				return false
			}
			pattern = pattern[1:]
			name = name[1:]
		default:
			if pattern[0] != name[0] {
				return false
			}
			pattern = pattern[1:]
			name = name[1:]
		}
	}
	return true
}

// makeErr returns a JS Error object.
func makeErr(op, p string, err error) js.Value {
	msg := fmt.Sprintf("%s %s: %s", op, p, err.Error())
	return js.Global().Get("Error").New(msg)
}
