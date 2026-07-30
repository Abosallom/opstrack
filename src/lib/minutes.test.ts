// Minutes: the model builder and both text renderers.
//
// WHY THIS FILE NEEDS NO MOCKS AT ALL. `lib/minutes.ts` imports two JSON
// namespace files, `lib/dates.ts` and nothing else — no store, no api, no
// React, and (deliberately) not `lib/i18n.ts` at runtime, which reads
// localStorage at module scope and would need a DOM that vitest's `node`
// environment does not have. Every string the builder produces comes from an
// EXPLICIT locale argument, so an Arabic document can be asserted here with no
// global locale to set and nothing to restore afterwards. That property is the
// whole reason the minutes document was split into a pure module and a thin
// page, and these tests are what keeps it true.
//
// TIMEZONE. Every fixture instant is built from LOCAL components
// (`new Date(2026, 6, 29, 14, 5)`) and then serialised, so `14:05` is 14:05 on
// the machine running the suite whatever its zone — the assertions are pinned to
// the wall clock the fixture names, not to UTC. Writing the fixtures as literal
// `…T14:05:00Z` strings instead would make every clock assertion in this file
// fail in Riyadh and pass in London.

import { describe, expect, it } from 'vitest'
import {
  buildMinutes,
  renderMinutes,
  renderMinutesMarkdown,
  renderMinutesPlain,
  sectionForType,
  type MinutesContext,
  type MinutesModel,
} from './minutes'
import arMinutes from '../locales/ar/minutes.json'
import enMinutes from '../locales/en/minutes.json'
import type { Entry, Meeting, MeetingLine, VocabKind } from '../types'
import type { Locale } from './i18n'

/* ────────────────────────────── the fixtures ───────────────────────────── */

const START = new Date(2026, 6, 29, 14, 5).toISOString()
const END = new Date(2026, 6, 29, 15, 10).toISOString()

/** U+2068 / U+2069 — see minutes.ts's bidi block. */
const FSI = '⁨'
const PDI = '⁩'

function stripIsolates(text: string): string {
  return text.replace(/[⁦-⁩]/g, '')
}

const PEOPLE: Readonly<Record<string, string>> = {
  'u-aziz': 'Aziz Alsaloom',
  'u-sara': 'Sara',
  'u-omar': 'عمر',
}

const VOCAB: Readonly<Record<Locale, Readonly<Record<string, string>>>> = {
  en: {
    'status:done': 'Done',
    'status:blocked': 'Blocked',
    'status:cancelled': 'Cancelled',
    'type:issue': 'Issue',
    'type:request': 'Request',
    'priority:high': 'High',
    'priority:critical': 'Critical',
  },
  ar: {
    'status:done': 'منجز',
    'status:blocked': 'محجوب',
    'status:cancelled': 'ملغى',
    'type:issue': 'مشكلة',
    'type:request': 'طلب',
    'priority:high': 'عالية',
    'priority:critical': 'حرجة',
  },
}

const TRACKS: Readonly<Record<string, Readonly<Record<Locale, string>>>> = {
  't-net': { en: 'Networks', ar: 'الشبكات' },
  't-infra': { en: 'Infrastructure', ar: 'البنية التحتية' },
}

function ctx(locale: Locale, over: Partial<MinutesContext> = {}): MinutesContext {
  return {
    locale,
    vocabLabel: (kind: VocabKind, key: string) => VOCAB[locale][`${kind}:${key}`] ?? key,
    personName: (id, fallback) => {
      const named = id === null ? '' : (PEOPLE[id] ?? '')
      if (named !== '') return named
      const free = fallback?.trim() ?? ''
      return free === '' ? null : free
    },
    trackName: (trackId) => (trackId === null ? null : (TRACKS[trackId]?.[locale] ?? null)),
    ...over,
  }
}

function meeting(over: Partial<Meeting> = {}): Meeting {
  return {
    id: 'm-1',
    title: 'Weekly ops sync',
    track_id: 't-net',
    attendees: ['Aziz Alsaloom', 'Sara', 'Aziz Alsaloom', '   '],
    started_at: START,
    ended_at: END,
    notes: 'Vendor call next week.',
    created_by: 'u-aziz',
    ...over,
  }
}

