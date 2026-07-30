// The two halves of the keyboard layer a machine can check: the ARBITRATION
// (who owns a key) and the MATCHER (what the palette ranks).
//
// Both are pure by construction, which is the whole reason lib/hotkeys.ts is
// split the way it is. vitest.config.ts is `environment: 'node'` and there is no
// jsdom in the dependency budget, so resolveHotkey() takes a plain record rather
// than a KeyboardEvent and isTypingTarget() takes a three-property object rather
// than an HTMLElement. Everything asserted below runs with no DOM, no React and
// no store.
//
// WHAT IS DELIBERATELY NOT ASSERTED HERE: the DOM helpers
// (stepFocusedEntry/openFocusedEntry/focusSearchField/focusSurfaceStart) and the
// listener itself. They are four `querySelector` calls and a `focus()`; testing
// them would mean testing jsdom's implementation of `offsetParent`, which is
// stubbed to null in it anyway. Their contract is the two selectors named in the
// module header, and the acceptance gate exercises them in a real browser.

import { describe, expect, it } from 'vitest'
import {
  SHORTCUTS,
  STATUS_DIGITS,
  TIER_EXACT,
  TIER_PREFIX,
  TIER_SUBSEQUENCE,
  TIER_SUBSTRING,
  TIER_WORD,
  foldField,
  isTypingTarget,
  matchScore,
  matchText,
  rankQuery,
  resolveHotkey,
  searchNeedles,
  type KeyProbe,
  type RankRow,
  type ShortcutId,
} from './hotkeys'
import { AR_NAMESPACES, EN_NAMESPACES, ar, en, type LocaleTree } from '../locales'

/** A keystroke with nothing going on: no modifiers, no overlay, no entry. */
function press(over: Partial<KeyProbe> = {}): KeyProbe {
  return {
    key: '',
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    shiftKey: false,
    repeat: false,
    defaultPrevented: false,
    typing: false,
    overlayDepth: 0,
    openEntryId: null,
    onListEntry: false,
    hasListEntries: false,
    ...over,
  }
}

/** The minimum shape isTypingTarget() reads. */
function el(tagName: string, over: { editable?: boolean; role?: string } = {}) {
  return {
    tagName,
    isContentEditable: over.editable ?? false,
    getAttribute: (name: string) => (name === 'role' ? (over.role ?? null) : null),
  }
}

/* ─────────────────────── rule 2: never while typing ────────────────────── */

describe('isTypingTarget', () => {
  it.each(['INPUT', 'TEXTAREA', 'SELECT', 'input', 'textarea'])('%s is typing', (tag) => {
    expect(isTypingTarget(el(tag))).toBe(true)
  })

  it.each(['DIV', 'BUTTON', 'ARTICLE', 'A'])('%s is not', (tag) => {
    expect(isTypingTarget(el(tag))).toBe(false)
  })

  it('counts a contenteditable, whatever it is made of', () => {
    expect(isTypingTarget(el('DIV', { editable: true }))).toBe(true)
  })

  it.each(['textbox', 'searchbox', 'combobox', 'spinbutton'])('counts role=%s', (role) => {
    // pages/Board.tsx's own version omits the ARIA roles, which is why this
    // module has its own — a composer built out of a div with role="textbox"
    // would otherwise have every bare shortcut fire mid-sentence.
    expect(isTypingTarget(el('DIV', { role }))).toBe(true)
  })

  it('does not count a role that is not a text box', () => {
    expect(isTypingTarget(el('DIV', { role: 'listbox' }))).toBe(false)
  })

  it('is false for no target at all', () => {
    expect(isTypingTarget(null)).toBe(false)
  })
})

