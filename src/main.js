import './style.css';
import { HDate, Locale } from '@hebcal/core';
import { complete, steps, cycleYear, schedule } from './model.js';

const KEY = 'shnaim-mikra-v1';
let data = { progress: {}, israel: false, commentary: 'onkelos' };
let storageOK = true;
try {
  const raw = JSON.parse(localStorage.getItem(KEY));
  if (raw && typeof raw.progress === 'object' && raw.progress !== null) {
    data = {
      progress: raw.progress,
      israel: raw.israel === true,
      commentary: raw.commentary === 'rashi' ? 'rashi' : 'onkelos',
    };
  }
} catch { storageOK = false; }

document.documentElement.dataset.theme = 'light';

let year = cycleYear(new Date(), data.israel);
let chosen = null;   // selected parsha id, or null = current week
let showAll = false;

const check = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" aria-hidden="true"><path d="m5 12 5 5 9-10"/></svg>';
const bookIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" aria-hidden="true"><path d="M12 5.5C10 4.5 7.5 4 4.5 4v15c3 0 5.5.5 7.5 1.5 2-1 4.5-1.5 7.5-1.5V4c-3 0-5.5.5-7.5 1.5z"/><path d="M12 5.5v15"/></svg>';
const slidersIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" aria-hidden="true"><path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2.2"/><circle cx="10" cy="17" r="2.2"/></svg>';
const arrowIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true"><path d="M7 17 17 7M9 7h8v8"/></svg>';

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
  { en: 'Bereishis', he: 'בראשית' },
  { en: 'Shemos', he: 'שמות' },
  { en: 'Vayikra', he: 'ויקרא' },
  { en: 'Bamidbar', he: 'במדבר' },
  { en: 'Devarim', he: 'דברים' },
];
const seferOf = id => SEFER_OF[id] ?? SEFER_OF[id.split('-')[0]] ?? 0;
const NAME_MAP = { Bereshit: 'Bereishis', Shemot: 'Shemos' };
const fixName = n => (NAME_MAP[n] || n).replace(/-/g, ' ');
const displayNames = names => names.map(fixName);
const titleName = names => displayNames(names).join(' – ');
const heroName = names => `Parshas ${names.length > 1 ? displayNames(names).join('–') : fixName(names[0])}`;
const hebrewName = names => names.map(n => Locale.gettext(n, 'he')).join('־');

const all = () => schedule(year, data.israel);
const state = id => data.progress[`${year}:${id}`] || {};
function save() { try { localStorage.setItem(KEY, JSON.stringify(data)); storageOK = true; } catch { storageOK = false; } }
function current(rows) { const today = new Date(); today.setHours(0, 0, 0, 0); return rows.find(r => r.date >= today) || rows.at(-1); }
const hebrewYearOf = date => { try { return new HDate(date).getFullYear(); } catch { return null; } };

function setProgress(id, next) {
  const k = `${year}:${id}`;
  if (Object.values(next).some(Boolean)) data.progress[k] = next;
  else delete data.progress[k];
  save();
}

function announce(msg) {
  const el = document.querySelector('#announcement');
  if (el) el.textContent = msg;
}

// "OCT 11–17" for the Sun–Sat week ending on the given Shabbat date.
function weekRange(shabbat) {
  const end = new Date(shabbat);
  const start = new Date(shabbat);
  start.setDate(start.getDate() - 6);
  const mon = d => d.toLocaleDateString('en-US', { month: 'short' }).toUpperCase();
  if (start.getMonth() === end.getMonth()) return `${mon(start)} ${start.getDate()}–${end.getDate()}`;
  if (start.getFullYear() === end.getFullYear()) return `${mon(start)} ${start.getDate()} – ${mon(end)} ${end.getDate()}`;
  return `${mon(start)} ${start.getDate()} ${start.getFullYear()} – ${mon(end)} ${end.getDate()} ${end.getFullYear()}`;
}

function readingRow(key, num, label, on, ariaLabel) {
  return `<li>
    <button class="readrow" data-reading="${key}" aria-pressed="${on ? 'true' : 'false'}" aria-label="${ariaLabel}">
      <span class="rnum" aria-hidden="true">${num}</span>
      <span class="rlabel">${label}</span>
      <span class="rdot${on ? ' on' : ''}" aria-hidden="true">${on ? check : ''}</span>
    </button>
  </li>`;
}

