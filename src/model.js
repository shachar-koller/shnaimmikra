import { HDate, Sedra, months } from '@hebcal/core';
export const complete = p => !!(p?.mikra1 && p?.mikra2 && (p?.onkelos || p?.rashi));
export const steps = p => Number(!!p?.mikra1) + Number(!!p?.mikra2) + Number(!!(p?.onkelos || p?.rashi));
export function cycleYear(date = new Date(), israel = false) {
 const h = new HDate(date); return h.getMonth() === months.TISHREI && h.getDate() < (israel ? 22 : 23) ? h.getFullYear()-1 : h.getFullYear();
}
export function schedule(year, israel = false) {
 const start = new HDate(israel ? 23 : 24, months.TISHREI, year).abs();
 const end = new HDate(israel ? 22 : 23, months.TISHREI, year+1).abs();
 const rows = []; const sedra = new Sedra(year, israel); const next = new Sedra(year+1, israel);
 for (let day=start; day<end; day+=7) {
  const h = new HDate(day); const r = (h.getFullYear() === year ? sedra : next).lookup(h);
  if (!r.chag && r.hdate.abs()<end && !rows.some(x=>x.id===r.parsha.join('-'))) rows.push({id:r.parsha.join('-'),names:r.parsha,date:r.hdate.greg(),hebrew:r.hdate.renderGematriya(),num:r.num});
 }
 rows.push({id:'Vezot Haberakhah',names:['Vezot Haberakhah'],date:new HDate(end).greg(),hebrew:new HDate(end).renderGematriya(),num:54});
 return rows;
}
