import { wholeReadingPatch } from '../src/readings.js';

export const checkedReadings = (...readings) => Object.assign({},
  ...readings.map(reading => wholeReadingPatch(reading, true)));
