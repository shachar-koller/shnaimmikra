import { schedule, complete, DOUBLE_PARSHIYOS } from './model.js';
import { normalizeData, READINGS, themes } from './storage.js';

export const MAX_BACKUP_BYTES = 2 * 1024 * 1024;
const FORMAT = 'shnayim-mikra-backup';
const parshiyos = new Set([...schedule(5787).map(row => row.id), ...DOUBLE_PARSHIYOS.map(pair => pair.join('-'))]);
const object = value => value && typeof value === 'object' && !Array.isArray(value);
export function createBackup(data, now = new Date()) {
  return JSON.stringify({ format: FORMAT, version: 1, exportedAt: now.toISOString(), data: normalizeData(data) }, null, 2) + '\n';
}
export function parseBackup(text) {
  if (new TextEncoder().encode(text).length > MAX_BACKUP_BYTES) throw new Error('Backup exceeds the 2 MB limit.');
  let backup;
  try { backup = JSON.parse(text); } catch { throw new Error('Choose a valid JSON backup.'); }
  if (backup?.format !== FORMAT || backup.version !== 1) throw new Error('Unsupported backup format or version.');
  const data = backup.data;
  if (!object(data) || !object(data.progress) || typeof data.israel !== 'boolean'
    || !['rashi', 'onkelos'].includes(data.commentary) || !themes.some(theme => theme.id === data.theme)
    || (data.peirushName !== undefined && (typeof data.peirushName !== 'string' || data.peirushName.length > 80))) {
    throw new Error('The backup contains invalid settings or progress.');
  }
  for (const [key, value] of Object.entries(data.progress)) {
    const match = /^(\d{4}):(.+)$/.exec(key);
    if (!match || Number(match[1]) < 5000 || Number(match[1]) > 9998 || !parshiyos.has(match[2]) || !object(value)
      || Object.entries(value).some(([field, checked]) => !READINGS.includes(field) || typeof checked !== 'boolean')) {
      throw new Error('The backup contains an invalid reading record.');
    }
  }
  return normalizeData(data);
}
export function backupSummary(data) {
  const entries = Object.entries(data.progress);
  return {
    parshiyos: entries.length,
    completed: entries.filter(([, value]) => complete(value)).length,
    cycles: [...new Set(entries.map(([key]) => key.split(':')[0]))].sort(),
  };
}
