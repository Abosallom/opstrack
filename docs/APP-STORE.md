# NphiesCore on iOS — what is done, what is left, and what only Aziz can do

**Rewritten 2026-08-11, 10:36 +0300**, against the working tree on
`feat/nphiescore-map`. Every value in §1 was read out of the file it lives in at
that minute, with the command shown. Nothing in this document is inherited from
the previous revision without being re-checked, because the previous revision
described an app called **CoreTrack** with the bundle id **`app.opstrack`**, and
both of those are now wrong.

**How to read the marks.** ✅ means *observed at the time stated, by the command
quoted*. ⬜ means not done. ⚠ means done but since invalidated by a later change,
which is a state this document previously had no way to express and needed.

> **The one caution that governs the whole file.** This was written while
> several agents were landing the NphiesCore rename in the same worktree. §1's
> identity values were correct at 10:36 and are the most likely thing here to
> have moved by the time you read it. Re-run the four commands in §1.1 before
> you trust the table; they take five seconds.

---

## 1. Identity, as it actually stands

| Piece | Value | Where it lives |
| --- | --- | --- |
| Display name | **NphiesCore** | `CFBundleDisplayName` in `ios/App/App/Info.plist`; `appName` in `capacitor.config.json` |
| Bundle id | **`app.nphiescore`** | `PRODUCT_BUNDLE_IDENTIFIER` in both build configurations of `ios/App/App.xcodeproj/project.pbxproj`; `appId` in `capacitor.config.json` |
| Marketing version | **1.1.0** | `MARKETING_VERSION` (pbxproj:310, :332) |
| Build number | **1** | `CURRENT_PROJECT_VERSION` (pbxproj:303, :325) |
| `package.json` version | **1.0.1** | ⚠ **disagrees with `MARKETING_VERSION` right now** — see §7.1 |
| Capacitor | 8.4.2, iOS via Swift Package Manager (`ios/App/CapApp-SPM`), pinned to `capacitor-swift-pm 8.4.2` | |
| Plugins | `@capacitor/app`, `keyboard`, `splash-screen`, `status-bar` | compiled from source into the app target |
| Deployment target | iOS 15.0 · `TARGETED_DEVICE_FAMILY = 1,2` | |
| Privacy manifest | **present and registered in the build** | `ios/App/App/PrivacyInfo.xcprivacy`, wired as `AC1DB0A5E9FC4B1D8E2F0001` (file ref) + `…0002` (Resources phase) |
| Export compliance | `ITSAppUsesNonExemptEncryption = false` | Info.plist |
| Localizations | `[en, ar]` | `CFBundleLocalizations` |
| Device capability | `arm64` | `UIRequiredDeviceCapabilities` |
| ATS | **no `NSAppTransportSecurity` key**, deliberately | Info.plist — Supabase already satisfies default ATS |
| Scene manifest | **absent** | see §3.2 |
| App icon | 1024×1024, **no alpha** | `ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png` |
| Signing team | **none set** | ⬜ `DEVELOPMENT_TEAM` is absent from pbxproj |

### 1.1 The four commands that regenerate that table

```bash
node -p "require('./package.json').version"
grep -nE 'PRODUCT_BUNDLE_IDENTIFIER|MARKETING_VERSION|CURRENT_PROJECT_VERSION|DEVELOPMENT_TEAM' \
  ios/App/App.xcodeproj/project.pbxproj
for k in CFBundleDisplayName ITSAppUsesNonExemptEncryption CFBundleLocalizations \
         UIRequiredDeviceCapabilities NSAppTransportSecurity UIApplicationSceneManifest; do
  printf '%-34s ' "$k"; /usr/libexec/PlistBuddy -c "Print :$k" ios/App/App/Info.plist 2>&1 | tr '\n' ' '; echo
done
sips -g pixelWidth -g pixelHeight -g hasAlpha \
  ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png
```

