// The locale bundles, assembled from one file per namespace.
//
// WHY THE SPLIT. `src/locales/{en,ar}.json` was the worst contention point in
// the build plan: twenty-five workers across six waves all need keys, and two
// files means every one of them edits the same two files. One file per
// top-level namespace makes locale ownership disjoint the same way file
// ownership is, so a feature worker can add its own strings without ever
// touching a shared bundle.
//
// THE INVARIANT THAT MAKES IT SAFE: a namespace file's basename IS its single
// top-level key — `en/board.json` contains exactly `{ "board": { … } }` and
// nothing else. The merge below is a flat spread, so a root appearing in two
// files would silently win by import order; `src/lib/localeParity.test.ts`
// asserts the one-root-per-file rule and cross-file root uniqueness precisely
// because the merge itself cannot.
//
// `t()`'s key space is UNCHANGED by the split — every one of the 213 keys that
// existed before it still resolves at the same dot path, and the parity test
// carries that list as a committed fixture. Adding a namespace here is two
// imports and two spread entries; nothing else in the app changes.
//
// RETIRING one is the same four lines in reverse, and `placeholder` is the first
// namespace to go: every screen it apologised for — capture, follow-ups, the
// board, the tracks tree, a track's log, the entry surface, meeting mode and the
// dashboard — now exists, so its ten strings had no call site left once Wave 4b
// replaced the last `placeholder.comingSoon` on the Settings page. Ten of the 213
// baseline keys went with it; localeParity.test.ts's RETIRED_KEYS block carries
// them by name and asserts they resolve in NEITHER bundle, so the total is still
// accounted for and half a namespace cannot creep back.
//
// `sso` is the second, and it retires for a different reason: not "the screen
// arrived" but "the feature was cancelled". WAVE5-NOTES §2 removes the Microsoft
// Entra path outright — the admin-managed Members directory IS this product's
// directory — so `sso.json`, `lib/sso.ts`, `components/SsoButtons.tsx` and
// `docs/AZURE-AD-SETUP.md` all went together, and `signin.microsoft` (the button's
// label, which had been dormant since Wave 1) went with them. NONE of those keys
// was in the 213-key baseline: the namespace was born in Wave 4b, and
// `signin.microsoft` was added BY the splitting commit itself rather than
// inherited from the monolithic bundle it replaced (`git show 67a2844^:src/
// locales/en.json | grep microsoft` finds nothing). So RETIRED_KEYS is untouched
// here and its arithmetic still balances at 213 — a post-baseline namespace really
// is just the six lines below in reverse, with nothing to park.
//
// This module must not import from `src/lib/i18n.ts`. i18n imports *this*, and
// the reverse edge would be a cycle — which is why `Locale` is not used below
// and the two bundles are exported separately rather than as a keyed record.

import enAdmin from './en/admin.json'
import enApp from './en/app.json'
import enBoard from './en/board.json'
import enCapture from './en/capture.json'
import enClaim from './en/claim.json'
import enCmd from './en/cmd.json'
import enCommon from './en/common.json'
import enDashboard from './en/dashboard.json'
import enDate from './en/date.json'
import enDigest from './en/digest.json'
import enEntry from './en/entry.json'
// `export` is a reserved word, so the binding cannot be named after the
// namespace the way every other one here is. The map keys below are unaffected —
// an object property may be a reserved word.
import enExport from './en/export.json'
import enFilter from './en/filter.json'
import enFollowups from './en/followups.json'
import enHealth from './en/health.json'
import enMeeting from './en/meeting.json'
import enMembers from './en/members.json'
import enMindtree from './en/mindtree.json'
import enMinutes from './en/minutes.json'
import enNav from './en/nav.json'
import enNotif from './en/notif.json'
import enOffline from './en/offline.json'
import enPriority from './en/priority.json'
import enPush from './en/push.json'
import enPwa from './en/pwa.json'
import enRecurring from './en/recurring.json'
import enRoute from './en/route.json'
import enSettings from './en/settings.json'
import enSignin from './en/signin.json'
import enStatus from './en/status.json'
import enTrack from './en/track.json'
import enTree from './en/tree.json'
import enType from './en/type.json'
import enVocabadmin from './en/vocabadmin.json'

import arAdmin from './ar/admin.json'
import arApp from './ar/app.json'
import arBoard from './ar/board.json'
import arCapture from './ar/capture.json'
import arClaim from './ar/claim.json'
import arCmd from './ar/cmd.json'
import arCommon from './ar/common.json'
import arDashboard from './ar/dashboard.json'
import arDate from './ar/date.json'
import arDigest from './ar/digest.json'
import arEntry from './ar/entry.json'
import arExport from './ar/export.json'
import arFilter from './ar/filter.json'
import arFollowups from './ar/followups.json'
import arHealth from './ar/health.json'
import arMeeting from './ar/meeting.json'
import arMembers from './ar/members.json'
import arMindtree from './ar/mindtree.json'
import arMinutes from './ar/minutes.json'
import arNav from './ar/nav.json'
import arNotif from './ar/notif.json'
import arOffline from './ar/offline.json'
import arPriority from './ar/priority.json'
import arPush from './ar/push.json'
import arPwa from './ar/pwa.json'
import arRecurring from './ar/recurring.json'
import arRoute from './ar/route.json'
import arSettings from './ar/settings.json'
import arSignin from './ar/signin.json'
import arStatus from './ar/status.json'
import arTrack from './ar/track.json'
import arTree from './ar/tree.json'
import arType from './ar/type.json'
import arVocabadmin from './ar/vocabadmin.json'

