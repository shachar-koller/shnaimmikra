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

const lensFrames = page => page.locator('.tablens').evaluate(lens => {
  const [animation] = lens.getAnimations();
  return animation ? animation.effect.getKeyframes().map(frame => frame.transform) : [];
});

test('the lens glides on a spring and stretches on the way', async ({ page }) => {
  await page.locator('#account').click();
  const frames = await lensFrames(page);
  expect(frames[0]).toBe('translateX(0%) scale(1, 1)');
  expect(frames.at(-1)).toBe('translateX(300%) scale(1, 1)');
  expect(frames.some(frame => !frame.endsWith('scale(1, 1)'))).toBe(true);
});

test('a tap during a glide carries on from where the lens is', async ({ page }) => {
  await page.locator('#account').click();
  await page.locator('.tablens').evaluate(lens => {
    const [animation] = lens.getAnimations();
    animation.pause();
    animation.currentTime = 120;
    animation.play();
  });
  await page.locator('#tracker').click();
  const [start] = await lensFrames(page);
  const position = Number(start.match(/translateX\(([-\d.]+)%/)[1]);
  expect(position).toBeGreaterThan(100);
  expect(position).toBeLessThanOrEqual(310);
  expect(await page.locator('.tablens').evaluate(lens => lens.getAnimations().length)).toBe(1);
});

test('reduced motion moves the lens straight to its tab', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.locator('#settings').click();
  expect(await lensFrames(page)).toEqual([]);
  const lens = await page.locator('.tablens').boundingBox();
  const tab = await page.locator('#settings').boundingBox();
  expect(lens.x).toBe(tab.x);
  await expect(page.locator('.tabglint')).toBeHidden();
});

test('the refraction map is built for the bar\'s actual size', async ({ page }) => {
  const bar = await page.locator('.tabbar').boundingBox();
  const map = page.locator('#glass-refraction feImage');
  await expect(map).toHaveAttribute('width', String(bar.width));
  await expect(map).toHaveAttribute('height', String(bar.height));
  expect(await page.locator('.tabbar').evaluate(element => getComputedStyle(element, '::before').backdropFilter)).toContain('url(');
  await expect(page.locator('.glass-rim')).toBeHidden();
});

test('the filter survives a tab change, and the bar keeps one of each layer', async ({ page }) => {
  await page.locator('#settings').click();
  await page.locator('#tracker').click();
  await expect(page.locator('#glass-refraction')).toHaveCount(1);
  for (const layer of ['.glass-rim', '.tablens', '.tabglint', '.glass-edge']) await expect(page.locator(layer)).toHaveCount(1);
});

test('reduced transparency gives an opaque bar', async ({ page }) => {
  const session = await page.context().newCDPSession(page);
  await session.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-transparency', value: 'reduce' }] });
  const pane = await page.locator('.tabbar').evaluate(bar => {
    const style = getComputedStyle(bar, '::before');
    return { filter: style.backdropFilter, background: style.backgroundColor };
  });
  expect(pane.filter).toBe('none');
  expect(pane.background).toBe('rgb(255, 255, 255)');
});

test.describe('without refraction, as in Safari', () => {
  test.use({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1' });

  test('the pane blurs without the filter and its rim layer takes over', async ({ page }) => {
    await expect(page.locator('#glass-refraction')).toHaveCount(0);
    const filter = await page.locator('.tabbar').evaluate(bar => getComputedStyle(bar, '::before').backdropFilter);
    expect(filter).toContain('blur');
    expect(filter).not.toContain('url(');
    expect(await page.locator('.glass-rim').evaluate(rim => getComputedStyle(rim).display)).toBe('block');
  });
});

test('the glass slider changes the bar live, persists, and reaches both extremes', async ({ page }) => {
  const pane = () => page.locator('.tabbar').evaluate(bar => {
    const style = getComputedStyle(bar, '::before');
    return { filter: style.backdropFilter, background: style.backgroundColor };
  });
  const shift = () => page.locator('#glass-refraction [result="green-bent"]').getAttribute('scale');
  await page.locator('#settings').click();
  const slider = page.getByRole('slider', { name: 'Tab bar glass' });
  await expect(slider).toHaveValue('50');

  await slider.fill('0');
  expect((await pane()).filter).toContain('blur(28px)');
  expect((await pane()).background).toContain('0.97');
  expect(await shift()).toBe('0');

  await slider.fill('100');
  expect((await pane()).filter).toContain('blur(0px)');
  expect((await pane()).background).toMatch(/ 0\)$/);
  expect(await shift()).toBe('68');

  await page.reload();
  await page.locator('#settings').click();
  await expect(slider).toHaveValue('100');
  expect((await pane()).background).toMatch(/ 0\)$/);
  expect(await shift()).toBe('68');
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
  for (const theme of ['grayscale', 'dark-grayscale', 'forest', 'forest-dark', 'parchment', 'midnight', 'tekhelet', 'kinneret', 'jerusalem-stone', 'olive-press', 'pomegranate', 'havdalah']) {
    await page.locator('#settings').click();
    await page.locator(`[data-theme-choice="${theme}"]`).click();
    await page.locator('#tracker').click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const glass = await page.locator('.tabbar').evaluate(bar => getComputedStyle(bar, '::before').backdropFilter);
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
