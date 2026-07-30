// buildDigestModel() — the rules, not the wording.
//
// Wording is asserted in render.test.ts against a hand-written model; this suite
// is about MEMBERSHIP, CLASSIFICATION and COUNTING, which are the three things
// that make a status report right or wrong. Every case pins the clock through
// the fixtures' NOW and passes no store to anything.

import { describe, expect, it } from 'vitest'
import { buildDigestModel } from './build'
import { stripIsolates } from './bidi'
import { CLASSIFY_ORDER, SECTION_ORDER, type DigestModel, type DigestSectionKind } from './types'
import { FROM, NOW, TO, entry, health, options, rows, track, update } from './fixtures'
import { bucketFollowUps } from '../entrySections'
import type { Entry, EntryHealth, EntryPriority } from '../../types'

/**
 * store/vocab's DEFAULT_STALE_DAYS, restated.
 *
 * Not imported: `src/lib/**` may not reach into `src/store/**` and the standing
 * grep catches `../../store` too. Only `bucketFollowUps`' stale branch reads it,
 * and no fixture in the one test that supplies it is anywhere near stale, so a
 * drift here cannot make that assertion pass wrongly.
 */
const STALE_DAYS: Record<EntryPriority, number> = { critical: 2, high: 4, medium: 8, low: 15 }

/** Every id the model reported, section by section. */
function idsIn(m: DigestModel, kind: DigestSectionKind): string[] {
  return m.tracks
    .flatMap((t) => t.sections)
    .filter((s) => s.kind === kind)
    .flatMap((s) => s.items.map((i) => i.id))
}

/** Isolates and Intl's own direction marks removed, so a diff shows the words. */
function bare(value: string): string {
  return stripIsolates(value).replace(/[\u200E\u200F]/g, '')
}

function allIds(m: DigestModel): string[] {
  return m.tracks.flatMap((t) => t.sections).flatMap((s) => s.items.map((i) => i.id))
}

describe('window membership', () => {
  it('takes an entry closed inside the window', () => {
    const e = entry({
      id: 'a',
      title: 'Firewall rule DC2',
      status: 'done',
      created_at: '2026-05-02T09:00:00.000Z',
      closed_at: '2026-07-28T09:00:00.000Z',
    })
    const m = buildDigestModel(rows({ entries: [e] }), options())
    expect(idsIn(m, 'closed')).toEqual(['a'])
  })

  it('takes an entry created inside the window even when it closed later', () => {
    const e = entry({
      id: 'a',
      title: 'Raised then finished',
      status: 'done',
      created_at: '2026-07-24T09:00:00.000Z',
      closed_at: '2026-08-04T09:00:00.000Z',
    })
    expect(allIds(buildDigestModel(rows({ entries: [e] }), options()))).toEqual(['a'])
  })

  it('drops a closed entry that both opened and closed before the window', () => {
    const e = entry({
      id: 'a',
      title: 'Ancient history',
      status: 'done',
      created_at: '2026-03-02T09:00:00.000Z',
      closed_at: '2026-03-09T09:00:00.000Z',
    })
    expect(allIds(buildDigestModel(rows({ entries: [e] }), options()))).toEqual([])
  })

  it('takes an open entry whose only activity is inside the window', () => {
    const e = entry({
      id: 'a',
      title: 'Touched Monday',
      created_at: '2026-02-01T09:00:00.000Z',
      last_activity_at: '2026-07-27T09:00:00.000Z',
    })
    expect(allIds(buildDigestModel(rows({ entries: [e] }), options()))).toEqual(['a'])
  })

  it('takes a long-silent open entry that is overdue as of `to` — the clause everyone drops', () => {
    // Created in February, untouched since March, due in April. Every other
    // clause in the frozen rule excludes it, and it is the single most important
    // row in the report.
    const e = entry({
      id: 'a',
      title: 'MPLS circuit order',
      created_at: '2026-02-01T09:00:00.000Z',
      last_activity_at: '2026-03-04T09:00:00.000Z',
      due_date: '2026-04-01',
    })
    const m = buildDigestModel(rows({ entries: [e] }), options())
    expect(idsIn(m, 'overdue')).toEqual(['a'])
  })

  it('drops a quiet, undated, open entry from outside the window', () => {
    const e = entry({
      id: 'a',
      title: 'Dormant',
      created_at: '2026-02-01T09:00:00.000Z',
      last_activity_at: '2026-03-04T09:00:00.000Z',
    })
    expect(allIds(buildDigestModel(rows({ entries: [e] }), options()))).toEqual([])
  })

  it('is inclusive at both ends', () => {
    const first = entry({ id: 'first', title: 'On from', created_at: `${FROM}T09:00:00.000Z` })
    const last = entry({ id: 'last', title: 'On to', created_at: `${TO}T09:00:00.000Z` })
    const m = buildDigestModel(rows({ entries: [first, last] }), options())
    expect(allIds(m).sort()).toEqual(['first', 'last'])
  })
})

