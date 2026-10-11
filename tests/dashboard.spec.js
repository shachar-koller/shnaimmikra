import { test, expect } from '@playwright/test';
import { schedule } from '../src/model.js';

const rows = schedule(5787, false);
const boundaries = [1, 13, 24, 34, 44, 55];
const seferRows = index => rows.filter(row => {
  const number = Array.isArray(row.num) ? row.num[0] : row.num;
  return number >= boundaries[index] && number < boundaries[index + 1];
});

test.beforeEach(async ({ page }) => {
  // Freeze only the test clock; application dates still come from Hebcal.
  await page.clock.setFixedTime(new Date('2026-10-11T12:00:00Z'));
  await page.goto('/');
});

test('reading progress updates the list and survives a reload', async ({ page }) => {
  const runtimeErrors = [];
  page.on('pageerror', error => runtimeErrors.push(error.message));
  await expect(page.locator('h1')).toHaveText('Parshas Noach');
  await expect(page.locator('.parshalist li:nth-child(-n+6) .parshaen')).toHaveText([
    'Bereishis', 'Noach', 'Lech Lecha', 'Vayeira', 'Chayei Sarah', 'Toldos',
  ]);
  await expect(page.locator('.cycle [lang="he"]')).toHaveCount(0);
  await expect(page.locator('.statusring.empty')).toHaveCount(12);
  await expect(page.locator('.parsharow.current')).toHaveAttribute('data-parsha', 'Noach');
  await expect(page.locator('.cyccount')).toHaveText('0/12');

  await page.locator('.parsharow[data-parsha="Bereshit"]').click();
  for (const reading of ['mikra1', 'mikra2', 'onkelos']) {
    await page.locator(`[data-reading="${reading}"]`).click();
  }
  await expect(page.locator('.parsharow[data-parsha="Bereshit"]')).toHaveClass(/done/);
  await expect(page.locator('.parsharow[data-parsha="Bereshit"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.cyccount')).toHaveText('1/12');
  await expect(page.locator('.bignum')).toHaveText(`1 / ${rows.length}`);

  await page.reload();
  await expect(page.locator('h1')).toHaveText('Parshas Noach');
  await expect(page.locator('.cyccount')).toHaveText('1/12');
  await expect(page.locator('.parsharow[data-parsha="Bereshit"]')).toHaveClass(/done/);
  await page.locator('.parsharow[data-parsha="Bereshit"]').click();
  await expect(page.locator('[role="checkbox"][aria-checked="true"]')).toHaveCount(3);

  await page.locator('[data-reading="onkelos"]').click();
  await expect(page.locator('.parsharow[data-parsha="Bereshit"]')).not.toHaveClass(/done/);
  await expect(page.locator('.parsharow[data-parsha="Bereshit"] .parshastatus')).toHaveText('2/3');
  await expect(page.locator('.cyccount')).toHaveText('0/12');
  await expect(page.locator('[role="checkbox"][aria-checked="true"]')).toHaveCount(2);
  expect(runtimeErrors).toEqual([]);
});

test('each sefer shows its full schedule and all parshiyos remain reachable', async ({ page }) => {
  for (let index = 0; index < 5; index++) {
    await page.locator(`[data-sefer-tab="${index}"]`).click();
    const expected = seferRows(index);
    await expect(page.locator('.parsharow')).toHaveCount(expected.length);
    await expect(page.locator('.cyccount')).toHaveText(`0/${expected.length}`);
    expect(await page.locator('.parsharow').evaluateAll(elements => elements.map(e => e.dataset.parsha)))
      .toEqual(expected.map(row => row.id));
  }
  await expect(page.locator('#browse, .progressstrip, .alltile')).toHaveCount(0);
  await page.locator('[data-sefer-tab="0"]').click();
  await page.locator('.parsharow[data-parsha="Vayechi"]').click();
  await expect(page.locator('h1')).toHaveText('Parshas Vayechi');
  // Selection follows the viewed reading; the current week stays on Noach.
  await expect(page.locator('.parsharow.current')).toHaveAttribute('data-parsha', 'Noach');
  await expect(page.locator('.parsharow.selected')).toHaveAttribute('data-parsha', 'Vayechi');
  await expect(page.locator('.parsharow.current')).toHaveAttribute('aria-pressed', 'false');
  await page.locator('[data-sefer-tab="4"]').click();
  await page.locator('.parsharow[data-parsha="Vezot Haberakhah"]').click();
  await expect(page.locator('h1')).toHaveText('Parshas Vezos Habrachah');
  await expect(page.locator('.sefertab.active')).toHaveAttribute('data-sefer-tab', '4');
  await page.locator('[data-sefer-tab="0"]').click();
  await page.locator('.parsharow.current').click();
  await expect(page.locator('h1')).toHaveText('Parshas Noach');
});

