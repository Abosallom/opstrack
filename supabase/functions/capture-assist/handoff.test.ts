// The handoff: what the edge validator approves must survive the client one.
//
// ═══ WHY THIS IS NOT THE "DRIFT TEST" IT WAS ASKED TO BE ═══
//
// `capture-assist/index.ts:535-540` calls `validateProposal()` *"a deliberate
// duplicate of src/lib/ai/validate.ts"* and asks for the two to be kept in step
// by hand. Read side by side, THEY ARE NOT DUPLICATES and a test that ran one
// fixture table through both would fail for reasons that are not defects:
//
//   * the edge reads the MODEL's tool arguments — `track_id`, `owner_id`,
//     `due_date`, `follow_up_date`, snake_case, plus `confidence`;
//   * the client reads the EDGE's reply — `trackId`, `ownerId`, `dueDate`,
//     `followUpDate`, camelCase, plus `tags`, and no `confidence` at all.
//
// They are two links of one chain, not two copies of one link. So the contract
// worth pinning is the HANDOFF: everything `validateProposal()` approves must
// still be there after `validate()` has had its turn, and everything it refused
// must stay refused. That is the property an attacker breaks by calling the
// endpoint directly — they meet only the first link — and the property a
// careless edit breaks by renaming a field on one side.
//
// The second thing this file pins is the ASYMMETRY, which is deliberate and
// worth keeping: the client knows two things the edge cannot. It knows whether
// a real track can be SELECTED by a `#token` at all, and it knows the browser's
// clock. A track that exists but is unaddressable is approved by the edge and
// correctly refused here.

import { describe, expect, it } from 'vitest'

import { validate } from '../../../src/lib/ai/validate'
import type { AiContext } from '../../../src/lib/ai/types'
import { validateProposal, type AssistContext } from './index.ts'

/* ───────────────────── one workspace, expressed twice ──────────────────── */

const TRACK_INFRA = '11111111-1111-4111-8111-111111111111'
const TRACK_DEV = '22222222-2222-4222-8222-222222222222'
const MEMBER_NASSER = '33333333-3333-4333-8333-333333333333'
const MEMBER_SARA = '44444444-4444-4444-8444-444444444444'

const TRACKS = [
  { id: TRACK_INFRA, name: 'Infrastructure', nameAr: 'البنية التحتية' },
  { id: TRACK_DEV, name: 'Dev', nameAr: 'التطوير' },
]
const MEMBERS = [
  { id: MEMBER_NASSER, displayName: 'Nasser Alabri', username: 'nasser' },
  { id: MEMBER_SARA, displayName: 'Sara Qahtani', username: 'sara' },
]

/** The date both sides are judged against. Injected on both sides, never read
 *  from a clock: "not in the past" has to be testable without waiting a day. */
const NOW = new Date('2026-08-01T09:00:00Z')
const TODAY = '2026-08-01'

const edgeCtx: AssistContext = {
  tracks: TRACKS,
  members: MEMBERS,
  types: ['action', 'decision', 'issue', 'request', 'change', 'note'],
  priorities: ['low', 'medium', 'high', 'critical'],
  labels: {},
  today: TODAY,
  locale: 'en',
}

const clientCtx: AiContext = {
  tracks: TRACKS,
  members: MEMBERS,
  now: NOW,
  locale: 'en',
}

const LINE = 'sprint 38 deployment next friday for nasser'

/** The whole chain, exactly as `store/ai.ts:437-446` runs it: the edge's reply
 *  goes over the wire as JSON and is re-validated as `unknown`. */
function chain(modelSaid: Record<string, unknown>): {
  edge: ReturnType<typeof validateProposal>
  client: ReturnType<typeof validate>
} {
  const edge = validateProposal(modelSaid, edgeCtx, LINE)
  const overWire: unknown = JSON.parse(JSON.stringify(edge))
  return { edge, client: validate(overWire, clientCtx) }
}

/* ─────────────────── everything approved must survive ──────────────────── */

describe('the handoff — what the edge approves, the client keeps', () => {
  it('carries title, track, owner, type, priority and both dates through intact', () => {
    const { edge, client } = chain({
      title: 'sprint 38 deployment',
      track_id: TRACK_DEV,
      owner_id: MEMBER_NASSER,
      type: 'change',
      priority: 'high',
      due_date: '2026-08-07',
      follow_up_date: '2026-08-05',
      confidence: 'high',
    })

    expect(edge.dropped).toEqual([])
    expect(client.title).toBe(edge.title)
    expect(client.trackId).toBe(edge.trackId)
    expect(client.ownerId).toBe(edge.ownerId)
    expect(client.type).toBe(edge.type)
    expect(client.priority).toBe(edge.priority)
    expect(client.dueDate).toBe(edge.dueDate)
    expect(client.followUpDate).toBe(edge.followUpDate)
  })

  it('agrees on today — the two clocks must not straddle a date boundary', () => {
    const { edge, client } = chain({ due_date: TODAY })
    expect(edge.dueDate).toBe(TODAY)
    expect(client.dueDate).toBe(TODAY)
  })

  it('keeps a suggestion that is nothing but a title', () => {
    const { edge, client } = chain({ title: 'sprint 38' })
    expect(edge.title).toBe('sprint 38')
    expect(client.title).toBe('sprint 38')
    expect(client.trackId).toBeNull()
  })
})

/* ───────────────── everything refused must stay refused ────────────────── */

