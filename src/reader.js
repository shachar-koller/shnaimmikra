// The Chumash tab: one reading session shown as Cards, Flow, or Classic.
// Text comes from chumash-text.js and rules from reader-model.js; this file is views and events.
import { complete } from './model.js';
import { hebrewName, heroName, sefarimFor, seferOf, titleName } from './names.js';
import { preferences } from './preferences.js';
import { ALIYAH_COUNT, ALIYAH_NAMES, aliyahField } from './readings.js';
import { createTextLoader } from './chumash-text.js';
import {
  READER_MODES, SHNAYIM_MIKRA_READINGS, aliyahCompletionPatch, createReaderStore, isMarked, mikraPatch,
  parshaReadingProgress, pasukLocation, resolvePosition, startPosition, stepPasuk,
} from './reader-model.js';
import { celebrate, haptic, pop, slideIn } from './motion.js';
import { createCardSwipe } from './reader-swipe.js';

const MODE_LABELS = { cards: 'Cards', flow: 'Flow', classic: 'Classic' };
const SAVE_FAILED = 'Progress could not be saved. Check browser storage.';
const ERRORS = {
  offline: 'You’re offline, and this parsha isn’t saved on this device yet. Parshiyos you’ve already opened here stay available offline.',
  unavailable: 'The text couldn’t be loaded right now. Your place is saved.',
  invalid: 'The text of this parsha couldn’t be read. Your place is saved.',
};
const ONES = ['', 'א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ז', 'ח', 'ט'];
const TENS = ['', 'י', 'כ', 'ל', 'מ', 'נ', 'ס', 'ע', 'פ', 'צ'];
const hebrewNumber = n => n === 15 ? 'טו' : n === 16 ? 'טז' : `${TENS[Math.floor(n / 10)]}${ONES[n % 10]}`;
const arrow = direction => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${direction === 'left' ? 'm15 5-7 7 7 7' : 'm9 5 7 7-7 7'}"/></svg>`;
const tick = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" aria-hidden="true"><path d="m5 12 5 5 9-10"/></svg>';

