# iOS validation

After changing Swift or SwiftUI code, push the changes to the existing repository
and validate that commit with `.github/workflows/ios-simulator.yml`:

```sh
gh workflow run ios-simulator.yml --ref <branch>
gh run list --workflow ios-simulator.yml --branch <branch> --limit 5
gh run view <run-id>
gh run view <run-id> --log-failed
```

Inspect the run's head SHA to confirm it validates the intended commit. The
workflow builds the iOS Simulator app with signing disabled and runs all existing
ShnayimCore tests on the macOS runner. There are currently no app UI test targets.
Do not require local Xcode for validation. Limit CI debugging to five runs per
request, counting reruns. Keep the workflow manually triggered. Ask the user
before incurring charges or configuring Apple Developer signing. Preserve
unrelated work and continue using this repository and project.
