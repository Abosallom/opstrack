// The five-second capture bar: one line in, one row out.
//
// THE WHOLE SCREEN IS ONE PROMISE — the time between "I have a thought" and
// "the box is empty again" is under five seconds, on a phone, one-handed. Every
// decision below is downstream of that:
//
//  · the input is focused on mount and REFOCUSED after every action, because a
//    capture bar you have to tap first is a capture bar you use once;
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
import { useSearchParams } from 'react-router-dom'
import type { FormEvent, ReactElement } from 'react'
import { canSubmit, parse, toNewEntry } from '../lib/capture/parse'
import type { ParseContext, ParseMember, ParseTrack, ParsedEntry, ParsedToken, TokenKind } from '../lib/capture/parse'
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
import { EntryRow } from '../components/entry'
import { toast } from '../components/toast'
import { IconBolt, IconWifiOff } from '../components/icons'
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

  const [text, setText] = useState(seed)
  const [busy, setBusy] = useState(false)
  /** An i18n KEY, never a sentence — same rule the stores follow. */
  const [error, setError] = useState<string | null>(null)
  /** The title of a failed capture that could not be put back in the box. */
  const [heldTitle, setHeldTitle] = useState('')
  const [recent, setRecent] = useState<string[]>([])
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

  // Focus on mount, once. The FAB and the `C` hotkey both land here meaning "I
  // want to type", so the keyboard should already be up. A ref rather than
  // autoFocus, matching SignIn.tsx: autoFocus fires only on the first mount of
  // the element and silently does nothing when the route is re-entered.
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

  const parseMembers = useMemo<ParseMember[]>(
    () => members.map((m) => ({ id: m.id, displayName: m.displayName })),
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

  const remember = useCallback((id: string): void => {
    setRecent((prev) => [id, ...prev.filter((x) => x !== id)].slice(0, RECENT_LIMIT))
  }, [])

  const handleUndo = useCallback(async (id: string): Promise<void> => {
    const result = await undoCapture(id)
    // A queued undo is an undo. The outbox owns it now, and the row is already
    // cancelled locally — telling the user it failed would be a lie they would
    // act on by cancelling it twice.
    if (result.ok || result.error === QUEUED_KEY) {
      setRecent((prev) => prev.filter((x) => x !== id))
      toast(t('capture.undone'))
      return
    }
    toast(t('capture.errUndo'), { tone: 'error' })
  }, [])

  const raiseCaptured = useCallback(
    (id: string | null, title: string, queued: boolean): void => {
      const shown = truncate(title, 48)
      toast(queued ? t('capture.capturedQueued', { title: shown }) : t('capture.captured', { title: shown }), {
        tone: queued ? 'default' : 'success',
        icon: queued ? <IconWifiOff size={16} /> : <IconBolt size={16} />,
        action: id ? { label: t('capture.undo'), onClick: () => void handleUndo(id) } : undefined,
      })
    },
    [handleUndo],
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
      // turn one into the other and toNewEntry() returns null. The submit
      // control is already disabled here; this is the belt to that's braces.
      if (fresh.recurrence) return

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
        remember(result.data.id)
        raiseCaptured(result.data.id, title, false)
        return
      }

      if (result.error === QUEUED_KEY) {
        const tempId = lastQueuedEntryTempId()
        if (tempId) remember(tempId)
        raiseCaptured(tempId, title, true)
        return
      }

      // A genuine failure. The store has already rolled the optimistic row back
      // and toasted the reason, so this adds the one thing it cannot: the words.
      //
      // ONLY IF THE BOX IS STILL EMPTY. Capture clears on Enter precisely so the
      // next thought can start immediately, and on a slow network that next
      // thought is often already half-typed when the failure lands — pasting the
      // old line over it would lose a sentence to a screen whose one promise is
      // that it never does. When that happens the failed line is named in the
      // notice instead, so it can be retyped from what is on screen.
      if (textRef.current === '') {
        setText(kept)
        setError('capture.errSave')
      } else {
        setHeldTitle(truncate(title, 48))
        setError('capture.errSaveHeld')
      }
      focusInput()
    },
    [busy, focusInput, makeCtx, raiseCaptured, remember, text],
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

  const parsedTrack = parsed.trackId ? trackMap.get(parsed.trackId) : undefined
  // Suggested tags are compared folded to lower case because the parser stores
  // tags lower-cased (see normalizeTag) while `suggested_tags` holds whatever
  // the admin typed — an exact-match test would offer a tag that is already on
  // the line.
  const suggestedTags = parsedTrack
    ? parsedTrack.suggested_tags.filter((tag) => !parsed.tags.includes(tag.trim().toLowerCase()))
    : []

  const submitDisabled = busy || !canSubmit(parsed) || parsed.recurrence !== null
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

      {parsed.recurrence ? (
        <p className="cap-notice" role="status">
          {t('capture.templateSoon')}
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
                <span className="cap-problem-text">
                  {/* `kind` arrives from the parser as a raw TokenKind — it is a
                      token classification, not a user-facing word, so it is
                      swapped for the localised chip label before interpolation. */}
                  {t(problem.key, {
                    ...problem.vars,
                    ...(problem.token ? { kind: t(KIND_LABEL[problem.token.kind]) } : {}),
                  })}
                </span>
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
                {t(key)}
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
            {recent.map((id) => (
              <RecentRow key={id} id={id} list={recent} />
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
  id: string
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
function RecentRow({ id, list }: RecentRowProps): ReactElement | null {
  const entry = useEntry(id)
  const health = useEntryHealth(id)
  const pending = usePendingOp(id)
  if (!entry) return null
  return (
    <EntryRow
      entry={entry}
      health={health}
      pending={pending}
      density="compact"
      onOpen={(entryId) => openEntry(entryId, { list })}
    />
  )
}
