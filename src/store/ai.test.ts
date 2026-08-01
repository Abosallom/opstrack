// The AI store, without a network and without a model.
//
// WHAT THIS FILE IS DEFENDING, in the order the failures bite:
//
//  1. THE STALE REPLY. Type a line, correct it, and the first line's answer
//     lands second. Without the epoch the row would describe words that are no
//     longer in the box — a suggestion that is not wrong so much as about
//     something else, which is the one failure that could put wrong data into an
//     entry. Asserted by resolving two requests out of order.
//  2. THE FIELDS THE LINE ALREADY HAS. `newFields()` decides what the row shows
//     AND what Tab applies, so a chip that turns out to be a no-op is a promise
//     the feature broke. Asserted against the REAL parser rather than a
//     hand-written ParsedEntry, because the interesting cases (`#Network`
//     resolving, `due:someday` failing) are the parser's own judgements.
//  3. THE TITLE NEVER COMES BACK. This surface appends; it does not rewrite. A
//     model that returns a cleaned-up title must not be able to replace words a
//     person is in the middle of typing.
//  4. THE SWITCH ACTUALLY GATING THE SEND. A preference that has not been read,
//     or has been read as false, must produce no call at all. That is the
//     privacy promise printed on the settings screen, and here is the only place
//     it can be proven.
//  5. THE CACHE AND THE REFUSAL. Retyping a line must not spend a second billed
//     call, and a dismissed line must stay dismissed — otherwise Esc is a button
//     that argues back.
//
// The fake is a mock of api/ai's two network functions only: `importOriginal`
// keeps MIN/MAX_LINE_CHARS and the total readers real, so the payload
// normaliser is exercised here rather than described. Everything under
// src/lib/ai is the REAL validator and the REAL token writer — this file asserts
// how they are USED, and their own suites assert what they do.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const fx = vi.hoisted(() => {
  // lib/i18n reads localStorage at module scope, at IMPORT time — so the shims
  // cannot wait for a beforeEach().
  const g = globalThis as unknown as Record<string, unknown>
  if (!g.localStorage) {
    const mem = new Map<string, string>()
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
  }
  if (!g.document) g.document = { documentElement: { dir: 'ltr', lang: 'en' } }

  interface Deferred {
    resolve: (value: unknown) => void
  }

  const calls = {
    /** Every line actually sent, in order. The privacy assertion reads this. */
    suggest: [] as string[],
    upserts: [] as Record<string, unknown>[],
  }

  /** Queued answers, so a test can resolve two requests out of order. */
  const pending: Deferred[] = []
  let deferred = false
  let nextReply: unknown = null

  /** What `notification_prefs` answers, and whether the write fails. */
  const db = {
    prefsRow: null as { ai_enabled: boolean } | null,
    prefsError: null as { message: string; code?: string } | null,
    writeError: null as { message: string; code?: string } | null,
  }

  const client = {
    auth: {
      getSession: () => Promise.resolve({ data: { session: { user: { id: 'u-1' } } } }),
    },
    from: (table: string) => ({
      select: () => ({
        maybeSingle: () => Promise.resolve({ data: db.prefsRow, error: db.prefsError }),
      }),
      upsert: (payload: Record<string, unknown>) => {
        calls.upserts.push({ table, ...payload })
        return Promise.resolve({ error: db.writeError })
      },
    }),
  }

  return {
    calls,
    db,
    client,
    pending,
    setDeferred: (on: boolean) => {
      deferred = on
    },
    setReply: (reply: unknown) => {
      nextReply = reply
    },
    suggestFromLine: (line: string) => {
      calls.suggest.push(line)
      if (!deferred) return Promise.resolve(nextReply)
      let resolve: (value: unknown) => void = () => {}
      const promise = new Promise<unknown>((r) => {
        resolve = r
      })
      pending.push({ resolve })
      return promise
    },
    readUsageToday: () =>
      Promise.resolve({ ok: true, data: { calls: 3, inputTokens: 900, outputTokens: 60 } }),
  }
})

vi.mock('../api/supabase', () => ({
  supabase: fx.client,
  isConfigured: () => true,
}))

vi.mock('../api/ai', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api/ai')>()
  return {
    ...actual,
    suggestFromLine: fx.suggestFromLine,
    readUsageToday: fx.readUsageToday,
  }
})