function line(seq: number, over: Partial<MeetingLine> = {}): MeetingLine {
  return {
    id: `l-${seq}`,
    meeting_id: 'm-1',
    seq,
    raw: `line ${seq}`,
    parsed: null,
    state: 'pending',
    entry_id: null,
    created_by: 'u-aziz',
    created_at: START,
    updated_at: START,
    ...over,
  }
}

function entry(over: Partial<Entry> & { id: string }): Entry {
  return {
    track_id: 't-net',
    title: 'An entry',
    description: '',
    type: 'action',
    status: 'new',
    priority: 'medium',
    owner_id: null,
    owner_name: null,
    requester: null,
    due_date: null,
    follow_up_date: null,
    tags: [],
    links: [],
    created_by: 'u-aziz',
    created_at: START,
    updated_at: START,
    closed_at: null,
    last_activity_at: START,
    meeting_id: 'm-1',
    template_id: null,
    ...over,
  }
}

/** The worked example every rendering test below reads from. */
function scenario(locale: Locale = 'en'): MinutesModel {
  const lines: MeetingLine[] = [
    line(1, { state: 'committed', entry_id: 'e-dec', raw: 'we ship on the 3rd' }),
    line(2, { state: 'committed', entry_id: 'e-act', raw: 'sara to fix the tunnel' }),
    line(3, { state: 'discarded', raw: 'ask about the coffee machine' }),
    line(4, { state: 'committed', entry_id: 'e-issue', raw: 'portal latency' }),
    line(5, { state: 'pending', raw: 'check the backup window' }),
    line(6, { state: 'committed', entry_id: 'e-gone', raw: 'rotate the certs' }),
    line(7, { state: 'discarded', raw: '   ' }),
  ]
  const entries: Entry[] = [
    entry({
      id: 'e-dec',
      type: 'decision',
      title: 'Cutover moves to 3 August',
      description: 'The vendor confirmed the window.',
    }),
    entry({
      id: 'e-act',
      type: 'action',
      title: 'Fix the VPN tunnel',
      owner_id: 'u-sara',
      due_date: '2026-08-03',
      priority: 'high',
    }),
    entry({ id: 'e-issue', type: 'issue', title: 'Portal latency spike', status: 'blocked' }),
  ]
  return buildMinutes({ meeting: meeting(), lines, entries }, ctx(locale))
}

function section(m: MinutesModel, kind: string) {
  return m.sections.find((s) => s.kind === kind)
}

/* ──────────────────────────────── header ───────────────────────────────── */

describe('buildMinutes — header', () => {
  it('lays out date, time, track, attendees and recorder in that order', () => {
    const m = scenario()
    expect(m.header.map((f) => f.key)).toEqual([
      'date',
      'time',
      'track',
      'attendees',
      'recordedBy',
    ])
    expect(m.header[0]).toEqual({
      key: 'date',
      label: 'Date',
      parts: ['29 July 2026'],
      sep: '',
      value: '29 July 2026',
    })
    expect(m.header[1]?.value).toBe('14:05 – 15:10')
    expect(m.header[2]?.value).toBe('Networks')
    expect(m.header[4]?.value).toBe('Aziz Alsaloom')
  })

  it('dedupes and trims attendees, keeping the order they were entered', () => {
    const m = scenario()
    expect(m.attendees).toEqual(['Aziz Alsaloom', 'Sara'])
    expect(m.header[3]?.value).toBe('Aziz Alsaloom, Sara')
  })

  it('marks a meeting that has not ended instead of inventing an end time', () => {
    const m = buildMinutes({ meeting: meeting({ ended_at: null }), lines: [], entries: [] }, ctx('en'))
    expect(m.header[1]?.value).toBe('14:05 · still running')
  })

  it('omits a field rather than rendering an empty one', () => {
    const m = buildMinutes(
      {
        meeting: meeting({ track_id: null, attendees: ['  ', ''], created_by: null }),
        lines: [],
        entries: [],
      },
      ctx('en'),
    )
    expect(m.header.map((f) => f.key)).toEqual(['date', 'time'])
    expect(m.attendees).toEqual([])
  })

  it('drops the date and time when the meeting timestamp is unusable', () => {
    const m = buildMinutes(
      { meeting: meeting({ started_at: 'not-a-date', ended_at: null }), lines: [], entries: [] },
      ctx('en'),
    )
    expect(m.header.map((f) => f.key)).not.toContain('date')
    expect(m.header.map((f) => f.key)).not.toContain('time')
    expect(m.isoDate).toBe('')
  })

  it('falls back to a localized title when the meeting was never named', () => {
    expect(buildMinutes({ meeting: meeting({ title: '  ' }), lines: [], entries: [] }, ctx('en')).title).toBe(
      'Untitled meeting',
    )
    expect(buildMinutes({ meeting: meeting({ title: '' }), lines: [], entries: [] }, ctx('ar')).title).toBe(
      'اجتماع بلا عنوان',
    )
  })

  it('collapses a newline inside a title so it cannot break the document', () => {
    const m = buildMinutes(
      { meeting: meeting({ title: 'Weekly\n  ops   sync' }), lines: [], entries: [] },
      ctx('en'),
    )
    expect(m.title).toBe('Weekly ops sync')
  })
})