describe('classification', () => {
  const cases: [DigestSectionKind, Entry, EntryHealth | null][] = [
    ['closed', entry({ id: 'c', title: 'Done', status: 'done', closed_at: '2026-07-27T09:00:00.000Z' }), null],
    ['overdue', entry({ id: 'o', title: 'Late', due_date: '2026-07-20' }), null],
    [
      'slaBreached',
      entry({ id: 's', title: 'Breached' }),
      health({ entry_id: 's', sla_breached: true, sla_due_at: '2026-07-26T09:00:00.000Z' }),
    ],
    ['blocked', entry({ id: 'b', title: 'Stuck', status: 'blocked' }), null],
    ['blocked', entry({ id: 'w', title: 'Waiting', status: 'waiting_on' }), null],
    ['inProgress', entry({ id: 'p', title: 'Moving' }), null],
  ]

  for (const [kind, e, h] of cases) {
    it(`puts ${e.id} in ${kind}`, () => {
      const m = buildDigestModel(rows({ entries: [e], health: h ? [h] : [] }), options())
      expect(idsIn(m, kind)).toEqual([e.id])
    })
  }

  it('reports an entry ONCE, in CLASSIFY_ORDER — overdue beats blocked and SLA', () => {
    const e = entry({ id: 'a', title: 'Late and stuck', status: 'blocked', due_date: '2026-07-20' })
    const h = health({ entry_id: 'a', days_overdue: 9, sla_breached: true })
    const m = buildDigestModel(rows({ entries: [e], health: [h] }), options())
    expect(allIds(m)).toEqual(['a'])
    expect(idsIn(m, 'overdue')).toEqual(['a'])
  })

  it('counts a lapsed follow_up_date as overdue, exactly as follow-ups does', () => {
    const e = entry({ id: 'a', title: 'Promised to look again', follow_up_date: '2026-07-25' })
    expect(idsIn(buildDigestModel(rows({ entries: [e] }), options()), 'overdue')).toEqual(['a'])
  })

  it('agrees with bucketFollowUps about what is overdue when `to` is today', () => {
    // The corrosive bug this guards: the list a person triages in the morning
    // and the digest they send at noon disagreeing about what is late.
    const entries = [
      entry({ id: 'due-past', title: 'A', due_date: '2026-07-20' }),
      entry({ id: 'fu-past', title: 'B', follow_up_date: '2026-07-28' }),
      entry({ id: 'due-today', title: 'C', due_date: TO }),
      entry({ id: 'due-future', title: 'D', due_date: '2026-08-20' }),
      entry({ id: 'none', title: 'E' }),
    ]
    const buckets = bucketFollowUps(entries, new Map(), {
      meId: null,
      today: TO,
      staleDays: (p) => STALE_DAYS[p],
    })
    const m = buildDigestModel(rows({ entries }), options())
    expect(idsIn(m, 'overdue').sort()).toEqual(buckets.overdue.map((e) => e.id).sort())
  })
})

