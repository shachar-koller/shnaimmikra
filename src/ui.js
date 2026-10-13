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
import { cloudEnabled, signInWithGoogle, googleNativeEnabled, renderGoogleButton } from './auth.js';
import { themes } from './storage.js';
import { createBackup, parseBackup, backupSummary, MAX_BACKUP_BYTES } from './backup.js';
import { SEFARIM, seferOf, fixName, titleName, heroName, hebrewName } from './names.js';
import { peirushName, progressText } from './progress.js';

const escapeHtml = value => value.replace(/[&<>"']/g, char => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[char]));

export function mountApp(session) {
let { data, user, storageOK, ready } = session.snapshot();
const guestChoiceKey = 'shnaim-mikra-guest-choice';
let guestChosen = false;
try { guestChosen = localStorage.getItem(guestChoiceKey) === 'true'; } catch { /* Guest access still works without storage. */ }
const callbackParams = new URLSearchParams(location.hash.slice(1));
let signInError = callbackParams.has('error') || new URLSearchParams(location.search).has('error');
const systemDark = matchMedia('(prefers-color-scheme: dark)');
function chooseGuest(value) {
  guestChosen = value;
  try {
    if (value) localStorage.setItem(guestChoiceKey, 'true');
    else localStorage.removeItem(guestChoiceKey);
  } catch { /* Keep the choice for this visit. */ }
}

function applyTheme() {
  document.documentElement.dataset.theme = data.theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content',
    document.documentElement.dataset.screen === 'welcome'
      ? (systemDark.matches ? '#1e1e1e' : '#f5f5f5')
      : themes.find(theme => theme.id === data.theme).color);
}
systemDark.addEventListener('change', applyTheme);
applyTheme();

const requestedCheckboxLayout = new URLSearchParams(location.search).get('checkboxes');
document.querySelector('#app').dataset.checkboxLayout = requestedCheckboxLayout === 'left' ? 'left' : 'right';

let year = cycleYear(new Date(), data.israel);
let chosen = null;   // selected parsha id, or null = current week
let activeSefer = null; // selected sefer index (0-4), or null = follow chosen/weekly sefer


const check = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" aria-hidden="true"><path d="m5 12 5 5 9-10"/></svg>';
const slidersIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" aria-hidden="true"><path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2.2"/><circle cx="10" cy="17" r="2.2"/></svg>';


const all = () => schedule(year, data.israel);
const state = id => data.progress[`${year}:${id}`] || {};
function save() {
  try { data = session.settings({ israel: data.israel, commentary: data.commentary, theme: data.theme, peirushName: data.peirushName }); }
  catch { /* The storage warning stays visible; no unsaved write is sent. */ }
}
function setProgress(id, patch) {
  try { data = session.reading(`${year}:${id}`, patch); }
  catch { announce('Progress could not be saved. Check browser storage.'); }
}

function announce(msg) {
  const el = document.querySelector('#announcement');
  if (el) el.textContent = msg;
}

function refreshUnlessDialogOpen() {
  if (document.querySelector('.dialog')) return;
  const focused = document.activeElement;
  const selector = focused?.id ? `#${CSS.escape(focused.id)}`
    : ['reading', 'parsha', 'seferTab'].map(key => focused?.dataset[key] !== undefined
      ? `[data-${key.replace(/[A-Z]/g, char => `-${char.toLowerCase()}`)}="${CSS.escape(focused.dataset[key])}"]` : '').find(Boolean);
  render();
  if (selector) document.querySelector(selector)?.focus({ preventScroll: true });
}

function readingControl(key, label, on, ariaLabel, disabled = false) {
  return `<button type="button" class="readrow readingchoice commentarychoice${on ? ' on' : ''}${disabled ? ' unavailable' : ''}" data-reading-row="${key}" data-reading="${key}" role="checkbox" aria-checked="${on}" aria-label="${ariaLabel}" ${disabled ? 'disabled' : ''}>
    <span class="rlabel">${label}</span>
    <span class="rcheck${on ? ' on' : ''}" aria-hidden="true">${on ? check : ''}</span>
  </button>`;
}

function readingRow(key, label, on, ariaLabel) {
  return `<li>
    <div class="readingstep" data-reading-row="${key}">
      <button type="button" class="readrow readingchoice${on ? ' on' : ''}" data-reading="${key}" role="checkbox" aria-checked="${on}" aria-label="${ariaLabel}">
        <span class="rlabel">${label}</span>
        <span class="rcheck${on ? ' on' : ''}" aria-hidden="true">${on ? check : ''}</span>
      </button>
    </div>
  </li>`;
}

function render() {
  document.documentElement.dataset.screen = !ready ? 'loading' : !user && !guestChosen ? 'welcome' : 'tracker';
  applyTheme();
  if (!ready) {
    document.querySelector('#app').innerHTML = '<main class="session-loading"><p role="status">Loading your account…</p></main>';
    return;
  }
  if (!user && !guestChosen) {
    renderWelcome();
    return;
  }
  const rows = all();
  const weekly = currentParsha(rows);
  const weeklyRows = rows.filter(r => r.date.getTime() === weekly.date.getTime());
  const weeklyNames = weeklyRows.flatMap(r => r.names);
  const weeklyTotal = weeklyRows.length * 3;
  const item = rows.find(r => r.id === chosen) || weekly;
  const p = state(item.id);
  const done = rows.filter(r => complete(state(r.id))).length;
  const weeklySteps = weeklyRows.reduce((sum, r) => sum + steps(state(r.id)), 0);
  const itemSefer = seferOf(item.id);
  const viewSefer = activeSefer !== null ? activeSefer : itemSefer;
  const seferRows = rows.filter(r => seferOf(r.id) === viewSefer);
  const seferDone = seferRows.filter(r => complete(state(r.id))).length;
  const authLabel = user ? `Account, ${user.email || 'signed in'}` : 'Sign in to sync across devices';
  const accountBtn = user
    ? `<button class="avatarbtn" id="account" aria-label="${escapeHtml(authLabel)}" title="${escapeHtml(user.email || '')}">${avatarInitial()}</button>`
    : `<button class="signinbtn" id="account">Sign in with Google</button>`;

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
            ${readingRow('mikra1', 'Mikra I', !!p.mikra1, `First reading of the parsha${p.mikra1 ? ', done' : ''}`)}
            ${readingRow('mikra2', 'Mikra II', !!p.mikra2, `Second reading of the parsha${p.mikra2 ? ', done' : ''}`)}
            <li class="commentaryrow">
              <div class="commentaryoptions" role="group" aria-label="Commentary">
                ${readingControl('rashi', escapeHtml(peirushName(data.peirushName)), !!p.rashi, `${escapeHtml(peirushName(data.peirushName))} commentary, ${p.rashi ? 'done' : 'not done'}`, !!p.onkelos && !p.rashi)}
                ${readingControl('onkelos', 'Onkelos', !!p.onkelos, `Onkelos, ${p.onkelos ? 'done' : 'not done'}`, !!p.rashi && !p.onkelos)}
              </div>
            </li>
          </ol>
        </section>

        <div class="sidecol">
          <section class="card yearly" aria-label="Yearly progress">
            <div class="weeklyprogress" aria-label="This week's progress">
              <div class="progressheading"><h2 class="kicker">This week</h2><p class="progressvalue">${weeklySteps}<span> / ${weeklyTotal}</span></p></div>
              <div class="weeksegments" style="--weekly-steps:${weeklyTotal}" role="img" aria-label="${weeklySteps} of ${weeklyTotal} readings completed for ${titleName(weeklyNames)}">${Array.from({ length: weeklyTotal }, (_, i) => `<span class="${weeklySteps > i ? 'filled' : ''}"></span>`).join('')}</div>
              <p class="bigsub">${titleName(weeklyNames)} readings</p>
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
            const isCur = weeklyRows.some(w => w.id === r.id);
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
  if (!user && signInError) {
    signInError = false;
    authDialog();
    const msg = document.querySelector('#auth-msg');
    if (msg) msg.textContent = 'Sign-in was not completed. Please try again.';
  }
}

function wire(rows, weekly, item, p) {
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
    setProgress(item.id, { [k]: nextState[k] });
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
    const label = k === 'mikra1' ? 'First reading' : k === 'mikra2' ? 'Second reading' : k === 'rashi' ? peirushName(data.peirushName) : 'Onkelos';
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

  document.querySelector('#settings').onclick = settings;
  const account = document.querySelector('#account');
  if (account) account.onclick = authDialog;
}

function avatarInitialInner() {
  const src = user?.email || user?.user_metadata?.name || '•';
  return String(src).trim().charAt(0).toUpperCase() || '•';
}

function avatarInitial() {
  return `<span aria-hidden="true">${escapeHtml(avatarInitialInner())}</span>`;
}

function authDialog() {
  if (!cloudEnabled) {
    modal(`<h2>Sign in</h2>
      <p class="dialog-note">Sign-in is unavailable. Your progress is saved on this device.</p>
      <button class="primary" id="auth-close">Done</button>`, 'Sign in');
    document.querySelector('#auth-close').onclick = () => closeModal();
    return;
  }
  if (user) {
    settings();
    return;
  }
  modal(`<h2>Keep your progress with you</h2>
    <p class="dialog-note">Sign in with Google to save your reading progress and pick up on any device.</p>
    ${googleSignInMarkup()}`, 'Sign in');
  wireGoogleSignIn(document.querySelector('.dialog'));
}

function googleSignInMarkup() {
  return `    <div class="giswrap" id="gis-wrap"><div id="gis-btn"></div></div>
    <button class="gsi-btn" id="auth-google" hidden>
      <span class="gsi-icon" aria-hidden="true"><svg viewBox="0 0 48 48"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg></span>
      <span>Continue with Google</span>
    </button>
    <p class="dialog-note" id="auth-msg" role="status"></p>`;
}

function wireGoogleSignIn(root, { native = googleNativeEnabled } = {}) {
  const msg = root.querySelector('#auth-msg');
  const useRedirectButton = () => {
    if (!root.isConnected) return;
    root.querySelector('#gis-wrap')?.remove();
    const btn = root.querySelector('#auth-google');
    btn.hidden = false;
    btn.onclick = async () => {
      if (!cloudEnabled) {
        msg.textContent = 'Google sign-in is temporarily unavailable. You can continue without an account.';
        return;
      }
      btn.disabled = true;
      msg.textContent = 'Connecting to Google…';
      try {
        await signInWithGoogle();
        msg.textContent = 'Redirecting to Google…';
      } catch {
        msg.textContent = 'Could not connect to Google. Please try again.';
        btn.disabled = false;
      }
    };
  };
  if (native) {
    renderGoogleButton(root.querySelector('#gis-btn')).then(() => {
      // Auth events load the account and replace this screen or dialog.
      if (root.isConnected) msg.textContent = 'Signed in. Loading your progress…';
    }).catch(() => useRedirectButton());
  } else {
    useRedirectButton();
  }
}

function renderWelcome() {
  document.querySelector('#app').innerHTML = `
    <main class="welcome">
      <section class="welcome-card" aria-labelledby="welcome-title">
        <span class="welcome-he" lang="he" dir="rtl">שנים מקרא ואחד תרגום</span>
        <h1 id="welcome-title">Shnayim<br>Mikra</h1>
        ${googleSignInMarkup()}
        <button type="button" class="guest-link" id="continue-guest">Continue without an account</button>
      </section>
    </main>
    <div id="dialog-root"></div>
    <div class="sr-only" aria-live="polite" id="announcement"></div>`;
  const root = document.querySelector('.welcome-card');
  // Supabase OAuth lets this button retain the reference design in both themes.
  wireGoogleSignIn(root, { native: false });
  if (signInError) root.querySelector('#auth-msg').textContent = 'Sign-in was not completed. Please try again.';
  document.querySelector('#continue-guest').onclick = () => {
    chooseGuest(true);
    signInError = false;
    render();
    document.querySelector('#account')?.focus({ preventScroll: true });
  };
}

let closeModal = () => {};
function modal(html, label = 'Dialog') {
  closeModal();
  const prev = document.activeElement;
  document.querySelector('#dialog-root').innerHTML = `<div class="scrim"></div><div class="dialog" role="dialog" aria-modal="true" aria-label="${label}"><button class="close" aria-label="Close">×</button>${html}</div>`;
  const box = document.querySelector('.dialog');
  const events = new AbortController();
  let closed = false;
  const close = () => {
    if (closed) return;
    if (box.getAttribute('aria-busy') === 'true') return;
    closed = true;
    events.abort();
    document.querySelector('#dialog-root').innerHTML = '';
    if (label === 'Settings') render();
    if (prev?.isConnected) prev.focus({ preventScroll: true });
    else document.querySelector('#settings')?.focus({ preventScroll: true });
  };
  closeModal = close;
  box.querySelector('.close').onclick = close;
  document.querySelector('.scrim').onclick = close;
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') close();
    if (e.key === 'Tab') {
      const controls = [...box.querySelectorAll('button:not(:disabled):not([hidden]), select:not(:disabled), a[href], input:not(:disabled):not([hidden])')];
      const first = controls[0], last = controls.at(-1);
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
    }
  }, { signal: events.signal });
  const first = box.querySelector('button.primary') || box.querySelector('.gsi-btn:not([hidden])') || box.querySelector('.close');
  if (first) first.focus({ preventScroll: true });
}