describe('the handoff — what the edge refuses can never reappear', () => {
  const attacks: Array<[string, Record<string, unknown>]> = [
    ['a hallucinated track', { track_id: '99999999-9999-4999-8999-999999999999' }],
    ['an invented owner', { owner_id: '55555555-5555-4555-8555-555555555555' }],
    ['a past due date', { due_date: '2020-01-01' }],
    ['a date that is not a calendar day', { due_date: '2026-09-31' }],
    ['a priority the union does not have', { priority: 'urgent' }],
    ['a type the union does not have', { type: 'incident' }],
    ['a title with a word the user never typed', { title: 'sprint 38 @sara' }],
  ]

  for (const [name, said] of attacks) {
    it(`refuses ${name} on both sides of the wire`, () => {
      const { edge, client } = chain(said)
      expect(edge.dropped.length).toBeGreaterThan(0)
      // Nothing the edge refused may be non-null downstream.
      expect(client.trackId === null || client.trackId === edge.trackId).toBe(true)
      expect(client.ownerId === null || client.ownerId === edge.ownerId).toBe(true)
      expect(client.dueDate === null || client.dueDate === edge.dueDate).toBe(true)
      expect(client.priority === null || client.priority === edge.priority).toBe(true)
      expect(client.type === null || client.type === edge.type).toBe(true)
    })
  }

  it('never lets a refused VALUE cross the wire in any field', () => {
    const { edge, client } = chain({
      track_id: 'Payroll',
      owner_id: 'the admin',
      type: 'DROP TABLE entries',
      title: 'sprint 38 @sara #Payroll',
    })
    const wire = JSON.stringify(edge) + JSON.stringify(client)
    expect(wire).not.toContain('Payroll')
    expect(wire).not.toContain('DROP TABLE')
    expect(wire).not.toContain('the admin')
  })

  it('turns a model that answered with prose into a suggestion of nothing, twice', () => {
    const edge = validateProposal('I cannot help with that', edgeCtx, LINE)
    expect(edge.dropped).toEqual(['payload'])
    const client = validate(JSON.parse(JSON.stringify(edge)) as unknown, clientCtx)
    expect(client.title).toBeNull()
    expect(client.trackId).toBeNull()
    expect(client.ownerId).toBeNull()
  })
})

/* ───────────── the asymmetry, which is the reason for two links ────────── */

describe('the handoff — what the client knows that the edge cannot', () => {
  it('refuses a REAL track that no #token can select', () => {
    // The edge checks existence. The client additionally checks that the
    // approved id can be written back into the capture line at all — a track
    // whose name collides with another's is real, visible, and unaddressable.
    const collidingTracks = [
      { id: TRACK_INFRA, name: 'Ops', nameAr: 'العمليات' },
      { id: TRACK_DEV, name: 'Ops', nameAr: 'العمليات' },
    ]
    const edge = validateProposal({ track_id: TRACK_DEV }, { ...edgeCtx, tracks: collidingTracks }, LINE)
    expect(edge.trackId).toBe(TRACK_DEV)
    expect(edge.dropped).toEqual([])

    const client = validate(JSON.parse(JSON.stringify(edge)) as unknown, {
      ...clientCtx,
      tracks: collidingTracks,
    })
    expect(client.trackId).toBeNull()
    expect(client.dropped).toContainEqual({ field: 'trackId', reason: 'ambiguous' })
  })

  it('refuses a date the edge approved a minute before midnight', () => {
    // The edge judges against Asia/Riyadh's day; the browser judges against the
    // user's. `store/ai.ts:398-400` re-runs validation for exactly this reason.
    const edge = validateProposal({ due_date: '2026-08-01' }, edgeCtx, LINE)
    expect(edge.dueDate).toBe('2026-08-01')
    const nextDay = validate(JSON.parse(JSON.stringify(edge)) as unknown, {
      ...clientCtx,
      now: new Date('2026-08-02T09:00:00Z'),
    })
    expect(nextDay.dueDate).toBeNull()
    expect(nextDay.dropped).toContainEqual({ field: 'dueDate', reason: 'past' })
  })
})

/* ───────────────────────── a recorded rough edge ───────────────────────── */

describe('the handoff — the one field the two sides disagree about', () => {
  it('reports ownerName as unsupported on every suggestion that names an owner', () => {
    // NOT A SECURITY HOLE and not a wrong assignment: `ownerId` is validated
    // independently and survives, so the suggestion still assigns correctly.
    //
    // It IS noise in the channel the Preview convention depends on. The edge
    // emits `ownerName` for display (index.ts:613) and `REFUSED_FIELDS`
    // (src/lib/ai/types.ts:263) refuses that key outright, so `dropped` gains a
    // record — and `store/ai.ts:444` console.warns — on EVERY good suggestion
    // that names a person. A "this suggestion was wrong" report that always
    // fires cannot tell anyone which prompt to fix.
    //
    // Recorded in docs/W-AI-HANDOFF.md rather than fixed here: the fix is a
    // wire-shape decision spanning `src/api/ai.ts` and `src/lib/ai/types.ts`,
    // which this area does not own. WHEN IT IS FIXED THIS TEST GOES RED — that
    // is intentional, and the note is where to look.
    const { edge, client } = chain({ title: 'sprint 38', owner_id: MEMBER_NASSER })
    expect(edge.ownerId).toBe(MEMBER_NASSER)
    expect(edge.ownerName).toBe('Nasser Alabri')
    expect(client.ownerId).toBe(MEMBER_NASSER)
    expect(client.dropped).toContainEqual({ field: 'ownerName', reason: 'unsupported' })
  })

  it('is silent when no owner was proposed, which is why it went unnoticed', () => {
    const { client } = chain({ title: 'sprint 38', owner_id: null })
    expect(client.dropped).toEqual([])
  })
})
