/**
 * Headless e2e test for bash-executor via Puppeteer.
 *
 * Boots the dev server, opens the app in Chromium, waits for the v86 VM
 * and boardVM to be ready, then exercises the bashExec bridge end-to-end.
 *
 * Run: npx vitest run tests/bash-executor.e2e.test.ts
 *
 * Requires: dev server NOT already running (test starts its own).
 * Timeout: ~120s (VM boot takes 30-60s).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import puppeteer, { Browser, Page } from 'puppeteer';
import { spawn, ChildProcess } from 'child_process';

const PORT = 3099;
const BASE_URL = `http://localhost:${PORT}`;
const BOOT_TIMEOUT = 90_000;
const EXEC_TIMEOUT = 30_000;

let browser: Browser;
let page: Page;
let serverProc: ChildProcess;

async function waitForBoardVM(page: Page, timeoutMs = BOOT_TIMEOUT): Promise<void> {
  await page.waitForFunction(
    () => (globalThis as any).boardVM?.bashExec && (globalThis as any).boardVM?.fsBridge,
    { timeout: timeoutMs },
  );
}

describe('bash-executor e2e', () => {
  beforeAll(async () => {
    // Start dev server
    serverProc = spawn('npx', ['tsx', 'server.ts'], {
      cwd: process.cwd(),
      env: { ...process.env, PORT: String(PORT) },
      stdio: 'pipe',
    });
    // Wait for server to be ready
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Server startup timeout')), 15_000);
      serverProc.stdout!.on('data', (data: Buffer) => {
        if (data.toString().includes('listening') || data.toString().includes(String(PORT))) {
          clearTimeout(timeout);
          resolve();
        }
      });
      serverProc.stderr!.on('data', (data: Buffer) => {
        if (data.toString().includes('listening') || data.toString().includes(String(PORT))) {
          clearTimeout(timeout);
          resolve();
        }
      });
    });

    browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--enable-webgl'],
    });
    page = await browser.newPage();
    await page.goto(BASE_URL, { waitUntil: 'networkidle0', timeout: 30_000 });
  }, 20_000);

  afterAll(async () => {
    await browser?.close();
    serverProc?.kill();
  });

  it('should have boardVM.bashExec available after VM boot', async () => {
    await waitForBoardVM(page);
    const hasBashExec = await page.evaluate(() => {
      return typeof (globalThis as any).boardVM?.bashExec === 'function';
    });
    expect(hasBashExec).toBe(true);
  }, BOOT_TIMEOUT);

  it('should execute a simple echo command', async () => {
    await waitForBoardVM(page);

    const result = await page.evaluate(async () => {
      const bvm = (globalThis as any).boardVM;
      return await bvm.bashExec({ command: 'echo hello-e2e', cwd: '/home', timeout: 10000 });
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('hello-e2e');
  }, EXEC_TIMEOUT);

  it('should create a file via bashExec and read it back via fsBridge', async () => {
    await waitForBoardVM(page);

    const result = await page.evaluate(async () => {
      const bvm = (globalThis as any).boardVM;
      // Write via bash
      await bvm.bashExec({ command: 'echo test-content > /tmp/e2e-test.txt', cwd: '/tmp', timeout: 5000 });
      // Read via fsBridge
      const content = await bvm.fsBridge.readFile('/tmp/e2e-test.txt');
      // Cleanup
      await bvm.fsBridge.rm('/tmp/e2e-test.txt');
      return content;
    });

    expect(result).toContain('test-content');
  }, EXEC_TIMEOUT);

  it('should report non-zero exit code for failing command', async () => {
    await waitForBoardVM(page);

    const result = await page.evaluate(async () => {
      const bvm = (globalThis as any).boardVM;
      return await bvm.bashExec({ command: 'exit 42', cwd: '/home', timeout: 5000 });
    });

    expect(result.exitCode).toBe(42);
  }, EXEC_TIMEOUT);

  it('should timeout long-running commands', async () => {
    await waitForBoardVM(page);

    const result = await page.evaluate(async () => {
      const bvm = (globalThis as any).boardVM;
      return await bvm.bashExec({ command: 'sleep 60', cwd: '/home', timeout: 3000 });
    });

    expect(result.exitCode).toBe(-1);
    expect(result.error).toContain('timeout');
  }, EXEC_TIMEOUT);
});
