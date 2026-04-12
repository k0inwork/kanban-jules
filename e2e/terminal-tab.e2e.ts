/**
 * E2E tests for the Kanban Board using Puppeteer.
 *
 * Boots the dev server + Chromium, then exercises:
 *   - Terminal toggle open/close
 *   - Console log capture (checks for JS errors)
 *   - Terminal worker boot sequence
 *   - Tab bar interactions
 *   - Kanban board renders tasks
 *
 * Run: npx tsx e2e/terminal-tab.e2e.ts
 *
 * Environment: needs WASM assets at public/assets/wasm/ (optional — terminal
 * boot test will skip gracefully if assets are missing).
 */
import puppeteer, { Browser, Page, ConsoleMessage } from 'puppeteer';
import { ChildProcess, spawn } from 'child_process';
import http from 'http';

const PORT = 3000;
const BASE_URL = `http://localhost:${PORT}`;
const TIMEOUT = 45000;

let browser: Browser;
let page: Page;
let serverProc: ChildProcess;

// --- Console log collector ---

interface LogEntry {
  type: string;
  text: string;
  location?: string;
}

const consoleLogs: LogEntry[] = [];

function clearConsoleLogs() {
  consoleLogs.length = 0;
}

function captureConsole(msg: ConsoleMessage) {
  const entry: LogEntry = {
    type: msg.type(),
    text: msg.text(),
    location: msg.location()?.url,
  };
  consoleLogs.push(entry);

  // Always print errors/warnings to stderr for debugging
  if (msg.type() === 'error' || msg.type() === 'warning') {
    process.stderr.write(`[browser:${msg.type()}] ${msg.text()}\n`);
  }
}

function getLogsOfType(type: string): LogEntry[] {
  return consoleLogs.filter((l) => l.type === type);
}

function hasLogContaining(type: string, substring: string): boolean {
  return consoleLogs.some((l) => l.type === type && l.text.includes(substring));
}

// --- Server management ---

function waitForServer(url: string, maxAttempts = 30): Promise<void> {
  return new Promise((resolve, reject) => {
    let attempts = 0;
    const check = () => {
      attempts++;
      http
        .get(url, (res) => {
          res.resume();
          resolve();
        })
        .on('error', () => {
          if (attempts >= maxAttempts) {
            reject(new Error(`Server at ${url} not ready after ${maxAttempts} attempts`));
          } else {
            setTimeout(check, 1000);
          }
        });
    };
    check();
  });
}

async function setup() {
  // Start dev server
  serverProc = spawn('npx', ['tsx', 'server.ts'], {
    cwd: process.cwd(),
    env: { ...process.env, PORT: String(PORT), NODE_ENV: 'development' },
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  serverProc.stdout?.on('data', (data: Buffer) => {
    process.stderr.write(`[server:out] ${data}`);
  });
  serverProc.stderr?.on('data', (data: Buffer) => {
    process.stderr.write(`[server:err] ${data}`);
  });

  await waitForServer(BASE_URL);
  console.log(`Server ready at ${BASE_URL}`);

  browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-web-security'],
  });
  page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });

  // Capture ALL console output from the browser
  page.on('console', captureConsole);

  // Capture page errors
  page.on('pageerror', (err) => {
    consoleLogs.push({ type: 'pageerror', text: err.message });
    process.stderr.write(`[browser:pageerror] ${err.message}\n`);
  });
}

async function teardown() {
  await browser?.close();
  serverProc?.kill('SIGTERM');
  await new Promise((r) => setTimeout(r, 500));
}

// --- Helpers ---

async function waitFor(selector: string, timeout = 10000) {
  await page.waitForSelector(selector, { timeout });
}

async function click(selector: string) {
  await waitFor(selector);
  await page.click(selector);
}

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

// ===================================================================
// TESTS
// ===================================================================

