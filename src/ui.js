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
import { PREFERENCE_KEYS, LIGHT_THEMES, DARK_THEMES, preferences, resolvedTheme } from './preferences.js';
import { REMINDER_DAYS, reminderCalendar } from './reminders.js';
import { themes } from './storage.js';
import { createBackup, parseBackup, backupSummary, MAX_BACKUP_BYTES } from './backup.js';
import { sefarimFor, seferOf, fixName as formatName, titleName as formatTitle, heroName as formatHero, hebrewName } from './names.js';
import { peirushName, progressText } from './progress.js';
import { ALIYAH_NAMES, COMMENTARIES, chosenCommentary, commentarySwapPatch, otherCommentary, readingChecks, readingCount, readingComplete, aliyahField, aliyahSteps, wholeReadingPatch } from './readings.js';
import { morph } from './morph.js';
import { applyGlass } from './glass.js';
import { slideIn, pop, glide, followPointer, haptic, celebrate, reducedMotion } from './motion.js';
import { createReader } from './reader.js';
import { TAB_ICONS } from './tab-icons.js';

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
  const theme = resolvedTheme(data, systemDark.matches);
  document.documentElement.dataset.theme = theme;
  document.documentElement.dataset.textSize = preferences(data).textSize;
  applyGlass(preferences(data).glass, DARK_THEMES.includes(theme));
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content',
    document.documentElement.dataset.screen === 'welcome'
      ? (systemDark.matches ? '#1e1e1e' : '#f5f5f5')
      : themes.find(option => option.id === theme).color);
}
systemDark.addEventListener('change', applyTheme);
applyTheme();

const requestedCheckboxLayout = new URLSearchParams(location.search).get('checkboxes');
document.querySelector('#app').dataset.checkboxLayout = requestedCheckboxLayout === 'left' ? 'left' : 'right';

let year = cycleYear(new Date(), data.israel);
let chosen = null;   // selected parsha id, or null = current week
let activeSefer = null; // selected sefer index (0-4), or null = follow chosen/weekly sefer
const expandedReadings = new Map();
const commentaryPicks = new Map();
let completedFeedback = null, bulkReading = null;
let tab = 'tracker', trackerScroll = 0;
const viewKey = id => `${user?.id || 'guest'}:${year}:${id}`;
const cycleLabel = cycle => `${cycle}–${String(cycle + 1).slice(2)}`;
const titleName = names => formatTitle(names, data.naming);
const heroName = names => formatHero(names, data.naming);
const readingLabel = reading => ({ mikra1: 'Mikra I', mikra2: 'Mikra II', onkelos: 'Targum', rashi: peirushName(data.peirushName) }[reading]);
const reader = createReader({
  escapeHtml, readingLabel,
  data: () => data,
  owner: () => user?.id || null,
  year: () => year,
  tab: () => tab,
  progress: id => state(id),
  save: (id, patch) => setProgress(id, patch),
  commentaryOf: id => commentaryOf(id),
  select(id) { chosen = id; activeSefer = seferOf(id); completedFeedback = null; },
  render: () => render(),
  refresh: () => refreshUnlessDialogOpen(),
  announce: message => announce(message),
});
// A reload puts someone who was reading back in the reader. A fresh launch opens the tracker.
function resumeReader() {
  const saved = reader.resume(user?.id);
  if (!saved || Math.abs(saved.year - cycleYear(new Date(), data.israel)) > 1) { reader.forget(); return; }
  year = saved.year; chosen = saved.id; activeSefer = seferOf(saved.id);
  tab = 'chumash';
}
const pickKey = id => `commentary-pick:${viewKey(id)}`;
// Covers a parsha switched before anything is checked. Once there are checks, they decide.
function pickedCommentary(id) {
  let saved;
  try { saved = localStorage.getItem(pickKey(id)); } catch { /* Falls back to this page's memory. */ }
  return COMMENTARIES.includes(saved) ? saved : commentaryPicks.get(pickKey(id));
}
function pickCommentary(id, commentary) {
  commentaryPicks.set(pickKey(id), commentary);
  try { localStorage.setItem(pickKey(id), commentary); } catch { /* Optional; lasts until reload. */ }
}
function clearCommentaryPicks() {
  const prefix = `commentary-pick:${user?.id || 'guest'}:`;
  for (const key of commentaryPicks.keys()) if (key.startsWith(prefix)) commentaryPicks.delete(key);
  try {
    for (const key of Object.keys(localStorage)) if (key.startsWith(prefix)) localStorage.removeItem(key);
  } catch { /* Nothing was saved. */ }
}
const commentaryOf = id => chosenCommentary(state(id), pickedCommentary(id) || data.commentary);

function readingDetail(id) {
  const progress = state(id);
  const reading = ['mikra1', 'mikra2', commentaryOf(id)].find(key => {
    const count = readingCount(progress, key);
    return count > 0 && count < 7;
  });
  return reading ? `${readingLabel(reading)}: ${readingCount(progress, reading)} of 7 aliyos` : '';
}


const check = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" aria-hidden="true"><path d="m5 12 5 5 9-10"/></svg>';
// Always in the DOM so that checking and unchecking can both animate.
const tick = '<svg class="tick" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" aria-hidden="true"><path pathLength="1" d="m5 12 5 5 9-10"/></svg>';
const chevron = '<svg class="chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 5 7 7-7 7"/></svg>';
const TABS = [
  { id: 'tracker', label: 'Tracker', icon: TAB_ICONS.tracker },
  { id: 'chumash', label: 'Chumash', icon: TAB_ICONS.chumash },
  { id: 'settings', label: 'Settings', icon: TAB_ICONS.settings },
  { id: 'account', label: 'Account', icon: TAB_ICONS.account },
];


