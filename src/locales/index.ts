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
import enDate from './en/date.json'
import enEntry from './en/entry.json'
import enFilter from './en/filter.json'
import enFollowups from './en/followups.json'
import enHealth from './en/health.json'
import enNav from './en/nav.json'
import enNotif from './en/notif.json'
import enOffline from './en/offline.json'
import enPlaceholder from './en/placeholder.json'
import enPriority from './en/priority.json'
import enPwa from './en/pwa.json'
import enRoute from './en/route.json'
import enSettings from './en/settings.json'
import enSignin from './en/signin.json'
import enStatus from './en/status.json'
import enType from './en/type.json'
import enVocabadmin from './en/vocabadmin.json'

import arAdmin from './ar/admin.json'
import arApp from './ar/app.json'
import arBoard from './ar/board.json'
import arCapture from './ar/capture.json'
import arClaim from './ar/claim.json'
import arCommon from './ar/common.json'
import arDate from './ar/date.json'
import arEntry from './ar/entry.json'
import arFilter from './ar/filter.json'
import arFollowups from './ar/followups.json'
import arHealth from './ar/health.json'
import arNav from './ar/nav.json'
import arNotif from './ar/notif.json'
import arOffline from './ar/offline.json'
import arPlaceholder from './ar/placeholder.json'
import arPriority from './ar/priority.json'
import arPwa from './ar/pwa.json'
import arRoute from './ar/route.json'
import arSettings from './ar/settings.json'
import arSignin from './ar/signin.json'
import arStatus from './ar/status.json'
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
  date: enDate,
  entry: enEntry,
  filter: enFilter,
  followups: enFollowups,
  health: enHealth,
  nav: enNav,
  notif: enNotif,
  offline: enOffline,
  placeholder: enPlaceholder,
  priority: enPriority,
  pwa: enPwa,
  route: enRoute,
  settings: enSettings,
  signin: enSignin,
  status: enStatus,
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
  date: arDate,
  entry: arEntry,
  filter: arFilter,
  followups: arFollowups,
  health: arHealth,
  nav: arNav,
  notif: arNotif,
  offline: arOffline,
  placeholder: arPlaceholder,
  priority: arPriority,
  pwa: arPwa,
  route: arRoute,
  settings: arSettings,
  signin: arSignin,
  status: arStatus,
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
  ...enDate,
  ...enEntry,
  ...enFilter,
  ...enFollowups,
  ...enHealth,
  ...enNav,
  ...enNotif,
  ...enOffline,
  ...enPlaceholder,
  ...enPriority,
  ...enPwa,
  ...enRoute,
  ...enSettings,
  ...enSignin,
  ...enStatus,
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
  ...arDate,
  ...arEntry,
  ...arFilter,
  ...arFollowups,
  ...arHealth,
  ...arNav,
  ...arNotif,
  ...arOffline,
  ...arPlaceholder,
  ...arPriority,
  ...arPwa,
  ...arRoute,
  ...arSettings,
  ...arSignin,
  ...arStatus,
  ...arType,
  ...arVocabadmin,
}
