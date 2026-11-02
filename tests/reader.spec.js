import { test, expect } from '@playwright/test';
import { mockAccount } from './account-helper.js';
import { mockText, parshaFixture, positionKey, targumWord, torahWord, touchStroke } from './reader-fixtures.js';

const GUEST_KEY = 'shnaim-mikra-v1';
const progressOf = (page, id = 'Noach', year = 5787) => page.evaluate(([key, entry]) =>
  JSON.parse(localStorage.getItem(key) || '{}').progress?.[entry] ?? {}, [GUEST_KEY, `${year}:${id}`]);
const savedPosition = (page, id = 'Noach') => page.evaluate(key => JSON.parse(localStorage.getItem(key)), positionKey(id));
const location = page => page.locator('#reader-location');
const mode = (page, name) => page.locator(`#reader-mode-${name}`).click();
const scrollToVerse = async (page, ref, part = 'first') => {
  await page.locator(`[data-ref="${ref}"][data-part="${part}"], [data-verse="${ref}"]`).first().waitFor();
  await page.evaluate(([verse, name]) => {
    const element = document.querySelector(`[data-ref="${verse}"][data-part="${name}"], [data-verse="${verse}"]`);
    const bar = document.querySelector('.reader-bar');
    window.scrollTo({ top: element.getBoundingClientRect().top + scrollY - bar.offsetHeight - 8, behavior: 'instant' });
  }, [ref, part]);
};
const verseTop = (page, ref, part = 'first') => page.evaluate(([verse, name]) => {
  const element = document.querySelector(`[data-ref="${verse}"][data-part="${name}"], [data-verse="${verse}"]`);
  return element.getBoundingClientRect().top - document.querySelector('.reader-bar').getBoundingClientRect().bottom;
}, [ref, part]);

let text;

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-10-11T12:00:00Z'));
  await page.addInitScript(() => localStorage.setItem('shnaim-mikra-guest-choice', 'true'));
  text = await mockText(page);
  await page.goto('/');
});

test.describe('the three modes', () => {
  test('flow is first and repeats torah, targum, torah for every pasuk of the aliyah', async ({ page }) => {
    await page.locator('#chumash').click();
    await expect(page.locator('#panel-chumash h1')).toHaveText('Parshas Noach');
    await expect(page.locator('#reader-mode-flow')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('.flow .pasuk')).toHaveCount(4);
    const groups = page.locator('.flow .pasuk');
    await expect(groups.nth(0).locator('.pasuk-part')).toHaveCount(3);
    await expect(groups.nth(0).locator('.pasuk-label')).toHaveText(['Mikra I', 'Targum Onkelos', 'Mikra II']);
    await expect(groups.nth(0).locator('.pasuk-text')).toHaveText([torahWord('1:1'), targumWord('1:1'), torahWord('1:1')]);
    await expect(groups.nth(3).locator('.pasuk-text')).toHaveText([torahWord('1:4'), targumWord('1:4'), torahWord('1:4')]);
    await expect(groups.nth(0).locator('.pasuk-text').nth(0)).toHaveAttribute('lang', 'he');
    await expect(groups.nth(0).locator('.pasuk-text').nth(1)).toHaveAttribute('lang', 'arc');
    await expect(groups.nth(0).locator('.pasuk-text').nth(0)).toHaveAttribute('dir', 'rtl');
    await expect(groups.nth(1).locator('.pasuk-ref')).toHaveText('Bereishis 1:2');
    await expect(location(page)).toHaveText('Aliyah 1 · Pasuk 1 of 4');
    await expect(page.getByRole('progressbar', { name: 'Reading position in this parsha' })).toHaveAttribute('value', '1');
    await expect(page.locator('#reader-progress')).toHaveAttribute('max', '48');
    await expect(page.locator('.flow')).not.toContainText(torahWord('1:5'));
    await expect(page.locator('.reader-end #reader-continue')).toBeVisible();
  });

  test('cards show one pasuk at a time in the same order, with equal torah text', async ({ page }) => {
    await page.locator('#chumash').click();
    await mode(page, 'cards');
    await expect(page.locator('.pasuk')).toHaveCount(1);
    await expect(page.locator('.pasuk .pasuk-text')).toHaveText([torahWord('1:1'), targumWord('1:1'), torahWord('1:1')]);
    const [first, second] = await page.locator('.pasuk [data-part="first"] .pasuk-text, .pasuk [data-part="second"] .pasuk-text').evaluateAll(elements =>
      elements.map(element => { const style = getComputedStyle(element); return `${style.color}|${style.fontSize}|${style.opacity}`; }));
    expect(second).toBe(first);
    await expect(page.locator('#reader-previous')).toBeDisabled();
    await expect(page.locator('#reader-next')).toBeEnabled();
    expect(await page.evaluate(() => scrollY)).toBe(0);
  });

  test('classic is continuous torah once each, with no targum, groups, or card controls', async ({ page }) => {
    await page.locator('#chumash').click();
    await mode(page, 'classic');
    const classic = page.locator('.classic-text');
    await expect(classic).toBeVisible();
    await expect(page.locator('.pasuk, .pasuk-part, .card-nav, #reader-card')).toHaveCount(0);
    const content = await classic.textContent();
    expect(content).not.toContain('תרגום');
    for (const ref of ['1:1', '1:2', '1:3', '1:4']) {
      expect(content.split(torahWord(ref)).length - 1, ref).toBe(1);
    }
    await expect(classic).toHaveAttribute('dir', 'rtl');
    await expect(classic.locator('.verse-mark').first()).toHaveText('א');
    await expect(classic.locator('.perek-mark')).toHaveText(['פרק א']);
  });

  test('classic uses source breaks only, and marks a new perek without inventing a paragraph', async ({ page }) => {
    await page.locator('#chumash').click();
    await mode(page, 'classic');
    // 1:2 has a setumah, an inline gap. 1:4 has a petuchah at the end of the aliyah.
    await expect(page.locator('.classic-text p')).toHaveCount(1);
    await expect(page.locator('.classic-text .setumah')).toHaveCount(1);
    await page.locator('#reader-aliyah-1').click();
    // 2:1 breaks mid-verse, so that verse continues in a second paragraph.
    await expect(page.locator('.classic-text p')).toHaveCount(2);
    await expect(page.locator('.classic-text p').nth(0)).toContainText(torahWord('1:5'));
    await expect(page.locator('.classic-text p').nth(0)).toContainText(torahWord('2:1'));
    await expect(page.locator('.classic-text p').nth(1)).toContainText('המשך');
    await expect(page.locator('.classic-text p').nth(1)).toContainText(torahWord('2:2'));
    await expect(page.locator('.perek-mark')).toHaveText(['פרק א', 'פרק ב']);
    await expect(page.locator('[data-verse="2:1"]')).toHaveCount(2);
    await expect(page.locator('.tx-big')).toHaveText('וַ');
  });

  test('source markup can never become elements', async ({ page }) => {
    const raw = parshaFixture('Noach');
    raw.torah[0] = ['1:1', '<img src=x onerror="window.injected=1">'];
    raw.onkelos[0] = ['1:1', [['script', 'window.injected=2'], ['note', '<b>bold</b>']]];
    await page.route('**/chumash/v1/noach.json', route => route.fulfill({ json: raw }));
    await page.locator('#chumash').click();
    await expect(page.locator('.pasuk').first()).toContainText('<img src=x');
    await expect(page.locator('.pasuk img, .pasuk script, .pasuk b')).toHaveCount(0);
    expect(await page.evaluate(() => window.injected)).toBeUndefined();
  });

  test('a pasuk missing on one side says so, and no other pasuk takes its place', async ({ page }) => {
    await page.route('**/chumash/v1/noach.json', route => route.fulfill({ json: parshaFixture('Noach', { missingTargum: ['1:2'], missingTorah: ['1:3'] }) }));
    await page.locator('#chumash').click();
    const groups = page.locator('.flow .pasuk');
    await expect(groups.nth(1).locator('.pasuk-text')).toHaveText([torahWord('1:2'), torahWord('1:2')]);
    await expect(groups.nth(1).locator('.pasuk-missing')).toHaveText('Targum Onkelos is not available for this pasuk.');
    await expect(groups.nth(2).locator('.pasuk-text')).toHaveCount(1);
    await expect(groups.nth(2).locator('.pasuk-text')).toContainText(targumWord('1:3'));
    await expect(groups.nth(2).locator('.pasuk-missing')).toHaveCount(2);
    await expect(groups.nth(3).locator('.pasuk-text')).toHaveText([torahWord('1:4'), targumWord('1:4'), torahWord('1:4')]);
    await mode(page, 'classic');
    await expect(page.locator('[data-verse="1:3"] .pasuk-missing')).toHaveText('Text not available');
  });
});

