// The AI suggestion row: what the assist understood, as words a person reads.
//
// IT SHOWS CHIPS, NEVER JSON, and never a raw field either. "Dev & QA · for Sara
// Ahmed · Change · due 7 August 2026" is a sentence someone can check in the
// half-second they have; `{"trackId":"t-devqa","dueDate":"2026-08-07"}` is a
// puzzle. The chips and the tokens come from ONE list — `newFields()` decides
// what is left to offer, this row renders it, and `toTokens()` writes the same
// thing into the line — so the row cannot promise something the line does not
// get, and cannot show a chip that turns out to be a no-op.
//
// IT NEVER TOUCHES THE LINE ITSELF. `onAccept` hands the token strings up to
// Capture, which appends them with its own `appendToken` — the keystone rule at
// Capture.tsx:158-163. This component holds no text state at all, and the
// suggestion's `title` is dropped before it is ever offered: the assist enriches
// what someone typed, it does not rewrite it.
//
// IT APPEARS WITHOUT BEING ASKED FOR, so it has to be quiet about it:
//   · it fires only on PROSE (store/ai.shouldSuggest) and only 700ms after
//     typing stops, so a line that already parses costs nothing;
//   · it is announced through ONE polite live region that is in the DOM from
//     first render — a region added at the same moment as its content is a
//     region screen readers routinely miss;
//   · a failure of any kind renders NOTHING. No error row, no retry, no spinner
//     left behind: capture degrades to precisely the screen that shipped before
//     this wave. The reason lands on Settings › AI assist instead.
//
// THE KEYBOARD. Tab accepts (Capture's input owns that keydown — the hint below
// says so out loud), Esc dismisses, and every control here is an ordinary button
// in the normal tab order. Nothing is pointer-only.

import { useEffect, useMemo, type ReactElement } from 'react'
import { toast } from '../toast'
import { isolate } from '../../lib/bidi'
import { formatDateLong } from '../../lib/dates'
import { t, useLocale } from '../../lib/i18n'
import { useTrackLabel } from '../../lib/labels'
import { trackVars } from '../../lib/trackStyle'
import type { AiContext } from '../../lib/ai/types'
import type { ParsedEntry } from '../../lib/capture/parse'
import {
  dismissSuggestion,
  loadAiPrefs,
  newFields,
  reportSuggestionMiss,
  requestSuggestion,
  shouldSuggest,
  suggestionTokens,
  takeAiTokens,
  useAiEnabled,
  useAiPending,
  useAiPrefsReady,
  useAiSuggestion,
} from '../../store/ai'
import { useTrackMap } from '../../store/config'
import { useVocabLabel } from '../../store/vocab'
import './ai-suggest.css'

/**
 * How long typing has to stop before the line is sent.
 *
 * The same 700ms Capture already waits before announcing its token count, and
 * the same reason: a person mid-sentence has not finished saying what they mean.
 * Long enough that an ordinary line is sent ONCE — each miss is a billed call —
 * and short enough that the row is there by the time the eye reaches the chips
 * below the box.
 */
const DEBOUNCE_MS = 700

/**
 * The first of these forms that is actually a name, or `''`.
 *
 * THE CHIP AND THE TOKEN MUST DRAW ON THE SAME SOURCES. `trackToken()` and
 * `ownerToken()` (lib/ai/toLine.ts:165, :190) each walk a LIST of forms and
 * emit on the first that resolves, so a chip built from one field of that list
 * is narrower than the token it is supposed to describe — and a token with no
 * chip is exactly the promise this row's header says it cannot make.
 *
 * The ORDER differs from the token's on purpose: the token picks the form that
 * MATCHES (`ownerToken` tries the handle first because tier 0 cannot be
 * outvoted), the chip picks the form a person RECOGNISES. Order is free to
 * differ; membership is not.
 */
function firstNamed(forms: readonly (string | null | undefined)[]): string {
  for (const form of forms) {
    const value = (form ?? '').trim()
    if (value !== '') return value
  }
  return ''
}

