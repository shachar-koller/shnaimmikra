import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('shnaim-mikra-guest-choice', 'true'));
});

test.describe('parsha highlighting on touch devices', () => {
  test.use({ viewport: { width: 393, height: 852 }, isMobile: true, hasTouch: true });

  test('a lingering hover cannot highlight an unselected parsha', async ({ page }) => {
    await page.clock.setFixedTime(new Date('2026-10-11T12:00:00Z'));
    await page.goto('/');
    expect(await page.evaluate(() => matchMedia('(hover: hover)').matches)).toBe(false);

    for (const [id, title] of [
      ['Lech-Lecha', 'Parshas Lech Lecha'],
      ['Chayei Sara', 'Parshas Chayei Sarah'],
      ['Noach', 'Parshas Noach'],
    ]) {
      const selected = page.locator(`[data-parsha="${id}"]`);
      await selected.tap();
      await expect(page.locator('h1')).toHaveText(title);
      await expect(page.locator('.parsharow.selected')).toHaveCount(1);
      await expect(selected).toHaveAttribute('aria-pressed', 'true');
      await expect(selected).toHaveCSS('background-color', 'rgb(231, 231, 231)');

      // Force the :hover state that touch browsers can retain after a tap.
      const unselected = page.locator(`[data-parsha="${id === 'Noach' ? 'Lech-Lecha' : 'Noach'}"]`);
      await unselected.hover();
      expect(await unselected.evaluate(row => ({
        hovered: row.matches(':hover'),
        selected: row.getAttribute('aria-pressed'),
        background: getComputedStyle(row).backgroundColor,
      }))).toEqual({ hovered: true, selected: 'false', background: 'rgba(0, 0, 0, 0)' });
      await expect(selected).toHaveCSS('background-color', 'rgb(231, 231, 231)');
    }
  });
});

test('mouse hover feedback preserves the selected parsha highlight', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-10-11T12:00:00Z'));
  await page.goto('/');
  await page.locator('[data-parsha="Lech-Lecha"]').hover();
  await expect(page.locator('[data-parsha="Lech-Lecha"]')).toHaveCSS('background-color', 'rgb(240, 240, 240)');
  await expect(page.locator('.parsharow.selected')).toHaveAttribute('data-parsha', 'Noach');
  await expect(page.locator('.parsharow.selected')).toHaveCSS('background-color', 'rgb(231, 231, 231)');
});

for (const width of [393, 1280]) {
  test.describe(`stable interactions at ${width}px`, () => {
    test.use({ viewport: { width, height: 700 } });

    test.beforeEach(async ({ page }) => {
      await page.clock.setFixedTime(new Date('2026-10-11T12:00:00Z'));
      await page.goto('/');
    });

    test('parsha selection keeps the clicked row in place and focused', async ({ page }) => {
      // Initially current parsha is selected with grey background.
      await expect(page.locator('.parsharow.selected')).toHaveCSS('background-color', 'rgb(231, 231, 231)');
      // Include a week with progress and a heading that wraps on phones.
      await page.locator('[data-reading="mikra1"]').click();
      for (const id of ['Chayei Sara', 'Bereshit', 'Noach']) {
        const row = page.locator(`[data-parsha="${id}"]`);
        await row.scrollIntoViewIfNeeded();
        const before = await row.boundingBox();
        await row.click();
        await expect(row).toHaveAttribute('aria-pressed', 'true');
        await expect(row).toHaveCSS('background-color', 'rgb(231, 231, 231)');
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
