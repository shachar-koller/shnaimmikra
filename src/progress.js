import { complete, schedule } from './model.js';
import { ALIYAH_NAMES, chosenCommentary, hasReadingProgress, readingCount, readingChecks } from './readings.js';

export const peirushName = value => typeof value === 'string'
  ? value.replace(/\s+/g, ' ').trim().slice(0, 80) || 'Rashi'
  : 'Rashi';

export function progressText(data, name = id => id, now = new Date()) {
  const entries = Object.entries(data.progress).filter(([, p]) =>
    p && hasReadingProgress(p));
  const years = [...new Set(entries.map(([key]) => Number(key.split(':')[0])))].sort((a, b) => a - b);
  const lines = [
    'Shnayim Mikra — Progress',
    `Exported: ${now.toISOString()}`,
    `Parsha calendar: ${data.israel ? 'Israel' : 'Diaspora'}`,
    `Parshiyos with progress: ${entries.length}`,
    `Completed: ${entries.filter(([, p]) => complete(p)).length}`,
  ];
  if (!entries.length) lines.push('', 'No progress recorded yet.');
  for (const year of years) {
    const order = new Map(schedule(year, data.israel).map((row, i) => [row.id, i]));
    const cycle = entries.filter(([key]) => key.startsWith(`${year}:`))
      .map(([key, p]) => [key.slice(key.indexOf(':') + 1), p])
      .sort(([a], [b]) => (order.get(a) ?? Infinity) - (order.get(b) ?? Infinity) || a.localeCompare(b));
    lines.push('', `Cycle ${year}–${year + 1}`, '--------------------');
    for (const [id, p] of cycle) {
      lines.push('', `${name(id)} — ${complete(p) ? 'Complete' : 'In progress'}`);
      const commentary = chosenCommentary(p, data.commentary);
      const commentaryLabel = commentary === 'rashi' ? peirushName(data.peirushName) : 'Targum';
      for (const [key, label] of [['mikra1', 'Mikra I'], ['mikra2', 'Mikra II'], [commentary, commentaryLabel]]) {
        const count = readingCount(p, key);
        lines.push(`  [${count === 7 ? 'x' : ' '}] ${label} — ${count} of 7 aliyos`);
        if (count > 0 && count < 7) readingChecks(p, key).forEach((checked, index) => {
          lines.push(`    [${checked ? 'x' : ' '}] ${ALIYAH_NAMES[index]}`);
        });
      }
    }
  }
  return lines.join('\n') + '\n';
}
