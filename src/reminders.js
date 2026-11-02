import { validPreferences } from './preferences.js';

export const REMINDER_DAYS = [
  ['SU', 'Sunday'], ['MO', 'Monday'], ['TU', 'Tuesday'], ['WE', 'Wednesday'],
  ['TH', 'Thursday'], ['FR', 'Friday'], ['SA', 'Saturday'],
];
const escapeText = text => text.replace(/\\/g, '\\\\').replace(/\r?\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;');
const pad = value => String(value).padStart(2, '0');
const localStamp = date => `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}T${pad(date.getHours())}${pad(date.getMinutes())}00`;
// RFC 5545 folds content lines at 75 octets without splitting a UTF-8 character.
function fold(line) {
  let result = '', bytes = 0;
  for (const character of line) {
    const length = new TextEncoder().encode(character).length;
    if (bytes + length > 75) { result += '\r\n '; bytes = 1; }
    result += character; bytes += length;
  }
  return result;
}
export function reminderCalendar({ reminderDays, reminderTime }, now = new Date(), appUrl = '') {
  if (!validPreferences({ reminderDays, reminderTime }) || !reminderDays.length) throw new Error('Choose at least one reminder day and a valid time.');
  const [hours, minutes] = reminderTime.split(':').map(Number);
  const start = new Date(now);
  start.setHours(hours, minutes, 0, 0);
  for (let offset = 0; offset < 8; offset++) {
    if (start > now && reminderDays.includes(start.getDay())) break;
    start.setDate(start.getDate() + 1);
    start.setHours(hours, minutes, 0, 0);
  }
  const lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Shnayim Mikra//Learning reminders//EN', 'CALSCALE:GREGORIAN',
    'BEGIN:VEVENT', 'UID:weekly-learning-reminder@shnayim-mikra',
    `DTSTAMP:${now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')}`,
    // Floating local time keeps the chosen hour across daylight-saving changes.
    `DTSTART:${localStamp(start)}`, 'DURATION:PT10M',
    `RRULE:FREQ=WEEKLY;BYDAY=${[...reminderDays].sort().map(day => REMINDER_DAYS[day][0]).join(',')}`,
    'SUMMARY:Shnayim Mikra',
    `DESCRIPTION:${escapeText(`Time for Shnayim Mikra.${appUrl ? ` Open your tracker: ${appUrl}` : ''}`)}`,
    'TRANSP:TRANSPARENT', 'BEGIN:VALARM', 'ACTION:DISPLAY', 'TRIGGER:PT0S',
    'DESCRIPTION:Time for Shnayim Mikra', 'END:VALARM', 'END:VEVENT', 'END:VCALENDAR',
  ];
  return lines.map(fold).join('\r\n') + '\r\n';
}
