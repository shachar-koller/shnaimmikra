import assert from 'node:assert/strict';
import { test } from 'node:test';
import { glassStyle, refractionMap } from '../src/glass.js';
import { lensFrame, springPath } from '../src/motion.js';
import { PREFERENCE_DEFAULTS } from '../src/preferences.js';

const WIDTH = 230, HEIGHT = 52, BEVEL = 20;
const map = refractionMap(WIDTH, HEIGHT, BEVEL);
const channels = (x, y) => [...map.slice((y * WIDTH + x) * 4, (y * WIDTH + x) * 4 + 4)];

test('the refraction map leaves the flat center of the capsule alone', () => {
  const [red, green, , alpha] = channels(115, 26);
  assert.ok(Math.abs(red - 128) <= 1 && Math.abs(green - 128) <= 1);
  assert.equal(alpha, 255);
});

test('the refraction map samples toward the center from every edge', () => {
  assert.ok(channels(115, 0)[1] > 200, 'top edge samples downward');
  assert.ok(channels(115, HEIGHT - 1)[1] < 60, 'bottom edge samples upward');
  assert.ok(channels(0, 26)[0] > 200, 'left cap samples rightward');
  assert.ok(channels(WIDTH - 1, 26)[0] < 60, 'right cap samples leftward');
});

test('the spring starts and settles exactly, with an overshoot the bar can contain', () => {
  const path = springPath(0, 3);
  assert.equal(path[0].x, 0);
  assert.deepEqual(path.at(-1), { x: 3, v: 0 });
  // The lens sits 3px inside the capsule and is 56px wide.
  assert.ok(Math.max(...path.map(({ x }) => x)) < 3 + 3 / 56);
  assert.ok(path.length < 60, 'settles within a second');
});

test('an interrupted spring keeps the velocity it already had', () => {
  assert.ok(springPath(1, 0, 8)[1].x > 1, 'still moves forward before turning back');
});

test('the lens only deforms while moving, and within limits', () => {
  assert.equal(lensFrame({ x: 2, v: 0 }).transform, 'translateX(200%) scale(1, 1)');
  const [, wide, tall] = lensFrame({ x: 1, v: -1000 }).transform.match(/scale\(([\d.]+), ([\d.]+)\)/);
  assert.ok(Number(wide) > 1 && Number(wide) <= 1.24);
  assert.ok(Number(tall) < 1 && Number(tall) >= .9);
});

test('the glass level runs from nearly opaque, through a default with almost no tint, to none at all', () => {
  for (const dark of [false, true]) {
    const opaque = glassStyle(0, dark), standard = glassStyle(PREFERENCE_DEFAULTS.glass, dark), overly = glassStyle(100, dark);
    assert.equal(opaque.shift, 0);
    assert.equal(opaque.properties['--glass-tint-amount'], '97%');
    assert.equal(opaque.properties['--glass-reflection-opacity'], 0);
    assert.equal(standard.properties['--glass-tint-amount'], '4%');
    assert.equal(standard.dispersion, 0);
    assert.equal(overly.properties['--glass-tint-amount'], '0%');
    assert.ok(overly.shift > standard.shift * 2 && overly.dispersion > 0);
  }
});

test('more glass never means more tint or blur, and never less refraction', () => {
  for (const dark of [false, true]) {
    for (let level = 1; level <= 100; level += 1) {
      const before = glassStyle(level - 1, dark), after = glassStyle(level, dark);
      assert.ok(parseFloat(after.properties['--glass-tint-amount']) <= parseFloat(before.properties['--glass-tint-amount']));
      assert.ok(parseFloat(after.properties['--glass-blur']) <= parseFloat(before.properties['--glass-blur']));
      assert.ok(after.shift >= before.shift);
    }
  }
});