`ios/App/App/public` and `ios/App/App/capacitor.config.json` are **generated**
and gitignored. Never hand-edit them; edit `capacitor.config.json` at the repo
root and re-run `cap sync`.

---

## 2. Building and running it

```bash
npm run build          # tsc -b && vite build  → dist/
npx cap sync ios       # dist/ → ios/App/App/public, regenerates plugin wiring

# Simulator build, headless:
xcodebuild -project ios/App/App.xcodeproj -scheme App \
  -configuration Debug -destination 'generic/platform=iOS Simulator' build

# Install + launch on a booted simulator:
xcrun simctl boot 'iPhone 17 Pro'          # if nothing is booted
xcrun simctl install booted /path/to/App.app
xcrun simctl launch booted app.nphiescore
xcrun simctl io booted screenshot shot.png
```

`npm run ios:run` (`cap run ios`) wraps the same thing.

**Where the MCP `build` action puts its artefacts** — this cost a whole review
cycle once, because a critic checked Xcode's shared DerivedData, found nothing,
and concluded no build had happened:

```
~/Library/Application Support/Claude/simulator-builds/<hash>/DerivedData/
  Build/Products/Debug-iphonesimulator/App.app
logs/build-<n>-<id>.log        # full xcodebuild transcript, one per build
```

Look there, or pass an explicit `-derivedDataPath`, before concluding a build
never ran.

### 2.1 ⚠ The last verified device run is now stale evidence

A full build → install → launch → screenshot cycle **was** verified on
2026-07-30, 19:40–19:45 +0300: five consecutive clean builds (MCP ids `build-8`
… `build-12`), three launches with live pids, a universal binary
(`lipo -info` → `x86_64 arm64`), and `PlistBuddy` reading the display name back
out of the *installed* bundle inside the simulator container.

That run is kept here because the method is still right, and it is marked ⚠
rather than ✅ because **it verified a different app**: display name *CoreTrack*,
bundle id *app.opstrack*, version *1.0.1*. All three have changed. The three
screenshots under `docs/EVIDENCE/shots/` are from that run and therefore show
the old wordmark. They are engineering evidence of the shell working, not
evidence about the current build, and they are **not** store assets.

**Nothing on the current identity has been built, installed or launched.** That
is the first thing to redo, and it is mechanical.

### 2.2 Photographing a signed-in screen without an account

The signed-in screens sit behind Supabase auth, and `?shell` — the fake-session
preview in `src/App.tsx` — is guarded by `import.meta.env.DEV`, which Vite
compiles to the literal `false` in a production build and tree-shakes away. So a
dev-mode bundle is needed, and it can be produced **without a dev server and
without editing a tracked file**:

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

# 3. Rebuild, then uninstall-before-install (see the trap below).
xcrun simctl uninstall <udid> app.nphiescore
xcrun simctl install  <udid> /path/to/App.app && xcrun simctl launch <udid> app.nphiescore

# 4. Put the tree back — this restores the production payload from dist/.
npx cap sync ios
```

Two traps, both of which cost a cycle:

1. **`--mode development` is not enough.** The cheap tell:
   `grep -c 'has("shell")' <chunk>.js` returns 0 on a production bundle and
   non-zero once `DEV` is really true. Grepping for the bare substring `shell`
   is **not** a valid check — React's own `shellSuspendCounter` matches it in
   every build.
2. **`install` over an existing install keeps the old service worker.** The PWA
   precaches `index.html`, so a re-install serves the *previous* bundle's HTML.
   `simctl uninstall` first; it drops the WKWebView data store with the app.

Screenshots need a real settle delay — allow ~8–9 s for install → launch →
WKWebView paint, and *look at* the PNG rather than trusting the exit code. A
capture taken immediately after `launch` is an all-black frame.

---

## 3. Findings that are still open

### 3.1 ✅ Checked and correct, left alone

- **`UIViewControllerBasedStatusBarAppearance = true`** — this is what
  `@capacitor/status-bar` *requires*. Flipping it to `false`, a common "fix",
  breaks `StatusBar.setStyle()`.
- **Safe areas** — `env(safe-area-inset-*)` is used across `app-shell.css`,
  `global.css`, `signin.css`, `claim.css`, `privacy.css`, `tree.css`,
  `meetings.css`, `confirm.css`. `index.html` sets `viewport-fit=cover`, which
  is what makes those insets non-zero.
- **Rubber-band overscroll** — `global.css` sets `overscroll-behavior-y: none`
  on `html, body`.
- **Launch screen** — `LaunchScreen.storyboard` uses `systemBackgroundColor` and
  the `Splash` imageset has `-dark` variants.
- **ATS** — `nscurl --ats-diagnostics --verbose https://<ref>.supabase.co`
  returned `Result : PASS` with an **empty** ATS dictionary. Re-run that command
  before anyone adds `NSAllowsArbitraryLoads` "to be safe"; it would buy nothing
  and cost an encryption-justification round.

