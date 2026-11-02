import { checkedReadings, switchCommentary } from './fixtures.js';
import { wholeReadingPatch } from '../src/readings.js';
import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { mockAccount } from './account-helper.js';

const key = 'shnaim-mikra-v1';
const accountKey = 'shnaim-mikra-v2:account:11111111-1111-4111-8111-111111111111';
const seed = {
  israel: false, commentary: 'rashi', theme: 'forest-dark',
  progress: {
    '5786:Bereshit': checkedReadings('mikra1', 'mikra2', 'rashi'),
    '5787:Noach': checkedReadings('mikra1', 'onkelos'),
  },
};

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-10-11T12:00:00Z'));
  await page.goto('/');
  await page.getByRole('button', { name: 'Continue without an account' }).click();
});

async function seedProgress(page) {
  await page.evaluate(({ key, seed }) => localStorage.setItem(key, JSON.stringify(seed)), { key, seed });
  await page.reload();
}

test('custom peirush persists, keeps checkmarks, and appears in exports', async ({ page }) => {
  await seedProgress(page);
  await expect(page.locator('[data-reading-row="onkelos"] .reading-name')).toHaveText('Targum');
  await page.locator('#settings').click();
  await expect(page.getByLabel('Peirush', { exact: true })).toHaveValue('Rashi');
  await expect(page.locator('.settings-section h3')).toHaveCount(0);
  await page.getByLabel('Peirush', { exact: true }).fill('Ramban');
  await page.locator('#tracker').click();
  await expect(page.locator('#switch-commentary')).toHaveText('Switch to Ramban for this parsha');
  await page.reload();
  expect(await page.evaluate(key => JSON.parse(localStorage.getItem(key)).progress, key)).toEqual(seed.progress);
  await switchCommentary(page);
  await expect(page.locator('[data-reading-row="rashi"] .reading-name')).toHaveText('Ramban');
  await expect(page.locator('[data-reading="rashi"]')).toHaveAccessibleName('Noach, Ramban, Complete. Clear all seven aliyos');
  await expect(page.locator('[data-reading="rashi"]')).toHaveAttribute('aria-checked', 'true');
  await page.locator('#settings').click();
  await expect(page.getByLabel('Peirush', { exact: true })).toHaveValue('Ramban');
  const downloadPromise = page.waitForEvent('download');
  await page.locator('#export-progress').click();
  const download = await downloadPromise;
  expect(await readFile(await download.path(), 'utf8')).toContain('[x] Ramban');
});

test('the default choice in settings uses the custom peirush name', async ({ page }) => {
  await page.locator('#settings').click();
  await expect(page.getByLabel('After Mikra').locator('option')).toHaveText(['Targum', 'Rashi']);
  await page.getByLabel('Peirush', { exact: true }).fill('Ramban');
  await expect(page.getByLabel('After Mikra').locator('option')).toHaveText(['Targum', 'Ramban']);
  await page.getByLabel('After Mikra').selectOption('rashi');
  await page.reload();
  await page.locator('#settings').click();
  await expect(page.getByLabel('After Mikra')).toHaveValue('rashi');
  await expect(page.getByLabel('After Mikra').locator('option')).toHaveText(['Targum', 'Ramban']);
  await page.locator('#tracker').click();
  await expect(page.locator('[data-reading-row="rashi"] .reading-name')).toHaveText('Ramban');
});

test('peirush names render as text and blank names fall back to Rashi', async ({ page }) => {
  await page.locator('#settings').click();
  await page.getByLabel('Peirush', { exact: true }).fill('<img src=x onerror=alert(1)>');
  await page.locator('#tracker').click();
  await expect(page.locator('#switch-commentary')).toHaveText('Switch to <img src=x onerror=alert(1)> for this parsha');
  await switchCommentary(page);
  await expect(page.locator('[data-reading-row="rashi"] .reading-name')).toHaveText('<img src=x onerror=alert(1)>');
  await expect(page.locator('#reading img')).toHaveCount(0);
  await page.locator('#settings').click();
  await page.getByLabel('Peirush', { exact: true }).fill('   ');
  await page.locator('#tracker').click();
  await expect(page.locator('[data-reading-row="rashi"] .reading-name')).toHaveText('Rashi');
  await page.reload();
  await expect(page.locator('[data-reading-row="rashi"] .reading-name')).toHaveText('Rashi');
});

