import express from "express";
import { createServer as createViteServer } from "vite";
import fs from "fs/promises";
import path from "path";
import { exec } from "child_process";
import util from "util";
import { mcpManager } from "./src/services/McpClient.ts";

const execPromise = util.promisify(exec);

let isMcpConfigured = false;

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // NotebookLM MCP Setup Route
  app.post("/api/mcp/setup", async (req, res) => {
    const { cookie } = req.body;
    if (!cookie) {
      return res.status(400).json({ error: "Cookie is required" });
    }

    try {
      const cookieFile = path.join(process.cwd(), ".notebooklm-cookies.txt");
      await fs.writeFile(cookieFile, cookie, "utf-8");

      console.log("Setting up NotebookLM authentication...");
      await execPromise(`uvx --from notebooklm-mcp-cli nlm login --manual --file ${cookieFile}`);

      console.log("Connecting NotebookLM MCP server...");
      await mcpManager.connect("uvx", ["--from", "notebooklm-mcp-cli", "notebooklm-mcp"]);

      isMcpConfigured = true;
      res.json({ success: true, message: "NotebookLM MCP successfully connected" });
    } catch (error: any) {
      console.error("MCP Setup error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Get available MCP tools
  app.get("/api/mcp/tools", async (req, res) => {
    if (!isMcpConfigured) return res.json({ tools: [] });
    try {
      const tools = await mcpManager.getTools();
      res.json({ tools });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
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
          if (isMcpConfigured) {
            try {
              // Forward action to NotebookLM MCP
              const mcpRes = await mcpManager.callTool(action, params);
              let toolText = "";
              if (mcpRes.content && Array.isArray(mcpRes.content)) {
                toolText = mcpRes.content.map((c: any) => c.text || JSON.stringify(c)).join("\n");
              } else {
                toolText = JSON.stringify(mcpRes);
              }
              return res.json({ result: toolText });
            } catch (mcpErr: any) {
              return res.status(500).json({ error: `MCP Tool Error: ${mcpErr.message}` });
            }
          }
          return res.status(400).json({ error: `Unknown action: ${action}` });
      }

      res.json({ result });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
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

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