test.describe('keeping the place', () => {
  test('parsha progress advances per reading and carries across aliyos to the final end screen', async ({ page }) => {
    await page.locator('#chumash').click();
    const meter = page.getByRole('progressbar', { name: 'Reading position in this parsha' });
    await expect(meter).toHaveJSProperty('max', 48);
    await expect(meter).toHaveJSProperty('value', 1);
    await scrollToVerse(page, '1:1', 'targum');
    await expect(meter).toHaveJSProperty('value', 2);
    await scrollToVerse(page, '1:1', 'second');
    await expect(meter).toHaveJSProperty('value', 3);
    await scrollToVerse(page, '1:2', 'first');
    await expect(meter).toHaveJSProperty('value', 4);

    await page.locator('#reader-aliyah-1').click();
    await expect(meter).toHaveJSProperty('value', 13);
    await page.reload();
    await expect(meter).toHaveJSProperty('value', 13);
    await expect(meter).toHaveJSProperty('max', 48);

    await mode(page, 'cards');
    await page.locator('#reader-aliyah-6').click();
    await expect(meter).toHaveJSProperty('value', 43);
    await page.locator('#reader-next').click();
    await expect(location(page)).toHaveText('Aliyah 7 · Pasuk 2 of 2');
    await expect(meter).toHaveJSProperty('value', 46);
    await page.locator('#reader-next').click();
    await expect(location(page)).toHaveText('Aliyah 7 · End');
    await expect(meter).toHaveJSProperty('value', 48);
    await page.locator('#reader-previous').click();
    await expect(meter).toHaveJSProperty('value', 46);
    expect(await progressOf(page)).toEqual({});
  });

  test('switching modes keeps the pasuk across a perek boundary, and cards and flow keep the part', async ({ page }) => {
    await page.locator('#chumash').click();
    await page.locator('#reader-aliyah-1').click();
    await expect(location(page)).toHaveText('Aliyah 2 · Pasuk 1 of 5');
    await scrollToVerse(page, '2:1', 'targum');
    await expect(location(page)).toHaveText('Aliyah 2 · Pasuk 3 of 5');
    await expect.poll(() => savedPosition(page)).toEqual({ aliyah: 1, ref: '2:1', part: 'targum', end: false });
    await expect(page.locator('#reader-progress')).toHaveJSProperty('value', 20);
    await expect(page.locator('#reader-progress')).toHaveAttribute('max', '48');
    await expect(page.locator('#reader-progress')).toHaveAttribute('aria-valuetext', '20 of 48 readings in Noach · Targum Onkelos');

    await mode(page, 'cards');
    await expect(page.locator('#reader-progress')).toHaveJSProperty('value', 20);
    await expect(page.locator('.pasuk-ref')).toHaveText('Bereishis 2:1');
    await expect(page.locator('.pasuk [data-part="first"] .pasuk-text')).toContainText(torahWord('2:1'));
    await expect(page.locator('.pasuk [data-part="targum"]')).toBeInViewport();
    await expect.poll(() => savedPosition(page)).toEqual({ aliyah: 1, ref: '2:1', part: 'targum', end: false });

    await mode(page, 'flow');
    await expect(location(page)).toHaveText('Aliyah 2 · Pasuk 3 of 5');
    await expect.poll(async () => Math.abs(await verseTop(page, '2:1', 'targum'))).toBeLessThanOrEqual(12);

    await mode(page, 'classic');
    await expect(location(page)).toHaveText('Aliyah 2 · Pasuk 3 of 5');
    await expect(page.locator('#reader-progress')).toHaveJSProperty('value', 7);
    await expect(page.locator('#reader-progress')).toHaveJSProperty('max', 16);
    await expect(page.locator('[data-verse="2:1"]').first()).toBeInViewport();

    // Classic has one copy of the pasuk, and the part survives the trip through it.
    await mode(page, 'cards');
    await expect(page.locator('.pasuk-ref')).toHaveText('Bereishis 2:1');
    await expect.poll(() => savedPosition(page)).toEqual({ aliyah: 1, ref: '2:1', part: 'targum', end: false });
  });

  test('the second torah reading of a long pasuk comes back after switching modes and tabs', async ({ page }) => {
    await page.locator('#chumash').click();
    await page.locator('#reader-aliyah-1').click();
    await scrollToVerse(page, '1:6', 'second');
    await expect.poll(() => savedPosition(page)).toEqual({ aliyah: 1, ref: '1:6', part: 'second', end: false });
    await mode(page, 'cards');
    await expect(page.locator('.pasuk-ref')).toHaveText('Bereishis 1:6');
    await expect.poll(async () => Math.abs(await verseTop(page, '1:6', 'second'))).toBeLessThanOrEqual(12);
    await mode(page, 'flow');
    await page.locator('#settings').click();
    await page.locator('#chumash').click();
    await expect(location(page)).toHaveText('Aliyah 2 · Pasuk 2 of 5');
    await expect.poll(async () => Math.abs(await verseTop(page, '1:6', 'second'))).toBeLessThanOrEqual(12);
  });

  test('a reload returns to the reader, the mode, and the same pasuk', async ({ page }) => {
    await page.locator('#chumash').click();
    await page.locator('#reader-aliyah-1').click();
    await mode(page, 'cards');
    await page.locator('#reader-next').click();
    await page.locator('#reader-next').click();
    await expect(page.locator('.pasuk-ref')).toHaveText('Bereishis 2:1');
    await page.reload();
    await expect(page.locator('#chumash')).toHaveAttribute('aria-current', 'page');
    await expect(page.locator('#reader-mode-cards')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('.pasuk-ref')).toHaveText('Bereishis 2:1');
    await expect(location(page)).toHaveText('Aliyah 2 · Pasuk 3 of 5');
    await expect(page.locator('#reader-aliyah-1')).toHaveAttribute('aria-current', 'true');
    await expect(page.locator('#reader-progress')).toHaveJSProperty('value', 19);
    await expect(page.locator('#reader-progress')).toHaveAttribute('max', '48');
  });

  test('a reload of a flow bookmark scrolls to it, and leaving the reader means a fresh launch opens the tracker', async ({ page }) => {
    await page.locator('#chumash').click();
    await scrollToVerse(page, '1:3', 'second');
    await expect.poll(() => savedPosition(page)).toEqual({ aliyah: 0, ref: '1:3', part: 'second', end: false });
    await page.reload();
    await expect(location(page)).toHaveText('Aliyah 1 · Pasuk 3 of 4');
    await expect.poll(async () => Math.abs(await verseTop(page, '1:3', 'second'))).toBeLessThanOrEqual(12);
    await page.locator('#tracker').click();
    await page.reload();
    await expect(page.locator('#tracker')).toHaveAttribute('aria-current', 'page');
    await page.locator('#chumash').click();
    await expect(location(page)).toHaveText('Aliyah 1 · Pasuk 3 of 4');
  });

  test('each parsha keeps its own place; a new one starts at its beginning, whatever the tracker says', async ({ page }) => {
    await page.evaluate(([key]) => {
      // Rishon and Sheni are complete, which must not suggest where to read.
      const saved = JSON.parse(localStorage.getItem(key) || '{"progress":{}}');
      saved.progress['5787:Lech-Lecha'] = { mikra1_1: true, mikra1_2: true, mikra2_1: true, onkelos_1: true };
      localStorage.setItem(key, JSON.stringify(saved));
    }, [GUEST_KEY]);
    await page.reload();
    await page.locator('#chumash').click();
    await page.locator('#reader-aliyah-2').click();
    await expect(location(page)).toHaveText('Aliyah 3 · Pasuk 1 of 2');

    await page.locator('#reader-parsha').selectOption('Lech-Lecha');
    await expect(page.locator('#panel-chumash h1')).toHaveText('Parshas Lech Lecha');
    await expect(page.locator('#reader-aliyah-0')).toHaveAttribute('aria-current', 'true');
    await expect(location(page)).toHaveText('Aliyah 1 · Pasuk 1 of 4');
    await expect(page.locator('#reader-parsha')).toBeFocused();

    // The tracker follows a choice made here, and the reader follows one made there.
    await page.locator('#tracker').click();
    await expect(page.locator('#panel-chumash, h1').first()).toHaveText('Parshas Lech Lecha');
    await page.locator('[data-parsha="Noach"]').click();
    await page.locator('#chumash').click();
    await expect(page.locator('#panel-chumash h1')).toHaveText('Parshas Noach');
    await expect(location(page)).toHaveText('Aliyah 3 · Pasuk 1 of 2');
  });

  test('a restored last pasuk does not slip back, and reading right after a switch still counts', async ({ page }) => {
    // This aliyah is too short for its last pasuk to reach the top of the screen.
    await page.evaluate(([key]) => localStorage.setItem(key, JSON.stringify({ aliyah: 6, ref: '2:10', part: 'second', end: false })), [positionKey('Noach')]);
    await page.locator('#chumash').click();
    await expect(location(page)).toHaveText('Aliyah 7 · Pasuk 2 of 2');
    await page.waitForTimeout(400);
    await expect(location(page)).toHaveText('Aliyah 7 · Pasuk 2 of 2');
    expect(await savedPosition(page)).toMatchObject({ ref: '2:10', part: 'second' });

    await page.locator('#reader-aliyah-0').click();
    await mode(page, 'classic');
    await mode(page, 'flow');
    await scrollToVerse(page, '1:3');
    await expect(location(page)).toHaveText('Aliyah 1 · Pasuk 3 of 4');
    await page.waitForTimeout(200);
    await expect.poll(async () => Math.abs(await verseTop(page, '1:3'))).toBeLessThanOrEqual(12);
  });

  test('a reader font that arrives late does not lose the place', async ({ page }) => {
    let releaseFont;
    const held = new Promise(resolve => { releaseFont = resolve; });
    await page.route('**/fonts/*.woff2', async route => { await held; await route.fallback(); });
    await page.evaluate(([key]) => localStorage.setItem(key, JSON.stringify({ aliyah: 1, ref: '2:1', part: 'targum', end: false })), [positionKey('Noach')]);
    await page.reload();
    await page.locator('#chumash').click();
    await expect(location(page)).toHaveText('Aliyah 2 · Pasuk 3 of 5');
    await expect(page.evaluate(() => document.fonts.status)).resolves.toBe('loading');
    releaseFont();
    await expect.poll(() => page.evaluate(() => document.fonts.status)).toBe('loaded');
    await expect.poll(async () => Math.abs(await verseTop(page, '2:1', 'targum'))).toBeLessThanOrEqual(12);
    await page.waitForTimeout(350);
    await expect(location(page)).toHaveText('Aliyah 2 · Pasuk 3 of 5');
    expect(await savedPosition(page)).toEqual({ aliyah: 1, ref: '2:1', part: 'targum', end: false });
  });

  test('the page changing height is not mistaken for reading somewhere else', async ({ page }) => {
    // On a card this short, the saved reading can't reach the top of the screen, so the
    // page rests at its very end. When the page gets shorter, the browser pulls it back.
    const saved = { aliyah: 1, ref: '2:1', part: 'targum', end: false };
    await page.setViewportSize({ width: 393, height: 640 });
    await page.evaluate(([key, position]) => {
      localStorage.setItem(key, JSON.stringify(position));
      localStorage.setItem('shnaim-mikra-reader-mode:guest', 'cards');
    }, [positionKey('Noach'), saved]);
    await page.locator('#chumash').click();
    await expect(page.locator('.pasuk-ref')).toHaveText('Bereishis 2:1');
    await page.evaluate(() => document.fonts.ready);
    const resting = await page.evaluate(() => scrollY);
    expect(resting).toBeGreaterThan(0);
    await page.locator('.reader-credit').evaluate(element => { element.style.display = 'none'; });
    await expect.poll(() => page.evaluate(() => scrollY)).toBeLessThan(resting);
    await page.waitForTimeout(400);
    expect(await savedPosition(page)).toEqual(saved);

    // Their own scrolling still counts afterward.
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
    await expect.poll(() => savedPosition(page)).toMatchObject({ ref: '2:1', part: 'first' });
  });

  test('a late response for an earlier parsha cannot replace the newer choice', async ({ page }) => {
    const releaseNoach = text.hold('noach');
    await page.locator('#chumash').click();
    await expect(page.locator('#reader-loading')).toBeVisible();
    await page.locator('#reader-parsha').selectOption('Vayera');
    await expect(page.locator('.flow .pasuk').first()).toBeVisible();
    await page.locator('#reader-aliyah-1').click();
    await expect(location(page)).toHaveText('Aliyah 2 · Pasuk 1 of 5');
    releaseNoach();
    await page.waitForTimeout(200);
    await expect(page.locator('#panel-chumash h1')).toHaveText('Parshas Vayeira');
    await expect(location(page)).toHaveText('Aliyah 2 · Pasuk 1 of 5');
    expect(await savedPosition(page, 'Noach')).toBeNull();
  });

  test('a background sync does not move the page, advance the card, or take focus', async ({ page }) => {
    const account = await mockAccount(page);
    await page.locator('#chumash').click();
    await mode(page, 'cards');
    await page.locator('#reader-next').click();
    await expect(page.locator('.pasuk-ref')).toHaveText('Bereishis 1:2');
    await page.evaluate(() => { window.card = document.querySelector('#reader-card'); });
    await page.locator('#reader-next').focus();
    await page.waitForTimeout(300);
    await page.evaluate(() => {
      // Another device changes progress; the next sync brings it here.
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await expect.poll(() => account.requests.filter(request => request.url.includes('/progress')).length).toBeGreaterThan(1);
    await page.waitForTimeout(200);
    await expect(page.locator('.pasuk-ref')).toHaveText('Bereishis 1:2');
    await expect(page.locator('#reader-next')).toBeFocused();
    expect(await page.evaluate(() => window.card === document.querySelector('#reader-card'))).toBe(true);
  });

  test('a background change keeps flow still, even with progress arriving', async ({ page }) => {
    await page.locator('#chumash').click();
    await scrollToVerse(page, '1:3');
    await page.evaluate(() => document.fonts.ready); // A late font is not what this test is about.
    await page.waitForTimeout(300);
    const before = await page.evaluate(() => scrollY);
    expect(before).toBeGreaterThan(0);
    await page.evaluate(([key]) => {
      const saved = JSON.parse(localStorage.getItem(key) || '{"progress":{}}');
      saved.progress['5787:Noach'] = { mikra1_1: true };
      const value = JSON.stringify(saved);
      localStorage.setItem(key, value);
      window.dispatchEvent(new StorageEvent('storage', { key, newValue: value }));
    }, [GUEST_KEY]);
    await page.waitForTimeout(150);
    expect(await page.evaluate(() => scrollY)).toBe(before);
    await expect(location(page)).toHaveText('Aliyah 1 · Pasuk 3 of 4');
    await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight));
    await expect(page.locator('.reader-status li.on')).toHaveText(/Mikra I/);
  });
});

