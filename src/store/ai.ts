// AI capture assist, app side: the per-user switch, one suggestion at a time,
// and the diff that decides what a suggestion is still worth.
//
// ── THE FOUR THINGS THIS STORE EXISTS TO GET RIGHT ─────────────────────────
//
// 1. IT NEVER WRITES AN ENTRY, AND IT NEVER REWRITES A LINE. It holds a
//    `ValidatedSuggestion` and hands out TOKEN STRINGS from `lib/ai/toLine.ts`;
//    Capture appends them with its own `appendToken`, and `parse()` re-reads the
//    result. The keystone rule at src/pages/Capture.tsx:158-163 is not bent
//    here, which is why there is no `createEntry` in this file and why `title`
//    is dropped before anything is offered — see `newFields()`.
//
// 2. IT RE-VALIDATES THE REPLY AGAINST ITS OWN WORKSPACE. The edge function
//    validated the model's JSON already, against its read of the tracks and
//    members. The guarantee the feature rests on — "the parser will read this
//    line back as the fields that were approved" — only holds if the validator
//    and the parser see the SAME lists (lib/ai/types.ts:29). So the reply is put
//    through `validate()` again with the very `ParseContext` the capture screen
//    hands `parse()`. Belt and braces on the cheap side of a network call.
//
// 3. A SLOW ANSWER FOR AN OLD LINE IS DISCARDED. Every request takes an EPOCH; a
//    reply whose epoch is stale is dropped without touching state. Without it,
//    typing "deploy the switch" and then correcting it would show the first
//    line's suggestion under the second line's chips — a suggestion that is not
//    wrong so much as about something else, which is worse.
//
// 4. FAILURE IS SILENT ON THE CAPTURE SCREEN. Every error path logs and stops.
//    Capture has one promise — five seconds from thought to empty box — and an
//    error row from a third-party service is not part of it. The last failure IS
//    surfaced, on Settings › AI assist, which is where a person goes to ask why
//    the row stopped appearing. `lastError` is that channel and the only one.
//
// SHAPE. Narrow selectors, one store, derived values computed when data lands —
// the lifecycle of store/config.ts and store/push.ts. Like push.ts it holds its
// own preference read rather than routing it through api/: it is one column on
// one row, and this store is its only consumer.
//
// THE SWITCH IS SERVER-BACKED, following store/push.ts + NotificationPrefs.tsx,
// the app's only precedent for a per-user toggle — the same `notification_prefs`
// row, the same upsert-on-conflict, the same optimistic write with a SNAPSHOT
// rollback. Per user and not per device on purpose: "do not send my lines to a
// model" is a statement about a person, not about a browser.
//
// FAIL CLOSED. Nothing is sent until the preference has actually been read.
// There is no localStorage mirror and no optimistic default, because the failure
// a mirror would cause — a user who turned the feature off, a failed read, and
// lines going out anyway — is the one failure this feature may never have. A
// workspace whose prefs read fails simply captures the way it did before this
// wave, which is the whole degradation contract in one sentence.

import { create } from 'zustand'
import { supabase } from '../api/supabase'
import {
  MAX_LINE_CHARS,
  MIN_LINE_CHARS,
  readUsageToday,
  suggestFromLine,
  type AiTokenUse,
  type AiUsageToday,
} from '../api/ai'
import { toTokens } from '../lib/ai/toLine'
import { validate } from '../lib/ai/validate'
import type { AiContext, ValidatedSuggestion } from '../lib/ai/types'
import { getLocale } from '../lib/i18n'
import { pgErrorKey } from '../lib/pgError'
import type { ParsedEntry } from '../lib/capture/parse'

/** A suggestion, pinned to the exact line it is an answer to. */
export interface AiSuggestion {
  /** Byte-exact. A suggestion is only ever rendered against this line. */
  line: string
  /** Already through `lib/ai/validate.ts` with this client's own context. */
  suggestion: ValidatedSuggestion
  /** The model that answered, for the Settings footnote. */
  model: string
}

/** A prefs read that has not landed yet blocks every send. See the header. */
export type AiPrefsStatus = 'unknown' | 'ready'

