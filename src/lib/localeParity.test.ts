// The locale gate. `npm run test` runs it; CI runs `npm run test`.
//
// This is the ONLY parity mechanism in the repo — there is deliberately no
// scripts/i18n-check.mjs. Two mechanisms is two things to drift.
//
// What it is actually defending against, in the order the failures bite:
//
//  1. The split losing a key. `src/locales/{en,ar}.json` were one file each
//     until the namespace tree replaced them; BASELINE_KEYS is the committed
//     list of the keys that existed at that moment, and asserting it still
//     resolves is the only proof the refactor was lossless. Never delete an
//     entry from that list to make a test pass — a missing key means a call
//     site somewhere is rendering its own dot path at a user. A key that is
//     genuinely, deliberately RETIRED moves to RETIRED_KEYS below instead of
//     vanishing, so the 213 stays arithmetic rather than folklore.
//  2. An Arabic translation silently dropping an interpolation token. `"{count}
//     items"` translated as `"عناصر"` renders a sentence with the number gone
//     and nothing anywhere reports it. Checked per key, both directions.
//  3. Two namespace files claiming the same root. The merge in
//     locales/index.ts is a flat spread, so the loser vanishes with no error.
//     The merge cannot catch this; only this test can.
//  4. An empty value, which renders as blank space rather than as an obviously
//     missing string.
//  5. A malformed or unreachable PLURAL NODE. See the plural block at the
//     bottom of this file for what is checked and why each check earns its
//     keep — a plural node is the one place in the tree where a typo produces
//     a silently WRONG sentence rather than a visibly missing one.
//
// Vitest imports are explicit on purpose: no globals config, and nothing is
// added to tsconfig.app.json's `types` array.

import { describe, expect, it } from 'vitest'
import { AR_NAMESPACES, EN_NAMESPACES, ar, en, type LocaleTree } from '../locales'
import {
  EXACT_CATEGORIES,
  PLURAL_CATEGORIES,
  isPluralNode,
  pluralCategory,
  type PluralCategory,
  type PluralNode,
} from './plural'
import type { Locale } from './i18n'

/**
 * Every key that existed in the two monolithic bundles and still ships, verbatim.
 *
 * Stored as one whitespace-delimited string rather than an array literal so it
 * stays greppable and reviewable at a glance; 203 quoted array entries is a
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
  offline.banner offline.backOnline
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

/**
 * Baseline keys that have been DELETED on purpose, and must stay deleted.
 *
 * This list is not an escape hatch, and it is deliberately harder to satisfy
 * than BASELINE_KEYS: an entry here is asserted to resolve in NEITHER bundle.
 * A key cannot be parked in it to silence a failure — parking a key that is
 * still shipped fails immediately, and so does half-removing one (present in
 * `en`, gone from `ar`).
 *
 * WHY THE `placeholder` NAMESPACE IS HERE. It was one component apologising for
 * screens that did not exist yet. Every one of them now does — capture,
 * follow-ups, the board, the tracks tree, a track's log, the entry surface,
 * meeting mode, the dashboard — and Wave 4b replaced the last live
 * `placeholder.comingSoon` (the "member management arrives later" pill on the
 * Settings page) with a link to the real /settings/members screen. `pages/
 * Placeholder.tsx`, `pages/placeholder.css` and both `placeholder.json` files
 * went with it. Keeping ten unreachable apologies in the tree so that a count
 * would still read 213 would be the fixture wagging the app.
 *
 * BASELINE_KEYS.length + RETIRED_KEYS.length is still 213, and the assertion
 * below checks that sum — which is what keeps this from being a way to quietly
 * shrink the guarantee one key at a time.
 */
const RETIRED_KEYS: readonly string[] = `
  placeholder.comingSoon placeholder.phase1 placeholder.capture placeholder.followups
  placeholder.board placeholder.tracks placeholder.trackDetail placeholder.entry
  placeholder.meetings placeholder.dashboard
`
  .trim()
  .split(/\s+/)

/**
 * One translatable value: a plain string, or the set of plural forms.
 *
 * A PLURAL NODE IS A LEAF, not a sub-namespace, and that is the whole reason
 * this type exists. `admin.tracks.usageEntries` is one key that a call site asks
 * for by that exact path; the fact that English answers with two forms and
 * Arabic with six is an implementation detail of each language, not a shape the
 * two bundles have to agree on (lib/plural.ts's header spells out why). Flatten
 * to `.one`/`.few` instead and every parity assertion below turns into a demand
 * that Arabic have English grammar.
 *
 * `forms.other` always exists — isPluralNode() requires it, and a plain string
 * is stored as its own `other`, which makes the two cases comparable without a
 * discriminant at every use site.
 */
