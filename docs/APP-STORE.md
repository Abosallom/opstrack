# CoreTrack on iOS — build, run, and the road to the App Store

Status of this document: **the app has been built, installed, launched and
photographed in the iOS Simulator**, re-verified end-to-end on 2026-07-30 at
19:40–19:45 +0300 for Wave 5. Everything marked ✅ was observed, not assumed;
everything marked ⬜ has not been done. The Wave-4 version of this gap was closed
on the strength of a `cap sync` that had never been compiled, so the rule here
is: if it is not reproducible from a command in this file, it does not get a tick.

> **Why Wave 4b's run looked unverifiable.** The Wave-4b critic checked
> `~/Library/Developer/Xcode/DerivedData` for an `App-*` build and found nothing
> newer than 2026-07-14, so it could not confirm a real compile. That check was
> looking in the wrong place, and the conclusion "no build happened" was wrong.
> The `Claude Code iOS Simulator` MCP `build` action does **not** use Xcode's
> shared DerivedData — it builds into its own sandbox:
>
> ```
> ~/Library/Application Support/Claude/simulator-builds/<hash>/DerivedData/
>   Build/Products/Debug-iphonesimulator/App.app
> logs/build-<n>-<id>.log        # full xcodebuild transcript, one per build
> ```
>
> Look there, or pass an explicit `-derivedDataPath`, before concluding a build
> never ran. §2 below records the build ids and the exact artefact path.

---

## 1. What exists

| Piece | State |
| --- | --- |
| Capacitor | 8.4.2, iOS platform via **Swift Package Manager** (`ios/App/CapApp-SPM`), pinned to `capacitor-swift-pm 8.4.2` |
| Plugins | `@capacitor/app`, `keyboard`, `splash-screen`, `status-bar` — 4, all resolved by `cap sync` |
| Display name | **CoreTrack** — `CFBundleDisplayName` in `ios/App/App/Info.plist`, plus `appName` in the root `capacitor.config.json` (both, per `docs/WAVE5-NOTES.md` §1) |
| Bundle id | `app.opstrack` — **deliberately not renamed.** Identity swaps once, cleanly, at the NphiesCore launch cut |
| Deployment target | iOS 15.0 · `TARGETED_DEVICE_FAMILY = 1,2` (iPhone + iPad) |
| Web layer | `dist/` copied into `ios/App/App/public` by `cap sync` (both are gitignored) |
| JS ↔ native seam | `src/lib/native.ts` — status bar, splash dismissal, resume/pause listeners. No-op on web. |

`ios/App/App/public` and `ios/App/App/capacitor.config.json` are **generated** and
gitignored. Never hand-edit them; edit `capacitor.config.json` at the repo root
and re-run `cap sync`.

---

## 2. Reproducing the build and run

```bash
npm run build          # tsc -b && vite build  → dist/
npx cap sync ios       # dist/ → ios/App/App/public, regenerates plugin wiring

# Build for the simulator (headless, no Xcode UI):
xcodebuild -project ios/App/App.xcodeproj -scheme App \
  -configuration Debug -destination 'generic/platform=iOS Simulator' build

# Install + launch on a booted simulator:
xcrun simctl boot 'iPhone 17 Pro'          # if nothing is booted
xcrun simctl install booted /path/to/App.app
xcrun simctl launch booted app.opstrack
xcrun simctl io booted screenshot shot.png
```

`npm run ios:run` (`cap run ios`) wraps the same thing when Xcode's toolchain is
fully selected.

### ✅ Verified on 2026-07-30, 19:40–19:45 +0300 (Wave 5 re-verification)

- Host: macOS 25.5.0 (arm64), **Xcode 26.6 (17F113)**, iOS 26.5 runtime
  (23F77), simulator **iPhone 17 Pro**, udid
  `7FA10093-79B4-47BA-913D-B08BE39F823E`, already booted.
- **Build succeeded, 0 warnings**, five consecutive times (MCP build ids
  `build-8` … `build-12`, 1–2 s each incremental). Artefact:
  `~/Library/Application Support/Claude/simulator-builds/2843076fc792ae8f/DerivedData/Build/Products/Debug-iphonesimulator/App.app`