### 3.2 ⬜ `UIScene` lifecycle — real, reproducible, deliberately not fixed

Every launch logs one **Fault**-level runtime issue:

```
F  App[…] [com.apple.runtime-issues:UIKit App Config] `UIScene` lifecycle
   will soon be required. Failure to adopt will result in an assert in the future.
```

Genuine, not simulator noise: `ios/App/App/AppDelegate.swift` is the stock
Capacitor delegate with a bare `var window: UIWindow?` and no `UISceneDelegate`,
and `Info.plist` still has **no** `UIApplicationSceneManifest` (re-verified
2026-08-11). Today a warning; Apple's wording says a future SDK makes it an
assert — a launch crash on a newer iOS.

Left alone on purpose: adopting scenes means a new `SceneDelegate.swift`, a
scene manifest, and moving window setup out of `AppDelegate` — Swift changes to
the Capacitor bridge's own entry point, wanting a real-device test, on a version
of Capacitor that has not adopted scenes upstream. **Track it as blocking for
whichever iOS SDK makes it an assert, not for this release.** Check whether
Capacitor has adopted scenes upstream before hand-rolling it.

For the record, the other Error-level lines in the log are environment noise and
should not be chased: `CoreHaptics` failing to open `hapticpatternlibrary.plist`,
`RemoteTextInput` "Can only set suggestions for an active session", WebKit
`ResourceLoadStatistics`, and `extensionkit` failing to resolve
`com.apple.WebKit.Networking`. Filter the log by *level*, not by the string
`error`, which hits debug-level category names:

```bash
xcrun simctl spawn <udid> log show --last 3m \
  --predicate 'process == "App"' --style compact | awk '$3 == "E" || $3 == "F"'
```

---

## 4. Privacy — three separate artefacts, and only one of them is a document

Apple's requirements here are three different things that are routinely
confused. All three must agree with each other and with the app.

### 4.1 ✅ The privacy policy page — built this run

`src/pages/Privacy.tsx` + `src/pages/privacy.css` +
`src/locales/{en,ar}/privacy.json`. It is written **about this app**, not from a
template: every claim was read out of the source first — the tables from
migrations 0001, 0004, 0011, 0020 and 0021; the visibility rules from the RLS
policies in those same files; the AI section from `buildSystemPrompt()` in
`supabase/functions/capture-assist/index.ts` and from 0020's header (which
states in the migration itself that the ledger carries no prompt text); the push
paragraph from `verdictFor()` in `src/lib/push.ts`, which returns `unsupported`
for a native build, so the iOS app creates no push subscription at all; the
deletion paragraph from `case 'delete'` in
`supabase/functions/admin-members/index.ts`, including its three refusals.

**The URL, which is what App Store Connect actually wants:**

```
https://abosallom.github.io/opstrack/#/privacy
```

Three things about that string:

1. The route is mounted on **both** sides of the auth gate, so it resolves for a
   reviewer with no credentials. That is the whole reason for the `standalone`
   prop in `Privacy.tsx`.
