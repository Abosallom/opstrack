// THE CAPTURE BAR THAT LIVES ON THE MAP.
//
// Capture is the single most used interaction in this product, and the number
// that matters is KEYSTROKES, not screens. Today the cheapest path from "I have
// a thought" to "it is filed" costs a route change: FAB or `C`, type, Enter,
// then Back to the picture the lead was reading. This component removes the
// two navigations and nothing else — /capture stays routed, stays focused on
// mount, keeps its hints, its examples and its session list, and is byte-for-
// byte the screen it was. THIS IS ADDITIVE. It deletes nothing.
//
// ── WHAT IS REUSED, WHICH IS EVERYTHING THAT MATTERS ───────────────────────
//
// The grammar is `lib/capture/parse` — pure, total, never throws, FROZEN. It is
// not touched, wrapped or second-guessed here; this file passes it a string and
// renders what comes back. The write is `store/entries.createEntryOptimistic`,
// the only function in the repo that inserts an entry: it applies the optimistic
// row SYNCHRONOUSLY (so the map redraws with the new item before the network is
// consulted), funnels the write through `store/outbox`, and rolls back with a
// toast when it genuinely fails. `every:` writes a `recurring_templates` row
// through `api/templates.createTemplate`, exactly as pages/Capture.tsx does,
// because a box that teaches a token in its own placeholder may not then eat a
// line carrying it.
//
// ── THE AI PATH IS UNCHANGED, AND THAT IS THE POINT ────────────────────────
//
// `components/capture/AiSuggestion` PROPOSES; it hands back token STRINGS; they
// are appended to the input line by `appendToken`; `parse()` re-reads the line
// on the next render. The model cannot replace the title, cannot clear the box,
// cannot submit, and never reaches the write. Enter still saves exactly what is
// visibly in the box. The component owns its own debounce and its own privacy
// gate and renders nothing at all on a keyed line, an offline device or a bad
// minute at the API — so on this screen, as on /capture, it costs nothing until
// it has something to say.
//
// ── HONESTY AFTER THE WRITE ────────────────────────────────────────────────
//
// `confirmationFor()` below is the decision R2-PRODUCT-2 introduced on
// pages/Capture.tsx, restated here (see its own comment for why it is a copy and
// what the integrator is asked to do about that). The rule in one sentence:
// OFFLINE changes WHERE it is, PROBLEMS change WHETHER it is right, and the two
// are independent. A queued capture is never reported as a failure — the outbox
// owns the write and the optimistic row stays — and a capture whose owner and
// date did not resolve is never reported as a success, because the box clears in
// the same frame and takes the warnings with it. That second case is why the
// unresolved capture leaves a NOTICE under the bar: the toast is gone in
// seconds, this screen has no "Just captured" list to hold the record, and an
// owner that stayed free text looks like any other owner on a map node.
//
// ── THE KEYBOARD CONTRACT, WHICH IS THE HALF THAT COULD BREAK THE MAP ──────
//
// THIS COMPONENT BINDS NO DOCUMENT OR WINDOW LISTENER. Every key it handles is
// handled in `onKeyDown` on its own <input>. While the caret is anywhere else,
// it is keyboard-inert: the map's tree walk (arrows, Home/End, Enter, Space,
// Escape, Shift+F10) is a React handler on the <svg> itself (pages/map/
// useMapKeyboard.ts) and cannot be reached from here, and `lib/hotkeys`'
// document listener already bails on a keystroke whose target `isTypingTarget()`
// — so typing `board` into this box does not open the board.
//
// Inside the box:
//   Enter   files the line. The form owns it; the assist may not change that.
//   Tab     accepts an AI suggestion ONLY at the end of the line and only while
//           one is showing — otherwise it is an ordinary Tab, because Tab is how
//           a keyboard user leaves this field for the map, and a suggestion that
//           appeared uninvited must not be able to take that away.
//   Escape  is a stack: dismiss the suggestion → clear the line → leave the
//           field. Each step calls preventDefault(), which is also how
//           `lib/overlayStack` is told the key was consumed (it bails on
//           `defaultPrevented`), so an Escape meant for this box never also
//           closes a node menu.
//
// NO FOCUS ON MOUNT, deliberately, and this is the one place this file departs
// from pages/Capture.tsx. That screen exists to be typed into and takes the
// caret the moment it opens. The map exists to be READ; stealing the caret on
// arrival would scroll a phone to the top of the document and put a blinking
// cursor over the picture the lead came to look at. `focusMapCapture()` is
// exported so a hotkey can take the caret when the reader actually asks for it.

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { FormEvent, KeyboardEvent, ReactElement } from 'react'
import { canSubmit, parse, toNewEntry, toRecurringTemplateInput } from '../../lib/capture/parse'
import type {
  ParseContext,
  ParseMember,
  ParseProblem,
  ParseTrack,
  ParsedEntry,
  ParsedToken,
  TokenKind,
} from '../../lib/capture/parse'
import { createEntryOptimistic, undoCapture } from '../../store/entries'
import { getOutboxSnapshot } from '../../store/outbox'
import { useActiveTracks, useTrackMap } from '../../store/config'
import { useMembers } from '../../store/members'
import { getVocabSnapshot, useVocabAll, useVocabLabel } from '../../store/vocab'
import type { VocabItem } from '../../store/vocab'
import { openEntry } from '../../store/entrySheet'
import { dismissSuggestion, takeAiTokens, useAiPending, useAiSuggestion } from '../../store/ai'
// The one write on this file's paths with no store in front of it — see
// submitTemplate(). Stores first, then the api layer.
import { createTemplate } from '../../api/templates'
import { AiSuggestion } from '../capture/AiSuggestion'
import { toast } from '../toast'
import { IconBolt, IconClock, IconWifiOff } from '../icons'
import { formatDate } from '../../lib/dates'
import { t, useLocale } from '../../lib/i18n'
import { useTrackLabel } from '../../lib/labels'
import { truncate } from '../../lib/text'
import { trackVars } from '../../lib/trackStyle'
import type { Cadence, Track, VocabKind, VocabRow } from '../../types'
import './map-capture.css'