const all = () => schedule(year, data.israel);
const state = id => data.progress[`${year}:${id}`] || {};
function save() {
  try { data = session.settings({ israel: data.israel, commentary: data.commentary, theme: data.theme, peirushName: data.peirushName, ...Object.fromEntries(PREFERENCE_KEYS.filter(key => Object.hasOwn(data, key)).map(key => [key, data[key]])) }); }
  catch { /* The storage warning stays visible; no unsaved write is sent. */ }
}
function setProgress(id, patch) {
  try { data = session.reading(`${year}:${id}`, patch); return true; }
  catch { announce('Progress could not be saved. Check browser storage.'); return false; }
}

function announce(msg) {
  const el = document.querySelector('#announcement');
  if (el) el.textContent = msg;
}

function refreshUnlessDialogOpen() {
  if (document.querySelector('#dialog-root .dialog, main[aria-busy="true"]')) return;
  const focused = document.activeElement;
  const selector = focused?.id ? `#${CSS.escape(focused.id)}`
    : ['reading', 'parsha', 'seferTab'].map(key => focused?.dataset[key] !== undefined
      ? `[data-${key.replace(/[A-Z]/g, char => `-${char.toLowerCase()}`)}="${CSS.escape(focused.dataset[key])}"]` : '').find(Boolean);
  render();
  if (selector) document.querySelector(selector)?.focus({ preventScroll: true });
}

function readingRow(reading, item, progress, expanded) {
  const count = readingCount(progress, reading);
  const label = escapeHtml(readingLabel(reading));
  const status = count === 7 ? 'Complete' : count ? `${count} of 7 aliyos` : 'Not started';
  const checked = count === 7 ? 'true' : count ? 'mixed' : 'false';
  const open = expanded.has(reading);
  const name = escapeHtml(titleName(item.names));
  const checks = readingChecks(progress, reading);
  const switcher = COMMENTARIES.includes(reading)
    ? `<button type="button" id="switch-commentary" class="text-action switch-commentary">Switch to ${escapeHtml(readingLabel(otherCommentary(reading)))} for this parsha</button>`
    : '';
  const heading = `<span class="rlabel"><span class="reading-name">${label}</span><span class="reading-meta"><span class="beads" aria-hidden="true">${checks.map((on, index) => `<i class="${on ? 'on' : ''}" style="--i:${index}"></i>`).join('')}</span><span class="reading-count">${status}</span></span></span>`;
  return `<li class="reading-block${open ? ' open' : ''}${count === 7 ? ' complete' : ''}${bulkReading === reading ? ' bulk' : ''}" data-key="block-${reading}">
    <div class="readingstep" data-reading-row="${reading}">
      <button id="expand-${reading}" type="button" class="expand-reading" data-expand="${reading}" aria-expanded="${open}" aria-controls="aliyos-${reading}" aria-label="${open ? 'Hide' : 'Show'} ${label} aliyos, ${status}">${chevron}${heading}</button>
      <button id="reading-${reading}" type="button" class="reading-check" data-reading="${reading}" role="checkbox" aria-checked="${checked}" aria-label="${name}, ${label}, ${status}. ${count === 7 ? 'Clear' : 'Mark'} all seven aliyos">
        <span class="rcheck${count === 7 ? ' on' : ''}${count && count < 7 ? ' mixed' : ''}" aria-hidden="true">${tick}<i class="dash"></i></span>
      </button>
    </div>
    <div id="aliyos-${reading}" class="aliyah-panel">
      <div class="aliyah-clip">
        <ol class="aliyah-list" aria-label="${label} aliyos">
          ${checks.map((on, index) => `<li style="--i:${index}"><button id="aliyah-${reading}-${index}" type="button" class="readrow aliyah-choice${on ? ' on' : ''}" data-aliyah="${reading}:${index}" role="checkbox" aria-checked="${on}" aria-label="${name}, ${label}, ${ALIYAH_NAMES[index]}"><span class="rlabel">${ALIYAH_NAMES[index]}</span><span class="rcheck${on ? ' on' : ''}" aria-hidden="true">${tick}</span></button></li>`).join('')}
        </ol>
        ${switcher}
      </div>
    </div>
  </li>`;
}