function settings() {
  const baseYear = cycleYear(new Date(), data.israel);
  modal(`<div class="settings-header"><h2>Settings</h2></div>
    <div class="settings-body">
    <section class="settings-section" aria-label="Appearance">
    <div class="settings-group appearance-group">
    <div class="theme-options" role="group" aria-label="Theme">
      ${themes.map(theme => `<button type="button" class="theme-option" data-theme-choice="${theme.id}" aria-pressed="${data.theme === theme.id}"><span class="theme-swatch swatch-${theme.id}" aria-hidden="true"></span>${theme.label}</button>`).join('')}
    </div>
    </div>
    </section>
    <section class="settings-section" aria-label="Reading">
    <div class="settings-group">
    <label class="setting-row">Peirush
      <input id="peirush-name" type="text" maxlength="80" placeholder="Rashi" autocomplete="off" dir="auto">
    </label>
    <label class="setting-row">Reading calendar
      <select id="location"><option value="false" ${!data.israel ? 'selected' : ''}>Diaspora</option><option value="true" ${data.israel ? 'selected' : ''}>Israel</option></select>
    </label>
    <label class="setting-row">Cycle
      <select id="cyear">${[baseYear - 1, baseYear, baseYear + 1].map(y => `<option ${y === year ? 'selected' : ''} value="${y}">${y}–${String(y + 1).slice(2)}</option>`).join('')}</select>
    </label>
    </div>
    </section>
    <section class="settings-section" aria-label="Progress">
    <div class="settings-group">
    <button class="settings-action" id="export-progress">Export all progress <svg class="settings-row-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M12 3v12m-4-4 4 4 4-4M5 16v4h14v-4"/></svg></button>
    <button class="settings-action" id="backup-progress">Download JSON backup</button>
    <button class="settings-action" id="restore-progress">Restore JSON backup</button>
    <input type="file" id="backup-file" accept=".json,application/json" hidden>
    ${user ? '<button class="settings-action" id="import-guest">Import guest progress</button>' : ''}
    <button class="settings-action danger" id="delete-progress">Delete all progress</button>
    </div>
    </section>
    <section class="settings-section" aria-label="Account">
    ${user ? '<div class="settings-group"><div class="settings-account-row"><span class="settings-avatar" aria-hidden="true"></span><div><span class="settings-email"></span><span class="settings-account-caption">Signed in</span></div></div><button class="settings-action danger" id="settings-signout">Sign out</button></div>' : cloudEnabled ? '<div class="settings-group"><button class="settings-action" id="settings-signin">Sign in with Google <span class="settings-chevron" aria-hidden="true">›</span></button></div>' : ''}
    </section>
    <p class="dialog-note" id="sync-status" role="status"></p>
    ${user ? '<button class="settings-action" id="retry-sync">Sync now</button>' : ''}
    <p class="dialog-note" id="settings-status" role="status" aria-live="polite"></p>
    </div>
    <button class="primary settings-done" id="save-settings">Done</button>`, 'Settings');
  document.querySelector('.dialog').classList.add('settings-dialog');
  const peirushInput = document.querySelector('#peirush-name');
  peirushInput.value = peirushName(data.peirushName);
  peirushInput.oninput = () => {
    const name = peirushName(peirushInput.value);
    if (name === 'Rashi') delete data.peirushName;
    else data.peirushName = name;
    save();
    document.querySelector('#settings-status').textContent = storageOK ? '' : 'Peirush changed, but browser storage could not save it.';
  };
  if (user) {
    document.querySelector('.settings-email').textContent = user.email || user.id;
    document.querySelector('.settings-avatar').textContent = avatarInitialInner();
  }
  document.querySelectorAll('[data-theme-choice]').forEach(button => button.onclick = () => {
    data.theme = button.dataset.themeChoice;
    applyTheme(); save();
    document.querySelectorAll('[data-theme-choice]').forEach(option => option.setAttribute('aria-pressed', String(option === button)));
    document.querySelector('#settings-status').textContent = storageOK ? '' : 'Theme changed, but browser storage could not save it.';
  });
  const updateReadingSettings = () => {
    data.israel = document.querySelector('#location').value === 'true';
    year = Number(document.querySelector('#cyear').value);
    chosen = null; activeSefer = null;
    save();
  };
  document.querySelector('#location').onchange = updateReadingSettings;
  document.querySelector('#cyear').onchange = updateReadingSettings;
  document.querySelector('#export-progress').onclick = () => exportProgress();
  document.querySelector('#backup-progress').onclick = () => exportProgress(true);
  document.querySelector('#restore-progress').onclick = () => document.querySelector('#backup-file').click();
  document.querySelector('#backup-file').onchange = async event => {
    const file = event.target.files[0];
    if (!file) return;
    const owner = user?.id || null;
    try {
      if (file.size > MAX_BACKUP_BYTES) throw new Error('Backup exceeds the 2 MB limit.');
      const imported = parseBackup(await file.text());
      if ((user?.id || null) !== owner) return;
      previewImport(imported, true);
    } catch (error) { const status = document.querySelector('#settings-status'); if (status) status.textContent = error.message; }
    finally { event.target.value = ''; }
  };
  document.querySelector('#import-guest')?.addEventListener('click', () => {
    try { previewImport(session.guestData(), false); }
    catch { document.querySelector('#settings-status').textContent = 'Guest progress could not be read.'; }
  });
  document.querySelector('#retry-sync')?.addEventListener('click', () => runSettingsAction('Syncing…', async () => {
    await session.refresh();
    document.querySelector('#settings-status').textContent = 'Progress synced.';
  }, 'Could not sync. Pending changes remain on this device.'));
  updateSyncStatus();
  document.querySelector('#delete-progress').onclick = confirmDeleteProgress;
  document.querySelector('#settings-signin')?.addEventListener('click', authDialog);
  document.querySelector('#settings-signout')?.addEventListener('click', () => runSettingsAction('Signing out…', async () => {
    await session.logout();
    document.querySelector('.dialog')?.removeAttribute('aria-busy');
    closeModal(); render(); document.querySelector('#auth-google:not([hidden]), #continue-guest')?.focus({ preventScroll: true });
    announce('Signed out. Account progress stays separate on this device.');
  }, 'Could not sign out. Please try again.'));
  document.querySelector('#save-settings').onclick = () => {
    closeModal();
  };
}

