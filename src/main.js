import './style.css';
import { HDate, Locale } from '@hebcal/core';
import { complete, steps, cycleYear, schedule } from './model.js';
import { cloudEnabled, supabase, signInWithGoogle, signOut, getSession, onAuthChange, googleNativeEnabled, renderGoogleButton } from './auth.js';
import { mergeState, pullCloud, pushAllProgress, pushProfile, createPushQueue } from './sync.js';

const KEY = 'shnaim-mikra-v1';
let data = { progress: {}, israel: false, commentary: 'onkelos', theme: undefined };
let storageOK = true;
try {
  const raw = JSON.parse(localStorage.getItem(KEY));
  if (raw && typeof raw.progress === 'object' && raw.progress !== null) {
    data = {
      progress: raw.progress,
      israel: raw.israel === true,
      commentary: raw.commentary === 'rashi' ? 'rashi' : 'onkelos',
      theme: raw.theme === 'dark' || raw.theme === 'light' ? raw.theme : undefined,
    };
  }
} catch { storageOK = false; }

function applyTheme() {
  const t = data.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  document.documentElement.dataset.theme = t;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = t === 'dark' ? '#141412' : '#ffffff';
}
function toggleTheme() {
  data.theme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  save(); applyTheme(); render();
  const btn = document.querySelector('#theme');
  if (btn) btn.focus({ preventScroll: true });
}

let year = cycleYear(new Date(), data.israel);
let chosen = null;   // selected parsha id, or null = current week
let showAll = false;

// ── Cloud auth + sync (offline-first; no-ops when env keys absent) ──
let user = null;
let syncStatus = 'local'; // local | syncing | ok | error | migrated
let justMigrated = false;
const pushQueue = createPushQueue();
const setSync = s => {
  syncStatus = s;
  const el = document.querySelector('#syncstate');
  if (el) el.textContent = syncLabel();
};
function syncLabel() {
  if (!cloudEnabled) return '';
  if (!user) return 'Saved on this device';
  if (syncStatus === 'syncing') return 'Syncing…';
  if (syncStatus === 'error') return 'Offline — saved on this device';
  if (justMigrated) return 'Synced — your device progress was merged';
  return 'Saved to your account';
}

const check = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" aria-hidden="true"><path d="m5 12 5 5 9-10"/></svg>';
const bookIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" aria-hidden="true"><path d="M12 5.5C10 4.5 7.5 4 4.5 4v15c3 0 5.5.5 7.5 1.5 2-1 4.5-1.5 7.5-1.5V4c-3 0-5.5.5-7.5 1.5z"/><path d="M12 5.5v15"/></svg>';
const slidersIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" aria-hidden="true"><path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2.2"/><circle cx="10" cy="17" r="2.2"/></svg>';
const moonIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" aria-hidden="true"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>';
const sunIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M4.6 4.6l1.4 1.4M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4"/></svg>';

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
  { en: 'Bereshis', he: 'בראשית' },
  { en: 'Shemos', he: 'שמות' },
  { en: 'Vayikra', he: 'ויקרא' },
  { en: 'Bamidbar', he: 'במדבר' },
  { en: 'Devarim', he: 'דברים' },
];
const seferOf = id => SEFER_OF[id] ?? SEFER_OF[id.split('-')[0]] ?? 0;
// Ashkenazi (Yeshivish) transliteration of Hebcal's Sephardi/Modern Hebrew names.
// Keyed by Hebcal parsha name; doubles are handled by splitting on '-' first.
const ASHKENAZI = {
  'Bereshit': 'Bereshis',
  'Noach': 'Noach',
  'Lech': 'Lech',
  'Lecha': 'Lecha',
  'Lech-Lecha': 'Lech Lecha',
  'Vayera': 'Vayeira',
  'Chayei Sara': 'Chayei Sarah',
  'Toldot': 'Toldos',
  'Vayetzei': 'Vayeitzei',
  'Vayishlach': 'Vayishlach',
  'Vayeshev': 'Vayeishev',
  'Miketz': 'Mikeitz',
  'Vayigash': 'Vayigash',
  'Vayechi': 'Vayechi',
  'Shemot': 'Shemos',
  'Vaera': "Va'eira",
  'Bo': 'Bo',
  'Beshalach': 'Beshalach',
  'Yitro': 'Yisro',
  'Mishpatim': 'Mishpatim',
  'Terumah': 'Terumah',
  'Tetzaveh': 'Tetzaveh',
  'Ki Tisa': 'Ki Sisa',
  'Vayakhel': 'Vayakhel',
  'Pekudei': 'Pekudei',
  'Vayikra': 'Vayikra',
  'Tzav': 'Tzav',
  'Shmini': 'Shemini',
  'Tazria': 'Tazria',
  'Metzora': 'Metzora',
  'Achrei Mot': 'Acharei Mos',
  'Kedoshim': 'Kedoshim',
  'Emor': 'Emor',
  'Behar': 'Behar',
  'Bechukotai': 'Bechukosai',
  'Bamidbar': 'Bamidbar',
  'Nasso': 'Nasso',
  "Beha'alotcha": "Beha'aloscha",
  "Sh'lach": 'Shelach',
  'Korach': 'Korach',
  'Chukat': 'Chukas',
  'Balak': 'Balak',
  'Pinchas': 'Pinchas',
  'Matot': 'Matos',
  'Masei': 'Masei',
  'Devarim': 'Devarim',
  'Vaetchanan': "Va'eschanan",
  'Eikev': 'Eikev',
  "Re'eh": "Re'eh",
  'Shoftim': 'Shoftim',
  'Ki Teitzei': 'Ki Seitzei',
  'Ki Tavo': 'Ki Savo',
  'Nitzavim': 'Nitzavim',
  'Vayeilech': 'Vayeilech',
  "Ha'azinu": "Ha'azinu",
  'Vezot Haberakhah': 'Vezos Habrachah',
};
const fixName = n => ASHKENAZI[n] || n.split('-').map(part => ASHKENAZI[part] || part).join(' ');
const displayNames = names => names.map(fixName);
const titleName = names => displayNames(names).join(' – ');
const heroName = names => `Parshas ${names.length > 1 ? displayNames(names).join('–') : fixName(names[0])}`;
const hebrewName = names => `פרשת ${names.map(n => Locale.gettext(n, 'he')).join('־')}`;

