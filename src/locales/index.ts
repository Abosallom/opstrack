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
// This module must not import from `src/lib/i18n.ts`. i18n imports *this*, and
// the reverse edge would be a cycle — which is why `Locale` is not used below
// and the two bundles are exported separately rather than as a keyed record.

import enAdmin from './en/admin.json'
import enApp from './en/app.json'
import enBoard from './en/board.json'
import enCapture from './en/capture.json'
import enClaim from './en/claim.json'
import enCommon from './en/common.json'
import enDashboard from './en/dashboard.json'
import enDate from './en/date.json'
import enDigest from './en/digest.json'
import enEntry from './en/entry.json'
import enFilter from './en/filter.json'
import enFollowups from './en/followups.json'
import enHealth from './en/health.json'
import enMeeting from './en/meeting.json'
import enMinutes from './en/minutes.json'
import enNav from './en/nav.json'
import enNotif from './en/notif.json'
import enOffline from './en/offline.json'
import enPlaceholder from './en/placeholder.json'
import enPriority from './en/priority.json'
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
import arCommon from './ar/common.json'
import arDashboard from './ar/dashboard.json'
import arDate from './ar/date.json'
import arDigest from './ar/digest.json'
import arEntry from './ar/entry.json'
import arFilter from './ar/filter.json'
import arFollowups from './ar/followups.json'
import arHealth from './ar/health.json'
import arMeeting from './ar/meeting.json'
import arMinutes from './ar/minutes.json'
import arNav from './ar/nav.json'
import arNotif from './ar/notif.json'
import arOffline from './ar/offline.json'
import arPlaceholder from './ar/placeholder.json'
import arPriority from './ar/priority.json'
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
  common: enCommon,
  dashboard: enDashboard,
  date: enDate,
  digest: enDigest,
  entry: enEntry,
  filter: enFilter,
  followups: enFollowups,
  health: enHealth,
  meeting: enMeeting,
  minutes: enMinutes,
  nav: enNav,
  notif: enNotif,
  offline: enOffline,
  placeholder: enPlaceholder,
  priority: enPriority,
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
  common: arCommon,
  dashboard: arDashboard,
  date: arDate,
  digest: arDigest,
  entry: arEntry,
  filter: arFilter,
  followups: arFollowups,
  health: arHealth,
  meeting: arMeeting,
  minutes: arMinutes,
  nav: arNav,
  notif: arNotif,
  offline: arOffline,
  placeholder: arPlaceholder,
  priority: arPriority,
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
  ...enCommon,
  ...enDashboard,
  ...enDate,
  ...enDigest,
  ...enEntry,
  ...enFilter,
  ...enFollowups,
  ...enHealth,
  ...enMeeting,
  ...enMinutes,
  ...enNav,
  ...enNotif,
  ...enOffline,
  ...enPlaceholder,
  ...enPriority,
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
  ...arCommon,
  ...arDashboard,
  ...arDate,
  ...arDigest,
  ...arEntry,
  ...arFilter,
  ...arFollowups,
  ...arHealth,
  ...arMeeting,
  ...arMinutes,
  ...arNav,
  ...arNotif,
  ...arOffline,
  ...arPlaceholder,
  ...arPriority,
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