async function runSettingsAction(message, action, failure) {
  const box = document.querySelector('.dialog');
  const status = box.querySelector('#settings-status') || box.querySelector('[role="status"]');
  const controls = [...box.querySelectorAll('button, select, input')];
  box.setAttribute('aria-busy', 'true');
  controls.forEach(control => { control.disabled = true; });
  status.textContent = message;
  try { await action(); }
  catch { status.textContent = failure; }
  finally {
    box.removeAttribute('aria-busy');
    controls.forEach(control => { control.disabled = false; });
  }
}

function download(content, filename, type) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement('a');
  link.href = url; link.download = filename;
  document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function exportProgress(json = false) {
  const owner = user?.id || null;
  return runSettingsAction('Preparing your export…', async () => {
    let cached = false;
    try { await session.refresh(); } catch { cached = true; }
    if ((session.snapshot().user?.id || null) !== owner) throw new Error('Account changed');
    const exported = session.snapshot().data;
    const now = new Date();
    download(json ? createBackup(exported, now) : progressText(exported, fixName, now),
      `shnayim-mikra-progress-${now.toISOString().slice(0, 10)}.${json ? 'json' : 'txt'}`,
      json ? 'application/json' : 'text/plain;charset=utf-8');
    document.querySelector('#settings-status').textContent = cached
      ? 'Exported saved device progress. Cloud changes could not be checked.' : 'Your progress file is ready.';
  }, 'Could not export progress. Please try again.');
}
function previewImport(imported, settingsIncluded) {
  const owner = user?.id || null;
  const summary = backupSummary(imported);
  modal(`<h2>${settingsIncluded ? 'Restore backup?' : 'Import guest progress?'}</h2>
    <p class="dialog-note">${summary.parshiyos} ${summary.parshiyos === 1 ? 'parsha' : 'parshiyos'} with progress, ${summary.completed} completed. Cycles: ${summary.cycles.join(', ') || 'none'}.</p>
    <p class="dialog-note">Checked readings will be added to ${user ? 'your signed-in account' : 'guest progress on this device'}. Existing checkmarks will stay.${settingsIncluded ? ' Calendar, theme, and commentary settings will be restored.' : ' Guest progress will also remain on this device.'}</p>
    <p class="dialog-note" role="status"></p>
    <div class="confirm-actions"><button class="secondary" id="cancel-import">Cancel</button><button class="primary" id="confirm-import">Confirm import</button></div>`, 'Import progress');
  document.querySelector('#cancel-import').focus();
  document.querySelector('#cancel-import').onclick = settings;
  document.querySelector('#confirm-import').onclick = () => runSettingsAction('Importing…', async () => {
    data = session.importData(imported, owner, settingsIncluded);
    applyTheme();
    document.querySelector('.dialog').removeAttribute('aria-busy');
    closeModal(); render(); settings();
    document.querySelector('#settings-status').textContent = 'Progress imported and saved on this device.';
  }, 'Could not import progress. Check browser storage and your account, then try again.');
}
function updateSyncStatus() {
  const element = document.querySelector('#sync-status');
  if (!element) return;
  const { status, user, storageOK } = session.snapshot();
  element.textContent = !storageOK ? 'Browser storage could not save your changes.' : !user ? 'Saved on this device' : ({
    pending: 'Changes saved on this device — sync pending', syncing: 'Syncing…',
    ok: 'Saved to your account', error: 'Could not sync — pending changes remain on this device',
  }[status] || 'Saved on this device');
}

