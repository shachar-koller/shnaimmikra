import { splitDoubleProgress, peirushName } from './progress.js';

// Keep the original key as guest storage. Its owner cannot be inferred safely.
export const GUEST_KEY = 'shnaim-mikra-v1';
export const storageKey = userId => userId ? `shnaim-mikra-v2:account:${userId}` : GUEST_KEY;
export const READINGS = ['mikra1', 'mikra2', 'onkelos', 'rashi'];
export const themes = [
  { id: 'grayscale', label: 'Grayscale', color: '#f5f5f5' },
  { id: 'dark-grayscale', label: 'Dark Grayscale', color: '#171717' },
  { id: 'forest', label: 'Forest', color: '#faf9f6' },
  { id: 'forest-dark', label: 'Forest Dark', color: '#151817' },
];
export function validTheme(value) {
  const id = { light: 'grayscale', dark: 'dark-grayscale' }[value] || value;
  return themes.some(theme => theme.id === id) ? id : 'grayscale';
}
export const emptyData = () => ({ progress: {}, israel: false, commentary: 'onkelos', theme: 'grayscale' });
export function normalizeData(raw = {}) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Invalid saved data');
  const progress = {};
  for (const [key, value] of Object.entries(splitDoubleProgress(raw.progress || {}))) {
    if (!/^\d{4}:.+/.test(key) || !value || typeof value !== 'object') continue;
    const checked = Object.fromEntries(READINGS.filter(field => value[field] === true).map(field => [field, true]));
    if (Object.keys(checked).length) progress[key] = checked;
  }
  return {
    progress, israel: raw.israel === true, commentary: raw.commentary === 'rashi' ? 'rashi' : 'onkelos',
    theme: validTheme(raw.theme), ...(raw.peirushName ? { peirushName: peirushName(raw.peirushName) } : {}),
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
    const record = { data: normalizeData(raw || emptyData()), pending: userId ? (raw?.pending || emptyPending()) : emptyPending() };
    if (raw?.progress && Object.keys(raw.progress).some(key => key.includes(':') && !Object.hasOwn(splitDoubleProgress(raw.progress), key))) {
      write(userId, record);
    }
    return record;
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
    const next = { ...record.data.progress[key], ...patch };
    const checked = Object.fromEntries(READINGS.filter(field => next[field]).map(field => [field, true]));
    if (Object.keys(checked).length) record.data.progress[key] = checked;
    else delete record.data.progress[key];
    if (userId) {
      const pending = record.pending.progress[key] ||= {};
      for (const [field, value] of Object.entries(patch)) pending[field] = operation(value);
    }
  }
  function patchSettings(record, userId, patch) {
    for (const key of ['israel', 'commentary', 'theme', 'peirushName']) {
      if (!Object.hasOwn(patch, key) || patch[key] === record.data[key]) continue;
      if (patch[key] === undefined) delete record.data[key];
      else record.data[key] = patch[key];
      // Appearance and the custom label are device preferences, included in backups.
      if (userId && ['israel', 'commentary'].includes(key)) record.pending.profile[key] = operation(patch[key]);
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
        record.data.progress[key] = pendingValues(fields);
      }
    }),
    importData: (userId, imported, settings = true) => change(userId, record => {
      // Explicit, additive import only. Normal synchronization never unions caches.
      for (const [key, value] of Object.entries(imported.progress)) {
        const patch = Object.fromEntries(READINGS.filter(field => value[field] === true && (record.pending.reset || !record.data.progress[key]?.[field])).map(field => [field, true]));
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
        const next = { ...record.data.progress[key], ...pendingValues(fields) };
        if (READINGS.some(field => next[field])) record.data.progress[key] = next;
        else delete record.data.progress[key];
      }
      if (profile) {
        record.data.israel = profile.israel === true;
        record.data.commentary = profile.commentary === 'rashi' ? 'rashi' : 'onkelos';
      }
      Object.assign(record.data, pendingValues(record.pending.profile));
    }),
  };
}
