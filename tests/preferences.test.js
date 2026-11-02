import test from 'node:test';
import assert from 'node:assert/strict';
import { preferences, resolvedTheme, validPreferences } from '../src/preferences.js';
import { createRepository, emptyData } from '../src/storage.js';
import { createBackup, parseBackup } from '../src/backup.js';
import { fixName, titleName, heroName, sefarimFor } from '../src/names.js';
import { reminderCalendar } from '../src/reminders.js';

const settings = { followDevice: true, lightTheme: 'parchment', darkTheme: 'midnight', textSize: 'larger', glass: 35, naming: 'hebrew', confetti: false, vibration: false, reminderDays: [1, 4], reminderTime: '18:30' };
function repository() {
  const memory = new Map();
  return createRepository({ getItem: key => memory.get(key), setItem: (key, value) => memory.set(key, value) });
}

test('new preferences survive saves, backups, imports and remote refresh without cloud profile writes', () => {
  const repo = repository();
  repo.settings('account', settings);
  assert.deepEqual(preferences(repo.read('account').data), settings);
  assert.deepEqual(repo.read('account').pending.profile, {});
  const restored = parseBackup(createBackup(repo.read('account').data));
  repo.importData(null, restored);
  assert.deepEqual(preferences(repo.read(null).data), settings);
  repo.acceptRemote('account', { progress: {}, profile: { israel: true, commentary: 'rashi' } });
  assert.deepEqual(preferences(repo.read('account').data), settings);
  assert.equal(repo.read('account').data.israel, true);
  repo.importData('another-account', restored, false);
  assert.equal(preferences(repo.read('another-account').data).followDevice, false);
  assert.equal(preferences(parseBackup(createBackup(emptyData()))).naming, 'ashkenazi');
});

test('old saves retain defaults and malformed optional backup preferences are rejected', () => {
  const old = emptyData();
  assert.equal(preferences(old).textSize, 'standard');
  assert.equal(preferences(old).confetti, true);
  assert.equal(resolvedTheme({ ...old, theme: 'forest-dark' }, false), 'forest-dark');
  assert.equal(resolvedTheme({ ...old, ...settings }, false), 'parchment');
  assert.equal(resolvedTheme({ ...old, ...settings }, true), 'midnight');
  for (const patch of [{ followDevice: 'true' }, { lightTheme: 'midnight' }, { darkTheme: 'forest' }, { naming: 'unknown' }, { textSize: 30 }, { glass: 101 }, { glass: 1.5 }, { glass: '60' }, { confetti: null }, { vibration: 1 }, { reminderDays: [7] }, { reminderDays: [1, 1] }, { reminderTime: '25:00' }]) {
    assert.equal(validPreferences(patch), false);
    const backup = JSON.parse(createBackup(old));
    Object.assign(backup.data, patch);
    assert.throws(() => parseBackup(JSON.stringify(backup)), /invalid settings/);
  }
});

test('naming supports double parshiyos and book names while preserving existing defaults', () => {
  assert.equal(fixName('Bereshit'), 'Bereishis');
  assert.equal(fixName('Chukat', 'sephardi'), 'Chukat');
  assert.equal(titleName(['Matot', 'Masei'], 'ashkenazi'), 'Matos – Masei');
  assert.equal(titleName(['Matot', 'Masei'], 'sephardi'), 'Matot – Masei');
  assert.match(titleName(['Matot', 'Masei'], 'hebrew'), /מטות.*מסעי/);
  assert.equal(heroName(['Shemot'], 'sephardi'), 'Parashat Shemot');
  assert.equal(heroName(['Shemot'], 'hebrew'), 'פרשת שמות');
  assert.equal(sefarimFor('hebrew')[0].en, 'בראשית');
  assert.equal(sefarimFor('sephardi')[0].en, 'Bereshit');
});

test('calendar reminders use selected weekdays, next local occurrence, and an alert at event time', () => {
  const now = new Date(2026, 10, 2, 20, 0); // Monday, after reminder time.
  const calendar = reminderCalendar(settings, now, 'https://example.com/');
  assert.match(calendar, /DTSTART:20261105T183000\r\n/);
  assert.match(calendar, /RRULE:FREQ=WEEKLY;BYDAY=MO,TH\r\n/);
  assert.match(calendar, /BEGIN:VALARM\r\nACTION:DISPLAY\r\nTRIGGER:PT0S/);
  assert.match(calendar, /https:\/\/example.com\//);
  assert.doesNotMatch(calendar, /DTSTART:.*Z/);
  assert.match(reminderCalendar({ reminderDays: [1], reminderTime: '18:30' }, now), /DTSTART:20261109T183000/);
  assert.throws(() => reminderCalendar({ reminderDays: [], reminderTime: '18:30' }), /Choose at least/);
  assert.throws(() => reminderCalendar({ reminderDays: [1], reminderTime: '99:30' }), /valid time/);
  const long = reminderCalendar(settings, now, 'https://example.com/' + 'א'.repeat(80));
  assert.ok(long.split('\r\n').every(line => new TextEncoder().encode(line).length <= 75));
});

test('a daylight-saving gap on an unselected day does not shift the next reminder time', () => {
  const previous = process.env.TZ;
  try {
    process.env.TZ = 'America/New_York';
    const calendar = reminderCalendar({ reminderDays: [1], reminderTime: '02:30' }, new Date(2026, 2, 8, 0, 0));
    assert.match(calendar, /DTSTART:20260309T023000/);
  } finally {
    if (previous === undefined) delete process.env.TZ;
    else process.env.TZ = previous;
  }
});