function confirmDeleteProgress() {
  modal(`<h2>Delete all progress?</h2>
    <p class="dialog-note">This clears every reading checkmark from every cycle${user ? ' on this device and in your account' : ' on this device'}. Your settings and account stay. This cannot be undone.</p>
    <p class="dialog-note">You can export a copy from Settings before deleting.</p>
    <p class="dialog-note" id="delete-status" role="status"></p>
    <div class="confirm-actions"><button class="secondary" id="cancel-delete">Cancel</button><button class="danger-button" id="confirm-delete">Delete all progress</button></div>`, 'Delete all progress?');
  document.querySelector('#cancel-delete').focus();
  document.querySelector('#cancel-delete').onclick = settings;
  document.querySelector('#confirm-delete').onclick = () => runSettingsAction('Deleting progress…', async () => {
    await session.clear();
    ({ data, storageOK } = session.snapshot());
    document.querySelector('.dialog').removeAttribute('aria-busy');
    closeModal(); render(); settings();
    document.querySelector('#settings-status').textContent = 'All progress deleted. Your settings are saved.';
  }, user ? 'Could not delete all progress yet. A saved deletion request will retry when connected. Check Sync status in Settings.' : 'Could not delete all progress. Check browser storage, then try again.');
}

session.subscribe((snapshot, { refresh, accountChanged }) => {
  const previousCalendar = data.israel;
  const previousUser = user;
  ({ data, user, storageOK, ready } = snapshot);
  if (user || previousUser) chooseGuest(false);
  applyTheme();
  if (accountChanged) {
    document.querySelector('.dialog')?.removeAttribute('aria-busy');
    closeModal();
    year = cycleYear(new Date(), data.israel); chosen = null; activeSefer = null;
    render();
  } else if (refresh) {
    if (previousCalendar !== data.israel) { year = cycleYear(new Date(), data.israel); chosen = null; activeSefer = null; }
    refreshUnlessDialogOpen();
  }
  updateSyncStatus();
  if (snapshot.status === 'ok') announce('Progress synced.');
});
// Refresh an open app after midnight or returning to it in a new cycle.
let calendarDay = new Date().toDateString();
const refreshCalendar = () => {
  const today = new Date().toDateString();
  if (today === calendarDay) return;
  const oldCycle = cycleYear(new Date(calendarDay), data.israel);
  calendarDay = today;
  if (year === oldCycle) year = cycleYear(new Date(), data.israel);
  refreshUnlessDialogOpen();
};
setInterval(refreshCalendar, 60000);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') refreshCalendar(); });
render();
}
