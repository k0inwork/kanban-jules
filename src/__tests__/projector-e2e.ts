/**
 * Headless browser integration test using Puppeteer.
 * Starts dev server, opens page, runs projector tests, reports results.
 * Usage: npx tsx src/__tests__/projector-e2e.ts
 */

import puppeteer, { Browser, Page } from 'puppeteer';
import { spawn, ChildProcess } from 'child_process';
import http from 'http';

const PORT = 3999;
const BASE_URL = `http://localhost:${PORT}`;

function waitForServer(port: number, timeout = 15000): Promise<void> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const check = () => {
      http.get(`http://localhost:${port}`, (res) => {
        res.resume();
        resolve();
      }).on('error', () => {
        if (Date.now() - start > timeout) reject(new Error(`Server on :${port} didn't start in ${timeout}ms`));
        else setTimeout(check, 500);
      });
    };
    check();
  });
}

interface TestResult {
  passed: number;
  failed: number;
  failures: string[];
}

async function runTests(): Promise<TestResult> {
  let serverProc: ChildProcess | undefined;

  try {
    // Start dev server
    console.log(`[e2e] Starting dev server on :${PORT}...`);
    serverProc = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], {
      cwd: process.cwd(),
      stdio: 'pipe',
      env: { ...process.env, FORCE_COLOR: '0' },
    });
    serverProc.stderr?.on('data', d => process.stderr.write(d));
    serverProc.stdout?.on('data', d => process.stdout.write(d));

    await waitForServer(PORT);
    console.log('[e2e] Server ready.\n');

    // Launch browser
    const browser: Browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });
    const page: Page = await browser.newPage();

    // Collect console messages
    const logs: string[] = [];
    page.on('console', msg => {
      const text = msg.text();
      logs.push(text);
      console.log(text);
    });
    page.on('pageerror', err => {
      logs.push(`PAGE ERROR: ${err.message}`);
      console.error(`PAGE ERROR: ${err.message}`);
    });

    // Navigate — use domcontentloaded since the app loads heavy WASM/VM that blocks networkidle
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });

    // Wait for Vite HMR connection to settle
    await new Promise(r => setTimeout(r, 3000));

    // Run test
    console.log('[e2e] Injecting test runner...\n');
    await page.evaluate(() => {
      return (window as any).__testProjectorResult = (import('./src/test-projector') as Promise<any>).then((m: any) => m.runTests());
    });

    // Wait for "TESTS COMPLETE" in logs
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Test timeout (30s)')), 30000);
      const interval = setInterval(() => {
        if (logs.some(l => l.includes('TESTS COMPLETE') || l.includes('RESULTS:'))) {
          clearTimeout(timeout);
          clearInterval(interval);
          resolve();
        }
      }, 250);
    });

    await browser.close();

    // Parse results
    const failures: string[] = [];
    let passed = 0;
    let failed = 0;

    for (const line of logs) {
      if (line.includes('PASS —')) passed++;
      if (line.includes('FAIL —')) {
        failed++;
        failures.push(line.trim());
      }
    }

    return { passed, failed, failures };
  } finally {
    if (serverProc) {
      serverProc.kill('SIGTERM');
      // Give it a moment then force kill
      setTimeout(() => serverProc?.kill('SIGKILL'), 2000);
    }
  }
}

// Main
runTests().then(({ passed, failed, failures }) => {
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`E2E Results: ${passed} passed, ${failed} failed`);
  if (failures.length > 0) {
    console.log('\nFailures:');
    failures.forEach(f => console.log(`  ${f}`));
  }
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━');
  process.exit(failed > 0 ? 1 : 0);
}).catch(err => {
  console.error('[e2e] Fatal:', err);
  process.exit(2);
});