/* ─────────────────────────── order and bucketing ───────────────────────── */

describe('buildMinutes — bands', () => {
  it('routes each entry type to its band', () => {
    expect(sectionForType('decision')).toBe('decisions')
    expect(sectionForType('action')).toBe('actions')
    for (const t of ['issue', 'request', 'change', 'escalation', 'note'] as const) {
      expect(sectionForType(t)).toBe('items')
    }
  })

  it('emits only non-empty bands, in document order', () => {
    expect(scenario().sections.map((s) => s.kind)).toEqual([
      'decisions',
      'actions',
      'items',
      'notes',
      'untriaged',
    ])
  })

  it('keeps the transcript order, not the entry creation order', () => {
    const lines = [
      line(2, { state: 'committed', entry_id: 'e-b' }),
      line(1, { state: 'committed', entry_id: 'e-a' }),
    ]
    const entries = [
      entry({ id: 'e-a', title: 'said first', created_at: new Date(2026, 6, 29, 16).toISOString() }),
      entry({ id: 'e-b', title: 'said second', created_at: new Date(2026, 6, 29, 9).toISOString() }),
    ]
    const m = buildMinutes({ meeting: meeting(), lines, entries }, ctx('en'))
    expect(section(m, 'actions')?.items.map((i) => i.text)).toEqual(['said first', 'said second'])
  })

  it('appends entries with no line behind them after the transcript, oldest first', () => {
    const lines = [line(1, { state: 'committed', entry_id: 'e-1' })]
    const entries = [
      entry({ id: 'e-3', title: 'later', created_at: new Date(2026, 6, 29, 18).toISOString() }),
      entry({ id: 'e-2', title: 'loose', created_at: new Date(2026, 6, 29, 17).toISOString() }),
      entry({ id: 'e-1', title: 'from the transcript' }),
    ]
    const m = buildMinutes({ meeting: meeting(), lines, entries }, ctx('en'))
    expect(section(m, 'actions')?.items.map((i) => i.text)).toEqual([
      'from the transcript',
      'loose',
      'later',
    ])
  })

  it('breaks a created_at tie on the id, so two rows never swap between renders', () => {
    const entries = [entry({ id: 'e-z', title: 'zed' }), entry({ id: 'e-a', title: 'ay' })]
    const first = buildMinutes({ meeting: meeting(), lines: [], entries }, ctx('en'))
    const second = buildMinutes(
      { meeting: meeting(), lines: [], entries: [...entries].reverse() },
      ctx('en'),
    )
    expect(section(first, 'actions')?.items.map((i) => i.key)).toEqual(['e-a', 'e-z'])
    expect(section(second, 'actions')?.items.map((i) => i.key)).toEqual(['e-a', 'e-z'])
  })

  it('renders a committed line whose entry is missing rather than dropping it', () => {
    const m = scenario()
    const items = section(m, 'items')?.items ?? []
    expect(items.map((i) => i.text)).toEqual(['Portal latency spike', 'rotate the certs'])
    // It still links: the entry exists, this render just does not have the row.
    expect(items[1]?.entryId).toBe('e-gone')
    expect(items[1]?.meta).toEqual([])
  })

  it('keeps discarded lines as notes and pending lines as untriaged', () => {
    const m = scenario()
    expect(section(m, 'notes')?.items.map((i) => i.text)).toEqual(['ask about the coffee machine'])
    expect(section(m, 'untriaged')?.items.map((i) => i.text)).toEqual(['check the backup window'])
  })

  it('drops a line that carries no text at all', () => {
    const m = scenario()
    expect(section(m, 'notes')?.items).toHaveLength(1)
  })

  it('does not mutate the arrays it was handed', () => {
    const lines = [line(3), line(1), line(2)]
    const entries = [entry({ id: 'e-b' }), entry({ id: 'e-a' })]
    buildMinutes({ meeting: meeting(), lines, entries }, ctx('en'))
    expect(lines.map((l) => l.seq)).toEqual([3, 1, 2])
    expect(entries.map((e) => e.id)).toEqual(['e-b', 'e-a'])
  })

  it('reports a meeting with nothing in it as empty, with a localized line', () => {
    const bare = meeting({ notes: '' })
    const en = buildMinutes({ meeting: bare, lines: [], entries: [] }, ctx('en'))
    expect(en.empty).toBe(true)
    expect(en.emptyText).toBe('No items were captured in this meeting.')
    expect(buildMinutes({ meeting: bare, lines: [], entries: [] }, ctx('ar')).emptyText).toBe(
      'لم تُسجَّل أي بنود في هذا الاجتماع.',
    )
  })

  it('is not empty when the only content is the closing note', () => {
    const m = buildMinutes({ meeting: meeting({ notes: ' Vendor call. ' }), lines: [], entries: [] }, ctx('en'))
    expect(m.empty).toBe(false)
    expect(m.closingNotes).toBe('Vendor call.')
  })
})

