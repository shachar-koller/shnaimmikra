import './style.css';
import { Locale } from '@hebcal/core';
import {
  complete,
  steps,
  cycleYear,
  schedule,
  localShabbosDate,
  currentParsha,
  shabbosCountdown,
  formatGregorianDate,
} from './model.js';
import { cloudEnabled, supabase, signInWithGoogle, signOut, getSession, onAuthChange, googleNativeEnabled, renderGoogleButton } from './auth.js';
import { mergeState, pullCloud, pushAllProgress, pushProfile, createPushQueue } from './sync.js';

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

let year = cycleYear(new Date(), data.israel);
let chosen = null;   // selected parsha id, or null = current week
let activeSefer = null; // selected sefer index (0-4), or null = follow chosen/weekly sefer

// ── Cloud auth + sync (offline-first; no-ops when env keys absent) ──
let user = null;
let syncStatus = 'local'; // local | syncing | ok | error | migrated
let justMigrated = false;
const pushQueue = createPushQueue();
const setSync = s => {
  syncStatus = s;
};
function syncLabel() {
  if (!cloudEnabled) return '';
  if (!user) return 'Saved on this device';
  if (syncStatus === 'syncing') return 'Syncing…';
  if (syncStatus === 'error') return 'Offline — saved on this device';
  return 'Saved to your account';
}

