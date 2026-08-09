# Patches for branches this repo does not merge from

A `.patch` here is a change that belongs to a **different long-lived branch**, prepared on the
branch you are reading so the work is reviewable and does not get lost.

There is exactly one reason this directory exists: **`codemagic.yaml` lives only on
`ios-appstore`.** It is not on `main` and never has been (`git log --all -- codemagic.yaml`
shows every commit touching it on that branch). A session working on a feature branch cannot
edit a file that is not in its tree, and creating one would produce an add/add conflict the day
`ios-appstore` is merged. So the change is stored as a diff instead.

## `codemagic-ios-push-capability.patch`

> ## ⛔ APPLIED AND SUPERSEDED — do NOT re-apply this patch
>
> Landed on `ios-appstore` as `eb59e21` on 2026-08-09. **It shipped a broken assertion**, which
> failed the very next Codemagic run on a file that was correct:
>
> ```
> ios/App/App/App.entitlements: OK
> FATAL: com.apple.developer.associated-domains missing from ios/App/App/App.entitlements
> ```
>
> The verification loop below used `plutil -extract "$KEY" raw`, which cannot check that key for
> **two** reasons: `plutil -extract` splits its KEYPATH on `.`, so
> `com.apple.developer.associated-domains` is read as four nested keys and never resolves; and
> `raw` output cannot represent an array. `aps-environment` (no dots, scalar) passes either way,
> which is what made the check look sound. Fixed on `ios-appstore` in `d9688a6` by switching to
> `/usr/libexec/PlistBuddy -c "Print :$KEY"`, whose paths are `:`-separated and which prints
> arrays. **The live truth is `codemagic.yaml` on `ios-appstore`, not this file.**

Adds the iOS **push notifications** capability to the Codemagic build, and fixes a sharp edge in
the entitlement-injection step that was flagged in review on 2026-08-08.

* `aps-environment = production` in the generated `App.entitlements`, alongside the existing
  associated-domains array. Without it `PushNotifications.register()` resolves
  `registrationError` on device and no iOS token ever reaches the backend — from a build that
  succeeded.
* A `plutil -extract` check per key, so a missing capability fails the build instead of
  shipping silently, matching what the privacy-strings step already does.
* The `project.pbxproj` injection is now **idempotent** and no longer disarmed by an unrelated
  target. The old version skipped injection whenever the string `CODE_SIGN_ENTITLEMENTS`
  appeared anywhere in the file, then exited 1 with "not written" — so a future Capacitor
  template that ships that key for any target at all would have failed the build for a reason
  nobody could find. It now strips and re-adds only its own exact line, reports foreign ones,
  and warns if the App target does not have exactly two build configurations.

Applied against `origin/ios-appstore` (`f1785c0`) and verified: `git apply --check` clean, the
result is valid YAML, and the embedded Python was executed against a synthetic `project.pbxproj`
for three cases — fresh template, re-run, and a foreign target carrying its own entitlements
key. All three produce exactly 2 wired configurations.

```sh
git fetch origin ios-appstore
git checkout -B ios-appstore origin/ios-appstore
git apply -p1 docs/patches/codemagic-ios-push-capability.patch   # path relative to repo root
```

⚠️ Before that build runs, **"Push Notifications" must be enabled on the `com.loloshop96.app`
App ID** at developer.apple.com — exactly like Associated Domains. Without it
`fetch-signing-files --create` builds a profile that does not grant the entitlement and the
archive is rejected at signing.

⚠️ `ios-appstore` is behind `main` and its lockfile is desynced (`@capacitor/ios` is in
`package.json` but absent from `package-lock.json`). Run `npm install` in `frontend/` before
merging, as `HANDOFF.md` already warns.

Delete this patch once it has landed on `ios-appstore`.