export function createReader(app) {
  const store = createReaderStore();
  const loader = createTextLoader();
  loader.cleanup();
  const esc = app.escapeHtml;

  let location = null;      // { key, owner, year, id, position }
  let mode = null;
  let opening = true;
  let text = { status: 'loading' }; // status: loading | ready | error
  let loadToken = 0, pendingScroll = false, dirty = false, saveTimer = null;
  let ownScroll = null, pageHeight = 0, frame = null, width = innerWidth;
  let saveNote = '', retrying = false, fontRequested = false;
  const cardSwipe = createCardSwipe({
    canStep: direction => ready() && stepPasuk(parsha(), location.position, direction) !== location.position,
    onSwipe: direction => stepCard(direction, { focusControls: false }),
    onDirection: direction => {
      const peek = document.querySelector('.reader-card-peek');
      if (peek) peek.innerHTML = cardPeek(direction);
    },
  });

  const ready = () => text.status === 'ready';
  const progress = () => app.progress(location.id);
  const parsha = () => text.parsha;
  const name = () => titleName([location.id], app.data().naming);
  const aliyahName = (index = location.position.aliyah) => ALIYAH_NAMES[index];

  function flush() {
    clearTimeout(saveTimer);
    if (!dirty || !location) return;
    dirty = false;
    store.savePosition(location.owner, location.year, location.id, location.position);
  }
  function setPosition(position, { later = false } = {}) {
    location.position = position;
    dirty = true;
    if (later) {
      clearTimeout(saveTimer);
      saveTimer = setTimeout(flush, 250);
    } else flush();
  }

  function applyText(result) {
    text = { status: 'ready', parsha: result.parsha, saved: result.saved };
    location.position = resolvePosition(result.parsha, location.position);
  }
  function loadText(id) {
    const token = ++loadToken;
    const known = loader.peek(id);
    if (known) { applyText(known); return; }
    text = { status: 'loading' };
    loader.load(id).then(result => {
      // Only the newest request may change the page; a late one just stays in the loader.
      if (token !== loadToken) return;
      applyText(result);
    }, error => {
      if (token !== loadToken) return;
      text = { status: 'error', kind: error?.kind in ERRORS ? error.kind : 'unavailable' };
    }).then(() => {
      if (token !== loadToken || app.tab() !== 'chumash') return;
      const wasRetrying = retrying;
      retrying = false;
      app.refresh();
      if (wasRetrying && document.activeElement === document.body) {
        document.querySelector('#reader-retry, #reader-aliyah')?.focus({ preventScroll: true });
      }
    });
  }

  // Selecting a parsha (here or in the tracker) lands here on the next render.
  function sync(item) {
    const owner = app.owner(), year = app.year();
    const key = `${owner || 'guest'}:${year}:${item.id}`;
    if (opening || location?.owner !== owner || !mode) {
      const preferred = preferences(app.data()).defaultReaderMode;
      mode = preferred === 'last-used' ? store.mode(owner) : preferred;
      if (preferred !== 'last-used') store.saveMode(owner, mode);
      opening = false;
      pendingScroll = true;
    }
    if (location?.key === key) return;
    cardSwipe.cancel();
    flush();
    location = { key, owner, year, id: item.id, position: store.position(owner, year, item.id) };
    saveNote = ''; retrying = false;
    pendingScroll = true;
    loadText(item.id);
  }

  /* ---------- Markup ---------- */

  const inline = parts => parts.map(part => typeof part === 'string' ? esc(part)
    : part.break ? ' ' : `<span class="tx-${part.format}">${esc(part.text)}</span>`).join('');

  function pasukReference(verse) {
    const { naming } = app.data();
    const sefer = sefarimFor(naming)[seferOf(location.id)].en;
    return naming === 'hebrew'
      ? `<span lang="he" dir="rtl">${sefer} ${hebrewNumber(verse.chapter)}:${hebrewNumber(verse.verse)}</span>`
      : `${sefer} ${verse.chapter}:${verse.verse}`;
  }

  function pasukPart(part, label, verse, parts, lang, missing, preview = false) {
    const css = preview ? 'peek-pasuk' : 'pasuk';
    return `<div class="${css}-part"${preview ? '' : ` data-part="${part}" data-ref="${verse.ref}"`}>
      <span class="${css}-label">${label}</span>
      ${parts ? `<p class="${css}-text" lang="${lang}" dir="rtl">${inline(parts)}</p>` : `<p class="${css}-missing">${missing}</p>`}
    </div>`;
  }

  // Torah, then Onkelos, then Torah again: the order itself is the practice.
  function pasukGroup(verse, preview = false) {
    const noTorah = 'This pasuk’s text is not available.';
    const css = preview ? 'peek-pasuk' : 'pasuk';
    return `<article class="${css}"${preview ? '' : ` data-key="pasuk-${verse.ref}"`} aria-label="${esc(`Pasuk ${verse.chapter}:${verse.verse}`)}">
      <p class="${css}-ref">${pasukReference(verse)}</p>
      ${pasukPart('first', 'Mikra I', verse, verse.torah, 'he', noTorah, preview)}
      ${pasukPart('targum', 'Targum Onkelos', verse, verse.onkelos, 'arc', 'Targum Onkelos is not available for this pasuk.', preview)}
      ${pasukPart('second', 'Mikra II', verse, verse.torah, 'he', noTorah, preview)}
    </article>`;
  }

  function classicText(verses) {
    const paragraphs = [[]];
    verses.forEach((verse, index) => {
      const perek = verse.verse === 1 || index === 0;
      let chunk = [`${perek ? `<span class="perek-mark">פרק ${hebrewNumber(verse.chapter)}</span> ` : ''}<sup class="verse-mark">${hebrewNumber(verse.verse)}</sup>`];
      const close = () => {
        if (chunk.length) paragraphs.at(-1).push(`<span class="classic-verse" data-verse="${verse.ref}">${chunk.join('')}</span>`);
        chunk = [];
      };
      if (!verse.torah) chunk.push('<span class="pasuk-missing" lang="en" dir="ltr">Text not available</span>');
      for (const part of verse.torah || []) {
        if (part.break === 'pe') { close(); paragraphs.push([]); }
        else if (part.break === 'samekh') chunk.push('<span class="setumah"></span>');
        else chunk.push(inline([part]));
      }
      close();
    });
    return `<div class="classic-text" lang="he" dir="rtl">${paragraphs.filter(paragraph => paragraph.length)
      .map(paragraph => `<p>${paragraph.join(' ')}</p>`).join('')}</div>`;
  }

  function commentaryNote() {
    if (app.commentaryOf(location.id) !== 'rashi') return '';
    return `<p class="reader-note">Your tracker is showing ${esc(app.readingLabel('rashi'))} for this parsha. Targum marks are saved separately and don’t change that choice.</p>`;
  }

  function completionActions() {
    const index = location.position.aliyah;
    const saved = progress();
    if (mode === 'classic') {
      const mikraButton = reading => {
        const done = saved[aliyahField(reading, index)] === true;
        const label = app.readingLabel(reading);
        return `<button type="button" id="reader-mark-${reading}" class="reader-mark${done ? ' done' : ''}" data-mark="${reading}" aria-disabled="${done}">${done ? tick : ''}<span>${done ? `${label} marked` : `Mark ${label}`}</span></button>`;
      };
      return `<div class="reader-marks" role="group" aria-label="${esc(`Mark a reading of ${aliyahName(index)}`)}">${mikraButton('mikra1')}${mikraButton('mikra2')}</div>
        <p class="reader-note">Each marks one reading of this aliyah. To uncheck one, use the Tracker.</p>`;
    }
    const done = isMarked(saved, aliyahCompletionPatch(index));
    const marks = SHNAYIM_MIKRA_READINGS.map(reading => {
      const on = saved[aliyahField(reading, index)] === true;
      return `<li class="${on ? 'on' : ''}">${on ? tick : '<i aria-hidden="true"></i>'}<span>${app.readingLabel(reading)}</span><span class="sr-only">${on ? ' marked' : ' not marked'}</span></li>`;
    }).join('');
    return `<ul class="reader-status" aria-label="${esc(`Saved for ${aliyahName(index)}`)}">${marks}</ul>
      <button type="button" id="reader-complete" class="reader-mark reader-mark-wide${done ? ' done' : ''}" aria-disabled="${done}">${done ? tick : ''}<span>${done ? 'Aliyah complete' : 'Mark aliyah complete'}</span></button>
      <p class="reader-note">Marks Mikra I, Mikra II and Targum for this aliyah only. To uncheck, use the Tracker.</p>
      ${commentaryNote()}`;
  }

  function endActions() {
    const index = location.position.aliyah;
    const last = index === ALIYAH_COUNT - 1;
    const continuation = last
      ? `<p class="reader-note">You’ve reached the end of ${esc(name())}.</p><button type="button" id="reader-choose-parsha" class="reader-continue">Choose another parsha</button>`
      : `<button type="button" id="reader-continue" class="reader-continue">Continue to next aliyah<span class="reader-continue-name">${aliyahName(index + 1)}</span></button>`;
    return `<section class="reader-end" aria-labelledby="reader-end-title">
      <h2 id="reader-end-title" tabindex="-1">${last ? `End of ${esc(name())}` : `End of ${aliyahName(index)}`}</h2>
      ${completionActions()}
      <p class="reader-note reader-warning" id="reader-save-note" role="status">${esc(saveNote)}</p>
      ${continuation}
    </section>`;
  }

  function cardPeek(direction) {
    const next = stepPasuk(parsha(), location.position, direction);
    if (next === location.position) return '';
    if (next.end) return `<p class="card-peek-end">End of ${aliyahName(next.aliyah)}</p>`;
    return pasukGroup(parsha().aliyot[next.aliyah].verses.find(verse => verse.ref === next.ref), true);
  }

  function cardsView(verses) {
    const { position } = location;
    const verse = verses.find(candidate => candidate.ref === position.ref);
    const atStart = position.aliyah === 0 && !position.end && verses[0].ref === position.ref;
    return `<div class="reader-card-deck">
        <div class="reader-card-peek" aria-hidden="true" inert>${cardPeek(1)}</div>
        <div class="reader-card" id="reader-card">${position.end ? endActions() : pasukGroup(verse)}</div>
      </div>
      <nav class="card-nav" dir="rtl" aria-label="Pasuk">
        <button type="button" id="reader-previous" class="card-step" dir="ltr" ${atStart ? 'disabled' : ''}><span>Previous pasuk</span>${arrow('right')}</button>
        <button type="button" id="reader-next" class="card-step" dir="ltr" ${position.end ? 'disabled' : ''}>${arrow('left')}<span>Next pasuk</span></button>
      </nav>`;
  }

  function bodyMarkup() {
    if (text.status === 'loading' && !retrying) {
      return `<div class="reader-state" id="reader-loading" role="status"><p>Loading ${esc(name())}…</p></div>`;
    }
    if (text.status !== 'ready') {
      return `<div class="reader-state" id="reader-error"><p role="status">${retrying ? 'Trying again…' : ERRORS[text.kind]}</p>
        <button type="button" id="reader-retry" class="reader-continue" ${retrying ? 'disabled' : ''}>Try again</button></div>`;
    }
    const verses = parsha().aliyot[location.position.aliyah].verses;
    const content = mode === 'cards' ? cardsView(verses)
      : mode === 'flow' ? `<div class="flow">${verses.map(verse => pasukGroup(verse)).join('')}</div>${endActions()}`
        : `${classicText(verses)}${endActions()}`;
    return `<div class="reader-body" id="reader-body-${mode}" data-key="body-${mode}">${content}</div>`;
  }

  function locationText() {
    const { position } = location;
    const aliyah = `Aliyah ${position.aliyah + 1}`;
    if (!ready()) return aliyah;
    if (position.end && mode === 'cards') return `${aliyah} · End`;
    const { number, total } = pasukLocation(parsha(), position);
    return `${aliyah} · Pasuk ${number} of ${total}`;
  }

  function readingProgressState() {
    const { value, total } = parshaReadingProgress(parsha(), location.position, mode);
    const part = mode === 'classic' ? 'Mikra'
      : { first: 'Mikra I', targum: 'Targum Onkelos', second: 'Mikra II' }[location.position.part];
    const description = `${value} of ${total} readings in ${name()} · ${location.position.end ? `End of ${aliyahName()}` : part}`;
    return { value, total, description };
  }

  function readingProgress() {
    if (!ready()) return '';
    const { value, total, description } = readingProgressState();
    return `<progress class="reader-progress" id="reader-progress" max="${total}" value="${value}" aria-label="Reading position in this parsha" aria-valuetext="${esc(description)}" title="${esc(description)}"></progress>`;
  }

  function parshaOptions(rows) {
    const { naming } = app.data();
    return sefarimFor(naming).map((sefer, index) => `<optgroup label="${esc(sefer.en)}">${rows.filter(row => seferOf(row.id) === index)
      .map(row => `<option value="${esc(row.id)}">${esc(titleName(row.names, naming))}</option>`).join('')}</optgroup>`).join('');
  }

  function panel(rows, item) {
    // Asked for now, so it usually arrives before the text and nothing has to reflow.
    if (!fontRequested) {
      fontRequested = true;
      document.fonts?.load('1rem "Reader Hebrew"', 'א').catch(() => {});
    }
    sync(item);
    const { naming } = app.data();
    const aliyah = location.position.aliyah;
    return `<header class="titlerow" data-key="reader-title">
        <h1${naming === 'hebrew' ? ' lang="he" dir="rtl"' : ''}>${heroName(item.names, naming)}</h1>
        ${naming === 'hebrew' ? '' : `<span class="he" lang="he" dir="rtl">${hebrewName(item.names)}</span>`}
      </header>
      <div class="reader-picks" data-key="reader-picks">
        <label class="reader-pick">Parsha<select id="reader-parsha"${naming === 'hebrew' ? ' lang="he"' : ''}>${parshaOptions(rows)}</select></label>
        <div class="reader-pick">
          <label for="reader-aliyah">Aliyah</label>
          <div class="reader-aliyah-row" dir="rtl">
            <button type="button" id="reader-aliyah-previous" class="reader-icon" aria-label="Previous aliyah" title="Previous aliyah" ${aliyah === 0 ? 'disabled' : ''}>${arrow('right')}</button>
            <select id="reader-aliyah" dir="ltr">${ALIYAH_NAMES.map((label, index) => `<option value="${index}">${label}</option>`).join('')}</select>
            <button type="button" id="reader-aliyah-next" class="reader-icon" aria-label="Next aliyah" title="Next aliyah" ${aliyah === ALIYAH_COUNT - 1 ? 'disabled' : ''}>${arrow('left')}</button>
          </div>
        </div>
      </div>
      <div class="reader-bar" data-key="reader-bar">
        <div class="reader-modes" role="group" aria-label="Reading mode">
          ${READER_MODES.map(option => `<button type="button" id="reader-mode-${option}" class="reader-mode" data-mode="${option}" aria-pressed="${option === mode}">${MODE_LABELS[option]}</button>`).join('')}
        </div>
        <p class="reader-location" id="reader-location">${locationText()}</p>
        ${readingProgress()}
      </div>
      ${bodyMarkup()}
      <p class="reader-credit" data-key="reader-credit">
        Torah: <a href="https://en.wikisource.org/wiki/User:Dovi/Miqra_according_to_the_Masorah" target="_blank" rel="noopener">Miqra according to the Masorah</a>, <a href="https://creativecommons.org/licenses/by-sa/4.0/" target="_blank" rel="noopener">CC BY-SA 4.0</a>. Targum Onkelos: Torat Emet, public domain. Both via <a href="https://www.sefaria.org" target="_blank" rel="noopener">Sefaria</a>, with layout adapted.
        ${ready() && text.saved ? ' This parsha is saved on this device for offline reading.' : ''}
      </p>`;
  }

  /* ---------- Position on screen ---------- */

  function stickyOffset() {
    const bar = document.querySelector('.reader-bar');
    return bar ? bar.offsetHeight + (parseFloat(getComputedStyle(bar).top) || 0) + 8 : 0;
  }
  const quietScrollTo = top => {
    window.scrollTo({ top: Math.max(0, top), behavior: 'instant' });
    // Near the end of a page the browser stops short of the target. Staying at this
    // spot is not the reader moving, or a restored last pasuk would slip back a verse.
    ownScroll = window.scrollY;
    pageHeight = document.documentElement.scrollHeight;
  };
  const pageTop = element => element.getBoundingClientRect().top + window.scrollY - stickyOffset();

  function scrollToPosition() {
    const { position } = location;
    const verses = parsha().aliyot[position.aliyah].verses;
    const opening = !position.end && position.part === 'first' && position.ref === verses[0].ref;
    if (mode === 'cards' && (position.end || position.part === 'first')) {
      const card = document.querySelector('#reader-card');
      // Only ever moves up: a card already fully in view stays still under the finger.
      if (card) quietScrollTo(Math.min(window.scrollY, pageTop(card)));
      return;
    }
    if (opening) { quietScrollTo(0); return; }
    const target = position.end ? document.querySelector('.reader-end')
      : mode === 'classic' ? document.querySelector(`[data-verse="${position.ref}"]`)
        : document.querySelector(`[data-ref="${position.ref}"][data-part="${position.part}"]`);
    if (target) quietScrollTo(pageTop(target));
  }

  function applyScroll() {
    if (!pendingScroll || !ready() || !location) return;
    pendingScroll = false;
    scrollToPosition();
  }

  // The last marker at or above the sticky bar's lower edge is what they are reading.
  function trackScroll() {
    frame = null;
    if (app.tab() !== 'chumash' || !ready() || !location || cardSwipe.active()) return;
    // A page that changed height moved under them (a font arriving, say); they didn't scroll.
    const height = document.documentElement.scrollHeight;
    if (height !== pageHeight) {
      pageHeight = height;
      ownScroll = window.scrollY;
      return;
    }
    if (ownScroll !== null && Math.abs(window.scrollY - ownScroll) < 2) return;
    ownScroll = null;
    const markers = document.querySelectorAll(mode === 'classic' ? '.reader-body [data-verse]' : '.reader-body [data-part]');
    if (!markers.length) return;
    const line = stickyOffset() + 4;
    let low = 0, high = markers.length - 1, found = 0;
    while (low <= high) {
      const middle = (low + high) >> 1;
      if (markers[middle].getBoundingClientRect().top <= line) { found = middle; low = middle + 1; }
      else high = middle - 1;
    }
    const marker = markers[found];
    const ref = marker.dataset.verse || marker.dataset.ref;
    const { position } = location;
    const end = mode !== 'cards' && (document.querySelector('.reader-end')?.getBoundingClientRect().top ?? Infinity) <= line;
    // Classic has no parts. A new verse there starts its sequence over.
    const part = mode === 'classic' ? (ref === position.ref ? position.part : 'first') : marker.dataset.part;
    if (ref === position.ref && part === position.part && end === position.end) return;
    setPosition({ aliyah: position.aliyah, ref, part, end }, { later: true });
    document.querySelector('#reader-location').textContent = locationText();
    const meter = document.querySelector('#reader-progress');
    const { value, description } = readingProgressState();
    meter.value = value;
    meter.setAttribute('aria-valuetext', description);
    meter.title = description;
  }

  window.addEventListener('scroll', () => { frame ??= requestAnimationFrame(trackScroll); }, { passive: true });
  window.addEventListener('resize', () => {
    // Mobile toolbars resize only the height. A new width reflows text, so keep the place.
    if (innerWidth === width) return;
    width = innerWidth;
    if (app.tab() === 'chumash' && ready()) { pendingScroll = true; applyScroll(); }
  });
  // New line lengths move everything, so go back to the pasuk they were on.
  document.fonts?.addEventListener('loadingdone', () => {
    if (app.tab() === 'chumash' && ready()) { pendingScroll = true; applyScroll(); }
  });
  window.addEventListener('pagehide', flush);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(); });

  /* ---------- Actions ---------- */

  function showAt(position, { direction = 0, announcement = '', focus = null } = {}) {
    cardSwipe.cancel();
    saveNote = '';
    setPosition(position);
    pendingScroll = true;
    app.render();
    if (focus) document.querySelector(focus)?.focus({ preventScroll: true });
    if (direction) slideIn([document.querySelector(mode === 'cards' ? '#reader-card' : '.reader-body')], -direction);
    if (announcement) app.announce(announcement);
  }

  function goToAliyah(index, { focus = null } = {}) {
    if (index < 0 || index >= ALIYAH_COUNT) return;
    const position = location.position;
    const direction = Math.sign(index - position.aliyah);
    const next = ready() ? resolvePosition(parsha(), startPosition(index)) : startPosition(index);
    showAt(next, { direction, focus, announcement: `${aliyahName(index)}${ready() ? `, pasuk 1 of ${parsha().aliyot[index].verses.length}` : ''}` });
    quietScrollTo(0);
  }

  function stepCard(direction, { focusControls = true } = {}) {
    // A repeated button/key press completes the pending turn before starting another.
    cardSwipe.finish();
    const next = stepPasuk(parsha(), location.position, direction);
    if (next === location.position) return;
    let focus = null;
    if (focusControls) {
      const atFirst = next.aliyah === 0 && !next.end && parsha().aliyot[0].verses[0].ref === next.ref;
      focus = next.end ? '#reader-end-title' : atFirst ? '#reader-next' : null;
    }
    const verse = !next.end && parsha().aliyot[next.aliyah].verses.find(candidate => candidate.ref === next.ref);
    const { number, total } = pasukLocation(parsha(), next);
    cardSwipe.dismiss(direction, () => showAt(next, {
      focus,
      announcement: next.end ? `End of ${aliyahName(next.aliyah)}` : `Pasuk ${number} of ${total}, ${verse.chapter}:${verse.verse}`,
    }));
  }

  function chooseMode(next) {
    if (next === mode) return;
    cardSwipe.finish();
    cardSwipe.cancel();
    mode = next;
    store.saveMode(location.owner, mode);
    pendingScroll = true;
    app.render();
    document.querySelector(`#reader-mode-${mode}`)?.focus({ preventScroll: true });
    app.announce(`${MODE_LABELS[mode]} view, ${locationText()}`);
  }

  function mark(patch, focusSelector, success) {
    if (isMarked(progress(), patch)) return; // Repeating changes nothing, including sync state.
    const wasComplete = complete(progress());
    const saved = app.save(location.id, patch);
    saveNote = saved ? '' : SAVE_FAILED;
    app.render();
    const control = document.querySelector(focusSelector);
    control?.focus({ preventScroll: true });
    app.announce(saved ? success : SAVE_FAILED);
    if (!saved) return;
    pop(control);
    const prefs = preferences(app.data());
    if (!wasComplete && complete(progress())) {
      if (prefs.confetti) celebrate(control);
      if (prefs.vibration) haptic([12, 50, 24]);
      app.announce(`${success} ${name()} complete.`);
    } else if (prefs.vibration) haptic(6);
  }

  function wireEnd() {
    const index = location.position.aliyah;
    const on = (selector, handler) => {
      const control = document.querySelector(selector);
      if (control) control.onclick = handler;
    };
    on('#reader-complete', () => mark(aliyahCompletionPatch(index), '#reader-complete',
      `${aliyahName(index)} marked complete: Mikra I, Mikra II and Targum.`));
    document.querySelectorAll('[data-mark]').forEach(button => button.onclick = () => {
      const reading = button.dataset.mark;
      mark(mikraPatch(reading, index), `#reader-mark-${reading}`, `${app.readingLabel(reading)} marked for ${aliyahName(index)}.`);
    });
    on('#reader-continue', () => goToAliyah(index + 1, { focus: '#reader-aliyah' }));
    on('#reader-choose-parsha', () => {
      quietScrollTo(0);
      document.querySelector('#reader-parsha').focus({ preventScroll: true });
    });
  }

  function wire() {
    if (!location) return;
    store.remember(location.owner, location.year, location.id);
    const parshaSelect = document.querySelector('#reader-parsha');
    if (parshaSelect.value !== location.id) parshaSelect.value = location.id;
    parshaSelect.onchange = () => {
      app.select(parshaSelect.value);
      app.render();
      parshaSelect.focus({ preventScroll: true });
      app.announce(`${name()} selected`);
    };
    const aliyahSelect = document.querySelector('#reader-aliyah');
    const aliyah = String(location.position.aliyah);
    if (aliyahSelect.value !== aliyah) aliyahSelect.value = aliyah;
    aliyahSelect.onchange = () => goToAliyah(Number(aliyahSelect.value), { focus: '#reader-aliyah' });
    document.querySelector('#reader-aliyah-previous').onclick = () => goToAliyah(location.position.aliyah - 1, {
      focus: location.position.aliyah === 1 ? '#reader-aliyah' : '#reader-aliyah-previous',
    });
    document.querySelector('#reader-aliyah-next').onclick = () => goToAliyah(location.position.aliyah + 1, {
      focus: location.position.aliyah === ALIYAH_COUNT - 2 ? '#reader-aliyah' : '#reader-aliyah-next',
    });
    document.querySelectorAll('[data-mode]').forEach(button => button.onclick = () => chooseMode(button.dataset.mode));
    const retry = document.querySelector('#reader-retry');
    if (retry) retry.onclick = () => {
      if (retry.disabled) return;
      retrying = true;
      pendingScroll = true;
      text = { status: 'error', kind: text.kind };
      app.render();
      loadText(location.id);
    };
    if (ready()) {
      wireEnd();
      if (mode === 'cards') {
        cardSwipe.bind(document.querySelector('#reader-card'));
        document.querySelector('#reader-previous').onclick = () => stepCard(-1);
        document.querySelector('#reader-next').onclick = () => stepCard(1);
      }
    }
    applyScroll();
  }

  return {
    panel,
    wire,
    /** Runs after the tab bar's own scroll reset, so the reader's place wins. */
    entered() {
      pendingScroll = true;
      applyScroll();
    },
    left() {
      cardSwipe.finish();
      cardSwipe.cancel();
      flush();
      opening = true;
      store.forget();
    },
    /** Nothing from the previous account stays in memory. Its bookmarks stay under its own keys. */
    reset() {
      cardSwipe.cancel();
      flush();
      clearTimeout(saveTimer);
      loadToken += 1;
      location = null; mode = null; text = { status: 'loading' };
      opening = true;
      pendingScroll = false; saveNote = ''; retrying = false;
      store.clearMemory();
    },
    resume: owner => store.resume(owner),
    forget: () => store.forget(),
  };
}
