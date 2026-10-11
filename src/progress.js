import { complete, schedule, DOUBLE_PARSHIYOS } from './model.js';

export function splitDoubleProgress(progress = {}) {
  const migrated = { ...progress };
  const pairs = new Map(DOUBLE_PARSHIYOS.map(names => [names.join('-'), names]));
  for (const [key, p] of Object.entries(progress)) {
    const sep = key.indexOf(':');
    const names = pairs.get(key.slice(sep + 1));
    if (sep < 0 || !names) continue;
    for (const name of names) {
      const singleKey = `${key.slice(0, sep)}:${name}`;
      // Once tracked individually, a parsha's own record takes precedence.
      if (!Object.hasOwn(migrated, singleKey)) migrated[singleKey] = { ...p };
    }
    delete migrated[key];
  }
  return migrated;
}

export const peirushName = value => typeof value === 'string'
  ? value.replace(/\s+/g, ' ').trim().slice(0, 80) || 'Rashi'
  : 'Rashi';

export function progressText(data, name = id => id, now = new Date()) {
  const entries = Object.entries(splitDoubleProgress(data.progress)).filter(([, p]) =>
    p && (p.mikra1 || p.mikra2 || p.onkelos || p.rashi));
  const years = [...new Set(entries.map(([key]) => Number(key.split(':')[0])))].sort((a, b) => a - b);
  const lines = [
    'Shnayim Mikra — Reading Progress',
    `Exported: ${now.toISOString()}`,
    `Reading calendar: ${data.israel ? 'Israel' : 'Diaspora'}`,
    `Parshiyos with progress: ${entries.length}`,
    `Completed: ${entries.filter(([, p]) => complete(p)).length}`,
  ];
  if (!entries.length) lines.push('', 'No reading progress recorded yet.');
  for (const year of years) {
    const order = new Map(schedule(year, data.israel).map((row, i) => [row.id, i]));
    const cycle = entries.filter(([key]) => key.startsWith(`${year}:`))
      .map(([key, p]) => [key.slice(key.indexOf(':') + 1), p])
      .sort(([a], [b]) => (order.get(a) ?? Infinity) - (order.get(b) ?? Infinity) || a.localeCompare(b));
    lines.push('', `Cycle ${year}–${year + 1}`, '--------------------');
    for (const [id, p] of cycle) {
      lines.push('', `${name(id)} — ${complete(p) ? 'Complete' : 'In progress'}`);
      for (const [key, label] of [['mikra1', 'Mikra I'], ['mikra2', 'Mikra II'], ['rashi', peirushName(data.peirushName)], ['onkelos', 'Targum (Onkelos)']]) {
        lines.push(`  [${p[key] ? 'x' : ' '}] ${label}`);
      }
    }
  }
  return lines.join('\n') + '\n';
}