// Dynamic, so the shims above are installed before lib/i18n is evaluated.
const { parse } = await import('../lib/capture/parse')
const { toReply, toTokenUse } = await import('../api/ai')
const {
  dismissSuggestion,
  loadAiPrefs,
  newFields,
  reportSuggestionMiss,
  requestSuggestion,
  resetAi,
  setAiEnabled,
  shouldSuggest,
  suggestionTokens,
  takeAiTokens,
} = await import('./ai')

import type { ParseContext } from '../lib/capture/parse'
import type { ValidatedSuggestion } from '../lib/ai/types'

/* ── fixtures ────────────────────────────────────────────────────────────── */

const NOW = new Date('2026-08-01T09:00:00Z')

const CTX: ParseContext = {
  tracks: [
    { id: 't-net', name: 'Network', nameAr: 'الشبكات' },
    { id: 't-devqa', name: 'Dev & QA', nameAr: 'التطوير والجودة' },
  ],
  members: [
    { id: 'm-sara', displayName: 'Sara Ahmed', username: 'sara' },
    { id: 'm-omar', displayName: 'Omar Al Harbi', username: null },
  ],
  now: NOW,
  locale: 'en',
}

/** A full proposal, as the edge function would hand it over. */
const PROPOSAL = {
  title: 'Sprint 38 deployment',
  trackId: 't-devqa',
  ownerId: 'm-sara',
  priority: 'high',
  type: 'change',
  dueDate: '2026-08-07',
  followUpDate: null,
  tags: ['portal'],
  dropped: [],
}

function reply(suggestion: unknown = PROPOSAL, model = 'claude-sonnet-5'): unknown {
  return {
    ok: true,
    data: {
      suggestion,
      usage: { inputTokens: 900, outputTokens: 60 },
      dailyCalls: 4,
      dailyLimit: 400,
      model,
    },
  }
}

/** A ValidatedSuggestion literal, for the pure `newFields` cases. */
function validated(over: Partial<ValidatedSuggestion> = {}): ValidatedSuggestion {
  return {
    title: 'Sprint 38 deployment',
    trackId: 't-devqa',
    ownerId: 'm-sara',
    priority: 'high',
    type: 'change',
    dueDate: '2026-08-07',
    followUpDate: null,
    tags: ['portal'],
    dropped: [],
    ...over,
  }
}

/** The store's gate: a preference that has been read and says yes. */
async function readyWith(enabled: boolean): Promise<void> {
  fx.db.prefsRow = { ai_enabled: enabled }
  fx.db.prefsError = null
  await loadAiPrefs()
}

beforeEach(() => {
  resetAi()
  fx.calls.suggest.length = 0
  fx.calls.upserts.length = 0
  fx.pending.length = 0
  fx.setDeferred(false)
  fx.setReply(reply())
  fx.db.prefsRow = null
  fx.db.prefsError = null
  fx.db.writeError = null
})

/* ── shouldSuggest ───────────────────────────────────────────────────────── */

describe('shouldSuggest', () => {
  it('fires on prose — a line the parser resolved nothing in', () => {
    const line = 'sprint 38 deployment next friday'
    expect(shouldSuggest(line, parse(line, CTX))).toBe(true)
  })

  it('never fires on a line that already parses cleanly', () => {
    // The whole cost argument: a line that is already understood must not spend
    // a billed call to be told so.
    const line = 'deploy the switch #Network @sara due:+7d /change'
    const parsed = parse(line, CTX)
    expect(parsed.problems).toEqual([])
    expect(shouldSuggest(line, parsed)).toBe(false)
  })

  it('fires when tokens resolved but something did not', () => {
    const line = 'deploy the core switch #Network due:someday'
    const parsed = parse(line, CTX)
    expect(parsed.problems.length).toBeGreaterThan(0)
    expect(shouldSuggest(line, parsed)).toBe(true)
  })

  it('refuses a line too short to mean anything', () => {
    expect(shouldSuggest('fix it', parse('fix it', CTX))).toBe(false)
  })

  it('refuses a pasted paragraph — that is Meeting Mode, and it asks first', () => {
    const long = 'follow up with the vendor about the certificate renewal '.repeat(20)
    expect(shouldSuggest(long, parse(long, CTX))).toBe(false)
  })

  it('refuses a recurring line: which table it lands in is not the AI to choose', () => {
    const line = 'send the weekly status report every:week'
    const parsed = parse(line, CTX)
    expect(parsed.recurrence).not.toBeNull()
    expect(shouldSuggest(line, parsed)).toBe(false)
  })

  it('refuses an empty box', () => {
    expect(shouldSuggest('   ', parse('   ', CTX))).toBe(false)
  })
})

