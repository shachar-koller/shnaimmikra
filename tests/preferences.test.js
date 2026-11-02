import test from 'node:test';
import assert from 'node:assert/strict';
import { preferences, resolvedTheme, validPreferences } from '../src/preferences.js';
import { createRepository, emptyData, hasPending, pendingValues, SETTING_KEYS } from '../src/storage.js';
import { createCloudAdapter, createSyncEngine } from '../src/sync.js';
import { createBackup, parseBackup } from '../src/backup.js';
import { fixName, titleName, heroName, sefarimFor } from '../src/names.js';
import { reminderCalendar } from '../src/reminders.js';

const settings = { followDevice: true, lightTheme: 'parchment', darkTheme: 'midnight', textSize: 'larger', glass: 35, naming: 'hebrew', confetti: false, vibration: false, reminderDays: [1, 4], reminderTime: '18:30' };
function repository() {
  const memory = new Map();
  return createRepository({ getItem: key => memory.get(key), setItem: (key, value) => memory.set(key, value) });
}

const pendingSettings = (repo, user = 'account') => pendingValues(repo.read(user).pending.profile);

test('new preferences survive saves, backups, imports and remote refresh, and sync to the account', () => {
  const repo = repository();
  repo.settings('account', settings);
  assert.deepEqual(preferences(repo.read('account').data), settings);
  assert.deepEqual(pendingSettings(repo), settings);
  const restored = parseBackup(createBackup(repo.read('account').data));
  repo.importData(null, restored);
  assert.deepEqual(preferences(repo.read(null).data), settings);
  // Unacknowledged edits outlast a refresh that still has the old account values.
  repo.acceptRemote('account', { progress: {}, profile: { israel: true, commentary: 'rashi', glass: 80, naming: 'sephardi' } });
  assert.deepEqual(preferences(repo.read('account').data), settings);
  assert.equal(repo.read('account').data.israel, true);
  repo.importData('another-account', restored, false);
  assert.equal(preferences(repo.read('another-account').data).followDevice, false);
  assert.equal(preferences(parseBackup(createBackup(emptyData()))).naming, 'ashkenazi');
});

test('account values replace this device, and only real changes queue a write', () => {
  const repo = repository();
  repo.settings('account', { theme: 'midnight', peirushName: 'Ramban', reminderDays: [1, 4] });
  repo.acknowledge('account', { profile: repo.read('account').pending.profile });
  repo.settings('account', { theme: 'midnight', peirushName: 'Ramban', reminderDays: [1, 4] });
  assert.equal(hasPending(repo.read('account')), false);
  repo.acceptRemote('account', { progress: {}, profile: { israel: true, commentary: 'rashi', theme: 'parchment', peirushName: 'Sforno', followDevice: true, reminderDays: [0], reminderTime: '07:15' } });
  const { data } = repo.read('account');
  assert.equal(data.theme, 'parchment');
  assert.equal(data.peirushName, 'Sforno');
  assert.equal(data.followDevice, true);
  assert.deepEqual(data.reminderDays, [0]);
  assert.equal(data.reminderTime, '07:15');
  assert.equal(hasPending(repo.read('account')), false);
});

test('clearing the custom peirush reaches other devices', () => {
  const editor = repository(), other = repository();
  for (const repo of [editor, other]) repo.settings('account', { peirushName: 'Ramban' });
  other.acknowledge('account', { profile: other.read('account').pending.profile });
  editor.settings('account', { peirushName: undefined });
  assert.equal(editor.read('account').data.peirushName, undefined);
  const { peirushName } = pendingSettings(editor);
  assert.equal(peirushName, 'Rashi');
  other.acceptRemote('account', { progress: {}, profile: { israel: false, commentary: 'onkelos', peirushName } });
  assert.equal(other.read('account').data.peirushName, undefined);
  assert.equal(hasPending(other.read('account')), false);
});

