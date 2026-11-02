import { wholeReadingPatch } from '../src/readings.js';

export const checkedReadings = (...readings) => Object.assign({},
  ...readings.map(reading => wholeReadingPatch(reading, true)));

// The switch sits at the bottom of the third row's unfolded checklist.
export async function switchCommentary(page) {
  const row = page.locator('[data-expand="onkelos"], [data-expand="rashi"]');
  if (await row.getAttribute('aria-expanded') === 'false') await row.click();
  const button = page.locator('#switch-commentary');
  // The button moves while the panel opens, so a press and release can land on different elements.
  await button.evaluate(element => Promise.allSettled(
    element.closest('.aliyah-panel').getAnimations({ subtree: true }).map(animation => animation.finished)));
  await button.click();
}