/* ── newFields ───────────────────────────────────────────────────────────── */

describe('newFields', () => {
  const LINE = 'sprint 38 deployment next friday'

  it('NEVER offers a title — this surface appends, it does not rewrite', () => {
    expect(newFields(validated(), parse(LINE, CTX)).title).toBeNull()
  })

  it('drops every field the line already carries', () => {
    // The honesty property: the row shows exactly what Tab will add, so a
    // proposal for something already on the line must not be rendered at all.
    const line = 'deploy the core switch #Network @sara /change due:+7d !high +portal'
    const left = newFields(validated(), parse(line, CTX))
    expect(left).toMatchObject({
      title: null,
      trackId: null,
      ownerId: null,
      priority: null,
      type: null,
      dueDate: null,
      tags: [],
    })
  })

  it('leaves a free-text owner alone', () => {
    // `@Bob` names an owner even though Bob is not a member; proposing a
    // different one over the top of it would be overruling the person typing.
    const line = 'chase the certificate renewal @Bob'
    const parsed = parse(line, CTX)
    expect(parsed.ownerName).not.toBeNull()
    expect(newFields(validated(), parsed).ownerId).toBeNull()
  })

  it('proposes only the gap when half the line is already keyed', () => {
    const line = '#Network deploy the core switch next friday'
    const left = newFields(validated(), parse(line, CTX))
    expect(left.trackId).toBeNull()
    expect(left.ownerId).toBe('m-sara')
    expect(left.dueDate).toBe('2026-08-07')
  })

  it('drops a tag the line already has, whatever its case', () => {
    const line = 'renew the portal certificate +Portal'
    expect(newFields(validated(), parse(line, CTX)).tags).toEqual([])
  })
})

/* ── the tokens Tab writes ───────────────────────────────────────────────── */

describe('suggestionTokens', () => {
  const LINE = 'sprint 38 deployment next friday'

  it('writes canonical tokens, quoted where the grammar needs it', () => {
    expect(suggestionTokens(validated(), parse(LINE, CTX), CTX)).toEqual([
      '#"Dev & QA"',
      '@sara',
      '!high',
      '/change',
      'due:2026-08-07',
      '+portal',
    ])
  })

  it('writes the track name in the reader’s language', () => {
    const ar = suggestionTokens(validated(), parse(LINE, CTX), { ...CTX, locale: 'ar' })
    expect(ar[0]).toBe('#"التطوير والجودة"')
  })

  it('round-trips: what it writes, the parser reads back', () => {
    // The property the whole feature rests on. Appending the tokens to the
    // user's own line and re-parsing must yield the fields that were approved —
    // no chip left red, nothing silently different.
    const tokens = suggestionTokens(validated(), parse(LINE, CTX), CTX)
    const after = parse(`${LINE} ${tokens.join(' ')}`, CTX)
    expect(after.trackId).toBe('t-devqa')
    expect(after.ownerId).toBe('m-sara')
    expect(after.priority).toBe('high')
    expect(after.type).toBe('change')
    expect(after.dueDate).toBe('2026-08-07')
    expect(after.tags).toEqual(['portal'])
    expect(after.problems).toEqual([])
    // And the words the user typed are still the title, untouched.
    expect(after.title).toBe(LINE)
  })

  it('offers nothing at all for a line that already says everything', () => {
    const line = 'deploy the core switch #Network @sara /change due:+7d !high +portal'
    expect(suggestionTokens(validated(), parse(line, CTX), CTX)).toEqual([])
  })
})

/* ── the payload readers ─────────────────────────────────────────────────── */

describe('toReply', () => {
  it('is total: garbage in, an empty reply out', () => {
    for (const junk of [null, undefined, 'nope', 42]) {
      const r = toReply(junk)
      expect(r.suggestion).toBeUndefined()
      expect(r.usage).toEqual({ inputTokens: 0, outputTokens: 0 })
      expect(r.dailyCalls).toBeNull()
      expect(r.dailyLimit).toBe(0)
    }
  })

  it('keeps a failed ledger write as null rather than inventing a zero', () => {
    // "0 calls today" and "the count could not be written" are different facts,
    // and only one of them means the quota is untouched.
    expect(toReply({ dailyCalls: null }).dailyCalls).toBeNull()
    expect(toReply({ dailyCalls: 12 }).dailyCalls).toBe(12)
  })

  it('normalises the cost block', () => {
    expect(toTokenUse({ inputTokens: 900, outputTokens: '60' })).toEqual({
      inputTokens: 900,
      outputTokens: 0,
    })
  })
})

