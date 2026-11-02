import { PREFERENCE_DEFAULTS, PREFERENCE_KEYS, normalizePreferences } from './preferences.js';
import { peirushName } from './progress.js';
import { READINGS, readingChecks, aliyahField, normalizeProgress, readingPatch, applyReadingPatch } from './readings.js';
export { READINGS, ALIYAH_FIELDS } from './readings.js';

// Keep the original key as guest storage. Its owner cannot be inferred safely.
export const GUEST_KEY = 'shnaim-mikra-v1';
export const storageKey = userId => userId ? `shnaim-mikra-v2:account:${userId}` : GUEST_KEY;
export const themes = [
  { id: 'grayscale', label: 'Grayscale', color: '#f5f5f5' },
  { id: 'dark-grayscale', label: 'Dark Grayscale', color: '#171717' },
  { id: 'forest', label: 'Forest', color: '#faf9f6' },
  { id: 'forest-dark', label: 'Forest Dark', color: '#151817' },
  { id: 'parchment', label: 'Parchment', color: '#f5efe1' },
  { id: 'midnight', label: 'Midnight', color: '#0e1320' },
];
export function validTheme(value) {
  return themes.some(theme => theme.id === value) ? value : 'grayscale';
}
export const emptyData = () => ({ progress: {}, israel: false, commentary: 'onkelos', theme: 'grayscale' });
export const SETTING_KEYS = ['israel', 'commentary', 'theme', 'peirushName', ...PREFERENCE_KEYS];
const SETTING_DEFAULTS = { ...emptyData(), peirushName: 'Rashi', ...PREFERENCE_DEFAULTS };
const sameValue = (a, b) => JSON.stringify(a) === JSON.stringify(b);
export function normalizeData(raw = {}) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Invalid saved data');
  const progress = {};
  for (const [key, value] of Object.entries(raw.progress || {})) {
    if (!/^\d{4}:.+/.test(key) || !value || typeof value !== 'object') continue;
    const checked = normalizeProgress(value);
    if (Object.keys(checked).length) progress[key] = checked;
  }
  const peirush = peirushName(raw.peirushName);
  return {
    progress, israel: raw.israel === true, commentary: raw.commentary === 'rashi' ? 'rashi' : 'onkelos',
    theme: validTheme(raw.theme), ...normalizePreferences(raw), ...(peirush === SETTING_DEFAULTS.peirushName ? {} : { peirushName: peirush }),
  };
}
const emptyPending = () => ({ progress: {}, profile: {} });
const operationId = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, '0')).join('');
const operation = value => ({ id: operationId(), value });
export const pendingValues = fields => Object.fromEntries(Object.entries(fields).map(([key, op]) => [key, op.value]));
export const hasPending = record => Boolean(record.pending.reset) || Object.keys(record.pending.progress).length > 0 || Object.keys(record.pending.profile).length > 0;

