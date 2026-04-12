/**
 * Headless browser test for the WASI agent inside Wanix.
 *
 * Spins up the dev server, opens a browser, boots Wanix via the terminal,
 * then runs wexec to launch agent.wasm and captures output.
 *
 * Usage: node test-agent.mjs [prompt]
 *
 * Requires: npm install (puppeteer is already in package.json)
 */

import puppeteer from "puppeteer";
import { spawn } from "child_process";
import { setTimeout as sleep } from "timers/promises";

const PROMPT = process.argv[2] || "list the tasks on the board";
const PORT = 3000;
const TIMEOUT = 120_000; // 2 min for full boot + agent run
const USE_EXISTING = process.argv.includes("--existing");

async function main() {
  let server;

  if (!USE_EXISTING) {
    // 1. Start dev server
    console.log("[test] Starting dev server...");
    server = spawn("npx", ["tsx", "server.ts"], {
      cwd: process.cwd(),
      env: { ...process.env, NODE_ENV: "development" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const serverReady = new Promise((resolve) => {
      server.stdout.on("data", (data) => {
        const msg = data.toString();
        if (msg.includes("Server running")) resolve();
      });
    });
    await serverReady;
    console.log("[test] Dev server ready");
  }

  // 2. Launch browser
  const browser = await puppeteer.launch({
    headless: true,
    args: [
      "--cross-origin-isolation",
      "--enable-features=SharedArrayBuffer",
      `--origin-to-force-quic=${new URL(`http://localhost:${PORT}`).origin}`,
    ],
  });

  try {
    const page = await browser.newPage();

    // Collect console messages
    const logs = [];
    page.on("console", (msg) => {
      const text = msg.text();
      logs.push(text);
      if (
        text.includes("agent") ||
        text.includes("llmfs") ||
        text.includes("toolfs") ||
        text.includes("wasi") ||
        text.includes("wexec")
      ) {
        console.log(`[browser] ${text}`);
      }
    });
    page.on("pageerror", (err) => console.log(`[browser error] ${err.message}`));

    // 3. Open the app
    console.log("[test] Loading page...");
    await page.goto(`http://localhost:${PORT}`, { waitUntil: "networkidle0" });
    await sleep(2000);

    // 4. Wait for Wanix to boot — look for the terminal being ready
    console.log("[test] Waiting for Wanix to boot...");
    const wanixReady = await page.waitForFunction(
      () => {
        // Check if the terminal component has rendered
        const term = document.querySelector(".xterm");
        return term && term.children.length > 0;
      },
      { timeout: 60_000 },
    );
    console.log("[test] Terminal rendered");

    // Wait more for v86 to fully boot
    await sleep(15_000);

    // 5. Type commands into the terminal via xterm.js
    console.log("[test] Running agent...");

    // Helper to type into xterm
    const typeCommand = async (cmd) => {
      await page.keyboard.type(cmd);
      await page.keyboard.press("Enter");
      await sleep(500);
    };

    // First check #tools is visible
    await typeCommand("ls /#tools");
    await sleep(2000);

    // Run the agent
    await typeCommand(`wexec /bin/agent.wasm "${PROMPT}"`);
    console.log("[test] Agent launched, waiting for output...");

    // 6. Wait for agent output — check xterm buffer periodically
    let agentOutput = null;
    const startTime = Date.now();
    while (Date.now() - startTime < TIMEOUT) {
      await sleep(2000);
      const content = await page.evaluate(() => {
        // Method 1: window.__xterm (set by TerminalPanel in dev)
        if (window.__xterm) {
          const buf = window.__xterm.buffer.active;
          const lines = [];
          for (let i = 0; i < buf.length; i++) {
            const line = buf.getLine(i);
            if (line && line.length > 0) lines.push(line.translateToString(true));
          }
          return lines.join("\n");
        }
        // Method 2: xterm-rows div
        const rows = document.querySelector(".xterm-rows");
        if (rows) return rows.textContent;
        return null;
      });

      if (content) {
        // Check for success
        if (content.includes("agent result:")) {
          agentOutput = content;
          console.log("[test] Agent completed successfully!");
          break;
        }
        // Check for tool load error
        if (content.includes("load tools:") && content.includes("No such file")) {
          console.log("[test] Agent failed to load tools (namespace issue)");
          agentOutput = content;
          break;
        }
        // Check for agent starting
        if (content.includes("agent starting")) {
          console.log("[test] Agent is running...");
        }
      }

      // Also check browser console logs for agent/wasi messages
      const consoleOutput = logs.join("\n");
      if (consoleOutput.includes("agent result:")) {
        agentOutput = consoleOutput;
        console.log("[test] Agent completed (detected via console)!");
        break;
      }
    }

    if (!agentOutput) {
      console.log("[test] Timed out waiting for agent output");
    }

    // Final dump of terminal content
    const termContent = await page.evaluate(() => {
      if (window.__xterm) {
        const buf = window.__xterm.buffer.active;
        const lines = [];
        for (let i = 0; i < buf.length; i++) {
          const line = buf.getLine(i);
          if (line && line.length > 0) lines.push(line.translateToString(true));
        }
        return lines.join("\n");
      }
      const rows = document.querySelector(".xterm-rows");
      return rows ? rows.textContent : "(no terminal content)";
    });

    try {
      const output = await agentDone;
      console.log("[test] Agent completed successfully!");
      console.log("[test] Full logs:");
      logs.forEach((l) => console.log(`  ${l}`));
    } catch (err) {
      console.log(`[test] ${err.message}`);
      console.log("[test] Dumping last 50 log lines:");
      logs.slice(-50).forEach((l) => console.log(`  ${l}`));
    }

    // Also grab terminal content via xterm buffer
    const termContent = await page.evaluate(() => {
      // xterm.js attaches the Terminal instance to the .xterm element's parent div
      // Search for it via React fiber or by iterating all element properties
      const termEl = document.querySelector(".xterm");
      if (!termEl) return "(no terminal found)";

      // Method 1: Check parent for React fiber that holds xtermRef
      const parent = termEl.parentElement;
      if (parent) {
        const fiberKey = Object.keys(parent).find(k => k.startsWith("__reactFiber"));
        if (fiberKey) {
          const fiber = parent[fiberKey];
          // Walk up the fiber tree looking for xtermRef
          let f = fiber;
          while (f) {
            if (f.memoizedState?.memoizedState?.current?.buffer) {
              const term = f.memoizedState.memoizedState.current;
              const buf = term.buffer.active;
              const lines = [];
              for (let i = 0; i < buf.length; i++) {
                const line = buf.getLine(i);
                if (line) lines.push(line.translateToString(true));
              }
              return lines.join("\n");
            }
            f = f.return;
          }
        }
      }

      // Method 2: Expose via window
      if (window.__xterm) {
        const buf = window.__xterm.buffer.active;
        const lines = [];
        for (let i = 0; i < buf.length; i++) {
          const line = buf.getLine(i);
          if (line) lines.push(line.translateToString(true));
        }
        return lines.join("\n");
      }

      // Method 3: Get raw text from .xterm-rows
      const rows = termEl.querySelector(".xterm-rows");
      if (rows) return rows.textContent;

      return "(could not access xterm buffer)";
    });
    console.log("\n[test] Terminal content (last 30 lines):");
    termContent
      .split("\n")
      .slice(-30)
      .forEach((l) => console.log(`  ${l}`));
  } finally {
    await browser.close();
    if (server) server.kill();
    process.exit(0);
  }
}

main().catch((err) => {
  console.error("[test] Fatal:", err);
  process.exit(1);
});
