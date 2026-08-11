// `/entry/:id` — the entry detail as a PAGE, plus the one host that renders it
// as an overlay everywhere else.
//
// TWO SURFACES, ONE STORE, AND THE REASON THEY ARE NOT THE SAME THING.
//
// store/entrySheet holds "which entry is open". Follow-ups, the board, the
// timeline, capture and the dashboard all call `openEntry(id)` and none of them
// imports this file or the detail component — that is what makes Wave 2 five
// workers wide, and it is why `openEntry()` must NOT navigate: a board that
// pushed a URL per card tap would fill the history stack with twenty entries
// the Back button then walks out of one at a time, and "a panel over the list"
// is precisely the interaction that must not be a page change.
//
// So `EntryOverlayHost` is mounted ONCE at the app root, watches that store, and
// renders the sheet over whatever screen the user is on. It is the destination
// of every `openEntry()` in the app.
//
// The ROUTE is the other direction: a URL somebody was sent. A deep link from a
// chat message, a notification, or a phone's share sheet has no list behind it,
// so it renders as a full page — a modal panel over an empty background is a
// dialog over nothing, and its close button leads nowhere. The route still
// calls `openEntry(id)` so the rest of the app agrees about what is open
// (Wave 4's hotkey layer reads `getOpenEntryId()` from outside React), and the
// host stands down while the route is showing, so the two can never both paint.
//
// THE STORE NEVER DRIVES THE ROUTE; THE ROUTE DRIVES THE STORE. Everything
// here flows one way. The one thing that has to flow back — the entry stops
// being open when the user walks away from its page — is done by the host's
// route-change effect rather than by the page's unmount cleanup, and the
// comment on that effect says why StrictMode makes the difference matter.

import { useEffect, useRef, type ReactElement } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import EntrySheet from '../components/entry/EntrySheet'
import { IconArrowStart, IconChevronEnd } from '../components/icons'
import { toast } from '../components/toast'
import { t, useLocale } from '../lib/i18n'
import { useEntry } from '../store/entries'
import { closeEntry, openEntry, useOpenEntryId, useSheetSiblings } from '../store/entrySheet'
import './entry-page.css'

/**
 * The shareable address of an entry.
 *
 * `location.href` rather than a constructed string, and the page is the only
 * place this is offered from, because main.tsx mounts a **HashRouter** (GitHub
 * Pages is static hosting with no URL rewriting, so `/entry/x` would 404 on
 * refresh). Rebuilding `origin + pathname + '#/entry/' + id` by hand means
 * owning that decision in a second place, and it is exactly the kind of detail
 * that silently rots the day the router changes. On this route the browser's
 * own address bar already holds the answer.
 */
function currentUrl(): string {
  return window.location.href
}

/**
 * Copy, with an honest failure.
 *
 * `navigator.clipboard` is undefined on an insecure origin and rejects when the
 * gesture is not trusted, and both cases are silent — the user taps, nothing
 * appears to happen, and the link they think they copied is whatever was in the
 * clipboard before. Hence the explicit toast on the failure branch.
 */
async function copyLink(): Promise<void> {
  try {
    await navigator.clipboard.writeText(currentUrl())
    toast(t('entry.linkCopied'))
  } catch {
    toast(t('entry.errCopyLink'), { tone: 'error' })
  }
}

/* ────────────────────────────── the route ────────────────────────────── */