- SPM resolved clean: `capacitor-swift-pm @ 8.4.2` plus the four local plugin
  packages — no network failure, no unresolved graph.
- Binary is universal: `lipo -info App` → `x86_64 arm64`. `codesign -dv` →
  `Identifier=app.opstrack`, `Signature=adhoc`, `TeamIdentifier=not set`
  (expected — simulator builds need no signing account).
- Installed and launched three times; pids `43285`, `43429`, `43608`, each
  confirmed alive in `xcrun simctl spawn <udid> launchctl list` as
  `UIKitApplication:app.opstrack`.
- **Rename verified in the built product, not just the source:**
  `PlistBuddy -c "Print :CFBundleDisplayName"` on the *installed* bundle inside
  the simulator's container prints `CoreTrack`.
- `NSAppTransportSecurity` confirmed absent from the built `Info.plist`;
  `CFBundleLocalizations` present as `[en, ar]`.
- Log review is **no longer a clean bill of health** — see the `UIScene` finding
  in §3. The Wave-4 claim "No errors in ... log stream" was too generous: it
  matched on the string `error`, which hits debug-level category names like
  `com.apple.BoardServices:XPCErrors`. Filter on the *level* column instead:
  ```bash
  xcrun simctl spawn <udid> log show --last 3m \
    --predicate 'process == "App"' --style compact \
    | awk '$3 == "E" || $3 == "F"'
  ```

- `src/lib/native.test.ts` — 12 tests pass, covering the other half of the claim:
  every `lib/native.ts` export is a no-op when no bridge is on `globalThis`.

Screenshots live under `docs/EVIDENCE/shots/`, per the capture-kit convention in
`docs/EVIDENCE/wave4-live-proof.md` §0.1. All three: iPhone 17 Pro, iOS 26.5,
1206×2622 native (402×874 CSS px), locale `en` / `dir=ltr`, light theme (the
simulator's appearance, resolved through the theme's `auto` setting).

| File | Screen | Captured | Asset source |
| --- | --- | --- | --- |
| `ios-sim-signin-production-bundle.png` | Sign-in | 19:40:16 +0300 | **Production bundle** from `dist/`, loaded out of the app bundle |
| `ios-sim-followups-shell-preview.png` | Follow-ups | 19:44:20 +0300 | Dev-mode bundle + `?shell` (see below) |
| `ios-sim-board-shell-preview.png` | Board | 19:44:55 +0300 | Dev-mode bundle + `?shell` (see below) |

The simulator clock is legible in each PNG (`19:40`, `19:44`, `19:44`) and
matches the capture times above, so the three images are self-dating.

Described, so the text is the evidence and the PNG is the backup:

- **Sign-in** — card reading **"Sign in to CoreTrack"** under a **"CoreTrack"**
  wordmark and lightning-bolt app mark, "Accounts are created by your admin.",
  fields "Username or email" (placeholder `ahmed.otaibi`) and "Password" with a
  "Show" toggle, a primary "Sign in" button, and "First time here? Claim your
  account". The `العربية` locale switch sits top-right of the card. Evidence
  *of*: the production WKWebView bundle boots, React paints, and **the CoreTrack
  rename is live in the shipped iOS payload** — not just in the repo. Also note
  what is *absent*: no SSO/provider buttons, consistent with the Wave-5 SSO strip.
- **Follow-ups** — header "Follow-ups" with bell / display / `العربية` / gear
  icons clearing the Dynamic Island; "What needs you today, in one list.";
  segmented "Everyone | Mine" (Everyone active) and "Comfortable | Compact"
  (Comfortable active), plus "Refresh"; a "Search titles, no…" field truncated by
  the narrow viewport, a "Filter" disclosure, and "0 items need attention";
  centred empty state — checklist glyph over "Nothing needs you right now",
  "Overdue, due, quiet, blocked and unowned items all land here." and a
  "Capture something" button; the capture FAB bottom-end; bottom tab bar
  "Follow-ups · Board · Tracks · Meetings · Dashboard" with Follow-ups active and
  underlined. Evidence *of*: safe-area insets resolve non-zero — the header sits
  clear of the Dynamic Island and the tab bar clear of the home indicator.
