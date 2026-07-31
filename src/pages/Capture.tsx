// The five-second capture bar: one line in, one row out.
//
// THE WHOLE SCREEN IS ONE PROMISE — the time between "I have a thought" and
// "the box is empty again" is under five seconds, on a phone, one-handed. Every
// decision below is downstream of that:
//
//  · the input is focused on mount and REFOCUSED after every action, because a
//    capture bar you have to tap first is a capture bar you use once. The mount
//    focus places the CARET only — it cannot raise a phone's keyboard, and the
//    effect at the bottom of the state block says why and where the fix has to
//    live. The refocus after an action does raise it, because it runs inside
//    the tap;
//  · the line is parsed on EVERY keystroke, so the chips underneath are the
//    live answer to "did it understand me?" — the user never submits blind;
//  · Enter submits and the input clears BEFORE the await, not after it. The
//    network is not on the critical path of the next thought. The optimistic
//    row is already in the store by the time createEntryOptimistic() returns;
//  · a failed write puts the words BACK in the box (capture.errSave says so),
//    because the one thing this screen may never do is eat a sentence.
//
// IT REIMPLEMENTS NOTHING. The grammar is lib/capture/parse (pure, total, never
// throws — which is what makes per-keystroke parsing safe); the write is
// store/entries.createEntryOptimistic, which is already routed through the
// outbox by main.tsx, so an offline capture QUEUES rather than fails; the rows
// underneath are the Wave-1 entry kit. This file owns the assembly and nothing
// else.
//
// OFFLINE IS A FIRST-CLASS PATH, not an error path. `createEntryOptimistic`
// answers `fail('offline.queued')` when the write was queued — a NOTICE, not a
// failure: the optimistic row stays, and the toast says so and still offers
// Undo. Treating that key as an error would roll back a row the queue owns.
//
// ONE BOX, TWO TABLES. A line carrying `every:` describes a RECIPE, not an
// item: `toNewEntry()` refuses it by contract and `toRecurringTemplateInput()`
// is the other half of that pair, so Enter writes `recurring_templates` instead
// and the notice under the box names the screen that manages them. It used to
// refuse the line outright and say the feature shipped "in a later release" —
// with /settings/recurring already two taps away in Settings and this screen's
// own hint teaching the token. A screen must never teach a grammar it then
// rejects. The template write is NOT optimistic and NOT queued: there is no
// template store to hold a provisional row, so offline is a plain failure and
// the words go back in the box, exactly as a failed entry write does.
//
// ROUTING. `/capture` is reached from the mobile FAB (App.tsx hides it on this
// route) and, from Wave 4, the `C` hotkey and the command palette. All three are
// plain navigations — the screen self-loads everything it needs, so none of them
// has to know anything about it beyond the path.
//
// ONE optional seed: `/capture?q=<line>` pre-fills the box. That is the whole
// contract a palette entry ("capture: chase the vendor") or a share-target needs,
// and it is a query param rather than router state because a hash URL survives a
// reload, a bookmark and a Capacitor deep link, while `navigate(..., {state})`
// survives none of them. Nothing else reads the route.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import type { FormEvent, ReactElement } from 'react'
import { canSubmit, parse, toNewEntry, toRecurringTemplateInput } from '../lib/capture/parse'
import type {
  ParseContext,
  ParseMember,
  ParseProblem,
  ParseTrack,
  ParsedEntry,
  ParsedToken,
  TokenKind,
} from '../lib/capture/parse'
import {
  createEntryOptimistic,
  loadEntries,
  undoCapture,
  useEntry,
  useEntryHealth,
  usePendingOp,
} from '../store/entries'
import { getOutboxSnapshot } from '../store/outbox'
import { useActiveTracks, useTrackMap } from '../store/config'
import { loadMembers, useMembers } from '../store/members'
import { getVocabSnapshot, useVocabAll, useVocabLabel } from '../store/vocab'
import type { VocabItem } from '../store/vocab'
import { openEntry } from '../store/entrySheet'
// The one write on this screen that has no store in front of it — see
// submitTemplate(). Stores first, then the api layer, as MeetingTriage orders it.
import { createTemplate } from '../api/templates'
import { EntryRow } from '../components/entry'
import { toast } from '../components/toast'
import { IconBolt, IconClock, IconWifiOff } from '../components/icons'
import { isolateTokens } from '../lib/bidi'
import { formatDate } from '../lib/dates'
import { t, useLocale } from '../lib/i18n'
import { useTrackLabel } from '../lib/labels'
import { truncate } from '../lib/text'
import { trackVars } from '../lib/trackStyle'
import type { Cadence, Track, VocabKind, VocabRow } from '../types'
import './capture.css'

/** How many of this session's captures the list underneath keeps. */
const RECENT_LIMIT = 5
/** Titles past this read as a paragraph in a list. A notice, never a block. */
const LONG_TITLE = 90
/** Debounce before the screen-reader region announces the token count. */
const ANNOUNCE_MS = 700
/** What the outbox answers with when it queued a write instead of sending it. */
const QUEUED_KEY = 'offline.queued'

/** The sigil that produced each token kind — the one label that needs no
 *  translation, and the fastest way to read a chip strip at a glance. */
const KIND_SIGIL: Readonly<Record<TokenKind, string>> = {
  track: '#',
  owner: '@',
  priority: '!',
  type: '/',
  tag: '+',
  due: 'due:',
  followUp: 'fu:',
  recurring: 'every:',
  unknown: '?',
}

