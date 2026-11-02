import { test, expect } from '@playwright/test';
import { mockText, positionKey } from './reader-fixtures.js';

test.use({ hasTouch: true });

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-10-11T12:00:00Z'));
  await page.addInitScript(() => localStorage.setItem('shnaim-mikra-guest-choice', 'true'));
  await mockText(page);
  await page.goto('/');
  await page.locator('#chumash').click();
  await page.locator('#reader-mode-cards').click();
});

async function drag(page, distance) {
  const box = await page.locator('#reader-card').boundingBox();
  const client = await page.context().newCDPSession(page);
  const x = box.x + box.width / 2, y = box.y + 70;
  const point = offset => [{ x: x + offset, y, id: 1 }];
  await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: point(0) });
  for (let step = 1; step <= 5; step++) {
    await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: point(distance * step / 5) });
    await new Promise(resolve => setTimeout(resolve, 16));
  }
  return {
    end: async () => {
      await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await client.detach();
    },
    cancel: async () => {
      await client.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
      await client.detach();
    },
  };
}

const pose = page => page.locator('#reader-card').evaluate(card => {
  const matrix = new DOMMatrixReadOnly(getComputedStyle(card).transform);
  return { x: matrix.m41, tilt: matrix.m12 };
});
const bookmark = page => page.evaluate(key => JSON.parse(localStorage.getItem(key)), positionKey('Noach'));

test('the card follows and tilts under the finger, revealing the next pasuk before committing', async ({ page }) => {
  const gesture = await drag(page, 115);
  const during = await page.evaluate(() => {
    const matrix = new DOMMatrixReadOnly(getComputedStyle(document.querySelector('#reader-card')).transform);
    const peek = document.querySelector('.reader-card-peek');
    return {
      x: matrix.m41, tilt: matrix.m12, width: document.documentElement.scrollWidth,
      current: document.querySelector('#reader-card .pasuk-ref').textContent,
      preview: peek.querySelector('.peek-pasuk-ref').textContent,
      hidden: peek.getAttribute('aria-hidden'), inert: peek.inert,
    };
  });
  await gesture.end();
  expect(during.x).toBeGreaterThan(100);
  expect(during.tilt).toBeGreaterThan(.05);
  expect(during.current).toBe('Bereishis 1:1');
  expect(during.preview).toBe('Bereishis 1:2');
  expect(during.hidden).toBe('true');
  expect(during.inert).toBe(true);
  expect(during.width).toBe(393);
  await expect(page.locator('#reader-card .pasuk-ref')).toHaveText('Bereishis 1:2');
  expect((await bookmark(page)).ref).toBe('1:2');
  await expect.poll(async () => Math.abs((await pose(page)).x)).toBeLessThan(.5);

  const backwards = await drag(page, -115);
  await expect.poll(async () => (await pose(page)).x).toBeLessThan(-100);
  await expect(page.locator('.peek-pasuk-ref')).toHaveText('Bereishis 1:1');
  await backwards.end();
  await expect(page.locator('#reader-card .pasuk-ref')).toHaveText('Bereishis 1:1');
});

test('short and cancelled drags spring back without saving a different verse', async ({ page }) => {
  const short = await drag(page, 35);
  await expect.poll(async () => (await pose(page)).x).toBeGreaterThan(25);
  await short.end();
  await expect.poll(async () => Math.abs((await pose(page)).x)).toBeLessThan(.5);
  await expect(page.locator('.pasuk-ref')).toHaveText('Bereishis 1:1');

  const cancelled = await drag(page, 110);
  await expect.poll(async () => (await pose(page)).x).toBeGreaterThan(90);
  await cancelled.cancel();
  await expect.poll(async () => Math.abs((await pose(page)).x)).toBeLessThan(.5);
  await expect(page.locator('.pasuk-ref')).toHaveText('Bereishis 1:1');
  expect((await bookmark(page))?.ref ?? '1:1').toBe('1:1');
});

test('a swipe past the first card resists the drag and returns to the start', async ({ page }) => {
  const gesture = await drag(page, -110);
  await expect.poll(async () => (await pose(page)).x).toBeLessThan(-5);
  expect((await pose(page)).x).toBeGreaterThan(-30);
  await gesture.end();
  await expect.poll(async () => Math.abs((await pose(page)).x)).toBeLessThan(.5);
  await expect(page.locator('.pasuk-ref')).toHaveText('Bereishis 1:1');
});

test('mouse dragging the card header works while Hebrew text stays selectable', async ({ page }) => {
  const box = await page.locator('#reader-card .pasuk-ref').boundingBox();
  await page.mouse.move(box.x + 20, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + 140, box.y + box.height / 2, { steps: 8 });
  await expect.poll(async () => (await pose(page)).x).toBeGreaterThan(100);
  await page.mouse.up();
  await expect(page.locator('.pasuk-ref')).toHaveText('Bereishis 1:2');
  await expect(page.locator('.pasuk-text').first()).toHaveCSS('user-select', 'auto');
});

test('changing aliyah cancels an outgoing throw so it cannot restore the old verse', async ({ page }) => {
  await page.locator('#reader-next').click();
  await page.locator('#reader-aliyah').selectOption('1');
  await page.waitForTimeout(350);
  await expect(page.locator('.pasuk-ref')).toHaveText('Bereishis 1:5');
  expect((await bookmark(page)).aliyah).toBe(1);
});

test('reduced motion keeps swipe navigation without moving or tilting the card', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const gesture = await drag(page, 115);
  expect(await pose(page)).toEqual({ x: 0, tilt: 0 });
  await gesture.end();
  await expect(page.locator('.pasuk-ref')).toHaveText('Bereishis 1:2');
  expect(await page.locator('#reader-card').evaluate(card => card.getAnimations().length)).toBe(0);
});