test.describe('accounts and storage', () => {
  test('bookmarks and modes stay with their account across sign in and sign out', async ({ page }) => {
    await page.locator('#chumash').click();
    await mode(page, 'classic');
    await page.locator('#reader-aliyah-2').click();
    await expect(location(page)).toHaveText('Aliyah 3 · Pasuk 1 of 2');

    await mockAccount(page, { initialRows: [] });
    await expect(page.locator('#tracker')).toHaveAttribute('aria-current', 'page');
    await page.locator('#chumash').click();
    await expect(page.locator('#reader-mode-flow')).toHaveAttribute('aria-pressed', 'true');
    await expect(location(page)).toHaveText('Aliyah 1 · Pasuk 1 of 4');
    await page.locator('#reader-aliyah-1').click();
    await expect(location(page)).toHaveText('Aliyah 2 · Pasuk 1 of 5');

    const key = 'shnaim-mikra-reader-position:11111111-1111-4111-8111-111111111111:5787:Noach';
    await expect.poll(() => page.evaluate(storageKey => JSON.parse(localStorage.getItem(storageKey))?.aliyah, key)).toBe(1);
    expect((await savedPosition(page)).aliyah).toBe(2);

    await page.locator('#account').click();
    await page.locator('#settings-signout').click();
    await page.locator('#continue-guest').click();
    await page.locator('#chumash').click();
    await expect(page.locator('#reader-mode-classic')).toHaveAttribute('aria-pressed', 'true');
    await expect(location(page)).toHaveText('Aliyah 3 · Pasuk 1 of 2');
  });

  test('a signed-in reload returns to the reader and the account’s own place', async ({ page }) => {
    await mockAccount(page, { initialRows: [] });
    await page.locator('#chumash').click();
    await page.locator('#reader-aliyah-1').click();
    await expect(location(page)).toHaveText('Aliyah 2 · Pasuk 1 of 5');
    await page.reload();
    await expect(page.locator('#chumash')).toHaveAttribute('aria-current', 'page');
    await expect(location(page)).toHaveText('Aliyah 2 · Pasuk 1 of 5');
  });

  test('the reader keeps working for the visit without storage, and says when a mark was not saved', async ({ page }) => {
    await page.locator('#chumash').click();
    await mode(page, 'classic');
    await page.evaluate(() => {
      Storage.prototype.setItem = () => { throw new Error('QuotaExceededError'); };
    });
    await mode(page, 'cards');
    await expect(page.locator('#reader-mode-cards')).toHaveAttribute('aria-pressed', 'true');
    await page.locator('#reader-next').click();
    await expect(page.locator('.pasuk-ref')).toHaveText('Bereishis 1:2');
    await page.locator('#settings').click();
    await page.locator('#chumash').click();
    await expect(page.locator('.pasuk-ref')).toHaveText('Bereishis 1:2');
    await expect(page.locator('#reader-mode-cards')).toHaveAttribute('aria-pressed', 'true');

    for (let step = 0; step < 3; step += 1) await page.locator('#reader-next').click();
    await page.locator('#reader-complete').click();
    await expect(page.locator('#reader-save-note')).toHaveText('Progress could not be saved. Check browser storage.');
    await expect(page.locator('#announcement')).toHaveText('Progress could not be saved. Check browser storage.');
    await expect(page.locator('#reader-complete')).toHaveText('Mark aliyah complete');
    await expect(page.locator('.reader-status li.on')).toHaveCount(0);
    expect(await progressOf(page)).toEqual({});
  });
});

