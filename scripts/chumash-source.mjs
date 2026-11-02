// Turns Sefaria's source strings into the small, safe format the app ships.
// A tag this does not recognize stops the build, so unreviewed markup never reaches readers.

// Sefaria's parasha titles, in Torah order, where they differ from the tracker's Hebcal ids.
const TRACKER_ID = { 'Lech Lecha': 'Lech-Lecha', "Ha'Azinu": "Ha'azinu", "V'Zot HaBerachah": 'Vezot Haberakhah' };
export const trackerId = title => TRACKER_ID[title] || title;

const FOOTNOTE = /<sup class="footnote-marker">[^<]*<\/sup><i class="footnote">[\s\S]*?<\/i>/g;
const ENTITIES = { nbsp: ' ', thinsp: ' ' };
const SPANS = { 'mam-kq': null, 'mam-kq-trivial': null, 'mam-spi-invnun': null, 'mam-kq-k': 'ketiv', 'mam-kq-q': 'qere' };
const STYLES = { big: 'big', small: 'small', b: 'bold' };
const BREAKS = { 'mam-spi-pe': 'pe', 'mam-spi-samekh': 'samekh' };

function compact(parts) {
  const merged = [];
  for (const part of parts) {
    if (typeof part === 'string' && typeof merged.at(-1) === 'string') merged[merged.length - 1] += part;
    else merged.push(part);
  }
  const cleaned = merged
    .map(part => typeof part === 'string' ? part.replace(/ {2,}/g, ' ') : part)
    .map((part, index, all) => {
      if (typeof part !== 'string') return part;
      let text = part;
      // Layout padding around a textual break belongs to the source's HTML, not its text.
      if (index === 0 || Array.isArray(all[index - 1]) && all[index - 1].length === 1) text = text.trimStart();
      if (index === all.length - 1 || Array.isArray(all[index + 1]) && all[index + 1].length === 1) text = text.trimEnd();
      return text;
    })
    .filter(part => part !== '');
  return cleaned.length === 1 && typeof cleaned[0] === 'string' ? cleaned[0] : cleaned;
}

/** One verse of Miqra according to the Masorah. */
export function parseTorahVerse(source) {
  const html = source.replace(FOOTNOTE, '');
  const parts = [];
  const open = [];
  for (const token of html.match(/<[^>]*>|&[a-z]+;|[^<&]+|[<&]/g) || []) {
    const context = open.at(-1);
    if (token.startsWith('<') && token.length > 1) {
      const tag = token.match(/^<(\/?)([a-z]+)(?: class="([a-z-]+)")?\s*>$/);
      if (!tag) throw new Error(`Unrecognized markup: ${token}`);
      const [, closing, name, className] = tag;
      if (closing) {
        if (!open.length) throw new Error(`Unbalanced markup: ${token}`);
        open.pop();
      } else if (name === 'br') {
        continue;
      } else if (name === 'span' && Object.hasOwn(BREAKS, className)) {
        parts.push([BREAKS[className]]);
        open.push({ kind: 'break' });
      } else if (name === 'span' && Object.hasOwn(SPANS, className)) {
        open.push({ kind: SPANS[className] });
      } else if (!className && Object.hasOwn(STYLES, name)) {
        open.push({ kind: STYLES[name] });
      } else {
        throw new Error(`Unrecognized markup: ${token}`);
      }
      continue;
    }
    if (context?.kind === 'break') continue;
    let text = token;
    if (token.startsWith('&')) {
      const entity = token.slice(1, -1);
      if (!Object.hasOwn(ENTITIES, entity)) throw new Error(`Unrecognized entity: ${token}`);
      text = ENTITIES[entity];
    }
    parts.push(context?.kind ? [context.kind, text] : text);
  }
  if (open.length) throw new Error('Unbalanced markup at the end of a verse');
  return compact(parts);
}

/** One verse of Targum Onkelos. Its parenthetical variant readings stay, marked as notes. */
export function parseOnkelosVerse(source) {
  if (/[<>&]/.test(source)) throw new Error(`Unrecognized markup: ${source}`);
  const parts = source.trim().split(/(\([^()]*\))/).filter(Boolean)
    .map(part => part.startsWith('(') ? ['note', part] : part);
  return compact(parts);
}

/** "Genesis 1:1-2:3", "Genesis 2:4-2:19", and "Deuteronomy 33:1–7" as [start, end] refs. */
export function parseRange(ref, book) {
  const match = ref.match(/^(.+?) (\d+):(\d+)(?:[-–](?:(\d+):)?(\d+))?$/);
  if (!match || match[1] !== book) throw new Error(`Unexpected aliyah reference: ${ref}`);
  const [, , chapter, verse, endChapter, endVerse] = match;
  return [`${chapter}:${verse}`, `${endChapter || chapter}:${endVerse || verse}`];
}

const nextRef = (ref, counts) => {
  const [chapter, verse] = ref.split(':').map(Number);
  return verse < counts[chapter - 1] ? `${chapter}:${verse + 1}`
    : chapter < counts.length ? `${chapter + 1}:1` : null;
};

/** Walks a range verse by verse, so that a gap in a source cannot go unnoticed. */
export function refsInRange([start, end], counts) {
  const refs = [];
  for (let ref = start; ; ref = nextRef(ref, counts)) {
    if (!ref) throw new Error(`Range ${start}-${end} runs past the end of the book`);
    refs.push(ref);
    if (ref === end) return refs;
  }
}

/** Every verse of the book once, in order, or an error naming the first problem. */
export function assertContinuous(parshiyos, counts, book) {
  let expected = '1:1';
  for (const { id, aliyot } of parshiyos) {
    if (aliyot.length !== 7) throw new Error(`${id} has ${aliyot.length} aliyos`);
    for (const range of aliyot) {
      if (range[0] !== expected) throw new Error(`${id}: expected an aliyah at ${expected}, found ${range[0]}`);
      expected = nextRef(refsInRange(range, counts).at(-1), counts);
    }
  }
  if (expected !== null) throw new Error(`${book} is not fully covered; it stops before ${expected}`);
}