test('a crafted peirush name cannot inject markup through the parsha list', async ({ page }) => {
  const peirushName = '"><img src=x onerror="window.injected=true">';
  await page.evaluate(({ key, value }) => localStorage.setItem(key, JSON.stringify(value)), {
    key, value: { ...seed, peirushName, progress: { '5787:Noach': { rashi_1: true } } },
  });
  await page.reload();
  const row = page.locator('[data-parsha="Noach"]');
  await expect(row).toHaveAttribute('aria-label', new RegExp(`${peirushName.replace(/[?()]/g, '\\$&')}: 1 of 7 aliyos`));
  await expect(page.locator('img[src="x"]')).toHaveCount(0);
  expect(await page.evaluate(() => window.injected)).toBeUndefined();
});

test('a past cycle is labeled as past, without this week or a current parsha', async ({ page }) => {
  await page.locator('#settings').click();
  await page.locator('#cyear').selectOption('5786');
  await page.locator('#tracker').click();
  const summary = page.locator('.card.shabbos');
  await expect(summary.locator('h2')).toHaveText('Past cycle');
  await expect(summary.locator('.shabbos-count')).toHaveText('5786–87');
  await expect(summary.locator('.shabbos-date')).toHaveText('Ended October 4, 2026');
  await expect(page.locator('.weeklyprogress')).toHaveCount(0);
  await expect(page.locator('.yearprogress h2')).toHaveText('This cycle');
  await expect(page.locator('.parsharow.current')).toHaveCount(0);
  await expect(page.locator('.browsing')).toContainText('2026');
  await expect(page.locator('#back-to-week')).toHaveCount(0);
});

test('a future cycle says when it begins', async ({ page }) => {
  await page.locator('#settings').click();
  await page.locator('#cyear').selectOption('5788');
  await page.locator('#tracker').click();
  const summary = page.locator('.card.shabbos');
  await expect(summary.locator('h2')).toHaveText('Future cycle');
  await expect(summary.locator('.shabbos-date')).toHaveText(/^Begins .* 2027$/);
  await expect(page.locator('.parsharow.current')).toHaveCount(0);
});

test('default theme is grayscale', async ({ page }) => {
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'grayscale');
  await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(245, 245, 245)');
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', '#f5f5f5');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.locator('[data-theme-choice="grayscale"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('[data-theme-choice="forest"]')).toHaveAttribute('aria-pressed', 'false');
});

test('all themes apply immediately, persist, and keep progress', async ({ page }) => {
  await seedProgress(page);
  for (const [theme, background] of [['grayscale', 'rgb(245, 245, 245)'], ['dark-grayscale', 'rgb(23, 23, 23)'], ['forest', 'rgb(250, 249, 246)'], ['forest-dark', 'rgb(21, 24, 23)'], ['parchment', 'rgb(245, 239, 225)'], ['midnight', 'rgb(14, 19, 32)'], ['tekhelet', 'rgb(238, 243, 251)'], ['kinneret', 'rgb(11, 26, 30)'], ['jerusalem-stone', 'rgb(236, 231, 223)'], ['olive-press', 'rgb(21, 22, 14)'], ['pomegranate', 'rgb(251, 241, 241)'], ['havdalah', 'rgb(23, 16, 33)']]) {
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.locator(`[data-theme-choice="${theme}"]`).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    await expect(page.locator('body')).toHaveCSS('background-color', background);
    await expect(page.locator(`[data-theme-choice="${theme}"]`)).toHaveAttribute('aria-pressed', 'true');
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    expect(await page.evaluate(key => JSON.parse(localStorage.getItem(key)).progress, key)).toEqual(seed.progress);
  }
});

test('export downloads all cycles and each reading status', async ({ page }) => {
  await seedProgress(page);
  await page.locator('#settings').click();
  const downloadPromise = page.waitForEvent('download');
  await page.locator('#export-progress').click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('shnayim-mikra-progress-2026-10-11.txt');
  const text = await readFile(await download.path(), 'utf8');
  expect(text).toContain('Cycle 5786–5787');
  expect(text).toContain('Cycle 5787–5788');
  expect(text).toContain('Bereishis — Complete');
  expect(text).toContain('Noach — In progress');
  expect(text).toContain('[x] Rashi');
  expect(text).toContain('[x] Targum');
  expect(text).not.toContain('[ ] Targum');
  expect(text).not.toContain('[ ] Rashi');
  expect(text).toContain('[ ] Mikra II');
  expect(text).toContain('Completed: 1');
});