export function createRepository(storage) {
  function read(userId) {
    const raw = JSON.parse(storage.getItem(storageKey(userId)) || 'null');
    if (raw?.storageVersion && raw.storageVersion !== 2) throw new Error('Unsupported storage version');
    return { data: normalizeData(raw || emptyData()), pending: userId ? (raw?.pending || emptyPending()) : emptyPending() };
  }
  function write(userId, record) {
    const serialized = JSON.stringify(userId
      ? { ...record.data, storageVersion: 2, pending: record.pending }
      : record.data);
    // Identical writes would make open tabs repeatedly trigger each other's sync.
    if (storage.getItem(storageKey(userId)) !== serialized) storage.setItem(storageKey(userId), serialized);
    return record;
  }
  function change(userId, update) {
    const record = read(userId);
    update(record);
    return write(userId, record);
  }
  function patchReading(record, userId, key, patch) {
    const expanded = readingPatch(patch);
    if (!Object.keys(expanded).length) return;
    const checked = applyReadingPatch(record.data.progress[key], expanded);
    if (Object.keys(checked).length) record.data.progress[key] = checked;
    else delete record.data.progress[key];
    if (userId) {
      const pending = record.pending.progress[key] ||= {};
      for (const [field, value] of Object.entries(expanded)) pending[field] = operation(value);
    }
  }
  function patchSettings(record, userId, patch) {
    for (const key of SETTING_KEYS) {
      if (!Object.hasOwn(patch, key) || sameValue(patch[key], record.data[key])) continue;
      if (patch[key] === undefined) delete record.data[key];
      else record.data[key] = patch[key];
      // Clearing the custom label saves the default, so other devices see it as a change.
      if (userId) record.pending.profile[key] = operation(key === 'peirushName' ? peirushName(patch[key]) : patch[key]);
    }
  }
  return {
    read,
    reading: (userId, key, patch) => change(userId, record => patchReading(record, userId, key, patch)),
    settings: (userId, patch) => change(userId, record => patchSettings(record, userId, patch)),
    clear: userId => change(userId, record => {
      record.data.progress = {};
      record.pending.progress = {};
    }),
    requestReset: userId => change(userId, record => {
      record.pending.reset = operationId();
      // The explicit reset supersedes all earlier reading edits.
      record.pending.progress = {};
    }),
    acknowledgeReset: (userId, resetId) => change(userId, record => {
      if (record.pending.reset !== resetId) return;
      delete record.pending.reset;
      record.data.progress = {};
      // Keep edits made after the reset was requested, including in another tab.
      for (const [key, fields] of Object.entries(record.pending.progress)) {
        const checked = applyReadingPatch({}, pendingValues(fields));
        if (Object.keys(checked).length) record.data.progress[key] = checked;
      }
    }),
    importData: (userId, imported, settings = true) => change(userId, record => {
      // Explicit, additive import only. Normal synchronization never unions caches.
      for (const [key, value] of Object.entries(imported.progress)) {
        const patch = {};
        for (const reading of READINGS) {
          const current = readingChecks(record.pending.reset ? {} : record.data.progress[key], reading);
          readingChecks(value, reading).forEach((checked, index) => {
            if (checked && !current[index]) patch[aliyahField(reading, index)] = true;
          });
        }
        if (Object.keys(patch).length) patchReading(record, userId, key, patch);
      }
      if (settings) patchSettings(record, userId, { ...imported, peirushName: imported.peirushName });
    }),
    acknowledge: (userId, sent) => change(userId, record => {
      const acknowledgeFields = (current, previous) => {
        for (const [field, op] of Object.entries(previous)) if (current[field]?.id === op.id) delete current[field];
      };
      acknowledgeFields(record.pending.profile, sent.profile || {});
      for (const [key, fields] of Object.entries(sent.progress || {})) {
        const current = record.pending.progress[key];
        if (!current) continue;
        acknowledgeFields(current, fields);
        if (!Object.keys(current).length) delete record.pending.progress[key];
      }
    }),
    acceptRemote: (userId, { progress, profile }) => change(userId, record => {
      // Server state is authoritative except for explicit, unacknowledged edits.
      record.data.progress = normalizeData({ progress }).progress;
      for (const [key, fields] of Object.entries(record.pending.progress)) {
        const next = applyReadingPatch(record.data.progress[key], pendingValues(fields));
        if (Object.keys(next).length) record.data.progress[key] = next;
        else delete record.data.progress[key];
      }
      if (profile) for (const key of SETTING_KEYS) {
        if (Object.hasOwn(record.pending.profile, key)) continue;
        if (profile[key] !== null && profile[key] !== undefined) record.data[key] = profile[key];
        // The account has never saved this setting, so a choice already made here becomes its value.
        else if (record.data[key] !== undefined && !sameValue(record.data[key], SETTING_DEFAULTS[key])) record.pending.profile[key] = operation(record.data[key]);
      }
      Object.assign(record.data, pendingValues(record.pending.profile));
      record.data = normalizeData(record.data);
    }),
  };
}
