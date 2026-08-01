import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NUDGE_ERRORS, NUDGE_WINDOW_MS, nudgeErrorKey } from './nudge'

// WHAT THIS FILE PINS. Everything here is a DECISION rather than a mechanic, and
// none of it is visible to the type checker:
//
//   · every refusal `nudge_entry()` can raise has its OWN sentence. This is the
//     whole difference between "somebody already asked" and "something went
//     wrong" on a button that messages a colleague, and a mapping table is the
//     easiest thing in the codebase to half-write;
//   · TWO of those mappings override an answer pgErrorKey would otherwise give
//     CONFIDENTLY AND WRONGLY — 42501 as "only an admin can do that", and PT429
//     as nothing at all;
//   · a marker token only counts under its own SQLSTATE, so an entry TITLE
//     containing the words "nudge self" cannot route an unrelated failure;
//   · the RPC is called with 0019's parameter name. PostgREST resolves an RPC by
//     its named arguments, so `p_entry_id` instead of `p_entry` is not a type
//     error anywhere — it is a runtime PGRST202 that reads exactly like a
//     missing migration;
//   · the nullable-client guard is the first statement.

let rpcCalls: { name: string; args: unknown }[] = []
let answer: { data: unknown; error: unknown } = { data: null, error: null }

const fakeClient = {
  rpc: (name: string, args: unknown) => {
    rpcCalls.push({ name, args })
    return Promise.resolve(answer)
  },
}

/**
 * A fresh copy of the module bound to a client that either exists or does not.
 * `supabase` is a const binding captured at import, so switching it means
 * re-importing — hence doMock (not hoisted) plus resetModules. api/labels.test.ts
 * uses the same two lines.
 */
async function loadApi(configured = true): Promise<typeof import('./nudge')> {
  vi.resetModules()
  vi.doMock('./supabase', () => ({
    supabase: configured ? fakeClient : null,
    isConfigured: () => configured,
  }))
  return await import('./nudge')
}

beforeEach(() => {
  rpcCalls = []
  answer = { data: null, error: null }
})

describe('the refusal table', () => {
  it('covers all five refusals 0019 raises, each with its own sentence', () => {
    // The list is the contract with the migration, whose own `comment on
    // function` names the same five. A refusal added there and forgotten here
    // arrives as pgErrorKey's 'common.error' — precisely the sentence this
    // feature exists to avoid — and nothing would report it, because an unmapped
    // code still renders *something*.
    expect(NUDGE_ERRORS.map((r) => `${r.code} ${r.token}`).sort()).toEqual([
      '22023 nudge_no_owner',
      '22023 nudge_self',
      '42501 nudge_not_a_member',
      'P0002 nudge_entry_missing',
      'PT429 nudge_rate_limited',
    ])
    // Two refusals sharing one sentence is the failure this feature cannot have:
    // "you own this one" and "somebody already asked" are different situations
    // with different next moves, and collapsing them is how a precise mapping
    // decays back into a generic one. Listed by name rather than tested by
    // prefix so that every key here is also checked against both locale bundles
    // by lib/localeReach.test.ts, which scans this file too.
    expect(NUDGE_ERRORS.map((r) => r.key).sort()).toEqual([
      'nudge.errGone',
      'nudge.errNoOwner',
      'nudge.errNotMember',
      'nudge.errTooSoon',
      'nudge.errYours',
    ])
  })

  it('mirrors 0019 PART 5’s window exactly', () => {
    // The migration hardcodes `interval '24 hours'` and says why. This constant
    // decides only whether the UI OFFERS to ask again; drifting from it does not
    // corrupt anything, but it does make the screen promise something the server
    // will refuse.
    expect(NUDGE_WINDOW_MS).toBe(86_400_000)
  })
})

describe('threadBodyKey', () => {
  it('maps 0019’s body token to a localised line and leaves human text alone', async () => {
    const { threadBodyKey, NUDGE_BODY_TOKEN } = await loadApi()
    expect(NUDGE_BODY_TOKEN).toBe('[nudge]')
    expect(threadBodyKey('[nudge]')).toBe('nudge.threadLine')
    expect(threadBodyKey('  [nudge]  ')).toBe('nudge.threadLine')
    // Null, not the body: a caller that fell back to `t(body)` on a match would
    // be one refactor away from pushing arbitrary user text through the
    // translator, where an override could rewrite somebody's update.
    expect(threadBodyKey('Waiting on the vendor')).toBeNull()
    expect(threadBodyKey('see [nudge] below')).toBeNull()
  })
})

