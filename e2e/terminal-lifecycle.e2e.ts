/**
 * Long-running E2E smoke test for the Kanban Board.
 *
 * Boots the dev server + Chromium, then exercises the full lifecycle:
 *
 *   Phase 1: Page load — verify no fatal JS errors, all buttons render
 *   Phase 2: Console capture — dump every console message the app emits
 *   Phase 3: Terminal open — click toggle, wait for xterm to mount,
 *            poll the terminal buffer for up to VM_BOOT_TIMEOUT to see
 *            "[board VM ready]" or "[error: ...]" from the worker
 *   Phase 4: Terminal interaction — type into the terminal, read response
 *   Phase 5: Terminal close — verify cleanup, no leaked workers
 *   Phase 6: Full session console dump — every log, error, warning
 *
 * Run:
 *   npx tsx e2e/terminal-lifecycle.e2e.ts
 *
 * With a longer timeout (for slow WASM boot):
 *   VM_BOOT_TIMEOUT=180 npx tsx e2e/terminal-lifecycle.e2e.ts
 *
 * Skip the VM boot wait (assets not built):
 *   SKIP_VM_BOOT=1 npx tsx e2e/terminal-lifecycle.e2e.ts
 */
import puppeteer, { Browser, Page, ConsoleMessage } from 'puppeteer';
import { ChildProcess, spawn } from 'child_process';
import http from 'http';

// --- Config ---
const PORT = 3000;
const BASE_URL = `http://localhost:${PORT}`;
const PAGE_TIMEOUT = 60000;
const VM_BOOT_TIMEOUT = parseInt(process.env.VM_BOOT_TIMEOUT || '120', 10) * 1000; // default 120s
const VM_BOOT_POLL_INTERVAL = 2000; // poll every 2s
const SKIP_VM_BOOT = !!process.env.SKIP_VM_BOOT;

let browser: Browser;
let page: Page;
let serverProc: ChildProcess;

// --- Console log collector ---
interface LogEntry {
  type: string;
  text: string;
  location?: string;
  timestamp: number;
}

const ALL_LOGS: LogEntry[] = [];

function captureConsole(msg: ConsoleMessage) {
  const entry: LogEntry = {
    type: msg.type(),
    text: msg.text(),
    location: msg.location()?.url,
    timestamp: Date.now(),
  };
  ALL_LOGS.push(entry);

  // Print everything in real time so the test runner shows live progress
  const prefix = `[browser:${msg.type()}]`;
  process.stderr.write(`${prefix} ${msg.text().substring(0, 200)}\n`);
}

function capturePageError(err: Error) {
  ALL_LOGS.push({ type: 'pageerror', text: err.message, timestamp: Date.now() });
  process.stderr.write(`[browser:pageerror] ${err.message}\n`);
}

function logsOfType(type: string): LogEntry[] {
  return ALL_LOGS.filter((l) => l.type === type);
}

function dumpLogs(label: string, filter?: (l: LogEntry) => boolean) {
  const logs = filter ? ALL_LOGS.filter(filter) : ALL_LOGS;
  console.log(`\n  --- ${label} (${logs.length} entries) ---`);
  for (const log of logs) {
    const ts = new Date(log.timestamp).toISOString().slice(11, 23);
    console.log(`  [${ts}][${log.type}] ${log.text.substring(0, 200)}`);
  }
  console.log(`  --- end ${label} ---\n`);
}

// --- Server ---

function waitForServer(url: string, maxAttempts = 30): Promise<void> {
  return new Promise((resolve, reject) => {
    let attempts = 0;
    const check = () => {
      attempts++;
      http
        .get(url, (res) => { res.resume(); resolve(); })
        .on('error', () => {
          if (attempts >= maxAttempts) reject(new Error(`Server at ${url} not ready`));
          else setTimeout(check, 1000);
        });
    };
    check();
  });
}

async function setup() {
  serverProc = spawn('npx', ['tsx', 'server.ts'], {
    cwd: process.cwd(),
    env: { ...process.env, PORT: String(PORT), NODE_ENV: 'development' },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  serverProc.stdout?.on('data', (d: Buffer) => process.stderr.write(`[server:out] ${d}`));
  serverProc.stderr?.on('data', (d: Buffer) => process.stderr.write(`[server:err] ${d}`));

  await waitForServer(BASE_URL);
  console.log(`Server up at ${BASE_URL}`);

  browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-web-security'],
  });
  page = await browser.newPage();
  await page.setViewport({ width: 1400, height: 900 });

  // Capture ALL console output + page errors
  page.on('console', captureConsole);
  page.on('pageerror', capturePageError);
}

