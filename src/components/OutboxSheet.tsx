// The outbox, made visible: what is queued, why it has not landed, and the two
// things a user can do about it.
//
// ── WHY THIS FILE EXISTS ──────────────────────────────────────────────────
//
// store/outbox.ts shipped a complete offline engine — persistence, collapse,
// temp-id resolution, bounded backoff — behind two hooks with ZERO call sites,
// and said so in its own source (`STILL UNRENDERED`, :503). Every write made
// offline answered `fail('offline.queued')` — "saved on this device" — and then
// vanished from the interface: no count, no list, no way to retry, and no way
// to abandon a write that can never land. A promise the app cannot show is
// indistinguishable from one it did not keep. This component and
// OfflineBanner.tsx are the other half of that promise.
//
// ── IT CONSUMES THE ENGINE, IT DOES NOT REIMPLEMENT IT ────────────────────
//
// Everything here comes from `useOutbox()` and goes back through
// `discardOutboxItem()` / `flushOutbox()`. No retry loop, no timer, no second
// copy of the queue. The one exception worth naming is that RETRY IS GLOBAL, not
// per item: `flushOutbox()` drains in insertion order and stops at the first
// failure (that is the engine's contract, and it is what keeps a create ahead of
// the update that depends on it), so a per-row "retry this one" button would be
// a lie about the ordering. The row-level action is DISCARD, which the engine
// does support per item.
//
// ── t(item.error) IS NOT SAFE, AND THAT IS THE BUG THIS FILE FIXES ────────
//
// `OutboxItem.error` is documented as "i18n key of the last failure", and the
// obvious rendering — `t(item.error)` — is wrong twice over:
//
//   · The engine's own key, 'offline.syncFailed', is a PLURAL NODE. t() with no
//     `count` resolves a plural node to its `other` form, so the row would read
//     "{count} changes couldn't sync." with the braces on screen. It is also the
//     wrong sentence: on an item, that key means "this op waits on a temp id no
//     queued insert can mint any more" (outbox.ts:620) — a dead write, not a
//     count.
//   · Every other value comes from pgErrorKey() or an api layer, and an
//     unmapped one echoes back as its own dot path.
//
// So the mapping goes through outboxErrorMessage(), which special-cases the
// engine's key and then refuses anything that still looks like a key or still
// has an unfilled `{token}` in it. Exported, and pinned by a test.

import { useCallback, type ReactElement } from 'react'
import { confirm } from './Confirm'
import Sheet from './sheet/Sheet'
import { EmptyState } from './shared'
import { toast } from './toast'
import { IconCheck } from './fields/glyphs'
// The same 60-second clock the notification inbox uses, imported rather than
// re-written: "queued 4 min ago" going stale while the sheet sits open is the
// exact case that hook was written for. It belongs in components/shared.tsx
// eventually — that file is not this worker's to touch, so the handoff note
// asks the integrator to move it and swap both imports.
import { useMinuteTick } from './NotificationBell'
import { isolate } from '../lib/bidi'
import { formatRelativeTime } from '../lib/dates'
import { t, useLocale, type Locale } from '../lib/i18n'
import { useEntryMap } from '../store/entries'
import { discardOutboxItem, useOutbox, type MutOp, type OutboxItem } from '../store/outbox'
import './outbox.css'

/* ---------- naming a queued write ---------- */

/**
 * Just enough of the entries store to name a row's target.
 *
 * Structural rather than `ReadonlyMap<string, Entry>` so the lookup is the only
 * thing this file depends on — the store's real map satisfies it, and a test can
 * pass two titles without constructing an Entry.
 */
export type TitleLookup = ReadonlyMap<string, { title: string }>

/**
 * `${table}:${op}` → the label key, mirroring TRANSPORTS in store/outbox.ts.
 *
 * Written as literals rather than built from the op (`offline.op${table}`) for
 * the reason lib/localeReach.test.ts's header gives: a key assembled at runtime
 * is invisible to the reachability scan, which is how the Wave-2 SLA keys
 * shipped missing in both bundles. The keys below are quoted dotted strings, so
 * that gate sees every one of them.
 *
 * OutboxSheet.test.ts asserts this map covers exactly `OUTBOX_ROUTES`, so the
 * wave that registers a transport for tracks or vocab cannot leave its rows
 * rendering "Pending change".
 */
const OP_LABELS: Readonly<Record<string, string>> = {
  'entries:insert': 'offline.opEntryCreate',
  'entries:update': 'offline.opEntryEdit',
  'entry_updates:insert': 'offline.opNote',
  'meetings:insert': 'offline.opMeetingCreate',
  'meetings:update': 'offline.opMeetingEdit',
  'meeting_lines:insert': 'offline.opMeetingLine',
  'meeting_lines:update': 'offline.opMeetingLineEdit',
  'notifications:update': 'offline.opNotification',
}