test.describe('cards navigation', () => {
  test.use({ hasTouch: true });

  const card = async page => {
    const box = await page.locator('#reader-card').boundingBox();
    return { top: box.y + 40, left: box.x + 30, right: box.x + box.width - 30, middle: box.x + box.width / 2, y: box.y + Math.min(box.height / 2, 200) };
  };

  test('swiping and the buttons move the same way, with the next button on the swipe’s side', async ({ page }) => {
    await page.locator('#chumash').click();
    await mode(page, 'cards');
    const next = await page.locator('#reader-next').boundingBox();
    const previous = await page.locator('#reader-previous').boundingBox();
    expect(next.x, 'hebrew order: next sits on the left').toBeLessThan(previous.x);

    const { left, right, y } = await card(page);
    // A rightward pull brings the next page in from the left, as in a Hebrew book.
    await touchStroke(page, { x: left, y }, { x: right, y });
    await expect(page.locator('.pasuk-ref')).toHaveText('Bereishis 1:2');
    await page.locator('#reader-next').click();
    await expect(page.locator('.pasuk-ref')).toHaveText('Bereishis 1:3');
    await touchStroke(page, { x: right, y }, { x: left, y });
    await expect(page.locator('.pasuk-ref')).toHaveText('Bereishis 1:2');
    await page.locator('#reader-previous').click();
    await expect(page.locator('.pasuk-ref')).toHaveText('Bereishis 1:1');
    await touchStroke(page, { x: right, y }, { x: left, y });
    await expect(page.locator('.pasuk-ref')).toHaveText('Bereishis 1:1');
    expect(await progressOf(page)).toEqual({});
  });

  test('vertical scrolling, small drags, slow presses and diagonal strokes do not change the card', async ({ page }) => {
    await page.locator('#chumash').click();
    await mode(page, 'cards');
    await page.locator('#reader-aliyah-1').click();
    await page.locator('#reader-next').click();
    await expect(page.locator('.pasuk-ref')).toHaveText('Bereishis 1:6');
    const { middle, y } = await card(page);

    await touchStroke(page, { x: middle, y: y + 200 }, { x: middle + 12, y: y - 150 });
    await expect(page.locator('.pasuk-ref')).toHaveText('Bereishis 1:6');
    await expect.poll(() => page.evaluate(() => scrollY), 'the long pasuk scrolled').toBeGreaterThan(50);

    await touchStroke(page, { x: middle - 10, y: 400 }, { x: middle + 25, y: 400 });
    await expect(page.locator('.pasuk-ref')).toHaveText('Bereishis 1:6');

    await touchStroke(page, { x: middle - 100, y: 400 }, { x: middle + 100, y: 400 }, { steps: 8, stepDelay: 120 });
    await expect(page.locator('.pasuk-ref')).toHaveText('Bereishis 1:6');

    await touchStroke(page, { x: middle - 100, y: 300 }, { x: middle + 100, y: 500 });
    await expect(page.locator('.pasuk-ref')).toHaveText('Bereishis 1:6');
  });

  test('a second finger turns a stroke into a pinch, which does not change the card', async ({ page }) => {
    await page.locator('#chumash').click();
    await mode(page, 'cards');
    await page.locator('#reader-card').evaluate(card => {
      const event = (type, x, pointerId, isPrimary) => new PointerEvent(type, { bubbles: true, pointerType: 'touch', clientX: x, clientY: 200, pointerId, isPrimary });
      card.querySelector('.pasuk-text').dispatchEvent(event('pointerdown', 40, 1, true));
      card.querySelector('.pasuk-text').dispatchEvent(event('pointerdown', 60, 2, false));
      card.querySelector('.pasuk-text').dispatchEvent(event('pointerup', 320, 1, true));
    });
    await page.waitForTimeout(100);
    await expect(page.locator('.pasuk-ref')).toHaveText('Bereishis 1:1');
  });

  test('a stroke while text is selected, or with a mouse, does not change the card', async ({ page }) => {
    await page.locator('#chumash').click();
    await mode(page, 'cards');
    const { left, right, y } = await card(page);
    await page.evaluate(() => {
      const range = document.createRange();
      range.selectNodeContents(document.querySelector('.pasuk-text'));
      getSelection().addRange(range);
    });
    await touchStroke(page, { x: left, y }, { x: right, y });
    await expect(page.locator('.pasuk-ref')).toHaveText('Bereishis 1:1');
    await page.evaluate(() => getSelection().removeAllRanges());

    await page.mouse.move(left, y);
    await page.mouse.down();
    await page.mouse.move(right, y, { steps: 5 });
    await page.mouse.up();
    await expect(page.locator('.pasuk-ref')).toHaveText('Bereishis 1:1');
  });

  test('a new pasuk starts at the top of its group, even after scrolling down a long one', async ({ page }) => {
    await page.locator('#chumash').click();
    await mode(page, 'cards');
    await page.locator('#reader-aliyah-1').click();
    await page.locator('#reader-next').click();
    await expect(page.locator('.pasuk-ref')).toHaveText('Bereishis 1:6');
    await page.evaluate(() => window.scrollTo(0, 1500));
    await expect(page.locator('#reader-next'), 'the next button stays reachable').toBeInViewport();
    await page.locator('#reader-next').click();
    await expect(page.locator('.pasuk-ref')).toHaveText('Bereishis 2:1');
    const offset = await page.evaluate(() =>
      document.querySelector('#reader-card').getBoundingClientRect().top - document.querySelector('.reader-bar').getBoundingClientRect().bottom);
    expect(Math.abs(offset)).toBeLessThanOrEqual(24);
    await expect(page.locator('#reader-next')).toBeFocused();
  });

  test('the last pasuk leads to the end card, and backing up leaves completion alone', async ({ page }) => {
    await page.locator('#chumash').click();
    await mode(page, 'cards');
    for (let step = 0; step < 3; step += 1) await page.locator('#reader-next').click();
    await expect(page.locator('.pasuk-ref')).toHaveText('Bereishis 1:4');
    await expect(location(page)).toHaveText('Aliyah 1 · Pasuk 4 of 4');
    await page.locator('#reader-next').click();
    await expect(page.locator('.reader-end h2')).toHaveText('End of Rishon');
    await expect(page.locator('.reader-end h2')).toBeFocused();
    await expect(location(page)).toHaveText('Aliyah 1 · End');
    await expect(page.locator('#reader-next')).toBeDisabled();
    expect(await progressOf(page)).toEqual({});
    await page.reload();
    await expect(page.locator('.reader-end h2')).toHaveText('End of Rishon');
    await page.locator('#reader-previous').click();
    await expect(page.locator('.pasuk-ref')).toHaveText('Bereishis 1:4');
    await page.locator('#reader-next').click();
    await page.locator('#reader-continue').click();
    await expect(location(page)).toHaveText('Aliyah 2 · Pasuk 1 of 5');
    await page.locator('#reader-previous').click();
    await expect(location(page)).toHaveText('Aliyah 1 · Pasuk 4 of 4');
    expect(await progressOf(page)).toEqual({});
  });
});

