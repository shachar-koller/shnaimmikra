import { test, expect } from '@playwright/test';

for (const width of [393, 1280]) {
  test.describe(`stable interactions at ${width}px`, () => {
    test.use({ viewport: { width, height: 700 } });

    test.beforeEach(async ({ page }) => {
      await page.clock.setFixedTime(new Date('2026-10-11T12:00:00Z'));
      await page.goto('/');
    });

    test('parsha selection keeps the clicked row in place and focused', async ({ page }) => {
      // Include a week with progress and a heading that wraps on phones.
      await page.locator('[data-reading="mikra1"]').click();
      for (const id of ['Chayei Sara', 'Bereshit', 'Noach']) {
        const row = page.locator(`[data-parsha="${id}"]`);
        await row.scrollIntoViewIfNeeded();
        const before = await row.boundingBox();
        await row.click();
        await expect(row).toHaveAttribute('aria-pressed', 'true');
        await expect(row).toBeFocused();
        await expect(row).toHaveCSS('outline-style', 'none');
        await expect(row.locator('.parshanum')).toHaveCSS('box-shadow', 'none');
        await expect(row.locator('.parshanum')).toHaveCSS('outline-style', 'none');
        await expect(page.locator('[data-reading-row="mikra1"]')).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
        await expect(page.locator('[data-reading="mikra1"]')).toHaveAttribute('aria-checked', String(id === 'Noach'));
        const after = await row.boundingBox();
        expect(Math.abs(after.y - before.y)).toBeLessThan(1);
        await expect(page.locator('#announcement')).toContainText('selected');
      }
      await page.reload();
      await expect(page.locator('[data-reading="mikra1"]')).toHaveAttribute('aria-checked', 'true');
    });

    test('checking and unchecking progress keeps the cards in place', async ({ page }) => {
      const positions = () => page.evaluate(() =>
        ['#reading', '.sidecol', '.cycle'].map(selector => {
          const rect = document.querySelector(selector).getBoundingClientRect();
          return { top: rect.top, height: rect.height };
        }),
      );
      const before = await positions();
      await expect(page.locator('#reset-week')).toHaveCount(0);
      await page.locator('[data-reading="mikra1"]').click();
      await expect(page.locator('#reset-week')).toHaveCount(0);
      expect(await positions()).toEqual(before);
      await page.locator('[data-reading="mikra1"]').click();
      await expect(page.locator('[data-reading="mikra1"]')).toHaveAttribute('aria-checked', 'false');
      await expect(page.locator('[data-reading="mikra1"]')).toBeFocused();
      await expect(page.locator('[data-reading-row="mikra1"]')).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
      expect(await positions()).toEqual(before);
    });

    test('keyboard focus stays visible when selecting and completing a parsha', async ({ page }) => {
      const row = page.locator('[data-parsha="Vayishlach"]');
      await row.focus();
      await page.keyboard.press('Enter');
      await expect(row).toBeFocused();
      await expect(row).toHaveCSS('outline-style', 'solid');
      await expect(page.locator('[data-reading="mikra1"]')).toHaveAttribute('aria-checked', 'false');

      // Tab backwards from the list to the readings, as a keyboard user would.
      const firstReading = page.locator('[data-reading="mikra1"]');
      for (let tabs = 0; tabs < 30; tabs++) {
        if (await firstReading.evaluate(element => element === document.activeElement)) break;
        await page.keyboard.press('Shift+Tab');
      }
      await expect(firstReading).toBeFocused();
      await expect(firstReading).toHaveCSS('outline-style', 'solid');
      for (const reading of ['mikra1', 'mikra2', 'rashi']) {
        await page.locator(`[data-reading="${reading}"]`).focus();
        await page.keyboard.press('Space');
      }
      await expect(row).toHaveClass(/done/);
      await expect(row.locator('.parshanum')).toHaveCSS('outline-style', 'none');
    });
  });
}
