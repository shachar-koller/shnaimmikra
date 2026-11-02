// Loads a parsha's text and resolves it into verses per aliyah. Knows nothing about views.
import { ALIYAH_COUNT } from './readings.js';

export const TEXT_VERSION = 1;
const CACHE_NAME = `chumash-text-v${TEXT_VERSION}`;
const CACHE_PREFIX = 'chumash-text-';

export const textSlug = id => id.toLowerCase().replace(/[^a-z]+/g, '-').replace(/^-|-$/g, '');
export const textUrl = id => `/chumash/v${TEXT_VERSION}/${textSlug(id)}.json`;

export class TextError extends Error {
  constructor(kind, message = kind) {
    super(message);
    this.name = 'TextError';
    this.kind = kind; // 'offline', 'unavailable', or 'invalid'
  }
}

const REF = /^(\d+):(\d+)$/;
const FORMATS = new Set(['big', 'small', 'bold', 'ketiv', 'qere', 'note']);
const BREAKS = new Set(['pe', 'samekh']);
const parseRef = ref => {
  const match = typeof ref === 'string' && ref.match(REF);
  return match ? [Number(match[1]), Number(match[2])] : null;
};

// Only known kinds keep their formatting. Anything else stays as literal text.
function cleanVerse(verse) {
  const parts = typeof verse === 'string' ? [verse] : Array.isArray(verse) ? verse : [];
  const cleaned = parts.flatMap(part => {
    if (typeof part === 'string') return part ? [part] : [];
    if (!Array.isArray(part)) return [];
    const [kind, text] = part;
    if (BREAKS.has(kind)) return [{ break: kind }];
    if (typeof text !== 'string' || !text) return [];
    return [FORMATS.has(kind) ? { format: kind, text } : text];
  });
  return cleaned.some(part => typeof part === 'string' || part.text) ? cleaned : null;
}

function verseMap(entries) {
  const verses = new Map();
  if (!Array.isArray(entries)) return verses;
  for (const entry of entries) {
    if (!Array.isArray(entry) || !parseRef(entry[0])) continue;
    const verse = cleanVerse(entry[1]);
    if (verse) verses.set(entry[0], verse);
  }
  return verses;
}

function refsInRange(start, end, counts) {
  const first = parseRef(start), last = parseRef(end);
  if (!first || !last) throw new TextError('invalid', 'Bad aliyah range');
  const refs = [];
  for (let [chapter, verse] = first; ;) {
    const count = counts?.[chapter];
    if (!Number.isInteger(count) || verse > count || refs.length > 500) throw new TextError('invalid', 'Bad aliyah range');
    refs.push({ ref: `${chapter}:${verse}`, chapter, verse });
    if (chapter === last[0] && verse === last[1]) return refs;
    if (verse === count) { chapter += 1; verse = 1; } else verse += 1;
  }
}

/**
 * Pairs Torah and Onkelos by reference, never by position. A verse missing from
 * either side stays null, so a view can say so instead of showing the wrong text.
 */
export function resolveParsha(raw, id) {
  if (raw?.format !== 1 || raw.id !== id || !Array.isArray(raw.aliyot) || raw.aliyot.length !== ALIYAH_COUNT) {
    throw new TextError('invalid', `Unexpected text for ${id}`);
  }
  const torah = verseMap(raw.torah), onkelos = verseMap(raw.onkelos);
  const aliyot = raw.aliyot.map((range, index) => ({
    index,
    verses: refsInRange(range?.[0], range?.[1], raw.verseCounts).map(({ ref, chapter, verse }) => ({
      ref, chapter, verse, torah: torah.get(ref) ?? null, onkelos: onkelos.get(ref) ?? null,
    })),
  }));
  if (!aliyot.some(aliyah => aliyah.verses.some(verse => verse.torah))) throw new TextError('invalid', `No text for ${id}`);
  return { id, book: raw.book, aliyot };
}

const defaultCaches = () => {
  try { return globalThis.caches ?? null; } catch { return null; }
};

/**
 * Serves text from memory, then this device's cache, then the network. The page
 * writes the cache itself, so what is saved is what it can truthfully report as saved.
 */
export function createTextLoader({
  request = (...args) => fetch(...args),
  cacheStorage = defaultCaches(),
  isOnline = () => globalThis.navigator?.onLine !== false,
} = {}) {
  const memory = new Map(), active = new Map();

  async function openCache() {
    if (!cacheStorage) return null;
    try { return await cacheStorage.open(CACHE_NAME); } catch { return null; }
  }
  async function fromCache(cache, url, id) {
    if (!cache) return null;
    try {
      const saved = await cache.match(url);
      return saved ? resolveParsha(await saved.json(), id) : null;
    } catch {
      // A damaged entry must not block a fresh copy.
      await cache.delete(url).catch(() => {});
      return null;
    }
  }
  async function fromNetwork(cache, url, id) {
    let response;
    try { response = await request(url); }
    catch { throw new TextError(isOnline() ? 'unavailable' : 'offline', 'Text could not be fetched'); }
    if (!response.ok) throw new TextError('unavailable', `Text responded ${response.status}`);
    const stored = cache ? response.clone() : null;
    let parsha;
    try { parsha = resolveParsha(await response.json(), id); }
    catch (error) { throw error instanceof TextError ? error : new TextError('invalid', 'Text could not be read'); }
    let saved = false;
    if (stored) {
      try { await cache.put(url, stored); saved = true; } catch { /* It still works for this visit. */ }
    }
    return { parsha, saved };
  }
  async function loadFresh(id) {
    const url = textUrl(id);
    const cache = await openCache();
    const cached = await fromCache(cache, url, id);
    const result = cached ? { parsha: cached, saved: true } : await fromNetwork(cache, url, id);
    memory.set(id, result);
    return result;
  }
  return {
    /** Synchronous, so a parsha already in memory shows without a loading flash. */
    peek: id => memory.get(id),
    load(id) {
      if (memory.has(id)) return Promise.resolve(memory.get(id));
      if (!active.has(id)) active.set(id, loadFresh(id).finally(() => active.delete(id)));
      return active.get(id);
    },
    /** A new text version makes earlier copies unreachable, so they can go. */
    async cleanup() {
      if (!cacheStorage) return;
      try {
        for (const name of await cacheStorage.keys()) {
          if (name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME) await cacheStorage.delete(name);
        }
      } catch { /* Harmless; only leaves an old copy behind. */ }
    },
  };
}