// One bar per reading, so progress stays visible while every checklist is folded.
function parshaMeter(progress, commentary) {
  const readings = ['mikra1', 'mikra2', commentary];
  return `<div class="parsha-meter" role="img" aria-label="${steps(progress)} of 3 complete">${readings.map(reading =>
    `<span><i style="width:${Math.round((readingCount(progress, reading) / 7) * 100)}%"></i></span>`).join('')}</div>`;
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
  const SEFARIM = sefarimFor(data.naming);
  const rows = all();
  if (tab !== 'tracker') {
    renderPanel(rows);
    return;
  }
  const thisCycle = cycleYear(new Date(), data.israel);
  const inThisCycle = year === thisCycle;
  const weekly = currentParsha(rows);
  const weeklyRows = rows.filter(r => r.date.getTime() === weekly.date.getTime());
  const weeklyNames = weeklyRows.flatMap(r => r.names);
  const weeklyTotal = weeklyRows.length * 3;
  const item = rows.find(r => r.id === chosen) || weekly;
  const isDoubleWeek = rows.some(row => row.id !== item.id && row.date.getTime() === item.date.getTime());
  const p = state(item.id);
  const commentary = commentaryOf(item.id);
  const key = viewKey(item.id);
  // Everything starts folded; only the person reading decides what to open.
  if (!expandedReadings.has(key)) expandedReadings.set(key, new Set());
  const expanded = expandedReadings.get(key);
  const offWeek = !weeklyRows.some(row => row.id === item.id);
  const celebrating = completedFeedback === key && complete(p);
  const done = rows.filter(r => complete(state(r.id))).length;
  const weeklySteps = weeklyRows.reduce((sum, r) => sum + steps(state(r.id)), 0);
  const itemSefer = seferOf(item.id);
  const viewSefer = activeSefer !== null ? activeSefer : itemSefer;
  const seferRows = rows.filter(r => seferOf(r.id) === viewSefer);
  const seferDone = seferRows.filter(r => complete(state(r.id))).length;

  const upcomingShabbos = localShabbosDate(weekly.date);
  // "This week" and a countdown only mean something inside the cycle happening now.
  const summary = inThisCycle
    ? { title: 'Upcoming Shabbos', main: shabbosCountdown(upcomingShabbos), detail: formatGregorianDate(upcomingShabbos) }
    : year < thisCycle
      ? { title: 'Past cycle', main: cycleLabel(year), detail: `Ended ${formatGregorianDate(localShabbosDate(rows.at(-1).date), true)}` }
      : { title: 'Future cycle', main: cycleLabel(year), detail: `Begins ${formatGregorianDate(localShabbosDate(rows[0].date), true)}` };

  const counters = ['.weeklyprogress .progressvalue', '.yearprogress .progressvalue', '.cyccount'];
  const previousCounts = counters.map(selector => document.querySelector(selector)?.textContent);

  morph(document.querySelector('#app'), shell('#reading', 'Skip to progress', `
    <main data-key="tracker">
      <header class="titlerow" data-key="titlerow">
        <h1${data.naming === 'hebrew' ? ' lang="he" dir="rtl"' : ''}>${heroName(item.names)}</h1>
        ${data.naming === 'hebrew' ? '' : `<span class="he" lang="he" dir="rtl">${hebrewName(item.names)}</span>`}
      </header>
      ${offWeek || !inThisCycle ? `<p class="browsing" data-key="browsing"><span>Shabbos of ${formatGregorianDate(localShabbosDate(item.date), !inThisCycle)}</span>${inThisCycle ? '<button type="button" id="back-to-week" class="text-action">Back to this week</button>' : ''}</p>` : ''}

      <div class="cards">
        <section class="card${celebrating ? ' celebrate' : ''}" id="reading" aria-label="Shnayim Mikra for ${titleName(item.names)}">
          <div class="reading-card-heading"><h2>Progress</h2><span>${steps(p)} of 3</span></div>
          ${parshaMeter(p, commentary)}
          ${isDoubleWeek ? '<p class="aliyah-note">Aliyos follow each parsha separately.</p>' : ''}
          <ol class="reads">
            ${readingRow('mikra1', item, p, expanded)}
            ${readingRow('mikra2', item, p, expanded)}
            ${readingRow(commentary, item, p, expanded)}
          </ol>
          <div class="completion-wrap${celebrating ? ' show' : ''}"><p class="completion-feedback" role="status">${celebrating ? `${check}<span>Yasher koach! Parsha complete.</span>` : ''}</p></div>
        </section>

        <div class="sidecol">
          <section class="card yearly" aria-label="Yearly progress">
            ${inThisCycle ? `<div class="weeklyprogress" aria-label="This week's progress">
              <div class="progressheading"><h2 class="kicker">This week</h2><p class="progressvalue">${weeklySteps}<span> / ${weeklyTotal}</span></p></div>
              <div class="weeksegments" style="--weekly-steps:${weeklyTotal}" role="img" aria-label="${weeklySteps} of ${weeklyTotal} completed for ${titleName(weeklyNames)}">${Array.from({ length: weeklyTotal }, (_, i) => `<span class="${weeklySteps > i ? 'filled' : ''}"></span>`).join('')}</div>
              <p class="bigsub">${titleName(weeklyNames)}</p>
              ${weeklyRows.map(row => {
                const detail = readingDetail(row.id);
                return detail ? `<p class="weekly-detail">${weeklyRows.length > 1 ? `${titleName(row.names)}: ` : ''}${escapeHtml(detail)}</p>` : '';
              }).join('')}
            </div>` : ''}
            <div class="yearprogress">
              <div class="progressheading"><h2 class="kicker">${inThisCycle ? 'This year' : 'This cycle'}</h2><p class="progressvalue bignum">${done}<span> / ${rows.length}</span></p></div>
              <div class="bar" role="img" aria-label="${done} of ${rows.length} parshiyos completed"><div style="width:${rows.length ? Math.round((done / rows.length) * 100) : 0}%"></div></div>
              <p class="bigsub">Parshiyos completed</p>
            </div>
          </section>

          <section class="card shabbos" aria-label="${summary.title}">
            <h2 class="kicker">${summary.title}</h2>
            <p class="shabbos-count">${summary.main}</p>
            <p class="shabbos-date">${summary.detail}</p>
          </section>
        </div>
      </div>

      <section class="card cycle" aria-label="The yearly cycle">
        <nav class="sefertabs" aria-label="Torah Books" style="--active:${viewSefer}">
          <span class="tabpill" aria-hidden="true"></span>
          ${SEFARIM.map((s, i) => {
            const isCurrent = i === viewSefer;
            const sRows = rows.filter(r => seferOf(r.id) === i);
            const sDone = sRows.filter(r => complete(state(r.id))).length;
            return `<button type="button" class="sefertab${isCurrent ? ' active' : ''}"${data.naming === 'hebrew' ? ' lang="he"' : ''} data-sefer-tab="${i}" aria-pressed="${isCurrent}" aria-label="${s.en}, ${sDone} of ${sRows.length} completed">
              ${s.en}
            </button>`;
          }).join('')}
        </nav>

        <div class="cyclesub">
          <h2 class="cycname"${data.naming === 'hebrew' ? ' lang="he" dir="rtl"' : ''}>${data.naming === 'hebrew' ? 'ספר' : 'Sefer'} ${SEFARIM[viewSefer].en}</h2>
          <span class="cyccount">${seferDone}/${seferRows.length}</span>
        </div>

        <ol class="parshalist" aria-label="Parshiyos in ${SEFARIM[viewSefer].en}">
          ${seferRows.map((r, i) => {
            const s = state(r.id);
            const isDone = complete(s);
            const isCur = inThisCycle && weeklyRows.some(w => w.id === r.id);
            const isSel = r.id === item.id;
            const numSteps = steps(s);
            const fraction = aliyahSteps(s) / 21;
            const isPartial = fraction > 0 && !isDone;
            const st = isDone ? 'Completed' : isPartial ? `${numSteps} of 3 done, ${readingDetail(r.id) || 'In progress'}` : 'Not started';
            return `<li>
              <button type="button" class="parsharow${isDone ? ' done' : ''}${isCur ? ' current' : ''}${isSel ? ' selected' : ''}" data-parsha="${r.id}" aria-label="${titleName(r.names)}, ${escapeHtml(st)}${isCur ? ', current parsha' : ''}${isSel ? ', selected' : ''}" aria-pressed="${isSel}" ${isCur ? 'aria-current="true"' : ''}>
                <span class="parshanum" aria-hidden="true">${i + 1}</span>
                <span class="parshaen"${data.naming === 'hebrew' ? ' lang="he" dir="rtl"' : ''}>${titleName(r.names)}</span>
                <span class="parshastatus">${isCur ? '<span class="current-dot" aria-hidden="true"></span>' : ''}${isPartial ? numSteps ? `${numSteps}/3` : 'In progress' : isCur ? 'Current' : ''}</span>
                <span class="statusring ${isDone ? 'complete' : isPartial ? 'partial' : 'empty'}" style="--progress:${fraction * 100}%" aria-hidden="true">${isDone ? check : ''}</span>
              </button>
            </li>`;
          }).join('')}
        </ol>

      </section>

      ${storageOK ? '' : '<footer><span class="warn">Progress could not be saved. Check browser storage.</span></footer>'}
    </main>`));

  counters.forEach((selector, index) => {
    const counter = document.querySelector(selector);
    if (previousCounts[index] !== undefined && counter?.textContent !== previousCounts[index]) pop(counter);
  });
  wire(rows, item);
  if (!user && signInError) {
    signInError = false;
    authDialog();
    const msg = document.querySelector('#auth-msg');
    if (msg) msg.textContent = 'Sign-in was not completed. Please try again.';
  }
}

