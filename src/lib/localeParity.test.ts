// The locale gate. `npm run test` runs it; CI runs `npm run test`.
//
// This is the ONLY parity mechanism in the repo — there is deliberately no
// scripts/i18n-check.mjs. Two mechanisms is two things to drift.
//
// What it is actually defending against, in the order the failures bite:
//
//  1. The split losing a key. `src/locales/{en,ar}.json` were one file each
//     until the namespace tree replaced them; BASELINE_KEYS is the committed
//     list of all 213 keys that existed at that moment, and asserting it still
//     resolves is the only proof the refactor was lossless. Never delete an
//     entry from that list to make a test pass — a missing key means a call
//     site somewhere is rendering its own dot path at a user.
//  2. An Arabic translation silently dropping an interpolation token. `"{count}
//     items"` translated as `"عناصر"` renders a sentence with the number gone
//     and nothing anywhere reports it. Checked per key, both directions.
//  3. Two namespace files claiming the same root. The merge in
//     locales/index.ts is a flat spread, so the loser vanishes with no error.
//     The merge cannot catch this; only this test can.
//  4. An empty value, which renders as blank space rather than as an obviously
//     missing string.
//
// Vitest imports are explicit on purpose: no globals config, and nothing is
// added to tsconfig.app.json's `types` array.

import { describe, expect, it } from 'vitest'
import { AR_NAMESPACES, EN_NAMESPACES, ar, en, type LocaleTree } from '../locales'

/**
 * Every key that existed in the two monolithic bundles, verbatim.
 *
 * Stored as one whitespace-delimited string rather than an array literal so it
 * stays greppable and reviewable at a glance; 213 quoted array entries is a
 * diff nobody reads.
 */
const BASELINE_KEYS: readonly string[] = `
  app.name app.tagline nav.capture nav.followups nav.board nav.tracks nav.more nav.primary
  nav.openMenu nav.closeMenu nav.skipToContent route.signin route.capture route.followups
  route.board route.tracks route.trackDetail route.entry route.meetings route.dashboard
  route.settings signin.heading signin.subtitle signin.emailLabel signin.emailPlaceholder
  signin.sendCode signin.sending signin.codeHeading signin.codeSent signin.codeLabel
  signin.codePlaceholder signin.verify signin.verifying signin.resend signin.resendIn
  signin.codeResent signin.changeEmail signin.errEmailRequired signin.errEmailInvalid
  signin.errCodeRequired signin.errNoAccount signin.errCodeInvalid signin.errRateLimited
  signin.errNetwork signin.errGeneric signin.notConfigured signin.signedOut settings.title
  settings.appearance settings.theme settings.themeAuto settings.themeDark
  settings.themeLight settings.themeHint settings.language settings.languageEn
  settings.languageAr settings.languageHint settings.account settings.signedInAs
  settings.role settings.roleAdmin settings.roleMember settings.signOut settings.signingOut
  settings.members settings.membersHint settings.membersSoon settings.membersEmpty
  settings.membersAdminOnly settings.about settings.version settings.backend
  settings.backendConnected settings.backendChecking settings.backendUnreachable
  settings.backendNotConfigured admin.title admin.errForbidden admin.tracks.title
  admin.tracks.subtitle admin.tracks.manage admin.tracks.add admin.tracks.edit
  admin.tracks.name admin.tracks.namePlaceholder admin.tracks.nameAr
  admin.tracks.nameArPlaceholder admin.tracks.description admin.tracks.descriptionAr
  admin.tracks.color admin.tracks.colorLight admin.tracks.colorHint admin.tracks.icon
  admin.tracks.colorViolet admin.tracks.colorCyan admin.tracks.colorAmber
  admin.tracks.colorGreen admin.tracks.colorRose admin.tracks.colorBlue admin.tracks.colorRed
  admin.tracks.icon_clipboard-list admin.tracks.icon_server-cog admin.tracks.icon_network
  admin.tracks.icon_server admin.tracks.icon_activity admin.tracks.icon_database
  admin.tracks.icon_cloud admin.tracks.icon_terminal admin.tracks.icon_shield
  admin.tracks.icon_layers admin.tracks.icon_chart admin.tracks.icon_users
  admin.tracks.preview admin.tracks.order admin.tracks.moveUp admin.tracks.moveDown
  admin.tracks.movedTo admin.tracks.reordered admin.tracks.archived admin.tracks.active
  admin.tracks.archive admin.tracks.restore admin.tracks.showArchived admin.tracks.delete
  admin.tracks.deleteTitle admin.tracks.deleteBody admin.tracks.deleteBodyInUse
  admin.tracks.archiveTitle admin.tracks.archiveBody admin.tracks.discardTitle
  admin.tracks.discardBody admin.tracks.discard admin.tracks.reassignTo
  admin.tracks.reassignNoTargets admin.tracks.usage admin.tracks.usageEntries
  admin.tracks.usageMeetings admin.tracks.usageTemplates admin.tracks.usageNone
  admin.tracks.empty admin.tracks.emptyHint admin.tracks.saving admin.tracks.saved
  admin.tracks.created admin.tracks.deleted admin.tracks.archivedToast
  admin.tracks.restoredToast admin.tracks.loadFailed admin.tracks.errNameRequired
  admin.tracks.errNameLong admin.tracks.errColor admin.tracks.errNameTaken
  admin.tracks.errNameArTaken admin.tracks.errInUse admin.tracks.errLastTrack
  admin.tracks.errReassignArchived admin.tracks.errReassignSelf admin.tracks.errNotFound
  placeholder.comingSoon placeholder.phase1 placeholder.capture placeholder.followups
  placeholder.board placeholder.tracks placeholder.trackDetail placeholder.entry
  placeholder.meetings placeholder.dashboard offline.banner offline.backOnline
  offline.pending pwa.updateReady common.loading common.empty common.emptyHint common.error
  common.errorHint common.retry common.reload common.cancel common.save common.saved
  common.close common.back common.search common.dismiss common.none common.notConfigured
  common.notSignedIn common.toggleTheme common.toggleLanguage status.new status.in_progress
  status.blocked status.waiting_on status.done status.cancelled priority.low priority.medium
  priority.high priority.critical type.action type.decision type.issue type.request
  type.change type.escalation type.note health.ok health.stale health.overdue health.critical
`
  .trim()
  .split(/\s+/)