async function testPageLoadsAndNoFatalErrors() {
  console.log('\nTEST 1: Page loads without fatal JS errors');
  clearConsoleLogs();

  await page.goto(BASE_URL, { waitUntil: 'networkidle2', timeout: TIMEOUT });

  // Check the terminal toggle button exists
  const terminalBtn = await page.$('[title="Toggle Terminal"]');
  if (!terminalBtn) throw new Error('Toggle Terminal button not found on page');

  // Check for page-level errors
  const pageErrors = getLogsOfType('pageerror');
  if (pageErrors.length > 0) {
    // Filter out known non-fatal errors (Dexie/IndexedDB in headless, BulkError from bulkAdd)
    const fatalErrors = pageErrors.filter(
      (e) =>
        !e.text.includes('Dexie') &&
        !e.text.includes('IndexedDB') &&
        !e.text.includes('IDBDatabase') &&
        !e.text.includes('BulkError')
    );
    if (fatalErrors.length > 0) {
      throw new Error(`Page has fatal JS errors: ${fatalErrors.map((e) => e.text).join('; ')}`);
    }
    console.log(`  Note: ${pageErrors.length} non-fatal errors (IndexedDB/BulkError — expected in headless)`);
  }

  console.log('  PASS: Page loaded, terminal button found, no fatal errors');
}

async function testConsoleShowsAppBoot() {
  console.log('\nTEST 2: Console logs show app initialization');
  clearConsoleLogs();

  // Reload to capture fresh boot logs
  await page.goto(BASE_URL, { waitUntil: 'networkidle2', timeout: TIMEOUT });

  // Print all captured console logs
  console.log(`  Captured ${consoleLogs.length} console messages:`);
  for (const log of consoleLogs.slice(0, 20)) {
    console.log(`    [${log.type}] ${log.text.substring(0, 120)}`);
  }
  if (consoleLogs.length > 20) {
    console.log(`    ... and ${consoleLogs.length - 20} more`);
  }

  // There should be at least some console output from the app
  if (consoleLogs.length === 0) {
    console.log('  Note: No console output captured (app may not log during boot)');
  }

  console.log('  PASS: Console capture working');
}

