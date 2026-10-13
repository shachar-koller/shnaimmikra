import test from 'node:test';
import assert from 'node:assert/strict';
import {
  complete,
  steps,
  cycleYear,
  schedule,
  localShabbosDate,
  currentParsha,
  shabbosCountdown,
  formatGregorianDate,
  DOUBLE_PARSHIYOS,
} from '../src/model.js';

test('cycleYear determines Hebrew cycle year correctly', () => {
  const y = cycleYear(new Date(2026, 9, 11), false);
  assert.equal(typeof y, 'number');
  assert.ok(y >= 5780);
});

test('schedule returns parshiyos for year', () => {
  const rows = schedule(5787, false);
  assert.ok(rows.length > 50);
  assert.ok(rows.some(r => r.id === 'Bereshit' || r.names.includes('Bereshit')));
  assert.ok(rows.some(r => r.id === 'Vezot Haberakhah'));
});

test('double parshiyos have separate identities, numbers, and a shared Shabbos', () => {
  for (const israel of [false, true]) {
    const rows = schedule(5786, israel);
    assert.equal(rows.length, 54);
    assert.equal(new Set(rows.map(r => r.id)).size, 54);
    assert.deepEqual(rows.map(r => r.num), Array.from({ length: 54 }, (_, i) => i + 1));
    assert.ok(rows.every(r => r.names.length === 1 && r.names[0] === r.id));
    for (const [first, second] of DOUBLE_PARSHIYOS) {
      assert.ok(rows.some(r => r.id === first));
      assert.ok(rows.some(r => r.id === second));
      assert.ok(!rows.some(r => r.id === `${first}-${second}`));
    }
    const tazria = rows.find(r => r.id === 'Tazria');
    const metzora = rows.find(r => r.id === 'Metzora');
    assert.equal(tazria.date.getTime(), metzora.date.getTime());
    assert.equal(currentParsha(rows, new Date(2026, 3, 12)).id, 'Tazria');
    assert.equal(currentParsha(rows, new Date(2026, 3, 19)).id, 'Achrei Mot');
    assert.ok(rows.some(r => r.id === 'Lech-Lecha'));
  }
});

test('progress completion checks all readings', () => {
  assert.equal(complete({ mikra1: true, mikra2: true, onkelos: true }), true);
  assert.equal(complete({ mikra1: true, mikra2: true, rashi: true }), true);
  assert.equal(complete({ mikra1: true, mikra2: true }), false);
  assert.equal(steps({ mikra1: true, mikra2: true, rashi: true }), 3);
  assert.equal(steps({ mikra1: true }), 1);
});

test('localShabbosDate preserves Hebcal local midnight', () => {
  const hebcalDate = new Date(2026, 9, 17);
  const local = localShabbosDate(hebcalDate);
  assert.equal(local.getFullYear(), 2026);
  assert.equal(local.getMonth(), 9);
  assert.equal(local.getDate(), 17);
});

test('currentParsha finds upcoming Shabbos and rolls over correctly', () => {
  const rows = schedule(5787, false);
  // Sunday Oct 11, 2026 should be Noach (Oct 17, 2026)
  const sunday = new Date(2026, 9, 11, 10, 0, 0);
  const pSun = currentParsha(rows, sunday);
  assert.equal(pSun.id, 'Noach');

  // Saturday Oct 17, 2026 morning should still be Noach
  const saturday = new Date(2026, 9, 17, 10, 0, 0);
  const pSat = currentParsha(rows, saturday);
  assert.equal(pSat.id, 'Noach');

  // Sunday Oct 18, 2026 should roll over to Lech-Lecha (Oct 24, 2026)
  const nextSunday = new Date(2026, 9, 18, 10, 0, 0);
  const pNextSun = currentParsha(rows, nextSunday);
  assert.equal(pNextSun.id, 'Lech-Lecha');
});

test('shabbosCountdown computes relative countdown', () => {
  const shabbos = new Date(2026, 9, 17); // Oct 17
  assert.equal(shabbosCountdown(shabbos, new Date(2026, 9, 11)), '6 days away');
  assert.equal(shabbosCountdown(shabbos, new Date(2026, 9, 12)), '5 days away');
  assert.equal(shabbosCountdown(shabbos, new Date(2026, 9, 15)), '2 days away');
  assert.equal(shabbosCountdown(shabbos, new Date(2026, 9, 16)), '1 day away');
  assert.equal(shabbosCountdown(shabbos, new Date(2026, 9, 17)), 'Today');
});

test('formatGregorianDate formats month and day', () => {
  const d = new Date(2026, 9, 17);
  assert.equal(formatGregorianDate(d), 'October 17');
});
