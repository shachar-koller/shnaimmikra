// Reader rules with no DOM: positions, navigation, gestures, bookmarks, completion patches.
import { ALIYAH_COUNT, aliyahField } from './readings.js';

export const READER_MODES = ['cards', 'flow', 'classic'];
export const DEFAULT_READER_MODE = 'flow';
export const PASUK_PARTS = ['first', 'targum', 'second'];
const MIKRA = ['mikra1', 'mikra2'];
export const SHNAYIM_MIKRA_READINGS = [...MIKRA, 'onkelos'];

export const startPosition = (aliyah = 0) => ({ aliyah, ref: null, part: 'first', end: false });

/** Accepts anything from storage; returns a well-formed position or a fresh start. */
export function cleanPosition(raw) {
  if (!raw || typeof raw !== 'object' || !Number.isInteger(raw.aliyah) || raw.aliyah < 0 || raw.aliyah >= ALIYAH_COUNT) {
    return startPosition();
  }
  return {
    aliyah: raw.aliyah,
    ref: typeof raw.ref === 'string' ? raw.ref : null,
    part: PASUK_PARTS.includes(raw.part) ? raw.part : 'first',
    end: raw.end === true,
  };
}

/** Fits a position to the loaded text. A verse outside the aliyah starts the aliyah over. */
export function resolvePosition(parsha, position) {
  const { aliyah, ref, part, end } = cleanPosition(position);
  const verses = parsha.aliyot[aliyah].verses;
  if (verses.some(verse => verse.ref === ref)) return { aliyah, ref, part, end };
  return { aliyah, ref: verses[0].ref, part: 'first', end: false };
}

const lastVerse = (parsha, aliyah) => parsha.aliyot[aliyah].verses.at(-1);

/** One pasuk forward or back. The returned object is the input when there is nowhere to go. */
export function stepPasuk(parsha, position, direction) {
  const { aliyah, ref, end } = position;
  const verses = parsha.aliyot[aliyah].verses;
  const index = verses.findIndex(verse => verse.ref === ref);
  if (direction > 0) {
    if (end) return position;
    if (index === verses.length - 1) return { aliyah, ref, part: 'first', end: true };
    return { aliyah, ref: verses[index + 1].ref, part: 'first', end: false };
  }
  if (end) return { aliyah, ref: verses.at(-1).ref, part: 'first', end: false };
  if (index > 0) return { aliyah, ref: verses[index - 1].ref, part: 'first', end: false };
  if (aliyah > 0) return { aliyah: aliyah - 1, ref: lastVerse(parsha, aliyah - 1).ref, part: 'first', end: false };
  return position;
}

export function pasukLocation(parsha, { aliyah, ref }) {
  const verses = parsha.aliyot[aliyah].verses;
  return { number: verses.findIndex(verse => verse.ref === ref) + 1, total: verses.length };
}

/**
 * A swipe is one quick, clearly horizontal touch stroke with no text being selected.
 * Hebrew pages turn rightward, so pulling the page to the right moves forward.
 */
export function swipeDirection({ dx, dy, ms, width, selecting = false }) {
  if (selecting || ms > 700) return 0;
  if (Math.abs(dx) < Math.max(56, width * .16) || Math.abs(dx) < Math.abs(dy) * 2) return 0;
  return dx > 0 ? 1 : -1;
}

export const aliyahCompletionPatch = aliyah => Object.fromEntries(
  SHNAYIM_MIKRA_READINGS.map(reading => [aliyahField(reading, aliyah), true]));
export const mikraPatch = (reading, aliyah) => {
  if (!MIKRA.includes(reading)) throw new Error(`${reading} is not a mikra reading`);
  return { [aliyahField(reading, aliyah)]: true };
};
export const isMarked = (progress, patch) => Object.keys(patch).every(field => progress?.[field] === true);

const POSITION_PREFIX = 'shnaim-mikra-reader-position';
const MODE_PREFIX = 'shnaim-mikra-reader-mode';
const SESSION_KEY = 'shnaim-mikra-reader-session';
const ownerOf = owner => owner || 'guest';

/**
 * Bookmarks live apart from progress, scoped to guest or account, then cycle and parsha.
 * What this page last wrote wins, so a failed write still holds for the current visit.
 */
export function createReaderStore(getStorage = () => localStorage, getSessionStorage = () => sessionStorage) {
  const memory = new Map();
  function read(key) {
    if (memory.has(key)) return memory.get(key);
    try { return getStorage().getItem(key); } catch { return null; }
  }
  function write(key, value) {
    memory.set(key, value);
    try { getStorage().setItem(key, value); return true; } catch { return false; }
  }
  const positionKey = (owner, year, id) => `${POSITION_PREFIX}:${ownerOf(owner)}:${year}:${id}`;
  return {
    clearMemory: () => memory.clear(),
    position(owner, year, id) {
      const saved = read(positionKey(owner, year, id));
      if (!saved) return startPosition();
      try { return cleanPosition(JSON.parse(saved)); } catch { return startPosition(); }
    },
    savePosition(owner, year, id, position) {
      return write(positionKey(owner, year, id), JSON.stringify(position));
    },
    mode(owner) {
      const saved = read(`${MODE_PREFIX}:${ownerOf(owner)}`);
      return READER_MODES.includes(saved) ? saved : DEFAULT_READER_MODE;
    },
    saveMode(owner, mode) { return write(`${MODE_PREFIX}:${ownerOf(owner)}`, mode); },
    // Only a reload (an update can trigger one while hidden) returns to the open reader.
    remember(owner, year, id) {
      try { getSessionStorage().setItem(SESSION_KEY, JSON.stringify({ owner: ownerOf(owner), year, id })); } catch { /* Optional. */ }
    },
    forget() {
      try { getSessionStorage().removeItem(SESSION_KEY); } catch { /* Optional. */ }
    },
    resume(owner) {
      try {
        const saved = JSON.parse(getSessionStorage().getItem(SESSION_KEY));
        return saved?.owner === ownerOf(owner) && Number.isInteger(saved.year) && typeof saved.id === 'string' ? saved : null;
      } catch { return null; }
    },
  };
}