const check = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" aria-hidden="true"><path d="m5 12 5 5 9-10"/></svg>';
const slidersIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" aria-hidden="true"><path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2.2"/><circle cx="10" cy="17" r="2.2"/></svg>';

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
// Ashkenazi (Yeshivish) transliteration of Hebcal's Sephardi/Modern Hebrew names.
// Keyed by Hebcal parsha name; doubles are handled by splitting on '-' first.
const ASHKENAZI = {
  'Bereshit': 'Bereishis',
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
const hebrewParshaName = names => names.map(n => Locale.gettext(n, 'he-x-NoNikud').replaceAll('־', ' ')).join('־');
const hebrewName = names => `פרשת ${hebrewParshaName(names)}`;

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

function announce(msg) {
  const el = document.querySelector('#announcement');
  if (el) el.textContent = msg;
}

function readingControl(key, label, on, ariaLabel, num = null, disabled = false) {
  if (!num) {
    return `<button type="button" class="readrow commentarychoice${on ? ' on' : ''}${disabled ? ' unavailable' : ''}" data-reading-row="${key}" data-reading="${key}" role="checkbox" aria-checked="${on}" aria-label="${ariaLabel}" ${disabled ? 'disabled' : ''}>
      ${on ? `<span class="commentarycheck" aria-hidden="true">${check}</span>` : ''}
      <span class="rlabel">${label}</span>
    </button>`;
  }
  return `<div class="readingstep" data-reading-row="${key}">
      <span class="rnum" aria-hidden="true">${num}</span>
      <button type="button" class="readrow readingchoice${on ? ' on' : ''}" data-reading="${key}" role="checkbox" aria-checked="${on}" aria-label="${ariaLabel}" ${disabled ? 'disabled' : ''}>
        <span class="rcheck${on ? ' on' : ''}" aria-hidden="true">${on ? check : ''}</span>
        <span class="rlabel">${label}</span>
      </button>
    </div>`;
}

function readingRow(key, num, label, on, ariaLabel) {
  return `<li>${readingControl(key, label, on, ariaLabel, num)}</li>`;
}

function render() {
  const rows = all();
  const weekly = currentParsha(rows);
  const item = rows.find(r => r.id === chosen) || weekly;
  const p = state(item.id);
  const n = steps(p);
  const done = rows.filter(r => complete(state(r.id))).length;
  const weeklySteps = steps(state(weekly.id));
  const itemSefer = seferOf(item.id);
  const viewSefer = activeSefer !== null ? activeSefer : itemSefer;
  const seferRows = rows.filter(r => seferOf(r.id) === viewSefer);
  const seferDone = seferRows.filter(r => complete(state(r.id))).length;
  const authLabel = user ? `Account, ${user.email || 'signed in'}` : 'Sign in to sync across devices';
  const accountBtn = user
    ? `<button class="avatarbtn" id="account" aria-label="${authLabel}" title="${user.email || ''}">${avatarInitial()}</button>`
    : `<button class="signinbtn" id="account">Sign in</button>`;

  const upcomingShabbos = localShabbosDate(weekly.date);
  const countdownText = shabbosCountdown(upcomingShabbos);
  const shabbosDateText = formatGregorianDate(upcomingShabbos);

  document.querySelector('#app').innerHTML = `
  <a class="skip" href="#reading">Skip to reading</a>
  <div class="page">
    <header class="topbar">
      <span class="topright">
        <button class="iconbtn" id="settings" aria-label="Settings">${slidersIcon}</button>
        ${accountBtn}
      </span>
    </header>
    <main>
      <header class="titlerow">
        <h1>${heroName(item.names)}</h1>
        <span class="he" lang="he" dir="rtl">${hebrewName(item.names)}</span>
      </header>

      <div class="cards">
        <section class="card" id="reading" aria-label="Shnayim Mikra for ${titleName(item.names)}">
          <ol class="reads">
            ${readingRow('mikra1', '1', 'Mikra I', !!p.mikra1, `First reading of the parsha${p.mikra1 ? ', done' : ''}`)}
            ${readingRow('mikra2', '2', 'Mikra II', !!p.mikra2, `Second reading of the parsha${p.mikra2 ? ', done' : ''}`)}
            <li class="commentaryrow">
              <span class="rnum" aria-hidden="true">3</span>
              <div class="commentaryoptions" role="group" aria-label="Commentary">
                ${readingControl('rashi', 'Rashi', !!p.rashi, `Rashi commentary, ${p.rashi ? 'done' : 'not done'}`, null, !!p.onkelos && !p.rashi)}
                ${readingControl('onkelos', 'Targum', !!p.onkelos, `Targum (Onkelos), ${p.onkelos ? 'done' : 'not done'}`, null, !!p.rashi && !p.onkelos)}
              </div>
            </li>
          </ol>
          <p class="resetrow"><button class="resetlink" id="reset-week" ${n === 0 ? 'disabled aria-hidden="true"' : ''}>Reset this week</button></p>
        </section>

        <div class="sidecol">
          <section class="card yearly" aria-label="Yearly progress">
            <div class="weeklyprogress" aria-label="This week's progress">
              <div class="progressheading"><h2 class="kicker">This week</h2><p class="progressvalue">${weeklySteps}<span> / 3</span></p></div>
              <div class="weeksegments" role="img" aria-label="${weeklySteps} of 3 readings completed for ${titleName(weekly.names)}">${[1, 2, 3].map(step => `<span class="${weeklySteps >= step ? 'filled' : ''}"></span>`).join('')}</div>
              <p class="bigsub">${titleName(weekly.names)} readings</p>
            </div>
            <div class="yearprogress">
              <div class="progressheading"><h2 class="kicker">This year</h2><p class="progressvalue bignum">${done}<span> / ${rows.length}</span></p></div>
              <div class="bar" role="img" aria-label="${done} of ${rows.length} parshiyos completed"><div style="width:${rows.length ? Math.round((done / rows.length) * 100) : 0}%"></div></div>
              <p class="bigsub">Parshiyos completed</p>
            </div>
          </section>

          <section class="card shabbos" aria-label="Upcoming Shabbos">
            <h2 class="kicker">Upcoming shabbos</h2>
            <p class="shabbos-count">${countdownText}</p>
            <p class="shabbos-date">${shabbosDateText}</p>
          </section>
        </div>
      </div>

      <section class="card cycle" aria-label="The yearly cycle">
        <nav class="sefertabs" aria-label="Torah Books">
          ${SEFARIM.map((s, i) => {
            const isCurrent = i === viewSefer;
            const sRows = rows.filter(r => seferOf(r.id) === i);
            const sDone = sRows.filter(r => complete(state(r.id))).length;
            return `<button type="button" class="sefertab${isCurrent ? ' active' : ''}" data-sefer-tab="${i}" aria-pressed="${isCurrent}" aria-label="${s.en}, ${sDone} of ${sRows.length} completed">
              ${s.en}
            </button>`;
          }).join('')}
        </nav>

        <div class="cyclesub">
          <h2 class="cycname">Sefer ${SEFARIM[viewSefer].en}</h2>
          <span class="cyccount">${seferDone}/${seferRows.length}</span>
        </div>

        <ol class="parshalist" aria-label="Parshiyos in ${SEFARIM[viewSefer].en}">
          ${seferRows.map((r, i) => {
            const s = state(r.id);
            const isDone = complete(s);
            const isCur = r.id === weekly.id;
            const isSel = r.id === item.id;
            const numSteps = steps(s);
            const isPartial = numSteps > 0 && !isDone;
            const st = isDone ? 'Completed' : isPartial ? `${numSteps} of 3 done` : 'Not started';
            return `<li>
              <button type="button" class="parsharow${isDone ? ' done' : ''}${isCur ? ' current' : ''}${isSel ? ' selected' : ''}" data-parsha="${r.id}" aria-label="${titleName(r.names)}, ${st}${isCur ? ', current parsha' : ''}${isSel ? ', selected' : ''}" aria-pressed="${isSel}" ${isCur ? 'aria-current="true"' : ''}>
                <span class="parshanum" aria-hidden="true">${i + 1}</span>
                <span class="parshaen">${titleName(r.names)}</span>
                <span class="parshastatus">${isCur ? '<span class="current-dot" aria-hidden="true"></span>' : ''}${isPartial ? `${numSteps}/3` : isCur ? 'Current' : ''}</span>
                <span class="statusring ${isDone ? 'complete' : isPartial ? 'partial' : 'empty'}" style="--progress:${numSteps / 3 * 100}%" aria-hidden="true">${isDone ? check : ''}</span>
              </button>
            </li>`;
          }).join('')}
        </ol>

      </section>

      ${storageOK ? '' : '<footer><span class="warn">Progress could not be saved. Check browser storage.</span></footer>'}
    </main>
  </div>
  <div id="dialog-root"></div>
  <div class="sr-only" aria-live="polite" id="announcement"></div>`;

  wire(rows, weekly, item, p);
}

function wire(rows, weekly, item, p) {
  // Keep the active book visible when the tab strip is narrower than its contents.
  const activeTab = document.querySelector('.sefertab.active');
  const tabStrip = document.querySelector('.sefertabs');
  if (activeTab && tabStrip) {
    tabStrip.scrollLeft = Math.max(0, activeTab.offsetLeft - (tabStrip.clientWidth - activeTab.offsetWidth) / 2);
  }
  document.querySelectorAll('[data-sefer-tab]').forEach(b => b.onclick = () => {
    activeSefer = Number(b.dataset.seferTab);
    render();
    document.querySelector(`[data-sefer-tab="${activeSefer}"]`).focus({ preventScroll: true });
  });
  document.querySelectorAll('[data-parsha]').forEach(b => b.onclick = () => {
    const rowTop = b.getBoundingClientRect().top;
    chosen = b.dataset.parsha;
    activeSefer = seferOf(chosen);
    render();
    const selected = document.querySelector('.parsharow.selected');
    selected.focus({ preventScroll: true });
    // Keep the clicked row in place when the new parsha heading wraps.
    const offset = selected.getBoundingClientRect().top - rowTop;
    window.scrollTo({ top: window.scrollY + offset, behavior: 'instant' });
    announce(`${titleName(rows.find(r => r.id === chosen).names)} selected`);
  });

  const toggleReading = (k) => {
    const otherCommentary = k === 'rashi' ? 'onkelos' : k === 'onkelos' ? 'rashi' : null;
    if (otherCommentary && p[otherCommentary] && !p[k]) return;
    const nextState = { ...p };
    nextState[k] = !p[k];
    setProgress(item.id, nextState);
    render();
    const again = document.querySelector(`button[data-reading="${k}"]`);
    if (again) again.focus({ preventScroll: true });
    if (nextState[k]) {
      again?.classList.add('just-checked');
      // Unsupported haptics must never interrupt saving or visual feedback.
      if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        try { navigator.vibrate?.(8); } catch { /* optional device feedback */ }
      }
    }
    const q = state(item.id);
    const label = k === 'mikra1' ? 'First reading' : k === 'mikra2' ? 'Second reading' : k === 'rashi' ? 'Rashi' : 'Targum';
    announce(`${label} ${q[k] ? 'done' : 'not done'}. ${titleName(item.names)}${complete(q) ? ' complete' : `, ${steps(q)} of 3 done`}`);
  };

  document.querySelectorAll('.readrow').forEach(row => {
    row.onclick = () => {
      const k = row.dataset.readingRow;
      if (k) toggleReading(k);
    };
  });

  document.querySelectorAll('button[data-reading]').forEach(btn => {
    btn.onclick = (e) => {
      e.stopPropagation();
      const k = btn.dataset.reading;
      if (k) toggleReading(k);
    };
  });

  const reset = document.querySelector('#reset-week');
  if (reset) reset.onclick = () => {
    setProgress(item.id, {});
    render();
    document.querySelector('[data-reading="mikra1"]').focus({ preventScroll: true });
    announce(`${titleName(item.names)} reset`);
  };
  document.querySelector('#settings').onclick = settings;
  const account = document.querySelector('#account');
  if (account) account.onclick = authDialog;
}

