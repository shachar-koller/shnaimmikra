import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
const key = 'shnaim-mikra-v1';

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-10-11T12:00:00Z'));
  await page.goto('/');
  await page.getByRole('button', { name: 'Continue without an account' }).click();
});

test('automatic appearance uses chosen themes, responds to device changes, and restores manual theme', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.locator('#settings').click();
  await page.locator('[data-theme-choice="forest"]').click();
  await page.getByRole('switch', { name: 'Follow device appearance' }).check();
  await page.getByRole('combobox', { name: 'Light theme', exact: true }).selectOption('parchment');
  await page.getByRole('combobox', { name: 'Dark theme', exact: true }).selectOption('midnight');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'parchment');
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'midnight');
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', '#0e1320');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'midnight');
  await page.locator('#settings').click();
  await page.getByRole('switch', { name: 'Follow device appearance' }).uncheck();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'forest');
});

test('larger text and naming persist across tracker, Chumash, and exports at small widths', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await page.locator('[data-sefer-tab="0"]').click();
  await page.locator('[data-parsha="Bereshit"]').click();
  await page.locator('[data-reading="mikra1"]').click();
  const standardSize = await page.locator('.reading-name').first().evaluate(element => parseFloat(getComputedStyle(element).fontSize));
  await page.locator('#settings').click();
  await page.getByLabel('Text size').selectOption('larger');
  await page.getByLabel('Parsha names').selectOption('sephardi');
  await page.locator('#tracker').click();
  await expect(page.locator('main h1')).toHaveText('Parashat Bereshit');
  expect(await page.locator('.reading-name').first().evaluate(element => parseFloat(getComputedStyle(element).fontSize))).toBeGreaterThan(standardSize);
  await expect(page.locator('[data-sefer-tab="0"]')).toHaveText('Bereshit');
  await page.locator('#chumash').click();
  await expect(page.locator('main h1')).toHaveText('Parashat Bereshit');
  await page.locator('#settings').click();
  const exported = page.waitForEvent('download');
  await page.locator('#export-progress').click();
  expect(await readFile(await (await exported).path(), 'utf8')).toContain('Bereshit — In progress');
  await page.getByLabel('Parsha names').selectOption('hebrew');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.locator('#tracker').click();
  await expect(page.locator('main h1')).toHaveText('פרשת בראשית');
  await expect(page.locator('main h1')).toHaveAttribute('lang', 'he');
  await expect(page.locator('.titlerow .he')).toHaveCount(0);
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-text-size', 'larger');
  await expect(page.locator('main h1')).toHaveText('פרשת נח');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.locator('#settings').click();
  await page.getByRole('switch', { name: 'Follow device appearance' }).check();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('completion effects can be disabled without losing progress or completion feedback', async ({ page }) => {
  await page.evaluate(() => {
    window.vibrations = [];
    Object.defineProperty(navigator, 'vibrate', { value: pattern => { window.vibrations.push(pattern); return true; } });
  });
  await page.locator('#settings').click();
  await page.getByRole('switch', { name: 'Completion confetti' }).uncheck();
  await page.getByRole('switch', { name: 'Vibration', exact: true }).uncheck();
  await page.locator('#tracker').click();
  for (const reading of ['mikra1', 'mikra2', 'onkelos']) await page.locator(`[data-reading="${reading}"]`).click();
  await expect(page.locator('.completion-feedback')).toContainText('Parsha complete');
  await expect(page.locator('.burst')).toHaveCount(0);
  expect(await page.evaluate(() => window.vibrations)).toEqual([]);
  await page.reload();
  await expect(page.locator('[data-reading="onkelos"]')).toHaveAttribute('aria-checked', 'true');
  await page.locator('#settings').click();
  await expect(page.getByRole('switch', { name: 'Completion confetti' })).not.toBeChecked();
  await expect(page.getByRole('switch', { name: 'Vibration', exact: true })).not.toBeChecked();
});

test('reminder days and time download as recurring calendar alerts and survive backup restore', async ({ page }) => {
  await page.locator('#settings').click();
  await expect(page.locator('#download-reminders')).toBeDisabled();
  await page.getByRole('button', { name: 'Monday', exact: true }).click();
  await page.getByRole('button', { name: 'Thursday', exact: true }).click();
  await page.getByLabel('Reminder time').fill('18:30');
  await page.getByLabel('Reminder time').press('Tab');
  const download = page.waitForEvent('download');
  await page.locator('#download-reminders').click();
  const file = await download;
  expect(file.suggestedFilename()).toBe('shnayim-mikra-reminders.ics');
  const calendar = await readFile(await file.path(), 'utf8');
  expect(calendar).toContain('RRULE:FREQ=WEEKLY;BYDAY=MO,TH');
  expect(calendar).toContain('DTSTART:20261012T183000');
  expect(calendar).toContain('TRIGGER:PT0S');
  await page.getByLabel('Text size').selectOption('larger');
  const backupDownload = page.waitForEvent('download');
  await page.locator('#backup-progress').click();
  const backup = await readFile(await (await backupDownload).path(), 'utf8');
  await page.getByRole('button', { name: 'Monday', exact: true }).click();
  await page.getByRole('button', { name: 'Thursday', exact: true }).click();
  await expect(page.locator('#download-reminders')).toBeDisabled();
  await page.getByLabel('Text size').selectOption('standard');
  await page.locator('#backup-file').setInputFiles({ name: 'backup.json', mimeType: 'application/json', buffer: Buffer.from(backup) });
  await page.locator('#confirm-import').click();
  await expect(page.getByRole('button', { name: 'Monday', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: 'Thursday', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByLabel('Reminder time')).toHaveValue('18:30');
  await expect(page.locator('html')).toHaveAttribute('data-text-size', 'larger');
  await page.reload();
  await page.locator('#settings').click();
  await expect(page.getByRole('button', { name: 'Monday', exact: true })).toHaveAttribute('aria-pressed', 'true');
  expect(await page.evaluate(key => JSON.parse(localStorage.getItem(key)).reminderDays, key)).toEqual([1, 4]);
});