/** The label key for an op. Unregistered routes get the neutral fallback. */
export function outboxLabelKey(op: MutOp): string {
  return OP_LABELS[`${op.table}:${op.op}`] ?? 'offline.opOther'
}

/**
 * The one human-readable field of a payload, if it has one.
 *
 * "Entry edit" alone is not enough to decide whether to discard a write — the
 * question the user actually has is *which* one. The three names cover every
 * registered route that carries text (`title` on entries and meetings, `body` on
 * a thread note, `raw` on a meeting line); anything else renders with its label
 * only rather than with a guess.
 *
 * Reads the payload structurally because `MutOp.payload` is `unknown` by design
 * — the envelope is frozen and deliberately not a discriminated union — so this
 * is a type guard, not a cast.
 */
export function outboxDetail(op: MutOp, titles?: TitleLookup): string {
  const payload = op.payload
  if (typeof payload === 'object' && payload !== null) {
    const record = payload as Record<string, unknown>
    for (const field of ['title', 'body', 'raw']) {
      const value = record[field]
      if (typeof value === 'string' && value.trim() !== '') return value.trim()
    }
  }
  // A PATCH carries only what changed, and the commonest queued write of all —
  // a snooze, a status flip, an owner swap — carries no text at all. Its target
  // is the entry, so the row falls back to that entry's title if this client
  // holds it. It often will not (offline, and the row was never fetched), which
  // is why this is a fallback and not the primary source.
  if (op.table === 'entries' && op.id !== null) {
    return titles?.get(op.id)?.title.trim() ?? ''
  }
  return ''
}

/**
 * A row's failure, as a sentence. See this file's header for why `t(key)` alone
 * is not it.
 *
 * The last check is the general one: t() echoes an unknown key verbatim, and a
 * plural node asked without a count keeps its literal `{count}`. Either way the
 * user gets the neutral "couldn't send" line instead of an identifier or a pair
 * of braces, and the raw key still reaches the console for whoever is debugging.
 */
export function outboxErrorMessage(key: string | null): string | null {
  if (key === null) return null
  // The engine's own marker: this op depends on a temp id that no queued insert
  // will ever mint (outbox.ts:620). It is not retryable and never will be, so it
  // gets the sentence that says so and points at the only action left.
  if (key === 'offline.syncFailed') return t('offline.itemStuck')
  const message = t(key)
  if (message === key || message.includes('{')) return t('offline.itemFailed')
  return message
}

/* ---------- the sheet ---------- */

export interface OutboxSheetProps {
  open: boolean
  onClose: () => void
  /** True while a flush THIS app started is in flight. Owned by the banner. */
  syncing: boolean
  online: boolean
  /** Runs a flush and tracks it, so the banner and this footer agree. */
  onRetry: () => void
  /**
   * Fired before an item is discarded.
   *
   * The banner flashes "Everything is synced" when the queue drains to zero, and
   * a discard empties it just as effectively — congratulating the user on
   * syncing a write they just threw away. This lets the banner tell the two
   * apart; the toast below is what reports the discard.
   */
  onDiscarded?: () => void
}

/**
 * The queued-writes list.
 *
 * Rendered by OfflineBanner rather than by the shell, because the banner is the
 * only entrance to it and owns the online/syncing state the footer needs. Sheet
 * gives it the panel/bottom-sheet split, the focus trap, Escape arbitration and
 * the close button; this file adds the rows.
 */