function avatarInitialInner() {
  const src = user?.email || user?.user_metadata?.name || '•';
  return String(src).trim().charAt(0).toUpperCase() || '•';
}

function avatarInitial() {
  return `<span aria-hidden="true">${avatarInitialInner()}</span>`;
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
    data = mergeState(data, rows, profile);
    justMigrated = hadLocal;
    save(); render();
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
  const first = box.querySelector('button.primary') || box.querySelector('.gsi-btn:not([hidden])') || box.querySelector('.close');
  if (first) first.focus({ preventScroll: true });
}

function settings() {
  const baseYear = cycleYear(new Date(), data.israel);
  modal(`<h2>Settings</h2>
    <label class="setting-row">Reading calendar
      <select id="location"><option value="false" ${!data.israel ? 'selected' : ''}>Diaspora</option><option value="true" ${data.israel ? 'selected' : ''}>Israel</option></select>
    </label>
    <label class="setting-row">Cycle
      <select id="cyear">${[baseYear - 1, baseYear, baseYear + 1].map(y => `<option ${y === year ? 'selected' : ''} value="${y}">${y}–${String(y + 1).slice(2)}</option>`).join('')}</select>
    </label>
    <p class="dialog-note">The weekly parsha follows this calendar. Switching calendars keeps your checkmarks, but the “this week” parsha may change. ${cloudEnabled ? (user ? 'Signed in — progress syncs to your account and this device.' : 'Progress is saved on this device. Sign in to sync across devices.') : 'Progress is saved in this browser, on this device.'}</p>
    <button class="primary" id="save-settings">Done</button>`, 'Settings');
  document.querySelector('#save-settings').onclick = () => {
    data.israel = document.querySelector('#location').value === 'true';
    year = Number(document.querySelector('#cyear').value);
    chosen = null;
    activeSefer = null;
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
if (cloudEnabled && supabase) {
  getSession().then(s => handleSession(s)).catch(() => {});
  onAuthChange(session => handleSession(session));
}
if ('serviceWorker' in navigator && import.meta.env.PROD) navigator.serviceWorker.register('/sw.js').catch(() => {});