interface AiState {
  enabled: boolean
  prefsStatus: AiPrefsStatus
  /** A preference write is in flight. The settings card disables together. */
  busy: boolean
  /** An i18n KEY, never a sentence. Rendered on Settings only. */
  lastError: string | null
  /** A suggest call is in flight for the current line. */
  pending: boolean
  suggestion: AiSuggestion | null
  /** Today's row of `ai_usage`, or null until it has been read. */
  usage: AiUsageToday | null
  usageLoading: boolean
  /** What the last answered call cost. Null until one is answered. */
  lastCost: AiTokenUse | null
  /** The daily ceiling, learned from a reply. The table cannot report it. */
  dailyLimit: number | null
}

const useAiStore = create<AiState>(() => ({
  // Enabled by default, but see `prefsStatus`: the default only decides what a
  // user with no row gets, never what happens before the row is read.
  enabled: true,
  prefsStatus: 'unknown',
  busy: false,
  lastError: null,
  pending: false,
  suggestion: null,
  usage: null,
  usageLoading: false,
  lastCost: null,
  dailyLimit: null,
}))

// ── selectors ──────────────────────────────────────────────────────────────

export function useAiEnabled(): boolean {
  return useAiStore((s) => s.enabled)
}

export function useAiPrefsReady(): boolean {
  return useAiStore((s) => s.prefsStatus === 'ready')
}

export function useAiBusy(): boolean {
  return useAiStore((s) => s.busy)
}

/** An i18n KEY. */
export function useAiError(): string | null {
  return useAiStore((s) => s.lastError)
}

export function useAiSuggestion(): AiSuggestion | null {
  return useAiStore((s) => s.suggestion)
}

export function useAiPending(): boolean {
  return useAiStore((s) => s.pending)
}

export function useAiUsage(): AiUsageToday | null {
  return useAiStore((s) => s.usage)
}

export function useAiUsageLoading(): boolean {
  return useAiStore((s) => s.usageLoading)
}

export function useAiLastCost(): AiTokenUse | null {
  return useAiStore((s) => s.lastCost)
}

export function useAiDailyLimit(): number | null {
  return useAiStore((s) => s.dailyLimit)
}

// ── the two pure decisions ─────────────────────────────────────────────────
//
// Both are exported and both are total. They are the parts of this feature that
// can be tested without a network, a browser or a model, which is why every
// judgement worth arguing about is inside one of them.

/**
 * Is this line PROSE — the only thing the assist fires on?
 *
 * "Prose" means one of two things, and the plan names both: the parser resolved
 * NO tokens (someone typed a sentence), or it resolved some and reported
 * problems (someone tried the grammar and it did not land). A line that parses
 * cleanly never calls the API — it is already understood, the chips under the
 * box say so, and a suggestion there would be a second opinion nobody asked for
 * on a question already answered.
 *
 * TWO REFUSALS THAT ARE NOT ABOUT PROSE:
 *   · a line carrying `every:` describes a recurring TEMPLATE. Which table a
 *     capture lands in is a decision the person typing has already made and a
 *     model may not revisit — the same reasoning behind REFUSED_FIELDS;
 *   · a line over MAX_LINE_CHARS. Settings promises "the line you typed" is what
 *     leaves the browser, and a pasted page of notes is not a line. That is
 *     Meeting Mode's job, and that screen asks first.
 */
export function shouldSuggest(line: string, parsed: ParsedEntry): boolean {
  const trimmed = line.trim()
  if (trimmed.length < MIN_LINE_CHARS || trimmed.length > MAX_LINE_CHARS) return false
  if (parsed.isEmpty) return false
  if (parsed.recurrence) return false
  const resolved = parsed.tokens.filter((token) => token.ok).length
  return resolved === 0 || parsed.problems.length > 0
}

/**
 * The suggestion MINUS everything the line already says.
 *
 * `ValidatedSuggestion`'s field names mirror `ParsedEntry`'s for exactly this
 * (lib/ai/types.ts:135), so the diff is field by field with no mapping table in
 * between.
 *
 * THIS IS THE HONEST PART. The row is rendered from this and APPLIED from this,
 * so what a person reads is precisely what Tab adds — never a chip that turns
 * out to be a no-op, and never a token that quietly duplicates one already on
 * the line. `#net deploy the switch next friday` gets a date and a type proposed
 * and its track left alone.
 *
 * THE TITLE IS ALWAYS DROPPED, and that is a decision about this surface rather
 * than about the model. `toLine()` exists for callers that replace the whole
 * line — Meeting Mode's triage is the one that should — but the capture box
 * holds words a person is in the middle of typing, and a suggestion that
 * rewrote them would be the assistant editing a sentence instead of enriching
 * it. Everything here is ADDITIVE: it can only append tokens, and every one of
 * them is a chip the user can knock off with a backspace.
 */
