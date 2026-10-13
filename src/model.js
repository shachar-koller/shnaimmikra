import { HDate, Sedra, months } from '@hebcal/core';
export const complete = p => !!(p?.mikra1 && p?.mikra2 && (p?.onkelos || p?.rashi));
export const steps = p => Number(!!p?.mikra1) + Number(!!p?.mikra2) + Number(!!(p?.onkelos || p?.rashi));
// Explicit pairs keep single names such as Lech-Lecha intact.
export const DOUBLE_PARSHIYOS = [
 ['Vayakhel', 'Pekudei'],
 ['Tazria', 'Metzora'],
 ['Achrei Mot', 'Kedoshim'],
 ['Behar', 'Bechukotai'],
 ['Chukat', 'Balak'],
 ['Matot', 'Masei'],
 ['Nitzavim', 'Vayeilech'],
];
export function cycleYear(date = new Date(), israel = false) {
 // Simchas Torah still belongs to the cycle ending that day.
 const h = new HDate(date); return h.getMonth() === months.TISHREI && h.getDate() <= (israel ? 22 : 23) ? h.getFullYear()-1 : h.getFullYear();
}
export function schedule(year, israel = false) {
 const start = new HDate(israel ? 23 : 24, months.TISHREI, year).abs();
 const end = new HDate(israel ? 22 : 23, months.TISHREI, year+1).abs();
 const rows = []; const sedra = new Sedra(year, israel); const next = new Sedra(year+1, israel);
 for (let day=start; day<end; day+=7) {
  const h = new HDate(day); const r = (h.getFullYear() === year ? sedra : next).lookup(h);
  if (!r.chag && r.hdate.abs()<end) {
   r.parsha.forEach((name, i) => {
    if (!rows.some(x => x.id === name)) rows.push({id:name,names:[name],date:r.hdate.greg(),hebrew:r.hdate.renderGematriya(),num:Array.isArray(r.num) ? r.num[i] : r.num});
   });
  }
 }
 rows.push({id:'Vezot Haberakhah',names:['Vezot Haberakhah'],date:new HDate(end).greg(),hebrew:new HDate(end).renderGematriya(),num:54});
 return rows;
}
export function localShabbosDate(gregDate) {
 // Hebcal greg() returns local midnight, not a UTC date.
 return new Date(gregDate.getFullYear(), gregDate.getMonth(), gregDate.getDate());
}
export function currentParsha(rows, now = new Date()) {
 const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
 return rows.find(r => localShabbosDate(r.date) >= today) || rows.at(-1);
}
export function shabbosCountdown(targetDate, now = new Date()) {
 const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
 const target = new Date(targetDate.getFullYear(), targetDate.getMonth(), targetDate.getDate());
 const diffDays = Math.round((target - today) / (1000 * 60 * 60 * 24));
 if (diffDays <= 0) return 'Today';
 if (diffDays === 1) return '1 day away';
 return `${diffDays} days away`;
}
export function formatGregorianDate(date) {
 return new Intl.DateTimeFormat('en-US', { month: 'long', day: 'numeric' }).format(date);
}
