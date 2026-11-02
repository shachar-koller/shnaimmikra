import test from 'node:test';
import assert from 'node:assert/strict';
import { TextError, createTextLoader, resolveParsha, textSlug, textUrl } from '../src/chumash-text.js';
import {
  aliyahCompletionPatch, cleanPosition, createReaderStore, isMarked, mikraPatch, pasukLocation,
  resolvePosition, startPosition, stepPasuk, swipeDirection,
} from '../src/reader-model.js';
import { parshaFixture, targumWord, torahWord } from './reader-fixtures.js';

const parsha = resolveParsha(parshaFixture(), 'Noach');
const memoryStorage = () => {
  const items = new Map();
  return { getItem: key => items.get(key) ?? null, setItem: (key, value) => items.set(key, value), items };
};
const ok = body => ({ ok: true, status: 200, json: async () => body, clone: () => ok(body) });

test('torah and targum pair by reference, not by position in the file', () => {
  // With 1:3 absent, every later targum verse would be off by one if paired by array position.
  const resolved = resolveParsha(parshaFixture('Noach', { missingTargum: ['1:3'] }), 'Noach');
  const verses = resolved.aliyot[0].verses;
  assert.deepEqual(verses.map(verse => verse.ref), ['1:1', '1:2', '1:3', '1:4']);
  assert.equal(verses[2].onkelos, null);
  assert.deepEqual(verses[2].torah, [torahWord('1:3')]);
  assert.deepEqual(verses[3].onkelos, [targumWord('1:4')]);
});

test('an aliyah runs across a perek boundary and a verse missing from the torah stays visible as missing', () => {
  assert.deepEqual(parsha.aliyot[1].verses.map(verse => verse.ref), ['1:5', '1:6', '2:1', '2:2', '2:3']);
  const resolved = resolveParsha(parshaFixture('Noach', { missingTorah: ['2:2'] }), 'Noach');
  assert.equal(resolved.aliyot[1].verses[3].torah, null);
});

test('text for another parsha, a damaged file, or impossible ranges are rejected', () => {
  assert.throws(() => resolveParsha(parshaFixture('Noach'), 'Bereshit'), TextError);
  assert.throws(() => resolveParsha({ format: 2 }, 'Noach'), TextError);
  assert.throws(() => resolveParsha(null, 'Noach'), TextError);
  assert.throws(() => resolveParsha({ ...parshaFixture(), aliyot: parshaFixture().aliyot.slice(0, 6) }, 'Noach'), TextError);
  assert.throws(() => resolveParsha({ ...parshaFixture(), aliyot: [...parshaFixture().aliyot.slice(0, 6), ['2:9', '2:99']] }, 'Noach'), TextError);
  assert.throws(() => resolveParsha({ ...parshaFixture(), torah: [] }, 'Noach'), TextError);
});

test('only known formatting survives; unknown kinds stay literal text', () => {
  const raw = parshaFixture();
  raw.torah[0] = ['1:1', [['script', '<img src=x onerror=alert(1)>'], ['big', 'א'], { nope: 1 }, ['pe']]];
  const verse = resolveParsha(raw, 'Noach').aliyot[0].verses[0].torah;
  assert.deepEqual(verse, ['<img src=x onerror=alert(1)>', { format: 'big', text: 'א' }, { break: 'pe' }]);
});

test('file names stay distinct and url-safe for every kind of parsha name', () => {
  assert.equal(textSlug("Beha'alotcha"), 'beha-alotcha');
  assert.equal(textUrl('Chayei Sara'), '/chumash/v1/chayei-sara.json');
});

test('the loader caches text, reuses a request in flight, and lets a failure be retried', async () => {
  let calls = 0, fail = true;
  const loader = createTextLoader({
    cacheStorage: null,
    request: async () => {
      calls += 1;
      if (fail) throw new Error('down');
      return ok(parshaFixture());
    },
  });
  await assert.rejects(loader.load('Noach'), error => error.kind === 'unavailable');
  assert.equal(loader.peek('Noach'), undefined);
  fail = false;
  const [first, second] = await Promise.all([loader.load('Noach'), loader.load('Noach')]);
  assert.equal(first, second);
  assert.equal(calls, 2);
  assert.equal((await loader.load('Noach')).parsha.id, 'Noach');
  assert.equal(calls, 2);
  assert.equal(first.saved, false, 'without a device cache, the text is not reported as saved');
});