- **Board** — header "Board"; "Everything in flight, in a column per whatever
  you're grouping by."; "Search titles, notes" + "Mine" + "Filter" + "0 items";
  "GROUP BY Status | Track | Owner | Priority" (Status active); "CARD DENSITY
  Comfortable | Compact" (Comfortable active); "Refresh"; the drag affordance
  copy "Press and hold a card to pick it up, then drag it onto another column —
  that changes its status, track, owner or priority, whichever you're grouped by.
  Swipe anywhere to move between columns."; a "NEW" column with count `0` and a
  dashed drop zone "Nothing in New / Drag a card here, or add one with the +
  button.", with the next column clipped at the inline edge to show horizontal
  scroll. Evidence *of*: the dynamic board renders and scrolls inside the
  WKWebView, with Board active in the tab bar.

**Why two of the three are a dev-mode bundle, stated plainly:** the signed-in
screens sit behind Supabase auth, and `?shell` — the fake-session preview in
`src/App.tsx` — is guarded by `import.meta.env.DEV`, which Vite compiles to the
literal `false` in a production build, so the branch is tree-shaken away
entirely. Photographing Follow-ups and Board without real credentials therefore
needs a bundle where `DEV` is genuinely true.

Reproduce it like this — **no dev server and no edit to any tracked file**:

```bash
# 1. A bundle where import.meta.env.DEV is actually true.
#    NODE_ENV matters: `vite build` forces NODE_ENV=production and --mode alone
#    does NOT change it, so `--mode development` on its own still yields DEV=false.
NODE_ENV=development npx vite build --mode development --outDir /tmp/dist-shell

# 2. Drop it into the GENERATED, gitignored iOS payload and pin the route.
rm -rf ios/App/App/public && cp -R /tmp/dist-shell ios/App/App/public
#    ...then insert this as the first line inside <head> of that index.html,
#    before the module script, so location is already correct at first paint:
#    <script>history.replaceState(null,'','/?shell#/followups');</script>

# 3. Rebuild, then uninstall-before-install (see the service-worker note below).
xcrun simctl uninstall <udid> app.opstrack
xcrun simctl install  <udid> /path/to/App.app && xcrun simctl launch <udid> app.opstrack

# 4. Put the tree back — this restores the production payload from dist/.
npx cap sync ios
```

Two traps worth writing down, both of which cost a cycle here:

1. **`--mode development` is not enough.** Vite derives `import.meta.env.DEV`
   from `NODE_ENV`, and `vite build` pins `NODE_ENV=production` regardless of
   `--mode`. The tell is cheap: `grep -c 'has("shell")' <chunk>.js` returns 0 on
   a production bundle and non-zero once `DEV` is really true (the dev bundle
   also grows — 1537 KiB precache vs 1213 KiB, because it is unminified).
   Grepping for the bare substring `shell` is *not* a valid check: React's own
   `shellSuspendCounter` matches it in every build.
2. **`install` over an existing install keeps the old service worker.** The PWA
   precaches `index.html`, so a re-install served the *previous* bundle's HTML
   and the app fell through to the sign-in screen with the new payload sitting
   unused on disk. `simctl uninstall` first — it drops the WKWebView data store
   along with the app.

This replaces Wave 4b's approach, which temporarily pointed
`capacitor.config.json` at `http://localhost:5173`. That works, but it mutates a
**tracked** file, and a parallel Wave-5 agent was editing that same file during
this sitting. Overwriting `ios/App/App/public` touches nothing git tracks —
`cap sync` regenerates it — so there is no window in which a tracked file is
wrong. Confirmed afterwards: `ios/App/App/public/index.html` contains no
`replaceState` bootstrap and the payload has no `?shell` guard, i.e. the tree is
back on the production bundle.

**That is still the real WKWebView in the real simulator running the real React
app** — native shell, plugins, safe-area insets and tab bar are all genuine; only
the JS build mode differs. A signed-in screenshot of the *production* bundle
still requires a real account and is listed as ⬜ below.

---

## 3. What the real builds surfaced, and what was done

### ✅ Display name reads CoreTrack (Wave 5)

