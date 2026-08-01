// AI capture assist, client side: one edge function call, and one usage read.
//
// ── WHAT THIS LAYER IS ALLOWED TO BE ───────────────────────────────────────
//
// The keystone rule of quick capture (src/pages/Capture.tsx:158-163) is that
// every control edits the INPUT STRING and never a parallel model, and `parse()`
// is the single authority over what a line means. THE AI THEREFORE NEVER WRITES
// AN ENTRY. It proposes; `src/lib/ai/validate.ts` drops everything that does not
// survive contact with the real workspace; `toTokens()` turns what is left into
// canonical capture tokens; Capture appends them to the line with its own text
// surgery; and `parse()` re-reads the result exactly as it re-reads a line typed
// by hand.
//
// THE PAYLOAD COMES BACK AS `unknown`, AND THAT IS THE POINT. The edge function
// already validated the model's JSON against the workspace — but it validated
// against ITS read of the tracks and members, and the guarantee this feature
// rests on ("the parser will read this line back as the fields that were
// approved") only holds when the validator and the parser are looking at the
// same lists. So the client re-validates the reply through `lib/ai/validate.ts`
// against the very `ParseContext` the capture screen hands `parse()`. Typing the
// wire as `ValidatedSuggestion` here would announce a trust this module does not
// have and cannot check; `unknown` says the true thing.
//
// THE DEGRADATION CONTRACT IS A HARD REQUIREMENT: if the function is slow, down,
// rate-limited, or answers nonsense, capture must behave EXACTLY as it does
// today. Every function here returns ApiResult rather than throwing, and the
// caller's only recourse for a failure is to show nothing.
//
// ── THE WIRE ───────────────────────────────────────────────────────────────
//
// `supabase/functions/capture-assist` — the shapes below MIRROR that file and
// are the reason this module exists as a seam:
//
//   POST { line, locale }
//     200 → { ok, suggestion, usage: { inputTokens, outputTokens },
//             dailyCalls, dailyLimit, model }
//     4xx/5xx → { error, code } where `code` is its `AssistCode` union
//
// WHAT LEAVES THE BROWSER: the capture line and the UI locale. Nothing else.
// The track and member NAMES the model needs for grounding are read server-side
// from the caller's own workspace under their JWT — they are not sent from here,
// and no entry history, no updates and no other line ever is. That sentence is
// repeated to the user in Settings › AI assist, which is the only reason it is
// worth writing twice.

import { supabase } from './supabase'
import { fail, notConfigured, type ApiResult } from './result'
import { pgErrorKey } from '../lib/pgError'
import type { Locale } from '../lib/i18n'

/**
 * What one billed call cost, as the upstream API reported it.
 *
 * Carried into the UI rather than logged, because "cost measured, not
 * estimated" is a stated requirement of this wave and a number nobody can see
 * is not a measurement.
 */
export interface AiTokenUse {
  inputTokens: number
  outputTokens: number
}

/** One answered suggestion, exactly as `capture-assist` frames it. */
export interface AiReply {
  /**
   * The model's proposal AFTER the function validated it — and still untrusted
   * here. Handed to `lib/ai/validate.ts` with the client's own context before
   * anything reads a field off it. See this file's header.
   */
  suggestion: unknown
  usage: AiTokenUse
  /** Calls made today INCLUDING this one, or null if the ledger write failed. */
  dailyCalls: number | null
  /** The per-member daily ceiling the function enforces. */
  dailyLimit: number
  /** The model that answered. Rendered in Settings so a change is visible. */
  model: string
}

/** Today's row of `ai_usage`, read straight from the table under its own RLS. */
export interface AiUsageToday {
  calls: number
  inputTokens: number
  outputTokens: number
}

const NO_USAGE: AiUsageToday = { calls: 0, inputTokens: 0, outputTokens: 0 }

/**
 * The longest line this client will send, and it MATCHES the function's own
 * `MAX_LINE_CHARS`.
 *
 * The two differ in what they do at the boundary, deliberately: the function
 * TRUNCATES (it must accept whatever arrives), and this refuses. Settings
 * promises "the line you typed" is what leaves the browser, and half of a
 * pasted page is not that. A paste that long belongs in Meeting Mode, which
 * asks before it sends anything.
 */
export const MAX_LINE_CHARS = 400

/** Shorter than this is not prose, it is a keystroke. The function agrees. */
export const MIN_LINE_CHARS = 8