describe('suppression inside a field', () => {
  // THE ASSERTION THE WHOLE LAYER RESTS ON. Every one of these letters is a
  // letter somebody types twenty times a minute in the capture box.
  it.each(['c', 'j', 'k', 'e', 'u', '1', '2', '3', '4', '/', '?'])(
    '%s does nothing while typing',
    (key) => {
      expect(resolveHotkey(press({ key, typing: true, openEntryId: 'e1' }))).toBeNull()
    },
  )

  it('lets Cmd+K through — a chord cannot be mistaken for text', () => {
    expect(resolveHotkey(press({ key: 'k', metaKey: true, typing: true }))?.id).toBe('palette')
    expect(resolveHotkey(press({ key: 'k', ctrlKey: true, typing: true }))?.id).toBe('palette')
  })

  it('fires the same bare letters once the field is not the target', () => {
    // The mirror of the block above: suppression must be about the TARGET, not
    // about the key. A test that only proved "nothing fires" would pass on a
    // layer that was broken outright.
    expect(resolveHotkey(press({ key: 'c' }))?.id).toBe('capture')
    expect(resolveHotkey(press({ key: 'j', openEntryId: 'e1' }))?.id).toBe('next')
  })
})

/* ──────────────── rule 1 + 3 + 4: not fighting the board ───────────────── */

describe('deferring to the surface underneath', () => {
  it('stands down when something already handled the key', () => {
    // pages/Board.tsx preventDefaults every arrow and digit it acts on, and this
    // listener runs on the bubble phase — so this single check is the whole of
    // "never double-fire on a board move".
    expect(resolveHotkey(press({ key: '1', defaultPrevented: true, openEntryId: 'e1' }))).toBeNull()
    expect(resolveHotkey(press({ key: 'c', defaultPrevented: true }))).toBeNull()
  })

  it('binds no arrow keys at all', () => {
    for (const key of ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown']) {
      expect(resolveHotkey(press({ key, openEntryId: 'e1', onListEntry: true }))).toBeNull()
    }
  })

  it('leaves the digits to the board when no entry is open', () => {
    // A focused card's digits are Board's column shortcuts. The global layer
    // only claims them once the DETAIL surface is showing one entry.
    expect(resolveHotkey(press({ key: '1', onListEntry: true }))).toBeNull()
    expect(resolveHotkey(press({ key: '1', openEntryId: 'e1' }))?.id).toBe('status')
  })

  it('ignores auto-repeat', () => {
    expect(resolveHotkey(press({ key: '4', repeat: true, openEntryId: 'e1' }))).toBeNull()
  })

  it('ignores anything with Alt held', () => {
    expect(resolveHotkey(press({ key: 'c', altKey: true }))).toBeNull()
  })

  it('ignores Shift+Cmd+K, which is a different chord', () => {
    expect(resolveHotkey(press({ key: 'k', metaKey: true, shiftKey: true }))).toBeNull()
  })

  it('accepts an upper-case letter, so Caps Lock does not disable the layer', () => {
    expect(resolveHotkey(press({ key: 'C' }))?.id).toBe('capture')
    expect(resolveHotkey(press({ key: 'E', openEntryId: 'e1' }))?.id).toBe('edit')
  })
})

describe('overlay depth', () => {
  it('keeps the chrome keys off a screen behind a modal', () => {
    expect(resolveHotkey(press({ key: 'c', overlayDepth: 1 }))).toBeNull()
    expect(resolveHotkey(press({ key: '/', overlayDepth: 1 }))).toBeNull()
  })

  it('lets the palette and the cheatsheet stack — Escape unwinds them', () => {
    expect(resolveHotkey(press({ key: 'k', metaKey: true, overlayDepth: 2 }))?.id).toBe('palette')
    expect(resolveHotkey(press({ key: '?', overlayDepth: 2 }))?.id).toBe('help')
  })

  it('allows the entry keys at depth 1 — that one overlay IS the entry sheet', () => {
    expect(resolveHotkey(press({ key: 'u', overlayDepth: 1, openEntryId: 'e1' }))?.id).toBe(
      'addUpdate',
    )
  })

  it('withholds them at depth 2, where a confirm or a picker owns the keyboard', () => {
    expect(resolveHotkey(press({ key: 'u', overlayDepth: 2, openEntryId: 'e1' }))).toBeNull()
    expect(resolveHotkey(press({ key: '3', overlayDepth: 2, openEntryId: 'e1' }))).toBeNull()
  })

  it('allows them at depth 0 on the /entry/:id page, which is not an overlay', () => {
    expect(resolveHotkey(press({ key: 'e', overlayDepth: 0, openEntryId: 'e1' }))?.id).toBe('edit')
  })
})

