import { test, expect } from '@playwright/test';
import { mockAccount } from './account-helper.js';

test('Google leads the welcome screen; guest choice and progress survive reload', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Shnayim Mikra', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Continue with Google' })).toBeVisible();
  await expect(page.locator('[data-reading]')).toHaveCount(0);
  await page.getByRole('button', { name: 'Continue without an account' }).click();
  await page.locator('[data-reading="mikra1"]').click();
  await page.reload();
  await expect(page.locator('[data-reading="mikra1"]')).toHaveAttribute('aria-checked', 'true');
  await page.getByRole('button', { name: 'Sign in with Google', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Sign in', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Continue with Google' })).toBeVisible();
});

test('Google button starts OAuth with the app origin as its return URL', async ({ page }) => {
  await page.route('**/auth/v1/authorize?**', route => route.fulfill({ body: 'Google redirect' }));
  await page.goto('/');
  const request = page.waitForRequest('**/auth/v1/authorize?**');
  await page.getByRole('button', { name: 'Continue with Google' }).click();
  const url = new URL((await request).url());
  expect(url.searchParams.get('provider')).toBe('google');
  expect(url.searchParams.get('redirect_to')).toBe('http://127.0.0.1:5175');
});

test('cancelled sign-in shows a retry and still allows guest access', async ({ page }) => {
  await page.goto('/#error=access_denied&error_description=User+cancelled');
  await expect(page.getByRole('status')).toContainText('Sign-in was not completed');
  await expect(page.getByRole('button', { name: 'Continue with Google' })).toBeEnabled();
  await page.getByRole('button', { name: 'Continue without an account' }).click();
  await expect(page.locator('#reading')).toBeVisible();
});

test('a guest who cancels sign-in stays in the tracker with a dismissible retry', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('shnaim-mikra-guest-choice', 'true'));
  await page.goto('/#error=access_denied&error_description=User+cancelled');
  await expect(page.locator('.welcome')).toHaveCount(0);
  await expect(page.getByRole('dialog', { name: 'Sign in', exact: true })).toBeVisible();
  await expect(page.locator('#auth-msg')).toContainText('Sign-in was not completed');
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(page.locator('#reading')).toBeVisible();
});

test('sign-in opens account progress, and an existing session skips welcome', async ({ page }) => {
  await page.goto('/');
  await mockAccount(page);
  await expect(page.locator('#reading')).toBeVisible();
  await expect(page.locator('#account')).toHaveAccessibleName('Account, reader@example.com');
  expect(await page.evaluate(() => localStorage.getItem('shnaim-mikra-guest-choice'))).toBeNull();
  await page.reload();
  await expect(page.locator('#account')).toHaveAccessibleName('Account, reader@example.com');
  await expect(page.locator('.welcome')).toHaveCount(0);
  await expect(page.locator('#announcement')).toContainText('Progress synced');
});