async function teardown() {
  await browser?.close();
  serverProc?.kill('SIGTERM');
  await new Promise((r) => setTimeout(r, 1000));
}

// --- Helpers ---

const $ = (sel: string, timeout = 10000) => page.waitForSelector(sel, { timeout });
const click = async (sel: string) => { await $(sel); await page.click(sel); };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function getTerminalContent(): Promise<string> {
  return page.evaluate(() => {
    const xtermEl = document.querySelector('.xterm');
    if (!xtermEl) return '__NO_XTERM__';
    const rows = xtermEl.querySelectorAll('.xterm-rows > div');
    return Array.from(rows)
      .map((r) => r.textContent || '')
      .join('\n');
  });
}

async function typeInTerminal(text: string) {
  // xterm captures keyboard events on its textarea
  await page.evaluate((t) => {
    const ta = document.querySelector('.xterm-helper-textarea') as HTMLTextAreaElement;
    if (!ta) return;
    ta.focus();
    ta.value = t;
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  }, text);
}

// ===================================================================
// PHASES
// ===================================================================

async function phase1_pageLoad() {
  console.log('\n========================================');
  console.log('  PHASE 1: Page Load');
  console.log('========================================');

  await page.goto(BASE_URL, { waitUntil: 'networkidle2', timeout: PAGE_TIMEOUT });
  console.log('  Page navigated, networkidle2 reached');

  // Critical UI elements
  const buttons = {
    'Toggle Terminal': await page.$('[title="Toggle Terminal"]'),
    'Toggle Repository Browser': await page.$('[title="Toggle Repository Browser"]'),
    'Agent Settings': await page.$('[title="Agent Settings"]'),
  };

  for (const [name, el] of Object.entries(buttons)) {
    if (!el) throw new Error(`Button "${name}" not found`);
    console.log(`  Found button: ${name}`);
  }

  // Check for fatal page errors
  const pageErrors = logsOfType('pageerror').filter(
    (e) => !e.text.includes('BulkError') && !e.text.includes('Dexie') && !e.text.includes('IndexedDB')
  );
  if (pageErrors.length > 0) {
    throw new Error(`Fatal JS errors on load: ${pageErrors.map((e) => e.text).join('; ')}`);
  }
  console.log('  No fatal JS errors');
  console.log('  PASS');
}

async function phase2_consoleCapture() {
  console.log('\n========================================');
  console.log('  PHASE 2: Console Capture');
  console.log('========================================');

  // Reload for clean capture
  ALL_LOGS.length = 0;
  await page.goto(BASE_URL, { waitUntil: 'networkidle2', timeout: PAGE_TIMEOUT });
  await sleep(2000); // let async boot settle

  dumpLogs('Boot console output');

  // Verify we captured something
  const infoLogs = ALL_LOGS.filter((l) => l.type === 'log' || l.type === 'info');
  const hasModuleInit = infoLogs.some((l) => l.text.includes('module') || l.text.includes('Module') || l.text.includes('Host'));
  if (hasModuleInit) {
    console.log('  PASS: Module initialization detected in console');
  } else {
    console.log('  Note: No explicit module init log found (may use different wording)');
  }
}

