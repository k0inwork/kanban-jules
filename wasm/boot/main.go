//go:build js && wasm

package main

import (
	"archive/tar"
	"bytes"
	"fmt"
	"log"
	"path/filepath"
	"runtime"
	"strings"
	"syscall/js"
	"time"

	"tractor.dev/toolkit-go/engine/cli"
	"tractor.dev/wanix"
	"tractor.dev/wanix/fs"
	"tractor.dev/wanix/fs/cowfs"
	"tractor.dev/wanix/fs/fskit"
	"boardvm/idbfs"
	"tractor.dev/wanix/fs/memfs"
	"tractor.dev/wanix/fs/tarfs"
	"tractor.dev/wanix/vfs/pipe"
	"tractor.dev/wanix/vfs/ramfs"
	"tractor.dev/wanix/vfs/session"
	"tractor.dev/wanix/vm"
	"tractor.dev/wanix/vm/v86/virtio9p"
	"tractor.dev/wanix/web"
	"tractor.dev/wanix/web/api"
	"tractor.dev/wanix/web/jsutil"
	wanixruntime "tractor.dev/wanix/web/runtime"
)

var Version string

func main() {
	mainStart := time.Now()
	log.SetFlags(log.Lshortfile)

	// ---- Config ----
	cfg := js.Global().Get("window").Get("boardVM")
	if cfg.IsUndefined() {
		log.Fatal("boardVM config not found")
	}
	mode := "executor"
	if !cfg.Get("mode").IsUndefined() {
		mode = cfg.Get("mode").String()
	}
	log.Printf("starting board VM in %s mode\n", mode)

	inst := wanixruntime.Instance()

	// ---- Wanix kernel + 9p ----
	k := wanix.New()
	k.AddModule("#web", web.New(k))
	k.AddModule("#vm", vm.New())
	k.AddModule("#pipe", &pipe.Allocator{})
	k.AddModule("#commands", &pipe.Allocator{})
	k.AddModule("#|", &pipe.Allocator{})
	k.AddModule("#ramfs", &ramfs.Allocator{})
	sessionAlloc := session.NewAllocator()
	k.AddModule("#sessions", sessionAlloc)

	root, err := k.NewRoot()
	if err != nil {
		log.Fatal(err)
	}

	// Pre-create session 0 pipe pair so session-mux can open it on boot
	if _, err := sessionAlloc.FS().Create(0); err != nil {
		log.Printf("warning: could not pre-create session 0: %v", err)
	} else {
		log.Println("session 0 pipe pair created")
	}

	debug9p := inst.Get("config").Get("debug9p")
	if debug9p.IsUndefined() {
		debug9p = js.ValueOf(false)
	}
	run9p := virtio9p.Setup(wrapNS(root.Namespace()), inst, debug9p.Bool())

	// ---- Root bindings + Port API ----
	rootBindings := []struct {
		dst string
		src string
	}{
		{"#task", "task"},
		{"#cap", "cap"},
		{"#web", "web"},
		{"#vm", "vm"},
		{"#|", "#console"},
	}
	for _, b := range rootBindings {
		if err := root.Bind(b.dst, b.src); err != nil {
			log.Fatal(err)
		}
	}

	go api.PortResponder(inst.Call("_portConn", inst.Get("_sys").Get("port1")), root)
	inst.Set("createPort", js.FuncOf(func(this js.Value, args []js.Value) any {
		ch := js.Global().Get("MessageChannel").New()
		go api.PortResponder(inst.Call("_portConn", ch.Get("port1")), root)
		return ch.Get("port2")
	}))

	// ---- Load bundle ----
	startTime := time.Now()
	bundleBytes := inst.Get("_bundle")
	if bundleBytes.IsUndefined() {
		log.Fatal("bundle not found")
	}
	if bundleBytes.InstanceOf(js.Global().Get("Promise")) {
		inst.Set("_bundle", jsutil.Await(bundleBytes))
		bundleBytes = inst.Get("_bundle")
	}
	jsBuf := js.Global().Get("Uint8Array").New(bundleBytes)
	b := make([]byte, jsBuf.Length())
	js.CopyBytesToGo(b, jsBuf)
	inst.Set("_bundle", js.Undefined())
	buf := bytes.NewBuffer(b)
	bundleFS := tarfs.From(tar.NewReader(buf))
	if err := root.Namespace().Bind(bundleFS, ".", "#bundle"); err != nil {
		log.Fatal(err)
	}
	if err := root.Bind("#bundle", "bundle"); err != nil {
		log.Fatal(err)
	}
	log.Printf("bundle loaded in %v\n", time.Since(startTime))

	// ---- Environment filesystem ----
	startTime = time.Now()
	envBase, err := fs.Sub(bundleFS, "rootfs")
	if err != nil {
		log.Fatal(err)
	}

	noIdbfs := js.Global().Get("localStorage").Call("getItem", "NOIDBFS").String() == "true"
	if noIdbfs {
		log.Println("NOIDBFS: using memfs overlay instead of idbfs")
		envScratch := memfs.New()
		root.Namespace().Bind(&cowfs.FS{Base: envBase, Overlay: envScratch}, ".", "#env")
	} else {
		envScratch := idbfs.New("wanix-env")
		if err := envScratch.Init(); err != nil {
			log.Fatal(err)
		}
		log.Println("about to bind idbfs to #scratch")
		root.Namespace().Bind(envScratch, ".", "#scratch")
		log.Println("idbfs bound to #scratch")
		root.Namespace().Bind(&cowfs.FS{Base: envBase, Overlay: envScratch}, ".", "#env")
		log.Println("cowfs bound to #env")
	}
	root.Namespace().Bind(fskit.RawNode([]byte(Version+"\n")), ".", "#version")
	log.Printf("env (cow) loaded in %v\n", time.Since(startTime))

	// ---- GitFs: /repo (read-only, both modes) ----
	gitfs := NewGitFs(cfg)
	if err := root.Namespace().Bind(gitfs, ".", "#repo"); err != nil {
		log.Fatal(err)
	}

	// ---- BoardFS: /board (terminal mode only) ----
	if mode == "terminal" {
		boardfs := NewBoardFS(cfg)
		if err := root.Namespace().Bind(boardfs, ".", "#board"); err != nil {
			log.Fatal(err)
		}
	}

	// ---- LLMFS: /llm (both modes) ----
	llmfs := NewLLMFS(cfg)
	if err := root.Namespace().Bind(llmfs, ".", "#llm"); err != nil {
		log.Fatal(err)
	}

	// ---- ToolFS: /tools (both modes) ----
	toolfs := NewToolFS(cfg)
	if err := root.Namespace().Bind(toolfs, ".", "#tools"); err != nil {
		log.Fatal(err)
	}

	// ---- YuanFS: /yuan (both modes) ----
	if cfg.Get("yuan").Truthy() {
		yuanfs := NewYuanFS(cfg)
		if err := root.Namespace().Bind(yuanfs, ".", "#yuan"); err != nil {
			log.Fatal(err)
		}
	}

	// Expose #llm and #tools via mount bindings so WASI tasks can see them
	if err := root.Bind("#llm", "llm"); err != nil {
		log.Fatal(err)
	}
	if err := root.Bind("#tools", "tools"); err != nil {
		log.Fatal(err)
	}
	if err := root.Bind("#yuan", "yuan"); err != nil {
		// non-fatal: yuan is optional
		log.Printf("warning: could not bind #yuan: %v", err)
	}


	// ---- VM boot ----
	vmraw, err := fs.ReadFile(root.Namespace(), "vm/new/default")
	if err != nil {
		log.Fatal(err)
	}
	vmID := strings.TrimSpace(string(vmraw))

	// vmBindings — mirrors appron exactly, no #repo/#board here
	vmBindings := []struct {
		dst string
		src string
	}{
		{"#console/data1", fmt.Sprintf("vm/%s/ttyS0", vmID)},
		{"#ramfs", fmt.Sprintf("vm/%s/fsys/#ramfs", vmID)},
		{"#pipe", fmt.Sprintf("vm/%s/fsys/#pipe", vmID)},
		{"#sessions", fmt.Sprintf("vm/%s/fsys/#sessions", vmID)},
		{"#|", fmt.Sprintf("vm/%s/fsys/#|", vmID)},
		{".", fmt.Sprintf("vm/%s/fsys", vmID)},
		{"#llm", fmt.Sprintf("vm/%s/fsys/#llm", vmID)},
		{"#tools", fmt.Sprintf("vm/%s/fsys/#tools", vmID)},
		{"#env", fmt.Sprintf("vm/%s/fsys", vmID)},
	}
	if cfg.Get("yuan").Truthy() {
		vmBindings = append(vmBindings, struct{ dst, src string }{"#yuan", fmt.Sprintf("vm/%s/fsys/#yuan", vmID)})
	}
	for _, b := range vmBindings {
		if err := root.Bind(b.dst, b.src); err != nil {
			log.Fatal(err)
		}
	}

	// Profile vars
	profile := []string{
		fmt.Sprintf("export BOARD_MODE=%s", mode),
		"export REPO_PATH=/repo",
	}
	profile = append(profile, "")
	if err := fs.WriteFile(root.Namespace(), "#env/etc/profile.d/board-vm.sh", []byte(strings.Join(profile, "\n")), 0644); err != nil {
		log.Printf("warning: could not write board-vm.sh profile: %v", err)
	}

	cmdline := []string{
		"init=/bin/init",
		"console=ttyS0",
		"rw",
		"root=host9p",
		"rootfstype=9p",
		fmt.Sprintf("rootflags=trans=virtio,version=9p2000.L,aname=vm/%s/fsys,cache=none,msize=131072", vmID),
		"mem=1008M",
		"memmap=16M$1008M",
		"loglevel=3",
	}
	ctlcmd := []string{
		"start",
		"-m", "1G",
		"-append", fmt.Sprintf("'%s'", strings.Join(cmdline, " ")),
	}
	// Network via WISP for full TCP tunneling
	wispURL := "wisp://" + js.Global().Get("location").Get("host").String() + "/wisp"
	netdevOpts := "user,type=virtio,relay_url=" + wispURL
	ctlcmd = append(ctlcmd, "-netdev")
	ctlcmd = append(ctlcmd, netdevOpts)

	log.Println("booting vm with wispURL:", wispURL)
	if err := fs.WriteFile(root.Namespace(), fmt.Sprintf("vm/%s/ctl", vmID), []byte(strings.Join(ctlcmd, " ")), 0755); err != nil {
		log.Fatal(err)
	}

	// ---- Control file ----
	setupBundle := func(name string, rw bool) {
		startTime := time.Now()
		bundle := jsutil.Await(inst.Call("_getBundle", name))
		if bundle.IsUndefined() {
			log.Printf("bundle %s not found\n", name)
			return
		}
		jsBuf := js.Global().Get("Uint8Array").New(bundle)
		b := make([]byte, jsBuf.Length())
		js.CopyBytesToGo(b, jsBuf)
		buf := bytes.NewBuffer(b)
		var fsys fs.FS
		if rw {
			runtime.GC()
			rwfs := memfs.New()
			if err := fs.CopyFS(tarfs.From(tar.NewReader(buf)), ".", rwfs, "."); err != nil {
				log.Fatal(err)
			}
			buf.Reset()
			fsys = rwfs
		} else {
			fsys = tarfs.From(tar.NewReader(buf))
		}
		mountname := filepath.Base(name)
		if dot := strings.IndexByte(mountname, '.'); dot != -1 {
			mountname = mountname[:dot]
		}
		if err := root.Namespace().Bind(fsys, ".", "#"+mountname); err != nil {
			log.Fatal(err)
		}
		runtime.GC()
		log.Printf("%s bundle loaded in %v\n", mountname, time.Since(startTime))
	}

	if err := root.Namespace().Bind(wanix.ControlFile(&cli.Command{
		Usage: "ctl",
		Run: func(_ *cli.Context, args []string) {
			log.Println("ctl:", args)
			switch args[0] {
			case "cmd":
				if len(args) < 2 {
					fmt.Println("usage: cmd <cmd>")
					return
				}
				if err := fs.AppendFile(root.Namespace(), "#commands/data", []byte(strings.Join(args[1:], " "))); err != nil {
					log.Fatal(err)
				}

			case "bind":
				if len(args) < 2 {
					fmt.Println("usage: bind <oldname> <newname>")
					return
				}
				if err := root.Bind(args[1], args[2]); err != nil {
					log.Fatal(err)
				}

			case "reload":
				js.Global().Get("location").Call("reload")

			case "bundle":
				if len(args) < 1 {
					fmt.Println("usage: bundle <name>")
					return
				}
				rw := false
				if len(args) > 2 {
					rw = args[2] == "rw"
				}
				setupBundle(fmt.Sprintf("bundles/%s.tar.br", args[1]), rw)

			case "cp":
				if len(args) < 2 {
					fmt.Println("usage: cp <src> <dst>")
					return
				}
				if err := fs.CopyAll(root.Namespace(), args[1], args[2]); err != nil {
					log.Fatal(err)
				}

			case "sync":
				if len(args) < 2 {
					fmt.Println("usage: sync <src> <dst>")
					return
				}
				src := args[1]
				dst := args[2]
				if err := fs.CopyAll(root.Namespace(), src, dst); err != nil {
					log.Fatal(err)
				}
				var toRemove []string
				isRemovedSubpath := func(candidate string) bool {
					for _, parent := range toRemove {
						if parent == candidate {
							return true
						}
						if strings.HasPrefix(candidate, parent+"/") {
							return true
						}
					}
					return false
				}
				fs.WalkDir(root.Namespace(), dst, func(path string, info fs.DirEntry, err error) error {
					if err != nil {
						return nil
					}
					relPath, err := filepath.Rel(dst, path)
					if err != nil || relPath == "." {
						return nil
					}
					srcPath := filepath.Join(src, relPath)
					ok, err := fs.Exists(root.Namespace(), srcPath)
					if err != nil || !ok {
						fullPath := filepath.Join(dst, relPath)
						if !isRemovedSubpath(fullPath) {
							toRemove = append(toRemove, fullPath)
						}
					}
					return nil
				})
				for _, p := range toRemove {
					if err := fs.RemoveAll(root.Namespace(), p); err != nil {
						log.Fatal(err)
					}
				}
			}
		},
	}), ".", "ctl"); err != nil {
		log.Fatal(err)
	}

	// ---- Env buildFS (unconditional, like appron) ----
	var buildScratch fs.FS = memfs.New()
	root.Namespace().Bind(buildScratch, ".", "#envbuild")
	buildBase, err := fs.Sub(bundleFS, "rootfs")
	if err != nil {
		log.Fatal(err)
	}
	if err := root.Namespace().Bind(&cowfs.FS{Base: buildBase, Overlay: buildScratch}, ".", fmt.Sprintf("vm/%s/fsys/apptron/.buildroot", vmID)); err != nil {
		log.Fatal(err)
	}

	// ---- Ready ----
	inst.Call("_wasmReady")
	log.Printf("board VM ready in %v\n", time.Since(mainStart))

	// block on serving 9p
	run9p()
}