export function newFields(v: ValidatedSuggestion, parsed: ParsedEntry): ValidatedSuggestion {
  // Folded to lower case because the parser stores tags that way (normalizeTag)
  // while the model answers with whatever it read — an exact match would propose
  // `+Portal` onto a line that already carries `+portal`.
  const have = new Set(parsed.tags.map((tag) => tag.trim().toLowerCase()))
  return {
    title: null,
    trackId: parsed.trackId ? null : v.trackId,
    // `ownerName` covers the free-text case: a line reading `@Bob` where Bob is
    // not a member still names an owner, and proposing a different one over the
    // top of it would be overruling the person typing.
    ownerId: parsed.ownerId || parsed.ownerName ? null : v.ownerId,
    priority: parsed.priority ? null : v.priority,
    type: parsed.type ? null : v.type,
    dueDate: parsed.dueDate ? null : v.dueDate,
    followUpDate: parsed.followUpDate ? null : v.followUpDate,
    tags: v.tags.filter((tag) => !have.has(tag.trim().toLowerCase())),
    dropped: v.dropped,
  }
}

/**
 * What Tab will add: canonical tokens, in `toTokens()`'s fixed order.
 *
 * Returns an empty array when there is nothing left to offer, which is what the
 * row renders as nothing at all.
 */
export function suggestionTokens(
  suggestion: ValidatedSuggestion,
  parsed: ParsedEntry,
  ctx: AiContext,
): string[] {
  return toTokens(newFields(suggestion, parsed), ctx)
}

// ── preferences ────────────────────────────────────────────────────────────

/**
 * The signed-in user's id, read from Supabase rather than from store/auth.
 *
 * Same reasoning as store/push.ts and store/settings.ts: this store would
 * otherwise depend on the auth store's load order for a value the client
 * already holds authoritatively.
 */
async function currentUserId(): Promise<string | null> {
  if (!supabase) return null
  const { data } = await supabase.auth.getSession()
  return data.session?.user.id ?? null
}

/**
 * Postgres' `undefined_column`.
 *
 * `notification_prefs.ai_enabled` is this wave's one outstanding migration (see
 * the W-AI-APP handoff). Until it is applied, the read below fails with 42703 —
 * and that is NOT the same fact as a failed read. A column that does not exist
 * is a preference that cannot have been expressed, so the shipped default is the
 * complete and honest answer, and the feature works while the switch reports,
 * on Settings only, that it has nowhere to be saved yet. Every OTHER failure
 * still fails closed.
 */
const UNDEFINED_COLUMN = '42703'

function errorCode(error: unknown): string {
  return typeof error === 'object' && error !== null && 'code' in error
    ? String((error as { code?: unknown }).code ?? '')
    : ''
}

let prefsInFlight: Promise<void> | null = null

/**
 * Read the switch. Deduped, never rejects, and the gate every send waits on.
 *
 * Called from the suggestion row's mount effect, so it runs when capture opens
 * and nowhere else — a preference governing one screen has no business being
 * read by the shell on every cold start.
 *
 * A MISSING ROW IS SUCCESS. `notification_prefs` is created on first write (the
 * upsert below), so most users have no row at all and the shipped default is the
 * answer.
 */
export function loadAiPrefs(): Promise<void> {
  if (prefsInFlight) return prefsInFlight
  if (useAiStore.getState().prefsStatus === 'ready') return Promise.resolve()

  prefsInFlight = (async () => {
    try {
      if (!supabase) {
        useAiStore.setState({ lastError: 'common.notConfigured' })
        return
      }
      const { data, error } = await supabase
        .from('notification_prefs')
        .select('ai_enabled')
        .maybeSingle()
      if (error) {
        console.warn('[ai] preference read failed:', error.message)
        if (errorCode(error) === UNDEFINED_COLUMN) {
          useAiStore.setState({ prefsStatus: 'ready', lastError: 'ai.errPrefsMissing' })
          return
        }
        useAiStore.setState({ lastError: pgErrorKey(error) })
        return
      }
      const row = data as { ai_enabled: boolean } | null
      useAiStore.setState({
        enabled: row ? row.ai_enabled !== false : true,
        prefsStatus: 'ready',
        lastError: null,
      })
    } finally {
      prefsInFlight = null
    }
  })()

  return prefsInFlight
}