test.describe('aliyah navigation', () => {
  test('the aliyah strip names the current aliyah, moves directly, and leads to the end of the parsha', async ({ page }) => {
    await page.locator('#chumash').click();
    const steps = page.locator('.aliyah-step');
    await expect(steps).toHaveText(['Rishon', '2', '3', '4', '5', '6', '7']);
    await expect(page.getByRole('button', { name: 'Chamishi, 0 of 3 marked' })).toBeVisible();
    await page.locator('#reader-aliyah-1').click();
    await expect(location(page)).toHaveText('Aliyah 2 · Pasuk 1 of 5');
    await expect(steps).toHaveText(['1', 'Sheni', '3', '4', '5', '6', '7']);
    await expect(page.locator('#reader-aliyah-1')).toBeFocused();
    await page.locator('#reader-aliyah-0').click();
    await expect(location(page)).toHaveText('Aliyah 1 · Pasuk 1 of 4');
    await expect(page.locator('#reader-aliyah-0')).toBeFocused();

    await page.locator('#reader-continue').click();
    await expect(page.locator('#reader-aliyah-1')).toHaveAttribute('aria-current', 'true');
    expect(await page.evaluate(() => scrollY)).toBe(0);
    await page.locator('#reader-aliyah-6').click();
    await expect(page.locator('#reader-continue')).toHaveCount(0);
    await expect(page.locator('.reader-end h2')).toHaveText('End of Noach');
    await page.locator('#reader-choose-parsha').click();
    await expect(page.locator('#reader-parsha')).toBeFocused();
    await expect(page.locator('#panel-chumash h1')).toHaveText('Parshas Noach');
    expect(text.requests).toEqual(['noach']);
    expect(await progressOf(page)).toEqual({});
  });

  test('the end of a parsha offers the next one, and only moves when asked', async ({ page }) => {
    await page.locator('#chumash').click();
    await page.locator('#reader-aliyah-6').click();
    await expect(page.locator('#panel-chumash h1')).toHaveText('Parshas Noach');
    await page.locator('#reader-next-parsha').click();
    await expect(page.locator('#panel-chumash h1')).toHaveText('Parshas Lech Lecha');
    await expect(page.locator('#reader-parsha')).toBeFocused();
    await expect(location(page)).toHaveText('Aliyah 1 · Pasuk 1 of 4');
    expect(await progressOf(page)).toEqual({});
  });
});

