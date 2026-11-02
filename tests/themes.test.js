import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { DARK_THEMES, LIGHT_THEMES } from '../src/preferences.js';
import { themes } from '../src/storage.js';

const css = readFileSync(new URL('../src/style.css', import.meta.url), 'utf8');
const variables = id => {
  const body = css.match(new RegExp(`:root\\[data-theme='${id}'\\] \\{([^}]*)\\}`))?.[1] ?? '';
  return Object.fromEntries([...body.matchAll(/--([\w-]+):\s*(#[0-9a-f]{3,6})\s*;/g)].map(match => [match[1], match[2]]));
};
const luminance = hex => {
  const full = hex.length === 4 ? [...hex.slice(1)].map(digit => digit + digit).join('') : hex.slice(1);
  const [r, g, b] = [0, 2, 4].map(start => parseInt(full.slice(start, start + 2), 16) / 255)
    .map(channel => channel <= .03928 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4);
  return .2126 * r + .7152 * g + .0722 * b;
};
const contrast = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + .05) / (lo + .05);
};

test('every theme is wired up in the CSS and the device lists', () => {
  assert.deepEqual([...LIGHT_THEMES, ...DARK_THEMES].sort(), themes.map(theme => theme.id).sort());
  for (const { id, color } of themes) {
    assert.ok(css.includes(`.swatch-${id} {`), `${id} swatch`);
    assert.ok(css.includes(`[data-theme='${id}'] `), `${id} settings or root styles`);
    if (id !== 'grayscale') assert.equal(variables(id).page, color, `${id} browser color`);
  }
  // Dark themes need the light glass on the tab bar and the light danger colors in dialogs.
  for (const id of DARK_THEMES) {
    assert.ok(css.match(/:root:is\(([^)]*)\) \.tabbar/)[1].includes(`'${id}'`), `${id} tab bar`);
    assert.ok(new RegExp(`\\[data-theme='${id}'\\] :is\\(\\.dialog, \\.settings-view\\)`).test(css), `${id} dialog`);
  }
});

test('text in every theme is readable on its surfaces', () => {
  const pairs = [['ink', 'page'], ['ink', 'card'], ['muted', 'page'], ['muted', 'card'], ['soft-ink', 'card'],
    ['green', 'card'], ['green', 'page'], ['on-accent', 'green'], ['button-ink', 'button-bg'], ['danger', 'danger-bg'], ['muted', 'reading-bg']];
  for (const { id } of themes) {
    const colors = variables(id);
    for (const [text, surface] of pairs) {
      if (!colors[text] || !colors[surface]) continue;
      assert.ok(contrast(colors[text], colors[surface]) >= 4.5, `${id}: ${text} on ${surface} is ${contrast(colors[text], colors[surface]).toFixed(2)}`);
    }
  }
});
