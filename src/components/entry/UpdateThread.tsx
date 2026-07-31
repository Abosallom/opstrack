// The entry's update thread: a compose box on top, the immutable history below,
// oldest first.
//
// THERE IS NO EDIT AND NO DELETE ON A THREAD ROW, and their absence is the
// feature. `entry_updates` has no UPDATE and no DELETE policy in migration 0001
// — immutability is enforced by the ABSENCE of those policies under RLS, not by
// this component being polite about it. So an edit button here could not
// succeed even if someone added one: PostgREST would return zero rows and the
// user would watch their correction silently fail. More to the point, this
// thread is the audit trail the whole product exists to produce; a status
// change that can be rewritten afterwards proves nothing. Corrections are
// APPENDED — t('entry.immutableHint') says exactly that, in the UI, so nobody
// has to guess why the affordance is missing.
//
// OLDEST FIRST, matching listUpdates()' ordering, because a thread reads as a
// conversation. The compose box is at the TOP anyway: on a long thread the
// alternative is scrolling past forty updates to reach the one control, and on
// a phone that is the difference between logging a change and not bothering.
//
// The fetch is NOT written here. useEntryUpdates() is self-loading and deduped
// in flight — two components rendering the same thread would otherwise issue
// two requests and race each other into the store.

import { useState, type ReactElement } from 'react'
import { StatusPill } from './atoms'
import { formatRelativeTime } from '../../lib/dates'
import { t, useLocale } from '../../lib/i18n'
import { useAuth } from '../../store/auth'
import { loadUpdates, postUpdate, useEntryUpdates } from '../../store/entries'
import { useMemberMap } from '../../store/members'
import { useVocabLabel } from '../../store/vocab'
import { toast } from '../toast'
import type { ApiResult } from '../../api/result'
import type { EntryUpdate, NewEntryUpdate } from '../../types'
import './entry.css'

/**
 * store/entries.ts's private QUEUED_KEY, duplicated as a literal for the reason
 * Board.tsx:193 and Capture.tsx:92 duplicate it: the store does not export it.
 *
 * It is a NOTICE AND NOT A FAILURE — `store/outbox.ts:488` freezes that
 * contract, and `postUpdate()` honours it by leaving the optimistic thread row
 * in place and returning early. Treating it as a failure here would be the
 * expensive kind of wrong: the update is visibly in the thread, the box still
 * holds the text, nothing says it was saved, so the user presses Post again —
 * and `postUpdate()` mints a fresh tempId per call (entries.ts:1576), so the
 * dedupe key differs and the queue holds TWO inserts of the same sentence.
 * `entry_updates` has no UPDATE and no DELETE policy, so once they flush,
 * neither copy can ever be removed.
 */
const QUEUED_KEY = 'offline.queued'

/**
 * Post one composed update and answer whether the COMPOSER MAY CLEAR.
 *
 * Lifted out of the event handler for the reason CommandPalette.tsx lifts its
 * ranker and its focus-restore predicate: vitest runs `environment: 'node'`, so
 * a decision left inside an onClick is a decision no test in this repo can
 * reach — and the wrong answer here is not recoverable by the user.
 *
 * `post` and `notify` are parameters with the real implementations as defaults,
 * so the component below reads exactly as it would with them inlined and the
 * test can drive all three outcomes.
 *
 * THE THREE OUTCOMES:
 *   ok            → true, silently. The row appearing in the thread IS the
 *                   feedback; a toast on top of it is noise on every post.
 *   QUEUED_KEY    → true, WITH a notice. The row appears the same way and means
 *                   something different — it is on this device only.
 *   anything else → false. The store has already rolled the row back and toasted
 *                   the reason; the text stays in the box because it is now the
 *                   only copy of what the user wrote.
 */
export async function submitComposerUpdate(
  input: NewEntryUpdate,
  post: (i: NewEntryUpdate) => Promise<ApiResult<EntryUpdate>> = postUpdate,
  notify: (message: string) => void = toast,
): Promise<boolean> {
  const result = await post(input)
  if (result.ok) return true
  if (result.error !== QUEUED_KEY) return false
  notify(t(QUEUED_KEY))
  return true
}

export interface UpdateThreadProps {
  entryId: string
  autoFocusCompose?: boolean
  /** Hides the compose box. The thread itself is always read-only. */
  readOnly?: boolean
  /** Show only the newest N until the user asks for the rest. Default 5. */
  collapseAfter?: number
}