describe('entry keys need an entry', () => {
  it.each(['j', 'k', 'e', 'u'])('%s does nothing on a screen with no entries', (key) => {
    expect(resolveHotkey(press({ key }))).toBeNull()
  })

  it.each(['j', 'k', 'e', 'u'])('%s works on a highlighted list row', (key) => {
    expect(resolveHotkey(press({ key, onListEntry: true }))).not.toBeNull()
  })

  it('J and K start the walk from nowhere — a list is enough', () => {
    // Otherwise the only way to BEGIN stepping a list is a Tab or a mouse
    // click, which is the opposite of the point. stepFocusedEntry() has always
    // handled `from < 0`; this is what lets it be reached.
    expect(resolveHotkey(press({ key: 'j', hasListEntries: true }))?.id).toBe('next')
    expect(resolveHotkey(press({ key: 'k', hasListEntries: true }))?.id).toBe('prev')
  })

  it.each(['e', 'u'])('%s does NOT pick a row for you', (key) => {
    // With nothing highlighted there is no subject, and silently choosing the
    // first row is an edit aimed at whatever happens to sort first.
    expect(resolveHotkey(press({ key, hasListEntries: true }))).toBeNull()
  })
})

describe('the digits', () => {
  it('name the four statuses in order', () => {
    for (const [i, status] of STATUS_DIGITS.entries()) {
      const hit = resolveHotkey(press({ key: String(i + 1), openEntryId: 'e1' }))
      expect(hit?.id).toBe('status')
      expect(hit?.status).toBe(status)
    }
  })

  it('stops at 4 — there is no fifth status shortcut', () => {
    for (const key of ['5', '6', '7', '8', '9', '0']) {
      expect(resolveHotkey(press({ key, openEntryId: 'e1' }))).toBeNull()
    }
  })
})

/* ─────────────── the cheatsheet covers exactly what is bound ───────────── */

/**
 * One press per documented shortcut. `escape` is null because lib/overlayStack
 * owns it for every overlay in the app at once — SHORTCUTS lists it so the help
 * sheet can show the way out, and resolveHotkey() must never claim it.
 */
const PRESSES: Record<ShortcutId, Partial<KeyProbe> | null> = {
  capture: { key: 'c' },
  palette: { key: 'k', metaKey: true },
  search: { key: '/' },
  help: { key: '?' },
  escape: null,
  next: { key: 'j', openEntryId: 'e1' },
  prev: { key: 'k', openEntryId: 'e1' },
  edit: { key: 'e', openEntryId: 'e1' },
  addUpdate: { key: 'u', openEntryId: 'e1' },
  status: { key: '2', openEntryId: 'e1' },
}

describe('SHORTCUTS', () => {
  // Acceptance gate (d): "every spec shortcut works, is listed in the
  // cheatsheet". Both directions, so neither a binding with no help row nor a
  // help row with no binding can ship.
  it('lists exactly the intents the layer resolves', () => {
    expect(SHORTCUTS.map((s) => s.id).sort()).toEqual(Object.keys(PRESSES).sort())
  })

  it('has no duplicate rows', () => {
    expect(new Set(SHORTCUTS.map((s) => s.id)).size).toBe(SHORTCUTS.length)
  })

  it.each(SHORTCUTS.filter((s) => PRESSES[s.id] !== null))('$id is reachable', (doc) => {
    expect(resolveHotkey(press(PRESSES[doc.id] ?? {}))?.id).toBe(doc.id)
  })

  it('covers every key the spec names: C / mod+K / J / K / E / U / 1-4 / Esc / ?', () => {
    const printed = new Set(SHORTCUTS.flatMap((s) => s.keys))
    expect([...printed].sort()).toEqual(
      ['/', '1', '2', '3', '4', '?', 'C', 'E', 'Esc', 'J', 'K', 'U', 'mod'].sort(),
    )
  })
})