test.describe('completion', () => {
  test('the aliyah strip shows saved marks, and moving on leads once an aliyah is marked', async ({ page }) => {
    await page.locator('#chumash').click();
    await expect(page.locator('#reader-continue')).not.toHaveClass(/reader-continue-lead/);
    await page.locator('#reader-complete').click();
    await expect(page.locator('#reader-aliyah-0')).toHaveClass(/done/);
    await expect(page.getByRole('button', { name: 'Rishon, complete' })).toBeVisible();
    await expect(page.locator('#reader-continue')).toHaveClass(/reader-continue-lead/);

    await page.locator('#reader-aliyah-1').click();
    await mode(page, 'classic');
    await page.locator('#reader-mark-mikra1').click();
    await expect(page.locator('#reader-aliyah-1')).toHaveClass(/partial/);
    await expect(page.getByRole('button', { name: 'Sheni, 1 of 3 marked' })).toBeVisible();
    await expect(page.locator('#reader-continue')).not.toHaveClass(/reader-continue-lead/);
    await page.locator('#reader-mark-mikra2').click();
    await expect(page.locator('#reader-continue')).toHaveClass(/reader-continue-lead/);
    await expect(page.locator('#reader-aliyah-1')).toHaveClass(/partial/);
  });

  test('nothing but an explicit action marks progress', async ({ page }) => {
    await page.locator('#chumash').click();
    await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight));
    await mode(page, 'cards');
    // Having scrolled to the end above, they may already be on the end card. Either way counts.
    while (await page.locator('#reader-next').isEnabled()) await page.locator('#reader-next').click();
    await expect(page.locator('.reader-end h2')).toHaveText('End of Rishon');
    await mode(page, 'classic');
    await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight));
    await page.locator('#reader-continue').click();
    await page.locator('#tracker').click();
    await page.locator('#chumash').click();
    await page.reload();
    expect(await progressOf(page)).toEqual({});
  });

  test('cards and flow mark exactly this aliyah’s three fields, once, and keep the peirush', async ({ page }) => {
    await page.evaluate(([key]) => {
      const saved = JSON.parse(localStorage.getItem(key) || '{"progress":{}}');
      saved.progress['5787:Noach'] = { rashi_1: true, rashi_2: true, rashi_3: true };
      saved.progress['5787:Bereshit'] = { mikra1_1: true };
      localStorage.setItem(key, JSON.stringify(saved));
    }, [GUEST_KEY]);
    await page.reload();
    await page.locator('#chumash').click();
    await page.locator('#reader-aliyah-1').click();
    await expect(page.locator('.reader-note').filter({ hasText: 'Your tracker is showing Rashi' })).toBeVisible();
    await page.locator('#reader-complete').scrollIntoViewIfNeeded();
    await expect(page.locator('.reader-end')).toContainText('Marks Mikra I, Mikra II and Targum for this aliyah only.');
    await page.locator('#reader-complete').click();
    await expect(page.locator('#reader-complete')).toHaveText('Aliyah complete');
    await expect(page.locator('#reader-complete')).toBeFocused();
    await expect(page.locator('#reader-complete')).toHaveAttribute('aria-disabled', 'true');
    await expect(page.locator('#announcement')).toContainText('Sheni marked complete');
    const expected = { rashi_1: true, rashi_2: true, rashi_3: true, mikra1_2: true, mikra2_2: true, onkelos_2: true };
    expect(await progressOf(page)).toEqual(expected);

    await page.locator('#reader-complete').click({ force: true });
    await page.locator('#reader-complete').click({ force: true });
    expect(await progressOf(page)).toEqual(expected);
    expect(await progressOf(page, 'Bereshit')).toEqual({ mikra1_1: true });
    await expect(page.locator('.reader-status li.on')).toHaveCount(3);
    await expect(page.locator('#reader-aliyah-1'), 'marking does not move on by itself').toHaveAttribute('aria-current', 'true');

    // The tracker's own rule still decides: three rashi to one targum keeps Rashi showing.
    await page.locator('#tracker').click();
    await page.locator('[data-parsha="Noach"]').click();
    await expect(page.locator('[data-expand="rashi"]')).toBeVisible();
    await expect(page.locator('#reading-mikra1')).toHaveAttribute('aria-checked', 'mixed');
    await expect(page.locator('#reading-rashi')).toHaveAttribute('aria-checked', 'mixed');
  });

  test('targum marks show in the tracker, and completing every aliyah completes the parsha', async ({ page }) => {
    await page.locator('#chumash').click();
    for (let aliyah = 0; aliyah < 7; aliyah += 1) {
      await page.locator(`#reader-aliyah-${aliyah}`).click();
      await page.locator('#reader-complete').click();
      await expect(page.locator('#reader-complete')).toHaveText('Aliyah complete');
    }
    await expect(page.locator('#announcement')).toContainText('Noach complete');
    await page.locator('#tracker').click();
    await expect(page.locator('#reading-onkelos')).toHaveAttribute('aria-checked', 'true');
    await expect(page.locator('#reading-mikra2')).toHaveAttribute('aria-checked', 'true');
    await expect(page.locator('.parsharow.selected')).toHaveClass(/done/);
  });

  test('completion through a signed-in account is a sparse write of the three fields', async ({ page }) => {
    const account = await mockAccount(page, { initialRows: [{ year: 5787, parsha_id: 'Noach', rashi_1: true }] });
    await page.locator('#chumash').click();
    await page.locator('#reader-complete').click();
    await expect.poll(() => account.getRows().find(row => row.parsha_id === 'Noach').onkelos_1).toBe(true);
    const row = account.getRows().find(item => item.parsha_id === 'Noach');
    expect(row).toMatchObject({ rashi_1: true, mikra1_1: true, mikra2_1: true, onkelos_1: true });
    expect(Object.keys(row).filter(key => /_\d$/.test(key)).sort()).toEqual(['mikra1_1', 'mikra2_1', 'onkelos_1', 'rashi_1']);
    await page.evaluate(() => window.scrollTo(0, 0));
    await expect(page.locator('#reader-complete')).toHaveText('Aliyah complete');
  });

  test('classic marks one chosen mikra; a repeat click never spills into the other', async ({ page }) => {
    await page.evaluate(([key]) => {
      const saved = JSON.parse(localStorage.getItem(key) || '{"progress":{}}');
      saved.progress['5787:Noach'] = { rashi_1: true };
      localStorage.setItem(key, JSON.stringify(saved));
    }, [GUEST_KEY]);
    await page.reload();
    await page.locator('#chumash').click();
    await mode(page, 'classic');
    const first = page.locator('#reader-mark-mikra1'), second = page.locator('#reader-mark-mikra2');
    await expect(first).toHaveText('Mark Mikra I');
    await expect(second).toHaveText('Mark Mikra II');
    await first.dblclick();
    await expect(first).toHaveText('Mikra I marked');
    await expect(first).toHaveAttribute('aria-disabled', 'true');
    await expect(first).toBeFocused();
    await expect(second).toHaveText('Mark Mikra II');
    expect(await progressOf(page)).toEqual({ rashi_1: true, mikra1_1: true });
    await second.click();
    expect(await progressOf(page)).toEqual({ rashi_1: true, mikra1_1: true, mikra2_1: true });
    await first.click({ force: true });
    expect(await progressOf(page), 'unchecking stays in the tracker').toEqual({ rashi_1: true, mikra1_1: true, mikra2_1: true });
    await page.locator('#tracker').click();
    await page.locator('#expand-mikra1').click();
    await page.locator('#aliyah-mikra1-0').click();
    await page.locator('#chumash').click();
    await expect(first).toHaveText('Mark Mikra I');
  });

  test('completing a later aliyah leaves earlier ones unmarked', async ({ page }) => {
    await page.locator('#chumash').click();
    await page.locator('#reader-aliyah-4').click();
    await page.locator('#reader-complete').click();
    await expect(page.locator('#reader-complete')).toHaveText('Aliyah complete');
    expect(await progressOf(page)).toEqual({ mikra1_5: true, mikra2_5: true, onkelos_5: true });
    await page.locator('#reader-aliyah-3').click();
    await expect(page.locator('#reader-complete')).toHaveText('Mark aliyah complete');
  });
});