describe('nudgeErrorKey', () => {
  it.each(NUDGE_ERRORS)('$token → $key', ({ code, token, key }) => {
    expect(nudgeErrorKey({ code, message: token })).toBe(key)
  })

  it('overrides the two answers pgErrorKey would get wrong', () => {
    // 42501 is "RLS said no" everywhere else in the app, and pgErrorKey reads
    // that as "only an admin can do that". Here it means a JWT with no profile
    // row — a deleted member's live session — and sending that person to find an
    // admin is sending them to the wrong place.
    expect(nudgeErrorKey({ code: '42501', message: 'nudge_not_a_member' })).toBe(
      'nudge.errNotMember',
    )
    expect(nudgeErrorKey({ code: '42501', message: 'row-level security' })).toBe(
      'admin.errForbidden',
    )
    // PT429 is PostgREST's own convention and pgErrorKey has never seen it.
    expect(nudgeErrorKey({ code: 'PT429', message: 'nudge_rate_limited' })).toBe('nudge.errTooSoon')
  })

  it('finds the token wherever PostgREST put it', () => {
    // A `raise … using errcode` marker lands in `message`; its DETAIL — here the
    // timestamp of the blocking ask — lands in `details`. Searching the whole
    // blob avoids caring which, exactly as lib/pgError.ts's haystack() does.
    expect(
      nudgeErrorKey({
        code: 'PT429',
        message: 'nudge_rate_limited: this item was already nudged in the last 24 hours',
        details: '2026-08-01T06:00:00Z',
      }),
    ).toBe('nudge.errTooSoon')
    expect(nudgeErrorKey({ code: 'P0002', hint: 'NUDGE_ENTRY_MISSING' })).toBe('nudge.errGone')
  })

  it('will not route a failure on the strength of a token in free text', () => {
    // Entry titles reach error messages — a unique-violation detail quotes the
    // value. A row titled "nudge_self service pilot" hitting an unrelated 23505
    // must not be explained as "this one is yours".
    expect(nudgeErrorKey({ code: '23505', message: 'duplicate key … nudge_self' })).not.toBe(
      'nudge.errYours',
    )
  })

  it('names a missing migration instead of shrugging at it', () => {
    // PostgREST's "could not find the function in the schema cache" — 0019 has
    // not been applied here. It is a supported state for a feature whose
    // migration is new, and the one failure a screen can explain precisely.
    expect(nudgeErrorKey({ code: 'PGRST202', message: 'no function' })).toBe(
      'common.errMissingTable',
    )
  })

  it('delegates everything else, so pgErrorKey keeps its better answers', () => {
    expect(nudgeErrorKey({ code: 'PGRST205', message: 'no table' })).toBe('common.errMissingTable')
    expect(nudgeErrorKey(null)).toBe('common.error')
    expect(nudgeErrorKey('nudge_self')).toBe('common.error')
    expect(nudgeErrorKey({ code: '', message: 'nudge_self' })).toBe('common.error')
  })
})

describe('the nullable-client guard is the first statement', () => {
  it('returns common.notConfigured and touches nothing', async () => {
    const api = await loadApi(false)
    expect(await api.nudgeEntry('e1')).toEqual({ ok: false, error: 'common.notConfigured' })
    expect(rpcCalls).toHaveLength(0)
  })
})

describe('nudgeEntry', () => {
  it("calls 0019's function with 0019's parameter name", async () => {
    const api = await loadApi()
    answer = { data: '2026-08-01T09:00:00+00:00', error: null }

    const result = await api.nudgeEntry('e1')

    expect(result).toEqual({ ok: true, data: '2026-08-01T09:00:00+00:00' })
    expect(rpcCalls).toEqual([{ name: 'nudge_entry', args: { p_entry: 'e1' } }])
  })

  it('says the request did not go out when the answer is not a stamp', async () => {
    // 0019 declares `returns timestamptz`, which PostgREST serialises as a
    // string. Anything else means the function on this project is not the one
    // this build was written against — and the one thing a caller must be
    // certain of after a failure is that nobody was messaged. 'common.error'
    // would leave them unable to tell that from "already asked".
    const api = await loadApi()
    for (const data of [null, '', 0, {}, []]) {
      answer = { data, error: null }
      expect(await api.nudgeEntry('e1')).toEqual({ ok: false, error: 'nudge.errFailed' })
    }
  })

  it.each(NUDGE_ERRORS)('surfaces $token as $key', async ({ code, token, key }) => {
    const api = await loadApi()
    answer = { data: null, error: { code, message: token } }
    expect(await api.nudgeEntry('e1')).toEqual({ ok: false, error: key })
  })
})
