import { test, expect } from '@playwright/test';

test('terminal boots and responds to input', async ({ page }) => {
  // Set a very long timeout for this specific test to allow for WASM boot
  test.setTimeout(300000);

  await page.goto('/');

  // Wait for app to load
  await expect(page.getByTitle('Toggle Terminal')).toBeVisible();

  // Open terminal
  await page.getByTitle('Toggle Terminal').click();

  // Check for xterm
  await expect(page.locator('.xterm')).toBeVisible({ timeout: 15000 });

  const getTerminalText = async () => {
    return await page.evaluate(() => {
      const rows = document.querySelectorAll('.xterm-rows > div');
      return Array.from(rows).map(r => r.textContent).join('\n');
    });
  };

  await test.step('Wait for VM boot and verify interaction', async () => {
    // 1. Verify UI buttons are present
    await expect(page.getByTitle('Clear Terminal')).toBeVisible();
    await expect(page.getByTitle('Download Logs')).toBeVisible();

    // 2. Poll for "Connected" (STRICT)
    console.log('Waiting for terminal connection (this may take several minutes)...');
    await expect.poll(getTerminalText, {
      message: 'Terminal did not show "Connected" within 4 minutes',
      timeout: 240000,
      intervals: [5000],
    }).toMatch(/Connected/);

    // 3. Focus and type a command
    console.log('Sending echo command...');
    const textarea = page.locator('.xterm-helper-textarea');
    await textarea.focus();
    await page.keyboard.type('echo playwright-was-here\n');

    // 4. Verify command output (STRICT)
    console.log('Waiting for command output...');
    await expect.poll(getTerminalText, {
      message: 'Command "playwright-was-here" output not found in terminal',
      timeout: 30000,
    }).toContain('playwright-was-here');

    console.log('Terminal interaction verified successfully!');
  });
});