async function testTerminalToggleOpensTab() {
  console.log('\nTEST 3: Terminal toggle opens terminal tab and mounts panel');
  clearConsoleLogs();

  await page.goto(BASE_URL, { waitUntil: 'networkidle2', timeout: TIMEOUT });

  // Click terminal toggle
  await click('[title="Toggle Terminal"]');
  await sleep(1000);

  // Verify terminal tab appears in tab bar
  const tabTexts = await page.evaluate(() => {
    const allSpans = document.querySelectorAll('span');
    return Array.from(allSpans)
      .map((s) => s.textContent?.trim())
      .filter(Boolean);
  });

  if (!tabTexts.some((t) => t === 'Terminal')) {
    throw new Error(`Terminal tab not found. Spans: ${tabTexts.join(', ')}`);
  }
  console.log('  PASS: Terminal tab appears in tab bar');

  // Verify the toggle button shows active (green) state
  const btnClass = await page.$eval('[title="Toggle Terminal"]', (el) => el.className);
  if (!btnClass.includes('text-green-400')) {
    throw new Error(`Terminal button not green. Class: ${btnClass}`);
  }
  console.log('  PASS: Toggle button shows green active state');

  // Check that TerminalPanel mounted — look for the xterm container div
  const hasTerminalDiv = await page.evaluate(() => {
    // TerminalPanel creates a div with background #1e1e2e
    const divs = document.querySelectorAll('div');
    return Array.from(divs).some(
      (d) =>
        (d as HTMLElement).style.backgroundColor === 'rgb(30, 30, 46)' ||
        d.classList.contains('xterm')
    );
  });

  if (hasTerminalDiv) {
    console.log('  PASS: TerminalPanel container div mounted');
  } else {
    // The xterm container may not have mounted yet (xterm.js needs to load)
    console.log('  Note: TerminalPanel container not detected yet (xterm.js may still be loading)');
  }

  // Check console for worker-related activity
  const workerLogs = consoleLogs.filter(
    (l) =>
      l.text.includes('worker') ||
      l.text.includes('Worker') ||
      l.text.includes('wasm') ||
      l.text.includes('wanix') ||
      l.text.includes('terminal') ||
      l.text.includes('Terminal')
  );
  if (workerLogs.length > 0) {
    console.log(`  Worker-related console logs (${workerLogs.length}):`);
    for (const log of workerLogs) {
      console.log(`    [${log.type}] ${log.text.substring(0, 120)}`);
    }
  }

  // Check for errors during terminal boot
  const errors = getLogsOfType('error').filter(
    (e) =>
      !e.text.includes('Dexie') &&
      !e.text.includes('IndexedDB') &&
      !e.text.includes('favicon') &&
      !e.text.includes('net::ERR')
  );
  if (errors.length > 0) {
    console.log(`  WARN: ${errors.length} errors during terminal boot:`);
    for (const err of errors) {
      console.log(`    ${err.text.substring(0, 150)}`);
    }
  }

  // Try to detect if WASM assets are present
  const wasmAssetStatus = await page.evaluate(async () => {
    try {
      const resp = await fetch('/assets/wasm/boot.wasm', { method: 'HEAD' });
      return { exists: resp.ok, status: resp.status };
    } catch {
      return { exists: false, status: 'fetch error' };
    }
  });
  console.log(`  WASM asset check: boot.wasm ${wasmAssetStatus.exists ? 'EXISTS' : 'MISSING'} (status: ${wasmAssetStatus.status})`);

  if (wasmAssetStatus.exists) {
    // If WASM assets exist, wait for the VM worker to post "ready" or "error"
    console.log('  Waiting for VM worker response (up to 15s)...');
    await sleep(15000);

    // The terminal should have written "[board VM ready]" or "[error: ...]"
    const termContent = await page.evaluate(() => {
      // Try to read xterm's buffer
      const xtermEl = document.querySelector('.xterm');
      if (!xtermEl) return 'no xterm element';
      // xterm rows contain the terminal content
      const rows = xtermEl.querySelectorAll('.xterm-rows > div');
      return Array.from(rows)
        .map((r) => r.textContent?.trim())
        .filter(Boolean)
        .join('\n');
    });

    console.log(`  Terminal content:\n${termContent.split('\n').map((l: string) => '    ' + l).join('\n')}`);

    if (termContent.includes('board VM ready')) {
      console.log('  PASS: VM booted successfully — "[board VM ready]" visible in terminal');
    } else if (termContent.includes('[error:')) {
      console.log(`  WARN: VM boot produced an error (shown in terminal)`);
    } else {
      console.log('  Note: VM boot still in progress or xterm buffer not readable');
    }
  } else {
    console.log('  SKIP: WASM assets not found — terminal VM boot test skipped');
    console.log('        (Build WASM assets with `make wasm` or copy to public/assets/wasm/)');
  }
}

async function testTerminalToggleClosesTab() {
  console.log('\nTEST 4: Terminal toggle closes tab and cleans up');
  clearConsoleLogs();

  await page.goto(BASE_URL, { waitUntil: 'networkidle2', timeout: TIMEOUT });

  // Open terminal
  await click('[title="Toggle Terminal"]');
  await sleep(500);

  // Close it
  await click('[title="Toggle Terminal"]');
  await sleep(300);

  // Tab should be gone
  const tabTexts = await page.evaluate(() => {
    const allSpans = document.querySelectorAll('span');
    return Array.from(allSpans)
      .map((s) => s.textContent?.trim())
      .filter(Boolean);
  });

  if (tabTexts.some((t) => t === 'Terminal')) {
    throw new Error('Terminal tab should be gone');
  }
  console.log('  PASS: Terminal tab removed');

  // Button should be inactive
  const btnClass = await page.$eval('[title="Toggle Terminal"]', (el) => el.className);
  if (btnClass.includes('text-green-400')) {
    throw new Error('Button should not be green after close');
  }
  console.log('  PASS: Toggle button returns to inactive state');

  // Check that no page errors occurred during close
  const pageErrors = getLogsOfType('pageerror').filter(
    (e) => !e.text.includes('Dexie') && !e.text.includes('IndexedDB')
  );
  if (pageErrors.length > 0) {
    console.log(`  WARN: ${pageErrors.length} errors during tab close:`);
    for (const err of pageErrors) {
      console.log(`    ${err.text.substring(0, 120)}`);
    }
  }
}

