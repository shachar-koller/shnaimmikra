// Checks the shipped files themselves, so a bad regeneration cannot go unnoticed. No network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { TEXT_VERSION, resolveParsha, textSlug } from '../src/chumash-text.js';
import { DOUBLE_PARSHIYOS, schedule } from '../src/model.js';

const read = async name => JSON.parse(await readFile(new URL(`../public/chumash/v${TEXT_VERSION}/${name}`, import.meta.url), 'utf8'));
const trackerIds = [...new Set([5786, 5787, 5788, 5789, 5790, 5791, 5792].flatMap(year =>
  [false, true].flatMap(israel => schedule(year, israel).map(row => row.id))))];
const raw = new Map(await Promise.all(trackerIds.map(async id => [id, await read(`${textSlug(id)}.json`)])));
const parshiyos = trackerIds.map(id => resolveParsha(raw.get(id), id));
const plain = verse => verse.map(part => typeof part === 'string' ? part : part.text || '').join('');
const BOOK_COUNTS = { Genesis: 1533, Exodus: 1210, Leviticus: 859, Numbers: 1288, Deuteronomy: 956 };

test('every parsha the tracker can show has text, with seven aliyos and no maftir', () => {
  assert.equal(trackerIds.length, 54);
  for (const parsha of parshiyos) {
    assert.equal(parsha.aliyot.length, 7, parsha.id);
    assert.ok(parsha.aliyot.every(aliyah => aliyah.verses.length > 0), parsha.id);
  }
});

test('the whole Torah is covered once, in order, with no gaps or repeated verses', () => {
  const byBook = new Map();
  for (const parsha of parshiyos) {
    byBook.set(parsha.book, [...(byBook.get(parsha.book) || []), ...parsha.aliyot.flatMap(aliyah => aliyah.verses.map(verse => verse.ref))]);
  }
  assert.deepEqual([...byBook.keys()], Object.keys(BOOK_COUNTS));
  for (const [book, refs] of byBook) {
    assert.equal(refs.length, BOOK_COUNTS[book], book);
    assert.equal(new Set(refs).size, refs.length, `${book} repeats a verse`);
    let previous = [0, 0];
    for (const ref of refs) {
      const [chapter, verse] = ref.split(':').map(Number);
      assert.ok(chapter === previous[0] ? verse === previous[1] + 1 : chapter === previous[0] + 1 && verse === 1, `${book} jumps from ${previous} to ${ref}`);
      previous = [chapter, verse];
    }
  }
});

test('each half of a double week stands alone, joining the next without a gap or an overlap', () => {
  const find = id => parshiyos.find(parsha => parsha.id === id);
  for (const [first, second] of DOUBLE_PARSHIYOS) {
    const a = find(first), b = find(second);
    const lastOfFirst = a.aliyot[6].verses.at(-1), firstOfSecond = b.aliyot[0].verses[0];
    assert.equal(a.aliyot.length, 7, first);
    assert.equal(b.aliyot.length, 7, second);
    assert.notEqual(lastOfFirst.ref, firstOfSecond.ref);
    const next = lastOfFirst.verse === raw.get(first).verseCounts[lastOfFirst.chapter]
      ? `${lastOfFirst.chapter + 1}:1` : `${lastOfFirst.chapter}:${lastOfFirst.verse + 1}`;
    assert.equal(firstOfSecond.ref, next, `${first} into ${second}`);
  }
});

test('every verse has vocalized torah with cantillation and vocalized targum', () => {
  const verses = parshiyos.flatMap(parsha => parsha.aliyot.flatMap(aliyah => aliyah.verses));
  assert.equal(verses.length, 5846);
  for (const verse of verses) {
    assert.ok(verse.torah, `torah ${verse.ref}`);
    assert.ok(verse.onkelos, `targum ${verse.ref}`);
    assert.match(plain(verse.torah), /[ְ-ּ]/, `niqqud ${verse.ref}`);
    assert.match(plain(verse.onkelos), /[ְ-ּ]/, `targum niqqud ${verse.ref}`);
    assert.doesNotMatch(plain(verse.torah) + plain(verse.onkelos), /[<>&{}]/, `markup ${verse.ref}`);
  }
  const cantillated = verses.filter(verse => /[֑-֯]/.test(plain(verse.torah))).length;
  assert.equal(cantillated, verses.length);
});

test('known verses sit where they belong, in both languages', () => {
  const verse = (id, aliyah, ref) => parshiyos.find(parsha => parsha.id === id).aliyot[aliyah].verses.find(candidate => candidate.ref === ref);
  const letters = text => text.replace(/[^א-ת ]/g, '');
  const opening = verse('Bereshit', 0, '1:1');
  assert.equal(letters(plain(opening.torah)), 'בראשית ברא אלהים את השמים ואת הארץ');
  assert.equal(letters(plain(opening.onkelos)), 'בקדמין ברא יי ית שמיא וית ארעא');
  const closing = verse('Vezot Haberakhah', 6, '34:12');
  assert.match(letters(plain(closing.torah)), /לעיני כל ?ישראל$/);
  assert.match(letters(plain(closing.onkelos)), /ישראל/);
  assert.match(letters(plain(verse("Vaetchanan", 5, '6:4').torah)), /שמע ישראל/);
  assert.match(letters(plain(verse("Vaetchanan", 5, '6:4').onkelos)), /שמע ישראל/);
  assert.match(letters(plain(verse("Sh'lach", 6, '15:41').torah)), /אני יהוה אלהיכם/);
});

test('petuchah and setumah counts match the edition, and the mid-verse break in Reuven’s verse survives', () => {
  const parts = parshiyos.flatMap(parsha => parsha.aliyot.flatMap(aliyah => aliyah.verses.flatMap(verse => verse.torah)));
  assert.equal(parts.filter(part => part.break === 'pe').length, 291);
  assert.equal(parts.filter(part => part.break === 'samekh').length, 379);
  const reuven = parshiyos.find(parsha => parsha.id === 'Vayishlach').aliyot[5].verses.find(verse => verse.ref === '35:22').torah;
  assert.equal(reuven.findIndex(part => part.break === 'pe'), 1);
  assert.equal(reuven.length, 3);
});

test('the manifest records its sources and licenses', async () => {
  const manifest = await read('manifest.json');
  assert.equal(manifest.parshiyos.length, 54);
  assert.equal(manifest.sources.torah.title, 'Miqra according to the Masorah');
  assert.equal(manifest.sources.torah.license, 'CC-BY-SA');
  assert.equal(manifest.sources.onkelos.license, 'Public Domain');
});