test('reset can be cancelled and clears every cycle while preserving settings', async ({ page }) => {
  await seedProgress(page);
  await page.locator('#settings').click();
  await page.locator('#delete-progress').click();
  await expect(page.locator('#cancel-delete')).toBeFocused();
  await page.locator('#cancel-delete').click();
  expect(await page.evaluate(key => JSON.parse(localStorage.getItem(key)).progress, key)).toEqual(seed.progress);
  await page.locator('#delete-progress').click();
  await page.locator('#confirm-delete').click();
  await expect(page.locator('#settings-status')).toContainText('All progress deleted');
  expect(await page.evaluate(key => JSON.parse(localStorage.getItem(key)), key)).toEqual({ ...seed, progress: {} });
  await page.reload();
  await expect(page.locator('[role="checkbox"][aria-checked="true"]')).toHaveCount(0);
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'forest-dark');
});

test('settings fits a small screen and every control can scroll clear of the tab bar', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await page.locator('#settings').click();
  await expect(page.locator('#settings')).toBeFocused();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  const last = await page.locator('#delete-progress').boundingBox();
  const bar = await page.locator('.tabbar').boundingBox();
  expect(last.y + last.height).toBeLessThanOrEqual(bar.y);
});


test('signed-in reset deletes all account cycles after pending writes finish', async ({ page }) => {
  const cloud = await mockAccount(page, { delayedWrite: true });
  const pendingWrite = page.waitForRequest(request => request.url().includes('/rest/v1/progress') && request.method() === 'POST');
  await page.locator('[data-reading="mikra1"]').click();
  await pendingWrite;
  await page.locator('#settings').click();
  await page.locator('#delete-progress').click();
  await page.locator('#confirm-delete').click();
  await expect(page.locator('#settings-status')).toContainText('All progress deleted');
  expect(cloud.getRows()).toEqual([]);
  const deletion = cloud.requests.find(r => r.method === 'DELETE');
  expect(new URL(deletion.url).searchParams.get('user_id')).toBe('eq.11111111-1111-4111-8111-111111111111');
  expect(new URL(deletion.url).searchParams.has('year')).toBe(false);
  await page.reload();
  await expect(page.locator('[role="checkbox"][aria-checked="true"]')).toHaveCount(0);
});

test('account edits to one half of a double week leave the other half unchanged', async ({ page }) => {
  const finished = checkedReadings('mikra1', 'mikra2', 'onkelos');
  const cloud = await mockAccount(page, { initialRows: [
    { year: 5787, parsha_id: 'Chukat', ...finished },
    { year: 5787, parsha_id: 'Balak', ...finished },
  ] });
  await page.locator('[data-sefer-tab="3"]').click();
  await page.locator('[data-parsha="Balak"]').click();
  for (const reading of ['mikra1', 'mikra2', 'onkelos']) {
    await page.locator(`[data-reading="${reading}"]`).click();
  }
  await expect.poll(() => cloud.getRows().find(row => row.parsha_id === 'Balak')).toMatchObject({
    ...wholeReadingPatch('mikra1', false), ...wholeReadingPatch('mikra2', false), ...wholeReadingPatch('onkelos', false),
  });
  expect(cloud.getRows().find(row => row.parsha_id === 'Chukat')).toMatchObject(finished);
  await page.reload();
  await expect(page.locator('#announcement')).toContainText('Progress synced');
  await page.locator('[data-sefer-tab="3"]').click();
  await expect(page.locator('[data-parsha="Chukat"]')).toHaveClass(/done/);
  await expect(page.locator('[data-parsha="Balak"]')).not.toHaveClass(/done/);
});

test('signed-in export includes remote cycles and unsynced device readings', async ({ page }) => {
  await mockAccount(page);
  await page.locator('[data-reading="mikra1"]').click();
  await page.locator('#settings').click();
  const downloadPromise = page.waitForEvent('download');
  await page.locator('#export-progress').click();
  const download = await downloadPromise;
  const text = await readFile(await download.path(), 'utf8');
  expect(text).toContain('Cycle 5786–5787');
  expect(text).toContain('Bereishis — Complete');
  expect(text).toContain('Cycle 5787–5788');
  expect(text).toContain('Noach — In progress');
});