describe('section selection', () => {
  const entries = [
    entry({ id: 'c', title: 'Done', status: 'done', closed_at: '2026-07-27T09:00:00.000Z' }),
    entry({ id: 'o', title: 'Late', due_date: '2026-07-20' }),
    entry({ id: 'p', title: 'Moving' }),
  ]

  it('honours the requested order verbatim', () => {
    const m = buildDigestModel(
      rows({ entries }),
      options({ sections: ['overdue', 'closed', 'inProgress'] }),
    )
    expect(m.tracks[0].sections.map((s) => s.kind)).toEqual(['overdue', 'closed', 'inProgress'])
  })

  it('drops the rows of a deselected section rather than spilling them elsewhere', () => {
    const m = buildDigestModel(rows({ entries }), options({ sections: ['inProgress'] }))
    expect(allIds(m)).toEqual(['p'])
  })

  it('still counts every kind in totals.bySection, so the screen can price the toggle', () => {
    const m = buildDigestModel(rows({ entries }), options({ sections: ['inProgress'] }))
    expect(m.totals.bySection).toEqual({
      closed: 1,
      overdue: 1,
      inProgress: 1,
      blocked: 0,
      slaBreached: 0,
    })
    expect(m.totals.entries).toBe(1)
  })

  it('emits no empty section', () => {
    const m = buildDigestModel(rows({ entries: [entries[2]] }), options())
    expect(m.tracks[0].sections.map((s) => s.kind)).toEqual(['inProgress'])
  })

  it('counts each entry exactly once across all sections', () => {
    const m = buildDigestModel(rows({ entries }), options())
    const summed = m.tracks[0].sections.reduce((n, s) => n + s.count, 0)
    expect(summed).toBe(allIds(m).length)
    expect(new Set(allIds(m)).size).toBe(allIds(m).length)
  })
})

describe('tracks', () => {
  const two = [
    track({ id: 'trk-net', name: 'Network', name_ar: 'الشبكات', sort_order: 1 }),
    track({ id: 'trk-pmo', name: 'PMO', name_ar: 'مكتب إدارة المشاريع', sort_order: 2 }),
  ]
  const entries = [
    entry({ id: 'n1', title: 'Net one', track_id: 'trk-net' }),
    entry({ id: 'p1', title: 'Pmo one', track_id: 'trk-pmo' }),
    entry({ id: 'x1', title: 'Homeless', track_id: null }),
  ]

  it('groups by track in configured order and puts the untracked group last', () => {
    const m = buildDigestModel(rows({ entries, tracks: two }), options())
    expect(m.tracks.map((t) => t.name)).toEqual(['Network', 'PMO', 'No track'])
  })

  it('narrows to the selected tracks and then excludes the untracked group', () => {
    const m = buildDigestModel(rows({ entries, tracks: two }), options({ trackIds: ['trk-pmo'] }))
    expect(m.tracks.map((t) => t.name)).toEqual(['PMO'])
    expect(allIds(m)).toEqual(['p1'])
  })

  it('files an entry pointing at an unknown track under No track', () => {
    const orphan = entry({ id: 'z', title: 'Deleted track', track_id: 'trk-gone' })
    const m = buildDigestModel(rows({ entries: [orphan], tracks: two }), options())
    expect(m.tracks.map((t) => t.name)).toEqual(['No track'])
  })

  it('omits a track with nothing to report unless asked to keep it', () => {
    const one = [entry({ id: 'n1', title: 'Net one', track_id: 'trk-net' })]
    expect(buildDigestModel(rows({ entries: one, tracks: two }), options()).tracks).toHaveLength(1)
    const kept = buildDigestModel(
      rows({ entries: one, tracks: two }),
      options({ includeEmptyTracks: true }),
    )
    expect(kept.tracks.map((t) => t.name)).toEqual(['Network', 'PMO'])
    expect(kept.tracks[1].sections).toEqual([])
    // An empty track is not an entry, and must not inflate the report's count.
    expect(kept.totals.tracks).toBe(1)
  })
})