2. The `#` is not optional — `src/main.tsx` uses `HashRouter`, because GitHub
   Pages is static hosting with no URL rewriting.
3. ⚠ **It changes the day the domain cut-over lands.** The `/nphiescore/`
   base-path move is CANCELLED — `nphiescore.com` was bought on 19 Aug 2026 and
   supersedes it ([`DOMAIN-CUTOVER.md`](DOMAIN-CUTOVER.md)). A Pages project site
   with a custom domain serves at the apex, so this URL becomes
   `https://nphiescore.com/#/privacy` — shorter than either predecessor, and the
   one to give Apple. Set the App Store Connect field **after** the cut-over, or
   set it now and remember to update it.

⬜ **The page is not wired yet.** It is a work unit that does not own
`src/App.tsx` or `src/locales/index.ts`. Until the integrator applies those two
diffs the route does not exist and all 68 strings render as their own dot paths
(measured: 68 distinct `privacy.*` paths in the rendered markup). The diffs are
in that unit's handoff.

### 4.2 ✅ `PrivacyInfo.xcprivacy` — landed this run, by a different unit

`ios/App/App/PrivacyInfo.xcprivacy`, registered in `project.pbxproj` in both the
file-reference list and the Resources build phase. **A manifest that is not in
Copy Bundle Resources is invisible to the upload check and looks exactly like
having none.** Verify after any `cap sync`:

```bash
/usr/libexec/PlistBuddy -c Print \
  "$(xcodebuild -showBuildSettings -project ios/App/App.xcodeproj \
     -target App 2>/dev/null | awk -F' = ' '/ BUILT_PRODUCTS_DIR/{print $2}')"/App.app/PrivacyInfo.xcprivacy
```

It declares `NSPrivacyTracking = false`, an empty `NSPrivacyAccessedAPITypes`
(with a long, checkable argument for why Capacitor 8 needs no `CA92.1`), and
four collected types — email address, name, user ID, other user content — all
linked, none used for tracking, all for App Functionality. Its own header
carries the evidence. **This is enforced at upload, not at review**, so it is
required for internal TestFlight and not only for a public release.

Note the one thing that reads like a contradiction and is not: the manifest says
the app talks to exactly one host. That is true of the **device** — the Claude
call is made server-side by an edge function, so nothing on the phone ever
opens a connection to `api.anthropic.com`. The privacy *page* describes the
whole path, including that server hop, which is the right scope for a policy and
the wrong scope for the manifest.

### 4.3 ⬜ The App Store Connect privacy questionnaire

The "nutrition label". It is answered in the web console, it must match §4.2
field for field, and **only Aziz can do it** — it needs the App Store Connect
record to exist first. Answer it from `PrivacyInfo.xcprivacy`, not from memory.

---

## 5. Account deletion — the gap, stated plainly

**Apple's rule (App Review 5.1.1(v)):** an app that offers account *creation*
must also offer an easily discoverable way to *initiate* account deletion from
inside the app.

**What this app actually does**, from
`supabase/functions/admin-members/index.ts`:

- Deletion exists and works: Settings → Members → Delete, which calls
  `deleteMember()` (`src/api/members.ts:468`) → the edge function's
  `case 'delete'` → `admin.auth.admin.deleteUser()`. It is **admin-only**.
- The server refuses three things: deleting **yourself** (`self_delete`),
  deleting the **last remaining admin** (`last_admin`), and deleting the
  **workspace owner** (`bootstrap_admin`).
- Consequence: **there is no path by which any user deletes their own account,
  and no path at all for an administrator's own account short of the Supabase
  dashboard.**

**Why that is not immediately fatal, and where it becomes fatal.** Internal
TestFlight distribution does not go through App Review at all (§6), so nothing
enforces 5.1.1(v) today. It becomes blocking the moment a build is submitted for
review — external TestFlight or the store. There is also a reasonable argument
that this app is exempt in spirit, since the *user* never creates an account:
accounts are provisioned by an administrator and the user only claims one. That
argument is worth making in the review notes; it is not worth *relying* on.

