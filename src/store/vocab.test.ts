import { describe, expect, it } from 'vitest'
import type { VocabRow } from '../types'
// `import type` is fully erased, so this does NOT evaluate the module and does
// not race the shim below.
import type { VocabSnapshot } from './vocab'

// WHY A localStorage SHIM AND A DYNAMIC IMPORT.
//
// vitest runs in the `node` environment (vitest.config.ts explains why: every
// module the plan puts under test is pure by construction). store/vocab.ts is
// the one exception the plan itself carves out — it is a store, and it is on the
// list of things that must ship with a test. Its import graph reaches
// lib/i18n.ts, which reads localStorage at module scope to restore the saved
// locale, and node has no web storage: the ReferenceError fires before a single
// assertion runs.
//
// So the shim is installed FIRST and the module is pulled in afterwards with a
// dynamic import — a static import would be hoisted above this code and defeat
// the ordering. This is not a mock: nothing about the module under test is
// replaced, it is handed the browser global it legitimately expects.
//
// THE REAL FIX belongs in lib/i18n.ts (guard the localStorage read, as
// store/config.ts already does for its cache) and is filed as a gap in this
// worker's handoff. It is worth doing on its own merits: Safari in private mode
// has historically thrown on the same call.
const g = globalThis as { localStorage?: Storage }
if (!g.localStorage) {
  const mem = new Map<string, string>()
  g.localStorage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => {
      mem.set(k, v)
    },
    removeItem: (k: string) => {
      mem.delete(k)
    },
    clear: () => {
      mem.clear()
    },
    key: (i: number) => [...mem.keys()][i] ?? null,
    get length() {
      return mem.size
    },
  } as unknown as Storage
}

const { DEFAULT_STALE_DAYS, FROZEN_KEYS, slaDays, staleDays, vocabItems, vocabLabel } =
  await import('./vocab')

/** A vocab_options row with the columns nothing under test reads already filled. */
function row(partial: Partial<VocabRow> & Pick<VocabRow, 'kind' | 'key'>): VocabRow {
  return {
    label: '',
    label_ar: '',
    color: null,
    sort_order: 0,
    hidden: false,
    stale_after_days: null,
    sla_days: null,
    updated_at: '2026-07-29T12:00:00.000Z',
    updated_by: null,
    ...partial,
  }
}

function snap(rows: VocabRow[]): VocabSnapshot {
  return { rows, loadedAt: rows.length > 0 ? 1 : null }
}

/** The state before 0003 runs, and the state the app must survive unchanged. */
const EMPTY = snap([])

describe('vocabLabel — the frozen resolution order', () => {
  it('1: an Arabic override wins in Arabic', () => {
    const s = snap([row({ kind: 'status', key: 'blocked', label: 'Held', label_ar: 'معلّق' })])
    expect(vocabLabel(s, 'status', 'blocked', 'ar')).toBe('معلّق')
  })

  it('2: an English override wins in English', () => {
    const s = snap([row({ kind: 'status', key: 'blocked', label: 'Held' })])
    expect(vocabLabel(s, 'status', 'blocked', 'en')).toBe('Held')
  })

  it('3: a blank Arabic override falls to the i18n default, NEVER to the English override', () => {
    // The rule that bites: an admin renames only the English label, and the
    // Arabic UI must not silently switch half a screen into English.
    const s = snap([row({ kind: 'status', key: 'blocked', label: 'Held', label_ar: '   ' })])
    expect(vocabLabel(s, 'status', 'blocked', 'ar')).toBe('محجوب')
    expect(vocabLabel(s, 'status', 'blocked', 'ar')).not.toBe('Held')
  })

  it('4: no row at all resolves through i18n, in the locale it was HANDED', () => {
    // The digest renders Arabic while the UI sits in English — this is why the
    // non-React resolvers take an explicit locale instead of calling t().
    expect(vocabLabel(EMPTY, 'status', 'in_progress', 'en')).toBe('In progress')
    expect(vocabLabel(EMPTY, 'status', 'in_progress', 'ar')).toBe('قيد التنفيذ')
    expect(vocabLabel(EMPTY, 'priority', 'critical', 'en')).toBe('Critical')
    expect(vocabLabel(EMPTY, 'type', 'escalation', 'ar')).toBe('تصعيد')
  })

  it('5: an unknown key falls back to the key itself, never to blank', () => {
    expect(vocabLabel(EMPTY, 'status', 'not_a_status', 'en')).toBe('not_a_status')
    expect(vocabLabel(EMPTY, 'status', 'not_a_status', 'ar')).toBe('not_a_status')
  })

  it('a whitespace-only English override is "no override", not a label', () => {
    const s = snap([row({ kind: 'status', key: 'done', label: '  ' })])
    expect(vocabLabel(s, 'status', 'done', 'en')).toBe('Done')
  })
})