describe('tag breakdown', () => {
  const onboarding = track({
    id: 'trk-onb',
    name: 'Onboarding',
    name_ar: 'الانضمام',
    suggested_tags: ['direct-integration', 'portal'],
  })
  const entries = [
    entry({ id: 'a', title: 'A', track_id: 'trk-onb', tags: ['direct-integration'] }),
    entry({
      id: 'b',
      title: 'B',
      track_id: 'trk-onb',
      tags: ['portal'],
      status: 'done',
      closed_at: '2026-07-27T09:00:00.000Z',
    }),
    entry({ id: 'c', title: 'C', track_id: 'trk-onb', tags: ['misc'] }),
  ]

  it("defaults to the track's own suggested_tags — nothing in the code names Onboarding", () => {
    const m = buildDigestModel(rows({ entries, tracks: [onboarding] }), options())
    expect(m.tracks[0].tagBreakdown.map((r) => r.tag)).toEqual(['direct-integration', 'portal', ''])
  })

  it('counts open and closed per tag and closes the gap with an Other row', () => {
    const m = buildDigestModel(rows({ entries, tracks: [onboarding] }), options())
    expect(m.tracks[0].tagBreakdown).toEqual([
      { kind: 'tag', tag: 'direct-integration', label: 'direct-integration', open: 1, closed: 0, total: 1 },
      { kind: 'tag', tag: 'portal', label: 'portal', open: 0, closed: 1, total: 1 },
      { kind: 'other', tag: '', label: 'Other', open: 1, closed: 0, total: 1 },
    ])
  })

  it('omits the Other row when every entry carries a listed tag', () => {
    const m = buildDigestModel(
      rows({ entries: entries.slice(0, 2), tracks: [onboarding] }),
      options(),
    )
    expect(m.tracks[0].tagBreakdown.map((r) => r.kind)).toEqual(['tag', 'tag'])
  })

  it('an explicit list overrides every track; an explicit empty list is the off switch', () => {
    const forced = buildDigestModel(
      rows({ entries, tracks: [onboarding] }),
      options({ tagBreakdown: ['misc'] }),
    )
    expect(forced.tracks[0].tagBreakdown.map((r) => r.tag)).toEqual(['misc', ''])

    const off = buildDigestModel(
      rows({ entries, tracks: [onboarding] }),
      options({ tagBreakdown: [] }),
    )
    expect(off.tracks[0].tagBreakdown).toEqual([])
  })

  it('gives a track with no suggested tags no breakdown at all', () => {
    const m = buildDigestModel(rows({ entries: [entry({ id: 'a', title: 'A' })] }), options())
    expect(m.tracks[0].tagBreakdown).toEqual([])
  })
})

describe('owners', () => {
  it('prefers the member row, falls back to free text, then to Unassigned', () => {
    const entries = [
      entry({ id: 'a', title: 'A', owner_id: 'usr-ahmed' }),
      entry({ id: 'b', title: 'B', owner_name: 'vendor' }),
      entry({ id: 'c', title: 'C' }),
      // A provisioned account with a blank display name must fall through, not
      // render a name-shaped hole.
      entry({ id: 'd', title: 'D', owner_id: 'usr-blank', owner_name: 'stand-in' }),
    ]
    const m = buildDigestModel(rows({ entries }), options())
    const owners = m.tracks[0].sections[0].items.map((i) => i.owner)
    expect(owners).toEqual(['Ahmed', 'vendor', 'Unassigned', 'stand-in'])
  })

  it('resolves Unassigned in the DIGEST locale, not the UI locale', () => {
    const m = buildDigestModel(
      rows({ entries: [entry({ id: 'c', title: 'C' })] }),
      options({ locale: 'ar' }),
    )
    expect(stripIsolates(m.tracks[0].sections[0].items[0].owner)).toBe('بلا مسؤول')
  })
})