// The bar stays in one place in the markup, so its lens can slide between tabs.
function shell(skipTarget, skipLabel, content) {
  return `
  <a class="skip" href="${skipTarget}">${skipLabel}</a>
  <div class="page">
    <header class="topbar"><span class="brand">Shnayim Mikra</span></header>
    ${content}
  </div>
  ${tabBar()}
  <div id="dialog-root"></div>
  <div class="sr-only" aria-live="polite" id="announcement"></div>`;
}

function tabBar() {
  const active = TABS.findIndex(({ id }) => id === tab);
  return `<nav class="tabbar" aria-label="Main" style="--active:${active}">
    <span class="glass-rim" aria-hidden="true"></span>
    <span class="tablens" aria-hidden="true"></span>
    <span class="tabglint" aria-hidden="true"></span>
    <span class="glass-edge" aria-hidden="true"></span>
    ${TABS.map(({ id, label, icon }) => {
      const signedIn = id === 'account' && user;
      const name = ` aria-label="${escapeHtml(signedIn ? `Account, ${user.email || 'signed in'}` : label)}"`;
      const glyph = signedIn ? `<span class="tab-avatar" aria-hidden="true">${escapeHtml(avatarInitial())}</span>` : icon;
      return `<button type="button" class="tab" id="${id}" data-tab="${id}"${name}${id === tab ? ' aria-current="page"' : ''}>${glyph}</button>`;
    }).join('')}
  </nav>`;
}

function wireTabs() {
  document.querySelectorAll('[data-tab]').forEach(button => button.onclick = () => setTab(button.dataset.tab));
  const bar = document.querySelector('.tabbar');
  bar.onpointermove = bar.onpointerdown = event => followPointer(bar, event);
  // iOS Safari only applies :active inside an element with a touch listener.
  bar.ontouchstart = () => {};
}

function setTab(next) {
  if (document.querySelector('main[aria-busy="true"]')) return;
  if (next === tab) {
    window.scrollTo({ top: 0, behavior: reducedMotion() ? 'instant' : 'smooth' });
    return;
  }
  const order = id => TABS.findIndex(entry => entry.id === id);
  const previous = order(tab);
  const direction = Math.sign(order(next) - previous);
  if (tab === 'tracker') trackerScroll = window.scrollY;
  if (tab === 'chumash') reader.left();
  document.querySelector('#settings-status')?.replaceChildren();
  tab = next;
  render();
  document.getElementById(next).focus({ preventScroll: true });
  window.scrollTo({ top: next === 'tracker' ? trackerScroll : 0, behavior: 'instant' });
  if (next === 'chumash') reader.entered();
  slideIn([document.querySelector('main')], direction);
  glide(document.querySelector('.tablens'), previous, order(next));
  announce(`${TABS[order(next)].label} tab`);
}

