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

    // 2. Poll for Shell Prompt (STRICT)
    console.log('Waiting for shell prompt (this may take several minutes)...');
    let lastLog = "";
    await expect.poll(async () => {
      const text = await getTerminalText();
      if (text !== lastLog) {
        console.log(`[Terminal Content] ${text.substring(text.lastIndexOf('\n') + 1)}`);
        lastLog = text;
      }
      return text;
    }, {
      message: 'Terminal did not show shell prompt within 4 minutes',
      timeout: 240000,
      intervals: [5000],
    }).toMatch(/[#$]\s*$/);

    // 3. Focus and type a command (STRICT)
    console.log('Focusing terminal and sending echo command...');

    // Ensure the terminal is truly focused
    await page.locator('.xterm').click({ position: { x: 100, y: 100 } });
    await page.locator('.xterm-helper-textarea').focus();

    // Send Enter multiple times to be sure
    await page.keyboard.press('Enter');
    await page.waitForTimeout(1000);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(2000);

    // Type the command with a slow delay
    await page.keyboard.type('echo playwright-was-here', { delay: 100 });
    await page.keyboard.press('Enter');

    // 4. Verify command output (STRICT)
    console.log('Waiting for command output...');
    await expect.poll(async () => {
      const text = await getTerminalText();
      if (text.includes('playwright-was-here')) return true;
      return false;
    }, {
      message: 'Command "playwright-was-here" output not found in terminal',
      timeout: 60000,
    }).toBe(true);

    console.log('Terminal interaction verified successfully!');
  });
});
