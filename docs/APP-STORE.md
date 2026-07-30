# OpsTrack on iOS — build, run, and the road to the App Store

Status of this document: **the app has been built and run in the iOS Simulator.**
Everything below marked ✅ was observed, not assumed; everything marked ⬜ has not
been done. The previous version of this gap was closed on the strength of a
`cap sync` that had never been compiled, so the rule here is: if it is not
reproducible from a command in this file, it does not get a tick.

---

## 1. What exists

| Piece | State |
| --- | --- |
| Capacitor | 8.4.2, iOS platform via **Swift Package Manager** (`ios/App/CapApp-SPM`), pinned to `capacitor-swift-pm 8.4.2` |
| Plugins | `@capacitor/app`, `keyboard`, `splash-screen`, `status-bar` — 4, all resolved by `cap sync` |
| Bundle id | `app.opstrack` |
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

### ✅ Verified on 2026-07-30

- Host: macOS 25.5.0 (arm64), **Xcode 26.6 (17F113)**, iOS 26.5 runtime,
  simulator *iPhone 17 Pro* `7FA10093-79B4-47BA-913D-B08BE39F823E`.
- `** BUILD SUCCEEDED **`, 0 warnings. Bundle links `Capacitor.framework` and
  `Cordova.framework`, universal arm64 + x86_64, codesigned "Sign to Run Locally".
- Installed and launched: `app.opstrack: <pid>`, alive in `launchctl list`.
- No errors in `xcrun simctl spawn <udid> log stream --predicate 'process == "App"'`.

- `src/lib/native.test.ts` — 12 tests pass, covering the other half of the claim:
  every `lib/native.ts` export is a no-op when no bridge is on `globalThis`.

Screenshots live under `docs/EVIDENCE/shots/`, per the capture-kit convention in
`docs/EVIDENCE/wave4-live-proof.md` §0.1. All three: iPhone 17 Pro, iOS 26.5,
1206×2622 native (402×874 CSS px), locale `en` / `dir=ltr`, light theme (the
simulator's appearance, resolved through the theme's `auto` setting).

| File | Screen | Asset source |
| --- | --- | --- |
| `ios-sim-signin-production-bundle.png` | Sign-in | **Production bundle** from `dist/`, loaded out of the app bundle |
| `ios-sim-followups-shell-preview.png` | Follow-ups | Dev server + `?shell` (see below) |
| `ios-sim-board-shell-preview.png` | Board | Dev server + `?shell` (see below) |

Described, so the text is the evidence and the PNG is the backup:

- **Sign-in** — card reading "Sign in to OpsTrack", "Accounts are created by your
  admin.", fields "Username or email" (placeholder `ahmed.otaibi`) and
  "Password" with a "Show" toggle, a primary "Sign in" button, and "First time
  here? Claim your account". The `العربية` locale switch sits top-right of the
  card. Evidence *of*: the production WKWebView bundle boots and React paints.
- **Follow-ups** — header "Follow-ups" with bell / display / `العربية` / gear
  icons clearing the Dynamic Island; segmented "Everyone | Mine",
  "Comfortable | Compact", "Refresh"; "0 items need attention"; empty state
  "Nothing needs you right now" over "Overdue, due, quiet, blocked and unowned
  items all land here." and a "Capture something" button; the capture FAB bottom-
  end; bottom tab bar "Follow-ups · Board · Tracks · Meetings · Dashboard" with
  Follow-ups active. Evidence *of*: safe-area insets resolve non-zero — the
  header sits below the status bar and the tab bar above the home indicator.
- **Board** — header "Board"; "Everything in flight, in a column per whatever
  you're grouping by."; "GROUP BY Status | Track | Owner | Priority" (Status
  active); "CARD DENSITY Comfortable | Compact"; a "NEW" column with count `0`
  and a dashed drop zone "Nothing in New / Drag a card here, or add one with the
  + button.", with the next column clipped at the inline edge to show horizontal
  scroll. Evidence *of*: the dynamic board renders and scrolls inside the
  WKWebView, with Board active in the tab bar.

**Why two of the three use a dev server, stated plainly:** the signed-in screens
sit behind Supabase auth, and `?shell` — the fake-session preview in
`src/App.tsx` — is guarded by `import.meta.env.DEV`, which Vite tree-shakes out
of every production build. To photograph Follow-ups and Board without real
credentials, `capacitor.config.json` was temporarily pointed at
`http://localhost:5173/?shell#/<route>` (Capacitor's documented live-reload
flow), rebuilt, and relaunched. **That is still the real WKWebView in the real
simulator running the real React app** — native shell, plugins, safe-area insets
and tab bar are all genuine; only the origin of the JS differs. The temporary
`server` block was reverted and `capacitor.config.json` is byte-identical to
HEAD. A signed-in screenshot of the *production* bundle still requires a real
account and is listed as ⬜ below.

---

## 3. What the first real build surfaced, and what was done

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

## 4. Remaining checklist — nothing here is done

### Signing and identity
- ⬜ **No `DEVELOPMENT_TEAM`** anywhere in `project.pbxproj` (0 occurrences), and
  `CODE_SIGN_IDENTITY` is the legacy string `"iPhone Developer"`. A real Apple
  Developer Program team must be set before anything runs on hardware.
- ⬜ Apple Developer Program membership ($99/yr) — assumed not yet purchased.
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
  must declare `NSPrivacyCollectedDataTypes` for what OpsTrack actually collects:
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

The `Claude Code iOS Simulator` MCP `control` action (attach/launch/screenshot)
refuses to run on this machine with:

> Xcode is installed but not selected. Run
> `sudo xcode-select -s /Applications/Xcode.app/Contents/Developer`

despite `xcode-select -p` already printing that exact path. The gate appears to
be the missing `/var/db/xcode_select_link`, which only `sudo xcode-select -s`
creates. The MCP **`build`** action is unaffected and was used here; install,
launch and screenshots were done with `xcrun simctl`, which shares the same
CoreSimulator backend. Running that one sudo command would make the live
simulator panel available and is worth doing before the next iOS sitting.