test('failed cloud reset preserves local progress and shows a retryable error', async ({ page }) => {
  await mockAccount(page, { failDelete: true });
  await page.locator('[data-reading="mikra1"]').click();
  const before = await page.evaluate(key => JSON.parse(localStorage.getItem(key)).progress, accountKey);
  await page.locator('#settings').click();
  await page.locator('#delete-progress').click();
  await page.locator('#confirm-delete').click();
  await expect(page.locator('#delete-status')).toContainText('Could not delete');
  await expect(page.locator('#confirm-delete')).toBeEnabled();
  expect(await page.evaluate(key => JSON.parse(localStorage.getItem(key)).progress, accountKey)).toEqual(before);
});

test('settings save to the account and changes from another device apply here', async ({ page }) => {
  const cloud = await mockAccount(page);
  await page.locator('#settings').click();
  await page.locator('[data-theme-choice="midnight"]').click();
  await page.getByLabel('Peirush', { exact: true }).fill('Ramban');
  await page.getByLabel('Text size').selectOption('larger');
  await expect.poll(() => cloud.getProfile()).toMatchObject({ theme: 'midnight', peirush_name: 'Ramban', text_size: 'larger' });
  // A field being typed in is deliberately left alone by a background refresh.
  await page.getByLabel('Text size').focus();
  cloud.setProfile({ theme: 'parchment', peirush_name: 'Sforno', text_size: 'standard' });
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'parchment');
  await expect(page.locator('html')).toHaveAttribute('data-text-size', 'standard');
  await expect(page.locator('[data-theme-choice="parchment"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByLabel('Peirush', { exact: true })).toHaveValue('Sforno');
  await page.locator('#tracker').click();
  await expect(page.locator('#switch-commentary')).toHaveText('Switch to Sforno for this parsha');
});

test('a device with a saved theme fills an account that has none', async ({ page }) => {
  await page.evaluate(({ accountKey, seed }) => localStorage.setItem(accountKey, JSON.stringify({ ...seed, theme: 'midnight', storageVersion: 2, pending: { progress: {}, profile: {} } })), { accountKey, seed });
  const cloud = await mockAccount(page, { initialProfile: { theme: null } });
  await expect.poll(() => cloud.getProfile().theme).toBe('midnight');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'midnight');
});

test('sign out succeeds locally when the server cannot be reached', async ({ page }) => {
  await mockAccount(page);
  await page.route('**/auth/v1/logout*', route => route.abort());
  await page.locator('#account').click();
  await page.locator('#settings-signout').click();
  await expect(page.getByRole('heading', { name: 'Shnayim Mikra', exact: true })).toBeVisible();
  await expect(page.locator('#announcement')).toContainText('Signed out');
});

test('a stalled sync request times out instead of blocking sign out, and keeps the edit', async ({ page }) => {
  test.setTimeout(45000);
  await mockAccount(page);
  await page.route('**/rest/v1/**', () => { /* Never answer. */ });
  await page.locator('[data-reading="mikra1"]').click();
  await page.locator('#account').click();
  await page.locator('#settings-signout').click();
  await expect(page.getByRole('heading', { name: 'Shnayim Mikra', exact: true })).toBeVisible({ timeout: 25000 });
  await expect(page.locator('#announcement')).toContainText('Signed out');
  const saved = await page.evaluate(key => JSON.parse(localStorage.getItem(key)), accountKey);
  expect(saved.progress['5787:Noach'].mikra1_1).toBe(true);
  expect(saved.pending.progress['5787:Noach'].mikra1_1.value).toBe(true);
});

test('sign out flushes progress, ends only this session, and separates account data', async ({ page }) => {
  const cloud = await mockAccount(page);
  await page.locator('[data-reading="mikra1"]').click();
  await page.locator('#account').click();
  await page.locator('#settings-signout').click();
  await expect(page.getByRole('heading', { name: 'Shnayim Mikra', exact: true })).toBeVisible();
  await expect(page.locator('#announcement')).toContainText('Signed out');
  expect(cloud.requests.some(r => r.url.includes('/logout?scope=local'))).toBe(true);
  expect(cloud.getRows().some(r => r.parsha_id === 'Noach' && r.mikra1_1)).toBe(true);
  await page.reload();
  await page.getByRole('button', { name: 'Continue without an account' }).click();
  await expect(page.locator('[data-reading="mikra1"]')).toHaveAttribute('aria-checked', 'false');
  expect(await page.evaluate(key => JSON.parse(localStorage.getItem(key)).progress['5787:Noach'].mikra1_1, accountKey)).toBe(true);
});
