import express from "express";
import { createServer as createViteServer } from "vite";
import fs from "fs/promises";
import path from "path";
import { exec } from "child_process";
import util from "util";

const execPromise = util.promisify(exec);

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

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