/** dot path → string, for every leaf. Nested objects recurse; nothing else exists. */
function flatten(tree: LocaleTree, prefix = ''): Map<string, string> {
  const out = new Map<string, string>()
  for (const [k, v] of Object.entries(tree)) {
    const path = prefix ? `${prefix}.${k}` : k
    if (typeof v === 'string') out.set(path, v)
    else for (const [nested, value] of flatten(v, path)) out.set(nested, value)
  }
  return out
}

/** The `{token}` set in a value. Order-independent — only membership matters. */
function tokensOf(value: string): string[] {
  return [...value.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort()
}

const NAMESPACES = Object.keys(EN_NAMESPACES).sort()
const FLAT_EN = flatten(en)
const FLAT_AR = flatten(ar)

describe('locale namespace files', () => {
  it('ship the same namespaces in both languages', () => {
    expect(Object.keys(AR_NAMESPACES).sort()).toEqual(NAMESPACES)
  })

  it.each(NAMESPACES)('%s: file contains exactly its own root key', (ns) => {
    expect(Object.keys(EN_NAMESPACES[ns])).toEqual([ns])
    expect(Object.keys(AR_NAMESPACES[ns])).toEqual([ns])
  })

  it.each(NAMESPACES)('%s: en and ar hold identical key sets', (ns) => {
    const enKeys = [...flatten(EN_NAMESPACES[ns]).keys()].sort()
    const arKeys = [...flatten(AR_NAMESPACES[ns]).keys()].sort()
    // Reported as two diffs rather than one so a failure names the missing
    // keys instead of dumping both hundred-key lists side by side.
    expect(enKeys.filter((k) => !arKeys.includes(k))).toEqual([])
    expect(arKeys.filter((k) => !enKeys.includes(k))).toEqual([])
  })
})

describe('merged bundles', () => {
  it('lose no namespace to a duplicate root', () => {
    // A root claimed by two files would be spread over in index.ts and vanish
    // with no error anywhere. Every namespace must survive the merge.
    for (const ns of NAMESPACES) {
      expect(Object.keys(en)).toContain(ns)
      expect(Object.keys(ar)).toContain(ns)
    }
    expect(Object.keys(en).length).toBe(NAMESPACES.length)
    expect(Object.keys(ar).length).toBe(NAMESPACES.length)
  })

  it('hold identical flattened key sets', () => {
    const enKeys = [...FLAT_EN.keys()].sort()
    const arKeys = [...FLAT_AR.keys()].sort()
    expect(enKeys.filter((k) => !arKeys.includes(k))).toEqual([])
    expect(arKeys.filter((k) => !enKeys.includes(k))).toEqual([])
  })

  it('agree on which paths are objects and which are strings', () => {
    // A key that is a string in en and an object in ar (or the reverse) passes
    // a naive leaf-set comparison in one direction and breaks lookup().
    const enRoots = new Set([...FLAT_EN.keys()])
    for (const k of FLAT_AR.keys()) expect(enRoots.has(k)).toBe(true)
  })

  it('preserve all 213 keys that predate the namespace split', () => {
    expect(BASELINE_KEYS.length).toBe(213)
    expect(BASELINE_KEYS.filter((k) => !FLAT_EN.has(k))).toEqual([])
    expect(BASELINE_KEYS.filter((k) => !FLAT_AR.has(k))).toEqual([])
  })

  it('have no empty values in either language', () => {
    expect([...FLAT_EN].filter(([, v]) => v.trim() === '').map(([k]) => k)).toEqual([])
    expect([...FLAT_AR].filter(([, v]) => v.trim() === '').map(([k]) => k)).toEqual([])
  })

  it('use the same interpolation tokens in both languages', () => {
    const mismatched: string[] = []
    for (const [key, enValue] of FLAT_EN) {
      const arValue = FLAT_AR.get(key)
      if (arValue === undefined) continue
      const a = tokensOf(enValue)
      const b = tokensOf(arValue)
      if (a.join(',') !== b.join(',')) mismatched.push(`${key}: en{${a}} ar{${b}}`)
    }
    expect(mismatched).toEqual([])
  })
})