const KIND_LABEL: Readonly<Record<TokenKind, string>> = {
  track: 'capture.chipTrack',
  owner: 'capture.chipOwner',
  priority: 'capture.chipPriority',
  type: 'capture.chipType',
  tag: 'capture.chipTag',
  due: 'capture.chipDue',
  followUp: 'capture.chipFollowUp',
  recurring: 'capture.chipRecurring',
  unknown: 'capture.chipUnknown',
}

/**
 * One parser problem, as the sentence a person reads.
 *
 * `kind` arrives from the parser as a raw TokenKind — a token classification,
 * not a user-facing word — so it is swapped for the localised chip label before
 * interpolation. Shared by the live panel under the box and the "Just captured"
 * card, which must say the SAME sentence: the panel is the warning before the
 * write and the card is the record of it afterwards, and two wordings for one
 * fact would read as two different problems.
 */
function problemText(problem: ParseProblem): string {
  return t(problem.key, {
    ...problem.vars,
    ...(problem.token ? { kind: t(KIND_LABEL[problem.token.kind]) } : {}),
  })
}

const CADENCE_LABEL: Readonly<Record<Cadence, string>> = {
  daily: 'capture.cadenceDaily',
  weekly: 'capture.cadenceWeekly',
  biweekly: 'capture.cadenceBiweekly',
  monthly: 'capture.cadenceMonthly',
  quarterly: 'capture.cadenceQuarterly',
  custom: 'capture.cadenceCustom',
}

// ── text surgery ───────────────────────────────────────────────────────────
//
// Every chip control edits the INPUT STRING, never a parallel model. The line
// the user typed is the only state; the chips are a view of it. That is what
// makes "remove this chip" and "backspace over it" the same operation, and it
// is why every token carries a byte-exact [start, end) — see ParsedToken.

/**
 * Cut `[start, end)` out, and close the seam.
 *
 * The space test is one-sided on purpose: a token with a space on BOTH sides
 * takes one with it (`a #net b` → `a b`), and a token at either edge does not
 * (`#net b` → `b`, after the leading trim). Collapsing all runs of whitespace
 * instead would rewrite parts of the title the user never touched.
 */
function removeSpan(text: string, start: number, end: number): string {
  const before = text.slice(0, start)
  const after = text.slice(end)
  const joined = before.endsWith(' ') && after.startsWith(' ') ? before + after.slice(1) : before + after
  return joined.replace(/^\s+/, '')
}

function replaceSpan(text: string, start: number, end: number, replacement: string): string {
  return text.slice(0, start) + replacement + text.slice(end)
}

/**
 * `IT Operations` → `"IT Operations"`.
 *
 * A token value runs to the next whitespace unless it is quoted, so writing a
 * two-word track name back into the line unquoted would produce `#IT` plus a
 * stray `Operations` in the title.
 */