test.describe('loading and offline', () => {
  test('loading and a failure keep the choice, and retrying restores the saved place', async ({ page }) => {
    await page.evaluate(([key]) => localStorage.setItem(key, JSON.stringify({ aliyah: 1, ref: '2:1', part: 'targum', end: false })), [positionKey('Noach')]);
    const release = text.hold('noach');
    await page.locator('#chumash').click();
    await expect(page.locator('#reader-loading')).toHaveText('Loading Noach…');
    await expect(location(page)).toHaveText('Aliyah 2');
    await expect(page.locator('#reader-aliyah-1')).toHaveAttribute('aria-current', 'true');
    text.fail('noach');
    release();
    await expect(page.locator('#reader-error')).toContainText('couldn’t be loaded right now');
    await expect(page.locator('#reader-error')).toContainText('Your place is saved');
    await expect(page.locator('#reader-aliyah-1')).toHaveAttribute('aria-current', 'true');
    expect(await savedPosition(page)).toMatchObject({ aliyah: 1, ref: '2:1' });
    text.recover('noach');
    await page.locator('#reader-retry').click();
    await expect(page.locator('.flow')).toBeVisible();
    await expect(location(page)).toHaveText('Aliyah 2 · Pasuk 3 of 5');
    await expect.poll(async () => Math.abs(await verseTop(page, '2:1', 'targum'))).toBeLessThanOrEqual(12);
  });

  test('a page that is not text, or text for another parsha, is reported and not cached', async ({ page }) => {
    await page.route('**/chumash/v1/noach.json', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>App</title>' }));
    await page.route('**/chumash/v1/vayera.json', route => route.fulfill({ json: parshaFixture('Noach') }));
    await page.locator('#chumash').click();
    await expect(page.locator('#reader-error')).toContainText('couldn’t be read');
    await page.locator('#reader-parsha').selectOption('Vayera');
    await expect(page.locator('#reader-error')).toContainText('couldn’t be read');
    await expect(page.locator('#panel-chumash h1')).toHaveText('Parshas Vayeira');
    expect(await page.evaluate(async () => (await (await caches.open('chumash-text-v1')).keys()).length)).toBe(0);
  });

  test('offline, opened text stays readable and unopened text says it is not saved', async ({ page, context }) => {
    await page.locator('#chumash').click();
    await expect(page.locator('.flow')).toBeVisible();
    await expect(page.locator('.reader-credit')).toContainText('saved on this device');
    await context.setOffline(true);
    text.fail('vayera'); // Mocked routes answer even offline, so the failure is made explicit.
    await page.locator('#reader-parsha').selectOption('Vayera');
    await expect(page.locator('#reader-error')).toContainText('You’re offline, and this parsha isn’t saved on this device yet');
    await expect(page.locator('.reader-credit')).not.toContainText('saved on this device');
    await expect(page.locator('#reader-parsha')).toHaveValue('Vayera');
    await page.locator('#reader-retry').click();
    await expect(page.locator('#reader-error')).toContainText('You’re offline');
    await page.locator('#reader-parsha').selectOption('Noach');
    await expect(page.locator('.flow')).toBeVisible();
    await context.setOffline(false);
    text.recover('vayera');
    await page.locator('#reader-parsha').selectOption('Vayera');
    await expect(page.locator('.flow')).toBeVisible();
    await expect(page.locator('.reader-credit')).toContainText('saved on this device');
    expect(await page.evaluate(async () => (await (await caches.open('chumash-text-v1')).keys()).length)).toBe(2);
  });

  test('text saved on the device loads after a reload without another request', async ({ page }) => {
    await page.locator('#chumash').click();
    await expect(page.locator('.flow')).toBeVisible();
    expect(text.requests).toEqual(['noach']);
    await page.reload();
    await expect(page.locator('.flow')).toBeVisible();
    expect(text.requests).toEqual(['noach']);
  });
});

test.describe('double weeks', () => {
  test('each half reads on its own, with seven aliyos and no maftir', async ({ page }) => {
    await page.clock.setFixedTime(new Date('2026-04-12T12:00:00Z'));
    await page.reload();
    await expect(page.locator('h1')).toHaveText('Parshas Tazria');
    await page.locator('#chumash').click();
    await expect(page.locator('#panel-chumash h1')).toHaveText('Parshas Tazria');
    await expect(page.locator('.aliyah-step')).toHaveCount(7);
    await page.locator('#reader-complete').click();
    await expect(page.locator('#reader-complete')).toHaveText('Aliyah complete');
    await page.locator('#reader-parsha').selectOption('Metzora');
    await expect(page.locator('#panel-chumash h1')).toHaveText('Parshas Metzora');
    await expect(page.locator('#reader-complete')).toHaveText('Mark aliyah complete');
    expect(await progressOf(page, 'Tazria', 5786)).toEqual({ mikra1_1: true, mikra2_1: true, onkelos_1: true });
    expect(await progressOf(page, 'Metzora', 5786)).toEqual({});
    await page.locator('#tracker').click();
    await page.locator('#expand-mikra1').click();
    await expect(page.locator('#aliyos-mikra1 [role="checkbox"]')).toHaveCount(7);
  });
});

test.describe('layout and access', () => {
  const noOverflow = page => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);

  test('a small screen and long verses fit in every theme, with controls clear of the bar', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 568 });
    for (const theme of ['grayscale', 'dark-grayscale', 'forest', 'forest-dark', 'parchment', 'midnight', 'tekhelet', 'kinneret', 'jerusalem-stone', 'olive-press', 'pomegranate', 'havdalah']) {
      await page.locator('#settings').click();
      await page.locator(`[data-theme-choice="${theme}"]`).click();
      await page.locator('#chumash').click();
      for (const name of ['flow', 'cards', 'classic']) {
        await mode(page, name);
        await page.locator('#reader-aliyah-1').click();
        expect(await noOverflow(page), `${theme} ${name}`).toBe(true);
      }
      await page.locator('#reader-aliyah-0').click();
    }
    await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight));
    const action = await page.locator('#reader-continue').boundingBox();
    const bar = await page.locator('.tabbar').boundingBox();
    expect(action.y + action.height).toBeLessThanOrEqual(bar.y);

    await mode(page, 'cards');
    const nav = await page.locator('.card-nav').boundingBox();
    const tabs = await page.locator('.tabbar').boundingBox();
    expect(nav.y + nav.height).toBeLessThanOrEqual(tabs.y + 1);
  });

  test('the sticky bar does not cover the text it restores to, and controls meet touch size', async ({ page }) => {
    await page.locator('#chumash').click();
    await scrollToVerse(page, '1:3');
    await page.waitForTimeout(100);
    const barBottom = await page.locator('.reader-bar').evaluate(element => element.getBoundingClientRect().bottom);
    const top = await page.locator('[data-ref="1:3"][data-part="first"]').evaluate(element => element.getBoundingClientRect().top);
    expect(top).toBeGreaterThanOrEqual(barBottom);
    const small = await page.locator('.reader-title-pick, .aliyah-step, .reader-mark, .reader-continue').evaluateAll(elements =>
      elements.filter(element => element.getBoundingClientRect().height < 44).map(element => element.id));
    expect(small).toEqual([]);
    expect((await page.locator('.reader-mode').first().boundingBox()).height).toBeGreaterThanOrEqual(36);
  });

  test('desktop keeps a reading column; hebrew text is rtl and renders in the cantillation font', async ({ page }) => {
    await page.setViewportSize({ width: 1400, height: 900 });
    await page.locator('#chumash').click();
    await expect(page.locator('.flow')).toBeVisible();
    const box = await page.locator('.reader-view').boundingBox();
    expect(box.width).toBeLessThan(681);
    expect(await noOverflow(page)).toBe(true);
    const style = await page.locator('.pasuk-text').first().evaluate(element => {
      const computed = getComputedStyle(element);
      return { direction: computed.direction, font: computed.fontFamily, lineHeight: parseFloat(computed.lineHeight) / parseFloat(computed.fontSize) };
    });
    expect(style.direction).toBe('rtl');
    expect(style.font).toContain('Reader Hebrew');
    expect(style.lineHeight).toBeGreaterThanOrEqual(1.9);
    await expect.poll(() => page.evaluate(() => document.fonts.check('24px "Reader Hebrew"', 'א'))).toBe(true);
  });

  test('larger text scales the reader and a resize keeps the place', async ({ page }) => {
    await page.locator('#chumash').click();
    await scrollToVerse(page, '1:3', 'targum');
    await expect.poll(() => savedPosition(page)).toMatchObject({ ref: '1:3', part: 'targum' });
    const before = await page.locator('.pasuk-text').first().evaluate(element => parseFloat(getComputedStyle(element).fontSize));
    await page.evaluate(() => { document.documentElement.dataset.textSize = 'larger'; });
    const after = await page.locator('.pasuk-text').first().evaluate(element => parseFloat(getComputedStyle(element).fontSize));
    expect(after).toBeGreaterThan(before);
    await page.setViewportSize({ width: 320, height: 852 });
    await expect.poll(async () => Math.abs(await verseTop(page, '1:3', 'targum'))).toBeLessThanOrEqual(12);
    expect(await noOverflow(page)).toBe(true);
  });

  test('the keyboard reaches everything in order, with names and visible focus', async ({ page }) => {
    await page.locator('#chumash').click();
    await expect(page.locator('.flow')).toBeVisible();
    await page.locator('#reader-parsha').focus();
    const order = [];
    for (let press = 0; press < 11; press += 1) {
      await page.keyboard.press('Tab');
      order.push(await page.evaluate(() => document.activeElement.id));
    }
    expect(order).toEqual([0, 1, 2, 3, 4, 5, 6].map(index => `reader-aliyah-${index}`).concat('reader-mode-cards', 'reader-mode-flow', 'reader-mode-classic', 'reader-complete'));
  });

  test('arrow keys turn cards in the direction of the buttons, but not from a menu or in flow', async ({ page }) => {
    await page.locator('#chumash').click();
    await page.keyboard.press('ArrowLeft');
    await expect(location(page)).toHaveText('Aliyah 1 · Pasuk 1 of 4');
    await mode(page, 'cards');
    await page.keyboard.press('ArrowLeft');
    await expect(location(page)).toHaveText('Aliyah 1 · Pasuk 2 of 4');
    await page.keyboard.press('ArrowRight');
    await expect(location(page)).toHaveText('Aliyah 1 · Pasuk 1 of 4');
    await page.locator('#reader-parsha').focus();
    await page.keyboard.press('ArrowLeft');
    await expect(location(page)).toHaveText('Aliyah 1 · Pasuk 1 of 4');
  });

  test('cards work by keyboard alone, and modes announce once without scroll chatter', async ({ page }) => {
    await page.locator('#chumash').click();
    await expect(page.locator('.flow')).toBeVisible();
    await page.locator('#reader-mode-cards').focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('#reader-mode-cards')).toBeFocused();
    await expect(page.locator('#announcement')).toHaveText('Cards view, Aliyah 1 · Pasuk 1 of 4');
    const outline = await page.locator('#reader-mode-cards').evaluate(element => getComputedStyle(element).outlineStyle);
    expect(outline).toBe('solid');
    await page.locator('#reader-next').focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('.pasuk-ref')).toHaveText('Bereishis 1:2');
    await expect(page.locator('#reader-next')).toBeFocused();
    await expect(page.locator('#announcement')).toHaveText('Pasuk 2 of 4, 1:2');
    await page.keyboard.press('Enter');
    await page.keyboard.press('Enter');
    await page.keyboard.press('Enter');
    await expect(page.locator('.reader-end h2')).toBeFocused();
    await expect(page.locator('#announcement')).toHaveText('End of Rishon');
    await page.evaluate(() => { document.querySelector('#announcement').textContent = 'unchanged'; });
    await mode(page, 'flow');
    await page.evaluate(() => { document.querySelector('#announcement').textContent = 'unchanged'; });
    await page.evaluate(() => scrollTo(0, 0));
    await page.waitForTimeout(120);
    await expect(page.locator('#announcement')).toHaveText('unchanged');
    await expect(page.locator('#reader-location')).not.toHaveAttribute('aria-live', /.+/);
  });

  test('reduced motion turns off slides, and hebrew naming flows through the reader', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.locator('#settings').click();
    await page.locator('#parsha-naming').selectOption('hebrew');
    await page.locator('#chumash').click();
    await expect(page.locator('#panel-chumash h1')).toHaveAttribute('lang', 'he');
    await expect(page.locator('.pasuk-ref').first()).toHaveText('בראשית א:א');
    await expect(page.locator('#reader-parsha')).toHaveAttribute('lang', 'he');
    await mode(page, 'cards');
    await page.locator('#reader-next').click();
    const animations = await page.locator('#reader-card').evaluate(element => element.getAnimations().length);
    expect(animations).toBe(0);
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.locator('#reader-next').click();
    expect(await page.locator('#reader-card').evaluate(element => element.getAnimations().length)).toBeGreaterThan(0);
  });
});