/**
 * Set the switch, optimistically, with a SNAPSHOT rollback.
 *
 * The snapshot rather than the inverse, which is store/push.ts's rule and
 * store/entries.ts's before it: a second toggle landing between the write and
 * its failure would otherwise be undone by the first one's rollback.
 *
 * TURNING IT OFF DROPS EVERYTHING IN MEMORY TOO. The cache holds lines the user
 * typed and the row may be on screen at the moment they flip it; a switch that
 * leaves either behind has not really been turned off.
 */
export async function setAiEnabled(value: boolean): Promise<string | null> {
  const snapshot = useAiStore.getState().enabled
  if (snapshot === value && useAiStore.getState().prefsStatus === 'ready') return null
  useAiStore.setState({ enabled: value, lastError: null, busy: true })
  if (!value) forget()

  try {
    if (!supabase) {
      useAiStore.setState({ enabled: snapshot, lastError: 'common.notConfigured' })
      return 'common.notConfigured'
    }
    const userId = await currentUserId()
    if (!userId) {
      useAiStore.setState({ enabled: snapshot, lastError: 'common.notSignedIn' })
      return 'common.notSignedIn'
    }
    // Upsert on the primary key: the first change a user ever makes creates
    // their row and every later one updates it. `user_id` is theirs by RLS on
    // both the insert check and the update predicate (migration 0011).
    const { error } = await supabase
      .from('notification_prefs')
      .upsert({ user_id: userId, ai_enabled: value }, { onConflict: 'user_id' })
    if (error) {
      console.warn('[ai] preference write failed:', error.message)
      const key = errorCode(error) === UNDEFINED_COLUMN ? 'ai.errPrefsMissing' : pgErrorKey(error)
      useAiStore.setState({ enabled: snapshot, lastError: key })
      return key
    }
    useAiStore.setState({ prefsStatus: 'ready' })
    return null
  } finally {
    useAiStore.setState({ busy: false })
  }
}

// ── suggestions ────────────────────────────────────────────────────────────

/**
 * The request epoch. Bumped by every ask and every dismissal; a reply carrying
 * an old one is discarded before it can touch state.
 *
 * A module-level counter rather than store state on purpose: it is control flow,
 * not something any component renders, and putting it in the store would
 * re-render every subscriber on every keystroke that starts a request.
 */
let epoch = 0

/**
 * Answers already paid for, keyed on the EXACT line.
 *
 * Exact, not normalised: the whole line is what was sent, and two lines
 * differing by a character are two different questions. The cache is what makes
 * backspacing over a word and retyping it free, which is the single most common
 * thing anyone does in a capture box — and each miss is a billed call.
 *
 * THE RAW PAYLOAD IS CACHED, NOT THE VALIDATED ONE. Validation depends on the
 * workspace and on the DATE: a suggestion of `due:tomorrow` validated at 23:58
 * is a past date two minutes later, and `validate()` drops past dates. Re-running
 * it on every read costs nothing and cannot go stale.
 *
 * Bounded and insertion-ordered — a Map re-inserts at the end, so deleting the
 * first key evicts the least recently ASKED. Nothing here survives a reload, and
 * nothing should: it is one session of one person's typing.
 */
const cache = new Map<string, { suggestion: unknown; model: string }>()
const CACHE_MAX = 40

/**
 * Lines the user has said no to.
 *
 * Without it, Esc dismisses a row that the next keystroke — or the next return
 * to this screen with the same text in the box — puts straight back. A
 * suggestion that cannot be turned down is one that has to be argued with, which
 * is exactly the friction this feature exists to remove.
 */
const dismissed = new Set<string>()
const DISMISSED_MAX = 60

function remember(line: string, entry: { suggestion: unknown; model: string }): void {
  if (cache.size >= CACHE_MAX) {
    const oldest = cache.keys().next()
    if (!oldest.done) cache.delete(oldest.value)
  }
  cache.set(line, entry)
}

/** Drop everything held about lines: the row, the cache, the refusals. */
function forget(): void {
  epoch += 1
  cache.clear()
  dismissed.clear()
  useAiStore.setState({ suggestion: null, pending: false })
}

