import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

const parsha = (page, id) => page.locator(`.parsharow[data-parsha="${id}"]`);

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-04-12T12:00:00Z'));
  await page.goto('/');
  await page.getByRole('button', { name: 'Continue without an account' }).click();
});

test('one half of a double week can be completed while the other stays unfinished', async ({ page }) => {
  await expect(page.locator('h1')).toHaveText('Parshas Tazria');
  await expect(page.locator('.parsharow.current')).toHaveCount(2);
  await expect(parsha(page, 'Tazria')).toHaveAttribute('aria-current', 'true');
  await expect(parsha(page, 'Metzora')).toHaveAttribute('aria-current', 'true');
  await expect(page.locator('.cyccount')).toHaveText('0/10');
  await expect(page.locator('.weeklyprogress .progressvalue')).toHaveText('0 / 6');
  await expect(page.locator('.weeklyprogress .bigsub')).toHaveText('Tazria – Metzora readings');

  for (const reading of ['mikra1', 'mikra2', 'onkelos']) {
    await page.locator(`[data-reading="${reading}"]`).click();
  }
  await expect(parsha(page, 'Tazria')).toHaveClass(/done/);
  await expect(parsha(page, 'Metzora')).not.toHaveClass(/done/);
  await expect(page.locator('.bignum')).toHaveText('1 / 54');
  await expect(page.locator('.weeklyprogress .progressvalue')).toHaveText('3 / 6');
  await expect(page.locator('.weeksegments .filled')).toHaveCount(3);
  await parsha(page, 'Metzora').click();
  await expect(page.locator('h1')).toHaveText('Parshas Metzora');
  await expect(page.locator('[data-reading][aria-checked="true"]')).toHaveCount(0);
  await page.locator('[data-reading="mikra1"]').click();
  await expect(page.locator('.weeklyprogress .progressvalue')).toHaveText('4 / 6');
  await expect(parsha(page, 'Metzora')).toHaveAccessibleName(/1 of 3 done/);

  await page.reload();
  await expect(parsha(page, 'Tazria')).toHaveClass(/done/);
  await expect(parsha(page, 'Metzora')).not.toHaveClass(/done/);
  await expect(parsha(page, 'Metzora').locator('.parshastatus')).toHaveText('1/3 readings');
  await expect(page.locator('.weeklyprogress .progressvalue')).toHaveText('4 / 6');

  await page.clock.setFixedTime(new Date('2026-04-19T12:00:00Z'));
  await page.reload();
  await expect(page.locator('h1')).toHaveText('Parshas Acharei Mos');
  await expect(page.locator('.weeklyprogress .progressvalue')).toHaveText('0 / 6');
  await expect(parsha(page, 'Tazria')).toHaveClass(/done/);
  await expect(parsha(page, 'Metzora').locator('.parshastatus')).toHaveText('1/3 readings');
});

test('export includes each half of a double week independently', async ({ page }) => {
  for (const reading of ['mikra1', 'mikra2', 'onkelos']) {
    await page.locator(`[data-reading="${reading}"]`).click();
  }
  await parsha(page, 'Metzora').click();
  await page.locator('[data-reading="mikra1"]').click();
  await page.locator('#settings').click();
  const downloadPromise = page.waitForEvent('download');
  await page.locator('#export-progress').click();
  const download = await downloadPromise;
  const text = await readFile(await download.path(), 'utf8');
  expect(text).toContain('Tazria — Complete');
  expect(text).toContain('Metzora — In progress');
  expect(text).not.toContain('Tazria-Metzora');
});
