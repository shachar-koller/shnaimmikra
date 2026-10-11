import test from 'node:test';
import assert from 'node:assert/strict';
import { complete, steps, cycleYear, schedule } from '../src/model.js';

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

test('progress completion checks all readings', () => {
  assert.equal(complete({ mikra1: true, mikra2: true, onkelos: true }), true);
  assert.equal(complete({ mikra1: true, mikra2: true, rashi: true }), true);
  assert.equal(complete({ mikra1: true, mikra2: true }), false);
  assert.equal(steps({ mikra1: true, mikra2: true, rashi: true }), 3);
  assert.equal(steps({ mikra1: true }), 1);
});
