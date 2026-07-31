// The gate on the curated map. Its whole job is to fail the day the app grows.
//
// THE FAILURE IT EXISTS FOR. Settings › Terminology renders `listLabels()`.
// A key with no placement is not rendered — so a namespace nobody curated is a
// screenful of strings that cannot be renamed, with no error anywhere and
// nothing on screen to suggest anything is missing. That is invisible in
// review, invisible to a typecheck, and looks exactly like a screen whose
// strings were simply not worth listing. The orphan assertion below is the only
// thing that says otherwise, and it names the namespace.
//
// The second failure, one refactor later: a rule whose prefix no longer matches
// anything. `entry.snooze` renamed to `entry.postpone` leaves `'snooze'` behind
// as dead weight that will silently claim the next key to start with it. Dead
// prefixes are asserted away for the same reason localeParity.test.ts asserts
// its FROZEN_COUNT_KEYS still exist.
//
// Pure, like the module: no DOM, no store, no mocks. Vitest imports are
// explicit — the repo runs with `globals` off.

import { describe, expect, it } from 'vitest'
import { ar, en, type LocaleTree } from '../locales'
import { isPluralNode, type PluralNode } from './plural'
import {
  LABEL_SECTIONS,
  NAMESPACE_PLACEMENT,
  labelMatches,
  listLabels,
  placementFor,
  searchable,
  type LabelSectionId,
} from './labelSections'

/** dot path → leaf, where a PLURAL NODE is a leaf and not a namespace. */
function flatten(tree: LocaleTree, prefix = '', out = new Map<string, string | PluralNode>()) {
  for (const [k, v] of Object.entries(tree)) {
    const key = prefix ? `${prefix}.${k}` : k
    if (typeof v === 'string') out.set(key, v)
    else if (isPluralNode(v)) out.set(key, v)
    else flatten(v, key, out)
  }
  return out
}

const EN = flatten(en)
const AR = flatten(ar)
const SECTION_IDS = new Set<string>(LABEL_SECTIONS.map((s) => s.id))
const NAMESPACES = Object.keys(en).sort()

describe('the curated map', () => {
  it('covers every namespace the app ships, and nothing that has been deleted', () => {
    // Both directions. A namespace with no entry is a screen nobody can rename;
    // an entry with no namespace is a rule that will claim a future key by
    // accident. Reported as two diffs so the failure names the namespace
    // instead of dumping both lists.
    const curated = Object.keys(NAMESPACE_PLACEMENT).sort()
    expect(NAMESPACES.filter((ns) => !curated.includes(ns))).toEqual([])
    expect(curated.filter((ns) => !NAMESPACES.includes(ns))).toEqual([])
  })

  it('places every key in BOTH bundles — no orphans', () => {
    // Arabic as well as English: the two trees hold identical key sets
    // (localeParity.test.ts asserts it), so a divergence here would mean one of
    // them has grown a key the other has not and the screen would show a row
    // that cannot be edited in one language.
    const orphans = [...EN.keys(), ...AR.keys()].filter((k) => placementFor(k) === undefined)
    expect([...new Set(orphans)].sort()).toEqual([])
  })

  it('names only sections that exist', () => {
    const unknown: string[] = []
    for (const [ns, home] of Object.entries(NAMESPACE_PLACEMENT)) {
      if (!SECTION_IDS.has(home.section)) unknown.push(`${ns} → ${home.section}`)
      for (const rule of home.rules ?? []) {
        if (!SECTION_IDS.has(rule.section)) {
          unknown.push(`${ns} [${rule.prefixes.join(', ')}] → ${rule.section}`)
        }
      }
    }
    expect(unknown).toEqual([])
  })

  it('leaves no rule prefix matching nothing', () => {
    // A prefix left behind by a rename is not inert: it is a trap primed for
    // the next key that starts with those letters.
    const keys = [...EN.keys()]
    const dead: string[] = []
    for (const [ns, home] of Object.entries(NAMESPACE_PLACEMENT)) {
      for (const rule of home.rules ?? []) {
        for (const prefix of rule.prefixes) {
          const hit = keys.some(
            (k) => k.startsWith(`${ns}.`) && k.slice(ns.length + 1).startsWith(prefix),
          )
          if (!hit) dead.push(`${ns} :: ${prefix}`)
        }
      }
    }
    expect(dead.sort()).toEqual([])
  })

  it('gives every section and every where-note a string in BOTH languages', () => {
    // localeReach.test.ts already scans this module for key-shaped literals, but
    // it fails with a list of dot paths; this one fails saying which SECTION or
    // which SCREEN has no name, which is the sentence a reader needs.
    const missing: string[] = []
    const need = (key: string, what: string): void => {
      if (!EN.has(key)) missing.push(`en: ${what} (${key})`)
      if (!AR.has(key)) missing.push(`ar: ${what} (${key})`)
    }
    for (const section of LABEL_SECTIONS) {
      need(section.labelKey, `name of section ${section.id}`)
      need(section.hintKey, `hint of section ${section.id}`)
    }
    for (const [ns, home] of Object.entries(NAMESPACE_PLACEMENT)) {
      need(home.where, `where-note for ${ns}`)
      for (const rule of home.rules ?? []) {
        if (rule.where !== undefined) need(rule.where, `where-note for ${ns} [${rule.prefixes[0]}]`)
      }
    }
    expect(missing.sort()).toEqual([])
  })

  it('fills every section — an empty group is a heading with nothing under it', () => {
    const used = new Set(listLabels().map((row) => row.section))
    expect(LABEL_SECTIONS.filter((s) => !used.has(s.id)).map((s) => s.id)).toEqual([])
  })

  it('does not collapse into one bucket', () => {
    // The curation earns its keep only while it SPLITS the key space. A map that
    // had rotted into "almost everything is a message" would still pass every
    // assertion above and be useless on screen, so the shape is asserted too:
    // no single section may hold half the app.
    const rows = listLabels()
    const counts = new Map<LabelSectionId, number>()
    for (const row of rows) counts.set(row.section, (counts.get(row.section) ?? 0) + 1)
    const biggest = Math.max(...counts.values())
    expect(biggest / rows.length).toBeLessThan(0.5)
  })
})

