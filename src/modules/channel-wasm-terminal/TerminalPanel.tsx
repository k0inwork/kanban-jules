import { useEffect, useRef, useState, useCallback } from 'react';

export const BUILD = 21;

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
    term.loadAddon(fitAddon);
    term.loadAddon(new WebLinksAddon());
    term.open(terminalRef.current);
    fitAddon.fit();
    xtermRef.current = term;

    term.writeln(`\r\n[board VM booting... (build ${BUILD})]\r\n`);

    try {
      // Load WanixRuntime — fetch the ESM module and eval it to extract the export
      // Vite blocks import() for files in /public, so we fetch + eval instead
      const WanixRuntime = await loadWanixRuntime(wanixUrl);

      if (!WanixRuntime) {
        term.writeln('\r\n[error: WanixRuntime not exported from wanix.min.js]\r\n');
        return;
      }

      // Set up boardVM config for boot.wasm to read
      (window as any).boardVM = {
        mode: 'terminal',
        memoryMB: 1024,
        gitfs: {
          getFile: (_path: string) => Promise.resolve(undefined),
          listFiles: (_path: string) => Promise.resolve([]),
        },
        boardfs: {
          listTasks: () => Promise.resolve([]),
          getTask: (_id: string) => Promise.resolve(undefined),
          updateTask: (_id: string, _data: any) => Promise.resolve(),
          listArtifacts: () => Promise.resolve([]),
          readArtifact: (_name: string) => Promise.resolve(''),
          saveArtifact: (_name: string, _content: string) => Promise.resolve(),
          invokeTool: (_tool: string, _args: any) => Promise.resolve(undefined),
        },
      };

      // Create Wanix runtime instance (no screen, no helpers)
      const w = new WanixRuntime({
        screen: false,
        helpers: false,
        debug9p: false,
        wasm: null,
        network: 'fetch',
      });
      runtimeRef.current = w;

      // Load the sys.tar.gz bundle
      const bundleResp = await fetch(bundleUrl);
      if (!bundleResp.ok) throw new Error(`Failed to fetch bundle: ${bundleResp.status}`);
      const bundleData = await bundleResp.arrayBuffer();
      w._bundle = bundleData;
      w._getBundle = async () => undefined;

      // Wait for WASM ready, then connect serial to xterm
      w.ready().then(async () => {
        term.writeln('\r\n[board VM ready — waiting for console...]\r\n');
        onReady?.();

        try {
          // Wait for the v86 VM to boot and serial to be available.
          await w.waitFor('#console/data', 60000);
          term.writeln('\r\n[console pipe found]\r\n');

          // --- Console output: read from #console/data (pipe Port 1) ---
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

          // Mark ready
          (runtimeRef.current as any)._serialReady = true;
          // Expose send function on window so GUI input bar can call it
          (window as any).__boardSend = (text: string) => {
            const encoded = new TextEncoder().encode(text + '\r');
            return w.appendFile('#console/data', encoded).catch((e: any) => {
              console.error('[TerminalPanel] send error:', e);
            });
          };
          // Raw keystroke send (no \r) for interactive typing
          (window as any).__boardSendRaw = (data: Uint8Array) => {
            return w.appendFile('#console/data', data).catch((e: any) => {
              console.error('[TerminalPanel] sendRaw error:', e);
            });
          };
          setSerialReady(true);
          term.writeln('\r\n[console connected]\r\n');
        } catch (serialErr: any) {
          console.error('[TerminalPanel] console setup error:', serialErr);
          term.writeln(`\r\n[console setup error: ${serialErr.message}]\r\n`);
        }
      });

      // Load and boot the WASM
      const wasmResp = await fetch(wasmUrl);
      if (!wasmResp.ok) throw new Error(`Failed to fetch WASM: ${wasmResp.status}`);
      const wasmData = await wasmResp.arrayBuffer();
      w._loadWasm(wasmData);

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

    // Resize handling
    const onResize = () => fitAddon.fit();
    window.addEventListener('resize', onResize);
  }, [bundleUrl, wasmUrl, wanixUrl, onReady, onOutput]);

  useEffect(() => {
    initTerminal();
    return () => {
      xtermRef.current?.dispose();
    };
  }, [initTerminal]);

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