/** What the outbox answers with when it QUEUED a write instead of sending it. */
const QUEUED_KEY = 'offline.queued'
/** Debounce before the screen-reader region announces the token count. */
const ANNOUNCE_MS = 700
/** Titles past this read as a paragraph in a list. A notice, never a block. */
const LONG_TITLE = 90
/** How much of a title a one-line sentence can carry before it is the line. */
const TITLE_CLIP = 48

/* ─────────────────────────── the imperative seam ──────────────────────────── */

/**
 * The mounted bar's input, so a hotkey can reach it without a ref chain.
 *
 * Same shape as `components/mindtree/NodeCard.dismissMindNodeCard()` and for the
 * same reason: the caller is `lib/hotkeys`' handler table, which lives outside
 * the React tree that owns this element. One module-level slot rather than a
 * registry, because the map screen mounts exactly one capture bar; a second
 * instance would take the slot and the first would simply stop answering, which
 * is a visible bug rather than a silent one.
 */
let liveInput: HTMLInputElement | null = null

/**
 * Put the caret in the map's capture box.
 *
 * Returns `false` when the bar is not mounted — the caller is then free to fall
 * back to navigating to /capture, which is what the `C` hotkey does today and
 * what it must keep doing on every other screen.
 *
 * CALLED FROM INSIDE THE TAP, always: WebKit raises the software keyboard only
 * for a focus() taken inside the user-activation call stack, and Chromium gates
 * it the same way. That is why this is a plain synchronous function and not a
 * promise, an effect or a state flag — pages/Capture.tsx's mount-focus comment
 * is the long version of why the difference is the whole feature on a phone.
 */
export function focusMapCapture(): boolean {
  if (liveInput === null) return false
  liveInput.focus()
  return true
}

/* ───────────────────────────── token presentation ─────────────────────────── */

/**
 * The sigil that produced each token kind — the one label needing no
 * translation, and the fastest way to read a chip strip at a glance.
 *
 * COPIED FROM pages/Capture.tsx, along with KIND_LABEL below. Two nine-entry
 * maps over a frozen union: they cannot drift semantically without
 * `TokenKind` changing, and a new member of that union breaks BOTH copies at
 * `tsc` because the Records are exhaustive. The handoff asks the integrator to
 * promote the pair (with `problemText`) into `lib/capture/chips.ts`; this file
 * may not create that module, and a bar that renders `?` for `#network` is not
 * a defensible interim.
 */
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

const CADENCE_LABEL: Readonly<Record<Cadence, string>> = {
  daily: 'capture.cadenceDaily',
  weekly: 'capture.cadenceWeekly',
  biweekly: 'capture.cadenceBiweekly',
  monthly: 'capture.cadenceMonthly',
  quarterly: 'capture.cadenceQuarterly',
  custom: 'capture.cadenceCustom',
}

/**
 * One parser problem, as the sentence a person reads.
 *
 * `kind` arrives from the parser as a raw TokenKind — a classification, not a
 * user-facing word — so it is swapped for the localised chip label before
 * interpolation. Identical to pages/Capture.tsx's, by construction: the two
 * surfaces must say the SAME sentence about the same line, and two wordings for
 * one fact read as two different problems.
 */
function problemText(problem: ParseProblem): string {
  return t(problem.key, {
    ...problem.vars,
    ...(problem.token ? { kind: t(KIND_LABEL[problem.token.kind]) } : {}),
  })
}

