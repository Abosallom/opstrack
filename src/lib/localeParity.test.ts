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
  app.name app.tagline nav.more nav.primary
  nav.openMenu nav.closeMenu nav.skipToContent route.signin
  route.entry route.meetings
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
 * WHY TEN MORE NAMES JOINED IN THE MAP COLLAPSE. `/capture`, `/followups`,
 * `/board`, `/tracks`, `/tracks/:id`, `/dashboard` and `/notifications` are no
 * longer routes — they are five lens chips and a panel on `/mindtree`
 * (docs/MAP-CONTRACT.md §1) — so the tab labels and the header titles that
 * named them are asked for by nothing. They are RETIRED, not vanished: an entry
 * here is asserted absent from BOTH bundles, so a half-removal still fails, and
 * the 213 below is still arithmetic. `nav.map` is their replacement and it is
 * NOT baseline — it was added by the collapse, so it is covered by the ordinary
 * parity checks rather than by this fixture.
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
  nav.capture nav.followups nav.board nav.tracks
  route.capture route.followups route.board route.tracks route.trackDetail
  route.dashboard
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

  it('keep every non-`count` token of `other` in every form', () => {
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

/* ──────────────────── numbers and the nouns they count ──────────────────── */
//
// THE HOLE THE PLURAL NODES LEFT OPEN, and the one no assertion above can see.
//
// selectPlural() reads `vars.count` and nothing else (lib/plural.ts:150-159, via
// resolve() at lib/i18n.ts:99). A counted string whose number happens to be
// called `{days}` or `{weeks}` or `{seconds}` is therefore STRUCTURALLY unable
// to inflect — it is a plain string, interpolate() drops the number in, and one
// frozen grammatical form ships for every value the caller can pass. In English
// that costs an `s` ("Service deadline: 1 days"). In Arabic, where the noun
// after a numeral changes shape four times between 1 and 100, it produced
// `مهلة 2 يوم` on the follow-ups screen and `على مدى 12 أسابيع` under the
// dashboard's chart — while `dashboard.weeksOption` two dozen lines above it
// rendered the SAME NUMBER correctly, because that one happened to be called
// `{count}`.
//
// Every check above is blind to it by construction: parity compares token SETS,
// so `{days}` in en and `{days}` in ar agree; the plural block only looks at
// nodes that are already plural nodes; localeReach compares keys to call sites;
// bidi compares direction. The variable's NAME is nobody else's job.
//
// So this is the check: a counted noun may not follow an interpolation unless
// that interpolation is `{count}` inside a plural node — the one arrangement
// that can actually inflect. It is deliberately a NOUN list rather than a
// variable-name list, because renaming `{days}` to `{n}` would slip past a
// name-based gate while leaving the sentence just as wrong.
//
// IT SHIPPED SCOPED TO `ar`, WHICH WAS THE SHAPE OF THE BUG REPORT AND NOT THE
// SHAPE OF THE RULE — the same mistake bidi.test.ts records making, two files
// over, and the reason its gate now runs over both trees. English costs an `s`
// rather than a case ending, so the damage is smaller and the blindness is
// total: R3-I18N-1 found FOUR live English strings with a hardcoded plural noun
// after a non-`count` token, and the flagship was `followups.total`, rendering
// "1 items need attention" on the screen this app opens on, inside an
// aria-live="polite" region that re-announces it on every filter keystroke.
//
// Every one of the four passed the token-set comparison above for the same
// reason: the Arabic twin had been written as an INVARIANT (`بنود تحتاج
// انتباهك: {count}`, noun before the number, no inflection needed), which is
// correct Arabic AND a perfect token match for a broken English string. The
// half of the tree that was checked is the half that was already right.
//
// One list per language, same rule, same regex, same exemption map.
const COUNTED_NOUNS: Readonly<Record<Locale, readonly string[]>> = {
  ar: [
    // time
    'يوم', 'يومًا', 'يوما', 'أيام', 'يومان', 'يومين',
    'أسبوع', 'أسبوعًا', 'أسبوعا', 'أسابيع', 'أسبوعان', 'أسبوعين',
    'شهر', 'شهرًا', 'شهرا', 'أشهر', 'شهور', 'شهران', 'شهرين',
    'ساعة', 'ساعات', 'دقيقة', 'دقائق', 'ثانية', 'ثوانٍ', 'ثوان', 'ثواني',
    // the things this app counts
    'بند', 'بندًا', 'بندا', 'بنود', 'بندان', 'بندين',
    'اجتماع', 'اجتماعًا', 'اجتماعا', 'اجتماعات',
    'قالب', 'قالبًا', 'قالبا', 'قوالب',
    'مسار', 'مسارًا', 'مسارا', 'مسارات',
    'حرف', 'حرفًا', 'حرفا', 'أحرف', 'حروف',
    'رمز', 'رمزًا', 'رمزا', 'رموز',
    // `ai.usageCalls` shipped as the plain string «اقتراحًا» beside a count in a
    // separate span — the accusative tamyīz, correct only for 11–99, rendered as
    // «1 اقتراحًا» and «2 اقتراحًا» on the AI settings screen. Doubly invisible
    // to the gate below: the number was not an interpolation at all, and the
    // noun was not on this list.
    'اقتراح', 'اقتراحًا', 'اقتراحا', 'اقتراحات', 'اقتراحان', 'اقتراحين',
  ],
  // Both numbers of each noun. The SINGULAR earns its place as much as the
  // plural: `"{n} entry"` is wrong for every value but one in exactly the way
  // `"{n} entries"` is wrong for exactly one, and a gate that only knew the
  // plural would wave the first through. The trailing-boundary lookahead below
  // is what stops `day` matching inside `daily` and `item` inside `items`
  // (which backtracks to the longer alternative instead).
  en: [
    // time
    'day', 'days', 'week', 'weeks', 'month', 'months', 'year', 'years',
    'hour', 'hours', 'minute', 'minutes', 'second', 'seconds',
    // the things this app counts
    'item', 'items', 'entry', 'entries', 'meeting', 'meetings',
    'template', 'templates', 'track', 'tracks', 'update', 'updates',
    'member', 'members', 'tag', 'tags', 'change', 'changes',
    'row', 'rows', 'result', 'results', 'character', 'characters',
    'letter', 'letters',
    // The English half of the same defect: "1 suggestions", on the most common
    // day of use.
    'suggestion', 'suggestions',
  ],
}

/**
 * `namespace.key` allowed to put a counted noun after a non-`count` token,
 * because the number is a FROZEN CONSTANT whose value is pinned in source and
 * lands in a CLDR category the written form is already correct for.
 *
 * Every entry names its constant and its category. This is not a snooze button:
 * change the constant and the exemption is a lie, which is why the value is
 * written down beside it rather than left to a reader to go and look up.
 *
 * ONE MAP FOR BOTH TREES, and it needs no English annotations because every
 * pinned value here is 8 or larger, which is English `other` — the plural form
 * these strings are already written in ("8 characters", "365 days"). The
 * Arabic category is the one that varies, so it is the one recorded.
 */
const FROZEN_COUNT_KEYS: ReadonlyMap<string, string> = new Map([
  // NAME_MAX = 40 (pages/settings/TrackEditor.tsx) → ar `many` → `40 حرفًا`. ✓
  ['admin.tracks.errNameLong', 'NAME_MAX = 40 → many'],
  // LABEL_MAX = 40 (pages/settings/VocabularyAdmin.tsx) → ar `many`. ✓
  ['vocabadmin.errLabelLong', 'LABEL_MAX = 40 → many'],
  // MIN_PASSWORD_LENGTH = 8 (store/auth.ts) → ar `few` → `8 أحرف`. ✓
  ['claim.passwordHint', 'MIN_PASSWORD_LENGTH = 8 → few'],
  ['claim.errPasswordShort', 'MIN_PASSWORD_LENGTH = 8 → few'],
  ['signin.errPasswordShort', 'MIN_PASSWORD_LENGTH = 8 → few'],
  // LINK_EXPIRY_MIN = 10 (pages/SignIn.tsx) → ar `few` → `10 دقائق`. ✓
  ['signin.linkHint', 'LINK_EXPIRY_MIN = 10 → few'],
  // CATCHUP_CAP = 60 (lib/recurrence.ts) → ar `many` → `60 بندًا`. ✓
  ['recurring.behindCapped', 'CATCHUP_CAP = 60 → many'],
  // The noun trails {max}: MAX_INTERVAL_DAYS = MAX_LEAD_DAYS = 365
  // (lib/recurrence.ts) → 365 % 100 = 65 → ar `many` → `365 يومًا`. ✓
  ['recurring.errInterval', 'MAX_INTERVAL_DAYS = 365 → many'],
  ['recurring.errLead', 'MAX_LEAD_DAYS = 365 → many'],
  // No call site anywhere in src (grep: the key appears only in the two locale
  // files). Whoever wires it owes this list an entry with a real constant, or a
  // plural node — it cannot stay exempt on the strength of being dead.
  ['entry.errTitleLong', 'unreferenced — no caller to pin a value'],
])

const FLAT: Readonly<Record<Locale, Map<string, Leaf>>> = { en: FLAT_EN, ar: FLAT_AR }

describe.each(LOCALES.map(([l]) => l))('%s locale tree — counted nouns', (locale) => {
  const NOUN_ALT = COUNTED_NOUNS[locale]
    .map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('|')
  // Whitespace, and the invisible marks a bidirectional string carries between
  // the token and its noun — English strings fence their interpolations too
  // (bidi.test.ts), so `⁨{track}⁩ items` has a PDI sitting in that gap.
  // `\p{L}` after the noun stops `يوم` matching inside `يومية` and `day` inside
  // `daily`; on `days` the engine backtracks from `day` to the longer form
  // rather than giving up, so both numbers can be listed in either order.
  const COUNTED = new RegExp(
    `\\{(\\w+)\\}[\\s\\u200B-\\u200F\\u061C\\u2066-\\u2069]*(?:${NOUN_ALT})(?!\\p{L})`,
    'giu',
  )

  it('inflect: a counted noun follows only `{count}` in a plural node', () => {
    const wrong: string[] = []
    for (const [key, leaf] of FLAT[locale]) {
      const ns = key.split('.').slice(0, 2).join('.')
      if (FROZEN_COUNT_KEYS.has(ns) || FROZEN_COUNT_KEYS.has(key)) continue
      for (const [category, value] of formsOf(leaf)) {
        for (const m of value.matchAll(COUNTED)) {
          if (m[1] === 'count' && leaf.plural) continue
          const at = leaf.plural ? `${key}.${category}` : key
          wrong.push(`${at}: {${m[1]}} counts a noun :: ${value}`)
        }
      }
    }
    expect(wrong.sort()).toEqual([])
  })

  it('finds the nouns at all, so a broken regex cannot pass by matching nothing', () => {
    // Every assertion above is a `toEqual([])`, which an alternation that
    // compiled to nothing would satisfy forever. These two keys are the ones the
    // gate is FOR — a plural node, correctly inflecting — so they must MATCH the
    // pattern and then be excused by the `{count}`-in-a-node rule, not slip past
    // it unseen.
    const proof = locale === 'ar' ? 'admin.tracks.usageEntries' : 'board.total'
    const leaf = FLAT[locale].get(proof) as Leaf
    expect(leaf.plural).toBe(true)
    // matchAll rather than test(): the pattern is /g/ and test() would leave
    // lastIndex behind on a regex the block above shares.
    expect([...leaf.forms.other.matchAll(COUNTED)]).not.toEqual([])
  })
})

describe('counted nouns — the exemption map', () => {
  it('exempts only keys that still exist, so a rename cannot park a live string', () => {
    // An exemption for a key that has been deleted or renamed is dead weight
    // that will silently cover the NEXT key to take that name. Checked against
    // both trees: the key sets are asserted identical above, so a stale entry
    // shows up in either, and asking both makes that dependency explicit.
    expect([...FROZEN_COUNT_KEYS.keys()].filter((k) => !FLAT_AR.has(k))).toEqual([])
    expect([...FROZEN_COUNT_KEYS.keys()].filter((k) => !FLAT_EN.has(k))).toEqual([])
  })
})

/* ────────────────────── ar: one concept, one word ────────────────────── */
//
// Nothing else in this repo can see a WORD CHOICE. Parity compares key sets and
// interpolation tokens, localeReach compares keys to call sites, bidi compares
// direction — a string that is present, well formed, correctly fenced and simply
// calls a thing by a different name than the screen beside it passes all four.
//
// `dashboard.json` was written by a different hand, and it showed. The Arabic
// dashboard rendered `0 خامدة` on a KPI tile whose own link goes to the
// follow-ups screen, where the matching filter chip is labelled `راكدة` — one
// word clicked, another word landed on — while the chart legend directly below
// the tiles said `راكد` from `health.stale`. Overdue was spelled `متأخّر` in the
// legend and `متأخرة` in the tile four inches away. English does not have this
// divergence to inherit: `followups.stale` and `dashboard.statQuiet` are the
// SAME STRING there, "Going quiet".
//
// So: one concept, one Arabic root, across all 23 namespaces. A banned form is
// banned everywhere; there is no per-key exemption, because the whole value of
// the rule is that it has no exceptions.
const BANNED_AR_WORDS: ReadonlyArray<{ bad: RegExp; use: string; why: string }> = [
  {
    bad: /خامد/,
    use: 'راكد',
    why: 'stale/quiet. `health.stale`, `followups.stale`, `track.statStale` and `vocabadmin.effectStale` all say راكد; خامدة existed only in dashboard.json.',
  },
  {
    // The shadda is a letter here, not decoration: متأخر and متأخّر are two
    // spellings of one word, and the app showed both on one screen. dashboard.json
    // is not diacritic-free by policy — it writes ملخّص, يتولّاها, تُحدَّد.
    bad: /متأخر/,
    use: 'متأخّر',
    why: 'overdue. Spelled with the shadda in date/entry/digest/health/followups/track/recurring; only dashboard.json dropped it.',
  },
  {
    bad: /متعثر/,
    use: 'متعثّر',
    why: 'blocked. Spelled with the shadda in entry/followups/status/track; only dashboard.json dropped it.',
  },
  {
    bad: /اتفاقية/,
    use: 'مهلة الخدمة',
    why: 'SLA. Seven namespaces render "service deadline" as مهلة الخدمة; export.json alone reached for the literal اتفاقية مستوى الخدمة, which named the same thing a different way in the one list — the backup contents — where the reader is matching names against the rest of the app.',
  },
]

describe('ar locale tree — one concept, one word', () => {
  it.each(BANNED_AR_WORDS)('never says $bad where it means $use', ({ bad, use, why }) => {
    const hits: string[] = []
    for (const [key, leaf] of FLAT_AR) {
      for (const [category, value] of formsOf(leaf)) {
        if (bad.test(value)) {
          hits.push(`${leaf.plural ? `${key}.${category}` : key} :: ${value}`)
        }
      }
    }
    expect(hits.sort(), `${why} Use ${use}.`).toEqual([])
  })
})

/* ──────────── ar: تجاوز is "breached", and never "override" ──────────── */
//
// R2-I18N-3. The rule above bans a word outright; this one cannot, because
// تجاوز is CORRECT roughly thirty-five times over — `entry.slaBreached`,
// `board.slaCount`, `followups`, `digest`, `track`, `tree`, `mindtree` and
// `vocabadmin` all use it for a deadline that was blown, and `dashboard.slaOf`
// counts breaches with متجاوزة. What is wrong is the same root standing in for
// the OTHER English word it happens to translate: an "override" — a per-track
// deadline that replaces the workspace default.
//
// Two strings had it, and one of them was the expensive one:
// `dashboard.slaMatrixFailed` sits inside the very `div.db-sla` cell that
// renders `<SlaChart>` (Dashboard.tsx:445-455), so an Arabic reader saw
// «تجاوزات المسارات» a few lines under «{breached} متجاوزة» and read the note as
// "couldn't load the tracks' BREACHES" — i.e. "the breach numbers you are
// looking at are incomplete", which is a sentence the panel could plausibly
// mean and does not. `export.json`'s `track_slas` repeated it in the list of
// what a backup contains.
//
// The app already had the right word in three places — `admin.tracks
// .slaOverrides`, `followups.slaFromTrack` (تخصيص), `vocabadmin.trackOverrides`
// — so this is an inconsistency inside one locale, not a defensible choice.
//
// Driven off the ENGLISH source rather than a hand-listed key set: a new string
// that says "override" is covered on the day it is written, and no exemption
// list can rot. The check is deliberately one-directional — it says nothing
// about which word an override MUST use, only that it may not borrow the one
// that already means something else on the same screen.
const AR_BREACH_ROOT = /تجاوز/
const EN_OVERRIDE = /\boverrid(e|es|den|ing)\b/i

describe('ar locale tree — تجاوز is "breached", never "override"', () => {
  it('renders no English "override" with the breach root', () => {
    const hits: string[] = []
    for (const [key, enLeaf] of FLAT_EN) {
      const arLeaf = FLAT_AR.get(key)
      if (arLeaf === undefined) continue
      // Any form saying "override" puts the whole leaf under the rule: English
      // writes the word in `other` and drops it from `one` often enough that
      // matching form-for-form would let the plural halves through.
      if (!formsOf(enLeaf).some(([, v]) => EN_OVERRIDE.test(v))) continue
      for (const [category, value] of formsOf(arLeaf)) {
        if (AR_BREACH_ROOT.test(value)) {
          hits.push(`${arLeaf.plural ? `${key}.${category}` : key} :: ${value}`)
        }
      }
    }
    expect(
      hits.sort(),
      'تجاوز means "breached" everywhere else in the tree, including on the same dashboard panel. An override is تخصيص.',
    ).toEqual([])
  })

  it('still uses تجاوز for the deadline breaches themselves', () => {
    // The negative rule above is only safe while the positive one holds: a
    // careless sweep that replaced every تجاوز with تخصيص would pass it and
    // leave the app with no word for a breach at all.
    const breaches = [...FLAT_AR].filter(([, leaf]) =>
      formsOf(leaf).some(([, v]) => AR_BREACH_ROOT.test(v)),
    )
    // Leaves, not forms — a plural node with six Arabic forms is one leaf. 17
    // today across entry/board/followups/digest/track/tree/mindtree/vocabadmin.
    expect(breaches.length).toBeGreaterThan(12)
    expect(AR_BREACH_ROOT.test(FLAT_AR.get('dashboard.slaOf')?.forms.other ?? '')).toBe(true)
  })
})

/* ─────────── ar: المسؤول is the entry's owner, never the admin ─────────── */
//
// R3-I18N-4, and the same shape as the rule above: a word that is right almost
// everywhere, standing in for the OTHER English word it happens to translate.
//
// مسؤول is this app's word for the person an item belongs to. It labels the
// Owner field, the owner filter, the owner column, the "unassigned" copy and the
// grouping control across fourteen namespaces. مشرف is the word for the ADMIN
// role, in ten more — `settings.roleAdmin` is مشرف, `members.promote` is «منح
// صلاحية مشرف», `admin.errForbidden` is «المشرف وحده يستطيع ذلك».
//
// One string crossed them. `recurring.deleteAdminOnly` — the note shown to
// NON-ADMINS on the recurring-items screen, explaining why Delete is missing —
// said «الحذف للمسؤول وحده»: *deletion is for the owner alone*. The template
// editor renders inline on that same page and its Owner field is labelled
// المسؤول a few rows up, so one word named two different roles inside one
// viewport, and the sentence a reader assembles from it — "ask the assignee" —
// is both wrong and actionable. Of the thirty English strings in the tree that
// say "admin", it was the only one not built on ش-ر-ف.
//
// Driven off the ENGLISH source, like the override rule above and for the same
// reason: a new string that says "admin" is covered the day it is written, and
// there is no key list to rot. One-directional — it does not say which word an
// admin MUST use, only that it may not borrow the one already spoken for.
const AR_OWNER_WORD = /مسؤول/
const EN_ADMIN_ROLE = /\badmin(s|'s)?\b/i

describe('ar locale tree — المسؤول is the owner, never the admin', () => {
  it('renders no English "admin" with the owner word', () => {
    const hits: string[] = []
    for (const [key, enLeaf] of FLAT_EN) {
      const arLeaf = FLAT_AR.get(key)
      if (arLeaf === undefined) continue
      if (!formsOf(enLeaf).some(([, v]) => EN_ADMIN_ROLE.test(v))) continue
      for (const [category, value] of formsOf(arLeaf)) {
        if (AR_OWNER_WORD.test(value)) {
          hits.push(`${arLeaf.plural ? `${key}.${category}` : key} :: ${value}`)
        }
      }
    }
    expect(
      hits.sort(),
      'مسؤول is the entry OWNER everywhere else in the tree, including on the same screen. An admin is مشرف.',
    ).toEqual([])
  })

  it('still uses المسؤول for the owner itself', () => {
    // Same guard the override rule carries: a sweep that replaced every مسؤول
    // with مشرف would pass the rule above and leave the app calling the owner
    // an admin, which is the identical bug pointing the other way.
    const owners = [...FLAT_AR].filter(([, leaf]) =>
      formsOf(leaf).some(([, v]) => AR_OWNER_WORD.test(v)),
    )
    expect(owners.length).toBeGreaterThan(30)
    expect(AR_OWNER_WORD.test(FLAT_AR.get('recurring.fieldOwner')?.forms.other ?? '')).toBe(true)
    expect(AR_OWNER_WORD.test(FLAT_AR.get('entry.owner')?.forms.other ?? '')).toBe(true)
  })

  it('finds "admin" in the English tree at all', () => {
    // The rule is a filter over English strings; if EN_ADMIN_ROLE matched
    // nothing the check above would be vacuous. 30 leaves today.
    const said = [...FLAT_EN].filter(([, leaf]) =>
      formsOf(leaf).some(([, v]) => EN_ADMIN_ROLE.test(v)),
    )
    expect(said.length).toBeGreaterThan(20)
  })
})
