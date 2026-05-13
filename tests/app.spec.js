const { test, expect } = require('@playwright/test');
const path = require('path');

const indexUrl = `file://${path.resolve(__dirname, '../index.html')}`;

test.describe('BlurtForum JS Error & UI Test', () => {
  
  test('should load without JS errors and mount Vue app', async ({ page }) => {
    const errors = [];
    const consoleErrors = [];

    // Listen for unhandled exceptions
    page.on('pageerror', (err) => {
      errors.push(err.message);
    });

    // Listen for console errors
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text());
      }
    });

    await page.goto(indexUrl);

    // Wait for Vue to mount (the loader should be visible or the forum table)
    await expect(page.locator('#app')).toBeVisible();
    
    // Check if the logo exists as a proxy for successful rendering
    await expect(page.locator('.logo-title')).toContainText('Blurt');

    if (errors.length > 0) {
      throw new Error(`Page has JS errors: ${errors.join(', ')}`);
    }
    
    // Some console errors might be expected (e.g. failed RPC nodes), 
    // but unhandled exceptions definitely aren't.
    // We'll log console errors for visibility.
    if (consoleErrors.length > 0) {
      console.warn('Console errors detected (might be RPC issues):', consoleErrors);
    }
  });

  test('should switch themes correctly', async ({ page }) => {
    await page.goto(indexUrl);

    // Get the initial theme class (should be theme-subsilver by default)
    const body = page.locator('body');
    await expect(body).toHaveClass(/theme-subsilver/);

    // Click on "Modern" theme button
    await page.click('button:has-text("Modern")');
    await expect(body).toHaveClass(/theme-modern/);

    // Click on "Night" theme button
    await page.click('button:has-text("Night")');
    await expect(body).toHaveClass(/theme-deepnight/);

    // Click on "Ocean" theme button
    await page.click('button:has-text("Ocean")');
    await expect(body).toHaveClass(/theme-ocean/);
  });

  test('should show profile when username clicked', async ({ page }) => {
    await page.goto(indexUrl);
    
    // Wait for data to load (or at least some rows)
    // Since it's a real blockchain call, it might take a moment
    const userLink = page.locator('a[href="#"]').first();
    if (await userLink.isVisible()) {
        await userLink.click();
        // Check if profile view is visible
        await expect(page.locator('h2')).toContainText('@');
    }
  });
});