/** A locale bundle: nested objects bottoming out in strings. */
export interface LocaleTree {
  [k: string]: string | LocaleTree
}

/**
 * namespace → the whole file's contents (still wrapped in its own root key).
 *
 * Exported for the parity test, which needs to check each PAIR of files rather
 * than the merged bundles — a key missing from `ar/board.json` but present
 * under some other root in `ar` would pass a merged-bundle check and still be
 * a bug.
 */
export const EN_NAMESPACES: Readonly<Record<string, LocaleTree>> = {
  admin: enAdmin,
  app: enApp,
  board: enBoard,
  capture: enCapture,
  claim: enClaim,
  cmd: enCmd,
  common: enCommon,
  dashboard: enDashboard,
  date: enDate,
  digest: enDigest,
  entry: enEntry,
  export: enExport,
  filter: enFilter,
  followups: enFollowups,
  health: enHealth,
  meeting: enMeeting,
  members: enMembers,
  mindtree: enMindtree,
  minutes: enMinutes,
  nav: enNav,
  notif: enNotif,
  offline: enOffline,
  priority: enPriority,
  push: enPush,
  pwa: enPwa,
  recurring: enRecurring,
  route: enRoute,
  settings: enSettings,
  signin: enSignin,
  status: enStatus,
  track: enTrack,
  tree: enTree,
  type: enType,
  vocabadmin: enVocabadmin,
}

export const AR_NAMESPACES: Readonly<Record<string, LocaleTree>> = {
  admin: arAdmin,
  app: arApp,
  board: arBoard,
  capture: arCapture,
  claim: arClaim,
  cmd: arCmd,
  common: arCommon,
  dashboard: arDashboard,
  date: arDate,
  digest: arDigest,
  entry: arEntry,
  export: arExport,
  filter: arFilter,
  followups: arFollowups,
  health: arHealth,
  meeting: arMeeting,
  members: arMembers,
  mindtree: arMindtree,
  minutes: arMinutes,
  nav: arNav,
  notif: arNotif,
  offline: arOffline,
  priority: arPriority,
  push: arPush,
  pwa: arPwa,
  recurring: arRecurring,
  route: arRoute,
  settings: arSettings,
  signin: arSignin,
  status: arStatus,
  track: arTrack,
  tree: arTree,
  type: arType,
  vocabadmin: arVocabadmin,
}

/**
 * The merged bundles lib/i18n.ts looks keys up in.
 *
 * Built by spreading the same objects the maps above hold rather than by
 * reducing over those maps, so the shape stays statically known: Vite inlines
 * the JSON and tree-shakes what an entry point never reaches. A runtime
 * `Object.assign` over a record would defeat that and cost a bundle-size
 * regression on a file nobody would think to re-check.
 */
export const en: LocaleTree = {
  ...enAdmin,
  ...enApp,
  ...enBoard,
  ...enCapture,
  ...enClaim,
  ...enCmd,
  ...enCommon,
  ...enDashboard,
  ...enDate,
  ...enDigest,
  ...enEntry,
  ...enExport,
  ...enFilter,
  ...enFollowups,
  ...enHealth,
  ...enMeeting,
  ...enMembers,
  ...enMindtree,
  ...enMinutes,
  ...enNav,
  ...enNotif,
  ...enOffline,
  ...enPriority,
  ...enPush,
  ...enPwa,
  ...enRecurring,
  ...enRoute,
  ...enSettings,
  ...enSignin,
  ...enStatus,
  ...enTrack,
  ...enTree,
  ...enType,
  ...enVocabadmin,
}

export const ar: LocaleTree = {
  ...arAdmin,
  ...arApp,
  ...arBoard,
  ...arCapture,
  ...arClaim,
  ...arCmd,
  ...arCommon,
  ...arDashboard,
  ...arDate,
  ...arDigest,
  ...arEntry,
  ...arExport,
  ...arFilter,
  ...arFollowups,
  ...arHealth,
  ...arMeeting,
  ...arMembers,
  ...arMindtree,
  ...arMinutes,
  ...arNav,
  ...arNotif,
  ...arOffline,
  ...arPriority,
  ...arPush,
  ...arPwa,
  ...arRecurring,
  ...arRoute,
  ...arSettings,
  ...arSignin,
  ...arStatus,
  ...arTrack,
  ...arTree,
  ...arType,
  ...arVocabadmin,
}
