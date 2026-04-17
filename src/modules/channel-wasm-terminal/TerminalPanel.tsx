import { useEffect, useRef, useState, useCallback } from 'react';

export const BUILD = 37;

/**
 * Early VM boot — starts fetching wanix.min.js and sys.tar.gz bundle
 * immediately when this module is imported (before user clicks terminal tab).
 * The actual WanixRuntime + VM boot happens in parallel with the rest of the app.
 * When TerminalPanel mounts, it just waits for the pre-booted VM and connects xterm.
 */
let vmBootPromise: Promise<any> | null = null;
const termSizeRef = { cols: 120, rows: 40 };

function prebootVM(bundleUrl: string, wanixUrl: string, wasmUrl: string): Promise<any> {
  if (vmBootPromise) return vmBootPromise;

  vmBootPromise = (async () => {
    console.log('[preboot] Starting early VM boot...');

    // 1. Load WanixRuntime
    const WanixRuntime = await loadWanixRuntime(wanixUrl);
    if (!WanixRuntime) throw new Error('WanixRuntime not loaded');

    // 2. Create runtime instance
    const w = new WanixRuntime({
      screen: false,
      helpers: false,
      debug9p: false,
      wasm: null,
      network: 'fetch',
    });

    // 3. Fetch bundle + WASM in parallel
    const [bundleResp, wasmResp] = await Promise.all([
      fetch(bundleUrl),
      fetch(wasmUrl),
    ]);
    if (!bundleResp.ok) throw new Error(`Failed to fetch bundle: ${bundleResp.status}`);
    if (!wasmResp.ok) throw new Error(`Failed to fetch WASM: ${wasmResp.status}`);

    const [bundleData, wasmData] = await Promise.all([
      bundleResp.arrayBuffer(),
      wasmResp.arrayBuffer(),
    ]);

    w._bundle = bundleData;
    w._getBundle = async () => undefined;

    // 4. Load WASM (starts VM boot)
    w._loadWasm(wasmData);

    // 5. Wait for VM to be ready
    await w.ready();
    console.log('[preboot] VM ready');
    return w;
  })();

  return vmBootPromise;
}

// Auto-preboot at module import time with static URLs.
// The VM boots in parallel with React rendering.
prebootVM('/assets/wasm/sys.tar.gz', '/assets/wasm/wanix.min.js', '/assets/wasm/boot.wasm');

/**
 * TerminalPanel — xterm.js terminal connected to a Wanix VM.
 *
 * Runs WanixRuntime in the main thread (it requires `document` for WASM loading).
 * The boot.wasm (Go WASM compiled from wasm/boot/) boots the VM,
 * and serial output is bridged to xterm.js via the Wanix port API.
 *
 * Required WASM assets in public/assets/wasm/:
 *   - wanix.min.js  (Wanix runtime)
 *   - boot.wasm     (Go WASM binary compiled from wasm/boot/)
 *   - sys.tar.gz    (Alpine rootfs + kernel + v86, built via Dockerfile.wasm)
 */
/**
 * Load WanixRuntime from wanix.min.js by injecting a script tag.
 * The wanix.min.js file sets window.WanixRuntime as a side effect.
 * We need to strip the ESM export statement first since <script> tags
 * don't support export.
 */
async function loadWanixRuntime(url: string): Promise<any> {
  // Check if already loaded
  if ((window as any).WanixRuntime) {
    return (window as any).WanixRuntime;
  }

  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    // Use a module script so import/export syntax is valid
    script.type = 'module';
    script.textContent = `
      import { WanixRuntime } from "${url}";
      window.WanixRuntime = WanixRuntime;
      window.dispatchEvent(new Event('wanix-loaded'));
    `;
    window.addEventListener('wanix-loaded', () => {
      resolve((window as any).WanixRuntime);
    }, { once: true });
    document.head.appendChild(script);
    // Fallback: check if it was already set by the side-effect path
    setTimeout(() => {
      if ((window as any).WanixRuntime) {
        resolve((window as any).WanixRuntime);
      } else {
        reject(new Error('WanixRuntime not loaded'));
      }
    }, 5000);
  });
}

