export const COMMENTARIES = ['onkelos', 'rashi'];
export const READINGS = ['mikra1', 'mikra2', ...COMMENTARIES];
export const ALIYAH_COUNT = 7;
export const ALIYAH_NAMES = ['Kohen', 'Levi', 'Shlishi', "Rivi'i", 'Chamishi', 'Shishi', "Shevi'i"];
export const aliyahField = (reading, index) => `${reading}_${index + 1}`;
export const ALIYAH_FIELDS = READINGS.flatMap(reading =>
  Array.from({ length: ALIYAH_COUNT }, (_, index) => aliyahField(reading, index)));
export const readingChecks = (progress, reading) => Array.from({ length: ALIYAH_COUNT }, (_, index) =>
  progress?.[aliyahField(reading, index)] === true);
export const readingCount = (progress, reading) => readingChecks(progress, reading).filter(Boolean).length;
export const readingComplete = (progress, reading) => readingCount(progress, reading) === ALIYAH_COUNT;
export const aliyahSteps = progress => readingCount(progress, 'mikra1') + readingCount(progress, 'mikra2')
  + Math.max(readingCount(progress, 'onkelos'), readingCount(progress, 'rashi'));
// A parsha uses one or the other. Its checks decide, and only an empty or tied
// parsha follows the fallback, so the choice syncs along with the checks.
export function chosenCommentary(progress, fallback = 'onkelos') {
  const onkelos = readingCount(progress, 'onkelos'), rashi = readingCount(progress, 'rashi');
  return rashi > onkelos ? 'rashi' : onkelos > rashi ? 'onkelos' : fallback;
}
export const otherCommentary = commentary => commentary === 'rashi' ? 'onkelos' : 'rashi';
// Swapping rather than moving keeps a hidden set from an old or conflicting edit,
// and switching back restores exactly what was there.
export function commentarySwapPatch(progress, from, to) {
  const source = readingChecks(progress, from), target = readingChecks(progress, to);
  return Object.fromEntries(source.flatMap((checked, index) => checked === target[index] ? [] : [
    [aliyahField(to, index), checked], [aliyahField(from, index), target[index]],
  ]));
}
export const hasReadingProgress = progress => READINGS.some(reading => readingCount(progress, reading) > 0);

export const normalizeProgress = (progress = {}) => Object.fromEntries(
  ALIYAH_FIELDS.filter(field => progress[field] === true).map(field => [field, true]));
export const readingPatch = patch => Object.fromEntries(
  ALIYAH_FIELDS.filter(field => typeof patch[field] === 'boolean').map(field => [field, patch[field]]));
export const wholeReadingPatch = (reading, checked) => Object.fromEntries(
  Array.from({ length: ALIYAH_COUNT }, (_, index) => [aliyahField(reading, index), checked]));
export const applyReadingPatch = (progress, patch) => normalizeProgress({ ...progress, ...readingPatch(patch) });