describe('placementFor', () => {
  it('lets the longest prefix win, so one rule can refine another', () => {
    // The button and the toast it raises differ by one suffix and belong in two
    // different sections. First-match ordering would make that a matter of where
    // the rule sits in the array; longest-prefix makes it a matter of what it
    // says.
    expect(placementFor('admin.tracks.archive')?.section).toBe('actions')
    expect(placementFor('admin.tracks.archivedToast')?.section).toBe('messages')
    expect(placementFor('entry.close')?.section).toBe('actions')
    expect(placementFor('entry.closedOn')?.section).toBe('entryFields')
  })

  it('sends a key to its namespace when no rule claims it', () => {
    expect(placementFor('entry.title')).toEqual({
      section: 'entryFields',
      whereKey: 'terminology.where.entry',
      rank: expect.any(Number),
    })
  })

  it('lets a rule move the where-note without moving the section', () => {
    // Both are fields; only one is read in the update thread.
    const title = placementFor('entry.title')
    const updates = placementFor('entry.updates')
    expect(updates?.section).toBe(title?.section)
    expect(updates?.whereKey).toBe('terminology.where.entryThread')
  })

  it('answers undefined for anything outside the curated map', () => {
    expect(placementFor('nosuchnamespace.title')).toBeUndefined()
    // No namespace at all, and a leading dot that would otherwise split into an
    // empty one.
    expect(placementFor('title')).toBeUndefined()
    expect(placementFor('.title')).toBeUndefined()
    expect(placementFor('')).toBeUndefined()
  })
})

describe('listLabels', () => {
  it('lists exactly the shipped English key set', () => {
    const listed = listLabels().map((row) => row.key).sort()
    expect(listed).toEqual([...EN.keys()].sort())
  })

  it('is grouped by section, in the declared order', () => {
    const order = LABEL_SECTIONS.map((s) => s.id)
    let previous = -1
    for (const row of listLabels()) {
      const at = order.indexOf(row.section)
      expect(at).toBeGreaterThanOrEqual(previous)
      previous = at
    }
  })

  it('opens with the words on an item, which is what the owner came to rename', () => {
    // The spec's ordering is a product decision, not a detail: entry fields
    // first, then navigation, then the screen titles. Asserted on the first row
    // so a reshuffle of NAMESPACE_PLACEMENT that buries them fails here.
    const first = listLabels()[0]
    expect(first.section).toBe('entryFields')
    expect(first.key.startsWith('entry.')).toBe(true)
  })

  it('carries the shipped strings, and keeps a plural node whole', () => {
    const title = listLabels().find((row) => row.key === 'entry.title')
    expect(title?.en).toBe('Title')
    expect(typeof title?.ar).toBe('string')

    // A counted string is not editable as one sentence — the screen offers a
    // field per form, so the descriptor has to hand over the node itself.
    const counted = listLabels().find((row) => row.key === 'entry.updateCount')
    expect(isPluralNode(counted?.en)).toBe(true)
    expect(isPluralNode(counted?.ar)).toBe(true)
  })

  it('agrees with placementFor on every row', () => {
    const wrong = listLabels().filter((row) => {
      const placement = placementFor(row.key)
      return placement?.section !== row.section || placement.whereKey !== row.whereKey
    })
    expect(wrong.map((row) => row.key)).toEqual([])
  })

  it('is computed once and returns a stable array', () => {
    // 1,600 keys walked and sorted on every keystroke of the search box is the
    // one performance mistake this screen can make, and an unstable identity
    // would defeat every memo the page hangs off it.
    expect(listLabels()).toBe(listLabels())
  })

  it('includes this screen’s own strings — they are not special-cased', () => {
    // The spec is explicit: the Terminology screen's own labels are overridable
    // like everything else. Renaming "Reset" here renames the button that
    // undoes it, which is exactly why the global reset exists.
    const keys = new Set(listLabels().map((row) => row.key))
    expect(keys.has('terminology.title')).toBe(true)
    expect(keys.has('terminology.reset')).toBe(true)
    expect(keys.has('terminology.section.entryFields')).toBe(true)
  })
})

