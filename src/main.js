import './style.css';
import { Locale } from '@hebcal/core';
import { complete, steps, cycleYear, schedule } from './model.js';

const KEY = 'shnaim-mikra-v1';
let data = { progress: {}, israel: false };
let storageOK = true;
try {
  const raw = JSON.parse(localStorage.getItem(KEY));
  if (raw && typeof raw.progress === 'object' && raw.progress !== null)
    data = { progress: raw.progress, israel: raw.israel === true };
} catch { storageOK = false; }

let year = cycleYear(new Date(), data.israel), view = 'week', filter = 'All', chosen = null;

const check = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><path d="m5 12 5 5 9-10"/></svg>';

// Sefer grouping. Keys are exact Hebcal English names (full id first,
// so hyphenated names like Lech-Lecha resolve correctly).
const SEFER_OF = {};
[
  ['Bereshit', 'Noach', 'Lech-Lecha', 'Vayera', 'Chayei Sara', 'Toldot', 'Vayetzei', 'Vayishlach', 'Vayeshev', 'Miketz', 'Vayigash', 'Vayechi'],
  ['Shemot', 'Vaera', 'Bo', 'Beshalach', 'Yitro', 'Mishpatim', 'Terumah', 'Tetzaveh', 'Ki Tisa', 'Vayakhel', 'Pekudei'],
  ['Vayikra', 'Tzav', 'Shmini', 'Tazria', 'Metzora', 'Tazria-Metzora', 'Achrei Mot', 'Kedoshim', 'Achrei Mot-Kedoshim', 'Emor', 'Behar', 'Bechukotai', 'Behar-Bechukotai'],
  ['Bamidbar', 'Nasso', "Beha'alotcha", "Sh'lach", 'Korach', 'Chukat', 'Balak', 'Pinchas', 'Matot', 'Masei', 'Matot-Masei'],
  ['Devarim', 'Vaetchanan', 'Eikev', "Re'eh", 'Shoftim', 'Ki Teitzei', 'Ki Tavo', 'Nitzavim', 'Vayeilech', "Ha'azinu", 'Vezot Haberakhah'],
].forEach((names, i) => names.forEach(n => { SEFER_OF[n] = i; }));
const SEFARIM = [
  { en: 'Bereishit', he: 'בראשית' },
  { en: 'Shemot', he: 'שמות' },
  { en: 'Vayikra', he: 'ויקרא' },
  { en: 'Bamidbar', he: 'במדבר' },
  { en: 'Devarim', he: 'דברים' },
];
const seferOf = id => SEFER_OF[id] ?? SEFER_OF[id.split('-')[0]] ?? 0;
const hebrewName = names => names.map(n => Locale.gettext(n, 'he')).join('־');

const all = () => schedule(year, data.israel);
const state = id => data.progress[`${year}:${id}`] || {};
function save() { try { localStorage.setItem(KEY, JSON.stringify(data)); storageOK = true; } catch { storageOK = false; } }
const dateLabel = d => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
const fullDate = d => d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
function current(rows) { const today = new Date(); today.setHours(0, 0, 0, 0); return rows.find(r => r.date >= today) || rows.at(-1); }
const statusText = p => complete(p) ? 'Complete' : steps(p) === 0 ? 'Not started' : `${steps(p)} of 3`;

