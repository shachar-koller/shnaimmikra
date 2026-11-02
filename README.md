# Shnayim Mikra

A weekly Shnayim Mikra tracker built with vanilla JavaScript, Vite, Hebcal, and Supabase. Google sign-in is the recommended way to use the app: progress saves to your account and follows you across devices. Guest access is available as a secondary option.

## Run locally

Use Node.js 22 or newer:

```sh
npm ci
npm run dev
```

Open the URL printed by Vite. `npm run build` creates the production app in `dist/`; `npm run preview` serves that build. The service worker caches the app after a production visit, so it can reopen offline.

For Google sign-in and account sync, copy `.env.example` to `.env` and follow [Supabase setup](supabase/README.md). Apply the aliyah progress migration before deploying this version. Never put a service-role key in frontend environment variables.

## Aliyah tracking

Mikra I, Mikra II, and Targum are each folded by default. Tapping its row unfolds a checklist of seven
independently checkable aliyos; progress stays visible while folded. The checkbox on the row is
separate: from empty or partial it marks all seven complete, and a completed one
clears all seven. Checking one aliyah does
not check earlier ones or close the checklist.

The third row is Targum or your peirush (Rashi unless you rename it), one or the other for each parsha.
**Settings → After Mikra** picks the default for parshiyos you haven't started. **Switch to … for this parsha**,
at the bottom of the unfolded checklist, changes just that parsha and carries its checks over. A parsha with
checks uses whichever one holds them, so the choice syncs with them; a switch made before checking anything
is remembered on that device. If a parsha ever has both sets, from old data or offline edits on two devices,
the further-along one shows and counts, and a tie follows your choice for that parsha or the default.
Weekly totals count completed sections, and yearly/sefer totals
count completed parshiyos. Partial aliyah progress appears below the weekly total
and in the parsha list.

Double weeks keep separate progress and seven study aliyos for each constituent
parsha, using standalone divisions rather than the combined Shabbos leyning.
Maftir is not an eighth checkbox. Verse ranges and text are not included.
Expansion choices stay in the current visit; the selected commentary view survives
reloads in the current tab and is separate for each account, cycle, and parsha.

Two alternative aliyah layouts that were tried and not chosen are kept in
[archive/aliyah-layouts](archive/aliyah-layouts/README.md). The app doesn't use them.

## Progress and accounts

- New visitors see a welcome screen with **Continue with Google** as the primary action and **Continue without an account** as a secondary option. Returning signed-in users go straight to their tracker; an explicit guest choice is remembered in this browser. Signing out returns to the welcome screen.
- Guest progress stays in the `shnaim-mikra-v1` browser-storage record.
- Each account has its own `shnaim-mikra-v2:account:<user-id>` record. Signing out leaves account progress separate from guest progress. Account caches and pending changes stay associated with their original account.
- Signing in never automatically uploads guest or another account's cache. Use **Account → Import guest progress** to preview and explicitly add guest checkmarks to the current account.
- Progress changes and their pending sync operations are saved together before sending. Unchecking is an explicit `false` change, not the absence of a record.
- Only edited aliyah fields are sent. Changes to different aliyos on different devices are preserved. If two devices edit the same field, the last write received by the server wins. A genuinely pending offline edit can therefore supersede a newer online edit when it reconnects; old cached checkmarks by themselves are never uploaded. Whole-section shortcuts explicitly edit all seven cells.
- Failed operations survive reloads. Sync retries with backoff, on reconnect, on returning to the app, and every minute while visible. The Account tab shows the sync state and offers **Sync now**.
- Reset requests are also durable: once confirmed and saved locally, a failed cloud deletion retries when connected. Stale caches on other devices are replaced on their next refresh. Explicit edits made after a reset request remain pending.
- Browser storage and Web Locks coordinate tabs on the same origin where available. This is account separation, not encryption against someone with access to your browser profile.

Calendar dates use the browser's local date. Israel and Diaspora have separate schedules; Simchas Torah belongs to the cycle ending that day. An open app refreshes after the local date changes.

## Backups

Settings offers the readable text export and a versioned JSON backup. Version 2 JSON includes complete and partial aliyah progress for all locally known cycles, calendar, theme, and the custom commentary label. Only the current aliyah format is supported. Exports exclude authentication tokens, account identifiers, and sync internals.

**Restore JSON backup** validates the file and shows a preview before importing. Restore adds checkmarks without clearing existing ones and restores the backup's settings. Guest import only adds checkmarks. Both work offline; account imports sync later. If an export cannot reach the cloud, it exports cached progress and pending edits and says so. An empty cache on a new device cannot include cloud-only history while offline.

## Source layout

- `src/main.js`: startup and service-worker registration.
- `src/ui.js`: tab bar, tracker dashboard, Settings and Account pages, and dialogs.
- `src/morph.js`: patches the DOM in place on each render, so CSS transitions can run. Assign listeners with `.onclick`; `addEventListener` would stack up across renders.
- `src/motion.js`: one-shot animations, including the 3/3 celebration. All of them respect reduced motion.
- `src/model.js`, `src/names.js`, `src/progress.js`: calendar, display names, completion, and text export.
- `src/readings.js`: seven-aliyah helpers, completion, and sparse progress patches.
- `src/storage.js`: guest/account storage and durable pending operations.
- `src/sync.js`: Supabase adapter and serialized retrying synchronization.
- `src/session.js`: authentication, account switching, and refresh lifecycle.
- `src/backup.js`: portable backup format, validation, and preview summary.

Existing checks remain available with `npm test` and `npm run test:ui`. There is no CI configuration. Browser checks use Playwright (`npx playwright install chromium` if needed).

After starting a local Supabase stack and applying both migrations, run
`supabase db query --local --file tests/aliyah-database.sql` to verify sparse
upserts, independent cells, and RLS in a rolled-back transaction. Run
`node tests/aliyah-cloud.integration.js` to exercise real authenticated API writes
from two clients, account isolation, and reset. The integration script accepts
only a localhost Supabase URL and deletes its temporary users afterward.
