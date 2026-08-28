// The COC queue — the four states, the one honest clock, and the name-only rule.

import { describe, expect, it } from 'vitest'

import { buildCocQueue, cocContactProblem, type CocQueueInput } from './cocQueue'
import type { MapNodeUseCase, UseCase } from '../../types'
import type { IsoDate } from '../dates'

const TODAY = '2026-08-28' as IsoDate

// NAMED `capability`, NOT `useCase`: `use` plus a capital is oxlint's Hook
// heuristic, so the obvious name is a `react/rules-of-hooks` error at the top
// level. `obMonitor.test.ts` hit the same wall one file over.
function capability(id: string, order: number): UseCase {
  return {
    id,
    name: id.toUpperCase(),
    name_ar: '',
    sort_order: order,
    hidden: false,
    created_by: null,
    updated_by: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  }
}

const CATALOGUE = [capability('adt', 1), capability('lab', 2), capability('rad', 3)]

function org(id: string, over: { name?: string; manager?: string | null } = {}) {
  return { id, name: over.name ?? id, account_manager_id: over.manager === undefined ? 'member-1' : over.manager }
}

function link(nodeId: string, useCaseId: string, over: Partial<MapNodeUseCase> = {}): MapNodeUseCase {
  return { node_id: nodeId, use_case_id: useCaseId, status: 'planned', rung: 'coc', ...over }
}

const build = (over: Partial<CocQueueInput> = {}) =>
  buildCocQueue({ nodes: [org('a')], catalogue: CATALOGUE, links: [], today: TODAY, ...over })

describe('what belongs in the queue at all', () => {
  it('holds the pairs at COC and nothing else', () => {
    const out = build({
      links: [link('a', 'adt'), link('a', 'lab', { rung: 'stg' }), link('a', 'rad', { rung: 'prod' })],
    })
    expect(out.entries.map((e) => e.useCaseId)).toEqual(['adt'])
  })

  it('drops a pair somebody ruled out, whatever rung it was left on', () => {
    // Scope is the ruling; the rung is where it happened to be standing when
    // the ruling was made. A not-applicable pair is not this office's work.
    const out = build({ links: [link('a', 'adt', { scope: 'not_applicable' })] })
    expect(out.entries).toHaveLength(0)
  })

  it('ignores a link whose organization is not in the list it was handed', () => {
    // The caller passes organizations only. A link against a department is not
    // an error to report — it is simply not this queue's business.
    const out = build({ links: [link('somewhere-else', 'adt')] })
    expect(out.entries).toHaveLength(0)
  })

  it('ignores a link against a capability that is not in the visible catalogue', () => {
    const out = build({ links: [link('a', 'cda-hidden')] })
    expect(out.entries).toHaveLength(0)
  })
})

describe('the four states', () => {
  it('calls a pair with no submission date unsubmitted — the chase has not started', () => {
    const out = build({ links: [link('a', 'adt')] })
    expect(out.entries[0]?.state).toBe('unsubmitted')
    expect(out.entries[0]?.waitingDays).toBeNull()
    expect(out.unsubmitted).toBe(1)
  })

  it('calls a submitted, unsigned pair waiting, and ages it from the day a person typed', () => {
    const out = build({ links: [link('a', 'adt', { coc_submitted_on: '2026-08-18' })] })
    expect(out.entries[0]?.state).toBe('waiting')
    expect(out.entries[0]?.waitingDays).toBe(10)
    expect(out.oldestWait).toBe(10)
  })

  it('calls a signed pair signed even though the rung has not moved to PROD', () => {
    // This is the state worth surfacing rather than hiding: the work is
    // finished and only the record has not caught up.
    const out = build({
      links: [link('a', 'adt', { coc_submitted_on: '2026-08-01', coc_signed_on: '2026-08-20' })],
    })
    expect(out.entries[0]?.state).toBe('signed')
    expect(out.signed).toBe(1)
    // And it is not counted as a live wait, because nobody is waiting.
    expect(out.waiting).toBe(0)
    expect(out.oldestWait).toBeNull()
  })

  it('marks a submitted pair with no contact and no reference untraceable', () => {
    const out = build({ links: [link('a', 'adt', { coc_submitted_on: '2026-08-20' })] })
    expect(out.entries[0]?.untraceable).toBe(true)
    expect(out.untraceable).toBe(1)
  })

  it('does not call a pair untraceable when either a contact or a reference exists', () => {
    // Either one is enough to make a chase possible: a name to call, or a
    // reference to quote.
    const named = build({ links: [link('a', 'adt', { coc_submitted_on: '2026-08-20', coc_contact: 'Sara' })] })
    const referenced = build({ links: [link('a', 'adt', { coc_submitted_on: '2026-08-20', coc_reference: 'CHI-9' })] })
    expect(named.entries[0]?.untraceable).toBe(false)
    expect(referenced.entries[0]?.untraceable).toBe(false)
  })

  it('does not call a pair untraceable on whitespace alone', () => {
    const out = build({ links: [link('a', 'adt', { coc_submitted_on: '2026-08-20', coc_contact: '   ' })] })
    expect(out.entries[0]?.untraceable).toBe(true)
  })

  it('never calls an unsubmitted pair untraceable — there is nothing to trace yet', () => {
    const out = build({ links: [link('a', 'adt')] })
    expect(out.entries[0]?.untraceable).toBe(false)
  })
})