interface Leaf {
  plural: boolean
  forms: PluralNode
}

/** dot path → leaf. Nested objects recurse UNLESS they are plural nodes. */
function flatten(tree: LocaleTree, prefix = ''): Map<string, Leaf> {
  const out = new Map<string, Leaf>()
  for (const [k, v] of Object.entries(tree)) {
    const path = prefix ? `${prefix}.${k}` : k
    if (typeof v === 'string') out.set(path, { plural: false, forms: { other: v } })
    else if (isPluralNode(v)) out.set(path, { plural: true, forms: v })
    else for (const [nested, leaf] of flatten(v, path)) out.set(nested, leaf)
  }
  return out
}

/** The `{token}` set in a value. Order-independent — only membership matters. */
function tokensOf(value: string): string[] {
  return [...value.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort()
}

/** Every form of a leaf, as `[category, value]`, in canonical category order. */
function formsOf(leaf: Leaf): [PluralCategory, string][] {
  return PLURAL_CATEGORIES.filter((c) => leaf.forms[c] !== undefined).map((c) => [
    c,
    leaf.forms[c] as string,
  ])
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

  it('agree on which paths are leaves and which are namespaces', () => {
    // A key that is a leaf in en and a sub-namespace in ar (or the reverse)
    // passes a naive leaf-set comparison in one direction and breaks lookup().
    // Plural node vs plain string is NOT that bug — both are leaves, both
    // resolve at the same path, and flatten() above treats them alike.
    const enRoots = new Set([...FLAT_EN.keys()])
    for (const k of FLAT_AR.keys()) expect(enRoots.has(k)).toBe(true)
  })

  it('preserve every key that predates the namespace split and was not retired', () => {
    // The sum, not either half: shortening BASELINE_KEYS without lengthening
    // RETIRED_KEYS fails here, which is the whole point of the split.
    expect(BASELINE_KEYS.length + RETIRED_KEYS.length).toBe(213)
    expect(BASELINE_KEYS.filter((k) => !FLAT_EN.has(k))).toEqual([])
    expect(BASELINE_KEYS.filter((k) => !FLAT_AR.has(k))).toEqual([])
  })

  it('keep every deliberately retired key retired, in both languages', () => {
    // Asserted in the negative, and in BOTH bundles, so a half-revert — the
    // namespace re-added to `en` and forgotten in `ar` — fails here rather than
    // showing an Arabic reader an English apology for a screen that exists.
    expect(RETIRED_KEYS.filter((k) => FLAT_EN.has(k))).toEqual([])
    expect(RETIRED_KEYS.filter((k) => FLAT_AR.has(k))).toEqual([])
    // …and no path may be BOTH promised and retired.
    expect(RETIRED_KEYS.filter((k) => BASELINE_KEYS.includes(k))).toEqual([])
  })

  it('have no empty values in either language', () => {
    const empties = (flat: Map<string, Leaf>): string[] =>
      [...flat].flatMap(([key, leaf]) =>
        formsOf(leaf)
          .filter(([, v]) => v.trim() === '')
          .map(([c]) => (leaf.plural ? `${key}.${c}` : key)),
      )
    expect(empties(FLAT_EN)).toEqual([])
    expect(empties(FLAT_AR)).toEqual([])
  })

  it('use the same interpolation tokens in both languages', () => {
    // Compared on the `other` form, which is the one form both languages always
    // have and the one a lookup with no count falls back to. The forms WITHIN a
    // node are checked against their own `other` further down, so a dropped
    // token cannot hide in a category the other language does not use.
    const mismatched: string[] = []
    for (const [key, enLeaf] of FLAT_EN) {
      const arLeaf = FLAT_AR.get(key)
      if (arLeaf === undefined) continue
      const a = tokensOf(enLeaf.forms.other)
      const b = tokensOf(arLeaf.forms.other)
      if (a.join(',') !== b.join(',')) mismatched.push(`${key}: en{${a}} ar{${b}}`)
    }
    expect(mismatched).toEqual([])
  })
})