export interface AiSuggestionProps {
  /** The raw input string. The suggestion is pinned to it byte for byte. */
  line: string
  /** Capture's live parse. Decides whether to ask, and what to leave alone. */
  parsed: ParsedEntry
  /**
   * THE SAME context object Capture hands `parse()`.
   *
   * `AiContext` is a subset of `ParseContext` for exactly this reason
   * (lib/ai/types.ts:29): the validator's guarantee — that the parser will read
   * the line back as the fields it approved — only holds if both are looking at
   * the same tracks and the same members. Rebuilding a lookalike here from the
   * stores would be two reads that can disagree.
   */
  ctx: AiContext
  /** Append these tokens to the line. Capture owns every byte that goes in. */
  onAccept: (tokens: readonly string[]) => void
  /**
   * Put the caret back in the box.
   *
   * Called after dismissing or reporting, because the button that did it
   * unmounts in the same frame — and focus on an unmounted element falls to
   * <body>, which strands a keyboard user at the top of the document with no
   * indication of where they are.
   */
  onDismiss: () => void
}

export function AiSuggestion({
  line,
  parsed,
  ctx,
  onAccept,
  onDismiss,
}: AiSuggestionProps): ReactElement {
  const locale = useLocale()
  const enabled = useAiEnabled()
  const ready = useAiPrefsReady()
  const suggestion = useAiSuggestion()
  const pending = useAiPending()
  const tracks = useTrackMap()
  const trackLabel = useTrackLabel()
  const vocabLabel = useVocabLabel()

  // A READ, never a prompt of any kind: the switch governs whether the line is
  // sent at all, so nothing can be sent until it has been read. Deduped inside
  // the store, so mounting this row on every visit to /capture costs one query
  // per session.
  useEffect(() => {
    void loadAiPrefs()
  }, [])

  // THE DEBOUNCE. Cleared on every change, so a line only ever fires once —
  // after typing stops. `enabled`/`ready` are dependencies rather than early
  // returns so that a preference landing after the user has already stopped
  // typing still produces a suggestion, instead of waiting for a keystroke that
  // may never come.
  useEffect(() => {
    if (!enabled || !ready) return
    if (!shouldSuggest(line, parsed)) return
    const timer = window.setTimeout(() => {
      void requestSuggestion(line, parsed, ctx)
    }, DEBOUNCE_MS)
    return () => {
      window.clearTimeout(timer)
    }
  }, [line, parsed, ctx, enabled, ready])

  // Pinned to the line byte for byte. The store guards this too; the second
  // check is here because a stale row is the one failure that would put wrong
  // data into an entry, and it costs a string comparison.
  const mine = suggestion && suggestion.line === line ? suggestion : null

  // WHAT IS LEFT TO OFFER, and what will be written. Two views of one decision:
  // `fields` is what this row draws and `tokens` is what Tab appends, both
  // derived from `newFields()`. Nothing can appear in one and not the other —
  // `validate()` has already dropped anything a token cannot express, so
  // `toTokens()` renders every surviving field or the suggestion never existed.
  const fields = useMemo(
    () => (mine ? newFields(mine.suggestion, parsed) : null),
    [mine, parsed],
  )
  const tokens = useMemo(
    () => (mine ? suggestionTokens(mine.suggestion, parsed, ctx) : []),
    [mine, parsed, ctx],
  )

  /**
   * The chips, in `toTokens()`'s fixed order — which is the order they will be
   * written into the line, and the order `capture.exampleFull` teaches.
   *
   * A kind decides whether its value can stand alone. A track name, a priority
   * and a type are already nouns; a date and an owner are not, so they carry the
   * preposition that makes the row read as a sentence.
   */
  const chips = useMemo(() => {
    if (!fields) return []
    const out: { key: string; text: string; kind: string; trackId?: string }[] = []

    if (fields.trackId) {
      // The STORE's row, because only it carries the two hexes the dot is
      // painted with. The context is the fallback for the one case they differ:
      // a track archived after this line was parsed — where the name is still
      // the right word to show and the colour no longer matters.
      //
      // The chain then runs on through the OTHER name and the aliases, because
      // `trackToken()` does: a track whose `name` is blank can still be named by
      // `name_ar` or by an alias, and that token would arrive with no chip.
      const track = tracks.get(fields.trackId)
      const fromCtx = ctx.tracks.find((tr) => tr.id === fields.trackId)
      const name = firstNamed([
        track ? trackLabel(track) : '',
        fromCtx?.name,
        fromCtx?.nameAr,
        ...(fromCtx?.aliases ?? []),
      ])
      if (name) out.push({ key: 'track', text: name, kind: 'track', trackId: fields.trackId })
    }
    if (fields.ownerId) {
      // The token carries the HANDLE (what goes in the line); the chip shows the
      // NAME (what a person recognises).
      //
      // Read out of `ctx.members` rather than through the members store, and
      // that is deliberate rather than lazy: the context is the list the
      // validator approved this owner against and the list `parse()` will
      // resolve the token against, so a second read could name somebody the
      // suggestion is not actually about. It is also one hook fewer for the
      // capture screen to carry.
      //
      // THE HANDLE IS A FALLBACK, NOT A DECORATION. `display_name` is
      // `row.display_name?.trim() || ''` (api/members.ts:168) and an account
      // nobody has named is an ordinary, documented state — while
      // `ownerToken()` tries the USERNAME FIRST, so that member survives
      // `validate()` and emits `@nasser`. Reading only `displayName` here left
      // the chip empty, the row hidden, and Tab still assigning the entry to
      // somebody who was never on screen. Same sources as the token, so a token
      // can no longer outlive its chip.
      const member = ctx.members.find((m) => m.id === fields.ownerId)
      const name = firstNamed([member?.displayName, member?.username, ...(member?.aliases ?? [])])
      if (name) out.push({ key: 'owner', text: t('ai.chipOwner', { owner: name }), kind: 'owner' })
    }
    if (fields.priority) {
      out.push({ key: 'priority', text: vocabLabel('priority', fields.priority), kind: 'priority' })
    }
    if (fields.type) {
      out.push({ key: 'type', text: vocabLabel('type', fields.type), kind: 'type' })
    }
    if (fields.dueDate) {
      // The LONG form — "7 August 2026", not "07/08/2026". This chip is the
      // answer to "did it understand 'next friday'?", and a reader checking a
      // machine's arithmetic needs the month spelled out. The chip strip under
      // the box keeps the short form: that one is read at a glance dozens of
      // times a day, and this one is read once, carefully.
      out.push({
        key: 'due',
        text: t('ai.chipDue', { date: formatDateLong(fields.dueDate, locale) }),
        kind: 'due',
      })
    }
    if (fields.followUpDate) {
      out.push({
        key: 'fu',
        text: t('ai.chipFollowUp', { date: formatDateLong(fields.followUpDate, locale) }),
        kind: 'followUp',
      })
    }
    for (const tag of fields.tags) {
      out.push({ key: `tag-${tag}`, text: t('ai.chipTag', { tag }), kind: 'tag' })
    }
    return out
  }, [fields, tracks, trackLabel, vocabLabel, ctx, locale])

  /**
   * WORD FOR WORD THE CONDITION `takeAiTokens()` APPLIES.
   *
   * It used to carry `&& chips.length > 0` as well, and that extra term was the
   * defect rather than the safety net it looked like: Capture's Tab handler
   * (Capture.tsx:803) gates on the TOKENS alone, so any field that could make a
   * token but not a chip — an owner with no display name was the live one —
   * left this row rendering nothing while Tab quietly appended it. Two gates,
   * two answers, and the disagreement was invisible by construction.
   *
   * One gate now, and the chip list is what is made to match it: every source
   * `toTokens()` can write from is a source `chips` can name, and
   * `validate()` has already dropped every field that has no writable token at
   * all. `chips.length === tokens.length` is asserted in this component's test
   * for the member that used to break it.
   */
  const showing = mine !== null && tokens.length > 0

  // ANNOUNCED FOR THE FINISHED ARTICLE ONLY — never for the pending state, which
  // would read a sentence about waiting to a screen-reader user every time they
  // paused for breath.
  //
  // Computed during render rather than pushed in from an effect, which is the
  // usual trick for making sure a region exists before it changes. It does not
  // need to be: the <p> below is rendered on EVERY pass, empty when there is
  // nothing to say, so the region has been in the document since the screen
  // mounted and the only thing that changes is its text — which is exactly what
  // an assistive technology is watching for.
  //
  // `isolate()` fences the assembled list rather than the locale file doing it:
  // the summary is joined in TypeScript out of values whose direction is not
  // known until they resolve (lib/bidi's header names this case).
  const summary = chips.map((chip) => chip.text).join(' · ')
  const live = showing ? t('ai.announce', { summary: isolate(summary) }) : ''

  function accept(): void {
    const taken = takeAiTokens(line, parsed, ctx)
    if (!taken) return
    onAccept(taken)
  }

  function dismiss(): void {
    dismissSuggestion(line)
    onDismiss()
  }

  function report(): void {
    // Dismisses, un-caches and logs the field NAMES. It does not claim to have
    // filed anything: there is no feedback table yet, and the toast says only
    // what actually happened. See store/ai.reportSuggestionMiss().
    reportSuggestionMiss(line)
    onDismiss()
    toast(t('ai.reportedToast'))
  }

  return (
    <>
      {/* In the DOM from first render, empty until there is something to say. */}
      <p className="sr-only" role="status" aria-live="polite">
        {live}
      </p>

      {/* The quiet in-between. It occupies the slot the row will take, so
          accepting does not make the page jump under a thumb already moving. */}
      {!showing && pending && shouldSuggest(line, parsed) ? (
        <p className="ais-thinking">
          <span className="pill ais-badge">{t('ai.preview')}</span>
          <span className="ais-thinking-text">{t('ai.thinking')}</span>
        </p>
      ) : null}

      {showing ? (
        <section className="ais" aria-label={t('ai.rowLabel')}>
          <div className="ais-head">
            {/* Preview, on every AI surface in the app. Not decoration: it is
                the reason the "Not right" button beside it exists. */}
            <span className="pill ais-badge">{t('ai.preview')}</span>
            <h2 className="ais-title">{t('ai.understood')}</h2>
          </div>

          {/* Read-only by design. Correcting one chip means editing the line,
              and the line already has removable chips for exactly that — a
              second, differently-behaved chip strip here would be two grammars
              on one screen. */}
          <div className="chip-row ais-chips">
            {chips.map((chip) => {
              const track = chip.trackId ? tracks.get(chip.trackId) : undefined
              return (
                <span
                  key={chip.key}
                  className="chip ais-chip"
                  data-kind={chip.kind}
                  style={track ? trackVars(track.color, track.color_light) : undefined}
                >
                  {track ? <span className="track-dot" /> : null}
                  {chip.text}
                </span>
              )
            })}
          </div>

          <div className="ais-actions">
            <button type="button" className="btn btn-primary btn-sm ais-accept" onClick={accept}>
              {t('ai.accept')}
            </button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={dismiss}>
              {t('ai.dismiss')}
            </button>
            {/* The Preview convention's other half: a feature that cannot be
                corrected cannot be improved. One tap, no dialog, no form. */}
            <button type="button" className="btn btn-ghost btn-sm ais-wrong" onClick={report}>
              {t('ai.wrong')}
            </button>
          </div>

          {/* Said on screen, because a keyboard shortcut nobody is told about is
              a shortcut nobody uses. Enter is named too: the one thing this row
              may never do is leave a person unsure what Enter will submit. */}
          <p className="ais-hint">{t('ai.keysHint')}</p>
        </section>
      ) : null}
    </>
  )
}