/* ────────────────────────────── the matcher ────────────────────────────── */

describe('matchText', () => {
  it('ranks an exact hit best', () => {
    expect(matchText('network', 'network')).toEqual({ tier: TIER_EXACT, at: 0 })
  })

  it('ranks a prefix above a word start', () => {
    expect(matchText('net', 'network ops')?.tier).toBe(TIER_PREFIX)
    expect(matchText('ops', 'network ops')).toEqual({ tier: TIER_WORD, at: 8 })
  })

  it('ranks a mid-word substring below a word start', () => {
    expect(matchText('etwork', 'network ops')).toEqual({ tier: TIER_SUBSTRING, at: 1 })
    expect(TIER_SUBSTRING).toBeGreaterThan(TIER_WORD)
  })

  it('falls through to a subsequence', () => {
    expect(matchText('nops', 'network ops')?.tier).toBe(TIER_SUBSEQUENCE)
  })

  it('returns null when the letters are not there in order', () => {
    expect(matchText('spon', 'network ops')).toBeNull()
    expect(matchText('zzz', 'network ops')).toBeNull()
  })

  it('matches everything on an empty needle, so an untouched palette shows its rows', () => {
    expect(matchText('', 'anything')).toEqual({ tier: TIER_EXACT, at: 0 })
  })

  it('matches nothing against an empty haystack', () => {
    expect(matchText('a', '')).toBeNull()
  })
})

describe('matchScore', () => {
  it('weights the first field above every tier of the second', () => {
    // A title match at the WORST tier and the worst position must still beat a
    // keyword match at the best. That is what the 10000/1000 step buys, and it
    // is why an entry's title is field 0 and its tags are field 1.
    const label = matchScore(['nops'], ['network ops', 'x'])
    const keyword = matchScore(['x'], ['network ops', 'x'])
    expect(label).not.toBeNull()
    expect(keyword).not.toBeNull()
    expect(label as number).toBeLessThan(keyword as number)
  })

  it('takes the best of several needles', () => {
    expect(matchScore(['zzz', 'net'], ['network ops'])).toBe(TIER_PREFIX * 1000)
  })

  it('is null only when no needle matches any field', () => {
    expect(matchScore(['zzz'], ['network ops', 'infra'])).toBeNull()
  })

  it('never lets a position out-rank a tier', () => {
    // Position is clamped to 999, one below the tier step, so a match 5000
            // characters into a string cannot borrow a better tier's score.
    const late = matchScore(['x'], ['x'.padStart(5000, 'a')])
    expect(late).toBe(TIER_SUBSTRING * 1000 + 999)
  })
})

describe('searchNeedles', () => {
  it('tries the prose fold and the identifier fold', () => {
    // `#it-ops` and `#itops` are one intent, and normalizeSearch keeps the
    // hyphen while foldKey drops it.
    expect(searchNeedles('#IT-Ops')).toEqual(['#it-ops', '#itops'])
  })

  it('collapses to one needle when the two folds agree', () => {
    expect(searchNeedles('Network')).toEqual(['network'])
  })

  it('is empty for a blank query', () => {
    expect(searchNeedles('')).toEqual([])
    expect(searchNeedles('   ')).toEqual([])
  })

  it('folds Arabic-Indic digits like the parser does', () => {
    expect(searchNeedles('٣٢')).toEqual(['32'])
  })
})