function render() {
  const rows = all(), weekly = current(rows), item = rows.find(r => r.id === chosen) || weekly;
  const p = state(item.id), done = rows.filter(r => complete(state(r.id))).length;
  const isWeekly = item.id === weekly.id;
  const groups = SEFARIM.map((s, i) => ({ ...s, rows: rows.filter(r => seferOf(r.id) === i) }));

  document.querySelector('#app').innerHTML = `
  <header><a class="brand" href="#" aria-label="Shnaim Mikra home">Shnaim mikra</a><button class="settings" aria-label="Settings">Settings</button></header>
  <main>
    <section class="parsha-head" aria-labelledby="parsha-he">
      <p class="kicker">${isWeekly ? `This week's parsha · Shabbat ${dateLabel(item.date)}` : `Reading · ${fullDate(item.date)}`}</p>
      <h1 id="parsha-he" lang="he" dir="rtl">${hebrewName(item.names)}</h1>
      <p class="parsha-en">${item.names.join(' – ')} · <span lang="he" dir="auto">${item.hebrew}</span></p>
      <p class="helper">Read twice, plus Onkelos or Rashi.</p>
    </section>

    <section class="checklist" aria-label="Checklist for ${item.names.join(' and ')}">
      <ol>
        ${checkRow('mikra1', '1', 'Mikra 1', 'First reading', p)}
        ${checkRow('mikra2', '2', 'Mikra 2', 'Second reading', p)}
        <li class="targum-row">
          <span class="num" aria-hidden="true">3</span>
          <span class="check-text"><strong>Targum</strong><small>Choose one</small></span>
          <span class="either" role="radiogroup" aria-label="Translation, choose one">
            <button role="radio" aria-checked="${!!p.onkelos}" class="${p.onkelos ? 'on' : ''}" data-reading="onkelos"><span class="dot" aria-hidden="true"></span>Onkelos</button>
            <button role="radio" aria-checked="${!!p.rashi}" class="${p.rashi ? 'on' : ''}" data-reading="rashi"><span class="dot" aria-hidden="true"></span>Rashi</button>
          </span>
        </li>
      </ol>
      <div class="status-line"><span>${statusText(p)}</span><span aria-hidden="true">${steps(p)} / 3</span></div>
      <div class="progress-track" role="img" aria-label="${statusText(p)}"><div style="width:${steps(p) / 3 * 100}%"></div></div>
    </section>

    <section class="cycle" aria-label="Progress through the cycle">
      <div class="cycle-head"><h2>The cycle</h2><p>${done} of ${rows.length} completed</p></div>
      <div class="cycle-bar" role="img" aria-label="${done} of ${rows.length} parshiot completed"><div style="width:${Math.round(done / rows.length * 100)}%"></div></div>
      ${groups.filter(g => g.rows.length).map(g => `
        <div class="sefer">
          <h3><span lang="he" dir="rtl">${g.he}</span> ${g.en}</h3>
          <div class="cells">
            ${g.rows.map(r => {
              const s = state(r.id), st = complete(s) ? 'Completed' : steps(s) > 0 ? `${steps(s)} of 3` : 'Not started';
              const cls = complete(s) ? 'done' : steps(s) > 0 ? 'started' : '';
              const cur = r.id === weekly.id;
              return `<button class="cell ${cls}${cur ? ' current' : ''}" data-parsha="${r.id}" title="${hebrewName(r.names)}" aria-label="${r.names.join(' and ')}, ${st}${cur ? ', this week' : ''}"${cur ? ' aria-current="true"' : ''}><span class="tip" lang="he" dir="rtl" aria-hidden="true">${hebrewName(r.names)}</span></button>`;
            }).join('')}
          </div>
        </div>`).join('')}
    </section>

    <div class="toolbar">
      <nav aria-label="Tracker view"><button data-view="week" class="${view === 'week' ? 'active' : ''}" ${view === 'week' ? 'aria-current="true"' : ''}>This week</button><button data-view="year" class="${view === 'year' ? 'active' : ''}" ${view === 'year' ? 'aria-current="true"' : ''}>All parshiot</button></nav>
      <label class="year-select">Cycle <select id="year">${[cycleYear() - 1, cycleYear(), cycleYear() + 1].map(y => `<option ${y === year ? 'selected' : ''} value="${y}">${y}–${String(y + 1).slice(2)}</option>`).join('')}</select></label>
    </div>

    <section class="all-section ${view === 'year' ? 'expanded' : ''}" aria-label="Parsha list">
      <div class="list-heading">
        <h2>${view === 'year' ? 'All parshiot' : 'Around this week'}</h2>
        ${view === 'week'
          ? '<button class="text-button" id="show-all">View all parshiot</button>'
          : `<div class="filters" role="group" aria-label="Filter parshiot">${['All', 'In progress', 'Completed'].map(f => `<button data-filter="${f}" class="${f === filter ? 'selected' : ''}" ${f === filter ? 'aria-current="true"' : ''}>${f}</button>`).join('')}</div>`}
      </div>
      <div class="parsha-list">
        ${listRows(rows, weekly).map(r => {
          const s = state(r.id);
          const st = complete(s) ? 'Completed' : steps(s) > 0 ? `${steps(s)} of 3` : '';
          return `<button class="parsha-row ${item.id === r.id ? 'current' : ''}" data-parsha="${r.id}" ${item.id === r.id ? 'aria-current="true"' : ''}>
            <span class="row-name">${r.names.join(' – ')}<small>${dateLabel(r.date)}${r.id === weekly.id ? ' · This week' : ''}${st ? ` · ${st}` : ''}</small></span>
            <span class="row-he" lang="he" dir="rtl" aria-hidden="true">${hebrewName(r.names)}</span>
          </button>`;
        }).join('') || '<p class="empty">Nothing here. Your next reading is a good place to start.</p>'}
      </div>
    </section>

    <footer><span>${storageOK ? 'Saved on this device' : 'Progress could not be saved. Check browser storage.'}</span><button id="install">Add to home screen</button></footer>
  </main>
  <div id="dialog-root"></div>
  <div class="sr-only" aria-live="polite" id="announcement"></div>`;

  document.querySelector('.brand').onclick = e => { e.preventDefault(); view = 'week'; chosen = null; year = cycleYear(new Date(), data.israel); render(); };
  document.querySelectorAll('[data-view]').forEach(b => b.onclick = () => { view = b.dataset.view; render(); if (view === 'year') document.querySelector('.all-section').scrollIntoView({ block: 'start' }); });
  document.querySelectorAll('[data-reading]').forEach(b => b.onclick = () => {
    const key = `${year}:${item.id}`, k = b.dataset.reading, next = { ...p };
    if (k === 'onkelos' || k === 'rashi') {
      // Either/or: selecting one clears the other; tapping the active one clears it.
      const other = k === 'onkelos' ? 'rashi' : 'onkelos';
      next[k] = !p[k]; if (next[k]) next[other] = false;
    } else next[k] = !p[k];
    data.progress[key] = next; save(); render();
    const again = document.querySelector(`[data-reading="${k}"]`);
    if (again) again.focus({ preventScroll: true });
    document.querySelector('#announcement').textContent = complete(state(item.id)) ? 'Parsha complete' : `${k} ${state(item.id)[k] ? 'checked' : 'unchecked'}`;
  });
  document.querySelectorAll('[data-parsha]').forEach(b => b.onclick = () => { chosen = b.dataset.parsha; render(); document.querySelector('.checklist').scrollIntoView({ block: 'start' }); });
  document.querySelectorAll('[data-filter]').forEach(b => b.onclick = () => { filter = b.dataset.filter; render(); });
  document.querySelector('#year').onchange = e => { year = Number(e.target.value); chosen = null; render(); };
  const show = document.querySelector('#show-all');
  if (show) show.onclick = () => { view = 'year'; render(); };
  document.querySelector('.settings').onclick = settings;
  document.querySelector('#install').onclick = install;
}

function checkRow(key, num, label, sub, p) {
  return `<li><button class="check-row ${p[key] ? 'on' : ''}" data-reading="${key}" aria-pressed="${!!p[key]}" aria-label="${label}, ${sub}">
    <span class="num" aria-hidden="true">${num}</span>
    <span class="check-text"><strong>${label}</strong><small>${sub}</small></span>
    <span class="box" aria-hidden="true">${p[key] ? check : ''}</span>
  </button></li>`;
}

function listRows(rows, weekly) {
  if (view === 'week') { const i = rows.indexOf(weekly); return rows.slice(Math.max(0, i - 1), Math.max(3, i + 2)); }
  return rows.filter(r => filter === 'All' || (filter === 'Completed' ? complete(state(r.id)) : steps(state(r.id)) > 0 && !complete(state(r.id))));
}

function modal(html) {
  document.querySelector('#dialog-root').innerHTML = `<dialog><button class="close" aria-label="Close">×</button>${html}</dialog>`;
  const d = document.querySelector('dialog'); d.showModal();
  d.querySelector('.close').onclick = () => d.close();
  d.onclick = e => { if (e.target === d) { const r = d.getBoundingClientRect(); if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) d.close(); } };
}

function settings() {
  modal(`<h2>Settings</h2>
    <label class="setting-row">Reading calendar
      <select id="location"><option value="false" ${!data.israel ? 'selected' : ''}>Diaspora</option><option value="true" ${data.israel ? 'selected' : ''}>Israel</option></select>
    </label>
    <p class="dialog-note">The weekly parsha follows this calendar. Progress is saved in this browser, on this device.</p>
    <button class="primary" id="save-settings">Done</button>`);
  document.querySelector('#save-settings').onclick = () => { data.israel = document.querySelector('#location').value === 'true'; chosen = null; save(); render(); };
}

function install() {
  modal(`<h2>Add to home screen</h2><p>Keep the weekly reading a tap away.</p>
  <ol><li>Open this app in <strong>Safari</strong> on your iPhone.</li><li>Tap the <strong>Share</strong> button.</li><li>Choose <strong>Add to Home Screen</strong>, then tap <strong>Add</strong>.</li></ol>
  <p class="dialog-note">Once loaded, the app works offline. Progress stays on this device; clearing website data removes it.</p>`);
}

window.addEventListener('storage', e => { if (e.key === KEY) { try { const d = JSON.parse(e.newValue); if (d?.progress) { data = d; render(); } } catch { } } });
render();
if ('serviceWorker' in navigator && import.meta.env.PROD) navigator.serviceWorker.register('/sw.js').catch(() => {});