describe('the clock', () => {
  it('reads a future submission date as zero rather than a negative wait', () => {
    // A typo in the date box is not a reason to print "-3 days".
    const out = build({ links: [link('a', 'adt', { coc_submitted_on: '2026-08-31' })] })
    expect(out.entries[0]?.waitingDays).toBe(0)
  })

  /**
   * ⚠ THE POINT OF THE WHOLE FILE. `obMonitor` refuses to print a day count
   * because `status_changed_at` holds one migration instant for all 1,540 rows.
   * This clock is a date a PERSON typed, so it is a real wait — and the test
   * that proves the difference is that a row with every other field written by
   * a script still reports null until somebody fills this one in.
   */
  it('stays null on a row a script wrote, because only a person can write this date', () => {
    const out = build({
      links: [link('a', 'adt', { updated_by: null, status_changed_at: '2026-08-26T20:06:31Z' })],
    })
    expect(out.entries[0]?.waitingDays).toBeNull()
    expect(out.oldestWait).toBeNull()
  })
})

describe('the order', () => {
  it('puts the oldest live wait first, because the age is the reason to chase', () => {
    const out = build({
      nodes: [org('a'), org('b'), org('c')],
      links: [
        link('a', 'adt', { coc_submitted_on: '2026-08-25' }),
        link('b', 'adt', { coc_submitted_on: '2026-07-01' }),
        link('c', 'adt', { coc_submitted_on: '2026-08-10' }),
      ],
    })
    expect(out.entries.map((e) => e.nodeId)).toEqual(['b', 'c', 'a'])
  })

  /**
   * ⚠ `obMonitor`'s rule about a null `quietDays`, restated one file over: an
   * organization nobody has opened is a different problem from one that went
   * quiet, and floating the unlooked-at above the stuck buries the thing a
   * person can act on today.
   */
  it('never floats an unsubmitted pair above a real wait, however short the wait', () => {
    const out = build({
      nodes: [org('a'), org('b')],
      links: [link('a', 'adt'), link('b', 'adt', { coc_submitted_on: TODAY })],
    })
    expect(out.entries.map((e) => e.state)).toEqual(['waiting', 'unsubmitted'])
    expect(out.entries[0]?.waitingDays).toBe(0)
  })

  it('puts signed last — it is finished work, not a queue', () => {
    const out = build({
      nodes: [org('a'), org('b')],
      links: [
        link('a', 'adt', { coc_submitted_on: '2026-01-01', coc_signed_on: '2026-08-01' }),
        link('b', 'adt'),
      ],
    })
    expect(out.entries.map((e) => e.state)).toEqual(['unsubmitted', 'signed'])
  })

  it('breaks a tie by organization name, then by catalogue order, so the list does not shuffle', () => {
    const out = build({
      nodes: [org('a', { name: 'Zahra' }), org('b', { name: 'Amal' })],
      links: [link('a', 'lab'), link('b', 'rad'), link('b', 'adt')],
    })
    expect(out.entries.map((e) => `${e.nodeName}/${e.useCaseId}`)).toEqual(['Amal/adt', 'Amal/rad', 'Zahra/lab'])
  })
})

describe('the counts', () => {
  it('counts organizations, not pairs — a hospital with four at COC is one hospital', () => {
    const out = build({ links: [link('a', 'adt'), link('a', 'lab'), link('a', 'rad')] })
    expect(out.entries).toHaveLength(3)
    expect(out.organizations).toBe(1)
  })

  it('reports an empty queue as zeroes and a null oldest wait, not as a zero-day wait', () => {
    const out = build()
    expect(out.entries).toHaveLength(0)
    expect(out.oldestWait).toBeNull()
  })
})

/**
 * §11.7: `coc_contact` IS A NAME AND NOTHING ELSE — no email, no phone. A CHI
 * contact is a person outside the organization, so the bar is higher than for
 * the roster, not lower.
 */
describe('the name-only rule', () => {
  it('accepts a plain name in either script', () => {
    expect(cocContactProblem('Sara Al-Otaibi')).toBeNull()
    expect(cocContactProblem('سارة العتيبي')).toBeNull()
  })

  it('accepts nothing at all, because a blank is "nobody has said"', () => {
    expect(cocContactProblem('')).toBeNull()
    expect(cocContactProblem('   ')).toBeNull()
  })

  it('refuses an email address', () => {
    expect(cocContactProblem('sara@chi.gov.sa')).toBe('email')
  })

  it('refuses a phone number, however it is spaced or prefixed', () => {
    expect(cocContactProblem('+966 55 123 4567')).toBe('phone')
    expect(cocContactProblem('0551234567')).toBe('phone')
    expect(cocContactProblem('Sara 055-123-4567')).toBe('phone')
  })

  it('does not mistake a name carrying a couple of digits for a phone number', () => {
    // Deliberately narrow: seven digits is the shortest thing anywhere that is
    // a phone number, and a validator confident about what a name looks like
    // would reject real people in this programme.
    expect(cocContactProblem('Sara (desk 42)')).toBeNull()
  })
})