/* ───────────────────────────────── meta ────────────────────────────────── */

describe('buildMinutes — item meta', () => {
  function metaOf(e: Partial<Entry> & { id: string }, locale: Locale = 'en') {
    const m = buildMinutes({ meeting: meeting(), lines: [], entries: [entry(e)] }, ctx(locale))
    const item = m.sections.flatMap((s) => s.items).find((i) => i.key === e.id)
    return (item?.meta ?? []).map((x) => `${x.label}: ${x.value}`)
  }

  it('names the owner of an action, and says so out loud when there is none', () => {
    expect(metaOf({ id: 'e', owner_id: 'u-sara' })).toContain('Owner: Sara')
    expect(metaOf({ id: 'e' })).toContain('Owner: Unassigned')
  })

  it('uses the free-text owner when the entry has no member behind it', () => {
    expect(metaOf({ id: 'e', owner_name: 'Vendor NOC' })).toContain('Owner: Vendor NOC')
  })

  it('leaves a decision unowned rather than stamping Unassigned on the room', () => {
    expect(metaOf({ id: 'e', type: 'decision' })).toEqual([])
  })

  it('shows the due date through lib/dates, never a raw column value', () => {
    expect(metaOf({ id: 'e', due_date: '2026-08-03' })).toContain('Due: 03/08/2026')
  })

  it('mentions status only once it has moved off new', () => {
    expect(metaOf({ id: 'e', status: 'new' }).join()).not.toContain('Status')
    expect(metaOf({ id: 'e', status: 'blocked' })).toContain('Status: Blocked')
  })

  it('mentions priority only when it is loud', () => {
    expect(metaOf({ id: 'e', priority: 'low' }).join()).not.toContain('Priority')
    expect(metaOf({ id: 'e', priority: 'medium' }).join()).not.toContain('Priority')
    expect(metaOf({ id: 'e', priority: 'high' })).toContain('Priority: High')
    expect(metaOf({ id: 'e', priority: 'critical' })).toContain('Priority: Critical')
  })

  it("names the track only when it is not the meeting's own", () => {
    expect(metaOf({ id: 'e', track_id: 't-net' }).join()).not.toContain('Track')
    expect(metaOf({ id: 'e', track_id: 't-infra' })).toContain('Track: Infrastructure')
    // A track the resolver cannot name (archived, deleted) adds nothing.
    expect(metaOf({ id: 'e', track_id: 't-gone' }).join()).not.toContain('Track')
  })

  it('labels the type of anything in the Other items band', () => {
    expect(metaOf({ id: 'e', type: 'issue' })).toContain('Type: Issue')
    expect(metaOf({ id: 'e', type: 'action' }).join()).not.toContain('Type')
  })

  it('resolves every label through the caller, in the requested locale', () => {
    expect(metaOf({ id: 'e', type: 'issue', owner_id: 'u-omar', status: 'done' }, 'ar')).toEqual([
      'النوع: مشكلة',
      'المسؤول: عمر',
      'الحالة: منجز',
    ])
  })

  it('carries the done and cancelled flags off the frozen status keys', () => {
    const m = buildMinutes(
      {
        meeting: meeting(),
        lines: [],
        // Ids ordered so the assertion reads in the same order as the list —
        // loose entries tie on created_at here and fall through to the id.
        entries: [
          entry({ id: 'e-1-open', status: 'in_progress' }),
          entry({ id: 'e-2-done', status: 'done' }),
          entry({ id: 'e-3-cancelled', status: 'cancelled' }),
        ],
      },
      ctx('en'),
    )
    const items = section(m, 'actions')?.items ?? []
    expect(items.map((i) => [i.key, i.done, i.cancelled])).toEqual([
      ['e-1-open', false, false],
      ['e-2-done', true, false],
      ['e-3-cancelled', false, true],
    ])
  })

  it('keeps the description as the item detail, newlines normalised', () => {
    const m = buildMinutes(
      {
        meeting: meeting(),
        lines: [],
        entries: [entry({ id: 'e', description: '  first\r\nsecond  ' })],
      },
      ctx('en'),
    )
    expect(section(m, 'actions')?.items[0]?.detail).toBe('first\nsecond')
  })
})

