// Representative text for reader tests: a perek boundary, a long verse, textual breaks,
// and verses missing from one side. Words carry their reference, so tests can see misplacement.
export const torahWord = ref => `תורה-${ref}`;
export const targumWord = ref => `תרגום-${ref}`;
const LONG = Array.from({ length: 400 }, () => 'וַיְדַבֵּ֣ר').join(' ');

export const ALIYOT = [['1:1', '1:4'], ['1:5', '2:3'], ['2:4', '2:5'], ['2:6', '2:6'], ['2:7', '2:7'], ['2:8', '2:8'], ['2:9', '2:10']];
const VERSE_COUNTS = { 1: 6, 2: 10 };

function refs() {
  const all = [];
  for (const [chapter, count] of Object.entries(VERSE_COUNTS)) {
    for (let verse = 1; verse <= count; verse += 1) all.push(`${chapter}:${verse}`);
  }
  return all;
}

export function parshaFixture(id = 'Noach', { missingTargum = [], missingTorah = [], prefix = '' } = {}) {
  const torah = refs().filter(ref => !missingTorah.includes(ref)).map(ref => {
    if (ref === '1:2') return [ref, [`${prefix}${torahWord(ref)}`, ['samekh']]];
    if (ref === '1:4') return [ref, [`${prefix}${torahWord(ref)}`, ['pe']]];
    if (ref === '1:6') return [ref, [`${prefix}${torahWord(ref)} ${LONG}`]];
    if (ref === '2:1') return [ref, [['big', 'וַ'], `${prefix}${torahWord(ref)}`, ['pe'], 'המשך']];
    return [ref, `${prefix}${torahWord(ref)}`];
  });
  const onkelos = refs().filter(ref => !missingTargum.includes(ref)).map(ref => [ref, ref === '1:3'
    ? [`${prefix}${targumWord(ref)} `, ['note', "(נ''י שינוי)"]]
    : `${prefix}${targumWord(ref)}`]);
  return { format: 1, id, book: 'Genesis', aliyot: ALIYOT, verseCounts: VERSE_COUNTS, torah, onkelos };
}

/** Serves fixtures instead of the shipped files. `hold` lets a test finish responses out of order. */
export async function mockText(page, overrides = {}) {
  const requests = [];
  const held = new Map();
  const failures = new Set();
  await page.route('**/chumash/v1/*.json', async route => {
    const slug = new URL(route.request().url()).pathname.split('/').pop().replace('.json', '');
    requests.push(slug);
    if (held.has(slug)) await held.get(slug).promise;
    if (failures.has(slug)) return route.abort();
    const body = JSON.stringify(overrides[slug] || parshaFixture(slugToId[slug] || slug));
    return route.fulfill({ status: 200, contentType: 'application/json', body });
  });
  return {
    requests,
    fail: slug => failures.add(slug),
    recover: slug => failures.delete(slug),
    hold(slug) {
      let release;
      const promise = new Promise(resolve => { release = resolve; });
      held.set(slug, { promise });
      return () => { held.delete(slug); release(); };
    },
  };
}

const slugToId = {
  noach: 'Noach', bereshit: 'Bereshit', 'lech-lecha': 'Lech-Lecha', vayera: 'Vayera', toldot: 'Toldot',
  'chayei-sara': 'Chayei Sara', tazria: 'Tazria', metzora: 'Metzora',
};

export const positionKey = (id, owner = 'guest', year = 5787) => `shnaim-mikra-reader-position:${owner}:${year}:${id}`;

/** A real touch stroke through the browser's input pipeline, so touch-action applies. */
export async function touchStroke(page, from, to, { steps = 6, stepDelay = 16 } = {}) {
  const client = await page.context().newCDPSession(page);
  const point = (x, y) => [{ x, y, id: 1 }];
  await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: point(from.x, from.y) });
  for (let step = 1; step <= steps; step += 1) {
    const x = from.x + (to.x - from.x) * step / steps, y = from.y + (to.y - from.y) * step / steps;
    await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: point(x, y) });
    await new Promise(resolve => setTimeout(resolve, stepDelay));
  }
  await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await client.detach();
}
