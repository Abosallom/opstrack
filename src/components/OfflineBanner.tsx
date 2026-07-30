// Connectivity AND the outbox, in the one strip between the header and the page.
//
// Wave 1 shipped this as `navigator.onLine` and nothing else, which was half the
// signal: the queue that fills up while `onLine` is false had no surface at all
// (store/outbox.ts:503 — "STILL UNRENDERED"), so a user with five stranded
// writes saw the same yellow bar as a user with none, and the bar disappeared
// the moment the network came back whether or not anything had actually been
// sent. This component now reads both, and hands the list to OutboxSheet.
//
// ── THE WRAPPER IS THE LIVE REGION, AND STAYS MOUNTED ─────────────────────
//
// Screen readers only announce content inserted into a region that ALREADY
// exists; mounting the region together with its message announces nothing. So
// `.offline-region` is always rendered and collapses to zero height when empty
// (`:empty`, in offline-banner.css). The sheet is a SIBLING of it rather than a
// child: it is a dialog, not a status message, and although Sheet portals to
// <body> and would leave no node behind either way, "the live region contains
// exactly the live message" is the property worth being able to read off the
// JSX.
//
// ── WHAT THE REGION ANNOUNCES, AND WHAT IT DELIBERATELY DOES NOT ──────────
//
// A polite live region re-announces on every change to its text. During a drain
// the pending count falls 5, 4, 3, 2, 1 — five announcements of a number the
// user did not ask for, arriving one after another, which is how a live region
// stops being read at all. So while a flush is in flight the MESSAGE is the
// stable "Syncing…" and the count rides in `.offline-banner-count`, which is
// aria-hidden; the count is part of the message only when the queue is sitting
// still, where it changes once per capture. A screen-reader user therefore hears
// "3 changes waiting to sync" → "Syncing…" → "Everything is synced", which is
// the shape of the event rather than a countdown.
//
// ── TONE WITHOUT TOUCHING app-shell.css ───────────────────────────────────
//
// `.offline-banner` and `.offline-banner-dot` belong to app-shell.css (the
// prefix registry, EXECUTION-PLAN §1.0.7) and this worker may not restyle them,
// so the four ATTENTION states — offline, queued, syncing, failed — all wear its
// yellow chrome and differ by the indicator and the sentence. The two transient
// OK states get `.offline-note`, a class this file's own sheet owns, rather than
// a green rule bolted onto somebody else's selector. A `data-tone` on
// `.offline-banner` would be the tidier end state; it is one line in a file this
// worker does not own, and the handoff note asks for it.
//
// ── WHY IT PIGGYBACKS ON flushOutbox() INSTEAD OF POLLING ─────────────────
//
// The engine exposes no "am I flushing" flag, and this component may not add one
// (its logic is frozen for this gap). But `flushOutbox()` returns the IN-FLIGHT
// promise when a drain is already running (`if (flushing) return flushing`), so
// calling it costs nothing and hands back exactly the promise to await. That is
// what `runFlush()` does on the `online` transition — main.tsx's own listener
// has already started the drain by then — and what the sheet's Retry button
// does when nothing is running. No timer, no second drain, no reset of the
// engine's backoff.

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactElement,
} from 'react'
import OutboxSheet from './OutboxSheet'
import { IconChevronEnd } from './icons'
import { t, useLocale } from '../lib/i18n'
import { flushOutbox, useOutbox, usePendingCount } from '../store/outbox'
import './offline-banner.css'

/* ---------- connectivity ---------- */

function subscribeOnline(onChange: () => void): () => void {
  window.addEventListener('online', onChange)
  window.addEventListener('offline', onChange)
  return () => {
    window.removeEventListener('online', onChange)
    window.removeEventListener('offline', onChange)
  }
}

/**
 * `navigator.onLine` read in the ONE direction it is reliable, exactly as
 * store/outbox.ts reads it: a `false` is trustworthy, a `true` is not (it is
 * `true` on a captive portal). Hence "offline → say so" and never "online →
 * claim success". Missing entirely — node, a static render — counts as online,
 * because pretending a server render is offline would ship the banner into
 * markup that has no network state at all.
 */
function readOnline(): boolean {
  return typeof navigator === 'undefined' || navigator.onLine !== false
}

/**
 * True unless the browser is certain it is offline.
 *
 * useSyncExternalStore rather than useState + two listeners: the state lives on
 * `navigator`, not in React, and this keeps the first render and the store in
 * step instead of painting "online" and correcting it in an effect.
 */
function useOnline(): boolean {
  return useSyncExternalStore(subscribeOnline, readOnline, () => true)
}

/* ---------- the banner ---------- */

/** How long "Back online" / "Everything is synced" stays up. */
const FLASH_MS = 4_000

type Flash = 'backOnline' | 'synced'

