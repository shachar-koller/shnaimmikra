import { test, expect } from '@playwright/test';
import { mockAccount } from './account-helper.js';
import { checkedReadings, switchCommentary } from './fixtures.js';

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-10-11T12:00:00Z'));
  await page.goto('/');
  await page.getByRole('button', { name: 'Continue without an account' }).click();
});

test('out-of-order aliyos persist, show mixed progress, and keep keyboard focus', async ({ page, context }) => {
  await expect(page.locator('#expand-mikra1')).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('#aliyos-mikra1')).toBeHidden();
  await page.locator('#expand-mikra1').click();
  await expect(page.locator('#aliyos-mikra1 [role="checkbox"]')).toHaveCount(7);
  await page.locator('#aliyah-mikra1-3').focus();
  await context.setOffline(true);
  await page.keyboard.press('Space');
  await expect(page.locator('#aliyah-mikra1-3')).toBeFocused();
  await expect(page.locator('#reading-mikra1')).toHaveAttribute('aria-checked', 'mixed');
  await expect(page.locator('#expand-mikra1 .reading-count')).toHaveText('1 of 7 aliyos');
  await expect(page.locator('#aliyah-mikra1-0')).toHaveAttribute('aria-checked', 'false');
  await expect(page.locator('.weeklyprogress .progressvalue')).toHaveText('0 / 3');
  await expect(page.locator('.weekly-detail')).toHaveText('Mikra I: 1 of 7 aliyos');
  await expect(page.locator('.parsharow.current .parshastatus')).toHaveText('In progress');
  await expect(page.locator('.parsharow.current .statusring')).toHaveClass(/partial/);
  await page.locator('#expand-mikra1').click();
  await expect(page.locator('#aliyos-mikra1')).toBeHidden();
  await page.locator('#expand-mikra1').click();
  await expect(page.locator('#aliyah-mikra1-3')).toHaveAttribute('aria-checked', 'true');
  await context.setOffline(false);
  await page.reload();
  await expect(page.locator('#expand-mikra1')).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('#expand-mikra1 .reading-count')).toHaveText('1 of 7 aliyos');
  await expect(page.locator('#aliyah-mikra1-3')).toHaveAttribute('aria-checked', 'true');
  await expect(page.locator('#aliyah-mikra1-0')).toHaveAttribute('aria-checked', 'false');
});

test('the reading checkbox marks a partial reading complete, then clears it', async ({ page }) => {
  await page.locator('#expand-mikra1').click();
  await page.locator('#aliyah-mikra1-1').click();
  await page.locator('#aliyah-mikra1-5').click();
  await page.locator('#reading-mikra1').click();
  await expect(page.locator('#aliyos-mikra1 [aria-checked="true"]')).toHaveCount(7);
  await expect(page.locator('#reading-mikra1')).toHaveAttribute('aria-checked', 'true');
  await expect(page.locator('#reading-mikra1')).toBeFocused();
  await page.locator('#reading-mikra1').click();
  await expect(page.locator('#reading-mikra1')).toHaveAttribute('aria-checked', 'false');
  await expect(page.locator('#aliyos-mikra1 [aria-checked="true"]')).toHaveCount(0);
  await expect(page.locator('#aliyos-mikra1')).toBeVisible();
  // Nothing pops up over the page after a whole-reading change.
  await expect(page.locator('#undo-status, #undo-reading')).toHaveCount(0);
});