/* ─────────────────────────────── markdown ──────────────────────────────── */

describe('renderMinutesMarkdown', () => {
  it('opens with the title and a one-field-per-line header list', () => {
    const md = renderMinutesMarkdown(scenario())
    expect(md.startsWith('# Weekly ops sync\n')).toBe(true)
    expect(md).toContain('- **Date:** 29 July 2026')
    expect(md).toContain('- **Attendees:** Aziz Alsaloom, Sara')
  })

  it('counts each band in its heading', () => {
    const md = renderMinutesMarkdown(scenario())
    expect(md).toContain('## Decisions (1)')
    expect(md).toContain('## Other items (2)')
  })

  it('numbers decisions and renders actions as a task list', () => {
    const md = renderMinutesMarkdown(scenario())
    expect(md).toContain('1. Cutover moves to 3 August')
    expect(md).toContain('- [ ] Fix the VPN tunnel — **Owner**: Sara'.replace('**Owner**', 'Owner'))
    expect(md).toContain('Owner: Sara · Due: 03/08/2026 · Priority: High')
  })

  it('checks a done action and strikes a cancelled one without deleting it', () => {
    const m = buildMinutes(
      {
        meeting: meeting(),
        lines: [],
        entries: [
          entry({ id: 'e-1', title: 'Rotate the certs', status: 'done', owner_id: 'u-sara' }),
          entry({ id: 'e-2', title: 'Order the switch', status: 'cancelled', owner_id: 'u-sara' }),
        ],
      },
      ctx('en'),
    )
    const md = renderMinutesMarkdown(m)
    expect(md).toContain('- [x] Rotate the certs — Owner: Sara · Status: Done')
    expect(md).toContain('- [x] ~~Order the switch~~ — Owner: Sara · Status: Cancelled')
  })

  it('aligns the description under its own item text, marker by marker', () => {
    // `1. ` is three columns wide, `- [ ] ` measures as `- ` at two: a fixed
    // indent dedents one of the two out of its bullet in every strict parser.
    const md = renderMinutesMarkdown(scenario())
    expect(md).toContain('\n1. Cutover moves to 3 August\n   The vendor confirmed the window.')

    const task = renderMinutesMarkdown(
      buildMinutes(
        {
          meeting: meeting(),
          lines: [],
          entries: [entry({ id: 'e', title: 'Fix it', description: 'why', owner_id: 'u-sara' })],
        },
        ctx('en'),
      ),
    )
    expect(task).toContain('\n- [ ] Fix it — Owner: Sara\n  why')
  })

  it('escapes the Markdown that a free-text title can contain', () => {
    const m = buildMinutes(
      {
        meeting: meeting({ title: 'Sync **now**' }),
        lines: [],
        entries: [entry({ id: 'e', title: 'Fix _auth_ [urgent] `now` #2' })],
      },
      ctx('en'),
    )
    const md = renderMinutesMarkdown(m)
    expect(md).toContain('# Sync \\*\\*now\\*\\*')
    expect(md).toContain('Fix \\_auth\\_ \\[urgent\\] \\`now\\` \\#2')
  })

  it('renders the closing notes as their own band', () => {
    const md = renderMinutesMarkdown(scenario())
    expect(md).toContain('## Closing notes')
    expect(md).toContain('Vendor call next week.')
  })

  it('says so when there is nothing to write up', () => {
    const md = renderMinutesMarkdown(
      buildMinutes({ meeting: meeting({ notes: '' }), lines: [], entries: [] }, ctx('en')),
    )
    expect(md).toContain('No items were captured in this meeting.')
    expect(md).not.toContain('##')
  })
})