export default function OfflineBanner(): ReactElement {
  useLocale()
  const online = useOnline()
  const pending = usePendingCount()
  // The full list, for the failure count. This does subscribe the shell to every
  // queue mutation — but those happen once per enqueue (which COLLAPSES, so a
  // field being typed in is one) and once per drained item, not per keystroke,
  // and the banner has to re-render on exactly those moments anyway.
  const items = useOutbox()
  const failed = items.reduce((n, item) => (item.error !== null ? n + 1 : n), 0)

  const [sheetOpen, setSheetOpen] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [flash, setFlash] = useState<Flash | null>(null)

  const runFlush = useCallback((): void => {
    setSyncing(true)
    // flushOutbox() never rejects — the drain's contract — so `finally` is
    // about the flag, not about swallowing anything.
    void flushOutbox().finally(() => setSyncing(false))
  }, [])

  // Back online. `pending` is in the deps only so the guard above it reads the
  // current queue; a change to it alone returns immediately.
  const wasOnline = useRef(online)
  useEffect(() => {
    if (online === wasOnline.current) return
    wasOnline.current = online
    if (!online) {
      setFlash(null)
      return
    }
    if (pending > 0) runFlush()
    else setFlash('backOnline')
  }, [online, pending, runFlush])

  // The queue emptied. A DISCARD empties it too, and "Everything is synced"
  // about a write the user just threw away is a lie — OutboxSheet sets this flag
  // before it removes the item, so the two are told apart.
  const hadPending = useRef(pending > 0)
  const discarded = useRef(false)
  useEffect(() => {
    const had = hadPending.current
    hadPending.current = pending > 0
    if (!had || pending > 0) return
    if (discarded.current) {
      discarded.current = false
      return
    }
    setFlash('synced')
  }, [pending])

  useEffect(() => {
    if (flash === null) return undefined
    const timer = window.setTimeout(() => setFlash(null), FLASH_MS)
    return () => window.clearTimeout(timer)
  }, [flash])

  const attention = !online || pending > 0

  // Message, badge and announced count, in priority order: what is WRONG beats
  // what is happening, and what is happening beats what is merely waiting.
  //
  // The BADGE is the bare number, in `.offline-banner-count` — a chip
  // app-shell.css gives `font-variant-numeric: tabular-nums`, which is what it
  // was designed to hold. The count SENTENCE went in there first and wrapped the
  // strip onto two lines on a 375px phone while ellipsising the warning beside
  // it; the number is the glanceable half, and the sentence is one tap away in
  // the sheet.
  //
  // `srCount` is that sentence for a screen reader, and it is deliberately
  // ABSENT while a flush runs: see the live-region note in this file's header.
  // Where the message already carries the count, it is absent too, rather than
  // said twice.
  let message: string
  let badge: string | null = null
  let srCount: string | null = null
  if (!online) {
    message = t('offline.banner')
    if (pending > 0) {
      badge = String(pending)
      srCount = t('offline.pending', { count: pending })
    }
  } else if (failed > 0) {
    message = t('offline.syncFailed', { count: failed })
  } else if (syncing) {
    message = t('offline.syncing')
    badge = String(pending)
  } else {
    message = t('offline.pending', { count: pending })
  }

  return (
    <>
      <div className="offline-region" role="status" aria-live="polite">
        {attention && (
          <div className="offline-banner">
            {pending > 0 ? (
              <button
                type="button"
                className="offline-open"
                aria-haspopup="dialog"
                aria-expanded={sheetOpen}
                onClick={() => setSheetOpen(true)}
              >
                <Indicator syncing={syncing} />
                <span className="offline-msg">{message}</span>
                {badge !== null && (
                  <span className="offline-banner-count" aria-hidden="true">
                    {badge}
                  </span>
                )}
                {/* The button's name is the message, then the count where the
                    message does not already carry it, then what tapping does. */}
                {srCount !== null && <span className="sr-only">{srCount}</span>}
                <span className="sr-only">{t('offline.openOutbox')}</span>
                <IconChevronEnd className="icon-directional offline-chevron" size={16} />
              </button>
            ) : (
              <>
                <span className="offline-banner-dot" aria-hidden="true" />
                <span className="offline-msg">{message}</span>
              </>
            )}
          </div>
        )}
        {!attention && flash !== null && (
          <div className="offline-note">
            <span className="offline-note-dot" aria-hidden="true" />
            <span className="offline-msg">
              {flash === 'backOnline' ? t('offline.backOnline') : t('offline.synced')}
            </span>
          </div>
        )}
      </div>
      <OutboxSheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        online={online}
        syncing={syncing}
        onRetry={runFlush}
        onDiscarded={() => {
          discarded.current = true
        }}
      />
    </>
  )
}

/**
 * The dot, or a spinner while a drain is running.
 *
 * Same 8px footprint either way, so the message does not shift sideways when a
 * flush starts — `.offline-banner-dot` is app-shell.css's and is reused rather
 * than restyled.
 */
function Indicator({ syncing }: { syncing: boolean }): ReactElement {
  return syncing ? (
    <span className="offline-spin" aria-hidden="true" />
  ) : (
    <span className="offline-banner-dot" aria-hidden="true" />
  )
}