function render() {
  const rows = all();
  const weekly = current(rows);
  const item = rows.find(r => r.id === chosen) || weekly;
  const idx = rows.indexOf(item);
  const p = state(item.id);
  const n = steps(p);
  const done = rows.filter(r => complete(state(r.id))).length;
  const isWeekly = item.id === weekly.id;
  const sIdx = seferOf(item.id);
  const seferRows = rows.filter(r => seferOf(r.id) === sIdx);
  const seferPos = seferRows.indexOf(item) + 1;
  const seferDone = seferRows.filter(r => complete(state(r.id))).length;
  const hebYear = hebrewYearOf(item.date);
  const next = rows[idx + 1] || null;
  const groups = SEFARIM.map((s, i) => ({ ...s, rows: rows.filter(r => seferOf(r.id) === i) })).filter(g => g.rows.length);
  const pref = data.commentary === 'rashi' ? 'rashi' : 'onkelos';
  const targumOn = !!(p.onkelos || p.rashi);
  const activeFlavor = p.onkelos ? 'Onkelos' : p.rashi ? 'Rashi' : null;

  document.querySelector('#app').innerHTML = `
  <a class="skip" href="#reading">Skip to reading</a>
  <div class="page">
    <header class="topbar">
      <span class="brand"><span class="brandicon" aria-hidden="true">${bookIcon}</span>Shnayim Mikra</span>
      <span class="topright">
        ${hebYear ? `<span class="hebyear">${hebYear}</span>` : ''}
        <button class="iconbtn" id="settings" aria-label="Settings">${slidersIcon}</button>
      </span>
    </header>

    <main>
      <p class="eyebrow">${isWeekly ? 'THIS WEEK' : 'WEEK OF'} · ${weekRange(item.date)}</p>
      <div class="titlerow">
        <h1>${heroName(item.names)}</h1>
        <span class="he" lang="he" dir="rtl">${hebrewName(item.names)}</span>
      </div>
      <p class="subtitle">${SEFARIM[sIdx].en} · Week ${seferPos}</p>
      ${isWeekly ? '' : `<p class="backrow"><button class="backlink" id="back-week">← Back to this week: ${titleName(weekly.names)}</button></p>`}

      <div class="cards">
        <section class="card" id="reading" aria-label="Your reading for ${titleName(item.names)}">
          <div class="cardhead"><h2>Your reading</h2><span class="count">${n} of 3</span></div>
          <div class="bar" role="img" aria-label="${n} of 3 readings done"><div style="width:${(n / 3) * 100}%"></div></div>
          <ol class="reads">
            ${readingRow('mikra1', '1', 'Mikra I', !!p.mikra1, `First reading of the parsha${p.mikra1 ? ', done' : ''}`)}
            ${readingRow('mikra2', '2', 'Mikra II', !!p.mikra2, `Second reading of the parsha${p.mikra2 ? ', done' : ''}`)}
            ${readingRow('targum', '3', 'Targum / Rashi', targumOn, `Commentary reading${activeFlavor ? `, ${activeFlavor} done` : `, not done`}`)}
          </ol>
          <hr class="footrule" />
          <p class="footnote">Choose
            <button class="preflink${pref === 'onkelos' ? ' active' : ''}" data-pref="onkelos" aria-pressed="${pref === 'onkelos'}">Onkelos</button>
            or
            <button class="preflink${pref === 'rashi' ? ' active' : ''}" data-pref="rashi" aria-pressed="${pref === 'rashi'}">Rashi</button>
            for the final reading</p>
          ${n > 0 ? `<p class="resetrow"><button class="resetlink" id="reset-week">Reset this week</button></p>` : ''}
        </section>

        <section class="card" aria-label="Yearly progress">
          <h2 class="kicker">YEARLY PROGRESS</h2>
          <p class="bignum">${done} <span>/ ${rows.length}</span></p>
          <p class="bigsub">Parshiyos completed</p>
          <div class="bar" role="img" aria-label="${done} of ${rows.length} parshiyos completed"><div style="width:${rows.length ? Math.round((done / rows.length) * 100) : 0}%"></div></div>
          <div class="yearspace" aria-hidden="true"></div>
          <p class="nextlabel">Next up</p>
          ${next
            ? `<p class="nextrow"><button class="nextlink" data-parsha="${next.id}">${titleName(next.names)}</button><span class="nextarrow" aria-hidden="true">${arrowIcon}</span></p>`
            : '<p class="nextrow"><span class="nextlink as-text">Cycle complete</span></p>'}
        </section>
      </div>

      <section class="card cycle" aria-label="The yearly cycle">
        <div class="cyclehead">
          <h2>The yearly cycle</h2>
          <button class="browselink" id="browse">${showAll ? 'Show less ↑' : 'Browse all parshiyos →'}</button>
        </div>
        <div class="cyclesub">
          <span class="cycname">${SEFARIM[sIdx].en} · <span lang="he" dir="rtl">${SEFARIM[sIdx].he}</span></span>
          <span class="cyccount">${seferDone}/${seferRows.length}</span>
        </div>
        <div class="dots" role="list">
          ${seferRows.map(r => {
            const s = state(r.id);
            const cls = [complete(s) ? 'done' : '', r.id === weekly.id ? 'current' : '', r.id === item.id ? 'selected' : '', (!complete(s) && steps(s) > 0) ? 'started' : ''].filter(Boolean).join(' ');
            const st = complete(s) ? 'Completed' : steps(s) > 0 ? `${steps(s)} of 3 done` : 'Not started';
            return `<button role="listitem" class="dot ${cls}" data-parsha="${r.id}" title="${titleName(r.names)}" aria-label="${titleName(r.names)}, ${st}${r.id === weekly.id ? ', this week' : ''}${r.id === item.id ? ', selected' : ''}">${complete(s) ? `<span class="dotcheck" aria-hidden="true">${check}</span>` : ''}</button>`;
          }).join('')}
        </div>
        <p class="hint">Current parsha outlined · Hover to see names</p>
        ${showAll ? `
        <hr class="footrule" />
        <div class="alllist">
          ${groups.map(g => {
            const gd = g.rows.filter(r => complete(state(r.id))).length;
            return `<div class="allgroup">
              <p class="allname">${g.en} <span lang="he" dir="rtl">${g.he}</span> <span class="allcount">${gd}/${g.rows.length}</span></p>
              <div class="alltiles">
                ${g.rows.map(r => {
                  const s = state(r.id);
                  const cls = complete(s) ? 'done' : r.id === weekly.id ? 'current' : '';
                  return `<button class="alltile ${cls}${r.id === item.id ? ' selected' : ''}" data-parsha="${r.id}" ${r.id === weekly.id ? 'aria-current="true"' : ''}>${titleName(r.names)}</button>`;
                }).join('')}
              </div>
            </div>`;
          }).join('')}
        </div>` : ''}
      </section>

      <footer><span class="${storageOK ? '' : 'warn'}">${storageOK ? '' : 'Progress could not be saved. Check browser storage.'}</span></footer>
    </main>
  </div>
  <div id="dialog-root"></div>
  <div class="sr-only" aria-live="polite" id="announcement"></div>`;

  wire(rows, weekly, item, p);
}

