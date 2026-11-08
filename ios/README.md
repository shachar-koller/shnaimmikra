# Shnayim Mikra for iOS

A native SwiftUI version of the web app, using the same Supabase account, progress and settings. Sign in on both and they stay in sync.

## Build and test without local Xcode

The [iOS Simulator workflow](https://github.com/shachar-koller/shnaimmikra/actions/workflows/ios-simulator.yml)
runs on a standard GitHub-hosted `macos-15` runner. It is manual only:
open the workflow, choose **Run workflow**, and select the branch to validate.
Commit and push your changes first so the runner sees them. You can also use
GitHub CLI from any machine:

```bash
gh workflow run ios-simulator.yml --ref main
gh run list --workflow ios-simulator.yml --branch main --limit 5
gh run view <run-id>
gh run view <run-id> --log-failed
```

Check the run's commit SHA against the commit you pushed. A successful run means
all `ShnayimCore` tests passed on macOS and the SwiftUI app compiled for the iOS
Simulator. There are no app UI test targets yet. Logs and the Xcode result bundle
are available in the run's diagnostics artifact for three days.

Code signing is explicitly disabled. No Apple account, signing certificate,
provisioning profile, or Supabase secrets are needed; the app builds with its
existing local-only fallback. This validates compilation and core logic; it
doesn't launch the app or test live account access.

Standard GitHub-hosted runners are free while this repository is public. The
workflow skips private repositories; ask before enabling anything that incurs
charges or configuring Apple Developer signing. Each job has a 25-minute limit.
Use this pipeline for future SwiftUI changes and limit debugging to five CI runs
per request, including reruns.

## Run locally (optional)

You need a Mac with Xcode 16 or later. The app runs on iOS 17 and later.

1. From the repository root, write the Supabase settings from the web app's `.env`:

   ```bash
   npm run ios:config
   ```

   This creates `ios/Config/Supabase.xcconfig`, which is not committed. Without it the app still works, with progress on this device only and no sign-in.
2. Open `ios/ShnayimMikra.xcodeproj`. Xcode fetches [supabase-swift](https://github.com/supabase/supabase-swift) the first time.
3. Choose an iOS Simulator and run. Simulator builds do not need an Apple Developer team.

Running on a physical phone requires separate signing setup; the CI workflow does not configure it.

### Google sign-in

Sign-in uses Supabase's Google provider in the system's secure web sheet, then returns to the app at `shnayimmikra://auth-callback`. Add that URL once in the Supabase dashboard under **Authentication → URL Configuration → Redirect URLs**. Until then, signing in returns an error and guest use still works.

## How it's built

- **`ShnayimCore/`** is a Swift package with everything that has no UI: the parsha calendar, progress rules, saved data, pending edits and sync, backups, the Chumash text and the reader's positions. It's a port of `src/model.js`, `readings.js`, `storage.js`, `sync.js`, `backup.js`, `progress.js`, `preferences.js`, `chumash-text.js` and `reader-model.js`, and it builds on Linux as well as macOS.
- **`ShnayimMikra/`** is the SwiftUI app: the Tracker, Chumash, Settings and Account tabs, the Supabase client, notifications and haptics.

The parsha calendar comes from Hebcal through the web app's own `schedule()` and is shipped as data (`ShnayimCore/Sources/ShnayimCore/Resources/calendar.json`, cycles 5760–5900), so both apps always agree on every Shabbos. Hebrew parsha names and the 20 theme palettes are generated from `names.js` and `style.css` the same way. After changing any of those, run:

```bash
npm run build:ios-data
```

The Chumash text isn't copied: the Xcode project bundles `public/chumash` directly, so `npm run build:text` updates both apps.

## Tests

```bash
npm run test:ios
```

This needs a Swift toolchain (Xcode on a Mac, or [swift.org](https://www.swift.org/install/) on Linux). Besides ports of the web app's storage, sync and reader tests, `WebParityTests` compares the Swift code with what the web app's JavaScript returns for every day from 2025 to 2030 and for names, saved data, backups and the text export. `npm run build:ios-data` refreshes those expectations from the JavaScript.

The SwiftUI app itself has no automated tests.

## Differences from the web app

- **Reminders** are notifications on the device rather than a calendar file. The days and time are the same synced setting, so choosing them on the web also schedules them on the phone once notifications are allowed there.
- **Text** for every parsha is included in the app, so the reader works offline without opening each parsha first.
- **Tab bar glass** isn't a setting: the app uses the system tab bar, which is Liquid Glass on iOS 26. The web app's glass level still syncs and is left as it was.
- **Reader places and the last reading mode** stay on each device, as they do on the web. A fresh launch opens the Tracker.
- Backups are the same files, so either app can restore the other's.