/* ── the switch gates the send ───────────────────────────────────────────── */

describe('the preference gate', () => {
  const LINE = 'sprint 38 deployment next friday'

  it('sends nothing until the preference has been read', async () => {
    // FAIL CLOSED. This is the whole reason there is no optimistic default and
    // no localStorage mirror.
    await requestSuggestion(LINE, parse(LINE, CTX), CTX)
    expect(fx.calls.suggest).toEqual([])
  })

  it('sends nothing when the preference says no', async () => {
    await readyWith(false)
    await requestSuggestion(LINE, parse(LINE, CTX), CTX)
    expect(fx.calls.suggest).toEqual([])
  })

  it('sends nothing when the preference read FAILED', async () => {
    fx.db.prefsError = { message: 'permission denied', code: '42501' }
    await loadAiPrefs()
    await requestSuggestion(LINE, parse(LINE, CTX), CTX)
    expect(fx.calls.suggest).toEqual([])
  })

  it('treats a MISSING COLUMN as "no preference yet", not as a failure', async () => {
    // Migration 0021 is this wave's outstanding gap. A column that does not
    // exist is a preference that cannot have been expressed, so the shipped
    // default is the honest answer — and the feature still works.
    fx.db.prefsError = { message: 'column ai_enabled does not exist', code: '42703' }
    await loadAiPrefs()
    await requestSuggestion(LINE, parse(LINE, CTX), CTX)
    expect(fx.calls.suggest).toEqual([LINE])
  })

  it('treats a missing ROW as the shipped default', async () => {
    fx.db.prefsRow = null
    await loadAiPrefs()
    await requestSuggestion(LINE, parse(LINE, CTX), CTX)
    expect(fx.calls.suggest).toEqual([LINE])
  })

  it('rolls the switch back when the write is refused, and keeps working', async () => {
    await readyWith(true)
    fx.db.writeError = { message: 'permission denied', code: '42501' }
    const failure = await setAiEnabled(false)
    expect(failure).not.toBeNull()
    expect(fx.calls.upserts).toHaveLength(1)
    // The rollback is the assertion: a refused write must not leave the feature
    // silently off, so the next line still goes out.
    await requestSuggestion(LINE, parse(LINE, CTX), CTX)
    expect(fx.calls.suggest).toEqual([LINE])
  })

  it('turning it off drops what is held in memory', async () => {
    await readyWith(true)
    await requestSuggestion(LINE, parse(LINE, CTX), CTX)
    expect(takeAiTokens(LINE, parse(LINE, CTX), CTX)).not.toBeNull()

    await requestSuggestion(LINE, parse(LINE, CTX), CTX)
    await setAiEnabled(false)
    expect(takeAiTokens(LINE, parse(LINE, CTX), CTX)).toBeNull()
  })
})

/* ── epoch, cache, dismissal ─────────────────────────────────────────────── */