`CFBundleDisplayName` was still `OpsTrack`. Set to `CoreTrack`, matching
`appName` in the root `capacitor.config.json` (landed in parallel by the Wave-5
rename agent). Verified in the **built and installed** bundle, not just the
source — see §2. The bundle id stays `app.opstrack` on purpose
(`docs/WAVE5-NOTES.md` §1): renaming it now would orphan the installed PWA and
stored state mid-testing. `NphiesCore` appears nowhere yet, by directive.

### ⬜ `UIScene` lifecycle — real, reproducible, deliberately NOT fixed here

Every launch logs one **Fault**-level runtime issue:

```
F  App[43608] [com.apple.runtime-issues:UIKit App Config] `UIScene` lifecycle
   will soon be required. Failure to adopt will result in an assert in the future.
```

Reproduced on all three launches (pids 43285, 43429, 43608). It is genuine, not
simulator noise: `ios/App/App/AppDelegate.swift` is the classic Capacitor
template with a bare `var window: UIWindow?` and no `UISceneDelegate`, and
`Info.plist` has **no** `UIApplicationSceneManifest` (0 occurrences). Today it is
only a warning; Apple's wording says a future SDK turns it into an assert — i.e.
a launch crash on a newer iOS.

Left unfixed on purpose, and this is a judgement call worth stating: adopting
scene lifecycle means a new `SceneDelegate.swift`, a scene manifest, and moving
window setup out of `AppDelegate` — Swift source changes to the Capacitor
bridge's own entry point. That is well outside "ios/ config fixes", it is the
kind of change that wants a real device test, and Capacitor 8.4.2 does not ship
scene support upstream yet. **Track it as a release-blocking item for whichever
iOS SDK makes it an assert, not for v1.0.0.** Check whether Capacitor has adopted
scenes upstream before hand-rolling it.

For the record, the other Error-level lines in the log are environment noise, not
app defects, and should not be chased: `CoreHaptics` failing to open
`hapticpatternlibrary.plist` (absent from the simulator runtime),
`RemoteTextInput` "Can only set suggestions for an active session", WebKit
`ResourceLoadStatistics` "Unable to hide query parameters from script", and
`extensionkit` failing to resolve `com.apple.WebKit.Networking`.

### ✅ ATS — no exception needed, and none was added

The suspicion going in was that App Transport Security would block the Supabase
host. It does not. Apple's own diagnostic:

```
$ nscurl --ats-diagnostics --verbose https://lrysgpbkmuqgzsjesfkr.supabase.co
Default ATS Secure Connection
ATS Dictionary: {}
Result : PASS
```

The host already satisfies ATS (TLS 1.2+, forward secrecy, SHA-256) with an
**empty** ATS dictionary. `Info.plist` therefore carries **no
`NSAppTransportSecurity` key**, and a comment there records this evidence.
Adding `NSAllowsArbitraryLoads` "to be safe" would buy nothing and cost an App
Review encryption-justification round. Re-run the command above before anyone
adds an exception.

### ✅ `UIRequiredDeviceCapabilities`: `armv7` → `arm64`

The Capacitor template ships `armv7`, the 32-bit instruction set. The deployment
target is iOS 15.0 — every device that can install this app is 64-bit, and no
supported device advertises `armv7`. Changed to `arm64`; re-verified with a
clean `simctl uninstall` + `install` + `launch`.

### ✅ `ITSAppUsesNonExemptEncryption = false`

Absent this key, App Store Connect blocks **every** upload behind the export
compliance questionnaire. The only cryptography is OS-provided HTTPS/TLS, which
is exempt under the standard-encryption clause.

### ✅ `CFBundleLocalizations = [en, ar]`

The app ships a complete Arabic tree with an RTL layout, but localisation is done
in JS, not `.lproj` bundles — so iOS and the App Store listing would have
advertised English only.

### ✅ Checked and found already correct (left alone)

- **`UIViewControllerBasedStatusBarAppearance = true`** — this is what
  `@capacitor/status-bar` *requires* (`node_modules/@capacitor/status-bar/README.md`).
  Flipping it to `false`, a common "fix", would break `StatusBar.setStyle()`.
- **Safe areas** — `env(safe-area-inset-*)` is already used across
  `app-shell.css`, `global.css`, `signin.css`, `claim.css`, `tree.css`,
  `meetings.css`, `confirm.css`. Header clears the Dynamic Island and the tab bar
  clears the home indicator in the screenshots.
