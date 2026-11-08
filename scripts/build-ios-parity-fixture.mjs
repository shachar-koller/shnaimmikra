// Records what the web app's own code returns, so the iOS core's tests can check it matches.
// Run with `npm run build:ios-data` (it runs this too).
import { writeFileSync } from 'node:fs';
import { cycleYear, schedule, shabbosCountdown, formatGregorianDate, currentParsha } from '../src/model.js';
import { fixName, heroName, titleName, hebrewName } from '../src/names.js';
import { normalizeData } from '../src/storage.js';
import { createBackup, parseBackup, backupSummary } from '../src/backup.js';
import { progressText } from '../src/progress.js';

const out = new URL('../ios/ShnayimCore/Tests/ShnayimCoreTests/web-parity.json', import.meta.url);
const dayNumber = date => Math.round(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86400000);
const localDate = number => { const utc = new Date(number * 86400000); return new Date(utc.getUTCFullYear(), utc.getUTCMonth(), utc.getUTCDate(), 12); };

const cycleYears = [];
for (let day = dayNumber(new Date(2025, 0, 1)); day <= dayNumber(new Date(2031, 0, 1)); day++) {
  cycleYears.push([day, cycleYear(localDate(day), false), cycleYear(localDate(day), true)]);
}
const schedules = [5785, 5786, 5787, 5788, 5790].flatMap(year => [false, true].map(israel => ({
  year, israel, rows: schedule(year, israel).map(row => [row.id, dayNumber(row.date)]),
})));
const current = [];
for (let day = dayNumber(new Date(2026, 8, 1)); day <= dayNumber(new Date(2026, 11, 31)); day += 3) {
  const rows = schedule(cycleYear(localDate(day)), false);
  current.push([day, currentParsha(rows, localDate(day)).id, shabbosCountdown(currentParsha(rows, localDate(day)).date, localDate(day))]);
}
const ids = schedule(5787).map(row => row.id);
const names = ids.map(id => ({
  id, ashkenazi: fixName(id), sephardi: fixName(id, 'sephardi'), hebrew: fixName(id, 'hebrew'),
  hero: heroName([id]), heroSephardi: heroName([id], 'sephardi'), heroHebrew: heroName([id], 'hebrew'), he: hebrewName([id]),
}));
const doubles = [['Vayakhel', 'Pekudei'], ['Matot', 'Masei'], ['Nitzavim', 'Vayeilech']].map(pair => ({
  names: pair, title: titleName(pair), titleHebrew: titleName(pair, 'hebrew'), hero: heroName(pair), he: hebrewName(pair),
}));

const messy = {
  progress: {
    '5787:Bereshit': { mikra1_1: true, mikra1_2: false, onkelos_3: true, bogus: true, rashi_9: true },
    '5787:Noach': Object.fromEntries(['mikra1', 'mikra2', 'onkelos'].flatMap(r => [1, 2, 3, 4, 5, 6, 7].map(i => [`${r}_${i}`, true]))),
    '5787:Lech-Lecha': { mikra1_1: true, mikra1_2: true, rashi_1: true, rashi_2: true },
    '5787:Vayera': { mikra2_7: false },
    'bad': { mikra1_1: true },
    '5786:Vezot Haberakhah': { mikra2_1: true },
  },
  israel: 'yes', commentary: 'rashi', theme: 'nonexistent', peirushName: '  Sforno   on the  Torah ',
  glass: 120, naming: 'sephardi', reminderDays: [5, 1, 3], reminderTime: '7:00', confetti: false, unknown: 1,
};
const normalized = normalizeData(messy);
const now = new Date('2026-11-08T10:20:30.456Z');
const backup = createBackup(normalized, now);
const bad = text => { try { parseBackup(text); return null; } catch (error) { return error.message; } };
const backupErrors = [
  ['not json', bad('{')],
  ['wrong format', bad(JSON.stringify({ format: 'x', version: 2, data: {} }))],
  ['bad theme', bad(JSON.stringify({ format: 'shnayim-mikra-backup', version: 2, data: { progress: {}, israel: false, commentary: 'onkelos', theme: 'nope' } }))],
  ['bad record', bad(JSON.stringify({ format: 'shnayim-mikra-backup', version: 2, data: { progress: { '5787:Nope': {} }, israel: false, commentary: 'onkelos', theme: 'forest' } }))],
  ['bad field', bad(JSON.stringify({ format: 'shnayim-mikra-backup', version: 2, data: { progress: { '5787:Noach': { mikra1_8: true } }, israel: false, commentary: 'onkelos', theme: 'forest' } }))],
];

writeFileSync(out, JSON.stringify({
  cycleYears, schedules, current, names, doubles,
  dates: [[dayNumber(new Date(2026, 10, 14)), formatGregorianDate(new Date(2026, 10, 14)), formatGregorianDate(new Date(2026, 10, 14), true)]],
  messy, normalized, backup, restored: parseBackup(backup), summary: backupSummary(normalized), backupErrors,
  progressText: progressText(normalized, id => fixName(id, normalized.naming), now),
}, null, 1) + '\n');
console.log('Wrote web parity fixture.');