function wire(rows, weekly, item, p) {
  document.querySelectorAll('[data-parsha]').forEach(b => b.onclick = () => {
    chosen = b.dataset.parsha;
    render();
    document.querySelector('#reading').scrollIntoView({ block: 'start' });
  });
  document.querySelectorAll('[data-reading]').forEach(b => b.onclick = () => {
    const k = b.dataset.reading;
    const nextState = { ...p };
    if (k === 'mikra1' || k === 'mikra2') {
      nextState[k] = !p[k];
    } else {
      const pref = data.commentary === 'rashi' ? 'rashi' : 'onkelos';
      if (nextState.onkelos || nextState.rashi) { nextState.onkelos = false; nextState.rashi = false; }
      else nextState[pref] = true;
    }
    setProgress(item.id, nextState);
    render();
    const again = document.querySelector(`[data-reading="${k}"]`);
    if (again) again.focus({ preventScroll: true });
    const q = state(item.id);
    const label = k === 'mikra1' ? 'First reading' : k === 'mikra2' ? 'Second reading' : 'Commentary reading';
    announce(complete(q) ? `${titleName(item.names)} complete` : `${label} ${steps(q)} of 3 done`);
  });
  document.querySelectorAll('[data-pref]').forEach(b => b.onclick = () => {
    const v = b.dataset.pref === 'rashi' ? 'rashi' : 'onkelos';
    data.commentary = v;
    // If the commentary step is already done, switch its flavor; otherwise
    // just remember the preference for the next tap on row 3.
    const q = { ...p };
    if (q.onkelos || q.rashi) {
      q.onkelos = v === 'onkelos';
      q.rashi = v === 'rashi';
      setProgress(item.id, q);
    } else save();
    render();
    announce(`Commentary preference: ${v === 'rashi' ? 'Rashi' : 'Onkelos'}`);
  });
  const reset = document.querySelector('#reset-week');
  if (reset) reset.onclick = () => { setProgress(item.id, {}); render(); announce(`${titleName(item.names)} reset`); };
  const back = document.querySelector('#back-week');
  if (back) back.onclick = () => { chosen = null; render(); window.scrollTo({ top: 0 }); };
  const browse = document.querySelector('#browse');
  if (browse) browse.onclick = () => { showAll = !showAll; render(); };
  document.querySelector('#settings').onclick = settings;
}