function renderPanel(rows) {
  const status = document.querySelector('#settings-status')?.textContent;
  const content = { chumash: () => chumashPanel(rows), settings: settingsPanel, account: accountPanel }[tab]();
  morph(document.querySelector('#app'), shell(`#panel-${tab}`, 'Skip to content', `<main id="panel-${tab}" class="settings-view${tab === 'chumash' ? ' reader-view' : ''}">${content}</main>`));
  wireTabs();
  if (tab === 'chumash') reader.wire();
  if (tab === 'settings') wireSettings();
  if (tab === 'account') wireAccount();
  const statusLine = document.querySelector('#settings-status');
  // A background sync re-renders the page; a message about the last action outlives it.
  if (status && statusLine) statusLine.textContent = status;
  updateSyncStatus();
}

function chumashPanel(rows) {
  return reader.panel(rows, rows.find(row => row.id === chosen) || currentParsha(rows));
}

function wire(rows, item) {
  wireTabs();
  const order = id => rows.findIndex(row => row.id === id);
  document.querySelectorAll('[data-sefer-tab]').forEach(b => b.onclick = () => {
    const previous = activeSefer ?? seferOf(item.id);
    activeSefer = Number(b.dataset.seferTab);
    render();
    document.querySelector(`[data-sefer-tab="${activeSefer}"]`).focus({ preventScroll: true });
    if (activeSefer !== previous) slideIn([document.querySelector('.parshalist')], Math.sign(activeSefer - previous));
  });
  document.querySelectorAll('[data-parsha]').forEach(b => b.onclick = () => {
    const rowTop = b.getBoundingClientRect().top;
    const direction = Math.sign(order(b.dataset.parsha) - order(item.id));
    chosen = b.dataset.parsha;
    activeSefer = seferOf(chosen);
    completedFeedback = null;
    render();
    const selected = document.querySelector('.parsharow.selected');
    selected.focus({ preventScroll: true });
    // Keep the clicked row in place when the new parsha heading wraps.
    const offset = selected.getBoundingClientRect().top - rowTop;
    window.scrollTo({ top: window.scrollY + offset, behavior: 'instant' });
    if (direction) slideIn([document.querySelector('.titlerow'), document.querySelector('#reading')], direction);
    announce(`${titleName(rows.find(r => r.id === chosen).names)} selected`);
  });
  const backToWeek = document.querySelector('#back-to-week');
  if (backToWeek) backToWeek.onclick = () => {
    const week = currentParsha(rows);
    const direction = Math.sign(order(week.id) - order(item.id));
    chosen = null; activeSefer = null; completedFeedback = null;
    render();
    document.querySelector('.parsharow.selected')?.focus({ preventScroll: true });
    slideIn([document.querySelector('.titlerow'), document.querySelector('#reading')], direction);
    announce(`Back to ${titleName(week.names)}`);
  };

  function updateReading(reading, patch, focusId, bulk = false) {
    const before = readingChecks(state(item.id), reading);
    const wasComplete = complete(state(item.id));
    if (!setProgress(item.id, patch)) {
      render();
      document.getElementById(focusId)?.focus({ preventScroll: true });
      announce('Progress could not be saved. Check browser storage.');
      return;
    }
    if (COMMENTARIES.includes(reading)) pickCommentary(item.id, reading);
    completedFeedback = !wasComplete && complete(state(item.id)) ? viewKey(item.id) : null;
    bulkReading = bulk ? reading : null;
    render();
    bulkReading = null;
    const control = document.getElementById(focusId);
    control?.focus({ preventScroll: true });
    if (readingCount(state(item.id), reading) > before.filter(Boolean).length) {
      pop(control?.querySelector('.rcheck'));
      if (preferences(data).vibration) haptic(6);
    }
    if (completedFeedback) {
      if (preferences(data).confetti) celebrate(document.querySelector('.parsha-meter'));
      if (preferences(data).vibration) haptic([12, 50, 24]);
    }
    announce(`${readingLabel(reading)}, ${readingCount(state(item.id), reading)} of 7 aliyos. ${titleName(item.names)}${complete(state(item.id)) ? ' complete' : `, ${steps(state(item.id))} of 3 complete`}.`);
  }

  document.querySelectorAll('[data-expand]').forEach(button => button.onclick = () => {
    if (button.disabled) return;
    const reading = button.dataset.expand;
    const expanded = expandedReadings.get(viewKey(item.id));
    if (expanded.has(reading)) expanded.delete(reading);
    else expanded.add(reading);
    render();
    document.getElementById(`expand-${reading}`).focus({ preventScroll: true });
  });
  document.querySelectorAll('button[data-reading]').forEach(button => button.onclick = () => {
    if (button.disabled) return;
    const reading = button.dataset.reading;
    updateReading(reading, wholeReadingPatch(reading, !readingComplete(state(item.id), reading)), button.id, true);
  });
  document.querySelectorAll('[data-aliyah]').forEach(button => button.onclick = () => {
    if (button.disabled) return;
    const [reading, value] = button.dataset.aliyah.split(':');
    const index = Number(value);
    updateReading(reading, { [aliyahField(reading, index)]: !readingChecks(state(item.id), reading)[index] }, button.id);
  });
  const switchCommentary = document.querySelector('#switch-commentary');
  if (switchCommentary) switchCommentary.onclick = () => {
    const current = commentaryOf(item.id), next = otherCommentary(current);
    pickCommentary(item.id, next);
    if (!setProgress(item.id, commentarySwapPatch(state(item.id), current, next))) {
      pickCommentary(item.id, current);
      return;
    }
    const expanded = expandedReadings.get(viewKey(item.id));
    if (expanded.delete(current)) expanded.add(next);
    render();
    document.querySelector('#switch-commentary')?.focus({ preventScroll: true });
    announce(`Using ${readingLabel(next)} for ${titleName(item.names)}.`);
  };
}

function avatarInitial() {
  const src = user?.email || user?.user_metadata?.name || '•';
  return String(src).trim().charAt(0).toUpperCase() || '•';
}