- **Viewport** — `index.html` already sets `viewport-fit=cover`, which is what
  makes those insets non-zero.
- **Rubber-band overscroll** — `global.css` already sets
  `overscroll-behavior-y: none` on `html, body`, so the WKWebView background does
  not show through. (`native.ts` stamps `data-native="ios"` for this purpose; no
  stylesheet needs it, and none was added.)
- **Launch screen** — `LaunchScreen.storyboard` uses `systemBackgroundColor` and
  the `Splash` imageset has proper `-dark` variants, so the launch image adapts.
- **App icon** — 1024×1024, **no alpha channel**. This is a hard App Store
  rejection gate and it passes (`sips -g hasAlpha`).
- **`ios.backgroundColor: "#101519"`** in `capacitor.config.json` correctly
  matches the dark theme's `--bg`. Kept. (The PWA manifest disagrees — see §5.)

---

## 4. Remaining checklist — everything ⬜ below is still outstanding

### Signing and identity
- ⬜ **No `DEVELOPMENT_TEAM`** anywhere in `project.pbxproj` (0 occurrences), and
  `CODE_SIGN_IDENTITY` is the legacy string `"iPhone Developer"`. A real Apple
  Developer Program team must be set before anything runs on hardware.
- ✅ Apple Developer Program membership — **Aziz has an account**
  (`docs/WAVE5-NOTES.md` §3). Submission is no longer externally blocked. Claude
  must never handle the Apple ID password or 2FA: either he signs into Xcode once
  (Settings ▸ Accounts), which enables automatic signing, or he provides an App
  Store Connect API key (.p8 + key id + issuer id), stored gitignored like the
  Supabase token.
- ⬜ App ID / bundle id `app.opstrack` registered on the developer portal.
- ⬜ Provisioning profile (automatic signing needs the team first).

### Versioning
- ⬜ **Version drift**: `MARKETING_VERSION = 1.0` and `CURRENT_PROJECT_VERSION = 1`
  in `project.pbxproj`, but `package.json` is `0.1.0`. Wave 5 targets v1.0.0 —
  pick one source of truth and make the iOS build read it.

### Privacy — likely the biggest remaining item
- ⬜ **No `PrivacyInfo.xcprivacy` in the app target.** Capacitor's own frameworks
  ship theirs (`node_modules/@capacitor/ios/.../PrivacyInfo.xcprivacy`), which
  covers *their* required-reason API use, but the app has none of its own. It
  must declare `NSPrivacyCollectedDataTypes` for what CoreTrack actually collects:
  email address and name (account creation), plus user content (entries, notes,
  meeting lines), all linked to identity and not used for tracking. Add it via
  Xcode (File ▸ New ▸ App Privacy File) so the resource is registered in
  `project.pbxproj` correctly — hand-editing the pbxproj for this is not worth
  the risk of wedging every other builder.
- ⬜ App Store Connect privacy "nutrition label" questionnaire, which must agree
  with that file.

### Device and distribution
- ⬜ **Never run on a physical iPhone.** Simulator only, so far. The simulator
  does not exercise real network transitions, background suspension, push, real
  keyboard behaviour, or actual thermal/perf characteristics.
- ⬜ Offline behaviour (`store/outbox.ts` + `lib/cache.ts`) never exercised in the
  app with real airplane-mode transitions — this is the feature most likely to
  behave differently on-device.
- ⬜ Release-configuration build (everything so far is `Debug`).
- ⬜ Archive + upload to App Store Connect / TestFlight.
- ⬜ App Store listing: name, subtitle, description, keywords, support URL,
  privacy policy URL (**required**), category, age rating.
- ⬜ Marketing screenshots at Apple's required sizes — the images in
  `docs/EVIDENCE/shots/` are engineering evidence, not store assets.
- ⬜ Demo account for App Review — the app is invite-only and every screen past
  sign-in is gated, so review **will** reject without working credentials in the
  review notes.

