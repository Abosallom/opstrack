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
import { postUpdate, useEntryUpdates } from '../../store/entries'
import { useMemberMap } from '../../store/members'
import { useVocabLabel } from '../../store/vocab'
import './entry.css'

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
    // The store applies the row optimistically and toasts on failure, so the
    // only thing left to decide here is whether to clear the box — and it is
    // cleared only on success. Clearing eagerly loses what the user wrote the
    // one time it actually mattered.
    const result = await postUpdate({ entryId, body: text })
    setPosting(false)
    if (result.ok) setBody('')
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

      {error !== null && <p className="upd-error">{t(error)}</p>}

      {loading && updates.length === 0 && <p className="muted">{t('common.loading')}</p>}

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
                      from "rightwards arrow" to silence. */}
                  <span aria-hidden="true">→</span>
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