/* ─────────────────────────────── plural nodes ─────────────────────────────── */
//
// Four failure modes, none of which any assertion above can see, because a
// malformed plural node is not a MISSING string — it is a present, readable,
// grammatically wrong one:
//
//  1. A typo'd or invented category (`"othr"`, `"plural"`). isPluralNode() then
//     declines the node, lookup() recurses into it as a namespace and resolves
//     nothing, and t() renders the dot path. Caught by asserting that any object
//     holding a category-shaped key is a WELL-FORMED plural node.
//  2. A form in a category the language can never select. English has no `few`;
//     writing one is a translation nobody will ever read, and — worse — reads in
//     review as though the case is handled. The selectable set is derived by
//     running the real pluralCategory() over a wide range of n, so this test
//     cannot drift from the implementation it is checking.
//  3. `{count}` dropped from a RANGE form: `"many": "منذ أيام"` loses the number
//     for 11–99 and nothing anywhere reports it. Exact categories (zero/one/two)
//     are exempt because they pin the value — "Every day" and `بند واحد` are the
//     correct renderings, and demanding `{count}` there would forbid them.
//  4. A form inventing a token its `other` does not have, which interpolate()
//     leaves as literal braces in the UI.

const LOCALES: readonly [Locale, LocaleTree][] = [
  ['en', en],
  ['ar', ar],
]

/** The categories `pluralCategory` can actually return for a locale. */
function selectableCategories(locale: Locale): Set<PluralCategory> {
  const seen = new Set<PluralCategory>()
  for (let n = 0; n <= 200; n++) seen.add(pluralCategory(locale, n))
  return seen
}

/** Every object in the tree that is trying to be a plural node, well-formed or not. */
function categoryShapedNodes(tree: LocaleTree, prefix = ''): [string, LocaleTree][] {
  const out: [string, LocaleTree][] = []
  for (const [k, v] of Object.entries(tree)) {
    if (typeof v === 'string') continue
    const path = prefix ? `${prefix}.${k}` : k
    const looksPlural = Object.keys(v).some((c) =>
      (PLURAL_CATEGORIES as readonly string[]).includes(c),
    )
    if (looksPlural) out.push([path, v])
    else out.push(...categoryShapedNodes(v, path))
  }
  return out
}

describe.each(LOCALES)('%s plural nodes', (locale, tree) => {
  const nodes = categoryShapedNodes(tree)
  const selectable = selectableCategories(locale)

  it('are well formed: only legal categories, all strings, `other` present', () => {
    const malformed = nodes
      .filter(([, node]) => !isPluralNode(node))
      .map(([path, node]) => `${path}: {${Object.keys(node).join(',')}}`)
    expect(malformed).toEqual([])
  })

  it('ship no form this language can never select', () => {
    const unreachable: string[] = []
    for (const [path, node] of nodes) {
      for (const c of Object.keys(node)) {
        if ((PLURAL_CATEGORIES as readonly string[]).includes(c)) {
          if (!selectable.has(c as PluralCategory)) unreachable.push(`${path}.${c}`)
        }
      }
    }
    expect(unreachable).toEqual([])
  })

  it('carry {count} in every form that covers more than one number', () => {
    const missing: string[] = []
    for (const [path, node] of nodes) {
      for (const [c, value] of Object.entries(node)) {
        if (typeof value !== 'string') continue
        if ((EXACT_CATEGORIES as readonly string[]).includes(c)) continue
        if (!value.includes('{count}')) missing.push(`${path}.${c}`)
      }
    }
    expect(missing).toEqual([])
  })

  it('never invent a token their `other` form lacks', () => {
    const stray: string[] = []
    for (const [path, node] of nodes) {
      if (!isPluralNode(node)) continue
      const allowed = new Set(tokensOf(node.other))
      for (const [c, value] of Object.entries(node)) {
        if (c === 'other' || typeof value !== 'string') continue
        for (const tok of tokensOf(value)) {
          if (!allowed.has(tok)) stray.push(`${path}.${c}: {${tok}}`)
        }
      }
    }
    expect(stray).toEqual([])
  })

  it('keep every non-count token of `other` in every form', () => {
    // A `{column}` that survives in `other` and vanishes from `one` renames the
    // control for exactly one card count. Only `{count}` may be dropped, and
    // only where the category pins its value.
    const dropped: string[] = []
    for (const [path, node] of nodes) {
      if (!isPluralNode(node)) continue
      const required = tokensOf(node.other).filter((tok) => tok !== 'count')
      for (const [c, value] of Object.entries(node)) {
        if (c === 'other' || typeof value !== 'string') continue
        for (const tok of required) {
          if (!value.includes(`{${tok}}`)) dropped.push(`${path}.${c}: missing {${tok}}`)
        }
      }
    }
    expect(dropped).toEqual([])
  })
})