### Decisions someone has to make
- ⬜ **Orientation.** `Info.plist` allows portrait + both landscapes on iPhone,
  but the PWA manifest declares `orientation: 'portrait'`. In landscape an
  iPhone 17 Pro is 956 CSS px wide, which crosses the 768px breakpoint and
  switches to the desktop sidebar layout on a 440px-tall screen. Left as-is
  deliberately — narrowing supported orientations is a product decision, not a
  config cleanup. Verify landscape or restrict iPhone to portrait.
- ⬜ The Supabase **anon key is baked into the JS bundle**. That is normal and by
  design (RLS is the actual access control), but it does mean the key is
  extractable from the `.ipa`. Confirm RLS coverage is complete before shipping —
  see `docs/EXECUTION-PLAN.md` and the migration series.

---

## 5. Gaps found outside this task's ownership

Reported, not fixed, because these files belong to other Wave-4b builders:

- **`vite.config.ts` + `index.html` disagree with the dark theme.** The manifest
  sets `background_color`/`theme_color` to `#101215` and `index.html` sets
  `<meta name="theme-color" content="#101215">`, but the dark theme's `--bg` in
  `src/styles/global.css` is `#101519`. The comment in `vite.config.ts` claims it
  "Matches the dark theme's --bg" — it does not. `capacitor.config.json` has the
  correct value. Three characters, but it is a visible seam on the PWA splash.

---

## 6. Note for whoever runs the simulator next

The `Claude Code iOS Simulator` MCP splits cleanly in two on this machine:

- **`build` works.** Used for every build in §2 (ids `build-8` … `build-12`).
- **`control` does not** — `attach`, `launch` and the `screenshot` action all
  fail, every time, with this exact text:

  > Xcode is installed but not selected. Run `sudo xcode-select -s
  > /Applications/Xcode.app/Contents/Developer` to use the Claude Code iOS
  > Simulator.

**Do not take that message at face value, and do not stop at it.** The toolchain
is demonstrably fine: `xcode-select -p` prints
`/Applications/Xcode.app/Contents/Developer`, `xcodebuild -version` prints
Xcode 26.6 (17F113), `xcodebuild -showsdks` lists the iOS 26.5 simulator SDK,
`xcrun simctl` works, and the MCP's own `build` action compiled the project five
times through that same toolchain. A message blaming Xcode selection cannot be
the whole story when the compiler works.

Two things are true at once, and only one of them is fixable with sudo:

1. `/var/db/xcode_select_link` really is **absent** (`ls` → No such file or
   directory). `xcode-select -p` still answers because it falls back to the
   default Xcode when no link is set. So `sudo xcode-select -s
   /Applications/Xcode.app/Contents/Developer` is a legitimate thing to run and
   may well satisfy a strict preflight that stats that path directly.
2. The host app additionally reports the feature as **switched off**, in its own
   capability list: `"iosSimulator": {"status": "unsupported", "reason": "iOS
   Simulator is disabled by its rollout flag"}` (likewise `iosSimulatorH264`).
   **No sudo command changes a server-side rollout flag.**

So: run the sudo command, by all means — but if `attach` still fails afterwards,
that is expected and it is not a broken Mac. The live panel is gated by (2), and
the only honest thing to do at that point is what was done here.

**What was used instead, disclosed rather than glossed:** `xcrun simctl` —
Apple's own CLI, driving the same CoreSimulator backend the MCP itself wraps —
for `uninstall` / `install` / `launch` / `io ... screenshot` / `spawn ... log
show`. This is not a generic screen-scraper: `simctl io screenshot` reads the
simulator framebuffer directly, which is the same image path the MCP screenshot
action uses, at the same native 1206×2622. No pixel-level UI automation was
involved, and no on-screen tapping was possible — which is exactly why each
`?shell` screen had to be pinned by route and relaunched rather than reached by
tapping the tab bar.

Two mechanical notes for the next sitting:

- The MCP `build` action's `udid` argument rejected a genuinely booted device
  ("No booted simulator named …" for a udid that `simctl list devices booted`
  showed as `Booted`). Omit `udid` and let it build for
  `generic/platform=iOS Simulator`; that works and is what §2 used.
- Screenshots need a real settle delay. Capturing immediately after `launch`
  caught the launch transition and produced an all-black frame. Allow ~8–9 s for
  install → launch → WKWebView paint before `simctl io screenshot`, and *look at*
  the resulting PNG rather than trusting the exit code.
