import { checkedReadings } from './fixtures.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { complete, steps } from '../src/model.js';
import { readingChecks, readingCount, aliyahSteps, applyReadingPatch, wholeReadingPatch } from '../src/readings.js';
import { createRepository, storageKey, hasPending, pendingValues } from '../src/storage.js';
import { createSyncEngine } from '../src/sync.js';
import { createBackup, parseBackup, backupSummary } from '../src/backup.js';
import { progressText } from '../src/progress.js';

const key = '5787:Noach';
function repository(initial = {}) {
  const values = new Map(Object.entries(initial));
  return createRepository({ getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) });
}

test('unchecking one aliyah preserves its six siblings and updates completion', () => {
  const completed = checkedReadings('mikra1', 'mikra2', 'onkelos');
  const partial = applyReadingPatch(completed, { mikra1_4: false });
  assert.equal(complete(partial), false);
  assert.equal(steps(partial), 2);
  assert.equal(readingCount(partial, 'mikra1'), 6);
  assert.deepEqual(readingChecks(partial, 'mikra1'), [true, true, true, false, true, true, true]);
  assert.equal(complete(applyReadingPatch(partial, { mikra1_4: true })), true);
  assert.equal(readingCount(applyReadingPatch(partial, wholeReadingPatch('mikra1', false)), 'mikra1'), 0);
});

test('out-of-order checks persist and mixed commentary never completes the third reading', () => {
  const repo = repository();
  repo.reading(null, key, { ...checkedReadings('mikra1', 'mikra2'), onkelos_7: true, rashi_1: true, rashi_2: true });
  const progress = repo.read(null).data.progress[key];
  assert.equal(complete(progress), false);
  assert.equal(steps(progress), 2);
  assert.equal(aliyahSteps(progress), 16);
  assert.deepEqual(readingChecks(progress, 'onkelos'), [false, false, false, false, false, false, true]);
  repo.reading(null, key, checkedReadings('rashi'));
  assert.equal(complete(repo.read(null).data.progress[key]), true);
  assert.equal(readingCount(repo.read(null).data.progress[key], 'onkelos'), 1);
});

test('durable per-cell pending edits overlay refreshed records and acknowledge independently', () => {
  const repo = repository({ [storageKey('alice')]: JSON.stringify({ progress: { [key]: checkedReadings('mikra1') } }) });
  repo.reading('alice', key, { mikra1_4: false });
  const sent = repo.read('alice').pending;
  assert.deepEqual(pendingValues(sent.progress[key]), { mikra1_4: false });
  repo.acceptRemote('alice', { progress: { [key]: { ...checkedReadings('mikra1'), mikra2_6: true } } });
  assert.equal(readingCount(repo.read('alice').data.progress[key], 'mikra1'), 6);
  assert.equal(readingCount(repo.read('alice').data.progress[key], 'mikra2'), 1);
  repo.reading('alice', key, { mikra1_4: true });
  repo.acknowledge('alice', sent);
  assert.deepEqual(pendingValues(repo.read('alice').pending.progress[key]), { mikra1_4: true });
  assert.equal(repo.read(null).data.progress[key], undefined);
});

test('offline devices merge different aliyos, explicit unchecks retry, and untouched caches never upload', async () => {
  let remote = { [key]: checkedReadings('mikra1') };
  let offline = true;
  const writes = [];
  const cloud = {
    async pull() { if (offline) throw new Error('offline'); return { progress: structuredClone(remote) }; },
    async writeProgress(_user, key, patch) { if (offline) throw new Error('offline'); writes.push(patch); remote[key] = { ...remote[key], ...patch }; },
    async writeProfile() {},
    async clear() { remote = {}; },
  };
  const a = repository(), b = repository();
  a.reading('alice', key, { mikra1_2: false });
  b.reading('alice', key, { mikra1_3: false, mikra2_7: true });
  const engineA = createSyncEngine({ repository: a, cloud, userId: 'alice' });
  const engineB = createSyncEngine({ repository: b, cloud, userId: 'alice' });
  try {
    await assert.rejects(engineA.sync(), /offline/);
    assert.equal(hasPending(a.read('alice')), true);
    offline = false;
    await engineB.sync();
    await engineA.sync();
    await engineB.sync();
    for (const repo of [a, b]) {
      const progress = repo.read('alice').data.progress[key];
      assert.equal(readingCount(progress, 'mikra1'), 5);
      assert.equal(progress.mikra2_7, true);
      assert.equal(hasPending(repo.read('alice')), false);
    }
    assert.deepEqual(writes, [{ mikra1_3: false, mikra2_7: true }, { mikra1_2: false }]);
    await engineA.sync();
    assert.equal(writes.length, 2);
  } finally { await engineA.stop(); await engineB.stop(); }
});

test('additive import and backups preserve partial checks and custom labels', () => {
  const repo = repository();
  repo.reading(null, key, { mikra1_7: true, onkelos_3: true });
  const initial = repo.read(null).data;
  initial.peirushName = 'Ramban';
  const backup = createBackup(initial);
  assert.equal(JSON.parse(backup).version, 2);
  const parsed = parseBackup(backup);
  assert.deepEqual(parsed, initial);
  assert.equal(backupSummary(parsed).aliyos, 2);
  repo.reading(null, key, { mikra1_2: true });
  repo.importData(null, parsed);
  assert.equal(readingCount(repo.read(null).data.progress[key], 'mikra1'), 2);
  const text = progressText(repo.read(null).data);
  assert.match(text, /Mikra I — 2 of 7 aliyos/);
  assert.match(text, /\[x\] Aliyah 7/);
  const invalid = JSON.parse(backup);
  invalid.data.progress[key] = { mikra1_8: true };
  assert.throws(() => parseBackup(JSON.stringify(invalid)), /invalid reading/);
});

test('reset retains only later pending aliyos, and guest import does not copy another account', () => {
  const repo = repository();
  repo.reading('alice', key, { mikra1_1: true });
  repo.requestReset('alice');
  const reset = repo.read('alice').pending.reset;
  repo.reading('alice', key, { mikra2_4: true });
  repo.acknowledgeReset('alice', reset);
  const progress = repo.read('alice').data.progress[key];
  assert.equal(readingCount(progress, 'mikra1'), 0);
  assert.equal(readingCount(progress, 'mikra2'), 1);
  assert.deepEqual(repo.read('bob').data.progress, {});
  repo.reading(null, key, { onkelos_3: true });
  repo.importData('alice', repo.read(null).data, false);
  assert.equal(readingCount(repo.read('alice').data.progress[key], 'onkelos'), 1);
  assert.equal(readingCount(repo.read(null).data.progress[key], 'mikra2'), 0);
});
