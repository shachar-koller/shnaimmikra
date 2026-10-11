import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

const key = 'shnaim-mikra-v1';
const seed = {
  israel: false, commentary: 'rashi', theme: 'forest-dark',
  progress: {
    '5786:Bereshit': { mikra1: true, mikra2: true, rashi: true },
    '5787:Noach': { mikra1: true, onkelos: true },
  },
};

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-10-11T12:00:00Z'));
  await page.goto('/');
});

async function seedProgress(page) {
  await page.evaluate(({ key, seed }) => localStorage.setItem(key, JSON.stringify(seed)), { key, seed });
  await page.reload();
}

test('custom peirush persists, keeps checkmarks, and appears in exports', async ({ page }) => {
  await seedProgress(page);
  await expect(page.locator('[data-reading="onkelos"]')).toHaveText('Onkelos');
  await page.locator('#settings').click();
  await expect(page.getByLabel('Peirush', { exact: true })).toHaveValue('Rashi');
  await expect(page.locator('.settings-section h3')).toHaveCount(0);
  await page.getByLabel('Peirush', { exact: true }).fill('Ramban');
  await page.locator('#save-settings').click();
  await expect(page.locator('[data-reading="rashi"]')).toHaveText('Ramban');
  await page.reload();
  await expect(page.locator('[data-reading="rashi"]')).toHaveAccessibleName('Ramban commentary, not done');
  expect(await page.evaluate(key => JSON.parse(localStorage.getItem(key)).progress, key)).toEqual(seed.progress);
  await expect(page.locator('[data-reading="onkelos"]')).toHaveAttribute('aria-checked', 'true');
  await page.locator('[data-reading="onkelos"]').click();
  await page.locator('[data-reading="rashi"]').click();
  await expect(page.locator('[data-reading="onkelos"]')).toBeDisabled();
  await page.locator('#settings').click();
  await expect(page.getByLabel('Peirush', { exact: true })).toHaveValue('Ramban');
  const downloadPromise = page.waitForEvent('download');
  await page.locator('#export-progress').click();
  const download = await downloadPromise;
  expect(await readFile(await download.path(), 'utf8')).toContain('[x] Ramban');
});

test('peirush names render as text and blank names fall back to Rashi', async ({ page }) => {
  await page.locator('#settings').click();
  await page.getByLabel('Peirush', { exact: true }).fill('<img src=x onerror=alert(1)>');
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-reading="rashi"]')).toHaveText('<img src=x onerror=alert(1)>');
  await expect(page.locator('[data-reading="rashi"] img')).toHaveCount(0);
  await page.locator('#settings').click();
  await page.getByLabel('Peirush', { exact: true }).fill('   ');
  await page.locator('#save-settings').click();
  await expect(page.locator('[data-reading="rashi"]')).toHaveText('Rashi');
  await page.reload();
  await expect(page.locator('[data-reading="rashi"]')).toHaveText('Rashi');
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
  for (const [theme, background] of [['grayscale', 'rgb(245, 245, 245)'], ['dark-grayscale', 'rgb(23, 23, 23)'], ['forest', 'rgb(250, 249, 246)'], ['forest-dark', 'rgb(21, 24, 23)']]) {
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.locator(`[data-theme-choice="${theme}"]`).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    await expect(page.locator('body')).toHaveCSS('background-color', background);
    await expect(page.locator(`[data-theme-choice="${theme}"]`)).toHaveAttribute('aria-pressed', 'true');
    await page.keyboard.press('Escape');
    await expect(page.getByRole('button', { name: 'Settings', exact: true })).toBeFocused();
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
  expect(text).toContain('[x] Targum (Onkelos)');
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

test('settings fits a small screen, scrolls, and traps keyboard focus', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await page.locator('#settings').click();
  await expect(page.locator('#save-settings')).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Close', exact: true })).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(page.locator('#save-settings')).toBeFocused();
  expect(await page.locator('.dialog').evaluate(el => ({
    fits: el.getBoundingClientRect().left >= 0 && el.getBoundingClientRect().right <= innerWidth,
    scrolls: el.querySelector('.settings-body').scrollHeight > el.querySelector('.settings-body').clientHeight,
    overflows: el.scrollWidth > el.clientWidth,
  }))).toEqual({ fits: true, scrolls: true, overflows: false });
});

async function mockAccount(page, { failDelete = false, delayedWrite = false, initialRows } = {}) {
  const userId = '11111111-1111-4111-8111-111111111111';
  const requests = [];
  let rows = initialRows || [{ year: 5786, parsha_id: 'Bereshit', mikra1: true, mikra2: true, rashi: true, onkelos: false }];
  await page.route('**/auth/v1/**', async route => {
    requests.push({ method: route.request().method(), url: route.request().url() });
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: userId, email: 'reader@example.com', app_metadata: {}, user_metadata: {}, aud: 'authenticated' }) });
  });
  await page.route('**/rest/v1/**', async route => {
    const request = route.request();
    requests.push({ method: request.method(), url: request.url() });
    const url = new URL(request.url());
    if (url.pathname.endsWith('/profiles')) {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(request.method() === 'GET' ? { israel: false, commentary: 'onkelos' } : {}) });
    } else if (request.method() === 'GET') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(rows) });
    } else if (request.method() === 'DELETE') {
      if (!failDelete) {
        const year = url.searchParams.get('year')?.slice(3);
        const parshaId = url.searchParams.get('parsha_id')?.slice(3);
        rows = rows.filter(row => (year && row.year !== Number(year)) || (parshaId && row.parsha_id !== parshaId));
      }
      await route.fulfill({ status: failDelete ? 500 : 204, body: failDelete ? JSON.stringify({ message: 'Test failure' }) : '' });
    } else {
      if (delayedWrite) await new Promise(resolve => setTimeout(resolve, 250));
      const incoming = request.postDataJSON();
      for (const row of Array.isArray(incoming) ? incoming : [incoming]) {
        rows = rows.filter(r => !(r.year === row.year && r.parsha_id === row.parsha_id));
        rows.push(row);
      }
      await route.fulfill({ status: 201, contentType: 'application/json', body: '{}' });
    }
  });
  const token = [Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url'), Buffer.from(JSON.stringify({ exp: 4102444800, sub: userId })).toString('base64url'), Buffer.from('test-signature').toString('base64url')].join('.');
  await page.evaluate(async token => {
    const { supabase } = await import('/src/auth.js');
    const { error } = await supabase.auth.setSession({ access_token: token, refresh_token: 'test-refresh' });
    if (error) throw error;
  }, token);
  await expect(page.locator('#announcement')).toContainText('Progress synced');
  return { requests, getRows: () => rows };
}

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