**What closing it properly costs**, so the decision is informed rather than
deferred by accident:

1. A `delete-self` action in `admin-members` that takes only the caller's own
   JWT, keeps the `last_admin` and `bootstrap_admin` guards, and drops the
   `self_delete` guard for that action only.
2. A destructive card in `src/pages/Settings.tsx` — confirm dialog, typed
   confirmation, then sign-out — plus its strings in `settings.json`.
3. One sentence changed in `privacy.deleteSelf` in both locales, which today
   correctly says there is no self-service delete **yet**.

Until (1)–(3) land, the privacy page's honest description is the mitigation, and
it names the person who can act.

---

## 6. Internal TestFlight — what it removes and what it does not

Aziz chose **internal** TestFlight distribution (App Store Connect team members
holding a role, up to 100 people, up to 100 devices each). That choice is worth
writing down precisely, because it deletes a lot of the classic checklist and
none of the hard parts.

**Removed — do not spend time on these now:**

- **App Review and Beta App Review.** Internal testing skips both. External
  TestFlight groups need Beta App Review; internal groups do not.
- **Marketing screenshots** at Apple's device sizes.
- **Store listing copy** — name, subtitle, description, keywords, promotional
  text, support/marketing URLs as *listing* fields.
- **Age rating questionnaire** and category selection.
- **A demo account for App Review.** Worth keeping in mind for later: the app is
  invite-only and every screen past sign-in is gated, so a public submission
  *will* be rejected without working credentials in the review notes.

**Not removed — every one of these still bites:**

- **Apple Developer Program membership and a signing team.** Aziz has the
  account; `DEVELOPMENT_TEAM` is still unset in `project.pbxproj`.
- **The App ID / bundle id registered on the developer portal** — now
  `app.nphiescore`, which is a *new* identifier and has certainly never been
  registered.
- **A Release-configuration, distribution-signed archive.** Everything built so
  far is Debug for the simulator.
- **The upload-time automated checks**, which include the privacy manifest and
  required-reason API validation (`ITMS-9105x`). This is why §4.2 is required
  now.
- **Export compliance** (`ITSAppUsesNonExemptEncryption`) — already set.
- **App icons** — already correct, 1024×1024 with no alpha.
- **Version and build numbers.** Every upload needs a `CURRENT_PROJECT_VERSION`
  higher than the last one for the same `MARKETING_VERSION`. The build number is
  still `1` and no upload has happened, so `1` is correct exactly once.
- **The App Store Connect app record itself**, which is what everything above
  hangs off. Only Aziz can create it.
- **App privacy information.** Apple's console gates distribution on it in ways
  that have changed more than once. *Unverified here:* whether an internal-only
  TestFlight build can be distributed with the questionnaire blank. It costs
  fifteen minutes to fill in from §4.2 and removes the question.

---

## 7. Remaining checklist

### 7.1 Mechanical — no Apple account needed, any agent can do these

- ⬜ **Wire the privacy route.** Two diffs, in the handoff for the privacy unit:
  `src/App.tsx` (lazy import, a route on each side of the auth gate, a
  `titleKeyFor` branch, a Settings link) and `src/locales/index.ts` (two imports
  and two namespace-map entries). Without the second one the page renders 68 dot
  paths.