describe('one suggestion at a time', () => {
  const FIRST = 'sprint 38 deployment next friday'
  const SECOND = 'sprint 38 deployment next friday for the core switch'

  it('DISCARDS a slow answer for a line that has moved on', async () => {
    await readyWith(true)
    fx.setDeferred(true)

    const a = requestSuggestion(FIRST, parse(FIRST, CTX), CTX)
    const b = requestSuggestion(SECOND, parse(SECOND, CTX), CTX)
    expect(fx.pending).toHaveLength(2)

    // Out of order, which is the whole point: the second line answers first.
    fx.pending[1].resolve(reply(PROPOSAL, 'model-second'))
    await b
    fx.pending[0].resolve(reply(PROPOSAL, 'model-first'))
    await a

    expect(takeAiTokens(FIRST, parse(FIRST, CTX), CTX)).toBeNull()
    expect(takeAiTokens(SECOND, parse(SECOND, CTX), CTX)).not.toBeNull()
  })

  it('answers a repeated line from the cache, without a second billed call', async () => {
    await readyWith(true)
    await requestSuggestion(FIRST, parse(FIRST, CTX), CTX)
    expect(takeAiTokens(FIRST, parse(FIRST, CTX), CTX)).not.toBeNull()

    // Backspace over a word and retype it — the most common thing anyone does in
    // a capture box, and it must be free.
    await requestSuggestion(FIRST, parse(FIRST, CTX), CTX)
    expect(fx.calls.suggest).toEqual([FIRST])
    expect(takeAiTokens(FIRST, parse(FIRST, CTX), CTX)).not.toBeNull()
  })

  it('does not re-ask while its own answer is already showing', async () => {
    await readyWith(true)
    await requestSuggestion(FIRST, parse(FIRST, CTX), CTX)
    await requestSuggestion(FIRST, parse(FIRST, CTX), CTX)
    expect(fx.calls.suggest).toEqual([FIRST])
  })

  it('stays dismissed', async () => {
    await readyWith(true)
    await requestSuggestion(FIRST, parse(FIRST, CTX), CTX)
    dismissSuggestion(FIRST)
    expect(takeAiTokens(FIRST, parse(FIRST, CTX), CTX)).toBeNull()

    await requestSuggestion(FIRST, parse(FIRST, CTX), CTX)
    expect(takeAiTokens(FIRST, parse(FIRST, CTX), CTX)).toBeNull()
  })

  it('an Esc with nothing on screen does not blacklist the line', async () => {
    // Capture's input calls dismissSuggestion() on every Escape rather than
    // subscribing to this store. Without the no-op guard, one stray Esc would
    // silently refuse a line that had never been offered — and the row would
    // then fail to appear a word later with no explanation available to anyone.
    await readyWith(true)
    dismissSuggestion(FIRST)
    await requestSuggestion(FIRST, parse(FIRST, CTX), CTX)
    expect(fx.calls.suggest).toEqual([FIRST])
    expect(takeAiTokens(FIRST, parse(FIRST, CTX), CTX)).not.toBeNull()
  })

  it('refuses to hand over a suggestion computed for other words', async () => {
    await readyWith(true)
    await requestSuggestion(FIRST, parse(FIRST, CTX), CTX)
    // The guard that keeps a keydown from applying yesterday's answer.
    expect(takeAiTokens(SECOND, parse(SECOND, CTX), CTX)).toBeNull()
    expect(takeAiTokens(FIRST, parse(FIRST, CTX), CTX)).not.toBeNull()
  })

  it('a reported miss is dismissed AND un-cached', async () => {
    await readyWith(true)
    await requestSuggestion(FIRST, parse(FIRST, CTX), CTX)
    reportSuggestionMiss(FIRST)
    expect(takeAiTokens(FIRST, parse(FIRST, CTX), CTX)).toBeNull()

    // A correction the feature then hands straight back is not a correction.
    await requestSuggestion(FIRST, parse(FIRST, CTX), CTX)
    expect(fx.calls.suggest).toEqual([FIRST])
    expect(takeAiTokens(FIRST, parse(FIRST, CTX), CTX)).toBeNull()
  })

  it('sign-out empties the cache of lines the last user typed', async () => {
    await readyWith(true)
    await requestSuggestion(FIRST, parse(FIRST, CTX), CTX)
    expect(takeAiTokens(FIRST, parse(FIRST, CTX), CTX)).not.toBeNull()

    resetAi()
    await readyWith(true)
    await requestSuggestion(FIRST, parse(FIRST, CTX), CTX)
    // Asked again, rather than answered from the previous session's memory.
    expect(fx.calls.suggest).toEqual([FIRST, FIRST])
  })

  it('a failed call leaves nothing on screen', async () => {
    await readyWith(true)
    fx.setReply({ ok: false, error: 'ai.errUpstream' })
    await requestSuggestion(FIRST, parse(FIRST, CTX), CTX)
    expect(takeAiTokens(FIRST, parse(FIRST, CTX), CTX)).toBeNull()
  })

  it('a hallucinated reply survives contact with this workspace', async () => {
    // The client re-validates against ITS OWN tracks and members — the second
    // half of the defence the edge function starts. A track this workspace does
    // not have cannot become a token.
    await readyWith(true)
    fx.setReply(reply({ ...PROPOSAL, trackId: 't-ghost', ownerId: 'm-ghost' }))
    await requestSuggestion(FIRST, parse(FIRST, CTX), CTX)
    const tokens = takeAiTokens(FIRST, parse(FIRST, CTX), CTX)
    expect(tokens).toEqual(['!high', '/change', 'due:2026-08-07', '+portal'])
  })

  it('a payload that is not even an object leaves the screen alone', async () => {
    await readyWith(true)
    fx.setReply(reply('I cannot help with that'))
    await requestSuggestion(FIRST, parse(FIRST, CTX), CTX)
    expect(takeAiTokens(FIRST, parse(FIRST, CTX), CTX)).toBeNull()
  })
})