export default function OutboxSheet({
  open,
  onClose,
  syncing,
  online,
  onRetry,
  onDiscarded,
}: OutboxSheetProps): ReactElement | null {
  const locale = useLocale()
  const items = useOutbox()
  // One subscription for the whole list, so a row is not a store consumer. The
  // map is only ever READ here — an entry the client does not hold simply has no
  // title to show.
  const titles = useEntryMap()
  // Only ticks while the sheet is open — an interval behind a closed overlay
  // re-renders the shell once a minute for nobody.
  const now = useMinuteTick(open)

  const discard = useCallback(
    async (item: OutboxItem): Promise<void> => {
      // An insert other queued ops were built on top of. Discarding it strands
      // them permanently — the drain marks them and skips them for ever — so the
      // confirmation says so instead of letting the user find out later.
      const tempId = item.op.tempId
      const dependents =
        tempId === null
          ? 0
          : items.filter((other) => other.id !== item.id && other.op.dependsOn.includes(tempId))
              .length
      const body =
        dependents > 0
          ? `${t('offline.discardBody')} ${t('offline.discardDependents', { count: dependents })}`
          : t('offline.discardBody')
      const ok = await confirm({
        title: t('offline.discardTitle'),
        body,
        confirmLabel: t('offline.discard'),
        cancelLabel: t('common.cancel'),
        danger: true,
      })
      if (!ok) return
      // Before the store write, so the banner's flag is set by the time the
      // resulting render tells it the queue is empty.
      onDiscarded?.()
      discardOutboxItem(item.id)
      toast(t('offline.discarded'))
    },
    [items, onDiscarded],
  )

  if (!open) return null

  const footer = (
    <button
      type="button"
      // `.btn-block`: Sheet's footer is a plain block, so a full-width control
      // is both the honest way to place it and the right one for a thumb.
      className="btn btn-primary btn-block"
      // Offline there is nothing to retry against, and a second flush while one
      // is in flight is a no-op the user reads as a dead button.
      disabled={!online || syncing || items.length === 0}
      onClick={onRetry}
    >
      {syncing ? t('offline.syncing') : t('offline.retry')}
    </button>
  )

  return (
    <Sheet open onClose={onClose} title={t('offline.outbox')} footer={footer}>
      {items.length === 0 ? (
        <EmptyState
          icon={<IconCheck size={28} />}
          title={t('offline.synced')}
          description={t('offline.emptyHint')}
        />
      ) : (
        <>
          <p className="obx-hint">{t('offline.outboxHint')}</p>
          <OutboxList
            items={items}
            titles={titles}
            locale={locale}
            now={now}
            onDiscard={discard}
          />
        </>
      )}
    </Sheet>
  )
}

/* ---------- the list ---------- */

export interface OutboxListProps {
  items: readonly OutboxItem[]
  /** Entry titles, for the patches that carry no text of their own. */
  titles: TitleLookup
  /** Passed in rather than read per row: one locale subscription per surface. */
  locale: Locale
  now: Date
  onDiscard: (item: OutboxItem) => void | Promise<void>
}

/**
 * The rows, without the sheet around them.
 *
 * Split out for the same reason NotificationBell exports `NotificationBody`:
 * Sheet renders through createPortal, and react-dom/server — the repo's only
 * rendering harness, since vitest runs in `node` — refuses portals outright. A
 * list that can only be reached through an open dialog is a list no test in this
 * repo can look at.
 */
export function OutboxList({
  items,
  titles,
  locale,
  now,
  onDiscard,
}: OutboxListProps): ReactElement {
  return (
    // No aria-label: the sheet's own title is the visible heading above this
    // list, and naming the list the same thing announces it twice.
    <ul className="obx-list">
      {items.map((item) => (
        <OutboxRow
          key={item.id}
          item={item}
          titles={titles}
          locale={locale}
          now={now}
          onDiscard={onDiscard}
        />
      ))}
    </ul>
  )
}

/* ---------- one queued write ---------- */

interface OutboxRowProps {
  item: OutboxItem
  titles: TitleLookup
  locale: Locale
  now: Date
  onDiscard: (item: OutboxItem) => void | Promise<void>
}

function OutboxRow({ item, titles, locale, now, onDiscard }: OutboxRowProps): ReactElement {
  const failure = outboxErrorMessage(item.error)
  const detail = outboxDetail(item.op, titles)
  // `queuedAt` is epoch millis; lib/dates speaks ISO instants.
  const queuedAt = new Date(item.queuedAt).toISOString()

  return (
    <li className="obx-item" data-failed={failure !== null || undefined}>
      <div className="obx-item-body">
        <p className="obx-item-label">{t(outboxLabelKey(item.op))}</p>
        {/* User data of unknown direction inside a right-to-left (or
            left-to-right) column: FSI so an Arabic title in an English UI and a
            Latin one in an Arabic UI both read the way they were typed. */}
        {detail !== '' && <p className="obx-item-detail">{isolate(detail)}</p>}
        <p className="obx-item-meta">
          <time className="obx-item-time" dateTime={queuedAt}>
            {formatRelativeTime(queuedAt, locale, now)}
          </time>
          {/* "Waiting to send" in both connectivity states: the banner above
              already says which one it is, and a row repeating "You're offline"
              on every line is noise, not information. */}
          <span className="obx-item-status">{failure ?? t('offline.itemWaiting')}</span>
          {/* Guarded, so the plural node needs no `zero` form — see the zero
              audit in lib/plural.ts. */}
          {item.attempts > 0 && (
            <span className="obx-item-attempts">{t('offline.attempts', { count: item.attempts })}</span>
          )}
        </p>
      </div>
      <button
        type="button"
        className="btn btn-ghost btn-sm obx-item-discard"
        onClick={() => void onDiscard(item)}
      >
        {t('offline.discard')}
      </button>
    </li>
  )
}