test('account migration replaces combined records before independent changes sync', async ({ page }) => {
  const cloud = await mockAccount(page, { initialRows: [
    { year: 5786, parsha_id: 'Tazria-Metzora', mikra1: true, mikra2: false, onkelos: false, rashi: false },
    { year: 5787, parsha_id: 'Chukat-Balak', mikra1: true, mikra2: true, onkelos: true, rashi: false },
    { year: 5787, parsha_id: 'Lech-Lecha', mikra1: true, mikra2: false, onkelos: false, rashi: false },
  ] });
  expect(cloud.getRows().map(row => `${row.year}:${row.parsha_id}`).sort()).toEqual([
    '5786:Metzora', '5786:Tazria', '5787:Balak', '5787:Chukat', '5787:Lech-Lecha',
  ]);
  const deletions = cloud.requests.filter(r => r.method === 'DELETE');
  expect(deletions).toHaveLength(2);
  for (const request of deletions) {
    const params = new URL(request.url).searchParams;
    expect(params.get('user_id')).toBe('eq.11111111-1111-4111-8111-111111111111');
    expect(params.has('year')).toBe(true);
    expect(params.has('parsha_id')).toBe(true);
  }

  await page.locator('[data-sefer-tab="3"]').click();
  await page.locator('[data-parsha="Balak"]').click();
  for (const reading of ['mikra1', 'mikra2', 'onkelos']) {
    await page.locator(`[data-reading="${reading}"]`).click();
  }
  await expect.poll(() => cloud.getRows().some(row => row.year === 5787 && row.parsha_id === 'Balak')).toBe(false);
  expect(cloud.getRows().find(row => row.year === 5787 && row.parsha_id === 'Chukat')).toMatchObject({ mikra1: true, mikra2: true, onkelos: true });
  await page.reload();
  await expect(page.locator('#announcement')).toContainText('device progress was merged');
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
  const before = await page.evaluate(key => JSON.parse(localStorage.getItem(key)).progress, key);
  await page.locator('#settings').click();
  await page.locator('#delete-progress').click();
  await page.locator('#confirm-delete').click();
  await expect(page.locator('#delete-status')).toContainText('Could not delete');
  await expect(page.locator('#confirm-delete')).toBeEnabled();
  expect(await page.evaluate(key => JSON.parse(localStorage.getItem(key)).progress, key)).toEqual(before);
});

test('sign out flushes progress, ends only this session, and keeps device data', async ({ page }) => {
  const cloud = await mockAccount(page);
  await page.locator('[data-reading="mikra1"]').click();
  await page.locator('#settings').click();
  await page.locator('#settings-signout').click();
  await expect(page.locator('#account')).toHaveText('Sign in');
  await expect(page.locator('#announcement')).toContainText('Signed out');
  expect(cloud.requests.some(r => r.url.includes('/logout?scope=local'))).toBe(true);
  expect(cloud.getRows().some(r => r.parsha_id === 'Noach' && r.mikra1)).toBe(true);
  await page.reload();
  await expect(page.locator('[data-reading="mikra1"]')).toHaveAttribute('aria-checked', 'true');
});