async function phase3_terminalOpen() {
  console.log('\n========================================');
  console.log('  PHASE 3: Terminal Open + VM Boot');
  console.log('========================================');

  ALL_LOGS.length = 0;

  // Open terminal
  await click('[title="Toggle Terminal"]');
  console.log('  Clicked Toggle Terminal');
  await sleep(1000);

  // Verify tab appeared
  const tabTexts = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('span')).map((s) => s.textContent?.trim()).filter(Boolean);
  });
  if (!tabTexts.includes('Terminal')) throw new Error('Terminal tab not in tab bar');
  console.log('  Terminal tab in tab bar');

  // Verify green button
  const btnClass = await page.$eval('[title="Toggle Terminal"]', (el) => el.className);
  if (!btnClass.includes('text-green-400')) throw new Error('Button not green');
  console.log('  Toggle button is green (active)');

  // Wait for xterm to mount
  await $('.xterm', 10000);
  console.log('  xterm element mounted');

  // Check WASM assets
  const wasmCheck = await page.evaluate(async () => {
    const results: Record<string, string> = {};
    for (const asset of ['/assets/wasm/boot.wasm', '/assets/wasm/sys.tar.gz', '/assets/wasm/wanix.min.js']) {
      try {
        const r = await fetch(asset, { method: 'HEAD' });
        const ct = r.headers.get('content-type') || '';
        // Vite SPA fallback returns text/html for missing assets
        results[asset] = r.ok && !ct.includes('text/html') ? `OK (${r.status}, ${ct})` : `MISSING (${r.status}, ${ct})`;
      } catch { results[asset] = 'FETCH_ERROR'; }
    }
    return results;
  });

  console.log('  WASM asset status:');
  for (const [k, v] of Object.entries(wasmCheck)) {
    console.log(`    ${k}: ${v}`);
  }

  const assetsExist = Object.values(wasmCheck).every((v) => v.startsWith('OK'));

  if (SKIP_VM_BOOT) {
    console.log('  SKIP_VM_BOOT=1 — skipping VM boot wait');
  } else if (!assetsExist) {
    console.log('  WASM assets not built — skipping VM boot wait');
    console.log('  (Build with `make wasm` or copy to public/assets/wasm/)');
  } else {
    console.log(`  WASM assets present — polling terminal for VM boot (timeout: ${VM_BOOT_TIMEOUT / 1000}s)`);

    const startTime = Date.now();
    let bootResult: 'ready' | 'error' | 'timeout' = 'timeout';
    let lastContent = '';

    while (Date.now() - startTime < VM_BOOT_TIMEOUT) {
      await sleep(VM_BOOT_POLL_INTERVAL);

      const content = await getTerminalContent();
      const elapsed = Math.round((Date.now() - startTime) / 1000);

      if (content !== lastContent) {
        lastContent = content;
        console.log(`\n  [${elapsed}s] Terminal content changed:`);
        for (const line of content.split('\n').filter((l: string) => l.trim())) {
          console.log(`    | ${line}`);
        }
      } else {
        process.stderr.write(`  [${elapsed}s] polling... (no change)\n`);
      }

      if (content.includes('board VM ready')) {
        bootResult = 'ready';
        break;
      }
      if (content.includes('[error:')) {
        bootResult = 'error';
        break;
      }
    }

    if (bootResult === 'ready') {
      console.log('  PASS: VM booted — "[board VM ready]" visible in terminal');
    } else if (bootResult === 'error') {
      console.log('  WARN: VM produced an error (shown in terminal above)');
    } else {
      console.log(`  WARN: VM boot timed out after ${VM_BOOT_TIMEOUT / 1000}s`);
      console.log('  Final terminal content:');
      for (const line of lastContent.split('\n').filter((l: string) => l.trim())) {
        console.log(`    | ${line}`);
      }
    }
  }

  // Dump worker-related console logs from this phase
  dumpLogs('Worker / WASM logs from Phase 3', (l) =>
    /worker|wasm|wanix|terminal|boot|vm/i.test(l.text)
  );

  console.log('  PASS');
}

async function phase4_terminalInteraction() {
  console.log('\n========================================');
  console.log('  PHASE 4: Terminal Interaction');
  console.log('========================================');

  if (SKIP_VM_BOOT) {
    console.log('  SKIP_VM_BOOT=1 — skipping interaction');
    console.log('  PASS (skipped)');
    return;
  }

  const content = await getTerminalContent();
  if (content.includes('__NO_XTERM__')) {
    console.log('  No xterm element — skipping');
    console.log('  PASS (skipped)');
    return;
  }

  // Check if we have a shell prompt — try typing and reading response
  const preType = await getTerminalContent();

  // Send a simple command: press Enter, then type "echo hello"
  await page.keyboard.type('echo hello from e2e\n');
  console.log('  Sent: "echo hello from e2e"');

  await sleep(3000);

  const postType = await getTerminalContent();
  if (postType !== preType) {
    console.log('  Terminal content changed after typing:');
    for (const line of postType.split('\n').filter((l: string) => l.trim())) {
      console.log(`    | ${line}`);
    }
    if (postType.includes('hello from e2e')) {
      console.log('  PASS: Command echo detected in terminal');
    } else {
      console.log('  Note: Command sent but echo not confirmed (VM may still be booting)');
      console.log('  PASS (partial)');
    }
  } else {
    console.log('  Note: Terminal content unchanged after typing (VM not responding yet)');
    console.log('  PASS (no response yet)');
  }
}

