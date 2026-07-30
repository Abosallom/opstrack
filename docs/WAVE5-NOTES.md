# Wave 5 spec deltas (owner directives, 2026-07-30)

Binding on the Wave-5 fleet and on any Wave-4b agent whose files these touch.

## 1. Product name: CoreTrack now, NphiesCore at launch

Aziz: rename **OpsTrack → CoreTrack** for the team-testing period. The official launch name is
**NphiesCore** — do NOT use it anywhere yet; it arrives with the launch cut.

Scope of the rename NOW (user-visible branding only):
- `app.name` in both locale bundles, `index.html` title/meta, the PWA manifest name/short_name,
  README/ADMIN titles, the iOS app display name (`capacitor.config.json` appName + Xcode display
  name — W4B-IOS coordinate), email-visible strings if any.
- **Deliberately NOT renamed** (stable identity until the NphiesCore launch cut, to avoid breaking
  the installed PWA, bookmarks, and stored state mid-testing): the repo `Abosallom/opstrack`, the
  Pages URL, `package.json` name, `localStorage` keys (`opstrack_*`), CSS prefixes, the Supabase
  project name, and the iOS bundle id. The launch cut does the full identity swap once, cleanly:
  repo+URL+bundle id+storage migration under the NphiesCore name.

## 2. Azure AD is OUT — the admin-managed directory IS the directory

Aziz: "I don't want to sign in using the company's active directory; I want my own directory to be
set by the admin." The Members screen (usernames + invite codes, admin-provisioned) is the
product's directory. Therefore:
- Remove `SsoButtons`, `src/lib/sso.ts`, `sso.json`, `docs/AZURE-AD-SETUP.md` and any SignIn
  wiring for OAuth providers (Wave 4b may have just built them — delete cleanly, they are inert
  since the provider was never configured).
- Docs describe the admin directory as the identity model; no external IdP.
- Supabase auth config: leave external providers disabled; nothing to revert server-side.

## 3. App Store: Aziz HAS an Apple Developer account

Submission is no longer external-blocked. Claude must never handle his Apple ID password/2FA —
the workable paths, in order of preference:
1. He signs into Xcode once (Xcode → Settings → Accounts) on this Mac; automatic signing then
   works for device builds and archive/upload from Xcode.
2. For CLI upload automation: an App Store Connect API key (.p8 + key id + issuer id) provided
   like the Supabase token — stored gitignored, never committed.
The store listing itself (name NphiesCore vs CoreTrack for TestFlight) is decided at submission
time; TestFlight can carry CoreTrack during team testing.