function quoteIfNeeded(value: string): string {
  return /[\s"]/.test(value) ? `"${value.replace(/"/g, '')}"` : value
}

/** Append a token and leave the caret a space past it, ready to keep typing. */
function appendToken(text: string, token: string): string {
  const base = text.replace(/\s+$/, '')
  return base === '' ? `${token} ` : `${base} ${token} `
}

// ── vocab aliases ──────────────────────────────────────────────────────────

/**
 * The admin's renamed labels, in BOTH languages, so `!عاجل جدا` resolves the
 * moment someone calls `critical` that — in an English UI as much as an Arabic
 * one, because the language a workspace types in and the language its interface
 * is set to are not the same question.
 *
 * Only NON-EMPTY labels become aliases. `vocab_options.label` is
 * `not null default ''` and an empty string means "no override" (see
 * store/vocab's fallback chain), so feeding the blanks in would map every key to
 * the empty string and swallow the parser's own alias table.
 *
 * `items` supplies the key list and the SUBSCRIPTION; `rows` supplies the two
 * labels a VocabItem has already collapsed into one. Both come from the same
 * store state, so they cannot disagree.
 */
function aliasesFor(
  items: readonly VocabItem[],
  rows: readonly VocabRow[],
  kind: VocabKind,
): Record<string, string[]> {
  const out: Record<string, string[]> = {}
  for (const item of items) {
    const row = rows.find((r) => r.kind === kind && r.key === item.key)
    const words = [row?.label ?? '', row?.label_ar ?? ''].filter((w) => w.trim() !== '')
    if (words.length > 0) out[item.key] = words
  }
  return out
}

/** What the confirmation toast says, and what its one button does. */
export interface CaptureConfirmation {
  /** The i18n key for the sentence. */
  key: string
  /** `success` paints the green border; anything unresolved must not. */
  tone: 'default' | 'success'
  /** Show the offline glyph — a fact about WHERE it is, not about the parse. */
  offline: boolean
  /**
   * `undo` deletes the row; `open` opens the sheet so the fields can be fixed.
   * `null` when there is no id to act on, which happens only if a queued write
   * cannot be found in the outbox.
   */
  action: 'undo' | 'open' | null
}

/**
 * The confirmation decision, LIFTED OUT so it can be tested.
 *
 * Same reason CommandPalette.tsx lifts `shouldRestoreFocus()`: vitest runs
 * `environment: 'node'`, so a decision taken inside an event handler is a
 * decision no test in this repo can reach. Every branch below used to be a
 * ternary inside `raiseCaptured` and the most important one did not exist at
 * all — `problems` was never consulted, so a line whose track, owner and date
 * all failed to resolve was confirmed with `tone: 'success'` and an Undo
 * button, indistinguishable from a line that parsed perfectly.
 *
 * The rule in one sentence: OFFLINE changes where it is, PROBLEMS change
 * whether it is right, and the two are independent — a queued capture can also
 * be a misparsed one, and the sentence has to be able to say both.
 */
export function confirmationFor(
  queued: boolean,
  problems: number,
  hasId: boolean,
): CaptureConfirmation {
  const clean = problems === 0
  return {
    key: clean
      ? queued
        ? 'capture.capturedQueued'
        : 'capture.captured'
      : queued
        ? 'capture.capturedQueuedIssues'
        : 'capture.capturedIssues',
    // A queued write is not a failure, but it is not a completed one either —
    // it has always been neutral, and it stays neutral.
    tone: clean && !queued ? 'success' : 'default',
    offline: queued,
    // Undo is the right button for a line that was a mistake in whole. It is
    // the WRONG button for a line that is correct except for two fields, and
    // "delete it and type it again" was the only remedy this screen offered
    // for the case it never reported.
    action: !hasId ? null : clean ? 'undo' : 'open',
  }
}

/**
 * One row in the "Just captured" list.
 *
 * It carries the PROBLEMS as well as the id, because the toast that reported
 * them is gone within seconds and the panel that listed them unmounted the
 * moment the box cleared. Without this, a capture whose owner and date failed
 * left no trace on screen at all: the saved row shows an empty owner and no
 * due date, and `DueLabel` renders nothing for a null date, so there is not
 * even a gap where the answer should be.
 *
 * The parser's own `ParseProblem` objects, not localised sentences: they are
 * plain data, and holding them unresolved means the list re-renders correctly
 * when the language is switched under it.
 */
interface RecentCapture {
  id: string
  problems: readonly ParseProblem[]
}

/**
 * The temp id of the create we just queued.
 *
 * `createEntryOptimistic` returns `fail('offline.queued')` with no payload, so
 * the id of the row it left on screen has to be recovered from the queue —
 * without it the toast could not offer Undo and the row could not join the
 * "just captured" list, which is exactly when a user most wants both.
 *
 * Newest-first, and it reads the op rather than guessing from the store: the
 * op is the one this call enqueued. Extension slot in the handoff — the clean
 * fix is for the store to hand the temp id back on the queued branch.
 */
function lastQueuedEntryTempId(): string | null {
  const items = getOutboxSnapshot()
  for (let i = items.length - 1; i >= 0; i -= 1) {
    const op = items[i].op
    if (op.table === 'entries' && op.op === 'insert' && op.tempId) return op.tempId
  }
  return null
}

export default function Capture(): ReactElement {
  const locale = useLocale()
  const tracks = useActiveTracks()
  const trackMap = useTrackMap()
  const trackLabel = useTrackLabel()
  const members = useMembers()
  const vocabLabel = useVocabLabel()
  const priorityItems = useVocabAll('priority')
  const typeItems = useVocabAll('type')

  const [params] = useSearchParams()
  const seed = params.get('q') ?? ''
  const navigate = useNavigate()

  const [text, setText] = useState(seed)
  const [busy, setBusy] = useState(false)
  /** An i18n KEY, never a sentence — same rule the stores follow. */
  const [error, setError] = useState<string | null>(null)
  /** The title of a failed capture that could not be put back in the box. */
  const [heldTitle, setHeldTitle] = useState('')
  const [recent, setRecent] = useState<RecentCapture[]>([])
  const [showHints, setShowHints] = useState(false)
  const [announce, setAnnounce] = useState('')

  const inputRef = useRef<HTMLInputElement>(null)
  /** The seed already applied, so a re-render never re-fills the box under
   *  someone who has since edited (or submitted) the line. */
  const seededRef = useRef(seed)
  /**
   * What is in the box RIGHT NOW, readable after an await.
   *
   * `handleSubmit`'s closure holds the line as it was when Enter was pressed —
   * which is the whole point for the payload, and exactly wrong for deciding
   * whether it is safe to write to the box afterwards. Kept in an effect rather
   * than assigned during render: effects have flushed by the time any promise
   * this component started can resolve, so the value is always current where it
   * is read.
   */
  const textRef = useRef(text)
  useEffect(() => {
    textRef.current = text
  }, [text])

  // A second navigation to /capture?q=… does NOT remount this component — the
  // route element is the same — so the seed has to be applied on change as well
  // as at mount. An empty `q` is left alone: arriving from the FAB must not wipe
  // a line the user was part-way through when they tabbed away.
  useEffect(() => {
    if (seed === '' || seed === seededRef.current) return
    seededRef.current = seed
    setText(seed)
  }, [seed])

  // Tracks and vocabulary are warmed by the Shell; members and entries are not.
  // Both loaders dedupe and neither rejects, so this is safe unawaited and safe
  // to run beside another screen doing the same.
  //
  // `loadEntries` is here for the list underneath: a capture made in a previous
  // session still belongs to that entry's row, and the health map the row reads
  // arrives with it.
  useEffect(() => {
    void loadMembers()
    void loadEntries()
  }, [])

  // Focus on mount, once. A ref rather than autoFocus, matching SignIn.tsx:
  // autoFocus fires only on the first mount of the element and silently does
  // nothing when the route is re-entered.
  //
  // THIS PLACES THE CARET. IT DOES NOT RAISE THE SOFTWARE KEYBOARD, and the
  // comment that used to sit here claimed otherwise — "the FAB and the `C`
  // hotkey both land here meaning 'I want to type', so the keyboard should
  // already be up". It never is on the FAB path, which is the only mobile path:
  // NAV[0] sets `inTabBar: false` for /capture and app-shell.css hides `.fab`
  // at ≥768px, so a phone reaches this screen through the FAB or not at all.
  // WebKit raises the keyboard only for a focus() taken inside the user
  // activation call stack — Chromium gates it the same way — and three separate
  // barriers put this call outside it: the route is `lazy()`, so on a first
  // visit the chunk resolves in a later task; react-router v7 wraps the
  // navigation in startTransition; and a passive effect is scheduled after
  // paint even with the chunk warm. So the caret blinks and the keyboard stays
  // down, and the user taps the box a second time.
  //
  // WHY IT STAYS. On desktop — the `C` hotkey and the command palette, where a
  // hardware keyboard is already present — placing the caret IS the whole win,
  // and it costs nothing on a phone. The fix for the phone cannot live in this
  // file: the gesture belongs to the FAB, which is App.tsx's, so the focus has
  // to be taken there (focus a pre-mounted field in the FAB's own click
  // handler, or drop /capture out of `lazy()` and `flushSync` the navigation)
  // — see the handoff. The click handlers in this file are the pattern that
  // works: focusInput() from an example chip or a post-submit reset DOES raise
  // the keyboard, because it runs inside the tap.
  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const focusInput = useCallback((): void => {
    inputRef.current?.focus()
  }, [])

  const parseTracks = useMemo<ParseTrack[]>(
    () => tracks.map((tr) => ({ id: tr.id, name: tr.name, nameAr: tr.name_ar })),
    [tracks],
  )

  // `username` is not optional decoration: it is the identifier the Members
  // screen hands people and the one they type after `@`. Dropping it here is
  // what made `@zz.smoke.v100` file a free-text owner and assign nobody.
  const parseMembers = useMemo<ParseMember[]>(
    () => members.map((m) => ({ id: m.id, displayName: m.displayName, username: m.username })),
    [members],
  )

  const vocabAliases = useMemo(() => {
    const rows = getVocabSnapshot().rows
    return {
      priority: aliasesFor(priorityItems, rows, 'priority'),
      type: aliasesFor(typeItems, rows, 'type'),
    }
  }, [priorityItems, typeItems])

  /**
   * A fresh context per call, because `now` must be. A context memoised for the
   * life of the screen would resolve `due:tomorrow` against the day the tab was
   * opened — which for a tool that lives in a pinned tab is routinely wrong.
   */
  const makeCtx = useCallback(
    (): ParseContext => ({
      tracks: parseTracks,
      members: parseMembers,
      now: new Date(),
      locale,
      vocabAliases,
    }),
    [parseTracks, parseMembers, locale, vocabAliases],
  )

  // The live parse. Cheap by construction — parse() is pure, allocates a few
  // small arrays and touches no store — so running it per keystroke is the
  // simple implementation as well as the correct one.
  const parsed: ParsedEntry = useMemo(() => parse(text, makeCtx()), [text, makeCtx])

  const okTokens = parsed.tokens.filter((token) => token.ok).length

  // Announced on a debounce rather than per keystroke: a live region that fires
  // on every character reads the whole line back one letter at a time and makes
  // the screen unusable with a screen reader running.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setAnnounce(okTokens === 0 ? '' : t('capture.parsedAnnounce', { count: okTokens }))
    }, ANNOUNCE_MS)
    return () => {
      window.clearTimeout(timer)
    }
  }, [okTokens, locale])

  const remember = useCallback((id: string, problems: readonly ParseProblem[]): void => {
    setRecent((prev) =>
      [{ id, problems }, ...prev.filter((x) => x.id !== id)].slice(0, RECENT_LIMIT),
    )
  }, [])

  const handleUndo = useCallback(async (id: string): Promise<void> => {
    const result = await undoCapture(id)
    // A queued undo is an undo. The outbox owns it now, and the row is already
    // cancelled locally — telling the user it failed would be a lie they would
    // act on by cancelling it twice.
    if (result.ok || result.error === QUEUED_KEY) {
      setRecent((prev) => prev.filter((x) => x.id !== id))
      toast(t('capture.undone'))
      return
    }
    toast(t('capture.errUndo'), { tone: 'error' })
  }, [])

  /**
   * The confirmation, CARRYING THE PARSE OUTCOME.
   *
   * It used to raise `tone: 'success'` unconditionally, and that was the one
   * dishonest sentence on the screen. `canSubmit()` asks only for a non-empty
   * title (lib/capture/parse), so a line whose owner and date both failed is
   * saved exactly like a line that parsed perfectly — and `setText('')` fires
   * before the await, which unmounts the problems panel in the same frame. So
   * the user pressed the key the hint told them to press, watched three
   * warnings disappear, and got a green tick: an unassigned, undated item that
   * will never surface in Overdue and that nobody was notified about, reported
   * as done.
   *
   * Three things change when `problems` is non-empty, and each is doing a job:
   *   · the TONE drops to neutral, so the green border that reads as "all good"
   *     is not drawn (app-shell.css tones the border and nothing else);
   *   · the SENTENCE says so, rather than leaving the fact on a panel that has
   *     already gone;
   *   · the ACTION becomes "Open it" instead of "Undo". Undo DELETES the row,
   *     which is the wrong remedy for a row that is right except for two
   *     fields; the sheet is where those fields get fixed. Undo is still the
   *     action for a clean capture, where the only reason to reach for it is
   *     that the whole line was a mistake.
   *
   * The DETAIL does not live here — a toast is gone in seconds. It is rendered
   * on the "Just captured" card below, which stays for the session.
   */
  const raiseCaptured = useCallback(
    (id: string | null, title: string, queued: boolean, problems: readonly ParseProblem[]): void => {
      const say = confirmationFor(queued, problems.length, id !== null)
      toast(t(say.key, { title: truncate(title, 48) }), {
        tone: say.tone,
        // No glyph for the unresolved case: the bolt is this screen's success
        // mark and icons.tsx has no warning counterpart to swap in, so the
        // absence of a mark is the mark. Offline keeps its own icon — "where is
        // it" and "did it understand me" are different questions and both can
        // be true at once.
        icon: say.offline ? (
          <IconWifiOff size={16} />
        ) : say.tone === 'success' ? (
          <IconBolt size={16} />
        ) : undefined,
        action:
          say.action === null || id === null
            ? undefined
            : say.action === 'undo'
              ? { label: t('capture.undo'), onClick: () => void handleUndo(id) }
              : { label: t('capture.openCaptured'), onClick: () => openEntry(id) },
      })
    },
    [handleUndo],
  )

  /**
   * A write that genuinely failed, put back where its author can act on it.
   *
   * ONLY IF THE BOX IS STILL EMPTY. Capture clears on Enter precisely so the
   * next thought can start immediately, and on a slow network that next thought
   * is often already half-typed when the failure lands — pasting the old line
   * over it would lose a sentence to a screen whose one promise is that it never
   * does. When that happens the failed line is NAMED in the notice instead, so
   * it can be retyped from what is on screen.
   */
  const restoreLine = useCallback(
    (kept: string, title: string): void => {
      if (textRef.current === '') {
        setText(kept)
        setError('capture.errSave')
      } else {
        setHeldTitle(truncate(title, 48))
        setError('capture.errSaveHeld')
      }
      focusInput()
    },
    [focusInput],
  )

  /**
   * The `every:` path: one row in `recurring_templates`, not one in `entries`.
   *
   * No optimism and no outbox, unlike the entry path — there is no template
   * store holding a provisional row, so a queued write would have nowhere to
   * live and nothing to roll back. The toast therefore reports a real server
   * answer, and carries the way to the screen that owns the thing just created;
   * a recipe you cannot find is worse than no recipe.
   */
  const submitTemplate = useCallback(
    async (fresh: ParsedEntry, ctx: ParseContext): Promise<void> => {
      const input = toRecurringTemplateInput(fresh, ctx)
      // Unreachable — the caller already tested `fresh.recurrence` and a title
      // is required by both this and canSubmit() — but a null here must never
      // reach the API as a blank row.
      if (!input) return

      const kept = text
      setText('')
      setError(null)
      setBusy(true)
      focusInput()

      const result = await createTemplate(input)
      setBusy(false)

      if (result.ok) {
        toast(t('capture.capturedTemplate', { title: truncate(input.title, 48) }), {
          tone: 'success',
          icon: <IconClock size={16} />,
          action: {
            label: t('capture.openTemplates'),
            onClick: () => void navigate('/settings/recurring'),
          },
        })
        return
      }

      // api/templates.ts answers with an i18n KEY, and unlike the entry path
      // there is no store behind this write to have toasted it already.
      toast(t(result.error), { tone: 'error' })
      restoreLine(kept, input.title)
    },
    [focusInput, navigate, restoreLine, text],
  )

  const handleSubmit = useCallback(
    async (event: FormEvent<HTMLFormElement>): Promise<void> => {
      event.preventDefault()
      if (busy) return

      // Re-parsed rather than reusing `parsed`: the memo's `now` is as old as
      // the last keystroke, and a line typed at 23:59 and submitted at 00:01
      // must resolve `due:today` against the day it is being SAVED.
      const ctx = makeCtx()
      const fresh = parse(text, ctx)

      if (fresh.isEmpty || !canSubmit(fresh)) {
        setError('capture.errEmpty')
        focusInput()
        return
      }
      // A cadence describes a TEMPLATE, not an entry — the parser refuses to
      // turn one into the other and toNewEntry() returns null for it. Same box,
      // same Enter, the other table.
      if (fresh.recurrence) {
        await submitTemplate(fresh, ctx)
        return
      }

      const input = toNewEntry(fresh, ctx)
      if (!input) return

      const title = input.title
      const kept = text

      // BEFORE the await, always. The optimistic row is applied synchronously
      // inside createEntryOptimistic, so by the time this resolves the entry is
      // already on screen — clearing afterwards would put a network round trip
      // in front of the next thought, which is the one thing this screen sells.
      setText('')
      setError(null)
      setBusy(true)
      focusInput()

      const result = await createEntryOptimistic(input)
      setBusy(false)

      if (result.ok) {
        remember(result.data.id, fresh.problems)
        raiseCaptured(result.data.id, title, false, fresh.problems)
        return
      }

      if (result.error === QUEUED_KEY) {
        const tempId = lastQueuedEntryTempId()
        if (tempId) remember(tempId, fresh.problems)
        raiseCaptured(tempId, title, true, fresh.problems)
        return
      }

      // A genuine failure. The store has already rolled the optimistic row back
      // and toasted the reason, so this adds the one thing it cannot: the words.
      restoreLine(kept, title)
    },
    [busy, focusInput, makeCtx, raiseCaptured, remember, restoreLine, submitTemplate, text],
  )

  /** Cut a token out of the line and hand the caret back. */
  const removeToken = useCallback(
    (token: ParsedToken): void => {
      setText((prev) => removeSpan(prev, token.start, token.end))
      focusInput()
    },
    [focusInput],
  )

  /**
   * Put the caret ON the token that failed, with its text selected.
   *
   * Deleting it would be the easier control to build and the wrong one: the
   * user typed `due:someday` because they meant a date, and a screen that
   * silently removes the attempt loses the intent with it. Selecting lets the
   * next keystroke replace it.
   */
  const fixToken = useCallback((token: ParsedToken): void => {
    const el = inputRef.current
    if (!el) return
    el.focus()
    el.setSelectionRange(token.start, token.end)
  }, [])

  const chooseTrack = useCallback(
    (token: ParsedToken, track: Track): void => {
      setText((prev) => replaceSpan(prev, token.start, token.end, `#${quoteIfNeeded(trackLabel(track))}`))
      focusInput()
    },
    [focusInput, trackLabel],
  )

  const addTag = useCallback(
    (tag: string): void => {
      setText((prev) => appendToken(prev, `+${quoteIfNeeded(tag)}`))
      focusInput()
    },
    [focusInput],
  )

  const clearLine = useCallback((): void => {
    setText('')
    setError(null)
    focusInput()
  }, [focusInput])

  /** What a chip shows: the RESOLVED value where there is one, and what the
   *  user typed where there is not. */
  const chipValue = useCallback(
    (token: ParsedToken): string => {
      const raw = token.value ?? ''
      if (!token.ok) return raw
      switch (token.kind) {
        case 'track': {
          const track = token.refId ? trackMap.get(token.refId) : undefined
          return track ? trackLabel(track) : raw
        }
        case 'priority':
          return vocabLabel('priority', raw)
        case 'type':
          return vocabLabel('type', raw)
        case 'due':
        case 'followUp':
          return formatDate(raw, locale)
        case 'recurring': {
          const key = CADENCE_LABEL[raw as Cadence] ?? 'capture.chipRecurring'
          // `count`, not `days`: capture.cadenceCustom is a plural node, and the
          // selector reads `count`. The five fixed cadences ignore the variable.
          return t(key, { count: parsed.recurrence?.customIntervalDays ?? 0 })
        }
        default:
          return raw
      }
    },
    [locale, parsed.recurrence, trackLabel, trackMap, vocabLabel],
  )

  /** The sibling list for the detail sheet's prev/next — ids only. */
  const recentIds = useMemo(() => recent.map((r) => r.id), [recent])

  const parsedTrack = parsed.trackId ? trackMap.get(parsed.trackId) : undefined
  // Suggested tags are compared folded to lower case because the parser stores
  // tags lower-cased (see normalizeTag) while `suggested_tags` holds whatever
  // the admin typed — an exact-match test would offer a tag that is already on
  // the line.
  const suggestedTags = parsedTrack
    ? parsedTrack.suggested_tags.filter((tag) => !parsed.tags.includes(tag.trim().toLowerCase()))
    : []

  // A recurrence no longer blocks the button: `every:` writes a template, and a
  // screen that teaches a token in its own hints may not then refuse it.
  const submitDisabled = busy || !canSubmit(parsed)
  const longTitle = parsed.title.length > LONG_TITLE

  return (
    // The Shell already renders <main class="main-content">; a second <main>
    // would give the page two document landmarks and no way to tell them apart.
    <div className="cap-page">
      <header className="cap-head">
        <h1 className="page-title">{t('capture.title')}</h1>
        <p className="cap-subtitle">{t('capture.subtitle')}</p>
      </header>

      <form className="cap-form" onSubmit={(e) => void handleSubmit(e)} noValidate>
        <label className="sr-only" htmlFor="cap-input">
          {t('capture.inputLabel')}
        </label>
        <div className="cap-bar">
          <div className="cap-field">
            <input
              id="cap-input"
              ref={inputRef}
              className="input cap-input"
              type="text"
              value={text}
              onChange={(e) => {
                setText(e.target.value)
                if (error) setError(null)
              }}
              placeholder={t('capture.placeholder')}
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
              enterKeyHint="done"
              aria-describedby="cap-hint"
              aria-invalid={error ? 'true' : undefined}
            />
            {text !== '' ? (
              <button type="button" className="cap-clear" onClick={clearLine} aria-label={t('capture.clear')}>
                <span aria-hidden="true" />
              </button>
            ) : null}
          </div>
          <button type="submit" className="btn btn-primary cap-submit" disabled={submitDisabled}>
            {busy ? t('capture.submitting') : t('capture.submit')}
          </button>
        </div>

        <p className="cap-hint" id="cap-hint">
          {t('capture.submitHint')}
        </p>
        {error ? (
          <p className="cap-error" role="alert">
            {t(error, { title: heldTitle })}
          </p>
        ) : null}
      </form>

      {/* The live answer to "did it understand me?". Not itself a live region —
          see the debounced announcement below — because a region that re-reads
          on every keystroke is worse than no region at all. */}
      <section className="cap-read" aria-label={t('capture.chips')}>
        {parsed.isEmpty ? (
          <p className="cap-read-empty">{t('capture.previewEmpty')}</p>
        ) : (
          <>
            {parsed.title !== '' ? <span className="cap-read-plain">{parsed.title}</span> : null}
            {parsed.tokens.map((token) => (
              <TokenChip
                key={`${token.start}-${token.end}-${token.kind}`}
                token={token}
                label={chipValue(token)}
                track={token.kind === 'track' && token.refId ? trackMap.get(token.refId) : undefined}
                onRemove={removeToken}
              />
            ))}
            {parsed.tokens.length === 0 ? <span className="cap-read-none">{t('capture.chipNone')}</span> : null}
          </>
        )}
      </section>

      {/* One sentence saying exactly what Enter will do. */}
      {!parsed.isEmpty ? (
        <p className="cap-preview">
          <span className="cap-preview-label">{t('capture.preview')}</span>{' '}
          {parsed.recurrence
            ? t('capture.willCreateTemplate')
            : parsedTrack
              ? t('capture.willCreate', { track: trackLabel(parsedTrack) })
              : t('capture.willCreateNoTrack')}
        </p>
      ) : null}

      {/* Where the row is about to land, and how to get to it. Not a warning:
          the line is perfectly valid and Enter will save it — this says which of
          the app's two tables it goes into, because "repeating item" and "item"
          are one word apart and land on different screens. */}
      {parsed.recurrence ? (
        <p className="cap-notice" role="status">
          {t('capture.templateWhere')}{' '}
          <button
            type="button"
            className="btn btn-sm btn-ghost cap-notice-link"
            onClick={() => void navigate('/settings/recurring')}
          >
            {t('capture.openTemplates')}
          </button>
        </p>
      ) : null}

      {suggestedTags.length > 0 ? (
        <section className="cap-suggest">
          <h2 className="cap-suggest-title">{t('capture.suggested')}</h2>
          <div className="chip-row cap-suggest-row">
            {suggestedTags.map((tag) => (
              <button
                key={tag}
                type="button"
                className="chip cap-suggest-chip"
                onClick={() => addTag(tag)}
                aria-label={t('capture.addTag', { tag })}
              >
                <span aria-hidden="true">+</span>
                {tag}
              </button>
            ))}
          </div>
        </section>
      ) : null}

      {/* The two-option picker plan §2.13 example 8 calls for: `#i` matches both
          Infrastructure and IT Operations, and one tap is faster than backing
          out the token and retyping it. */}
      {parsed.tokens
        .filter((token) => token.kind === 'track' && (token.candidates?.length ?? 0) > 0)
        .map((token) => (
          <section className="cap-pick" key={`pick-${token.start}`}>
            <h2 className="cap-pick-title">{t('capture.pickTrack')}</h2>
            <p className="cap-pick-hint">{t('capture.pickTrackHint')}</p>
            <div className="chip-row">
              {(token.candidates ?? []).map((id) => {
                const track = trackMap.get(id)
                if (!track) return null
                return (
                  <button
                    key={id}
                    type="button"
                    className="chip cap-pick-chip"
                    style={trackVars(track.color, track.color_light)}
                    onClick={() => chooseTrack(token, track)}
                  >
                    <span className="track-dot" />
                    {trackLabel(track)}
                  </button>
                )
              })}
            </div>
          </section>
        ))}

      {parsed.problems.length > 0 || longTitle ? (
        <section className="cap-problems">
          <h2 className="cap-problems-title">
            {t('capture.problems')}
            <span className="cap-problems-count">
              {t('capture.problemCount', { count: parsed.problems.length + (longTitle ? 1 : 0) })}
            </span>
          </h2>
          <ul>
            {parsed.problems.map((problem, i) => (
              <li
                key={`${problem.key}-${problem.token?.start ?? i}`}
                className="cap-problem"
                data-tone={problem.key.startsWith('capture.err') ? 'danger' : 'muted'}
              >
                <span className="cap-problem-text">{problemText(problem)}</span>
                {problem.token ? (
                  <button
                    type="button"
                    className="btn btn-sm btn-ghost cap-problem-fix"
                    onClick={() => fixToken(problem.token as ParsedToken)}
                  >
                    {t('capture.chipFix', { token: problem.token.raw })}
                  </button>
                ) : null}
              </li>
            ))}
            {longTitle ? (
              <li className="cap-problem" data-tone="muted">
                <span className="cap-problem-text">{t('capture.warnLongTitle')}</span>
              </li>
            ) : null}
          </ul>
        </section>
      ) : null}

      <section className="cap-hints">
        <button
          type="button"
          className="btn btn-sm btn-ghost cap-hints-toggle"
          onClick={() => setShowHints((v) => !v)}
          aria-expanded={showHints}
          aria-controls="cap-hints-body"
        >
          {showHints ? t('capture.hideHints') : t('capture.showHints')}
        </button>
        <div id="cap-hints-body" className="cap-hints-body" hidden={!showHints}>
          <h2 className="cap-hints-title">{t('capture.hints')}</h2>
          <ul className="cap-hints-list">
            <li>{t('capture.hintTrack')}</li>
            <li>{t('capture.hintOwner')}</li>
            <li>{t('capture.hintPriority')}</li>
            <li>{t('capture.hintType')}</li>
            <li>{t('capture.hintTag')}</li>
            <li>{t('capture.hintDue')}</li>
            <li>{t('capture.hintFollowUp')}</li>
            <li>{t('capture.hintRecurring')}</li>
            <li>{t('capture.hintDates')}</li>
            <li>{t('capture.hintQuoted')}</li>
            <li>{t('capture.hintEscape')}</li>
            <li>{t('capture.hintPlain')}</li>
          </ul>
          <h2 className="cap-hints-title">{t('capture.examples')}</h2>
          <div className="cap-examples">
            {/* DISPLAYED isolated, INSERTED raw. Under `dir="rtl"` the Unicode
                algorithm resolves the neutral sigils from their neighbours, so
                `@sara` renders as `sara@` and `due:+7d +portal` comes out in
                the opposite order — the examples are the grammar this screen is
                teaching, and a lesson that reads back-to-front teaches the
                wrong thing. lib/bidi.isolateTokens() wraps only the Latin
                tokens, which is why the locale strings themselves stay
                isolate-free: the parser must never see U+2066 (see that
                module's header), and setText() below hands it the raw line. */}
            {['capture.exampleMinimal', 'capture.exampleFull', 'capture.exampleRecurring'].map((key) => (
              <button
                key={key}
                type="button"
                className="cap-example"
                onClick={() => {
                  setText(t(key))
                  focusInput()
                }}
              >
                {isolateTokens(t(key))}
              </button>
            ))}
          </div>
        </div>
      </section>

      <section className="cap-recent">
        <h2 className="cap-recent-title">{t('capture.recent')}</h2>
        {recent.length === 0 ? (
          <p className="cap-empty">{t('capture.recentEmpty')}</p>
        ) : (
          <div className="cap-recent-list">
            {recent.map((item) => (
              <RecentRow key={item.id} item={item} list={recentIds} />
            ))}
          </div>
        )}
      </section>

      {/* The one live region on the screen. Debounced, and it announces a COUNT
          rather than the chips themselves — "4 tokens read" is the fact a
          non-sighted user needs; the detail is reachable by arrowing the line. */}
      <div className="sr-only" role="status" aria-live="polite">
        {announce}
      </div>
    </div>
  )
}

// ── chips ──────────────────────────────────────────────────────────────────

interface TokenChipProps {
  token: ParsedToken
  label: string
  /** Set only for a RESOLVED track token — the chip paints in its colour. */
  track?: Track
  onRemove: (token: ParsedToken) => void
}

/**
 * One understood fragment of the line.
 *
 * The chip is a plain span with ONE control inside it, not a button that also
 * holds a button: nesting interactives is invalid HTML and assistive tech has
 * to guess which one a click meant. Removing is the chip's own affordance;
 * FIXING a failed token lives in the problem row beneath, where there is room
 * to say what went wrong.
 *
 * A track's two stored hexes go on the wrapper via trackVars(); `.track-dot` is
 * global.css's primitive and resolves them to `--track-color` for the disc,
 * and capture.css mirrors the same choice into `--cap-track-color` for the
 * chip's own border. Neither file may extend the other's selector list, which
 * is why the pair is set once here and read twice.
 */
function TokenChip({ token, label, track, onRemove }: TokenChipProps): ReactElement {
  useLocale()
  const kindLabel = t(KIND_LABEL[token.kind])
  return (
    <span
      className="cap-chip"
      data-kind={token.kind}
      data-ok={token.ok ? 'true' : 'false'}
      style={track ? trackVars(track.color, track.color_light) : undefined}
    >
      {track ? <span className="track-dot" /> : null}
      <span className="cap-chip-sigil" aria-hidden="true">
        {KIND_SIGIL[token.kind]}
      </span>
      <span className="cap-chip-value">{label}</span>
      <span className="sr-only">{kindLabel}</span>
      <button
        type="button"
        className="cap-chip-x"
        onClick={() => onRemove(token)}
        aria-label={t('capture.chipRemove', { token: token.raw })}
      />
    </span>
  )
}

// ── the session list ───────────────────────────────────────────────────────

interface RecentRowProps {
  item: RecentCapture
  list: string[]
}

/**
 * One just-captured row, subscribing for ITSELF.
 *
 * Three narrow subscriptions per row rather than one wide one in the parent:
 * `usePendingOp` is a hook and cannot be called in a loop, and a parent
 * subscribed to the whole pending map would re-render all five rows every time
 * any write in the app settled.
 *
 * A missing entry renders NOTHING rather than a placeholder. Two ordinary
 * things produce one: an undo of a not-yet-sent capture removes the temp row
 * outright, and a queued capture that drains later has its temp id replaced by
 * the server's — in both cases the id this row holds is simply no longer an
 * entry, and a "deleted" tombstone would be a worse answer than silence.
 */
function RecentRow({ item, list }: RecentRowProps): ReactElement | null {
  const { id, problems } = item
  // A fourth subscription, and it is not one of the three the note above is
  // about: the problem sentences are translated HERE, so this row has to
  // re-render on a language switch. The parent does subscribe, but only the
  // parent's own strings would follow it.
  useLocale()
  const entry = useEntry(id)
  const health = useEntryHealth(id)
  const pending = usePendingOp(id)
  if (!entry) return null
  return (
    <div className="cap-recent-item">
      <EntryRow
        entry={entry}
        health={health}
        pending={pending}
        density="compact"
        onOpen={(entryId) => openEntry(entryId, { list })}
      />
      {/* THE RECORD THE TOAST CANNOT BE. A toast is gone in seconds and the
          live problems panel unmounted the instant the box cleared, so without
          this the row's unresolved tokens leave no mark anywhere: an owner that
          stayed free text looks like any other owner, and a due date that
          failed to parse renders as nothing at all rather than as a gap.
          Same sentences as the panel above, by construction — see
          problemText(). */}
      {problems.length > 0 ? (
        <div className="cap-recent-issues">
          <p className="cap-problems-title">
            {t('capture.problems')}
            <span className="cap-problems-count">
              {t('capture.problemCount', { count: problems.length })}
            </span>
          </p>
          <ul>
            {problems.map((problem, i) => (
              <li
                key={`${problem.key}-${problem.token?.start ?? i}`}
                className="cap-problem"
                data-tone={problem.key.startsWith('capture.err') ? 'danger' : 'muted'}
              >
                <span className="cap-problem-text">{problemText(problem)}</span>
              </li>
            ))}
          </ul>
          {/* The row itself opens too, but the affordance is not obvious on a
              compact row and this is the one row on the screen that a person
              has a REASON to open. It repairs rather than deletes, which is why
              the toast now offers the same thing instead of Undo. */}
          <button
            type="button"
            className="btn btn-sm btn-ghost cap-recent-fix"
            onClick={() => openEntry(id, { list })}
          >
            {t('capture.openCaptured')}
          </button>
        </div>
      ) : null}
    </div>
  )
}