describe('search', () => {
  const SHIPPED = searchable('nav.followups Follow-ups المتابعات')
  const SECTION = searchable('Navigation')

  it('matches the key, the shipped English and the shipped Arabic', () => {
    expect(labelMatches(searchable('follow'), SHIPPED, SECTION, [])).toBe(true)
    // The key itself, by a fragment of it. (Written without the dot on
    // purpose: localeReach.test.ts scans every quoted key-shaped string in the
    // repo and would read `nav.follow` as a key it must resolve.)
    expect(labelMatches(searchable('followups'), SHIPPED, SECTION, [])).toBe(true)
    expect(labelMatches(searchable('المتابعات'), SHIPPED, SECTION, [])).toBe(true)
  })

  it('matches the section name, so a group can be found by what it is called', () => {
    expect(labelMatches(searchable('navigation'), SHIPPED, SECTION, [])).toBe(true)
  })

  // THE REGRESSION THIS FILE EXISTS TO HOLD. Search is the primary way into
  // 1,670 keys, and it used to match the SHIPPED wording only — so the screen
  // worked the first time and stopped working the second. Rename "Follow-ups" to
  // "My Desk", come back next week, type the only name the app still shows you
  // anywhere, and the answer was "Nothing matches My Desk".
  it('matches the wording the OWNER set, not only the wording the app shipped', () => {
    const owner = [searchable('My Desk'), searchable('مكتبي')]
    expect(labelMatches(searchable('my desk'), SHIPPED, SECTION, owner)).toBe(true)
    expect(labelMatches(searchable('مكتبي'), SHIPPED, SECTION, owner)).toBe(true)
    // And the built-in wording still finds it, because that is what somebody
    // reading the file, the docs or an old screenshot will type.
    expect(labelMatches(searchable('follow-ups'), SHIPPED, SECTION, owner)).toBe(true)
  })

  it('finds a phrase across the invisible controls a shipped string carries', () => {
    // `Created by ⁨{name}⁩` has two format characters inside it. The owner types
    // what he can see.
    const hay = searchable('entry.createdBy Created by ⁨{name}⁩ أنشأه')
    expect(labelMatches(searchable('created by {name}'), hay, SECTION, [])).toBe(true)
  })

  it('matches everything when the box is empty — no filter is not no results', () => {
    expect(labelMatches('', SHIPPED, SECTION, [])).toBe(true)
  })

  it('does not match a word that is in neither', () => {
    expect(labelMatches(searchable('invoice'), SHIPPED, SECTION, [searchable('My Desk')])).toBe(
      false,
    )
  })
})

// NO TWO ROWS MAY BE INDISTINGUISHABLE, and this is the gate that keeps it so.
//
// Eleven groups of two used to fail it. `entry.description` and `entry.details`
// are both "Details" / "التفاصيل", both in Entry fields, and both carried the
// same where-note — two adjacent headings in one sheet, offered to the owner as
// a choice he had no way to make. "Open", "Closed", "Track" (twice), "Someone
// else", "Every day", "Discard" and a pair of recurring errors that are
// word-for-word identical were the rest.
//
// The where-note is the ONE mechanism this file has for telling two same-named
// labels apart (see the header: WHERE — which screen is it read on?), so a
// collision here is not a cosmetic problem, it is this module failing at its
// stated job. Adding a key that collides with an existing one is legal — it just
// has to come with the sentence that says which is which.
describe('every row can be told apart from every other row', () => {
  /** What the owner can actually see: the two languages, the group, the note. */
  function fingerprint(row: {
    section: string
    whereKey: string
    en: string | PluralNode
    ar: string | PluralNode
  }): string {
    const text = (node: string | PluralNode): string =>
      typeof node === 'string' ? node : Object.values(node).join('|')
    return [row.section, row.whereKey, text(row.en).toLowerCase(), text(row.ar)].join(' ⟂ ')
  }

  it('no two keys share a section, a where-note and both languages', () => {
    const seen = new Map<string, string[]>()
    for (const row of listLabels()) {
      const print = fingerprint(row)
      const keys = seen.get(print) ?? []
      keys.push(row.key)
      seen.set(print, keys)
    }
    const collisions = [...seen.entries()]
      .filter(([, keys]) => keys.length > 1)
      .map(([print, keys]) => `${keys.join(' / ')} — ${print}`)
    expect(collisions.sort()).toEqual([])
  })
})
