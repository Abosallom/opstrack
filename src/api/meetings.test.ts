// The meeting line's serialization boundary.
//
// WHY THESE FOUR FUNCTIONS AND NOTHING ELSE. Every other function in
// api/meetings.ts is a PostgREST call, and testing those means mocking the
// client — which proves the mock matches the mock. These four are pure, they
// are the entire contract between the parser, the `parsed` jsonb column and the
// entry a commit creates, and they are the one place in meeting mode where a
// silent drift produces WRONG data rather than a visible failure:
//
//  · `planFromParsed` is the only thing that turns "what the parser understood"
//    into "what triage will show". Lose a field here and the dropdown opens
//    empty with no error anywhere.
//  · `decodePlan` reads a jsonb column with NO shape constraint, written by
//    whatever build was deployed the day the meeting happened. It has to be
//    total for any input, including inputs that are not objects at all.
//  · `planToJson` and `decodePlan` are an encode/decode pair, and a pair that
//    is not round-trip tested is a pair that drifts the first time a field is
//    added to one side.
//  · `planToNewEntry` writes the row Postgres will accept or reject: the owner
//    XOR (`entries_single_owner`) and the meeting link are both enforced there
//    and invisible here without a test.
//
// Vitest imports are explicit — no globals config, and nothing is added to
// tsconfig.app.json's `types` array.

import { describe, expect, it } from 'vitest'
import {
  PLAN_DEFAULTS,
  decodePlan,
  emptyLineCounts,
  planFromParsed,
  planToJson,
  planToNewEntry,
  type LinePlan,
} from './meetings'
import { parse, type ParseContext, type ParsedEntry } from '../lib/capture/parse'

/**
 * The seeded tracks and two members, verbatim from 0001/0004 — the same fixture
 * list parse.test.ts uses, because a plan built against invented track names
 * would pass here and resolve nothing in the live app.
 */
const CTX: ParseContext = {
  tracks: [
    { id: 't-pmo', name: 'PMO', nameAr: 'مكتب إدارة المشاريع' },
    { id: 't-ito', name: 'IT Operations', nameAr: 'عمليات تقنية المعلومات' },
    { id: 't-net', name: 'Network', nameAr: 'الشبكات' },
    { id: 't-inf', name: 'Infrastructure', nameAr: 'البنية التحتية' },
    { id: 't-sre', name: 'SRE', nameAr: 'هندسة موثوقية الأنظمة' },
    { id: 't-onb', name: 'Onboarding', nameAr: 'الانضمام' },
  ],
  members: [
    { id: 'm-ahmed', displayName: 'Ahmed Al-Otaibi' },
    { id: 'm-sara', displayName: 'Sara Nasser' },
  ],
  // 2026-07-29 is a Wednesday — the same anchor the parser's own worked
  // examples use, so a date assertion here means the same thing it means there.
  now: new Date('2026-07-29T09:00:00Z'),
  locale: 'en',
}

const BLANK: ParsedEntry = {
  title: '',
  trackId: null,
  ownerId: null,
  ownerName: null,
  priority: null,
  type: null,
  dueDate: null,
  followUpDate: null,
  tags: [],
  recurrence: null,
  tokens: [],
  problems: [],
  isEmpty: true,
}

describe('planFromParsed', () => {
  it('fills type and priority with the capture defaults when the line said nothing', () => {
    const plan = planFromParsed({ ...BLANK, title: 'Chase the vendor', isEmpty: false })
    expect(plan.type).toBe(PLAN_DEFAULTS.type)
    expect(plan.priority).toBe(PLAN_DEFAULTS.priority)
    expect(plan.trackId).toBeNull()
    expect(plan.ownerId).toBeNull()
    expect(plan.ownerName).toBeNull()
    expect(plan.tags).toEqual([])
  })

  it('carries every field the parser resolved', () => {
    const parsed = parse('Firewall rule DC2 #network @ahmed !high due:thu +urgent /issue', CTX)
    const plan = planFromParsed(parsed)
    expect(plan.title).toBe('Firewall rule DC2')
    expect(plan.trackId).toBe('t-net')
    expect(plan.ownerId).toBe('m-ahmed')
    expect(plan.priority).toBe('high')
    expect(plan.type).toBe('issue')
    expect(plan.dueDate).toBe('2026-07-30')
    expect(plan.tags).toEqual(['urgent'])
  })

  it('resolves the owner XOR the database enforces', () => {
    // The parser can produce both halves when a free-text name later matches a
    // teammate; entries_single_owner (0001) rejects a row carrying both.
    const plan = planFromParsed({
      ...BLANK,
      title: 'Vendor call',
      isEmpty: false,
      ownerId: 'm-sara',
      ownerName: 'Sara from Acme',
    })
    expect(plan.ownerId).toBe('m-sara')
    expect(plan.ownerName).toBeNull()
  })

  it('keeps a free-text owner when there is no id', () => {
    const parsed = parse('Portal access @Fatimah', CTX)
    const plan = planFromParsed(parsed)
    expect(plan.ownerId).toBeNull()
    expect(plan.ownerName).toBe('Fatimah')
  })

  it('DROPS a recurrence rather than turning a template into an entry', () => {
    // `every:weekly` describes a recurring template. toNewEntry() refuses to
    // build an entry from one; a triage table that silently did would file the
    // wrong row in the wrong table. The words stay in the title.
    const parsed = parse('Weekly network capacity review #network every:weekly', CTX)
    expect(parsed.recurrence).not.toBeNull()
    const plan = planFromParsed(parsed)
    expect(plan.title).toBe('Weekly network capacity review')
    expect(plan.trackId).toBe('t-net')
  })
})