test('switching carries the checks over, and they count toward completion', async ({ page }) => {
  await page.locator('#reading-mikra1').click();
  await page.locator('#reading-mikra2').click();
  await page.locator('#expand-onkelos').click();
  for (const index of [0, 1, 2]) await page.locator(`#aliyah-onkelos-${index}`).click();
  await switchCommentary(page);
  // The open checklist follows the switch instead of folding away.
  await expect(page.locator('#aliyos-rashi')).toBeVisible();
  await expect(page.locator('#reading-onkelos')).toHaveCount(0);
  await expect(page.locator('#expand-rashi .reading-count')).toHaveText('3 of 7 aliyos');
  await expect(page.locator('#aliyah-rashi-2')).toHaveAttribute('aria-checked', 'true');
  const stored = () => page.evaluate(() => JSON.parse(localStorage.getItem('shnaim-mikra-v1')).progress['5787:Noach']);
  expect(await stored()).toMatchObject({ rashi_1: true, rashi_2: true, rashi_3: true });
  expect(await stored()).not.toHaveProperty('onkelos_1');

  await page.reload();
  await expect(page.locator('#expand-rashi .reading-count')).toHaveText('3 of 7 aliyos');
  await page.locator('#expand-rashi').click();
  for (const index of [3, 4, 5, 6]) await page.locator(`#aliyah-rashi-${index}`).click();
  await expect(page.locator('.weeklyprogress .progressvalue')).toHaveText('3 / 3');
  await expect(page.locator('.parsharow.current')).toHaveClass(/done/);
  await expect(page.locator('.completion-feedback')).toContainText('Parsha complete');

  // A finished parsha stays finished, and switching back restores it exactly.
  await switchCommentary(page);
  await expect(page.locator('#reading-onkelos')).toHaveAttribute('aria-checked', 'true');
  await expect(page.locator('.parsharow.current')).toHaveClass(/done/);
  expect(await stored()).not.toHaveProperty('rashi_1');
});

test('with both sets saved, the further-along one shows and a switch keeps the other', async ({ page }) => {
  await page.evaluate(progress => localStorage.setItem('shnaim-mikra-v1', JSON.stringify({ progress })), {
    '5787:Noach': { onkelos_1: true, rashi_1: true, rashi_2: true, rashi_3: true },
  });
  await page.reload();
  await expect(page.locator('#expand-rashi .reading-count')).toHaveText('3 of 7 aliyos');
  await expect(page.locator('#reading-onkelos')).toHaveCount(0);
  await switchCommentary(page);
  await expect(page.locator('#expand-onkelos .reading-count')).toHaveText('3 of 7 aliyos');
  await expect(page.locator('.parsharow.current .parshastatus')).toHaveText('In progress');
  await switchCommentary(page);
  await expect(page.locator('#expand-rashi .reading-count')).toHaveText('3 of 7 aliyos');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('shnaim-mikra-v1')).progress['5787:Noach']))
    .toEqual({ onkelos_1: true, rashi_1: true, rashi_2: true, rashi_3: true });
});

test('deleting all progress also forgets per-parsha choices', async ({ page }) => {
  await switchCommentary(page);
  await expect(page.locator('[data-reading="rashi"]')).toHaveCount(1);
  await page.locator('#settings').click();
  await page.locator('#delete-progress').click();
  await page.locator('#confirm-delete').click();
  await expect(page.locator('#settings-status')).toContainText('All progress deleted');
  await page.locator('#tracker').click();
  await expect(page.locator('[data-reading="onkelos"]')).toHaveCount(1);
  await page.reload();
  await expect(page.locator('[data-reading="onkelos"]')).toHaveCount(1);
});

test('saved complete readings show seven checks and one uncheck updates every total', async ({ page }) => {
  await page.evaluate(progress => localStorage.setItem('shnaim-mikra-v1', JSON.stringify({ progress })), {
    '5787:Noach': checkedReadings('mikra1', 'mikra2', 'rashi', 'onkelos'),
  });
  await page.reload();
  await page.locator('#expand-mikra1').click();
  await expect(page.locator('#aliyos-mikra1 [aria-checked="true"]')).toHaveCount(7);
  await page.locator('#aliyah-mikra1-3').click();
  await expect(page.locator('#reading-mikra1')).toHaveAttribute('aria-checked', 'mixed');
  await expect(page.locator('.weeklyprogress .progressvalue')).toHaveText('2 / 3');
  await expect(page.locator('.bignum')).toHaveText('0 / 54');
  await page.reload();
  await expect(page.locator('#expand-mikra1 .reading-count')).toHaveText('6 of 7 aliyos');
  await expect(page.locator('#reading-onkelos')).toHaveAttribute('aria-checked', 'true');
  await switchCommentary(page);
  await expect(page.locator('#reading-rashi')).toHaveAttribute('aria-checked', 'true');
});

