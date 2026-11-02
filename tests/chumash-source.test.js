import test from 'node:test';
import assert from 'node:assert/strict';
import { assertContinuous, parseOnkelosVerse, parseRange, parseTorahVerse, refsInRange, trackerId } from '../scripts/chumash-source.mjs';

test('layout padding and footnotes go; thin spaces, vocalization and cantillation stay', () => {
  assert.deepEqual(parseTorahVerse('וַיְהִי־עֶ֥רֶב&thinsp;<b>׀</b> אֶחָֽד׃'), ['וַיְהִי־עֶ֥רֶב ', ['bold', '׀'], ' אֶחָֽד׃']);
  assert.equal(parseTorahVerse('מִנְּשֹֽׂא<sup class="footnote-marker">*</sup><i class="footnote">(בספרי <big>ס</big>)</i>׃'), 'מִנְּשֹֽׂא׃');
});

test('petuchah and setumah become explicit breaks, including in the middle of a verse', () => {
  assert.deepEqual(parseTorahVerse('יוֹם׃&nbsp;<span class="mam-spi-pe">{פ}</span><br>'), ['יוֹם׃', ['pe']]);
  assert.deepEqual(parseTorahVerse('לֵאמֹֽר׃&nbsp;<span class="mam-spi-samekh">{ס}</span>&nbsp;&nbsp;&nbsp;'), ['לֵאמֹֽר׃', ['samekh']]);
  assert.deepEqual(parseTorahVerse('יִשְׂרָאֵל׃&nbsp;<span class="mam-spi-pe">{פ}</span><br>וַיִּֽהְי֥וּ'), ['יִשְׂרָאֵל׃', ['pe'], 'וַיִּֽהְי֥וּ']);
});

test('ketiv and qere, letter sizes, and the inverted nun are kept', () => {
  assert.deepEqual(parseTorahVerse('הָאָ֖רֶץ <span class="mam-kq"><span class="mam-kq-k">(הוצא)</span> <span class="mam-kq-q">[הַיְצֵ֣א]</span></span> אִתָּ֑ךְ'),
    ['הָאָ֖רֶץ ', ['ketiv', '(הוצא)'], ' ', ['qere', '[הַיְצֵ֣א]'], ' אִתָּ֑ךְ']);
  assert.deepEqual(parseTorahVerse('<big>בְּ</big>רֵאשִׁ֖ית'), [['big', 'בְּ'], 'רֵאשִׁ֖ית']);
  assert.equal(parseTorahVerse('<span class="mam-kq-trivial">שִׁילֹ֔ה</span> וְל֖וֹ'), 'שִׁילֹ֔ה וְל֖וֹ');
  assert.equal(parseTorahVerse('<span class="mam-spi-invnun">׆</span>&nbsp;וַיְהִ֛י'), '׆ וַיְהִ֛י');
});

test('markup nobody has reviewed stops the build', () => {
  for (const source of ['<img src=x>', '<script>alert(1)</script>', '<span class="other">א</span>', 'א&copy;', 'א<b>ב', '</b>']) {
    assert.throws(() => parseTorahVerse(source), /Unrecognized|Unbalanced/, source);
  }
  assert.throws(() => parseOnkelosVerse('א<b>ב</b>'), /Unrecognized/);
});

test('onkelos variants become quiet notes without changing the words', () => {
  assert.equal(parseOnkelosVerse('בְּקַדְמִין בְּרָא'), 'בְּקַדְמִין בְּרָא');
  assert.deepEqual(parseOnkelosVerse("מִן (נ''י אֲרֵי) יָת"), ['מִן ', ['note', "(נ''י אֲרֵי)"], ' יָת']);
});

test('all three spellings of an aliyah range parse, and a wrong book is refused', () => {
  assert.deepEqual(parseRange('Genesis 1:1-2:3', 'Genesis'), ['1:1', '2:3']);
  assert.deepEqual(parseRange('Genesis 2:4-2:19', 'Genesis'), ['2:4', '2:19']);
  assert.deepEqual(parseRange('Deuteronomy 33:1–7', 'Deuteronomy'), ['33:1', '33:7']);
  assert.throws(() => parseRange('Exodus 1:1-1:2', 'Genesis'));
  assert.equal(trackerId('Lech Lecha'), 'Lech-Lecha');
  assert.equal(trackerId("V'Zot HaBerachah"), 'Vezot Haberakhah');
  assert.equal(trackerId('Noach'), 'Noach');
});

test('a gap, an overlap, or a shortfall in the boundaries is caught', () => {
  const counts = [3, 2];
  const aliyot = [['1:1', '1:1'], ['1:2', '1:2'], ['1:3', '1:3'], ['2:1', '2:1'], ['2:2', '2:2']];
  assert.deepEqual(refsInRange(['1:3', '2:1'], counts), ['1:3', '2:1']);
  assert.throws(() => refsInRange(['2:2', '2:9'], counts), /past the end/);
  const parsha = ranges => [{ id: 'Test', aliyot: ranges }];
  const big = [6, 1];
  const full = [['1:1', '1:1'], ['1:2', '1:2'], ['1:3', '1:3'], ['1:4', '1:4'], ['1:5', '1:5'], ['1:6', '1:6'], ['2:1', '2:1']];
  assert.doesNotThrow(() => assertContinuous(parsha(full), big, 'Test'));
  assert.throws(() => assertContinuous(parsha(aliyot), counts, 'Test'), /aliyos/);
  assert.throws(() => assertContinuous(parsha([...full.slice(0, 2), ['1:4', '1:4'], ...full.slice(3)]), big, 'Test'), /expected an aliyah at 1:3/);
  assert.throws(() => assertContinuous(parsha([...full.slice(0, 2), ['1:2', '1:3'], ...full.slice(3)]), big, 'Test'), /expected an aliyah at 1:3/);
  assert.throws(() => assertContinuous(parsha([...full.slice(0, 6), ['1:6', '1:6']]), big, 'Test'), /expected an aliyah at 2:1/);
  assert.throws(() => assertContinuous(parsha(full), [6, 2], 'Test'), /not fully covered/);
});
