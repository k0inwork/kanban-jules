import express from "express";
import { createServer as createViteServer } from "vite";
import { createServer as createHttpServer } from "http";
import fs from "fs/promises";
import path from "path";
import { exec } from "child_process";
import util from "util";
import os from "os";
import net from "net";
import { WebSocketServer } from "ws";

const execPromise = util.promisify(exec);

async function startServer() {
  const app = express();
  const PORT = parseInt(process.env.PORT || '3000', 10);

  app.use(express.json());

  // Required for SharedArrayBuffer (WASI worker's sync mechanism)
  app.use((_, res, next) => {
    res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
    res.setHeader("Cross-Origin-Embedder-Policy", "require-corp");
    next();
  });

  // Agent In-Place Implementation
  app.post("/api/mcp/execute", async (req, res) => {
    const { action, params } = req.body;
    
    try {
      let result = "";
      const cwd = process.cwd();

      switch (action) {
        case "list_directory": {
          const dirPath = path.join(cwd, params.path || ".");
          const files = await fs.readdir(dirPath);
          result = files.join("\n");
          break;
        }
        case "read_file": {
          const filePath = path.join(cwd, params.path);
          result = await fs.readFile(filePath, "utf-8");
          break;
        }
        case "write_file": {
          const filePath = path.join(cwd, params.path);
          await fs.writeFile(filePath, params.content, "utf-8");
          result = `Successfully wrote to ${params.path}`;
          break;
        }
        case "clone_repo": {
          const { url, branch, dir } = params;
          const targetDir = path.join(cwd, dir || "workspace");
          const branchFlag = branch ? `-b ${branch}` : "";
          const { stdout, stderr } = await execPromise(`git clone ${branchFlag} ${url} ${targetDir}`, { cwd, timeout: 60000 });
          result = `Successfully cloned ${url} into ${targetDir}.\n${stdout}\n${stderr}`;
          if (!result.trim()) result = `Cloned ${url} successfully.`;
          break;
        }
        case "run_command": {
          // Restricted command execution with timeout
          const { stdout, stderr } = await execPromise(params.command, { cwd, timeout: 15000 });
          result = stdout + (stderr ? `\nSTDERR:\n${stderr}` : "");
          if (!result.trim()) result = "Command executed successfully with no output.";
          break;
        }
        default:
          return res.status(400).json({ error: `Unknown action: ${action}` });
      }

      res.json({ result });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // DEV-ONLY: Host agent endpoint — spawns claude CLI on the host
  // TODO: gate behind process.env.ENABLE_HOST_AGENT === 'true'
  app.post("/api/host/claude", async (req, res) => {
    const { prompt, model, timeout } = req.body;

    if (!prompt) {
      return res.status(400).json({ error: "prompt is required" });
    }

    try {
      const args = [
        "-p", prompt,
        "--output-format", "json",
        "--model", model || "sonnet",
        "--dangerously-skip-permissions",
        "--no-session-persistence",
      ];

      const agentCwd = os.homedir() + '/opencluade';
      console.log(`[host/claude] Spawning agent in ${agentCwd}: "${prompt.slice(0, 80)}..."`);

      const { stdout, stderr } = await execPromise(
        `claude ${args.map(a => `'${a.replace(/'/g, "'\\''")}'`).join(' ')}`,
        {
          cwd: agentCwd,
          timeout: Math.min(timeout || 300000, 600000),
          maxBuffer: 10 * 1024 * 1024,
          env: { ...process.env, FORCE_COLOR: "0" },
        }
      );

      console.log(`[host/claude] Agent finished, ${stdout.length} bytes`);
      res.json({ stdout: stdout || "", stderr: stderr || "", exitCode: 0 });
    } catch (error: any) {
      const killed = error.killed;
      console.warn(`[host/claude] Agent failed:`, error.message);
      res.json({
        stdout: error.stdout || "",
        stderr: error.stderr || "",
        exitCode: killed ? -1 : (typeof error.code === "number" ? error.code : 1),
        error: killed ? `Agent timed out after ${timeout || 300000}ms` : error.message,
      });
    }
  });

  // HTTP proxy for v86 VM network relay
  // v86's fetch adapter calls this with cors_proxy prefix, e.g.:
  //   GET /proxy?url=http%3A%2F%2Fexample.com%2Fpath
  // We fetch server-side and pipe the response back, bypassing CORS/browser restrictions
  app.all("/proxy", async (req, res) => {
    const targetUrl = req.query.url as string;
    if (!targetUrl) {
      return res.status(400).send("Missing ?url= parameter");
    }

    try {
      const headers: Record<string, string> = {};
      // Forward relevant headers from the original request
      const forwardHeaders = ["content-type", "authorization", "accept", "user-agent"];
      for (const h of forwardHeaders) {
        if (req.headers[h]) headers[h] = req.headers[h] as string;
      }

      // Auto-upgrade HTTP to HTTPS for known sites (so VM can use http:// URLs)
      let fetchUrl = targetUrl;
      if (fetchUrl.startsWith("http://")) {
        fetchUrl = fetchUrl.replace("http://", "https://");
      }

      const resp = await fetch(fetchUrl, {
        method: req.method,
        headers,
        body: ["GET", "HEAD"].includes(req.method) ? undefined : JSON.stringify(req.body),
        redirect: "follow",
      });

      // Forward response headers
      resp.headers.forEach((value, key) => {
        const lower = key.toLowerCase();
        // Skip hop-by-hop headers and ones that break streaming
        if (!["content-encoding", "transfer-encoding", "content-length", "keep-alive"].includes(lower)) {
          res.setHeader(key, value);
        }
      });
      res.setHeader("x-proxy-source", "node");

      res.status(resp.status);
      if (resp.body) {
        const reader = resp.body.getReader();
        const pump = async () => {
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            res.write(value);
          }
          res.end();
        };
        await pump();
      } else {
        const buf = await resp.arrayBuffer();
        res.send(Buffer.from(buf));
      }
    } catch (error: any) {
      console.error("[proxy] fetch failed:", targetUrl, error.message);
      res.status(502).send(`Proxy fetch failed: ${error.message}`);
    }
  });

  // Create HTTP server manually so we control WebSocket upgrades
  const httpServer = createHttpServer(app);

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true, hmr: { server: httpServer } },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  // WISP relay: bridge v86 VM TCP connections over WebSocket
  const wispWss = new WebSocketServer({ noServer: true });

  httpServer.on("upgrade", (req, socket, head) => {
    const url = req.url || "";
    if (!url.startsWith("/wisp")) return;

    wispWss.handleUpgrade(req, socket, head, (ws) => {
      console.log("[wisp] client connected");

      const streams = new Map<number, net.Socket>();

      // Send initial CONTINUE to stream 0 to unblock client congestion control
      const initContinue = Buffer.alloc(9);
      initContinue[0] = 3; // CONTINUE
      initContinue.writeUInt32LE(0, 1); // stream 0
      initContinue.writeUInt32LE(65536, 5); // buffer size
      ws.send(initContinue);

      function sendWispData(streamId: number, payload: Buffer) {
        const frame = Buffer.alloc(5 + payload.length);
        frame[0] = 2; // DATA
        frame.writeUInt32LE(streamId, 1);
        payload.copy(frame, 5);
        ws.send(frame);
      }

      function sendWispClose(streamId: number, reason: number) {
        const frame = Buffer.alloc(6);
        frame[0] = 4; // CLOSE
        frame.writeUInt32LE(streamId, 1);
        frame[5] = reason;
        ws.send(frame);
        const sock = streams.get(streamId);
        if (sock) { sock.destroy(); streams.delete(streamId); }
      }

      function sendWispContinue(streamId: number, bufferSize: number) {
        const frame = Buffer.alloc(9);
        frame[0] = 3; // CONTINUE
        frame.writeUInt32LE(streamId, 1);
        frame.writeUInt32LE(bufferSize, 5);
        ws.send(frame);
      }

      ws.on("message", (data: Buffer) => {
        if (data.length < 5) return;
        const ptype = data[0];
        const streamId = data.readUInt32LE(1);

        switch (ptype) {
          case 1: { // CONNECT
            const port = data.readUInt16LE(6);
            const hostname = data.slice(8).toString("utf8");
            console.log(`[wisp] CONNECT stream=${streamId} ${hostname}:${port}`);

            const sock = net.createConnection({ host: hostname, port }, () => {
              console.log(`[wisp] connected stream=${streamId} ${hostname}:${port}`);
              // Tell client this stream can send data
              sendWispContinue(streamId, 65536);
            });

            sock.on("data", (chunk) => {
              sendWispData(streamId, chunk);
            });

            sock.on("close", () => {
              console.log(`[wisp] remote closed stream=${streamId}`);
              sendWispClose(streamId, 2);
            });

            sock.on("error", (err) => {
              console.error(`[wisp] socket error stream=${streamId}:`, err.message);
              sendWispClose(streamId, 2);
            });

            streams.set(streamId, sock);
            break;
          }
          case 2: { // DATA
            const sock = streams.get(streamId);
            if (sock && !sock.destroyed) {
              sock.write(data.slice(5));
            }
            break;
          }
          case 4: { // CLOSE
            const sock = streams.get(streamId);
            if (sock) {
              sock.destroy();
              streams.delete(streamId);
              console.log(`[wisp] CLOSE stream=${streamId}`);
            }
            break;
          }
        }
      });

      ws.on("close", () => {
        console.log("[wisp] client disconnected, cleaning up", streams.size, "streams");
        for (const [id, sock] of streams) {
          sock.destroy();
        }
        streams.clear();
      });

      ws.on("error", (err) => {
        console.error("[wisp] ws error:", err.message);
      });
    });
  });

  httpServer.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
