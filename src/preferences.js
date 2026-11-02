import { READER_MODES } from './reader-model.js';

export const LIGHT_THEMES = ['grayscale', 'forest', 'parchment', 'tekhelet', 'jerusalem-stone', 'pomegranate'];
export const DARK_THEMES = ['dark-grayscale', 'forest-dark', 'midnight', 'kinneret', 'olive-press', 'havdalah'];
export const PREFERENCE_DEFAULTS = {
  followDevice: false, lightTheme: 'grayscale', darkTheme: 'dark-grayscale',
  textSize: 'standard', glass: 50, naming: 'ashkenazi', confetti: true, vibration: true,
  defaultReaderMode: 'last-used',
  reminderDays: [], reminderTime: '19:00',
};
export const PREFERENCE_KEYS = Object.keys(PREFERENCE_DEFAULTS);
const validators = {
  followDevice: value => typeof value === 'boolean',
  lightTheme: value => LIGHT_THEMES.includes(value),
  darkTheme: value => DARK_THEMES.includes(value),
  textSize: value => ['standard', 'larger'].includes(value),
  glass: value => Number.isInteger(value) && value >= 0 && value <= 100,
  naming: value => ['ashkenazi', 'sephardi', 'hebrew'].includes(value),
  defaultReaderMode: value => ['last-used', ...READER_MODES].includes(value),
  confetti: value => typeof value === 'boolean',
  vibration: value => typeof value === 'boolean',
  reminderDays: value => Array.isArray(value) && value.every(day => Number.isInteger(day) && day >= 0 && day <= 6) && new Set(value).size === value.length,
  reminderTime: value => typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value),
};
export const validPreferences = raw => PREFERENCE_KEYS.every(key => !Object.hasOwn(raw, key) || validators[key](raw[key]));
// Absent preferences stay absent, so existing saves and older backups keep their defaults.
export function normalizePreferences(raw) {
  return Object.fromEntries(PREFERENCE_KEYS.filter(key => Object.hasOwn(raw, key)).map(key => [key,
    validators[key](raw[key]) ? (Array.isArray(raw[key]) ? [...raw[key]].sort() : raw[key]) : PREFERENCE_DEFAULTS[key],
  ]));
}
export const preferences = data => ({ ...PREFERENCE_DEFAULTS, ...normalizePreferences(data) });
export function resolvedTheme(data, dark) {
  const prefs = preferences(data);
  return prefs.followDevice ? (dark ? prefs.darkTheme : prefs.lightTheme) : data.theme;
}