export default function UpdateThread({
  entryId,
  autoFocusCompose,
  readOnly,
  collapseAfter = 5,
}: UpdateThreadProps): ReactElement {
  const locale = useLocale()
  const { updates, loading, error } = useEntryUpdates(entryId)
  const { profile } = useAuth()
  const memberMap = useMemberMap()
  const vocabLabel = useVocabLabel()
  const [body, setBody] = useState('')
  const [posting, setPosting] = useState(false)
  const [expanded, setExpanded] = useState(false)

  const hidden = expanded ? 0 : Math.max(0, updates.length - collapseAfter)
  const shown = hidden === 0 ? updates : updates.slice(hidden)

  const post = async (): Promise<void> => {
    const text = body.trim()
    if (text === '' || posting) return
    setPosting(true)
    // The store applies the row optimistically and toasts on a real failure, so
    // the only thing left to decide here is whether to clear the box — and the
    // answer is above, where it can be tested.
    const clear = await submitComposerUpdate({ entryId, body: text })
    setPosting(false)
    if (clear) setBody('')
  }

  return (
    <div className="upd">
      {!readOnly && (
        <div className="upd-compose">
          <textarea
            className="input upd-compose-input"
            rows={2}
            value={body}
            placeholder={t('entry.updatePlaceholder')}
            aria-label={t('entry.addUpdate')}
            // Announced rather than disabled: taking the box away mid-post
            // moves focus to <body>, and the post takes one round trip during
            // which the user may well want to keep typing the next one.
            aria-busy={posting || undefined}
            autoFocus={autoFocusCompose}
            onChange={(e) => setBody(e.target.value)}
            onKeyDown={(e) => {
              // Enter is a newline in a multi-line box; the modified chord
              // posts. An update is often three lines of what happened.
              if (e.key !== 'Enter' || !(e.metaKey || e.ctrlKey)) return
              e.preventDefault()
              void post()
            }}
          />
          <div className="upd-compose-actions">
            <span className="upd-immutable">{t('entry.immutableHint')}</span>
            <button
              type="button"
              className="btn btn-sm btn-primary"
              // aria-disabled, not disabled: the button keeps its name and its
              // focus so a keyboard user is told why nothing happened instead
              // of tabbing into a control that has quietly stopped existing.
              aria-disabled={body.trim() === '' || posting || undefined}
              onClick={() => void post()}
            >
              {posting ? t('entry.posting') : t('entry.post')}
            </button>
          </div>
        </div>
      )}

      {/* An error with no way out is just a label. The thread is the audit
          trail, so "we could not load it" has to come with the one action that
          might fix it — `force`, because the store would otherwise consider the
          failed attempt good enough and return the same empty thread. */}
      {error !== null && (
        <>
          <p className="upd-error" role="alert">
            {t(error)}
          </p>
          {/* A sibling rather than a child of the paragraph, so the retry needs
              no rule in entry.css — `.upd-error` is a two-line colour/size rule
              belonging to another owner's sheet, and the global button
              primitives already look right underneath it. */}
          <button
            type="button"
            className="btn btn-sm btn-ghost"
            onClick={() => void loadUpdates(entryId, true)}
          >
            {t('common.retry')}
          </button>
        </>
      )}

      {loading && updates.length === 0 && (
        <p className="muted" role="status">
          {t('common.loading')}
        </p>
      )}

      {!loading && updates.length === 0 && (
        <div className="upd-empty">
          <p>{t('entry.noUpdates')}</p>
          <p className="muted">{t('entry.noUpdatesHint')}</p>
        </div>
      )}

      {hidden > 0 && (
        <button type="button" className="btn btn-sm btn-ghost" onClick={() => setExpanded(true)}>
          {t('entry.showEarlier', { count: hidden })}
        </button>
      )}

      <ol className="upd-list">
        {shown.map((update) => {
          // Resolved through the member MAP rather than useMemberLabel(),
          // which falls back to t('entry.unassigned') — the right answer for an
          // owner field and the wrong one here. An update whose author's
          // profile has since been deleted was still written by someone.
          const author =
            update.author_id === null
              ? t('entry.authorUnknown')
              : update.author_id === profile?.id
                ? t('entry.author')
                : (memberMap.get(update.author_id)?.displayName ?? t('entry.authorUnknown'))
          // Read into locals so TypeScript narrows them for the JSX below. A
          // `const isTransition = a !== null && b !== null` does not narrow the
          // fields themselves, and the alternative is two non-null assertions
          // on a row that a realtime patch could in principle have replaced.
          const from = update.status_from
          const to = update.status_to

          return (
            <li key={update.id} className="upd-item">
              <div className="upd-head">
                <span className="upd-author">{author}</span>
                <time className="upd-time tabular" dateTime={update.created_at}>
                  {formatRelativeTime(update.created_at, locale)}
                </time>
              </div>

              {from !== null && to !== null && (
                // The two pills carry the labels through the vocab store, so an
                // admin renaming "waiting_on" re-labels every historical
                // transition in this thread with ZERO writes — the frozen-key
                // payoff, and Wave 2 gate (g) checks exactly this.
                <p className="upd-transition">
                  <StatusPill status={from} size="sm" />
                  {/* The arrow is decorative; the sentence below is what a
                      screen reader gets, because "→" is announced as anything
                      from "rightwards arrow" to silence.

                      THROUGH t(), and not because of a style rule about
                      literals. U+2192 has bidi class ON and the bidi algorithm
                      does not mirror it, so a hardcoded "→" keeps pointing right
                      under dir=rtl while the two pills beside it lay out
                      right-to-left — it would point from the NEW status back at
                      the OLD one, and the thread would read "to → from" in
                      Arabic. `entry.arrow` is seeded → / ←, so the glyph flips
                      with the language the same way the pills do. */}
                  <span aria-hidden="true">{t('entry.arrow')}</span>
                  <StatusPill status={to} size="sm" />
                  <span className="sr-only">
                    {t('entry.statusChangedBy', {
                      name: author,
                      from: vocabLabel('status', from),
                      to: vocabLabel('status', to),
                    })}
                  </span>
                </p>
              )}

              {update.body !== '' && <p className="upd-body">{update.body}</p>}
            </li>
          )
        })}
      </ol>

      {expanded && updates.length > collapseAfter && (
        <button type="button" className="btn btn-sm btn-ghost" onClick={() => setExpanded(false)}>
          {t('entry.showFewer')}
        </button>
      )}
    </div>
  )
}
