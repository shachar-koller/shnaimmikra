import { test, expect } from '@playwright/test';
import { mockAccount } from './account-helper.js';

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-10-11T12:00:00Z'));
  await page.addInitScript(() => { if (!location.search.includes('welcome')) localStorage.setItem('shnaim-mikra-guest-choice', 'true'); });
  await page.goto('/');
});

test('the tab bar switches between all four pages and marks the current one', async ({ page }) => {
  const nav = page.getByRole('navigation', { name: 'Main' });
  await expect(nav.getByRole('button')).toHaveText(['Tracker', 'Chumash', 'Settings', 'Account']);
  await expect(page.locator('#tracker')).toHaveAttribute('aria-current', 'page');
  await expect(page.locator('#reading')).toBeVisible();

  await page.locator('#chumash').click();
  await expect(page.locator('#panel-chumash')).toContainText('Parshas Noach');
  await expect(page.locator('#reading')).toHaveCount(0);
  await page.locator('#settings').click();
  await expect(page.locator('#peirush-name')).toBeVisible();
  await page.locator('#account').click();
  await expect(page.locator('#settings-signin')).toBeVisible();
  await expect(page.locator('#peirush-name')).toHaveCount(0);

  await expect(page.locator('[aria-current="page"]')).toHaveCount(1);
  await expect(page.locator('#account')).toHaveAttribute('aria-current', 'page');
  await expect(page.locator('#account')).toBeFocused();
});

test('the lens element survives a tab change, so it can slide', async ({ page }) => {
  await page.evaluate(() => { window.lens = document.querySelector('.tablens'); });
  await page.locator('#settings').click();
  expect(await page.evaluate(() => window.lens === document.querySelector('.tablens'))).toBe(true);
  await expect(page.locator('.tabbar')).toHaveAttribute('style', '--active:2');
});

test('the chumash tab follows the parsha selected in the tracker', async ({ page }) => {
  await page.locator('[data-parsha="Lech-Lecha"]').click();
  await page.locator('#chumash').click();
  await expect(page.locator('#panel-chumash h1')).toHaveText('Parshas Lech Lecha');
});

test('returning to the tracker restores its scroll, selection, and open checklists', async ({ page }) => {
  await page.locator('#expand-mikra1').click();
  await page.locator('[data-parsha="Toldot"]').click();
  const top = await page.evaluate(() => { window.scrollTo(0, 400); return window.scrollY; });
  await page.locator('#settings').click();
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  await page.locator('#tracker').click();
  expect(await page.evaluate(() => window.scrollY)).toBe(top);
  await expect(page.locator('.parsharow.selected')).toHaveAttribute('data-parsha', 'Toldot');
});

test('the bar is hidden on the welcome screen', async ({ page }) => {
  await page.evaluate(() => localStorage.removeItem('shnaim-mikra-guest-choice'));
  await page.goto('/?welcome');
  await expect(page.locator('.welcome')).toBeVisible();
  await expect(page.locator('.tabbar')).toHaveCount(0);
});

test('the last tracker row can scroll clear of the bar, with glass in every theme', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  for (const theme of ['grayscale', 'dark-grayscale', 'forest', 'forest-dark', 'parchment', 'midnight']) {
    await page.locator('#settings').click();
    await page.locator(`[data-theme-choice="${theme}"]`).click();
    await page.locator('#tracker').click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const glass = await page.locator('.tabbar').evaluate(bar => getComputedStyle(bar).backdropFilter);
    expect(glass).toContain('blur');
  }
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  const last = await page.locator('.parsharow').last().boundingBox();
  const bar = await page.locator('.tabbar').boundingBox();
  expect(last.y + last.height).toBeLessThanOrEqual(bar.y);
});

test('a dialog opens above the bar and blocks it', async ({ page }) => {
  await page.locator('#settings').click();
  await page.locator('#delete-progress').click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.locator('#tracker').click({ timeout: 500 })).rejects.toThrow();
  await page.locator('#cancel-delete').click();
  await expect(page.locator('#delete-progress')).toBeFocused();
});

test('the account tab shows who is signed in and survives a background sync', async ({ page }) => {
  await mockAccount(page);
  await expect(page.locator('#account')).toHaveAccessibleName('Account, reader@example.com');
  await expect(page.locator('#account .tab-avatar')).toHaveText('R');
  await page.locator('#account').click();
  await expect(page.locator('.settings-email')).toHaveText('reader@example.com');
  await page.locator('#retry-sync').click();
  await expect(page.locator('#settings-status')).toHaveText('Progress synced.');
  await expect(page.locator('#sync-status')).toHaveText('Saved to your account');
});