const all = () => schedule(year, data.israel);
const state = id => data.progress[`${year}:${id}`] || {};
function save() {
  try { localStorage.setItem(KEY, JSON.stringify(data)); storageOK = true; } catch { storageOK = false; }
  if (cloudEnabled && user) pushQueue.profile(user.id, data, s => setSync(s === 'ok' ? 'ok' : s));
}
function setProgress(id, next) {
  const k = `${year}:${id}`;
  if (Object.values(next).some(Boolean)) data.progress[k] = next;
  else delete data.progress[k];
  save();
  if (cloudEnabled && user) pushQueue.progress(user.id, year, id, next, s => setSync(s === 'ok' ? 'ok' : s));
}
function current(rows) { const today = new Date(); today.setHours(0, 0, 0, 0); return rows.find(r => r.date >= today) || rows.at(-1); }
const hebrewYearOf = date => { try { return new HDate(date).getFullYear(); } catch { return null; } };

function announce(msg) {
  const el = document.querySelector('#announcement');
  if (el) el.textContent = msg;
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
  const p = state(item.id);
  const n = steps(p);
  const done = rows.filter(r => complete(state(r.id))).length;
  const isWeekly = item.id === weekly.id;
  const sIdx = seferOf(item.id);
  const seferRows = rows.filter(r => seferOf(r.id) === sIdx);
  const seferDone = seferRows.filter(r => complete(state(r.id))).length;
  const hebYear = hebrewYearOf(item.date);
  const groups = SEFARIM.map((s, i) => ({ ...s, rows: rows.filter(r => seferOf(r.id) === i) })).filter(g => g.rows.length);
  const targumOn = !!(p.onkelos || p.rashi);
  const activeFlavor = p.onkelos ? 'Onkelos' : p.rashi ? 'Rashi' : null;
  const isDark = document.documentElement.dataset.theme === 'dark';
  const authLabel = user ? `Account, ${user.email || 'signed in'}` : 'Sign in to sync across devices';
  // Days left to finish this week's parsha before Shabbos (Saturday).
  const daysLeft = (6 - new Date().getDay() + 7) % 7;
  const weeklyDone = complete(state(weekly.id));
  const countdown = weeklyDone ? 'This week complete' : daysLeft === 0 ? 'Due today' : daysLeft === 1 ? '1 day remaining' : `${daysLeft} days remaining`;

  document.querySelector('#app').innerHTML = `
  <a class="skip" href="#reading">Skip to reading</a>
  <div class="page">
    <header class="topbar">
      <span class="brand"><span class="brandicon" aria-hidden="true">${bookIcon}</span>Shnayim Mikra</span>
      <span class="topright">
        ${hebYear ? `<span class="hebyear">${hebYear}</span>` : ''}
        ${user
          ? `<button class="avatarbtn" id="account" aria-label="${authLabel}" title="${user.email || ''}">${avatarInitial()}</button>`
          : `<button class="signinbtn" id="account">Sign in</button>`}
        <button class="iconbtn" id="theme" aria-label="${isDark ? 'Switch to light mode' : 'Switch to dark mode'}" aria-pressed="${isDark}">${isDark ? sunIcon : moonIcon}</button>
        <button class="iconbtn" id="settings" aria-label="Settings">${slidersIcon}</button>
      </span>
    </header>

    <main>
      <div class="titlerow">
        <h1>${heroName(item.names)}</h1>
        <span class="he" lang="he" dir="rtl">${hebrewName(item.names)}</span>
      </div>
      ${isWeekly ? '' : `<p class="backrow"><button class="backlink" id="back-week">← Back to this week: ${titleName(weekly.names)}</button></p>`}

      <div class="cards">
        <section class="card" id="reading" aria-label="Your reading for ${titleName(item.names)}">
          <div class="cardhead"><h2>Your reading</h2><span class="count">${n} of 3</span></div>
          <div class="bar" role="img" aria-label="${n} of 3 readings done"><div style="width:${(n / 3) * 100}%"></div></div>
          <ol class="reads">
            ${readingRow('mikra1', '1', 'Mikra I', !!p.mikra1, `First reading of the parsha${p.mikra1 ? ', done' : ''}`)}
            ${readingRow('mikra2', '2', 'Mikra II', !!p.mikra2, `Second reading of the parsha${p.mikra2 ? ', done' : ''}`)}
            ${readingRow('targum', '3', 'Targum', targumOn, `Commentary reading${activeFlavor ? `, ${activeFlavor} done` : `, not done`}`)}
          </ol>
          ${n > 0 ? `<p class="resetrow"><button class="resetlink" id="reset-week">Reset this week</button></p>` : ''}
        </section>

        <section class="card" aria-label="Yearly progress">
          <h2 class="kicker">YEARLY PROGRESS</h2>
          <p class="bignum">${done} <span>/ ${rows.length}</span></p>
          <p class="bigsub">Parshiyos completed</p>
          <div class="bar" role="img" aria-label="${done} of ${rows.length} parshiyos completed"><div style="width:${rows.length ? Math.round((done / rows.length) * 100) : 0}%"></div></div>
          <div class="yearspace" aria-hidden="true"></div>
          <p class="nextlabel">This week</p>
          <p class="nextrow"><span class="nextcount">${countdown}</span></p>
        </section>
      </div>

      <section class="card cycle" aria-label="The yearly cycle">
        <div class="cyclehead solo">
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

      <footer><span id="syncstate" role="status">${syncLabel()}</span>${storageOK ? '' : '<span class="warn"> Progress could not be saved. Check browser storage.</span>'}</footer>
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
  const reset = document.querySelector('#reset-week');
  if (reset) reset.onclick = () => { setProgress(item.id, {}); render(); announce(`${titleName(item.names)} reset`); };
  const back = document.querySelector('#back-week');
  if (back) back.onclick = () => { chosen = null; render(); window.scrollTo({ top: 0 }); };
  const browse = document.querySelector('#browse');
  if (browse) browse.onclick = () => { showAll = !showAll; render(); };
  document.querySelector('#settings').onclick = settings;
  document.querySelector('#theme').onclick = toggleTheme;
  const account = document.querySelector('#account');
  if (account) account.onclick = authDialog;
}

function avatarInitial() {
  const src = user?.email || user?.user_metadata?.name || '•';
  const ch = String(src).trim().charAt(0).toUpperCase() || '•';
  return `<span aria-hidden="true">${ch}</span>`;
}

function authDialog() {
  if (!cloudEnabled) {
    modal(`<h2>Sign in</h2>
      <p class="dialog-note">Cloud sync isn’t configured yet. Add <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code> to <code>.env</code> (see <code>.env.example</code> + <code>supabase/README.md</code>), then reload. Your progress stays saved on this device meanwhile.</p>
      <button class="primary" id="auth-close">Done</button>`, 'Sign in');
    document.querySelector('#auth-close').onclick = () => { document.querySelector('#dialog-root').innerHTML = ''; };
    return;
  }
  if (user) {
    modal(`<h2>Account</h2>
      <p class="dialog-note">Signed in as <strong>${user.email || user.id}</strong>.</p>
      <p class="dialog-note" id="auth-sync-note">${syncLabel()}</p>
      <button class="primary" id="auth-out">Sign out</button>`, 'Account');
    document.querySelector('#auth-out').onclick = async () => {
      try { await signOut(); } catch { /* local sign-out still applies below */ }
      user = null; justMigrated = false; setSync('local');
      document.querySelector('#dialog-root').innerHTML = '';
      render();
      announce('Signed out. Progress stays on this device.');
    };
    return;
  }
  modal(`<h2>Sign in</h2>
    <p class="dialog-note">Sync your checkmarks across devices. Checkmarks on this device merge in — nothing is lost.</p>
    <div class="giswrap" id="gis-wrap"><div id="gis-btn"></div></div>
    <button class="gsi-btn" id="auth-google" hidden>
      <span class="gsi-icon" aria-hidden="true"><svg viewBox="0 0 48 48"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg></span>
      <span>Continue with Google</span>
    </button>
    <p class="dialog-note" id="auth-msg" role="status"></p>`, 'Sign in');
  const authMsg = () => document.querySelector('#auth-msg');
  const useRedirectButton = () => {
    // Native Google button unavailable (no client ID configured or GIS
    // failed to load): fall back to the redirect flow with the styled button.
    const wrap = document.querySelector('#gis-wrap');
    if (wrap) wrap.remove();
    const btn = document.querySelector('#auth-google');
    if (!btn) return;
    btn.hidden = false;
    btn.onclick = async () => {
      const msg = authMsg();
      try { await signInWithGoogle(); if (msg) msg.textContent = 'Redirecting to Google…'; }
      catch (e) { if (msg) msg.textContent = e?.message || 'Google sign-in failed.'; }
    };
  };
  if (googleNativeEnabled) {
    const slot = document.querySelector('#gis-btn');
    renderGoogleButton(slot).then(() => {
      // onAuthChange fires handleSession (merge + render); just close here.
      document.querySelector('#dialog-root').innerHTML = '';
      announce('Signed in. Syncing your progress.');
    }).catch(() => useRedirectButton());
  } else {
    useRedirectButton();
  }
}

async function handleSession(session) {
  const nextUser = session?.user || null;
  const changed = (nextUser?.id || null) !== (user?.id || null);
  user = nextUser;
  if (!user || !cloudEnabled) {
    if (!user) { justMigrated = false; setSync('local'); }
    if (changed) render();
    return;
  }
  if (!changed) return;
  setSync('syncing');
  announce('Signed in. Syncing your progress.');
  try {
    const { profile, rows } = await pullCloud(user.id, year);
    const hadLocal = Object.keys(data.progress || {}).length > 0;
    data = { ...mergeState(data, rows, profile), theme: data.theme };
    // mergeState takes server theme; keep local data object shape valid
    if (data.theme !== 'dark' && data.theme !== 'light') data.theme = undefined;
    justMigrated = hadLocal;
    save(); applyTheme(); render();
    // Push merged union back up so other devices converge.
    await pushAllProgress(user.id, data.progress);
    await pushProfile(user.id, data);
    setSync('ok');
    announce(justMigrated ? 'Signed in. Your device progress was merged.' : 'Signed in. Progress synced.');
  } catch {
    setSync('error');
    render();
  }
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
  const first = box.querySelector('button.primary') || box.querySelector('.gsi-btn') || box.querySelector('.close');
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
    <p class="dialog-note">The weekly parsha follows this calendar. Switching calendars keeps your checkmarks, but the “this week” parsha may change. ${cloudEnabled ? (user ? 'Signed in — progress syncs to your account and this device.' : 'Progress is saved on this device. Sign in (top right) to sync across devices.') : 'Progress is saved in this browser, on this device.'}</p>
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
        data = { progress: d.progress, israel: d.israel === true, commentary: d.commentary === 'rashi' ? 'rashi' : 'onkelos', theme: d.theme === 'dark' || d.theme === 'light' ? d.theme : undefined };
        applyTheme();
        render();
      }
    } catch { /* keep current state */ }
  }
});
applyTheme();
render();
if (cloudEnabled && supabase) {
  getSession().then(s => handleSession(s)).catch(() => {});
  onAuthChange(session => handleSession(session));
}
if ('serviceWorker' in navigator && import.meta.env.PROD) navigator.serviceWorker.register('/sw.js').catch(() => {});
