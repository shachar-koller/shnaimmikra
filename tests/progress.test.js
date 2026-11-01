import test from 'node:test';
import assert from 'node:assert/strict';
import { progressText } from '../src/progress.js';
import { checkedReadings } from './fixtures.js';

test('exports list individual parshiyos with independent completion', () => {
  const text = progressText({ progress: {
    '5786:Tazria': checkedReadings('mikra1', 'mikra2', 'rashi'),
    '5786:Metzora': checkedReadings('mikra1'),
    '5787:Matot': checkedReadings('mikra2'),
    '5787:Masei': checkedReadings('mikra2'),
  } }, undefined, new Date('2026-10-11T12:00:00Z'));
  assert.match(text, /Parshiyos with progress: 4/);
  assert.match(text, /Completed: 1/);
  assert.match(text, /Tazria — Complete/);
  assert.match(text, /Metzora — In progress/);
  assert.match(text, /Matot — In progress/);
  assert.match(text, /Masei — In progress/);
  assert.doesNotMatch(text, /Matot-Masei/);
});
