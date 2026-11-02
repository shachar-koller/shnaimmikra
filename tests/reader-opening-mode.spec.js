import { test, expect } from '@playwright/test';
import { mockAccount } from './account-helper.js';
import { mockText } from './reader-fixtures.js';

const openingMode = page => page.getByLabel('Chumash opening mode');
const selectedMode = (page, mode) => expect(page.locator(`#reader-mode-${mode}`)).toHaveAttribute('aria-pressed', 'true');

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-10-11T12:00:00Z'));
  await page.addInitScript(() => localStorage.setItem('shnaim-mikra-guest-choice', 'true'));
  await mockText(page);
  await page.goto('/');
});

for (const preferred of ['cards', 'flow', 'classic']) {
  test(`${preferred} opens on entry and reload while manual switches keep the reading position`, async ({ page }) => {
    await page.locator('#settings').click();
    await openingMode(page).selectOption(preferred);
    await page.locator('#chumash').click();
    await selectedMode(page, preferred);
    await expect(page.locator(`#reader-body-${preferred}`)).toBeVisible();
    await page.locator('#reader-aliyah-2').click();

    const manual = preferred === 'cards' ? 'classic' : 'cards';
    await page.locator(`#reader-mode-${manual}`).click();
    await selectedMode(page, manual);
    // Navigating within this reading session must not reapply the preference.
    await page.locator('#reader-aliyah-3').click();
    await selectedMode(page, manual);
    await page.locator('#settings').click();
    await expect(openingMode(page)).toHaveValue(preferred);
    await page.locator('#chumash').click();
    await selectedMode(page, preferred);
    await expect(page.locator('#reader-aliyah-3')).toHaveAttribute('aria-current', 'true');
    await expect(page.locator('#reader-location')).toHaveText('Aliyah 4 · Pasuk 1 of 1');

    await page.locator(`#reader-mode-${manual}`).click();
    await page.reload();
    await selectedMode(page, preferred);
    await expect(page.locator('#reader-aliyah-3')).toHaveAttribute('aria-current', 'true');
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('shnaim-mikra-v1')).progress)).toEqual({});
  });
}

test('Last used preserves existing behavior and can be restored after choosing a fixed mode', async ({ page }) => {
  await page.locator('#settings').click();
  await expect(openingMode(page)).toHaveValue('last-used');
  await page.locator('#chumash').click();
  await selectedMode(page, 'flow');
  await page.locator('#reader-mode-cards').click();
  await page.locator('#reader-next').click();
  await expect(page.locator('.pasuk-ref')).toHaveText('Bereishis 1:2');
  await page.locator('#settings').click();
  await openingMode(page).selectOption('classic');
  await page.locator('#chumash').click();
  await selectedMode(page, 'classic');
  await expect(page.locator('#reader-location')).toHaveText('Aliyah 1 · Pasuk 2 of 4');
  await page.locator('#settings').click();
  await openingMode(page).selectOption('last-used');
  await page.locator('#chumash').click();
  await selectedMode(page, 'classic');
  await page.locator('#reader-mode-cards').click();
  await page.locator('#settings').click();
  await openingMode(page).selectOption('last-used');
  await page.locator('#chumash').click();
  await selectedMode(page, 'cards');
  await expect(page.locator('.pasuk-ref')).toHaveText('Bereishis 1:2');
  await page.reload();
  await selectedMode(page, 'cards');
  await expect(page.locator('.pasuk-ref')).toHaveText('Bereishis 1:2');
});

test('the opening preference syncs with the account without interrupting an open reading', async ({ page }) => {
  await page.locator('#settings').click();
  await openingMode(page).selectOption('flow');
  const cloud = await mockAccount(page);
  await page.locator('#settings').click();
  await expect(openingMode(page)).toHaveValue('last-used');
  await openingMode(page).selectOption('cards');
  await expect.poll(() => cloud.getProfile().default_reader_mode).toBe('cards');
  await page.locator('#chumash').click();
  await selectedMode(page, 'cards');

  cloud.setProfile({ default_reader_mode: 'classic' });
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect.poll(() => page.evaluate(() =>
    JSON.parse(localStorage.getItem('shnaim-mikra-v2:account:11111111-1111-4111-8111-111111111111')).defaultReaderMode)).toBe('classic');
  await selectedMode(page, 'cards');
  await page.locator('#settings').click();
  await expect(openingMode(page)).toHaveValue('classic');
  await page.locator('#chumash').click();
  await selectedMode(page, 'classic');

  await page.locator('#account').click();
  await page.locator('#settings-signout').click();
  await page.getByRole('button', { name: 'Continue without an account' }).click();
  await page.locator('#settings').click();
  await expect(openingMode(page)).toHaveValue('flow');
});