export default function Entry(): ReactElement {
  useLocale()
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const entryId = id ?? null
  const entry = useEntry(entryId)
  const siblings = useSheetSiblings()

  // Tell the rest of the app what is open. Nothing here closes it — that is the
  // host's job below, on the route change, and the difference is not stylistic.
  //
  // `openEntry()` KEEPS the sibling list when the target is already in it (see
  // its header), so arriving here from a list that pushed this URL preserves
  // the walk the user was doing, while a cold deep link gets an empty list and
  // no prev/next — which is the truth: there is no list. A `closeEntry()` in
  // this effect's cleanup would destroy exactly that: React's StrictMode
  // mounts, unmounts and remounts every component once in development, so the
  // cleanup would fire between the list's `openEntry(id, {list})` and this
  // one, and the page would lose its steppers on every dev run — a bug that
  // exists only where it gets reviewed.
  useEffect(() => {
    if (entryId !== null) openEntry(entryId)
  }, [entryId])

  // Prev/next PUSH, so Back walks the reading order the user just walked.
  // `openEntry` is not called here: the effect above fires on the new id and
  // does it, which keeps one code path instead of two that must agree.
  const step = (dir: 1 | -1): void => {
    const target = dir === 1 ? siblings.next : siblings.prev
    if (target !== null) void navigate(`/entry/${target}`)
  }

  // Back, with a floor. `navigate(-1)` alone lands outside the app when this
  // page IS the entry point — the deep-link case, which is the whole reason
  // this route renders as a page. `idx > 0` is React Router's own count of how
  // many entries it has pushed in this session, so the fallback fires exactly
  // when there is nothing of ours to go back to.
  const back = (): void => {
    const idx = (window.history.state as { idx?: number } | null)?.idx ?? 0
    if (idx > 0) void navigate(-1)
    // The map, not the follow-ups list: /followups is deleted and the map IS
    // where the app lands, so a deep link opened cold has somewhere real to go.
    else void navigate('/mindtree', { replace: true })
  }

  return (
    // Named by the entry itself once it is known: a screen reader listing the
    // page's regions should say which item this is, not the word "Details" —
    // which is also the name of the field section three headings down.
    <article className="epg" aria-label={entry?.title ?? t('entry.details')}>
      <div className="epg-bar">
        <button type="button" className="btn btn-ghost btn-sm" onClick={back}>
          <IconArrowStart size={16} className="icon-directional" />
          <span>{t('common.back')}</span>
        </button>

        <div className="epg-bar-end">
          {/* Only once there is something to link to. A copy button on a
              not-found page copies a URL that resolves to the same page.
              Text, not a glyph: components/icons.tsx publishes no link mark and
              it is a single-owner file this worker may not open — and a labelled
              word is the better control here anyway, since "copy" and "link"
              are two of the most-guessed-wrong icons there are. */}
          {entry && (
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => void copyLink()}
            >
              {t('entry.copyLink')}
            </button>
          )}

          {/* Stepping only exists when the user arrived from a list. A cold
              deep link has no siblings, and two permanently dead arrows are
              worse than none — so this whole group is absent rather than
              disabled, which is the opposite of the sheet's choice because the
              sheet is always opened FROM a list. */}
          {(siblings.prev !== null || siblings.next !== null) && (
            <div className="epg-steps">
              <button
                type="button"
                className="btn btn-ghost btn-icon"
                aria-label={t('entry.prev')}
                aria-disabled={siblings.prev === null || undefined}
                onClick={() => step(-1)}
              >
                <IconArrowStart size={18} className="icon-directional" />
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-icon"
                aria-label={t('entry.next')}
                aria-disabled={siblings.next === null || undefined}
                onClick={() => step(1)}
              >
                <IconChevronEnd size={18} className="icon-directional" />
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="epg-body">
        {/* `inline`: the detail component supplies the content and every one of
            its states — the wait, the load failure, the designed not-found —
            and this page supplies the frame. Nothing about the entry is
            re-implemented here; see that component's header. */}
        <EntrySheet
          entryId={entryId}
          presentation="inline"
          onClose={back}
          onNavigate={(next) => void navigate(`/entry/${next}`)}
        />
      </div>
    </article>
  )
}

/* ──────────────────────────── the overlay host ──────────────────────────── */

/**
 * Mounted ONCE, at the app root, beside the toaster and the confirm host — for
 * the same reason those two are: `openEntry()` is called from five screens and
 * from a toast action, and the surface it opens cannot live inside the
 * component that asked, because that component is often the row the edit is
 * about to re-key out of the list.
 *
 * It renders nothing while the `/entry/:id` route is showing. The route already
 * calls `openEntry()`, so without that check a deep link would paint the page
 * and a panel over it, both bound to the same entry, both editing the same
 * fields.
 */
export function EntryOverlayHost(): ReactElement | null {
  useLocale()
  const openId = useOpenEntryId()
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const onRoute = pathname.startsWith('/entry/')
  const wasOnRoute = useRef(onRoute)

  // LEAVING THE ENTRY ROUTE CLOSES THE ENTRY, and it is done here rather than
  // in the page's unmount cleanup for a specific reason: this component mounts
  // once for the session, so its effect cannot be caught by StrictMode's
  // mount/unmount/remount cycle the way an unmount cleanup on the page is.
  //
  // Something has to do it. The route claims the entry on mount so the rest of
  // the app agrees about what is open; without this, walking away to the board
  // would leave that claim standing and this host would slide a panel over the
  // board the moment it painted. `wasOnRoute` is what keeps it narrow: an
  // entry opened from a list, on a screen that was never the entry route, is
  // none of this effect's business.
  useEffect(() => {
    if (wasOnRoute.current && !onRoute) closeEntry()
    wasOnRoute.current = onRoute
  }, [onRoute])

  if (openId === null) return null
  if (onRoute) return null

  return (
    <EntrySheet
      entryId={openId}
      onClose={closeEntry}
      // The escape hatch out of the overlay and into an address: a URL is the
      // only form of an entry that can be sent to somebody. Deliberately NOT
      // preceded by closeEntry() — that would drop the sibling list with the
      // id, and the page the user is about to land on would have lost the walk
      // they were doing. The route stands this host down by itself.
      onOpenPage={(id) => void navigate(`/entry/${id}`)}
    />
  )
}