function authDialog() {
  if (!cloudEnabled) {
    modal(`<h2>Sign in</h2>
      <p class="dialog-note">Sign-in is unavailable. Your progress is saved on this device.</p>
      <button class="primary" id="auth-close">Done</button>`, 'Sign in');
    document.querySelector('#auth-close').onclick = () => closeModal();
    return;
  }
  modal(`<h2>Keep your progress with you</h2>
    <p class="dialog-note">Sign in with Google to save your progress and pick up on any device.</p>
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
    document.querySelector('#tracker')?.focus({ preventScroll: true });
  };
}

// Fades out an inert copy, so the real dialog can close synchronously.
function dialogExit() {
  if (reducedMotion()) return;
  const root = document.querySelector('#dialog-root');
  const copy = root.cloneNode(true);
  copy.removeAttribute('id');
  copy.className = 'dialog-exit';
  copy.setAttribute('aria-hidden', 'true');
  copy.inert = true;
  copy.querySelectorAll('[id], [role]').forEach(element => { element.removeAttribute('id'); element.removeAttribute('role'); });
  copy.querySelector('.dialog').classList.replace('dialog', 'dialog-leaving');
  document.body.append(copy);
  setTimeout(() => copy.remove(), 200);
}

let closeModal = () => {};
function modal(html, label = 'Dialog') {
  closeModal({ instant: true });
  const prev = document.activeElement;
  document.querySelector('#dialog-root').innerHTML = `<div class="scrim"></div><div class="dialog" role="dialog" aria-modal="true" aria-label="${label}"><button class="close" aria-label="Close">×</button>${html}</div>`;
  const box = document.querySelector('.dialog');
  const events = new AbortController();
  let closed = false;
  const close = ({ instant = false } = {}) => {
    if (closed) return;
    if (box.getAttribute('aria-busy') === 'true') return;
    closed = true;
    events.abort();
    if (!instant) dialogExit();
    document.querySelector('#dialog-root').innerHTML = '';
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

function settingsPanel() {
  const baseYear = cycleYear(new Date(), data.israel);
  const prefs = preferences(data);
  // SVG rather than a CSS gradient: hard gradient stops are not antialiased, so the diagonal looks jagged.
  const themeSwatch = theme => `<svg class="theme-swatch swatch-${theme.id}" viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="9.5"/><path d="M16.72 3.28A9.5 9.5 0 0 1 3.28 16.72Z"/><circle class="swatch-ring" cx="10" cy="10" r="9.5"/></svg>`;
  const themeChoices = ids => themes.filter(theme => ids.includes(theme.id)).map(theme => `<option value="${theme.id}">${theme.label}</option>`).join('');
  return `<header class="titlerow"><h1>Settings</h1></header>
    <div class="settings-body">
    <section class="settings-section" aria-label="Appearance">
    <div class="settings-group">
    <label class="setting-row">Follow device appearance
      <input id="follow-device" type="checkbox" role="switch" ${prefs.followDevice ? 'checked' : ''}>
    </label>
    ${prefs.followDevice ? `<label class="setting-row">Light theme<select id="light-theme">${themeChoices(LIGHT_THEMES)}</select></label>
    <label class="setting-row">Dark theme<select id="dark-theme">${themeChoices(DARK_THEMES)}</select></label>` : `<div class="appearance-group">
    <div class="theme-options" role="group" aria-label="Theme">
      ${themes.map(theme => `<button type="button" class="theme-option" data-theme-choice="${theme.id}" aria-pressed="${data.theme === theme.id}">${themeSwatch(theme)}${theme.label}</button>`).join('')}
    </div></div>`}
    <label class="setting-row">Text size<select id="text-size"><option value="standard">Standard</option><option value="larger">Larger</option></select></label>
    <label class="setting-row glass-setting">Tab bar glass
      <span class="glass-slider"><span aria-hidden="true">Opaque</span><input id="glass-level" type="range" min="0" max="100" step="1"><span aria-hidden="true">Very glassy</span></span>
    </label>
    </div>
    ${matchMedia('(prefers-reduced-transparency: reduce)').matches ? '<p class="dialog-note">Your device’s reduced transparency setting keeps the tab bar opaque.</p>' : ''}
    </section>
    <section class="settings-section" aria-label="Learning">
    <div class="settings-group">
    <label class="setting-row">After Mikra
      <select id="default-commentary"><option value="onkelos">${readingLabel('onkelos')}</option><option value="rashi">${escapeHtml(readingLabel('rashi'))}</option></select>
    </label>
    <label class="setting-row">Peirush
      <input id="peirush-name" type="text" maxlength="80" placeholder="Rashi" autocomplete="off" dir="auto">
    </label>
    <label class="setting-row">Chumash opening mode
      <select id="default-reader-mode"><option value="last-used">Last used</option><option value="cards">Cards</option><option value="flow">Flow</option><option value="classic">Classic</option></select>
    </label>
    <label class="setting-row">Parsha calendar
      <select id="location"><option value="false">Diaspora</option><option value="true">Israel</option></select>
    </label>
    <label class="setting-row">Parsha names
      <select id="parsha-naming"><option value="ashkenazi">Ashkenazi</option><option value="sephardi">Sephardi</option><option value="hebrew">Hebrew</option></select>
    </label>
    <label class="setting-row">Cycle
      <select id="cyear">${[baseYear - 1, baseYear, baseYear + 1].map(y => `<option value="${y}">${cycleLabel(y)}</option>`).join('')}</select>
    </label>
    </div>
    </section>
    <section class="settings-section" aria-label="Completion effects">
    <div class="settings-group">
    <label class="setting-row">Completion confetti<input id="completion-confetti" type="checkbox" role="switch" ${prefs.confetti ? 'checked' : ''}></label>
    <label class="setting-row">Vibration<input id="completion-vibration" type="checkbox" role="switch" ${prefs.vibration ? 'checked' : ''}></label>
    </div>
    <p class="dialog-note">Effects respect your device’s reduced motion setting. Vibration works on supported devices.</p>
    </section>
    <section class="settings-section" aria-label="Reminders">
    <div class="settings-group">
    <fieldset class="reminder-days"><legend>Reminder days</legend>
    <div class="day-options">${REMINDER_DAYS.map(([, label], day) => `<button type="button" class="reminder-day" data-reminder-day="${day}" aria-label="${label}" aria-pressed="${prefs.reminderDays.includes(day)}">${label.slice(0, 2)}</button>`).join('')}</div>
    </fieldset>
    <label class="setting-row">Reminder time<input id="reminder-time" type="time" value="${prefs.reminderTime}" required></label>
    <button class="settings-action" id="download-reminders" ${prefs.reminderDays.length ? '' : 'disabled'}>Add reminders to calendar</button>
    </div>
    <p class="dialog-note">Choose days and a local time, then import the downloaded file into your calendar. Allow calendar alerts to receive reminders while this app is closed. To change or stop imported reminders, edit or delete the recurring event in your calendar.</p>
    </section>
    <section class="settings-section" aria-label="Progress">
    <div class="settings-group">
    <button class="settings-action" id="export-progress">Export all progress <svg class="settings-row-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M12 3v12m-4-4 4 4 4-4M5 16v4h14v-4"/></svg></button>
    <button class="settings-action" id="backup-progress">Download JSON backup</button>
    <button class="settings-action" id="restore-progress">Restore JSON backup</button>
    <input type="file" id="backup-file" accept=".json,application/json" hidden>
    <button class="settings-action danger" id="delete-progress">Delete all progress</button>
    </div>
    </section>
    <p class="dialog-note" id="settings-status" role="status" aria-live="polite"></p>
    </div>`;
}

function wireSettings() {
  const prefs = preferences(data);
  function savePreference(key, value, rerender = false) {
    data[key] = value;
    save(); applyTheme();
    if (rerender) render();
    document.querySelector('#settings-status').textContent = storageOK ? '' : 'Preference changed, but browser storage could not save it.';
  }
  const glassLevel = document.querySelector('#glass-level');
  // A background render can't pull the thumb out from under a drag.
  if (document.activeElement !== glassLevel) glassLevel.value = prefs.glass;
  glassLevel.oninput = () => { data.glass = glassLevel.valueAsNumber; applyTheme(); };
  glassLevel.onchange = () => savePreference('glass', glassLevel.valueAsNumber);
  document.querySelector('#follow-device').onchange = event => {
    savePreference('followDevice', event.target.checked, true);
    document.querySelector('#follow-device').focus({ preventScroll: true });
  };
  for (const [id, key] of [['light-theme', 'lightTheme'], ['dark-theme', 'darkTheme'], ['text-size', 'textSize'], ['parsha-naming', 'naming'], ['default-reader-mode', 'defaultReaderMode']]) {
    const control = document.getElementById(id);
    if (!control) continue;
    control.value = prefs[key];
    control.onchange = () => savePreference(key, control.value);
  }
  for (const [id, key] of [['completion-confetti', 'confetti'], ['completion-vibration', 'vibration']]) {
    document.getElementById(id).onchange = event => savePreference(key, event.target.checked);
  }
  document.querySelectorAll('[data-reminder-day]').forEach(button => button.onclick = () => {
    const days = new Set(preferences(data).reminderDays), day = Number(button.dataset.reminderDay);
    if (days.has(day)) days.delete(day); else days.add(day);
    savePreference('reminderDays', [...days].sort());
    button.setAttribute('aria-pressed', String(days.has(day)));
    document.querySelector('#download-reminders').disabled = !days.size;
  });
  const reminderTime = document.querySelector('#reminder-time');
  reminderTime.onchange = () => {
    if (reminderTime.checkValidity()) savePreference('reminderTime', reminderTime.value);
    else { reminderTime.value = preferences(data).reminderTime; announce('Choose a valid reminder time.'); }
  };
  document.querySelector('#download-reminders').onclick = () => {
    try {
      download(reminderCalendar(preferences(data), new Date(), location.origin + location.pathname), 'shnayim-mikra-reminders.ics', 'text/calendar;charset=utf-8');
      document.querySelector('#settings-status').textContent = 'Reminder file ready. Import it into your calendar and allow alerts. Manage imported reminders in your calendar.';
    } catch (error) { document.querySelector('#settings-status').textContent = error.message; }
  };
  const peirushInput = document.querySelector('#peirush-name');
  if (document.activeElement !== peirushInput) peirushInput.value = peirushName(data.peirushName);
  peirushInput.oninput = () => {
    const name = peirushName(peirushInput.value);
    if (name === 'Rashi') delete data.peirushName;
    else data.peirushName = name;
    save();
    document.querySelector('#default-commentary option[value="rashi"]').textContent = name;
    document.querySelector('#settings-status').textContent = storageOK ? '' : 'Peirush changed, but browser storage could not save it.';
  };
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
  const defaultCommentary = document.querySelector('#default-commentary');
  defaultCommentary.value = data.commentary;
  defaultCommentary.onchange = () => {
    data.commentary = defaultCommentary.value;
    save();
    document.querySelector('#settings-status').textContent = storageOK ? '' : 'Default changed, but browser storage could not save it.';
  };
  const location = document.querySelector('#location'), cycle = document.querySelector('#cyear');
  // Set directly: a re-render can't update a select the user has already changed.
  location.value = String(data.israel);
  cycle.value = String(year);
  location.onchange = updateReadingSettings;
  cycle.onchange = updateReadingSettings;
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
  document.querySelector('#delete-progress').onclick = confirmDeleteProgress;
}

function accountPanel() {
  const identity = user
    ? `<div class="settings-group"><div class="settings-account-row"><span class="settings-avatar" aria-hidden="true">${escapeHtml(avatarInitial())}</span><div><span class="settings-email">${escapeHtml(user.email || user.id)}</span><span class="settings-account-caption">Signed in</span></div></div><button class="settings-action" id="retry-sync">Sync now</button><button class="settings-action" id="import-guest">Import guest progress</button><button class="settings-action danger" id="settings-signout">Sign out</button></div>`
    : cloudEnabled
      ? '<div class="settings-group"><button class="settings-action" id="settings-signin">Sign in with Google <span class="settings-chevron" aria-hidden="true">›</span></button></div>'
      : '<p class="dialog-note">Sign-in is unavailable.</p>';
  return `<header class="titlerow"><h1>Account</h1></header>
    <div class="settings-body">
    <section class="settings-section" aria-label="Account">${identity}</section>
    <p class="dialog-note" id="sync-status" role="status"></p>
    <p class="dialog-note" id="settings-status" role="status" aria-live="polite"></p>
    </div>`;
}

function wireAccount() {
  const on = (selector, handler) => {
    const control = document.querySelector(selector);
    if (control) control.onclick = handler;
  };
  on('#import-guest', () => {
    try { previewImport(session.guestData(), false); }
    catch { document.querySelector('#settings-status').textContent = 'Guest progress could not be read.'; }
  });
  on('#retry-sync', () => runSettingsAction('Syncing…', async () => {
    await session.refresh();
    document.querySelector('#settings-status').textContent = 'Progress synced.';
  }, 'Could not sync. Pending changes remain on this device.'));
  on('#settings-signin', authDialog);
  on('#settings-signout', () => runSettingsAction('Signing out…', async () => {
    await session.logout();
    render(); document.querySelector('#auth-google:not([hidden]), #continue-guest')?.focus({ preventScroll: true });
    announce('Signed out. Account progress stays separate on this device.');
  }, 'Could not sign out. Please try again.'));
}

async function runSettingsAction(message, action, failure) {
  const box = document.querySelector('.dialog') || document.querySelector('main');
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
    download(json ? createBackup(exported, now) : progressText(exported, id => formatName(id, exported.naming), now),
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
    <p class="dialog-note">${summary.parshiyos} ${summary.parshiyos === 1 ? 'parsha' : 'parshiyos'} with progress, ${summary.completed} completed, ${summary.aliyos} ${summary.aliyos === 1 ? 'aliyah' : 'aliyos'} checked. Cycles: ${summary.cycles.join(', ') || 'none'}.</p>
    <p class="dialog-note">Checked aliyos will be added to ${user ? 'your signed-in account' : 'guest progress on this device'}. Existing checkmarks will stay.${settingsIncluded ? ' Learning, appearance, effects, and reminder preferences will be restored. Calendar reminders already imported are managed in your calendar.' : ' Guest progress will also remain on this device.'}</p>
    <p class="dialog-note" role="status"></p>
    <div class="confirm-actions"><button class="secondary" id="cancel-import">Cancel</button><button class="primary" id="confirm-import">Confirm import</button></div>`, 'Import progress');
  document.querySelector('#cancel-import').focus();
  document.querySelector('#cancel-import').onclick = () => closeModal();
  document.querySelector('#confirm-import').onclick = () => runSettingsAction('Importing…', async () => {
    data = session.importData(imported, owner, settingsIncluded);
    applyTheme();
    document.querySelector('.dialog').removeAttribute('aria-busy');
    closeModal(); render();
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
    <p class="dialog-note">This clears every checkmark from every cycle${user ? ' on this device and in your account' : ' on this device'}. Your settings and account stay. This cannot be undone.</p>
    <p class="dialog-note">You can export a copy from Settings before deleting.</p>
    <p class="dialog-note" id="delete-status" role="status"></p>
    <div class="confirm-actions"><button class="secondary" id="cancel-delete">Cancel</button><button class="danger-button" id="confirm-delete">Delete all progress</button></div>`, 'Delete all progress?');
  document.querySelector('#cancel-delete').focus();
  document.querySelector('#cancel-delete').onclick = () => closeModal();
  document.querySelector('#confirm-delete').onclick = () => runSettingsAction('Deleting progress…', async () => {
    await session.clear();
    clearCommentaryPicks();
    completedFeedback = null;
    ({ data, storageOK } = session.snapshot());
    document.querySelector('.dialog').removeAttribute('aria-busy');
    closeModal(); render();
    document.querySelector('#settings-status').textContent = 'All progress deleted. Your settings are saved.';
  }, user ? 'Could not delete all progress yet. A saved deletion request will retry when connected. Check sync status in Account.' : 'Could not delete all progress. Check browser storage, then try again.');
}

session.subscribe((snapshot, { refresh, accountChanged }) => {
  const previousCalendar = data.israel;
  const previousUser = user;
  ({ data, user, storageOK, ready } = snapshot);
  if (user || previousUser) chooseGuest(false);
  applyTheme();
  if (accountChanged) {
    completedFeedback = null;
    document.querySelector('.dialog')?.removeAttribute('aria-busy');
    closeModal();
    reader.reset();
    year = cycleYear(new Date(), data.israel); chosen = null; activeSefer = null;
    tab = 'tracker'; trackerScroll = 0;
    resumeReader();
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
// With accounts, the session's first event says whose reader this is, and resumes it there.
if (ready) resumeReader();
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') refreshCalendar(); });
render();
}