/**
 * How long the client waits for a suggestion before giving up on it.
 *
 * `functions.invoke` takes a `timeout` and aborts the request itself, so a hung
 * upstream costs one aborted fetch rather than a promise that never settles and
 * a `pending` flag that never clears. The function's own upstream budget is
 * shorter than this, so in practice this only fires when the FUNCTION is
 * wedged — and when it does, the row simply never appears.
 */
const SUGGEST_TIMEOUT_MS = 15000

/**
 * `capture-assist`'s machine codes, mapped to keys.
 *
 * One entry per member of its exported `AssistCode` union, and the lookup falls
 * back to `common.error` for one it does not carry — a client left open in a tab
 * across a function deploy degrades to a sentence rather than rendering a raw
 * dot path.
 *
 * NONE OF THESE REACHES THE CAPTURE SCREEN. store/ai.ts swallows every failure
 * so that capture cannot change shape because a third party had a bad minute;
 * they are rendered on Settings › AI assist, which is where a person goes to
 * find out why the row stopped appearing.
 */
export const AI_ERROR_KEYS: Readonly<Record<string, string>> = {
  not_signed_in: 'common.notSignedIn',
  invalid_body: 'common.error',
  // The client is supposed to hold the call until the line is prose, so this
  // is a bug rather than a sentence anyone should read.
  line_too_short: 'common.error',
  rate_limited: 'ai.errBusy',
  daily_limit: 'ai.errLimit',
  no_api_key: 'ai.errUnconfigured',
  workspace_read_failed: 'common.error',
  upstream_error: 'ai.errUpstream',
  upstream_timeout: 'ai.errUpstream',
  // The model declined to answer at all — a different fact from a service that
  // fell over, and worth its own sentence when someone goes looking.
  upstream_refused: 'ai.errRefused',
  unusable_reply: 'ai.errUpstream',
  server_error: 'common.error',
}

/**
 * The edge function's failure, mapped to a key.
 *
 * THE `.clone()` IS LOAD-BEARING, and this is the same unwrap api/members.ts
 * documents at :247-269. supabase-js collapses every non-2xx into a
 * FunctionsHttpError whose message is a constant; the status and the JSON body
 * are reachable only through `.context`, the raw Response. A Response body is a
 * one-shot stream, so reading `ctx.json()` directly consumes the body that
 * supabase-js may still hold a reference to, and the second reader — here, or a
 * caller wanting the raw text for a bug report — gets a TypeError instead of the
 * payload. Cloning first costs one buffer and makes the read repeatable.
 *
 * Kept local rather than shared with members.ts, exactly as members.ts keeps its
 * copy separate from store/auth.ts's: they differ in the code table they consult
 * and in what they do with the English sentence, and one helper serving all
 * three would serve each of them badly.
 */
async function edgeErrorKey(error: unknown): Promise<string> {
  const err = error as { name?: string; context?: unknown }
  // No response at all: DNS, TLS, an offline device, or the abort the timeout
  // above raised. Nothing was refused, so it must not read as a refusal.
  if (err.name === 'FunctionsFetchError') return 'ai.errNetwork'
  const ctx = err.context
  if (ctx instanceof Response) {
    try {
      const body = (await ctx.clone().json()) as { error?: unknown; code?: unknown }
      // Logged, never rendered: the function answers in English and this app has
      // an Arabic half. A bug report needs the sentence; the user does not.
      if (typeof body.error === 'string') console.warn('[ai] capture-assist:', body.error)
      if (typeof body.code === 'string' && body.code in AI_ERROR_KEYS) {
        return AI_ERROR_KEYS[body.code]
      }
    } catch {
      // A gateway HTML error page tells us nothing worth logging.
    }
    if (ctx.status === 401) return 'common.notSignedIn'
    if (ctx.status === 429) return 'ai.errBusy'
  }
  return 'common.error'
}

// ── total readers ──────────────────────────────────────────────────────────
//
// EVERYTHING BELOW ASSUMES THE BODY IS GARBAGE UNTIL PROVEN OTHERWISE. Not
// defensiveness for its own sake: this payload begins its life as the output of
// a language model, and the function is the piece most likely to be redeployed
// with a changed shape. A client that threw on an unexpected field would take
// the capture screen down with it — the one screen that may never break.