describe('details', () => {
  function detail(e: Entry, h?: EntryHealth, o = options()): string {
    const m = buildDigestModel(rows({ entries: [e], health: h ? [h] : [] }), o)
    return stripIsolates(m.tracks[0].sections[0].items[0].detail)
  }

  it('labels a close inside a short window by weekday, per §4.7', () => {
    const e = entry({
      id: 'a',
      title: 'Firewall rule DC2',
      status: 'done',
      closed_at: '2026-07-28T09:00:00.000Z',
    })
    expect(detail(e)).toBe('closed Tue')
  })

  it('labels a close in a long window by date, because "Tue" of which week?', () => {
    const e = entry({
      id: 'a',
      title: 'Firewall rule DC2',
      status: 'done',
      closed_at: '2026-07-28T09:00:00.000Z',
    })
    expect(detail(e, undefined, options({ from: '2026-06-01' }))).toBe('closed 28/07/2026')
  })

  it('gives an in-progress row its due date', () => {
    expect(detail(entry({ id: 'a', title: 'A', due_date: '2026-08-14' }))).toBe('due 14/08/2026')
  })

  it('gives an undated in-progress row its silence, and a fresh one its own sentence', () => {
    const quiet = entry({ id: 'a', title: 'A', last_activity_at: '2026-07-24T09:00:00.000Z' })
    expect(detail(quiet)).toBe('no update in 5 days')
    const fresh = entry({ id: 'a', title: 'A', last_activity_at: '2026-07-29T09:00:00.000Z' })
    expect(detail(fresh)).toBe('updated today')
  })

  it('names the status on a blocked row, so blocked and waiting_on are told apart', () => {
    const blocked = entry({ id: 'a', title: 'A', status: 'blocked', last_activity_at: '2026-07-17T09:00:00.000Z' })
    expect(detail(blocked)).toBe('Blocked · 12 days')
    const waiting = entry({ id: 'a', title: 'A', status: 'waiting_on', last_activity_at: '2026-07-17T09:00:00.000Z' })
    expect(detail(waiting)).toBe('Waiting on · 12 days')
  })

  it('counts overdue days from whichever date lapsed first', () => {
    const e = entry({ id: 'a', title: 'A', due_date: '2026-07-20', follow_up_date: '2026-07-27' })
    expect(detail(e)).toBe('9 days overdue')
  })

  it('names the service deadline when the view supplied one', () => {
    const e = entry({ id: 'a', title: 'A' })
    const h = health({ entry_id: 'a', sla_breached: true, sla_due_at: '2026-07-26T09:00:00.000Z' })
    expect(detail(e, h)).toBe('service deadline was 26/07/2026')
  })

  it('quotes the newest update only when asked', () => {
    const e = entry({ id: 'a', title: 'A' })
    const lastUpdate = new Map([['a', update('u1', 'a', '  vendor  replied \n today ', '2026-07-28T09:00:00.000Z')]])
    const off = buildDigestModel(rows({ entries: [e], lastUpdate }), options())
    expect(off.tracks[0].sections[0].items[0].note).toBeNull()
    const on = buildDigestModel(
      rows({ entries: [e], lastUpdate }),
      options({ includeNotes: true }),
    )
    expect(on.tracks[0].sections[0].items[0].note).toBe('vendor replied today')
  })
})

describe('the model as a whole', () => {
  const entries = [
    entry({ id: 'c', title: 'Done', status: 'done', closed_at: '2026-07-27T09:00:00.000Z' }),
    entry({ id: 'o', title: 'Late', due_date: '2026-07-20' }),
    entry({ id: 'p', title: 'Moving' }),
  ]

  it('summarises only the sections it emitted, and only the ones with rows', () => {
    const m = buildDigestModel(rows({ entries }), options())
    expect(m.summaryLine).toBe('1 closed · 1 in progress · 1 overdue')
  })

  it('says so when the window is empty', () => {
    const m = buildDigestModel(rows({ entries: [] }), options())
    expect(m.empty).toBe(true)
    expect(m.summaryLine).toBe('Nothing to report in this window.')
    expect(m.tracks).toEqual([])
  })

  it('carries the truncation caveat into the document, or an empty string', () => {
    expect(buildDigestModel(rows({ entries }), options()).strings.truncatedNote).toBe('')
    const clipped = buildDigestModel(rows({ entries, truncated: true }), options())
    expect(clipped.strings.truncatedNote).toContain('1000')
  })

  it('flags exactly the rows that need acting on', () => {
    const blocked = entry({ id: 'b', title: 'Stuck', status: 'blocked' })
    const m = buildDigestModel(rows({ entries: [...entries, blocked] }), options())
    const flagged = m.tracks[0].sections.flatMap((s) => s.items.filter((i) => i.flag).map((i) => i.id))
    expect(flagged.sort()).toEqual(['b', 'o'])
  })

  it('gives an untitled entry a word rather than an empty bullet', () => {
    const m = buildDigestModel(rows({ entries: [entry({ id: 'a', title: '   ' })] }), options())
    expect(m.tracks[0].sections[0].items[0].title).toBe('Untitled')
  })

  it('is deterministic: the same rows and options produce the same model', () => {
    const a = buildDigestModel(rows({ entries }), options())
    const b = buildDigestModel(rows({ entries }), options())
    expect(a).toEqual(b)
  })

  it('keeps CLASSIFY_ORDER and SECTION_ORDER over the same five kinds', () => {
    expect([...CLASSIFY_ORDER].sort()).toEqual([...SECTION_ORDER].sort())
  })
})