test('a cloud refresh shows the row its checks belong to after an initially empty account render', async ({ page }) => {
  await mockAccount(page, { initialRows: [{ year: 5787, parsha_id: 'Noach', rashi_3: true }] });
  await expect(page.locator('#reading-onkelos')).toHaveCount(0);
  await expect(page.locator('#expand-rashi .reading-count')).toHaveText('1 of 7 aliyos');
});

test('a switch syncs to the account, including moved checks', async ({ page }) => {
  const cloud = await mockAccount(page, { initialRows: [{ year: 5787, parsha_id: 'Noach', onkelos_2: true }] });
  await switchCommentary(page);
  await expect(page.locator('#expand-rashi .reading-count')).toHaveText('1 of 7 aliyos');
  await expect.poll(() => cloud.getRows().find(row => row.parsha_id === 'Noach')).toMatchObject({ onkelos_2: false, rashi_2: true });
});

test('a double week keeps independent study aliyos and combines only completed readings', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-04-12T12:00:00Z'));
  await page.reload();
  await expect(page.locator('h1')).toHaveText('Parshas Tazria');
  await expect(page.locator('#reading')).toContainText('Aliyos follow each parsha separately.');
  await page.locator('#expand-mikra1').click();
  await page.locator('#aliyah-mikra1-6').click();
  await page.locator('[data-parsha="Metzora"]').click();
  await expect(page.locator('#expand-mikra1')).toHaveAttribute('aria-expanded', 'false');
  await page.locator('#expand-mikra1').click();
  await page.locator('#aliyah-mikra1-0').click();
  await expect(page.locator('.weekly-detail')).toHaveText([
    'Tazria: Mikra I: 1 of 7 aliyos', 'Metzora: Mikra I: 1 of 7 aliyos',
  ]);
  await expect(page.locator('.weeklyprogress .progressvalue')).toHaveText('0 / 6');
  await page.locator('[data-parsha="Tazria"]').click();
  await expect(page.locator('#aliyah-mikra1-6')).toHaveAttribute('aria-checked', 'true');
  await expect(page.locator('#aliyah-mikra1-0')).toHaveAttribute('aria-checked', 'false');
});

test('partial aliyos survive JSON restore and exports describe the actual checks', async ({ page }) => {
  await page.locator('#expand-mikra1').click();
  await page.locator('#aliyah-mikra1-6').click();
  await page.locator('#settings').click();
  const downloaded = page.waitForEvent('download');
  await page.locator('#backup-progress').click();
  const backup = await downloaded;
  const path = await backup.path();
  await page.locator('#tracker').click();
  await page.locator('#reading-mikra1').click();
  await page.locator('#reading-mikra1').click();
  await page.locator('#aliyah-mikra1-0').click();
  await page.locator('#settings').click();
  await page.locator('#backup-file').setInputFiles(path);
  await expect(page.getByRole('dialog')).toContainText('1 aliyah checked');
  await page.locator('#confirm-import').click();
  await expect(page.locator('#settings-status')).toContainText('imported');
  await page.locator('#tracker').click();
  await expect(page.locator('#expand-mikra1 .reading-count')).toHaveText('2 of 7 aliyos');
  await expect(page.locator('#aliyah-mikra1-0')).toHaveAttribute('aria-checked', 'true');
  await expect(page.locator('#aliyah-mikra1-6')).toHaveAttribute('aria-checked', 'true');
});

test('all themes and long custom commentary names fit at 320px with either checkbox layout', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 900 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.locator('#settings').click();
  await page.getByLabel('Peirush', { exact: true }).fill('A very long custom commentary name to check wrapping on a narrow phone');
  await page.locator('#tracker').click();
  await switchCommentary(page);
  await page.locator('#expand-mikra1').click();
  for (const layout of ['left', 'right']) {
    await page.evaluate(layout => { document.querySelector('#app').dataset.checkboxLayout = layout; }, layout);
    for (const theme of ['grayscale', 'dark-grayscale', 'forest', 'forest-dark', 'parchment', 'midnight']) {
      await page.locator('#settings').click();
      await page.locator(`[data-theme-choice="${theme}"]`).click();
      await page.locator('#tracker').click();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      const boxes = await page.locator('#aliyos-mikra1 button').evaluateAll(elements => elements.map(element => element.getBoundingClientRect().height));
      expect(boxes.every(height => height >= 44)).toBe(true);
    }
  }
});