describe('Arabic', () => {
  it('finds a track seeded under its plural when the singular is typed', () => {
    // The verified bug EXECUTION-PLAN §680 records: 0001 seeds Network as
    // الشبكات and people type الشبكة. Under the ة→ه fold those share NO match
    // tier — the singular's final haa is absent from the plural, so even
    // subsequence fails. The per-word stem is what closes it.
    const field = foldField('الشبكات')
    const score = matchScore(searchNeedles('الشبكة'), [field])
    expect(score).toBe(TIER_EXACT)
  })

  it('matches in the other direction too', () => {
    expect(matchScore(searchNeedles('الشبكات'), [foldField('الشبكة')])).toBe(TIER_EXACT)
  })

  it('ignores harakat, which are optional in ordinary writing', () => {
    expect(matchScore(searchNeedles('تجديد'), [foldField('تَجْديد الشهادة')])).toBe(TIER_PREFIX * 1000)
  })

  it('leaves Latin text untouched by the stem', () => {
    // Every suffix stemArabic strips is Arabic, so this fold must be byte-identical
    // to normalizeSearch for an English title — the reason foldField can stem
    // unconditionally instead of sniffing at a script.
    expect(foldField('Certificate Renewals')).toBe('certificate renewals')
    expect(foldField('IT  Operations')).toBe('it operations')
  })
})

describe('rankQuery', () => {
  const rows = (...labels: string[]): RankRow<string>[] =>
    labels.map((label) => ({ item: label, fields: [foldField(label)] }))

  it('orders by score and keeps the caller order on ties', () => {
    // The caller's order is last_activity_at descending for entries, so a tie
    // surfaces what somebody touched this morning rather than an alphabetical
    // accident.
    const out = rankQuery(searchNeedles('net'), rows('Old network', 'Network ops', 'Netting'), 10)
    expect(out).toEqual(['Network ops', 'Netting', 'Old network'])
  })

  it('drops non-matches', () => {
    expect(rankQuery(searchNeedles('zzz'), rows('a', 'b'), 10)).toEqual([])
  })

  it('honours the cap', () => {
    expect(rankQuery(searchNeedles('a'), rows('a1', 'a2', 'a3'), 2)).toHaveLength(2)
    expect(rankQuery(searchNeedles('a'), rows('a1'), 0)).toEqual([])
  })

  it('passes everything through, in order, for a blank query', () => {
    expect(rankQuery([], rows('c', 'b', 'a'), 10)).toEqual(['c', 'b', 'a'])
    expect(rankQuery([], rows('c', 'b', 'a'), 2)).toEqual(['c', 'b'])
  })
})

/* ─────────────────────── the integration this needs ────────────────────── */

/** Walk a dot path in a bundle. */
function leaf(tree: LocaleTree, key: string): string | LocaleTree | undefined {
  let node: string | LocaleTree | undefined = tree
  for (const part of key.split('.')) {
    if (typeof node !== 'object' || node === undefined) return undefined
    node = node[part]
  }
  return node
}

// THIS BLOCK IS THE HANDOFF, AS A TEST.
//
// `src/locales/index.ts` is integrator-only after Wave 1 (§1.0.2), so this
// worker wrote `src/locales/{en,ar}/cmd.json` and could not wire them in. Until
// the integrator adds the two imports and the two spread entries, every string
// in the palette and the cheatsheet renders as its own dot path — and NOTHING
// else in the repo reports it: localeParity compares the namespaces index.ts
// knows about, and localeReach skips a key whose root is not a known namespace.
// That is the exact failure localeReach.test.ts's header describes shipping once
// already, on a truncated handoff note.
//
// MAKE IT GREEN BY WIRING THE NAMESPACE, NEVER BY DELETING THE ASSERTION.
describe('cmd namespace is wired into src/locales/index.ts', () => {
  it('appears in both bundles, with every key the layer asks for', () => {
    expect(Object.keys(EN_NAMESPACES)).toContain('cmd')
    expect(Object.keys(AR_NAMESPACES)).toContain('cmd')

    const missing: string[] = []
    for (const key of SHORTCUTS.map((s) => s.labelKey)) {
      if (typeof leaf(en, key) !== 'string') missing.push(`en:${key}`)
      if (typeof leaf(ar, key) !== 'string') missing.push(`ar:${key}`)
    }
    expect(missing).toEqual([])
  })
})
