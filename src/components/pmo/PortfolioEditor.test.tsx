// The PMO portfolio's forms — the two rules that matter, and both are refusals.
//
//  1. NO PERMISSION, NO CONTROL, AND NOT A DISABLED ONE. 0031 gates the
//     definition tables on `structure.edit` and the two fieldwork tables on
//     `capture.write`, and a reader without the key sees the section exactly as
//     it was rather than a row of greyed-out buttons explaining a screen they
//     will never reach. Asserted per key, in both directions, because a gate
//     that hides everything from everybody passes a one-sided test.
//  2. AN EMPTY BOX SAVES AS `null`, NEVER AS ZERO. The rule 0031 was built
//     around. It is asserted against the `build()` of every form that has a
//     nullable number, because getting it right in six of seven forms is the
//     same bug with a smaller blast radius.
//
// WHY renderToStaticMarkup AND NOT A DOM: `vitest.config.ts` is
// `environment: 'node'`. No click can be simulated and nothing can be typed
// into a box here, which is exactly why the arithmetic lives in pure `build()`
// functions this file can call directly — a form whose null rule could only be
// reached through a keystroke would be a form nothing could pin.

import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { PmoAction, PmoProject } from '../../types'

const fx = vi.hoisted(() => {
  // lib/i18n reads localStorage at module scope, so the shim cannot wait for a
  // beforeAll() — NodeEditor.test.tsx does the same for the same reason.
  const mem = new Map<string, string>()
  const g = globalThis as unknown as Record<string, unknown>
  g.localStorage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => void mem.set(k, v),
    removeItem: (k: string) => void mem.delete(k),
    clear: () => mem.clear(),
    key: (i: number) => [...mem.keys()][i] ?? null,
    get length() {
      return mem.size
    },
  }
  g.addEventListener = () => {}
  g.removeEventListener = () => {}
  g.window = globalThis
  g.matchMedia = () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} })
  g.document = { documentElement: { dir: 'ltr', lang: 'en' } }

  const state = { structure: true, capture: true }
  return { state }
})

vi.mock('../../store/auth', () => ({
  useHasPerm: (key: string) =>
    key === 'structure.edit' ? fx.state.structure : key === 'capture.write' ? fx.state.capture : false,
}))
vi.mock('../../store/members', () => ({
  useMembers: () => [{ id: 'm1', displayName: 'Dema Alkassim' }],
}))
vi.mock('../../store/pmo', () => ({
  usePmo: () => ({ projects: [], initiatives: [] }),
  invalidatePmo: () => Promise.resolve(),
}))
vi.mock('../../api/pmo', () => {
  const table = {
    create: async () => ({ ok: true, data: {} }),
    update: async () => ({ ok: true, data: {} }),
    remove: async () => ({ ok: true, data: undefined }),
  }
  return {
    projects: table,
    initiatives: table,
    actions: table,
    risks: table,
    revenue: table,
    objectives: table,
    keyResults: table,
  }
})
vi.mock('../Confirm', () => ({ confirm: async () => true }))
vi.mock('../toast', () => ({ toast: () => {} }))

const locales = await import('../../locales')
Object.assign(locales.en, (await import('../../locales/en/pmo.json')).default)
Object.assign(locales.en, (await import('../../locales/en/common.json')).default)

const mod = await import('./PortfolioEditor')
const { ActionEditor, InitiativeEditor, ObjectiveEditor, ProjectEditor, blanks, builders } = mod

/* ═══════════════════════════ 1. the permission ══════════════════════════ */