- ⚠ **Reconcile the version numbers.** `package.json` says `1.0.1`;
  `MARKETING_VERSION` says `1.1.0`. This is the third time these two have
  drifted, and the previous revision of this document predicted it in writing.
  **`package.json` is the source of truth** — Vite already inlines it as
  `__APP_VERSION__`, Settings › About renders it, every export is stamped with
  it, and the privacy page prints it. Write the `cap sync` companion script that
  sets `MARKETING_VERSION` from `pkg.version` **now**, not at the next bump; the
  argument for deferring it ("nothing has shipped, so nothing is wrong where a
  user can see it") has now cost three manual edits.
- ⬜ **Rebuild and re-verify on the current identity.** §2.1 — the whole of the
  simulator evidence is about `app.opstrack`/CoreTrack and proves nothing about
  `app.nphiescore`/NphiesCore. Redo build → install → launch → screenshot, and
  read `CFBundleDisplayName` back out of the *installed* bundle.
- ⬜ **Retake the evidence screenshots** once the map is the landing screen; the
  three under `docs/EVIDENCE/shots/` show the old wordmark and the pre-map
  navigation.
- ⬜ **Offline behaviour on a real device.** `store/outbox.ts` + `lib/cache.ts`
  have never been exercised with real airplane-mode transitions. This is the
  feature most likely to behave differently on hardware.
- ⬜ **Decide the orientation question.** `Info.plist` allows portrait and both
  landscapes on iPhone; the PWA manifest declares `orientation: 'portrait'`. In
  landscape an iPhone 17 Pro is 956 CSS px wide, which crosses the 768px
  breakpoint into the desktop sidebar layout on a 440px-tall screen. Either
  verify landscape or restrict iPhone to portrait — it is a product decision,
  not a config cleanup.
- ⬜ **Self-service account deletion** — §5, items (1)–(3). Not blocking for
  internal TestFlight; blocking for anything that touches App Review.

### 7.2 Aziz only — nobody else can do these

1. **Sign Xcode into the Apple Developer account** (Xcode ▸ Settings ▸ Accounts),
   which enables automatic signing and populates `DEVELOPMENT_TEAM`. *Or*
   provide an App Store Connect API key (`.p8` + key id + issuer id), stored
   gitignored the way the Supabase token is. **Claude must never handle the
   Apple ID password or the 2FA code.**
2. **Register the App ID `app.nphiescore`** on the developer portal.
3. **Create the App Store Connect record** — this is the thing every remaining
   item hangs off.
4. **Set the privacy policy URL** in App Information (§4.1) — `https://nphiescore.com/#/privacy`
   once the domain cut-over has landed, and check that it has before typing it.
5. **Answer the App Privacy questionnaire** (§4.3) from
   `PrivacyInfo.xcprivacy`.
6. **Archive and upload** — Xcode ▸ Product ▸ Archive with a Release
   configuration, then Distribute App ▸ TestFlight Internal Only. Watch for an
   `ITMS-` email; the privacy-manifest check fires here.
7. **Add the internal testers** and hand out the TestFlight invitations.

---

## 8. Standing hazards

- **The Supabase anon key is baked into the JS bundle**, and therefore into the
  `.ipa`. That is normal and by design — RLS is the actual access control — but
  it means the key is extractable. It only stays safe while RLS coverage is
  complete; see the migration series and `docs/EXECUTION-PLAN.md`.
- **`@opstrack.internal` is not a leftover and must never be renamed.** It is
  the synthetic sign-in domain for every admin-provisioned account, and those
  are real rows in `auth.users`. Renaming it locks every member out. The bundle
  id moving to `app.nphiescore` does **not** imply this should follow.
- **The MCP `Claude Code iOS Simulator` `control` action does not work on this
  machine**, and its error message blames Xcode selection, which is a red
  herring: `build` compiles through the same toolchain. Two things are true at
  once — `/var/db/xcode_select_link` really is absent (so
  `sudo xcode-select -s /Applications/Xcode.app/Contents/Developer` is a
  legitimate thing to run), *and* the host reports the feature as
  `"iosSimulator": {"status": "unsupported", "reason": "… disabled by its
  rollout flag"}`, which no sudo command changes. If `attach` still fails after
  the sudo, that is expected and the Mac is not broken. Use `xcrun simctl` —
  Apple's own CLI over the same CoreSimulator backend — for
  `uninstall`/`install`/`launch`/`io … screenshot`/`spawn … log show`.
- **The MCP `build` action's `udid` argument rejects genuinely booted devices.**
  Omit it and let it build for `generic/platform=iOS Simulator`.