function num(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

/**
 * The token counts, normalised.
 *
 * Exported for its test, the api/members.ts `toMemberAccount()` convention. A
 * missing or malformed usage block reads as zero rather than as an error: these
 * numbers are a courtesy on a settings screen, and failing a suggestion because
 * the figure beside it was unreadable would be the tail wagging the dog.
 */
export function toTokenUse(raw: unknown): AiTokenUse {
  if (typeof raw !== 'object' || raw === null) return { inputTokens: 0, outputTokens: 0 }
  const r = raw as Record<string, unknown>
  return { inputTokens: num(r.inputTokens), outputTokens: num(r.outputTokens) }
}

/** The whole reply, normalised. `suggestion` is passed through untouched. */
export function toReply(raw: unknown): AiReply {
  const r = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>
  return {
    suggestion: r.suggestion,
    usage: toTokenUse(r.usage),
    // null and "the ledger write failed" are the same fact — see the function's
    // step 10 — so anything unreadable becomes null rather than a made-up zero,
    // which would read as "you have used none of your quota".
    dailyCalls: typeof r.dailyCalls === 'number' && Number.isFinite(r.dailyCalls) ? r.dailyCalls : null,
    dailyLimit: num(r.dailyLimit),
    model: typeof r.model === 'string' ? r.model : '',
  }
}

// ── the two calls ──────────────────────────────────────────────────────────

/**
 * Ask what this line means. One billed call.
 *
 * The refusals here are the client's half of the cost and privacy controls: an
 * empty client, a line too short to mean anything, and a line too long to be a
 * line. The function repeats all three, because "the client will not do that" is
 * not a security property — but repeating them here is what keeps the round trip
 * from being made at all.
 *
 * NO `today` ON THE WIRE. The function computes the workspace day itself, in
 * Asia/Riyadh (migration 0020's `ai_usage_day()`), so "next friday" resolves
 * against the workspace's calendar rather than against whatever timezone a
 * laptop is carrying through an airport.
 */
export async function suggestFromLine(line: string, locale: Locale): Promise<ApiResult<AiReply>> {
  if (!supabase) return notConfigured()
  const trimmed = line.trim()
  if (trimmed.length < MIN_LINE_CHARS) return fail('common.error')
  if (trimmed.length > MAX_LINE_CHARS) return fail('ai.errTooLong')

  const { data, error } = await supabase.functions.invoke('capture-assist', {
    body: { line: trimmed, locale },
    timeout: SUGGEST_TIMEOUT_MS,
  })
  if (error) return fail(await edgeErrorKey(error))
  return { ok: true, data: toReply(data) }
}

/**
 * Today's usage, read STRAIGHT FROM THE TABLE.
 *
 * Migration 0020 grants `select` on `ai_usage` to authenticated and adds
 * `ai_usage_select_self`, precisely so that Settings can render this without a
 * second edge function and without spending a suggestion to learn how many have
 * been spent. Its header says so.
 *
 * THE DAY COMES FROM THE DATABASE, not from the browser. `ai_usage.day` is the
 * workspace day in Asia/Riyadh; a client that filtered on its own `toIsoDate()`
 * would answer "0 calls today" for the first three hours of every day for anyone
 * sitting west of the workspace, which is the kind of wrong that gets read as a
 * broken feature rather than as a timezone.
 *
 * A missing row is SUCCESS: nobody has used it today. Same reading as
 * `ai_usage_today()`'s own `coalesce`.
 */
export async function readUsageToday(): Promise<ApiResult<AiUsageToday>> {
  if (!supabase) return notConfigured()
  const { data: day, error: dayError } = await supabase.rpc('ai_usage_day')
  if (dayError) return fail(pgErrorKey(dayError))
  if (typeof day !== 'string') return fail('common.error')

  const { data, error } = await supabase
    .from('ai_usage')
    // Narrow, per the hard rules. `user_id` is redundant under a self-only
    // policy and would be one more identifier on the wire for no reader.
    .select('calls, input_tokens, output_tokens')
    .eq('day', day)
    .maybeSingle()
  if (error) return fail(pgErrorKey(error))

  const row = data as { calls: number; input_tokens: number; output_tokens: number } | null
  if (!row) return { ok: true, data: NO_USAGE }
  return {
    ok: true,
    data: {
      calls: num(row.calls),
      // bigint columns arrive as numbers here (well inside 2^53 for a team of
      // three), but they arrive as strings from some PostgREST versions — num()
      // answers 0 for a string, which is wrong, so they are coerced explicitly.
      inputTokens: Number(row.input_tokens) || 0,
      outputTokens: Number(row.output_tokens) || 0,
    },
  }
}