interface TerminalPanelProps {
  bundleUrl: string;
  wasmUrl: string;
  wanixUrl: string;
  /** Called when the terminal is ready for input */
  onReady?: () => void;
  /** Called when the terminal produces output */
  onOutput?: (data: string) => void;
}

export function TerminalPanel({ bundleUrl, wasmUrl, wanixUrl, onReady, onOutput }: TerminalPanelProps) {
  const terminalRef = useRef<HTMLDivElement>(null);
  const runtimeRef = useRef<any>(null);
  const xtermRef = useRef<any>(null);
  const fitAddonRef = useRef<any>(null);
  const [cmdInput, setCmdInput] = useState('');
  const [serialReady, setSerialReady] = useState(false);

  const sendCommand = useCallback((text: string) => {
    const fn = (window as any).__boardSend;
    if (fn) fn(text);
  }, []);

  const handleCmdSubmit = useCallback(() => {
    if (!cmdInput.trim()) return;
    sendCommand(cmdInput);
    setCmdInput('');
  }, [cmdInput, sendCommand]);

  const initTerminal = useCallback(async () => {
    if (!terminalRef.current) return;

    // Dynamic imports for xterm.js
    const { Terminal } = await import('@xterm/xterm');
    const { FitAddon } = await import('@xterm/addon-fit');
    const { WebLinksAddon } = await import('@xterm/addon-web-links');
    await import('@xterm/xterm/css/xterm.css');

    const term = new Terminal({
      cursorBlink: true,
      fontSize: 14,
      fontFamily: '"JetBrains Mono", "Fira Code", "Cascadia Code", monospace',
      theme: {
        background: '#1e1e2e',
        foreground: '#cdd6f4',
        cursor: '#f5e0dc',
        selectionBackground: '#585b7066',
      },
    });

    const fitAddon = new FitAddon();
    fitAddonRef.current = fitAddon;
    term.loadAddon(fitAddon);
    term.loadAddon(new WebLinksAddon());
    term.open(terminalRef.current);
    fitAddon.fit();

    xtermRef.current = term;
    (window).__xterm = term; // expose for testing

    // Check if container is visible (has dimensions). When the terminal tab
    // is hidden via display:none, xterm reports 0x0. In that case, skip the
    // size wait and use defaults — the ResizeObserver in the resize handler
    // will send the correct size when the tab becomes visible.
    const containerVisible = terminalRef.current.offsetWidth > 0;
    if (containerVisible) {
      await new Promise<void>((resolve) => {
        const tryFit = (): boolean => {
          fitAddon.fit();
          return term.cols >= 80 && term.rows >= 24;
        };
        if (tryFit()) { resolve(); return; }
        const container = terminalRef.current;
        if (!container) { resolve(); return; }
        const observer = new ResizeObserver(() => {
          if (tryFit()) {
            observer.disconnect();
            resolve();
          }
        });
        observer.observe(container);
      });
    }
    console.log(`[TerminalPanel] Starting terminal (v${BUILD}) cols=${term.cols} rows=${term.rows} visible=${containerVisible}...`);

    try {
      // Update boardVM with terminal dimensions for boot.wasm.
      // The main boardVM object (llmfs, toolfs, yuan, etc.) is set up by
      // BoardVMProvider — we only add/update the terminal-specific properties.
      if (containerVisible) {
        termSizeRef.cols = term.cols;
        termSizeRef.rows = term.rows;
      }
      const bvm = (window as any).boardVM;
      if (bvm) {
        bvm.mode = 'terminal';
        bvm.memoryMB = 1024;
        Object.defineProperty(bvm, 'termCols', { get: () => termSizeRef.cols, configurable: true });
        Object.defineProperty(bvm, 'termRows', { get: () => termSizeRef.rows, configurable: true });
      }

      // Await preboot (runtime + bundle + WASM) — starts if not already running
      const w = await prebootVM(bundleUrl, wanixUrl, wasmUrl);
      runtimeRef.current = w;
      console.log('[TerminalPanel] VM preboot complete, connecting console...');
      onReady?.();

      // Connect serial console
      try {
        await w.waitFor('#console/data', 60000);
        console.log('[TerminalPanel] Console connected');

        const readFd = await w.open('#console/data');
        console.log('[TerminalPanel] read fd:', readFd);

        const decoder = new TextDecoder();

        (async () => {
          try {
            for (;;) {
              const chunk: Uint8Array | null = await w.read(readFd, 4096);
              if (chunk === null) {
                term.writeln('\r\n[console EOF]\r\n');
                break;
              }
              if (chunk.length > 0) {
                const text = decoder.decode(chunk, { stream: true });
                term.write(text);
                onOutput?.(text);
              }
            }
          } catch (e: any) {
            console.error('[TerminalPanel] console read error:', e);
            term.writeln(`\r\n[console read error: ${e.message}]\r\n`);
          }
        })();

        // Expose send functions
        (runtimeRef.current as any)._serialReady = true;
        (window as any).__boardSend = (text: string) => {
          const encoded = new TextEncoder().encode(text + '\r');
          return w.appendFile('#console/data', encoded).catch((e: any) => {
            console.error('[TerminalPanel] send error:', e);
          });
        };
        (window as any).__boardSendRaw = (data: Uint8Array) => {
          return w.appendFile('#console/data', data).catch((e: any) => {
            console.error('[TerminalPanel] sendRaw error:', e);
          });
        };
        setSerialReady(true);

        // Send initial resize to sync xterm dimensions with VM
        // Only when container is visible — otherwise the ResizeObserver
        // handles it when the terminal tab is shown.
        if (containerVisible && term.cols >= 80 && term.rows >= 24) {
          const initSeq = `\x1b[8;${term.rows};${term.cols}t`;
          (window as any).__boardSendRaw(new TextEncoder().encode(initSeq));
          console.log(`[TerminalPanel] sent initial resize: ${term.cols}x${term.rows}`);
        }
      } catch (serialErr: any) {
        console.error('[TerminalPanel] console setup error:', serialErr);
        term.writeln(`\r\n[console setup error: ${serialErr.message}]\r\n`);
      }

      // xterm keystrokes → VM console pipe (via __boardSendRaw)
      term.onData((data: string) => {
        const fn = (window as any).__boardSendRaw;
        if (!fn) return;
        const encoded = new TextEncoder().encode(data);
        fn(encoded);
      });
    } catch (err: any) {
      term.writeln(`\r\n[error: ${err.message || err}]\r\n`);
    }

    // Resize handling: fit xterm AND propagate to VM's VT emulator
    const sendResizeToVM = () => {
      const fn = (window as any).__boardSendRaw;
      if (!fn) return;
      // Send CSI 8;rows;cols t — session-mux intercepts this
      const seq = `\x1b[8;${term.rows};${term.cols}t`;
      fn(new TextEncoder().encode(seq));
    };

    const handleResize = () => {
      try { fitAddon.fit(); } catch {}
      sendResizeToVM();
    };
    window.addEventListener('resize', handleResize);

    // Refit when the container becomes visible (e.g. tab switch)
    const resizeObserver = new ResizeObserver(() => {
      handleResize();
    });
    if (terminalRef.current) {
      resizeObserver.observe(terminalRef.current);
    }
  }, [bundleUrl, wasmUrl, wanixUrl, onReady, onOutput]);

  useEffect(() => {
    initTerminal();
    return () => {
      xtermRef.current?.dispose();
    };
  }, []); // intentionally empty — only init once

  return (
    <div
      ref={terminalRef}
      style={{
        width: '100%',
        height: '100%',
        backgroundColor: '#1e1e2e',
        padding: '4px',
      }}
    />
  );
}

/**
 * Send text to the terminal VM (writes to console pipe).
 */
export function sendToTerminal(runtime: any, text: string) {
  if (runtime?._serialReady) {
    const encoded = new TextEncoder().encode(text + '\r');
    runtime.appendFile('#console/data', encoded);
  }
}