describe('the permission gate', () => {
  it('renders NOTHING for a definition table without structure.edit', () => {
    // Absent, not disabled. A greyed-out "Add a project" explains a screen the
    // reader will never reach; absence explains nothing and is honest.
    fx.state.structure = false
    expect(renderToStaticMarkup(<ProjectEditor />)).toBe('')
    expect(renderToStaticMarkup(<InitiativeEditor />)).toBe('')
    expect(renderToStaticMarkup(<ObjectiveEditor />)).toBe('')
    fx.state.structure = true
  })

  it('renders NOTHING for a fieldwork table without capture.write', () => {
    fx.state.capture = false
    expect(renderToStaticMarkup(<ActionEditor />)).toBe('')
    fx.state.capture = true
  })

  it('offers the fieldwork form to a member who holds only capture.write', () => {
    // The other direction, and the point of 0031 splitting the keys at all: the
    // huddle's register is the team's to edit without giving them the budget.
    fx.state.structure = false
    fx.state.capture = true
    const out = renderToStaticMarkup(<ActionEditor />)
    expect(out).toContain('Add a follow-up action')
    // And the definition tables stay shut to the same reader in the same tick.
    expect(renderToStaticMarkup(<ProjectEditor />)).toBe('')
    fx.state.structure = true
  })

  it('offers one control, not a form, until it is asked for', () => {
    // The section's job is to say what the portfolio holds. A form permanently
    // open would push the cards the reader came for below the fold on a phone.
    const out = renderToStaticMarkup(<ProjectEditor />)
    expect(out).toContain('Add a project')
    expect(out).not.toContain('<form')
  })

  it('says Edit rather than Add when it is bound to a row', () => {
    const project = {
      id: 'p1',
      name: 'Approvals Management System',
      name_ar: '',
      manager_id: null,
      budget: null,
      currency: 'SAR',
      start_date: null,
      end_date: null,
      phase: 'start',
      actual_pct: null,
      planned_pct: null,
      note: '',
      note_ar: '',
      source: 'local',
      external_ref: null,
    } as unknown as PmoProject
    const out = renderToStaticMarkup(<ProjectEditor project={project} />)
    expect(out).toContain('Edit')
    expect(out).not.toContain('Add a project')
  })
})

/* ═══════════════════════ 2. an empty box is null ════════════════════════ */

describe('an empty numeric box saves as null, not as zero', () => {
  it('on a project — budget, actual and planned all at once', () => {
    // The blank form is the exact state a director is in the first time they
    // add a project: a name, and nothing measured yet. Every one of these three
    // arriving as 0 would make the card read "0% actual" — a measurement
    // nobody took, which is the sentence 0031's comments refuse.
    const built = builders.project({ ...blanks.project(), name: 'Approvals Management System' })
    expect(built.ok).toBe(true)
    if (!built.ok) return
    expect(built.input.budget).toBe(null)
    expect(built.input.actual_pct).toBe(null)
    expect(built.input.planned_pct).toBe(null)
    // Not merely falsy — `0` would pass a truthiness check and fail the rule.
    expect(built.input.actual_pct).not.toBe(0)
    // And a cleared select is null rather than absent from the patch: a key
    // left off means "do not touch", so dropping it would make clearing a
    // manager silently do nothing.
    expect('manager_id' in built.input).toBe(true)
    expect(built.input.manager_id).toBe(null)
    expect(built.input.start_date).toBe(null)
  })

  it('on an initiative', () => {
    const built = builders.initiative({ ...blanks.initiative(), name: 'Data quality' })
    expect(built.ok).toBe(true)
    if (!built.ok) return
    expect(built.input.actual_pct).toBe(null)
    expect(built.input.planned_pct).toBe(null)
  })

  it('on a revenue line — an unreported quarter is not a quarter that earned nothing', () => {
    // 0031's own comment on `achieved`: the source dashboard footnotes one of
    // its figures as covering only the first half of the year for exactly this
    // reason, and `Portfolio.tsx` prints "Nobody has said" in that column.
    const built = builders.revenue({ ...blanks.revenue(2026), projectId: 'p1' })
    expect(built.ok).toBe(true)
    if (!built.ok) return
    expect(built.input.planned).toBe(null)
    expect(built.input.achieved).toBe(null)
    // The two NOT NULL columns still arrive as numbers.
    expect(built.input.year).toBe(2026)
    expect(built.input.quarter).toBe(1)
  })

  it('on a key result — nobody has checked in is not a reading of zero', () => {
    const built = builders.keyResult(
      { ...blanks.keyResult(), name: 'Claims live', target: '100' },
      'o1',
    )
    expect(built.ok).toBe(true)
    if (!built.ok) return
    expect(built.input.current_value).toBe(null)
    expect(built.input.start_value).toBe(0)
    expect(built.input.target_value).toBe(100)
  })

  it('on a risk — ungraded stays ungraded rather than becoming low', () => {
    const built = builders.risk({ ...blanks.risk(), summary: 'Vendor has not signed' })
    expect(built.ok).toBe(true)
    if (!built.ok) return
    expect(built.input.level).toBe(null)
    expect(built.input.impact).toBe(null)
    // But the two NOT NULL DEFAULT '' columns keep the empty string 0031 chose
    // for them, rather than becoming a third state.
    expect(built.input.mitigation).toBe('')
  })

  it('keeps a typed zero, which is a different sentence from a blank one', () => {
    const built = builders.project({
      ...blanks.project(),
      name: 'Nothing started yet',
      actual: '0',
    })
    expect(built.ok).toBe(true)
    if (!built.ok) return
    expect(built.input.actual_pct).toBe(0)
  })
})