test('going offline is told apart from a failed request, and a bad response is not cached', async () => {
  const offline = createTextLoader({ cacheStorage: null, isOnline: () => false, request: async () => { throw new Error('offline'); } });
  await assert.rejects(offline.load('Noach'), error => error.kind === 'offline');
  const missing = createTextLoader({ cacheStorage: null, request: async () => ({ ok: false, status: 404 }) });
  await assert.rejects(missing.load('Noach'), error => error.kind === 'unavailable');
  const html = createTextLoader({ cacheStorage: null, request: async () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError('<html>'); } }) });
  await assert.rejects(html.load('Noach'), error => error.kind === 'invalid');
});

test('text saved on the device loads without the network; a damaged copy is replaced', async () => {
  const saved = new Map();
  const cacheStorage = {
    open: async () => ({
      match: async url => saved.get(url),
      put: async (url, response) => { saved.set(url, response); },
      delete: async url => saved.delete(url),
    }),
    keys: async () => ['chumash-text-v0', 'chumash-text-v1', 'other'],
    delete: async name => { saved.set(`deleted:${name}`, true); },
  };
  let calls = 0;
  const request = async () => { calls += 1; return ok(parshaFixture()); };
  assert.equal((await createTextLoader({ cacheStorage, request }).load('Noach')).saved, true);
  assert.equal(calls, 1);
  assert.equal((await createTextLoader({ cacheStorage, request: async () => { throw new Error('offline'); } }).load('Noach')).saved, true);
  saved.set(textUrl('Noach'), { json: async () => { throw new Error('damaged'); } });
  await createTextLoader({ cacheStorage, request }).load('Noach');
  assert.equal(calls, 2);
  await createTextLoader({ cacheStorage, request }).cleanup();
  assert.equal(saved.get('deleted:chumash-text-v0'), true);
  assert.equal(saved.has('deleted:chumash-text-v1'), false);
  assert.equal(saved.has('deleted:other'), false);
});

test('a cache that cannot save still shows the text, without calling it saved', async () => {
  const cacheStorage = { open: async () => ({ match: async () => undefined, put: async () => { throw new Error('quota'); } }) };
  const result = await createTextLoader({ cacheStorage, request: async () => ok(parshaFixture()) }).load('Noach');
  assert.equal(result.parsha.id, 'Noach');
  assert.equal(result.saved, false);
});

test('stepping walks an aliyah, stops at its end, and goes back across an aliyah boundary', () => {
  const at = (aliyah, ref, extra = {}) => ({ aliyah, ref, part: 'first', end: false, ...extra });
  assert.deepEqual(stepPasuk(parsha, at(0, '1:1'), 1), at(0, '1:2'));
  assert.deepEqual(stepPasuk(parsha, at(1, '1:6'), 1), at(1, '2:1'), 'across a perek');
  assert.deepEqual(stepPasuk(parsha, at(0, '1:4'), 1), at(0, '1:4', { end: true }), 'the end comes before the next aliyah');
  const end = at(0, '1:4', { end: true });
  assert.equal(stepPasuk(parsha, end, 1), end);
  assert.deepEqual(stepPasuk(parsha, end, -1), at(0, '1:4'));
  assert.deepEqual(stepPasuk(parsha, at(1, '1:5'), -1), at(0, '1:4'));
  const first = at(0, '1:1');
  assert.equal(stepPasuk(parsha, first, -1), first);
  assert.deepEqual(stepPasuk(parsha, at(0, '1:2', { part: 'second' }), 1).part, 'first');
});

test('positions from storage are cleaned, and a verse from elsewhere restarts the aliyah', () => {
  assert.deepEqual(cleanPosition(null), startPosition());
  assert.deepEqual(cleanPosition({ aliyah: 9 }), startPosition());
  assert.deepEqual(cleanPosition({ aliyah: 2, ref: 5, part: 'x', end: 'yes' }), { aliyah: 2, ref: null, part: 'first', end: false });
  assert.deepEqual(resolvePosition(parsha, { aliyah: 1, ref: '2:1', part: 'targum' }), { aliyah: 1, ref: '2:1', part: 'targum', end: false });
  assert.deepEqual(resolvePosition(parsha, { aliyah: 1, ref: '99:1', part: 'targum' }), { aliyah: 1, ref: '1:5', part: 'first', end: false });
  assert.deepEqual(resolvePosition(parsha, startPosition(2)), { aliyah: 2, ref: '2:4', part: 'first', end: false });
  assert.deepEqual(pasukLocation(parsha, { aliyah: 1, ref: '2:1' }), { number: 3, total: 5 }, 'position in the aliyah, not the verse number');
});

