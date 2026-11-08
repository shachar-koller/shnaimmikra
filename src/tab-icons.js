// The iOS asset catalog is the source artwork for both platforms. Importing the
// SVGs as text keeps the web icons inline, themeable, and available offline.
import tracker from '../ios/ShnayimMikra/Assets.xcassets/TabTracker.imageset/TabTracker.svg?raw';
import trackerSelected from '../ios/ShnayimMikra/Assets.xcassets/TabTrackerSelected.imageset/TabTrackerSelected.svg?raw';
import chumash from '../ios/ShnayimMikra/Assets.xcassets/TabChumash.imageset/TabChumash.svg?raw';
import chumashSelected from '../ios/ShnayimMikra/Assets.xcassets/TabChumashSelected.imageset/TabChumashSelected.svg?raw';
import settings from '../ios/ShnayimMikra/Assets.xcassets/TabSettings.imageset/TabSettings.svg?raw';
import settingsSelected from '../ios/ShnayimMikra/Assets.xcassets/TabSettingsSelected.imageset/TabSettingsSelected.svg?raw';
import account from '../ios/ShnayimMikra/Assets.xcassets/TabAccount.imageset/TabAccount.svg?raw';
import accountSelected from '../ios/ShnayimMikra/Assets.xcassets/TabAccountSelected.imageset/TabAccountSelected.svg?raw';

const glyph = (source, variant) => source
  .replace('<svg ', `<svg class="tab-icon-${variant}" aria-hidden="true" focusable="false" `)
  .replaceAll('#000', 'currentColor');

const pair = (outline, selected) => glyph(outline, 'outline') + glyph(selected, 'selected');

export const TAB_ICONS = {
  tracker: pair(tracker, trackerSelected),
  chumash: pair(chumash, chumashSelected),
  settings: pair(settings, settingsSelected),
  account: pair(account, accountSelected),
};