describe('decodePlan', () => {
  it('falls back to the raw line when the column holds nothing', () => {
    const plan = decodePlan(null, '  Follow up with the vendor  ')
    expect(plan.title).toBe('Follow up with the vendor')
    expect(plan.type).toBe(PLAN_DEFAULTS.type)
    expect(plan.priority).toBe(PLAN_DEFAULTS.priority)
  })

  it('is total for values that are not objects at all', () => {
    // jsonb accepts scalars and arrays. A line written by a build that stored
    // something else must not crash the triage table months later.
    for (const junk of [42, 'a string', true, [1, 2, 3], undefined]) {
      expect(() => decodePlan(junk, 'raw')).not.toThrow()
      expect(decodePlan(junk, 'raw').title).toBe('raw')
    }
  })

  it('drops non-string tags rather than rendering them', () => {
    const plan = decodePlan({ title: 'x', tags: ['ok', 7, null, 'fine'] }, 'raw')
    expect(plan.tags).toEqual(['ok', 'fine'])
  })

  it('drops a tags value that is not an array', () => {
    expect(decodePlan({ title: 'x', tags: 'portal' }, 'raw').tags).toEqual([])
  })

  it('resolves the owner XOR on the way out too', () => {
    const plan = decodePlan({ title: 'x', ownerId: 'm-sara', ownerName: 'Sara' }, 'raw')
    expect(plan.ownerId).toBe('m-sara')
    expect(plan.ownerName).toBeNull()
  })

  it('treats an empty string as absent, not as a value', () => {
    // Every one of these columns is nullable and '' is not a legal track id, a
    // legal date or a person's name.
    const plan = decodePlan({ title: '', trackId: '', dueDate: '', ownerName: '' }, 'raw line')
    expect(plan.title).toBe('raw line')
    expect(plan.trackId).toBeNull()
    expect(plan.dueDate).toBeNull()
    expect(plan.ownerName).toBeNull()
  })
})

describe('planToJson / decodePlan round trip', () => {
  it('returns an identical plan', () => {
    const plan: LinePlan = {
      title: 'Rebuild the jump host',
      trackId: 't-inf',
      type: 'change',
      priority: 'critical',
      ownerId: 'm-ahmed',
      ownerName: null,
      dueDate: '2026-08-14',
      followUpDate: '2026-08-01',
      tags: ['portal', 'direct-integration'],
    }
    expect(decodePlan(planToJson(plan), 'unused')).toEqual(plan)
  })

  it('survives the free-text owner branch', () => {
    const plan: LinePlan = {
      title: 'Vendor to confirm the window',
      trackId: null,
      type: 'request',
      priority: 'low',
      ownerId: null,
      ownerName: 'Fatimah',
      dueDate: null,
      followUpDate: null,
      tags: [],
    }
    expect(decodePlan(planToJson(plan), 'unused')).toEqual(plan)
  })
})

describe('planToNewEntry', () => {
  const plan: LinePlan = {
    title: 'Order the transceivers',
    trackId: 't-net',
    type: 'action',
    priority: 'high',
    ownerId: null,
    ownerName: 'Acme',
    dueDate: '2026-08-03',
    followUpDate: null,
    tags: ['portal'],
  }

  it('links the entry to the meeting it came out of', () => {
    expect(planToNewEntry(plan, 'meet-1').meetingId).toBe('meet-1')
  })

  it("sends '' for the description, never null", () => {
    // `entries.description` is `not null default ''`; `?? null` there is a
    // guaranteed 23502 on every create (plan §2.4 correction 1).
    expect(planToNewEntry(plan, 'meet-1').description).toBe('')
  })

  it('never sets a status — a meeting line starts at the default, like a capture', () => {
    expect(planToNewEntry(plan, 'meet-1').status).toBeUndefined()
  })

  it('clears the free-text owner when a teammate is set', () => {
    const row = planToNewEntry({ ...plan, ownerId: 'm-sara' }, 'meet-1')
    expect(row.ownerId).toBe('m-sara')
    expect(row.ownerName).toBeNull()
  })
})

describe('emptyLineCounts', () => {
  it('is all zeroes and a FRESH object each call', () => {
    const a = emptyLineCounts()
    expect(a).toEqual({ total: 0, pending: 0, note: 0, discarded: 0, committed: 0 })
    // listLineCounts accumulates into these; a shared instance would make every
    // meeting in the list report the sum of all of them.
    a.total = 5
    expect(emptyLineCounts().total).toBe(0)
  })
})
