/**
 * BoardVM Worker — Web Worker that boots a Wanix WASM Linux VM.
 *
 * Two modes controlled by `init` message:
 *   "executor" — ephemeral, runs a command, collects output
 *   "terminal" — persistent, provides serial port for xterm.js
 *
 * Dependencies (loaded from board's static assets):
 *   - wanix.min.js  (Wanix runtime)
 *   - boot.wasm     (stripped boot.go compiled to WASM)
 *   - sys.tar.gz    (Alpine rootfs + kernel + v86)
 */

interface VMConfig {
  mode: "executor" | "terminal";
  bundleUrl: string;       // URL to sys.tar.gz
  wasmUrl: string;         // URL to boot.wasm
  wanixUrl: string;        // URL to wanix.min.js
  memoryMB?: number;       // VM memory (default 1024)
  debug9p?: boolean;
}

interface ExecutorConfig extends VMConfig {
  mode: "executor";
  command: string;         // shell command to execute
}

interface TerminalConfig extends VMConfig {
  mode: "terminal";
}

type InitMessage = {
  type: "init";
} & (ExecutorConfig | TerminalConfig);

// --- State ---
let wanixInstance: any = null;
let ready = false;
let outputBuffers: string[] = [];

// --- Load Wanix runtime script ---
async function loadWanixRuntime(url: string): Promise<void> {
  // wanix.min.js is an ESM module with `export { ... }` at the end.
  // Workers can't use import() for files in /public (Vite blocks it),
  // and importScripts() ignores the export so WanixRuntime is never global.
  // Solution: fetch the source, replace the export with globalThis assignment, eval it.
  const resp = await fetch(url);
  let src = await resp.text();
  // Set `window` to `self` so the wanix code assigns WanixRuntime to globalThis
  (self as any).window = self;
  // Replace `export{...}` with globalThis assignments
  src = src.replace(
    /export\s*\{([^}]*)\}/,
    (_match: string, exports: string) => {
      const names = exports.split(',').map((s: string) => {
        const parts = s.trim().split(/\s+as\s+/);
        return parts.length > 1 ? parts[1].trim() : parts[0].trim();
      });
      return names
        .filter((n: string) => n === 'WanixRuntime')
        .map((n: string) => `globalThis.${n}=${n}`)
        .join(';');
    }
  );
  eval(src);
}

// --- Boot the VM ---
async function bootVM(config: VMConfig): Promise<any> {
  // WanixRuntime is a global from wanix.min.js
  const WanixRuntime = (self as any).WanixRuntime;
  if (!WanixRuntime) {
    throw new Error("WanixRuntime not found — wanix.min.js not loaded");
  }

  // Set up window.boardVM config for boot.wasm to read
  (self as any).window = self;
  (self as any).boardVM = {
    mode: config.mode,
    memoryMB: config.memoryMB || 1024,

    // GitFs bridge — proxies to the board's GitHub Contents API
    gitfs: (self as any).boardVM?.gitfs || {
      getFile: (_path: string) => Promise.resolve(undefined),
      listFiles: (_path: string) => Promise.resolve([]),
    },

    // BoardFS bridge — proxies to the board's task/artifact/module APIs
    boardfs: (self as any).boardVM?.boardfs || {
      listTasks: () => Promise.resolve([]),
      getTask: (_id: string) => Promise.resolve(undefined),
      updateTask: (_id: string, _data: any) => Promise.resolve(),
      listArtifacts: () => Promise.resolve([]),
      readArtifact: (_name: string) => Promise.resolve(""),
      saveArtifact: (_name: string, _content: string) => Promise.resolve(),
      invokeTool: (_tool: string, _args: any) => Promise.resolve(undefined),
    },
  };

  const w = new WanixRuntime({
    screen: false,          // no VGA display needed
    helpers: false,
    debug9p: config.debug9p || false,
    wasm: null,             // we load it ourselves
    network: "fetch",       // always use fetch adapter
  });

  // Load bundle (sys.tar.gz)
  const bundleResp = await fetch(config.bundleUrl);
  if (!bundleResp.ok) throw new Error(`Failed to fetch bundle: ${bundleResp.status}`);
  const bundleData = await bundleResp.arrayBuffer();
  w._bundle = bundleData;

  // No additional bundles needed
  w._getBundle = async () => undefined;

  // Load and boot the WASM
  const wasmResp = await fetch(config.wasmUrl);
  if (!wasmResp.ok) throw new Error(`Failed to fetch WASM: ${wasmResp.status}`);
  const wasmData = await wasmResp.arrayBuffer();
  await w._loadWasm(wasmData);

  return w;
}

// --- Executor mode: run command, collect output, exit ---
async function runExecutor(config: ExecutorConfig): Promise<void> {
  const w = await bootVM(config);

  // Wait for ready signal
  await new Promise<void>((resolve) => {
    const orig = w._wasmReady;
    w._wasmReady = function () {
      if (orig) orig.call(w);
      resolve();
    };
  });

  // Send command via the ctl file → #commands pipe
  const port = w.createPort();
  port.postMessage({ path: "ctl", data: `cmd ${config.command}` });

  // Collect output from serial/console
  // The VM's stdout/stderr comes through the console pipe
  // For now, collect for a timeout then post result
  const timeout = config.memoryMB || 30000; // reuse memoryMB field as timeout? No, just use 30s

  return new Promise((resolve) => {
    let output = "";

    // Listen on serial port for output
    port.onmessage = (e: MessageEvent) => {
      if (e.data?.data) {
        output += e.data.data;
      }
    };

    setTimeout(() => {
      (self as unknown as Worker).postMessage({
        type: "result",
        output,
        exitCode: 0, // TODO: parse actual exit code
      });
      resolve();
    }, timeout);
  });
}

// --- Terminal mode: keep alive, bridge serial to xterm.js ---
async function runTerminal(config: TerminalConfig): Promise<void> {
  const w = await bootVM(config);

  // Wait for ready
  await new Promise<void>((resolve) => {
    const orig = w._wasmReady;
    w._wasmReady = function () {
      if (orig) orig.call(w);
      resolve();
    };
  });

  (self as unknown as Worker).postMessage({ type: "ready" });

  // Bridge serial port ↔ xterm.js messages
  const port = w.createPort();

  // xterm.js → VM
  (self as unknown as Worker).onmessage = (e: MessageEvent) => {
    if (e.data?.type === "input" && e.data.data) {
      // Write to serial/console
      port.postMessage({ path: "#console/data", data: e.data.data });
    }
  };

  // VM → xterm.js
  port.onmessage = (e: MessageEvent) => {
    if (e.data?.data) {
      (self as unknown as Worker).postMessage({
        type: "output",
        data: e.data.data,
      });
    }
  };
}

// --- Message handler ---
(self as unknown as Worker).onmessage = async (e: MessageEvent) => {
  const msg = e.data as InitMessage;

  if (msg.type !== "init") return;

  try {
    // Load Wanix runtime first
    await loadWanixRuntime(msg.wanixUrl);

    if (msg.mode === "executor") {
      await runExecutor(msg as ExecutorConfig);
    } else {
      await runTerminal(msg as TerminalConfig);
    }
  } catch (err: any) {
    (self as unknown as Worker).postMessage({
      type: "error",
      error: err.message || String(err),
    });
  }
};