/* ═════════════════════════ 3. what a form refuses ═══════════════════════ */

describe('what a form refuses to save', () => {
  it('a row with no name, rather than one called ""', () => {
    expect(builders.project(blanks.project())).toEqual({ ok: false, error: 'pmo.errName' })
    expect(builders.objective(blanks.objective())).toEqual({ ok: false, error: 'pmo.errName' })
    expect(builders.action(blanks.action(), 'now')).toEqual({ ok: false, error: 'pmo.errTitle' })
    expect(builders.risk(blanks.risk())).toEqual({ ok: false, error: 'pmo.errSummary' })
  })

  it('a percentage outside 0..100, rather than clamping it', () => {
    expect(builders.project({ ...blanks.project(), name: 'x', actual: '140' })).toEqual({
      ok: false,
      error: 'pmo.errPct',
    })
  })

  it('a key result whose target equals where it started', () => {
    // `pmo_key_results_measurable`. A target equal to the start is a measure
    // that cannot move and every percentage derived from it divides by zero —
    // caught here so the reader gets a sentence rather than a constraint name.
    expect(
      builders.keyResult({ ...blanks.keyResult(), name: 'x', start: '10', target: '10' }, 'o1'),
    ).toEqual({ ok: false, error: 'pmo.errTarget' })
  })

  it('revenue with no project, because project_id is NOT NULL', () => {
    expect(builders.revenue(blanks.revenue(2026))).toEqual({
      ok: false,
      error: 'pmo.errProject',
    })
  })
})

/* ═════════════════════════════ 4. the Jira key ══════════════════════════ */

describe('the Jira key, which every form in this family carries', () => {
  it('moves `source` with it, in both directions', () => {
    // 0031's probe 3 checks all eight tables CAN name an issue; this checks the
    // pair is never written half-way. A row that says local while pointing at
    // Jira has no link, and one that says jira with no key has nothing to
    // build one from.
    const set = builders.project({ ...blanks.project(), name: 'x', jira: 'NPH-14' })
    expect(set.ok).toBe(true)
    if (!set.ok) return
    expect(set.input.source).toBe('jira')
    expect(set.input.external_ref).toBe('NPH-14')

    const cleared = builders.project({ ...blanks.project(), name: 'x', jira: '' })
    expect(cleared.ok).toBe(true)
    if (!cleared.ok) return
    expect(cleared.input.source).toBe('local')
    expect(cleared.input.external_ref).toBe(null)
  })

  it('is on the fieldwork forms too, not only the definitions', () => {
    const built = builders.action({ ...blanks.action(), title: 'Chase the signature', jira: 'NPH-2' }, 'now')
    expect(built.ok).toBe(true)
    if (!built.ok) return
    expect(built.input.source).toBe('jira')
    expect(built.input.external_ref).toBe('NPH-2')
  })

  it('stores no URL — it is computed from the key', () => {
    // 0031 departs from `map_nodes` here on purpose: a browse URL is
    // `<site>/browse/<KEY>` and storing it would put the site address in eight
    // more tables for the day it changes.
    const built = builders.project({ ...blanks.project(), name: 'x', jira: 'NPH-14' })
    expect(built.ok).toBe(true)
    if (!built.ok) return
    expect(Object.keys(built.input)).not.toContain('external_url')
  })
})

/* ═══════════════════════ 5. re-saving a closed action ═══════════════════ */

describe('an action that is already done', () => {
  it('keeps the stamp it was closed with', () => {
    const row = {
      id: 'a1',
      title: 'Chase the signature',
      detail: '',
      owner_id: null,
      owner2_id: null,
      project_id: null,
      initiative_id: null,
      due_date: null,
      done_at: '2026-01-05T09:00:00.000Z',
      source: 'local',
      external_ref: null,
    } as unknown as PmoAction
    // The form reads the row, nothing is changed, and it is saved again — which
    // must not move the row into this week.
    const form = { ...blanks.action(), title: row.title, done: true, doneAt: row.done_at }
    const built = builders.action(form, '2026-08-22T10:00:00.000Z')
    expect(built.ok).toBe(true)
    if (!built.ok) return
    expect(built.input.done_at).toBe('2026-01-05T09:00:00.000Z')
  })
})