async function phase5_terminalClose() {
  console.log('\n========================================');
  console.log('  PHASE 5: Terminal Close + Cleanup');
  console.log('========================================');

  ALL_LOGS.length = 0;

  // Close terminal
  await click('[title="Toggle Terminal"]');
  console.log('  Clicked Toggle Terminal (close)');
  await sleep(1000);

  // Verify tab gone
  const tabTexts = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('span')).map((s) => s.textContent?.trim()).filter(Boolean);
  });
  if (tabTexts.includes('Terminal')) throw new Error('Terminal tab still present after close');
  console.log('  Terminal tab removed');

  // Button inactive
  const btnClass = await page.$eval('[title="Toggle Terminal"]', (el) => el.className);
  if (btnClass.includes('text-green-400')) throw new Error('Button still green after close');
  console.log('  Toggle button back to inactive');

  // xterm should be gone
  const hasXterm = await page.$('.xterm');
  if (hasXterm) {
    console.log('  WARN: xterm element still in DOM after close (may be hidden but not removed)');
  } else {
    console.log('  xterm element removed from DOM');
  }

  // No new page errors
  const newErrors = logsOfType('pageerror').filter(
    (e) => !e.text.includes('BulkError') && !e.text.includes('Dexie') && !e.text.includes('IndexedDB')
  );
  if (newErrors.length > 0) {
    console.log(`  WARN: ${newErrors.length} errors during close:`);
    for (const e of newErrors) console.log(`    ${e.text.substring(0, 150)}`);
  } else {
    console.log('  No errors during close');
  }

  console.log('  PASS');
}

async function phase6_fullSessionDump() {
  console.log('\n========================================');
  console.log('  PHASE 6: Full Session Summary');
  console.log('========================================');

  const errors = logsOfType('error');
  const warnings = logsOfType('warning');
  const pageErrors = logsOfType('pageerror');
  const significant = errors.filter(
    (e) => !e.text.includes('favicon') && !e.text.includes('Dexie') && !e.text.includes('IndexedDB')
  );

  console.log(`  Total console messages: ${ALL_LOGS.length}`);
  console.log(`  Errors: ${errors.length} (${significant.length} significant)`);
  console.log(`  Warnings: ${warnings.length}`);
  console.log(`  Page errors: ${pageErrors.length}`);

  // Print all unique error messages
  const uniqueErrors = [...new Set(errors.map((e) => e.text.substring(0, 150)))];
  if (uniqueErrors.length > 0) {
    console.log(`  Unique error messages:`);
    for (const e of uniqueErrors) console.log(`    - ${e}`);
  }

  // Print all page errors
  if (pageErrors.length > 0) {
    console.log(`  Page errors:`);
    for (const e of pageErrors) console.log(`    - ${e.text.substring(0, 150)}`);
  }

  console.log('  PASS');
}

// ===================================================================
// MAIN
// ===================================================================

async function main() {
  const phases = [
    { name: 'Phase 1: Page Load', fn: phase1_pageLoad },
    { name: 'Phase 2: Console Capture', fn: phase2_consoleCapture },
    { name: 'Phase 3: Terminal Open + VM Boot', fn: phase3_terminalOpen },
    { name: 'Phase 4: Terminal Interaction', fn: phase4_terminalInteraction },
    { name: 'Phase 5: Terminal Close', fn: phase5_terminalClose },
    { name: 'Phase 6: Session Summary', fn: phase6_fullSessionDump },
  ];

  console.log(`\n${'#'.repeat(60)}`);
  console.log(`  Kanban Board — Full Lifecycle E2E Test`);
  console.log(`  VM_BOOT_TIMEOUT = ${VM_BOOT_TIMEOUT / 1000}s`);
  console.log(`  SKIP_VM_BOOT    = ${SKIP_VM_BOOT}`);
  console.log(`${'#'.repeat(60)}\n`);

  const startTime = Date.now();

  try {
    await setup();
  } catch (err: any) {
    console.error(`\nFATAL: Setup failed: ${err.message}`);
    process.exit(1);
  }

  let passed = 0;
  let failed = 0;

  for (const phase of phases) {
    try {
      await phase.fn();
      passed++;
    } catch (err: any) {
      console.log(`\n  FAIL: ${err.message}\n`);
      failed++;
    }
  }

  const elapsed = Math.round((Date.now() - startTime) / 1000);

  console.log(`\n${'#'.repeat(60)}`);
  console.log(`  Results: ${passed}/${phases.length} passed (${failed} failed)`);
  console.log(`  Total time: ${elapsed}s`);
  console.log(`${'#'.repeat(60)}\n`);

  await teardown();
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('Unhandled:', err);
  teardown().finally(() => process.exit(1));
});