/* ──────────────────────────── text surgery ────────────────────────────────── */
//
// Every chip control edits the INPUT STRING, never a parallel model. The line
// the reader typed is the only state; the chips are a view of it. That is what
// makes "remove this chip" and "backspace over it" the same operation, and it is
// why every token carries a byte-exact [start, end).

/**
 * Cut `[start, end)` out, and close the seam.
 *
 * The space test is one-sided on purpose: a token with a space on BOTH sides
 * takes one with it (`a #net b` → `a b`), and a token at either edge does not.
 * Collapsing every run of whitespace instead would rewrite parts of the title
 * the reader never touched.
 */
function removeSpan(text: string, start: number, end: number): string {
  const before = text.slice(0, start)
  const after = text.slice(end)
  const joined =
    before.endsWith(' ') && after.startsWith(' ') ? before + after.slice(1) : before + after
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

/**
 * The admin's renamed labels, in BOTH languages, so `!عاجل جدا` resolves the
 * moment someone calls `critical` that — in an English UI as much as an Arabic
 * one, because the language a workspace types in and the language its interface
 * is set to are not the same question.
 *
 * Only NON-EMPTY labels become aliases: `vocab_options.label` is
 * `not null default ''` and an empty string means "no override", so feeding the
 * blanks in would map every key to the empty string and swallow the parser's own
 * alias table.
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

/* ─────────────────────────── the honesty decision ─────────────────────────── */

/** What the confirmation toast says, and what its one button does. */
interface CaptureConfirmation {
  key: string
  /** `success` paints the green border; anything unresolved must not. */
  tone: 'default' | 'success'
  /** Show the offline glyph — a fact about WHERE it is, not about the parse. */
  offline: boolean
  /** `undo` deletes the row; `open` opens the sheet so the fields can be fixed. */
  action: 'undo' | 'open' | null
}

/**
 * THE COPY OF `pages/Capture.confirmationFor`, AND THE ONE THING IN THIS FILE
 * THE INTEGRATOR IS ASKED TO DELETE.
 *
 * It is not imported, for one measurable reason: `pages/Capture.tsx` is a lazy
 * route that drags `capture.css`, the entry kit and its session list behind it,
 * and importing one 20-line decision out of it would pull all of that into the
 * chunk of the screen this workspace opens first. The landing screen's weight is
 * exactly the thing "no slower than today" is about.
 *
 * Duplicating a TESTED decision is the other half of that trade and it is a real
 * cost — `Capture.test.tsx:462` has ten assertions pinning these four branches,
 * and none of them can see this copy. So the handoff asks for the promotion to
 * `src/lib/capture/confirm.ts`, imported by both, which costs the integrator one
 * new file and two import lines and closes the drift window at the same
 * integration pass that mounts this component. This worker owns two files and
 * may not create that module itself (§1.0.4).
 *
 * The rule, restated so a reader of THIS file does not have to open the other:
 * OFFLINE changes where the row is; PROBLEMS change whether it is right; the two
 * are independent, and the sentence has to be able to say both.
 */
function confirmationFor(queued: boolean, problems: number, hasId: boolean): CaptureConfirmation {
  const clean = problems === 0
  return {
    key: clean
      ? queued
        ? 'capture.capturedQueued'
        : 'capture.captured'
      : queued
        ? 'capture.capturedQueuedIssues'
        : 'capture.capturedIssues',
    // A queued write is not a failure, but it is not a completed one either.
    tone: clean && !queued ? 'success' : 'default',
    offline: queued,
    // Undo is right for a line that was a mistake in whole. It is WRONG for a
    // line that is correct except for two fields — the sheet is where those get
    // fixed, and "delete it and type it again" is not a remedy.
    action: !hasId ? null : clean ? 'undo' : 'open',
  }
}

/**
 * The temp id of the create we just queued.
 *
 * `createEntryOptimistic` answers `fail('offline.queued')` with no payload, so
 * the id of the row it left on the map has to be recovered from the queue —
 * without it the toast could not offer Undo and the unresolved-capture notice
 * could not offer "Open it", which is exactly when a reader most wants both.
 * Newest-first, and it reads the OP rather than guessing from the store.
 */
function lastQueuedEntryTempId(): string | null {
  const items = getOutboxSnapshot()
  for (let i = items.length - 1; i >= 0; i -= 1) {
    const op = items[i].op
    if (op.table === 'entries' && op.op === 'insert' && op.tempId) return op.tempId
  }
  return null
}

/**
 * The record the toast cannot be.
 *
 * A toast is gone in seconds and the live problems panel unmounts the instant
 * the box clears, so without this a capture whose owner and due date failed
 * leaves no mark: the new node on the map shows an empty owner, and a due date
 * that did not parse renders as nothing at all rather than as a gap. Held as the
 * parser's own `ParseProblem` objects — plain data — so the sentences re-render
 * correctly when the language is switched under them.
 */
interface UnresolvedCapture {
  /** null only when a queued write could not be found in the outbox. */
  id: string | null
  title: string
  problems: readonly ParseProblem[]
}

/* ──────────────────────────────── the bar ─────────────────────────────────── */

export default function MapCapture(): ReactElement {
  const locale = useLocale()
  const tracks = useActiveTracks()
  const trackMap = useTrackMap()
  const trackLabel = useTrackLabel()
  const members = useMembers()
  const vocabLabel = useVocabLabel()
  const priorityItems = useVocabAll('priority')
  const typeItems = useVocabAll('type')
  const navigate = useNavigate()

  const inputId = useId()
  const hintId = useId()

  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  /** An i18n KEY, never a sentence — the rule every store in this repo follows. */
  const [error, setError] = useState<string | null>(null)
  /** The title of a failed capture that could not be put back in the box. */
  const [heldTitle, setHeldTitle] = useState('')
  const [unresolved, setUnresolved] = useState<UnresolvedCapture | null>(null)
  const [announce, setAnnounce] = useState('')

  const inputRef = useRef<HTMLInputElement>(null)

  /**
   * What is in the box RIGHT NOW, readable after an await.
   *
   * `handleSubmit`'s closure holds the line as it was when Enter was pressed —
   * which is the whole point for the payload, and exactly wrong for deciding
   * whether it is safe to write to the box afterwards. Kept in an effect rather
   * than assigned during render: effects have flushed by the time any promise
   * this component started can resolve.
   */
  const textRef = useRef(text)
  useEffect(() => {
    textRef.current = text
  }, [text])

  // Publish the input for `focusMapCapture()`. Cleared on unmount, and only if
  // this instance is still the one holding the slot — a remount ordering where
  // the new bar registers before the old one tears down must not blank it.
  useEffect(() => {
    const el = inputRef.current
    liveInput = el
    return () => {
      if (liveInput === el) liveInput = null
    }
  }, [])

  /**
   * Warmed by others, on purpose. `App.tsx` loads members for the whole shell
   * and `pages/map/useMapModel` loads entries for the map; both loaders dedupe,
   * so calling them again here would be two no-ops on the render path of the
   * screen that must stay fastest. Tracks and vocabulary come from the Shell.
   */

  const focusInput = useCallback((): void => {
    focusMapCapture()
  }, [])

  const parseTracks = useMemo<ParseTrack[]>(
    () => tracks.map((tr) => ({ id: tr.id, name: tr.name, nameAr: tr.name_ar })),
    [tracks],
  )

  // `username` is not optional decoration: it is the identifier the Members
  // screen hands people and the one they type after `@`.
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
   * opened — which for a map left open in a pinned tab all week is routinely
   * wrong, and this screen is the one most likely to be left open.
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

  /**
   * The context THIS parse ran against, kept so the AI assist can be handed the
   * very same object. `text` IS IN THE DEPENDENCY LIST ON PURPOSE — see
   * pages/Capture.tsx and lib/ai/types.ts:29: the validator's guarantee, that
   * the parser will read a suggested line back as the fields it approved, holds
   * only while both are looking at the same tracks and the same members.
   */
  const ctx = useMemo(() => makeCtx(), [makeCtx, text])

  // The live parse. Cheap by construction — parse() is pure, allocates a few
  // small arrays and touches no store — so running it per keystroke is the
  // simple implementation as well as the correct one.
  const parsed: ParsedEntry = useMemo(() => parse(text, ctx), [text, ctx])

  const okTokens = parsed.tokens.filter((token) => token.ok).length

  // Announced on a debounce rather than per keystroke: a live region that fires
  // on every character reads the whole line back one letter at a time and makes
  // the screen unusable with a screen reader running. The CAPTURE RESULT is not
  // announced here — components/toast.tsx's host is already a persistent polite
  // region and saying it twice is the defect.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setAnnounce(okTokens === 0 ? '' : t('capture.parsedAnnounce', { count: okTokens }))
    }, ANNOUNCE_MS)
    return () => {
      window.clearTimeout(timer)
    }
  }, [okTokens, locale])

  /* ── the AI assist's two keys ─────────────────────────────────────────── */

  // Subscribed rather than probed, because Escape has to know whether there is
  // anything to dismiss BEFORE it decides to throw the line away. `dismissSuggestion`
  // is a no-op when nothing is showing and cannot report that it did nothing;
  // this is the same condition it tests, read where the decision is made.
  const suggestion = useAiSuggestion()
  const aiPending = useAiPending()
  const aiShowing = aiPending || (suggestion !== null && suggestion.line === text)

  /* ── writes ───────────────────────────────────────────────────────────── */

  const handleUndo = useCallback(async (id: string): Promise<void> => {
    const result = await undoCapture(id)
    // A queued undo IS an undo. The outbox owns it now and the row is already
    // cancelled locally — reporting failure is a lie the reader would act on by
    // cancelling it twice.
    if (result.ok || result.error === QUEUED_KEY) {
      toast(t('capture.undone'))
      return
    }
    toast(t('capture.errUndo'), { tone: 'error' })
  }, [])

  const raiseCaptured = useCallback(
    (id: string | null, title: string, queued: boolean, problems: readonly ParseProblem[]): void => {
      const say = confirmationFor(queued, problems.length, id !== null)
      toast(t(say.key, { title: truncate(title, TITLE_CLIP) }), {
        tone: say.tone,
        // No glyph for the unresolved case: the bolt is capture's success mark
        // and icons.tsx has no warning counterpart to swap in, so the absence of
        // a mark is the mark. Offline keeps its own icon — "where is it" and
        // "did it understand me" are different questions and both can be true.
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
   * ONLY IF THE BOX IS STILL EMPTY. The bar clears on Enter precisely so the next
   * thought can start immediately, and on a slow network that next thought is
   * often already half-typed when the failure lands — pasting the old line over
   * it would lose a sentence to a control whose one promise is that it never
   * does. When that happens the failed line is NAMED in the notice instead, so
   * it can be retyped from what is on screen.
   */
  const restoreLine = useCallback(
    (kept: string, title: string): void => {
      if (textRef.current === '') {
        setText(kept)
        setError('capture.errSave')
      } else {
        setHeldTitle(truncate(title, TITLE_CLIP))
        setError('capture.errSaveHeld')
      }
      focusInput()
    },
    [focusInput],
  )

  /**
   * The `every:` path: one row in `recurring_templates`, not one in `entries`.
   *
   * No optimism and no outbox, unlike the entry path — there is no template store
   * holding a provisional row, so a queued write would have nowhere to live and
   * nothing to roll back. The toast therefore reports a real server answer and
   * carries the way to the screen that owns what was just created; a recipe you
   * cannot find is worse than no recipe. NOTHING ABOUT THIS LANDS ON THE MAP:
   * the map draws `entries`, and a template is a schedule that will produce one.
   */
  const submitTemplate = useCallback(
    async (fresh: ParsedEntry, parseCtx: ParseContext): Promise<void> => {
      const input = toRecurringTemplateInput(fresh, parseCtx)
      // Unreachable — the caller already tested `fresh.recurrence` and a title is
      // required by both this and canSubmit() — but a null here must never reach
      // the API as a blank row.
      if (!input) return

      const kept = text
      setText('')
      setError(null)
      setBusy(true)
      focusInput()

      const result = await createTemplate(input)
      setBusy(false)

      if (result.ok) {
        toast(t('capture.capturedTemplate', { title: truncate(input.title, TITLE_CLIP) }), {
          tone: 'success',
          icon: <IconClock size={16} />,
          action: {
            label: t('capture.openTemplates'),
            onClick: () => void navigate('/settings/recurring'),
          },
        })
        return
      }

      // api/templates answers with an i18n KEY, and unlike the entry path there
      // is no store behind this write to have toasted it already.
      toast(t(result.error), { tone: 'error' })
      restoreLine(kept, input.title)
    },
    [focusInput, navigate, restoreLine, text],
  )

  const handleSubmit = useCallback(
    async (event: FormEvent<HTMLFormElement>): Promise<void> => {
      event.preventDefault()
      if (busy) return

      // Re-parsed rather than reusing `parsed`: the memo's `now` is as old as the
      // last keystroke, and a line typed at 23:59 and submitted at 00:01 must
      // resolve `due:today` against the day it is being SAVED.
      const fresh0Ctx = makeCtx()
      const fresh = parse(text, fresh0Ctx)

      if (fresh.isEmpty || !canSubmit(fresh)) {
        setError('capture.errEmpty')
        focusInput()
        return
      }
      // A cadence describes a TEMPLATE, not an entry — the parser refuses to turn
      // one into the other and toNewEntry() returns null for it. Same box, same
      // Enter, the other table.
      if (fresh.recurrence) {
        await submitTemplate(fresh, fresh0Ctx)
        return
      }

      const input = toNewEntry(fresh, fresh0Ctx)
      if (!input) return

      const title = input.title
      const kept = text

      // BEFORE the await, always. `createEntryOptimistic` applies the optimistic
      // row synchronously, so by the time this resolves the node is already on
      // the map — clearing afterwards would put a network round trip in front of
      // the next thought, which is the one thing a capture box must not do.
      setText('')
      setError(null)
      setUnresolved(null)
      setBusy(true)
      focusInput()

      const result = await createEntryOptimistic(input)
      setBusy(false)

      if (result.ok) {
        if (fresh.problems.length > 0) {
          setUnresolved({ id: result.data.id, title, problems: fresh.problems })
        }
        raiseCaptured(result.data.id, title, false, fresh.problems)
        return
      }

      if (result.error === QUEUED_KEY) {
        const tempId = lastQueuedEntryTempId()
        if (fresh.problems.length > 0) {
          setUnresolved({ id: tempId, title, problems: fresh.problems })
        }
        raiseCaptured(tempId, title, true, fresh.problems)
        return
      }

      // A genuine failure. The store has already rolled the optimistic row back
      // and toasted the reason, so this adds the one thing it cannot: the words.
      restoreLine(kept, title)
    },
    [busy, focusInput, makeCtx, raiseCaptured, restoreLine, submitTemplate, text],
  )

  /* ── line edits ───────────────────────────────────────────────────────── */

  const clearLine = useCallback((): void => {
    setText('')
    setError(null)
    focusInput()
  }, [focusInput])

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
   * reader typed `due:someday` because they meant a date, and a control that
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
      setText((prev) =>
        replaceSpan(prev, token.start, token.end, `#${quoteIfNeeded(trackLabel(track))}`),
      )
      focusInput()
    },
    [focusInput, trackLabel],
  )

  /**
   * Accept the assist: append its tokens, and nothing else.
   *
   * THIS IS THE ONLY PLACE THE MODEL TOUCHES THIS COMPONENT, and it touches it
   * through the same `appendToken` a human keystroke would produce. `parse()`
   * re-reads the line on the next render and every chip, warning and submit
   * payload is computed from it exactly as if it had been typed.
   */
  const applyAiTokens = useCallback(
    (tokens: readonly string[]): void => {
      setText((prev) => tokens.reduce((line, token) => appendToken(line, token), prev))
      focusInput()
    },
    [focusInput],
  )

  /**
   * Tab accepts the suggestion; Escape is a three-step stack.
   *
   * TAB IS INTERCEPTED ONLY AT THE END OF THE LINE. Tab out of this input is how
   * a keyboard reader reaches the filter bar, the toolbar and the map itself,
   * and swallowing it whenever a suggestion happened to be showing would take the
   * whole screen away from them. The end of the line is where the caret is while
   * someone is typing, which is the only moment the shortcut is for; move the
   * caret (Home, an arrow, a click) and Tab is ordinary again. Shift+Tab and
   * every modified Tab are never touched.
   *
   * ESCAPE unwinds in the order the reader built it: the thing that appeared
   * uninvited goes first, then the words they typed, then the field itself.
   * Every handled branch calls preventDefault() — which is both how Firefox is
   * stopped from reverting the field's value and how `lib/overlayStack` is told
   * the key was consumed, so one Escape never also closes a node menu.
   *
   * Enter is deliberately absent: the form owns it, it submits what is in the
   * box, and the assist may not change that.
   */
  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLInputElement>): void => {
      if (event.key === 'Escape') {
        event.preventDefault()
        if (aiShowing) {
          dismissSuggestion(text)
          return
        }
        if (text !== '') {
          clearLine()
          return
        }
        // The bar is not an overlay and has nothing to close, so "dismiss" is
        // leaving it. Blur rather than moving focus somewhere chosen for the
        // reader: every engine resumes sequential navigation from the element
        // that was blurred, so the next Tab continues into the map rather than
        // restarting at the top of the document.
        event.currentTarget.blur()
        return
      }
      if (event.key !== 'Tab') return
      if (event.shiftKey || event.altKey || event.ctrlKey || event.metaKey) return
      const el = event.currentTarget
      if (el.selectionStart !== el.value.length || el.selectionEnd !== el.value.length) return
      const tokens = takeAiTokens(text, parsed, ctx)
      if (!tokens) return
      event.preventDefault()
      applyAiTokens(tokens)
    },
    [aiShowing, applyAiTokens, clearLine, ctx, parsed, text],
  )

  /* ── derived view state ───────────────────────────────────────────────── */

  /** What a chip shows: the RESOLVED value where there is one, and what the
   *  reader typed where there is not. */
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
          // `count`, not `days`: capture.cadenceCustom is a plural node and the
          // selector reads `count`. The five fixed cadences ignore the variable.
          return t(key, { count: parsed.recurrence?.customIntervalDays ?? 0 })
        }
        default:
          return raw
      }
    },
    [locale, parsed.recurrence, trackLabel, trackMap, vocabLabel],
  )

  const parsedTrack = parsed.trackId ? trackMap.get(parsed.trackId) : undefined
  const ambiguous = parsed.tokens.filter(
    (token) => token.kind === 'track' && (token.candidates?.length ?? 0) > 0,
  )
  const longTitle = parsed.title.length > LONG_TITLE
  const problemCount = parsed.problems.length + (longTitle ? 1 : 0)
  // A recurrence no longer blocks the button: `every:` writes a template, and a
  // box whose own placeholder teaches a token may not then refuse it.
  const submitDisabled = busy || !canSubmit(parsed)

  return (
    // A labelled region rather than a bare <div>: on a screen whose landmark is
    // the map, "Quick capture" is how a reader jumps straight to it. NOT a
    // <form> at this level — the reading strip and the assist sit outside the
    // form so that a stray Enter inside them can never submit.
    <section className="mcap" aria-label={t('capture.title')}>
      <form className="mcap-form" onSubmit={(e) => void handleSubmit(e)} noValidate>
        <label className="sr-only" htmlFor={inputId}>
          {t('capture.inputLabel')}
        </label>
        <div className="mcap-bar">
          <div className="mcap-field">
            <input
              id={inputId}
              ref={inputRef}
              className="input mcap-input"
              type="text"
              value={text}
              onChange={(e) => {
                setText(e.target.value)
                if (error) setError(null)
                // The unresolved-capture notice is about the PREVIOUS line. The
                // moment a new one starts it is history the reader has moved past,
                // and leaving it under a half-typed sentence reads as a warning
                // about that sentence.
                if (unresolved) setUnresolved(null)
              }}
              onKeyDown={handleKeyDown}
              placeholder={t('capture.placeholder')}
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
              enterKeyHint="done"
              aria-describedby={hintId}
              aria-invalid={error ? 'true' : undefined}
            />
            {text !== '' ? (
              <button
                type="button"
                className="mcap-clear"
                onClick={clearLine}
                aria-label={t('capture.clear')}
              >
                <span aria-hidden="true" />
              </button>
            ) : null}
          </div>
          <button type="submit" className="btn btn-primary mcap-submit" disabled={submitDisabled}>
            {busy ? t('capture.submitting') : t('capture.submit')}
          </button>
        </div>

        {/* Always rendered, because `aria-describedby` resolves an id to a node
            that is actually in the accessibility tree — hiding it until focus
            (display:none, visibility:hidden, or unmounting it) would leave the
            field described by nothing for the readers who need it most. */}
        <p className="mcap-hint" id={hintId}>
          {t('capture.mapHint')}
        </p>
        {error ? (
          <p className="mcap-error" role="alert">
            {t(error, { title: heldTitle })}
          </p>
        ) : null}
      </form>

      {/* EVERYTHING BELOW IS DRAWN ONLY WHILE THERE IS A LINE. At rest this bar
          is one input, one button and one line of hint — the map keeps the
          screen. It grows as the reader types and collapses again on Enter,
          which is the whole of the "dynamic" this surface needs. */}
      {!parsed.isEmpty ? (
        <div className="mcap-read" aria-label={t('capture.chips')}>
          {parsed.title !== '' ? <span className="mcap-read-plain">{parsed.title}</span> : null}
          {parsed.tokens.map((token) => (
            <TokenChip
              key={`${token.start}-${token.end}-${token.kind}`}
              token={token}
              label={chipValue(token)}
              track={token.kind === 'track' && token.refId ? trackMap.get(token.refId) : undefined}
              onRemove={removeToken}
            />
          ))}
          {/* One sentence saying exactly what Enter will do, inside the strip
              rather than under it: on a map screen every block costs canvas. */}
          <span className="mcap-will">
            {parsed.recurrence
              ? t('capture.willCreateTemplate')
              : parsedTrack
                ? t('capture.willCreate', { track: trackLabel(parsedTrack) })
                : t('capture.willCreateNoTrack')}
          </span>
        </div>
      ) : null}

      {/* Where the row is about to land, and how to get to it. Not a warning:
          the line is valid and Enter will save it — this says which of the app's
          two tables it goes into, because a template never appears on the map
          and a reader who does not know that will watch for a node that is never
          coming. */}
      {parsed.recurrence ? (
        <p className="mcap-notice" role="status">
          {t('capture.templateWhere')}{' '}
          <button
            type="button"
            className="btn btn-sm btn-ghost mcap-notice-link"
            onClick={() => void navigate('/settings/recurring')}
          >
            {t('capture.openTemplates')}
          </button>
        </p>
      ) : null}

      {/* The assist. It renders nothing at all unless the line is prose, the
          switch is on and an answer came back — so on a keyed line, an offline
          device or a bad minute at the API this bar is byte-for-byte the one
          that existed before it. */}
      <AiSuggestion
        line={text}
        parsed={parsed}
        ctx={ctx}
        onAccept={applyAiTokens}
        onDismiss={focusInput}
      />

      {/* `#i` matches both Infrastructure and IT Operations. One tap is faster
          than backing the token out and retyping it. */}
      {ambiguous.map((token) => (
        <div className="mcap-pick" key={`pick-${token.start}`}>
          <span className="mcap-pick-title">{t('capture.pickTrack')}</span>
          <div className="chip-row">
            {(token.candidates ?? []).map((id) => {
              const track = trackMap.get(id)
              if (!track) return null
              return (
                <button
                  key={id}
                  type="button"
                  className="chip mcap-pick-chip"
                  style={trackVars(track.color, track.color_light)}
                  onClick={() => chooseTrack(token, track)}
                >
                  <span className="track-dot" />
                  {trackLabel(track)}
                </button>
              )
            })}
          </div>
        </div>
      ))}

      {problemCount > 0 ? (
        <div className="mcap-problems">
          <p className="mcap-problems-title">
            {t('capture.problems')}
            <span className="mcap-problems-count">
              {t('capture.problemCount', { count: problemCount })}
            </span>
          </p>
          <ul>
            {parsed.problems.map((problem, i) => (
              <li
                key={`${problem.key}-${problem.token?.start ?? i}`}
                className="mcap-problem"
                data-tone={problem.key.startsWith('capture.err') ? 'danger' : 'muted'}
              >
                <span className="mcap-problem-text">{problemText(problem)}</span>
                {problem.token ? (
                  <button
                    type="button"
                    className="btn btn-sm btn-ghost mcap-problem-fix"
                    onClick={() => fixToken(problem.token as ParsedToken)}
                  >
                    {t('capture.chipFix', { token: problem.token.raw })}
                  </button>
                ) : null}
              </li>
            ))}
            {longTitle ? (
              <li className="mcap-problem" data-tone="muted">
                <span className="mcap-problem-text">{t('capture.warnLongTitle')}</span>
              </li>
            ) : null}
          </ul>
        </div>
      ) : null}

      {/* THE RECORD THE TOAST CANNOT BE — see UnresolvedCapture. No live role:
          components/toast.tsx already announced this sentence in its own polite
          region, and hearing it twice is the defect that convention exists to
          prevent. It clears on the next keystroke or the next capture. */}
      {unresolved !== null ? (
        <div className="mcap-kept">
          <p className="mcap-kept-line">
            {t('capture.capturedIssues', { title: truncate(unresolved.title, TITLE_CLIP) })}
          </p>
          <ul>
            {unresolved.problems.map((problem, i) => (
              <li
                key={`${problem.key}-${problem.token?.start ?? i}`}
                className="mcap-problem"
                data-tone={problem.key.startsWith('capture.err') ? 'danger' : 'muted'}
              >
                <span className="mcap-problem-text">{problemText(problem)}</span>
              </li>
            ))}
          </ul>
          {/* Repair, not delete — the same remedy the toast offered, still
              reachable after the toast has gone. */}
          {unresolved.id !== null ? (
            <button
              type="button"
              className="btn btn-sm btn-ghost mcap-kept-fix"
              onClick={() => openEntry(unresolved.id as string)}
            >
              {t('capture.openCaptured')}
            </button>
          ) : null}
        </div>
      ) : null}

      {/* The one live region this component owns. Debounced, and it announces a
          COUNT rather than the chips themselves — "4 tokens read" is the fact a
          non-sighted reader needs; the detail is reachable by arrowing the line. */}
      <div className="sr-only" role="status" aria-live="polite">
        {announce}
      </div>
    </section>
  )
}