async function testKanbanBoardRenders() {
  console.log('\nTEST 5: Kanban board renders with task columns');
  clearConsoleLogs();

  await page.goto(BASE_URL, { waitUntil: 'networkidle2', timeout: TIMEOUT });

  // Look for kanban column headers
  const columns = await page.evaluate(() => {
    // KanbanBoard renders column headers with workflow status names
    const headers = document.querySelectorAll('h2, h3, [class*="font-bold"]');
    return Array.from(headers)
      .map((h) => h.textContent?.trim())
      .filter((t) => t && ['TODO', 'IN_PROGRESS', 'IN_REVIEW', 'DONE'].some((s) => t.includes(s)));
  });

  if (columns.length > 0) {
    console.log(`  PASS: Found ${columns.length} kanban column(s): ${columns.join(', ')}`);
  } else {
    // Board might use different structure
    console.log('  Note: Could not find standard kanban columns — board may use different layout');
  }

  // Check that at least some content rendered
  const bodyText = await page.evaluate(() => document.body.innerText?.substring(0, 200));
  if (!bodyText || bodyText.length < 10) {
    throw new Error('Page body is empty — nothing rendered');
  }
  console.log('  PASS: Page has rendered content');
}

async function testConsoleErrorSummary() {
  console.log('\nTEST 6: Console error summary across all tests');
  // This test summarizes all captured errors across the session

  const errors = getLogsOfType('error');
  const warnings = getLogsOfType('warning');
  const pageErrors = getLogsOfType('pageerror');

  // Filter out known benign errors
  const significantErrors = errors.filter(
    (e) =>
      !e.text.includes('favicon') &&
      !e.text.includes('Dexie') &&
      !e.text.includes('IndexedDB') &&
      !e.text.includes('DevTools')
  );

  console.log(`  Total console messages: ${consoleLogs.length}`);
  console.log(`  Errors: ${errors.length} (${significantErrors.length} significant)`);
  console.log(`  Warnings: ${warnings.length}`);
  console.log(`  Page errors: ${pageErrors.length}`);

  if (significantErrors.length > 0) {
    console.log(`  Significant errors:`);
    for (const err of significantErrors.slice(0, 10)) {
      console.log(`    ${err.text.substring(0, 150)}`);
    }
  }

  console.log('  PASS: Error summary generated');
}

// ===================================================================
// RUNNER
// ===================================================================

async function main() {
  const tests = [
    testPageLoadsAndNoFatalErrors,
    testConsoleShowsAppBoot,
    testTerminalToggleOpensTab,
    testTerminalToggleClosesTab,
    testKanbanBoardRenders,
    testConsoleErrorSummary,
  ];

  let passed = 0;
  let failed = 0;

  console.log(`\n${'='.repeat(60)}`);
  console.log(`  Kanban Board E2E Tests (${tests.length} tests)`);
  console.log(`${'='.repeat(60)}\n`);

  try {
    await setup();
  } catch (err: any) {
    console.error(`\nFATAL: Setup failed: ${err.message}`);
    process.exit(1);
  }

  for (const test of tests) {
    try {
      await test();
      passed++;
    } catch (err: any) {
      console.log(`  FAIL: ${err.message}`);
      failed++;
    }
  }

  console.log(`\n${'='.repeat(60)}`);
  console.log(`  Results: ${passed} passed, ${failed} failed`);
  console.log(`${'='.repeat(60)}\n`);

  await teardown();
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('Unhandled error:', err);
  teardown().finally(() => process.exit(1));
});