describe('vocabItems — FROZEN_KEYS is the spine', () => {
  it('an unapplied 0003 still yields a complete, ordered picker', () => {
    const items = vocabItems(EMPTY, 'status', 'en')
    expect(items.map((i) => i.key)).toEqual([...FROZEN_KEYS.status])
    expect(items.map((i) => i.label)).toEqual([
      'New',
      'In progress',
      'Blocked',
      'Waiting on',
      'Done',
      'Cancelled',
    ])
    expect(items.every((i) => i.color === null && !i.hidden)).toBe(true)
  })

  it('a PARTIALLY seeded table does not lose the keys it is missing', () => {
    const s = snap([row({ kind: 'status', key: 'done', label: 'Shipped', sort_order: 0 })])
    const items = vocabItems(s, 'status', 'en')
    expect(items).toHaveLength(FROZEN_KEYS.status.length)
    expect(items.find((i) => i.key === 'done')?.label).toBe('Shipped')
    expect(items.find((i) => i.key === 'new')?.label).toBe('New')
  })

  it('hidden options leave the picker unless asked for', () => {
    const s = snap([row({ kind: 'status', key: 'cancelled', hidden: true })])
    expect(vocabItems(s, 'status', 'en').map((i) => i.key)).not.toContain('cancelled')
    expect(vocabItems(s, 'status', 'en', { includeHidden: true }).map((i) => i.key)).toContain(
      'cancelled',
    )
  })

  it('an admin sort_order wins, and ties fall back to the frozen order', () => {
    const s = snap([
      row({ kind: 'priority', key: 'critical', sort_order: 1 }),
      row({ kind: 'priority', key: 'low', sort_order: 9 }),
      // medium and high have no row at all: their position falls back to the
      // frozen index (1 and 2), which is what keeps a partial reorder sane.
    ])
    expect(vocabItems(s, 'priority', 'en').map((i) => i.key)).toEqual([
      'medium',
      'critical',
      'high',
      'low',
    ])
  })

  it('carries the two thresholds through untouched', () => {
    const s = snap([
      row({ kind: 'priority', key: 'high', stale_after_days: 6, sla_days: 3, color: '#f59e0b' }),
    ])
    const high = vocabItems(s, 'priority', 'en').find((i) => i.key === 'high')
    expect(high).toMatchObject({ staleAfterDays: 6, slaDays: 3, color: '#f59e0b' })
  })
})

describe('staleDays / slaDays', () => {
  it('an admin override wins over the coalesced default', () => {
    const s = snap([row({ kind: 'priority', key: 'high', stale_after_days: 6 })])
    expect(staleDays(s, 'high')).toBe(6)
  })

  it('a cleared threshold restores the default rather than disabling staleness', () => {
    const s = snap([row({ kind: 'priority', key: 'high', stale_after_days: null })])
    expect(staleDays(s, 'high')).toBe(DEFAULT_STALE_DAYS.high)
    expect(staleDays(EMPTY, 'critical')).toBe(2)
    expect(staleDays(EMPTY, 'low')).toBe(15)
  })

  it('reports null when a priority has no SLA — a value, not a gap to fill in', () => {
    expect(slaDays(EMPTY, 'critical')).toBeNull()
    expect(slaDays(snap([row({ kind: 'priority', key: 'critical' })]), 'critical')).toBeNull()
    expect(slaDays(snap([row({ kind: 'priority', key: 'critical', sla_days: 1 })]), 'critical')).toBe(
      1,
    )
  })

  it('the defaults are exactly what v_entry_health coalesces over', () => {
    expect(DEFAULT_STALE_DAYS).toEqual({ critical: 2, high: 4, medium: 8, low: 15 })
  })
})

describe('FROZEN_KEYS', () => {
  it('matches the four frozen unions in types.ts, in schema order', () => {
    expect(FROZEN_KEYS.status).toEqual([
      'new',
      'in_progress',
      'blocked',
      'waiting_on',
      'done',
      'cancelled',
    ])
    expect(FROZEN_KEYS.priority).toEqual(['low', 'medium', 'high', 'critical'])
    expect(FROZEN_KEYS.type).toEqual([
      'action',
      'decision',
      'issue',
      'request',
      'change',
      'escalation',
      'note',
    ])
  })

  it('every frozen key resolves to a real i18n label in both languages', () => {
    // The guarantee that makes "no DEFAULT_VOCAB shim" true: if any key were
    // missing from a locale file, this would return the raw key.
    for (const kind of ['status', 'priority', 'type'] as const) {
      for (const key of FROZEN_KEYS[kind]) {
        expect(vocabLabel(EMPTY, kind, key, 'en')).not.toBe(key)
        expect(vocabLabel(EMPTY, kind, key, 'ar')).not.toBe(key)
      }
    }
  })

  it('is frozen, so no screen can add a status by pushing onto it', () => {
    expect(Object.isFrozen(FROZEN_KEYS)).toBe(true)
    expect(Object.isFrozen(FROZEN_KEYS.status)).toBe(true)
  })
})