test('only a quick, clearly horizontal stroke without a selection is a swipe, and rightward is forward', () => {
  const stroke = { dx: 120, dy: 5, ms: 200, width: 350 };
  assert.equal(swipeDirection(stroke), 1);
  assert.equal(swipeDirection({ ...stroke, dx: -120 }), -1);
  assert.equal(swipeDirection({ ...stroke, dx: 30 }), 0, 'a small drag');
  assert.equal(swipeDirection({ ...stroke, dy: 90 }), 0, 'mostly vertical');
  assert.equal(swipeDirection({ ...stroke, ms: 1200 }), 0, 'a slow press');
  assert.equal(swipeDirection({ ...stroke, selecting: true }), 0, 'selecting text');
});

test('completion patches touch only the fields they name', () => {
  assert.deepEqual(aliyahCompletionPatch(2), { mikra1_3: true, mikra2_3: true, onkelos_3: true });
  assert.deepEqual(mikraPatch('mikra2', 0), { mikra2_1: true });
  assert.throws(() => mikraPatch('onkelos', 0));
  assert.equal(isMarked({ mikra1_3: true, mikra2_3: true }, aliyahCompletionPatch(2)), false);
  assert.equal(isMarked({ mikra1_3: true, mikra2_3: true, onkelos_3: true, rashi_1: true }, aliyahCompletionPatch(2)), true);
});

test('bookmarks are scoped to guest or account, cycle, and parsha, and modes to guest or account', () => {
  const storage = memoryStorage();
  const store = createReaderStore(() => storage, () => memoryStorage());
  const position = { aliyah: 3, ref: '2:6', part: 'targum', end: false };
  store.savePosition(null, 5787, 'Noach', position);
  assert.deepEqual(store.position(null, 5787, 'Noach'), position);
  assert.deepEqual(store.position('account', 5787, 'Noach'), startPosition());
  assert.deepEqual(store.position(null, 5786, 'Noach'), startPosition());
  assert.deepEqual(store.position(null, 5787, 'Bereshit'), startPosition());
  assert.equal(store.mode(null), 'flow');
  store.saveMode(null, 'cards');
  assert.equal(store.mode(null), 'cards');
  assert.equal(store.mode('account'), 'flow');
  assert.ok([...storage.items.keys()].every(key => key.startsWith('shnaim-mikra-reader-')), 'kept apart from progress');
});

test('the reader keeps working for this visit when storage throws or holds junk', () => {
  const broken = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); } };
  const store = createReaderStore(() => broken, () => broken);
  const position = { aliyah: 1, ref: '2:1', part: 'first', end: false };
  assert.equal(store.savePosition(null, 5787, 'Noach', position), false);
  assert.deepEqual(store.position(null, 5787, 'Noach'), position);
  assert.equal(store.saveMode(null, 'classic'), false);
  assert.equal(store.mode(null), 'classic');
  store.remember(null, 5787, 'Noach');
  assert.equal(store.resume(null), null);
  const unreachable = createReaderStore(() => { throw new Error('SecurityError'); }, () => { throw new Error('SecurityError'); });
  assert.deepEqual(unreachable.position(null, 5787, 'Noach'), startPosition());
  const junk = memoryStorage();
  junk.setItem('shnaim-mikra-reader-position:guest:5787:Noach', '{nope');
  junk.setItem('shnaim-mikra-reader-mode:guest', 'hologram');
  const reading = createReaderStore(() => junk, () => junk);
  assert.deepEqual(reading.position(null, 5787, 'Noach'), startPosition());
  assert.equal(reading.mode(null), 'flow');
});

test('a reload resumes only for the same guest or account', () => {
  const session = memoryStorage();
  const store = createReaderStore(() => memoryStorage(), () => ({ ...session, removeItem: key => session.items.delete(key) }));
  store.remember('account', 5787, 'Noach');
  assert.deepEqual(store.resume('account'), { owner: 'account', year: 5787, id: 'Noach' });
  assert.equal(store.resume(null), null);
  assert.equal(store.resume('other'), null);
  store.forget();
  assert.equal(store.resume('account'), null);
});