describe('locale independence — the Wave-3 gate in miniature', () => {
  const entries = [
    entry({ id: 'c', title: 'Firewall rule DC2', status: 'done', closed_at: '2026-07-28T09:00:00.000Z', owner_id: 'usr-ahmed' }),
    entry({ id: 'o', title: 'ترقية المحوّل', due_date: '2026-07-20', owner_id: 'usr-sara' }),
  ]

  it('renders Arabic from the same rows, with no store and no ambient locale', () => {
    const ar = buildDigestModel(rows({ entries }), options({ locale: 'ar' }))
    expect(ar.dir).toBe('rtl')
    expect(ar.title).toBe('ملخّص الحالة')
    expect(ar.tracks[0].name).toBe('الشبكات')
    expect(ar.tracks[0].sections.map((s) => s.heading)).toEqual(['أُغلقت', 'متأخّرة'])
  })

  it('uses Latin numerals and Gregorian dates in Arabic, per spec §5', () => {
    const ar = buildDigestModel(rows({ entries }), options({ locale: 'ar' }))
    const detail = stripIsolates(ar.tracks[0].sections[1].items[0].detail)
    expect(detail).toBe('متأخّر بـ9 أيام')
    // Intl's ar-u-ca-gregory-nu-latn output carries U+200F between the date's
    // components — its own doing, correct, and stripped here so the assertion is
    // about the CALENDAR and the NUMERALS rather than about bidi punctuation.
    expect(bare(ar.rangeLabel)).toMatch(/23\/07\/2026/)
    // Arabic-Indic digits would mean Intl was constructed without nu-latn.
    expect(ar.rangeLabel).not.toMatch(/[\u0660-\u0669\u06F0-\u06F9]/)
  })

  it('produces the two languages from ONE rows object, unmutated', () => {
    const shared = rows({ entries })
    const en = buildDigestModel(shared, options({ locale: 'en' }))
    const ar = buildDigestModel(shared, options({ locale: 'ar' }))
    expect(en.tracks[0].name).toBe('Network')
    expect(ar.tracks[0].name).toBe('الشبكات')
    expect(shared.entries).toHaveLength(2)
  })

  it('isolates a Latin name inside the Arabic report and leaves the English one bare', () => {
    const ar = buildDigestModel(rows({ entries }), options({ locale: 'ar' }))
    const en = buildDigestModel(rows({ entries }), options({ locale: 'en' }))
    expect(ar.tracks[0].sections[0].items[0].owner).toBe('⁨Ahmed⁩')
    expect(en.tracks[0].sections[0].items[0].owner).toBe('Ahmed')
    // …and the reverse: an Arabic title inside the English report.
    expect(en.tracks[0].sections[1].items[0].title).toBe('⁨ترقية المحوّل⁩')
  })

  it('pins `now` — nothing here reads the wall clock', () => {
    const later = buildDigestModel(
      rows({ entries }),
      options({ now: new Date('2027-01-01T00:00:00.000Z') }),
    )
    const base = buildDigestModel(rows({ entries }), options())
    expect(later.generatedLabel).not.toBe(base.generatedLabel)
    // The window did not move with the clock: `from`/`to` are the report's, and
    // every count is computed against `to`.
    expect(later.totals).toEqual(base.totals)
    expect(NOW.toISOString()).toBe('2026-07-29T09:00:00.000Z')
  })
})