/** Validate a raw payload against THIS client's workspace, then show it. */
function apply(line: string, raw: unknown, model: string, ctx: AiContext): void {
  const suggestion = validate(raw, ctx)
  if (suggestion.dropped.length > 0) {
    // Field names and reasons only — DroppedField carries no value by
    // construction (lib/ai/types.ts:120), so this line can never contain
    // anything the model wrote. It is how an owner finds out the prompt has
    // started inventing tracks.
    console.warn('[ai] dropped on the client:', suggestion.dropped)
  }
  useAiStore.setState({ suggestion: { line, suggestion, model }, pending: false })
}

/**
 * Ask what `line` means, unless there is a reason not to.
 *
 * NEVER CALLED PER KEYSTROKE — the caller debounces (AiSuggestion.tsx). Every
 * refusal below is silent and cheap, because this runs on a timer that fires
 * whenever typing stops, including the many times when the answer is "no".
 *
 * Never rejects. A failure records the key for Settings and leaves the capture
 * screen exactly as it was.
 */
export async function requestSuggestion(
  line: string,
  parsed: ParsedEntry,
  ctx: AiContext,
): Promise<void> {
  const state = useAiStore.getState()
  if (state.prefsStatus !== 'ready' || !state.enabled) return
  if (!shouldSuggest(line, parsed)) return
  if (dismissed.has(line)) return
  // Already showing the answer to this exact line. The effect re-runs whenever
  // `parsed` changes identity, which includes every re-render of the screen.
  if (state.suggestion?.line === line) return
  // Offline is a guaranteed failure with a round trip attached. Capture is
  // explicitly built to keep working offline (the outbox queues the write); the
  // assist simply stands down.
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return

  const mine = (epoch += 1)

  const hit = cache.get(line)
  if (hit) {
    // Re-inserted so the eviction order stays "least recently asked".
    cache.delete(line)
    cache.set(line, hit)
    apply(line, hit.suggestion, hit.model, ctx)
    return
  }

  useAiStore.setState({ pending: true })
  const result = await suggestFromLine(line, getLocale())

  // THE DISCARD. A newer line has been asked about, or the row was dismissed,
  // while this was in flight. `pending` is left alone: it belongs to whatever
  // bumped the epoch, and clearing it here would report the newer request as
  // finished.
  if (mine !== epoch) return

  if (!result.ok) {
    // Silent on the capture screen, by design. See this file's header.
    console.warn('[ai] suggestion failed:', result.error)
    useAiStore.setState({ pending: false, lastError: result.error })
    return
  }

  const entry = { suggestion: result.data.suggestion, model: result.data.model }
  // Cached even when nothing was understood: an empty answer is still an answer,
  // and asking again would spend a second call to be told so.
  remember(line, entry)
  useAiStore.setState({
    lastCost: result.data.usage,
    dailyLimit: result.data.dailyLimit > 0 ? result.data.dailyLimit : null,
    // The freshest count there is — it includes the call just made — so Settings
    // opened after a capture does not have to re-read the table.
    usage:
      result.data.dailyCalls === null
        ? useAiStore.getState().usage
        : {
            calls: result.data.dailyCalls,
            inputTokens: (useAiStore.getState().usage?.inputTokens ?? 0) + result.data.usage.inputTokens,
            outputTokens:
              (useAiStore.getState().usage?.outputTokens ?? 0) + result.data.usage.outputTokens,
          },
    lastError: null,
  })
  apply(line, entry.suggestion, entry.model, ctx)
}

/**
 * Take the suggestion for `line` as TOKENS, if that is still what is showing.
 *
 * The line argument is the guard, not decoration: this is called from a keydown
 * handler on the capture input, and between the reply landing and the key being
 * pressed the box may have changed under it. Applying a suggestion computed for
 * different words is the one failure that would put wrong data in an entry.
 *
 * Returns the token strings and clears the row. NOT marked dismissed: accepting
 * changes the line, so the same suggestion cannot re-fire anyway, and a user who
 * removes the chips again is entitled to be offered them again.
 */
