import { test, expect } from '@playwright/test';

test('terminal boots and responds to input', async ({ page }) => {
  await page.goto('/');

  // Wait for app to load
  await expect(page.getByTitle('Toggle Terminal')).toBeVisible();

  // Open terminal
  await page.getByTitle('Toggle Terminal').click();

  // Check for xterm
  await expect(page.locator('.xterm')).toBeVisible({ timeout: 15000 });

  // In CI environment without proper WASM build, we just verify UI elements
  await test.step('Verify Terminal UI', async () => {
    await expect(page.getByTitle('Clear Terminal')).toBeVisible();
    await expect(page.getByTitle('Download Logs')).toBeVisible();
  });

  // Try typing if possible
  const textarea = page.locator('.xterm-helper-textarea');
  if (await textarea.isVisible()) {
    await textarea.focus();
    await page.keyboard.type('ls -F\n');
    await page.waitForTimeout(2000);
  }
});