test('partial progress remains visible for the current and selected readings', async ({ page }) => {
  const weekly = page.locator('.parsharow[data-parsha="Noach"]');
  await page.locator('[data-reading="mikra1"]').click();
  await expect(weekly.locator('.parshastatus')).toHaveText('1/3');
  await expect(weekly.locator('.statusring')).toHaveClass(/partial/);
  await expect(page.locator('.weeklyprogress .progressvalue')).toHaveText('1 / 3');
  await expect(weekly.locator('.current-dot')).toHaveCount(1);
  await page.locator('[data-reading="mikra2"]').click();
  await expect(weekly.locator('.parshastatus')).toHaveText('2/3');
  await expect(page.locator('.weeklyprogress .progressvalue')).toHaveText('2 / 3');
  await page.locator('.parsharow[data-parsha="Bereshit"]').click();
  const selected = page.locator('.parsharow[data-parsha="Bereshit"]');
  await page.locator('[data-reading="rashi"]').click();
  await expect(selected.locator('.parshastatus')).toHaveText('1/3');
  // The summary continues to describe this week while editing another parsha.
  await expect(page.locator('.weeklyprogress .progressvalue')).toHaveText('2 / 3');
  await expect(selected).toHaveAccessibleName(/1 of 3 done, selected/);
  await expect(weekly).toHaveAccessibleName(/2 of 3 done, current parsha/);
  await expect(weekly).toHaveAttribute('aria-pressed', 'false');
  await page.reload();
  await expect(selected.locator('.parshastatus')).toHaveText('1/3');
  await expect(weekly.locator('.parshastatus')).toHaveText('2/3');
  await expect(weekly).toHaveAttribute('aria-pressed', 'true');
});

test('Rashi completion is stored and grays out Targum after reload', async ({ page }) => {
  for (const reading of ['mikra1', 'mikra2', 'rashi']) {
    await page.locator(`[data-reading="${reading}"]`).click();
  }
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('shnaim-mikra-v1')));
  expect(stored.progress['5787:Noach'].rashi).toBe(true);
  expect(stored.progress['5787:Noach'].onkelos).toBeFalsy();
  await page.reload();
  await expect(page.locator('[role="checkbox"][aria-checked="true"]')).toHaveCount(3);
  await expect(page.locator('.parsharow.current')).toHaveClass(/done/);
  await expect(page.locator('.parsharow.current .statusring.complete svg')).toHaveCount(1);
  await expect(page.locator('.weeklyprogress .progressvalue')).toHaveText('3 / 3');
  await expect(page.locator('[data-reading="rashi"]')).toHaveAttribute('aria-checked', 'true');
  await expect(page.locator('[data-reading="onkelos"]')).toBeDisabled();
});

test('commentary choices can be switched and remain specific to each week', async ({ page }) => {
  const rashi = page.locator('[data-reading="rashi"]');
  const targum = page.locator('[data-reading="onkelos"]');
  await expect(rashi).toBeEnabled();
  await expect(targum).toBeEnabled();
  await rashi.click();
  await expect(targum).toBeDisabled();
  // Clicking the disabled option's label must not record the other choice.
  await page.locator('[data-reading-row="onkelos"] .rlabel').dispatchEvent('click');
  await expect(targum).toHaveAttribute('aria-checked', 'false');
  await rashi.click();
  await expect(targum).toBeEnabled();
  await targum.focus();
  await page.keyboard.press('Space');
  await expect(targum).toHaveAttribute('aria-checked', 'true');
  await expect(rashi).toBeDisabled();

  await page.locator('.parsharow[data-parsha="Bereshit"]').click();
  await expect(rashi).toBeEnabled();
  await expect(targum).toBeEnabled();
  await rashi.click();
  await page.reload();
  await expect(targum).toHaveAttribute('aria-checked', 'true');
  await expect(rashi).toBeDisabled();
  await page.locator('.parsharow[data-parsha="Bereshit"]').click();
  await expect(rashi).toHaveAttribute('aria-checked', 'true');
  await expect(targum).toBeDisabled();
  await rashi.click();
  await expect(rashi).toBeEnabled();
  await expect(targum).toBeEnabled();
});

test('existing commentary records appear in their corresponding checkbox', async ({ page }) => {
  await page.evaluate(() => localStorage.setItem('shnaim-mikra-v1', JSON.stringify({
    israel: false,
    commentary: 'rashi',
    progress: { '5787:Noach': { mikra1: true, mikra2: true, onkelos: true } },
  })));
  await page.reload();
  await expect(page.locator('[data-reading="onkelos"]')).toHaveAttribute('aria-checked', 'true');
  await expect(page.locator('[data-reading="rashi"]')).toBeDisabled();
  await expect(page.locator('.cyccount')).toHaveText('1/12');
});

for (const width of [320, 360, 393, 440, 768, 1280]) {
  test(`full list stays aligned with no overflow at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    for (let index = 0; index < 5; index++) {
      await page.locator(`[data-sefer-tab="${index}"]`).click();
      const layout = await page.evaluate(() => ({
        overflow: document.documentElement.scrollWidth > innerWidth,
        hebrewNames: document.querySelectorAll('.cycle [lang="he"]').length,
        rings: document.querySelectorAll('.statusring').length,
        rows: document.querySelectorAll('.parsharow').length,
        englishColumns: [...document.querySelectorAll('.parshaen')].map(e => e.getBoundingClientRect().left),
        list: document.querySelector('.parshalist').getBoundingClientRect().right,
        card: document.querySelector('.cycle').getBoundingClientRect().right,
      }));
      expect(layout.overflow).toBe(false);
      expect(layout.hebrewNames).toBe(0);
      expect(layout.rings).toBe(layout.rows);
      expect(new Set(layout.englishColumns).size).toBe(1);
      expect(layout.list).toBeLessThan(layout.card);
    }
    const tabs = await page.locator('.sefertab').evaluateAll(elements => elements.map(e => {
      const rect = e.getBoundingClientRect();
      const nav = e.parentElement.getBoundingClientRect();
      return { top: rect.top, fits: rect.left >= nav.left && rect.right <= nav.right && e.scrollWidth <= e.clientWidth };
    }));
    expect(tabs).toHaveLength(5);
    expect(new Set(tabs.map(tab => tab.top)).size).toBe(1);
    expect(tabs.every(tab => tab.fits)).toBe(true);
    await expect(page.locator('[data-sefer-tab="4"]')).toBeInViewport();
  });
}
