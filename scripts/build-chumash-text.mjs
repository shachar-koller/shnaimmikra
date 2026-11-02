// Regenerates public/chumash from Sefaria. Run by hand with `npm run build:text`;
// neither the app build nor the tests call it, so neither needs the network.
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { TEXT_VERSION, textSlug } from '../src/chumash-text.js';
import { assertContinuous, parseOnkelosVerse, parseRange, parseTorahVerse, refsInRange, trackerId } from './chumash-source.mjs';

const BOOKS = ['Genesis', 'Exodus', 'Leviticus', 'Numbers', 'Deuteronomy'];
const TORAH = { title: 'Miqra according to the Masorah', license: 'CC-BY-SA' };
const onkelosOf = book => ({ title: `Onkelos ${book}`, license: 'Public Domain' });
const OUTPUT = new URL(`../public/chumash/v${TEXT_VERSION}/`, import.meta.url);

async function json(url) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`${response.status} for ${url}`);
      return await response.json();
    } catch (error) {
      if (attempt === 3) throw error;
      await new Promise(resolve => setTimeout(resolve, attempt * 1000));
    }
  }
}

async function version(ref, { title, license }) {
  const query = encodeURIComponent(`hebrew|${title}`);
  const body = await json(`https://www.sefaria.org/api/v3/texts/${encodeURIComponent(ref)}?version=${query}`);
  const found = body.versions?.[0];
  if (found?.versionTitle !== title) throw new Error(`${title} is missing for ${ref}`);
  // A licensing change must be read by a person before it is shipped.
  if (license && found.license !== license) throw new Error(`${title} is now licensed ${found.license}`);
  return found;
}

const letters = text => text.replace(/[^א-ת]/g, '');
const plainOf = verse => (typeof verse === 'string' ? [verse] : verse)
  .map(part => typeof part === 'string' ? part : part[1] || '').join('');

const report = { verses: 0, pe: 0, samekh: 0, parshiyos: 0, unmatchedOnkelos: 0, comparison: [] };
const manifest = { format: 1, version: TEXT_VERSION, retrieved: new Date().toISOString().slice(0, 10), parshiyos: [] };
const files = new Map();

for (const book of BOOKS) {
  const [torahSource, onkelosSource, index, other] = await Promise.all([
    version(book, TORAH),
    version(`Onkelos ${book}`, onkelosOf(book)),
    json(`https://www.sefaria.org/api/v2/raw/index/${book}`),
    // Used only as a check that this edition's verses line up with a second one.
    version(`Onkelos ${book}`, { title: 'Sifsei Chachomim Chumash, Metsudah Publications, 2009' }),
  ]);
  manifest.sources ||= {
    torah: { title: torahSource.versionTitle, license: torahSource.license, source: torahSource.versionSource },
    onkelos: { title: 'Onkelos (Torat Emet)', license: onkelosSource.license, source: onkelosSource.versionSource },
    aliyot: { title: 'Sefaria Parasha index', source: 'https://www.sefaria.org/api/v2/raw/index/Genesis' },
  };
  const counts = torahSource.text.map(chapter => chapter.length);
  if (JSON.stringify(counts) !== JSON.stringify(onkelosSource.text.map(chapter => chapter.length))) {
    report.unmatchedOnkelos += 1;
    console.warn(`${book}: Torah and Onkelos verse counts differ`);
  }
  const torah = new Map(), onkelos = new Map();
  torahSource.text.forEach((chapter, c) => chapter.forEach((verse, v) => {
    if (verse?.trim()) torah.set(`${c + 1}:${v + 1}`, parseTorahVerse(verse));
  }));
  onkelosSource.text.forEach((chapter, c) => chapter.forEach((verse, v) => {
    if (verse?.trim()) onkelos.set(`${c + 1}:${v + 1}`, parseOnkelosVerse(verse));
  }));
  const parshiyos = index.alt_structs.Parasha.nodes.map(node => ({
    id: trackerId(node.sharedTitle),
    aliyot: node.refs.map(ref => parseRange(ref, book)),
  }));
  assertContinuous(parshiyos, counts, book);

  let differing = 0;
  for (const [ref] of torah) {
    const [c, v] = ref.split(':').map(Number);
    const a = letters(plainOf(onkelos.get(ref) || ''));
    const b = letters(String(other.text[c - 1]?.[v - 1] || '').replace(/<[^>]+>/g, ''));
    if (Math.abs(a.length - b.length) > Math.max(a.length, b.length) * .4) differing += 1;
  }
  report.comparison.push(`${book}: ${differing} verses differ strongly between the two Onkelos editions`);

  for (const { id, aliyot } of parshiyos) {
    const refs = aliyot.flatMap(range => refsInRange(range, counts));
    const chapters = [...new Set(refs.map(ref => ref.split(':')[0]))];
    const pick = source => refs.filter(ref => source.has(ref)).map(ref => [ref, source.get(ref)]);
    const file = {
      format: 1, id, book, aliyot,
      verseCounts: Object.fromEntries(chapters.map(chapter => [chapter, counts[chapter - 1]])),
      torah: pick(torah), onkelos: pick(onkelos),
    };
    if (file.torah.length !== refs.length) throw new Error(`${id}: Torah text is incomplete`);
    report.unmatchedOnkelos += refs.length - file.onkelos.length;
    report.verses += refs.length;
    report.parshiyos += 1;
    for (const [, verse] of file.torah) for (const part of verse) {
      if (part[0] === 'pe' && part.length === 1) report.pe += 1;
      if (part[0] === 'samekh' && part.length === 1) report.samekh += 1;
    }
    manifest.parshiyos.push({ id, file: `${textSlug(id)}.json`, verses: refs.length });
    files.set(`${textSlug(id)}.json`, `${JSON.stringify(file)}\n`);
  }
}
// Written only after every book has passed, so a failed run leaves the shipped text alone.
await rm(OUTPUT, { recursive: true, force: true });
await mkdir(OUTPUT, { recursive: true });
files.set('manifest.json', `${JSON.stringify(manifest, null, 2)}\n`);
for (const [name, content] of files) await writeFile(new URL(name, OUTPUT), content);
console.log(JSON.stringify(report, null, 2));
