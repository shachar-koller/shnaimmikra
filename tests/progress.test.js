import test from 'node:test';
import assert from 'node:assert/strict';
import { DOUBLE_PARSHIYOS } from '../src/model.js';
import { splitDoubleProgress, progressText } from '../src/progress.js';

test('legacy double progress migrates across all pairs and cycles without linking records', () => {
  const progress = { '5787:Lech-Lecha': { mikra1: true } };
  for (const year of [5786, 5787]) {
    for (const pair of DOUBLE_PARSHIYOS) {
      progress[`${year}:${pair.join('-')}`] = { mikra1: true, mikra2: true, rashi: true };
    }
  }
  const migrated = splitDoubleProgress(progress);
  for (const year of [5786, 5787]) {
    for (const [first, second] of DOUBLE_PARSHIYOS) {
      assert.equal(migrated[`${year}:${first}-${second}`], undefined);
      assert.deepEqual(migrated[`${year}:${first}`], { mikra1: true, mikra2: true, rashi: true });
      assert.deepEqual(migrated[`${year}:${second}`], { mikra1: true, mikra2: true, rashi: true });
      assert.notEqual(migrated[`${year}:${first}`], migrated[`${year}:${second}`]);
    }
  }
  assert.deepEqual(migrated['5787:Lech-Lecha'], { mikra1: true });
  assert.deepEqual(splitDoubleProgress(migrated), migrated);
  assert.ok(progress['5786:Tazria-Metzora']);
});

test('individual progress takes precedence over legacy double records', () => {
  const migrated = splitDoubleProgress({
    '5786:Tazria-Metzora': { mikra1: true, mikra2: true, onkelos: true },
    '5786:Tazria': { mikra1: false, rashi: true },
    '5786:Metzora': {},
  });
  assert.deepEqual(migrated, {
    '5786:Tazria': { mikra1: false, rashi: true },
    '5786:Metzora': {},
  });
});

test('exports list individual parshiyos with independent completion', () => {
  const text = progressText({ progress: {
    '5786:Tazria': { mikra1: true, mikra2: true, rashi: true },
    '5786:Metzora': { mikra1: true },
    '5787:Matot-Masei': { mikra2: true },
  } }, undefined, new Date('2026-10-11T12:00:00Z'));
  assert.match(text, /Parshiyos with progress: 4/);
  assert.match(text, /Completed: 1/);
  assert.match(text, /Tazria — Complete/);
  assert.match(text, /Metzora — In progress/);
  assert.match(text, /Matot — In progress/);
  assert.match(text, /Masei — In progress/);
  assert.doesNotMatch(text, /Matot-Masei/);
});