/* ──────────────────────────────── chips ───────────────────────────────────── */

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
 * A plain span with ONE control inside it, not a button holding a button:
 * nesting interactives is invalid HTML and assistive tech has to guess which one
 * a click meant. Removing is the chip's own affordance; FIXING a failed token
 * lives in the problem row beneath, where there is room to say what went wrong.
 *
 * A track's two stored hexes go on the wrapper via `trackVars()`; `.track-dot`
 * is global.css's primitive and resolves them to `--track-color` for the disc,
 * and map-capture.css mirrors the same choice into `--mcap-track-color` for the
 * chip's own border. Neither sheet may extend the other's selector list, which
 * is why the pair is set once here and read twice.
 */
function TokenChip({ token, label, track, onRemove }: TokenChipProps): ReactElement {
  useLocale()
  const kindLabel = t(KIND_LABEL[token.kind])
  return (
    <span
      className="mcap-chip"
      data-kind={token.kind}
      data-ok={token.ok ? 'true' : 'false'}
      style={track ? trackVars(track.color, track.color_light) : undefined}
    >
      {track ? <span className="track-dot" /> : null}
      <span className="mcap-chip-sigil" aria-hidden="true">
        {KIND_SIGIL[token.kind]}
      </span>
      <span className="mcap-chip-value">{label}</span>
      <span className="sr-only">{kindLabel}</span>
      <button
        type="button"
        className="mcap-chip-x"
        onClick={() => onRemove(token)}
        aria-label={t('capture.chipRemove', { token: token.raw })}
      />
    </span>
  )
}