function modal(html, label = 'Dialog') {
  const prev = document.activeElement;
  document.querySelector('#dialog-root').innerHTML = `<div class="scrim"></div><div class="dialog" role="dialog" aria-modal="true" aria-label="${label}"><button class="close" aria-label="Close">×</button>${html}</div>`;
  const box = document.querySelector('.dialog');
  const close = () => { document.querySelector('#dialog-root').innerHTML = ''; if (prev && prev.focus) prev.focus({ preventScroll: true }); };
  box.querySelector('.close').onclick = close;
  document.querySelector('.scrim').onclick = close;
  document.addEventListener('keydown', function esc(e) {
    if (e.key === 'Escape') { close(); document.removeEventListener('keydown', esc); }
  });
  const first = box.querySelector('button.primary') || box.querySelector('.close');
  if (first) first.focus({ preventScroll: true });
}

function settings() {
  const baseYear = cycleYear(new Date(), data.israel);
  modal(`<h2>Settings</h2>
    <label class="setting-row">Reading calendar
      <select id="location"><option value="false" ${!data.israel ? 'selected' : ''}>Diaspora</option><option value="true" ${data.israel ? 'selected' : ''}>Israel</option></select>
    </label>
    <label class="setting-row">Commentary
      <select id="pref"><option value="onkelos" ${data.commentary !== 'rashi' ? 'selected' : ''}>Onkelos</option><option value="rashi" ${data.commentary === 'rashi' ? 'selected' : ''}>Rashi</option></select>
    </label>
    <label class="setting-row">Cycle
      <select id="cyear">${[baseYear - 1, baseYear, baseYear + 1].map(y => `<option ${y === year ? 'selected' : ''} value="${y}">${y}–${String(y + 1).slice(2)}</option>`).join('')}</select>
    </label>
    <p class="dialog-note">The weekly parsha follows this calendar. Switching calendars keeps your checkmarks, but the “this week” parsha may change. Progress is saved in this browser, on this device.</p>
    <button class="primary" id="save-settings">Done</button>`, 'Settings');
  document.querySelector('#save-settings').onclick = () => {
    data.israel = document.querySelector('#location').value === 'true';
    data.commentary = document.querySelector('#pref').value === 'rashi' ? 'rashi' : 'onkelos';
    year = Number(document.querySelector('#cyear').value);
    chosen = null;
    save(); render(); document.querySelector('#dialog-root').innerHTML = '';
  };
}

window.addEventListener('storage', e => {
  if (e.key === KEY) {
    try {
      const d = JSON.parse(e.newValue);
      if (d?.progress) {
        data = { progress: d.progress, israel: d.israel === true, commentary: d.commentary === 'rashi' ? 'rashi' : 'onkelos' };
        render();
      }
    } catch { /* keep current state */ }
  }
});
render();
if ('serviceWorker' in navigator && import.meta.env.PROD) navigator.serviceWorker.register('/sw.js').catch(() => {});