/* ───────────────────────────────── plain ───────────────────────────────── */

describe('renderMinutesPlain', () => {
  it('carries no Markdown syntax at all', () => {
    const text = renderMinutesPlain(scenario())
    expect(text).not.toMatch(/^#/m)
    expect(text).not.toContain('**')
    expect(text).not.toContain('- [ ]')
    expect(text).not.toContain('~~')
    expect(text).not.toContain('\\')
  })

  it('states the header as plain label/value lines', () => {
    const text = renderMinutesPlain(scenario())
    expect(text.startsWith('Weekly ops sync\nDate: 29 July 2026\nTime: 14:05 – 15:10\n')).toBe(true)
  })

  it('signals structure with indentation, which mirrors in both directions', () => {
    const text = renderMinutesPlain(scenario())
    expect(text).toContain('\nDecisions (1)\n  1. Cutover moves to 3 August')
    expect(text).toContain('\n     The vendor confirmed the window.')
    expect(text).toContain('\n  • ask about the coffee machine')
  })

  it('keeps a cancelled item visible, marked by its status', () => {
    const m = buildMinutes(
      {
        meeting: meeting(),
        lines: [],
        entries: [
          entry({ id: 'e', title: 'Order the switch', status: 'cancelled', owner_id: 'u-sara' }),
        ],
      },
      ctx('en'),
    )
    expect(renderMinutesPlain(m)).toContain('1. Order the switch — Owner: Sara · Status: Cancelled')
  })

  it('ends with exactly one trailing newline, so a paste has no dangling blank', () => {
    const text = renderMinutesPlain(scenario())
    expect(text.endsWith('\n')).toBe(true)
    expect(text.endsWith('\n\n')).toBe(false)
  })
})

describe('renderMinutes', () => {
  it('dispatches on the format', () => {
    const m = scenario()
    expect(renderMinutes(m, 'markdown')).toBe(renderMinutesMarkdown(m))
    expect(renderMinutes(m, 'plain')).toBe(renderMinutesPlain(m))
  })
})

/* ──────────────────────────────── Arabic ───────────────────────────────── */

describe('an Arabic minutes document', () => {
  it('reads in Arabic while nothing global was switched', () => {
    const md = stripIsolates(renderMinutesMarkdown(scenario('ar')))
    expect(md).toContain('التاريخ:')
    expect(md).toContain('## القرارات (1)')
    expect(md).toContain('## الإجراءات (1)')
    expect(md).toContain('## ملاحظات (1)')
    expect(md).toContain('## ملاحظات ختامية')
    expect(md).toContain('المسؤول: Sara')
  })

  it('sets the document direction from the locale', () => {
    expect(scenario('en').dir).toBe('ltr')
    expect(scenario('ar').dir).toBe('rtl')
  })

  it('fences every interpolated value so a Latin name or a date cannot jump ends', () => {
    const text = renderMinutesPlain(scenario('ar'))
    expect(text).toContain(`${FSI}Sara${PDI}`)
    expect(text).toContain(`${FSI}Weekly ops sync${PDI}`)
    // The due date is digits only — bidi-WEAK, and the run that misplaces
    // itself most often. It is fenced too.
    expect(text).toMatch(/⁨[\d‏/]+⁩/)
  })

  it('leaves an all-English document free of invisible characters', () => {
    const text = renderMinutesPlain(scenario('en')) + renderMinutesMarkdown(scenario('en'))
    expect(text).not.toMatch(/[⁦-⁩]/)
  })

  it('fences an Arabic value inside an English document', () => {
    const m = buildMinutes(
      { meeting: meeting(), lines: [], entries: [entry({ id: 'e', owner_id: 'u-omar' })] },
      ctx('en'),
    )
    expect(renderMinutesPlain(m)).toContain(`Owner: ${FSI}عمر${PDI}`)
  })

  it('joins attendees with an Arabic comma', () => {
    const m = scenario('ar')
    expect(m.header.find((f) => f.key === 'attendees')?.value).toBe('Aziz Alsaloom، Sara')
  })

  it('fences attendees ONE BY ONE, so a list of Latin names keeps its order', () => {
    // Fencing the joined string would leave the Arabic commas inside the
    // isolate, where they still take RTL and still swap the names around them.
    expect(renderMinutesPlain(scenario('ar'))).toContain(
      `${FSI}Aziz Alsaloom${PDI}، ${FSI}Sara${PDI}`,
    )
  })

  it('fences a whole-line paragraph only when it runs against the document', () => {
    const md = renderMinutesMarkdown(scenario('ar'))
    // An English description inside an Arabic document: unfenced, its final
    // full stop is handed to the paragraph and parks itself at the far end.
    expect(md).toContain(`${FSI}The vendor confirmed the window.${PDI}`)
    // An Arabic heading in an Arabic document has no such hazard, and pays no
    // invisible characters for it.
    expect(md).toContain('\n## القرارات (1)\n')
  })

  it('leaves same-direction whole-line content unfenced in English too', () => {
    expect(renderMinutesMarkdown(scenario('en'))).toContain('\n## Decisions (1)\n')
  })

  it('still writes Latin numerals and a 24-hour clock, per spec §5', () => {
    const m = scenario('ar')
    expect(m.header.find((f) => f.key === 'time')?.value).toBe('14:05 – 15:10')
    expect(m.header.find((f) => f.key === 'date')?.value).toContain('2026')
  })
})

/* ───────────────────────── the namespace, locally ──────────────────────── */
//
// `src/lib/localeParity.test.ts` and `localeReach.test.ts` check every
// namespace REGISTERED in `src/locales/index.ts` — an integrator-owned file
// (§1.0.2) this worker may not edit, so until the Wave-3 integrator adds two
// imports there, `minutes` is invisible to both gates. These three checks stand
// in for them meanwhile, on the two files this worker DOES own. They stay
// afterwards: they cost nothing and they are the reason a gap in this namespace
// fails on the worker's own machine rather than in the integration pass — which
// is the exact failure localeReach.test.ts's header was written about.

describe('the minutes namespace', () => {
  function flatten(tree: unknown, prefix = '', out: Map<string, string> = new Map()) {
    if (typeof tree === 'string') {
      out.set(prefix, tree)
      return out
    }
    if (typeof tree === 'object' && tree !== null) {
      for (const [k, v] of Object.entries(tree)) flatten(v, prefix ? `${prefix}.${k}` : k, out)
    }
    return out
  }

  const EN = flatten(enMinutes)
  const AR = flatten(arMinutes)

  it('holds one root per file, and it is the file basename', () => {
    expect(Object.keys(enMinutes)).toEqual(['minutes'])
    expect(Object.keys(arMinutes)).toEqual(['minutes'])
  })

  it('is at exact parity, with no empty value on either side', () => {
    expect([...AR.keys()].sort()).toEqual([...EN.keys()].sort())
    for (const [key, value] of [...EN, ...AR]) expect(value.trim(), key).not.toBe('')
  })

  it('carries the same {token} set per key in both languages', () => {
    const tokens = (v: string) => [...v.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort()
    for (const [key, value] of EN) expect(tokens(AR.get(key) ?? ''), key).toEqual(tokens(value))
  })

  it('answers every key this worker’s two files ask for', () => {
    // Same technique as localeReach.test.ts: scan the SOURCE for quoted dotted
    // strings rather than for `t('…')`, because the keys here live in Record
    // literals a call-shape regex would never see.
    const sources: Record<string, string> = {
      ...import.meta.glob('./minutes.ts', { query: '?raw', import: 'default', eager: true }),
      ...import.meta.glob('../pages/meetings/MeetingMinutes.tsx', {
        query: '?raw',
        import: 'default',
        eager: true,
      }),
    }
    const asked = new Set<string>()
    for (const text of Object.values(sources)) {
      for (const match of text.matchAll(/['"`](minutes\.[A-Za-z][\w.]*)['"`]/g)) {
        asked.add(match[1])
      }
    }
    expect(asked.size).toBeGreaterThan(10)
    for (const key of [...asked].sort()) {
      expect(EN.has(key), `${key} missing from en/minutes.json`).toBe(true)
      expect(AR.has(key), `${key} missing from ar/minutes.json`).toBe(true)
    }
  })
})