test('choices already on a device fill settings the account has never saved', () => {
  const repo = repository();
  repo.settings('account', { theme: 'midnight', glass: 35, confetti: true, peirushName: 'Ramban' });
  repo.acknowledge('account', { profile: repo.read('account').pending.profile });
  repo.acceptRemote('account', { progress: {}, profile: { israel: false, commentary: 'onkelos', theme: null, glass: 70, confetti: null, peirushName: null } });
  // Defaults are not uploaded, so a new device can't overwrite another device's choice.
  assert.deepEqual(pendingSettings(repo), { theme: 'midnight', peirushName: 'Ramban' });
  assert.equal(repo.read('account').data.glass, 70);
  const fresh = repository();
  fresh.acceptRemote('account', { progress: {}, profile: { israel: false, commentary: 'onkelos', theme: null, glass: null } });
  assert.equal(hasPending(fresh.read('account')), false);
});

test('invalid account values fall back to defaults instead of breaking the app', () => {
  const repo = repository();
  repo.acceptRemote('account', { progress: {}, profile: { israel: false, commentary: 'onkelos', theme: 'light', glass: 900, naming: 'klingon' } });
  const { data } = repo.read('account');
  assert.equal(data.theme, 'grayscale');
  assert.equal(preferences(data).glass, 50);
  assert.equal(preferences(data).naming, 'ashkenazi');
});

test('the cloud adapter maps every setting to its own column', async () => {
  const calls = [];
  const row = { israel: true, commentary: 'rashi', theme: 'midnight', peirush_name: 'Ramban', follow_device: true, light_theme: 'forest', dark_theme: 'midnight', text_size: 'larger', glass: 35, naming: 'hebrew', confetti: false, vibration: false, reminder_days: [1, 4], reminder_time: '18:30' };
  const query = result => {
    const chain = { select: columns => { calls.push(columns); return chain; }, eq: () => chain, order: () => chain, range: async () => ({ data: [], error: null }), maybeSingle: async () => result };
    return chain;
  };
  const cloud = createCloudAdapter({ from: table => table === 'profiles'
    ? { ...query({ data: row, error: null }), upsert: async written => { calls.push(written); return { error: null }; } }
    : query({ data: [], error: null }) });
  const { profile } = await cloud.pull('alice');
  assert.deepEqual(Object.keys(profile), SETTING_KEYS);
  assert.deepEqual(new Set(Object.keys(row)), new Set(calls[0].split(', ')));
  assert.equal(profile.peirushName, 'Ramban');
  assert.deepEqual(profile.reminderDays, [1, 4]);
  await cloud.writeProfile('alice', { followDevice: true, reminderTime: '18:30' });
  assert.deepEqual(calls.at(-1), { id: 'alice', follow_device: true, reminder_time: '18:30' });
});

test('two devices share settings through sync', async () => {
  let account = { israel: false, commentary: 'onkelos' };
  const cloud = {
    async pull() { return { progress: {}, profile: structuredClone(account) }; },
    async writeProgress() {},
    async writeProfile(_user, patch) { account = { ...account, ...patch }; },
    async clear() {},
  };
  const a = repository(), b = repository();
  const engineA = createSyncEngine({ repository: a, cloud, userId: 'alice' });
  const engineB = createSyncEngine({ repository: b, cloud, userId: 'alice' });
  try {
    a.settings('alice', { theme: 'midnight', glass: 35 });
    await engineA.sync();
    await engineB.sync();
    assert.equal(b.read('alice').data.theme, 'midnight');
    assert.equal(b.read('alice').data.glass, 35);
    b.settings('alice', { theme: 'forest' });
    await engineB.sync();
    await engineA.sync();
    assert.equal(a.read('alice').data.theme, 'forest');
    assert.equal(a.read('alice').data.glass, 35);
    assert.equal(hasPending(a.read('alice')) || hasPending(b.read('alice')), false);
  } finally { await engineA.stop(); await engineB.stop(); }
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