test('checklists start folded so a phone screen shows every reading at once', async ({ page }) => {
  for (const reading of ['mikra1', 'mikra2', 'onkelos']) {
    await expect(page.locator(`#expand-${reading}`)).toHaveAttribute('aria-expanded', 'false');
    await expect(page.locator(`#aliyos-${reading}`)).toBeHidden();
  }
  // Folded checklists are out of the tab order, not just out of sight.
  await page.locator('#reading-mikra1').focus();
  await page.keyboard.press('Tab');
  await expect(page.locator('#expand-mikra2')).toBeFocused();
  const folded = await page.locator('#reading').evaluate(card => card.getBoundingClientRect().bottom);
  expect(folded).toBeLessThan(page.viewportSize().height);
  // Unfolded, each aliyah is its own named row of the checklist.
  await page.locator('#expand-mikra1').click();
  await expect(page.locator('#aliyah-mikra1-6')).toBeVisible();
  await expect(page.locator('#aliyah-mikra1-6 .rlabel')).toHaveText("Shevi'i");
  await page.evaluate(() => Promise.allSettled(document.getAnimations().map(animation => animation.finished)));
  const tops = await page.locator('#aliyos-mikra1').evaluate(panel => [...panel.querySelectorAll('button')].map(button => button.getBoundingClientRect().top));
  expect(new Set(tops).size).toBe(7);
});

test('checking an aliyah row never pushes the page sideways on a narrow phone', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 800 });
  await page.locator('#expand-mikra1').click();
  await page.locator('#aliyah-mikra1-2').click();
  // Measured straight after the click, while the check's pop animation is running.
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.locator('#reading-mikra1').click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('folding and checking update elements in place so transitions can run', async ({ page }) => {
  await page.evaluate(() => { window.block = document.querySelector('[data-key="block-mikra1"]'); window.chip = document.querySelector('#aliyah-mikra1-2'); });
  await page.locator('#expand-mikra1').click();
  await page.locator('#aliyah-mikra1-2').click();
  await page.locator('#reading-mikra2').click();
  expect(await page.evaluate(() => window.block.isConnected && window.block === document.querySelector('[data-key="block-mikra1"]')
    && window.chip === document.querySelector('#aliyah-mikra1-2'))).toBe(true);
  await page.locator('#aliyah-mikra1-2').click();
  await page.locator('#aliyah-mikra1-2').click();
  await expect(page.locator('#aliyah-mikra1-2')).toHaveAttribute('aria-checked', 'true');
  await expect(page.locator('#expand-mikra1 .reading-count')).toHaveText('1 of 7 aliyos');
});

test('finishing the third reading celebrates once, and not with reduced motion', async ({ page }) => {
  await page.locator('#reading-mikra1').click();
  await page.locator('#reading-mikra2').click();
  await expect(page.locator('.burst')).toHaveCount(0);
  await page.locator('#reading-onkelos').click();
  await expect(page.locator('.burst')).toHaveCount(1);
  await expect(page.locator('#reading')).toHaveClass(/celebrate/);
  await expect(page.locator('.completion-feedback')).toContainText('Yasher koach');
  await expect(page.locator('.burst')).toHaveCount(0, { timeout: 3000 });
  await page.locator('#reading-onkelos').click();
  await expect(page.locator('#reading')).not.toHaveClass(/celebrate/);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.locator('#reading-onkelos').click();
  await expect(page.locator('.completion-feedback')).toContainText('Parsha complete');
  await expect(page.locator('.burst')).toHaveCount(0);
});

test('closing a dialog leaves no focusable or named copy behind', async ({ page }) => {
  await page.locator('#settings').click();
  await page.locator('#delete-progress').click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('#confirm-delete')).toHaveCount(0);
  await expect(page.locator('#delete-progress')).toBeFocused();
  await expect(page.locator('.dialog-exit')).toHaveCount(0);
});