export function takeAiTokens(line: string, parsed: ParsedEntry, ctx: AiContext): string[] | null {
  const current = useAiStore.getState().suggestion
  if (!current || current.line !== line) return null
  const tokens = suggestionTokens(current.suggestion, parsed, ctx)
  epoch += 1
  useAiStore.setState({ suggestion: null, pending: false })
  return tokens.length > 0 ? tokens : null
}

/**
 * Esc, and the row's own dismiss button. Cancels anything in flight too.
 *
 * A NO-OP WHEN THERE IS NOTHING TO DISMISS, and that guard is what lets
 * Capture's input call this on every Escape without a subscription to this
 * store. Without it, pressing Esc on a line that had never produced a suggestion
 * would silently add that line to the refusals — and the user would then type
 * one more word, watch the row appear, and never understand why it had not
 * appeared a moment earlier.
 */
export function dismissSuggestion(line: string): void {
  const state = useAiStore.getState()
  if (state.suggestion?.line !== line && !state.pending) return
  if (dismissed.size >= DISMISSED_MAX) dismissed.clear()
  dismissed.add(line)
  epoch += 1
  useAiStore.setState({ suggestion: null, pending: false })
}

/**
 * "This suggestion was wrong" — the other half of the Preview convention.
 *
 * WHAT IT DOES TODAY, precisely: the row goes, the line is dismissed so it
 * cannot come back, the ANSWER IS EVICTED FROM THE CACHE so the same words are
 * asked about afresh rather than handed the same miss again, and the fields the
 * model proposed are logged by name. A correction the feature ignores is not a
 * correction.
 *
 * WHAT IT DOES NOT DO YET: persist. There is no feedback table and no `report`
 * action on `capture-assist` — 0020 deliberately stores no prompt or response
 * text, and inventing a home for one is a migration, which is not this worker's
 * file. The exact shape needed is in the W-AI-APP handoff note: field NAMES and
 * a timestamp, never the line and never the values, so the reporting path cannot
 * reopen the injection hole `validate()` closes on the capture path.
 *
 * The button is honest about this: it says the suggestion was ignored, and does
 * not claim a record it cannot show.
 */
export function reportSuggestionMiss(line: string): void {
  const current = useAiStore.getState().suggestion
  if (current && current.line === line) {
    const s = current.suggestion
    // Names, never values — the same rule DroppedField follows.
    const fields = (
      [
        ['trackId', s.trackId],
        ['ownerId', s.ownerId],
        ['priority', s.priority],
        ['type', s.type],
        ['dueDate', s.dueDate],
        ['followUpDate', s.followUpDate],
        ['tags', s.tags.length > 0 ? 'yes' : null],
      ] as const
    )
      .filter(([, value]) => value !== null)
      .map(([field]) => field)
    console.warn(`[ai] reported wrong · model=${current.model} · proposed=${fields.join(',')}`)
  }
  cache.delete(line)
  dismissSuggestion(line)
}

// ── usage ──────────────────────────────────────────────────────────────────

/**
 * Today's count, for the settings screen.
 *
 * A read of its own rather than a value harvested from the last suggestion:
 * someone opening Settings to find out how much they have used has, by
 * definition, not just captured anything.
 */
export async function loadAiUsage(): Promise<void> {
  useAiStore.setState({ usageLoading: true })
  try {
    const result = await readUsageToday()
    if (result.ok) {
      useAiStore.setState({ usage: result.data, lastError: null })
      return
    }
    console.warn('[ai] usage read failed:', result.error)
    useAiStore.setState({ lastError: result.error })
  } finally {
    useAiStore.setState({ usageLoading: false })
  }
}

/**
 * Sign-out. The switch belongs to the account that just left, and so does every
 * line it typed.
 *
 * THE CACHE IS THE POINT. It holds raw capture lines — the most sensitive text
 * this feature touches — in a module-level Map that outlives the React tree.
 * Clearing the zustand state without clearing it would leave one user's unfiled
 * thoughts readable by the next person to sign in on this browser, which is
 * precisely the failure store/meetings.ts's reset was written for.
 *
 * Wired from Shell's unmount cleanup in src/App.tsx; store/signOutReset.test.ts
 * asserts that it actually is.
 */
export function resetAi(): void {
  prefsInFlight = null
  forget()
  useAiStore.setState({
    enabled: true,
    prefsStatus: 'unknown',
    busy: false,
    lastError: null,
    usage: null,
    usageLoading: false,
    lastCost: null,
    dailyLimit: null,
  })
}
