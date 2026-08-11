// THE SIX NUMBERS — workspace totals, in the panel, with no selection.
//
// THEY HANG OFF NOTHING. "unassigned: 12" is not a track and "closed this
// window" is not a node; these are questions about the WHOLE workspace, and a
// panel that required a focused node first would cost one tap plus one selection
// and still be unable to show the total. Recon named that the single most likely
// place the collapse costs keystrokes. So this component reads the store itself
// and renders on arrival: 0 clicks after the lens chip, 0 scrolling, six tiles.
//
// EVERY TILE IS ONE INTERACTION TO THE LIST THAT ACTS ON IT. On the dashboard
// each was a real `<Link>` — the whole tile the target, keyboard-reachable,
// destination visible in the status bar. Here the destination is not a route: it
// is this same shell with a different lens and a filter, so the tile is a real
// `<button>` carrying the whole sentence in its accessible name, and `onJump`
// sets both halves at once. One interaction, and a URL you can paste.
//
// THE PATCH REPRODUCES THE COUNT, EXACTLY. Each jump writes BOTH `statuses` and
// `health`, never just the one it cares about, because a patch that only added
// its own field would intersect with the last tile's — tap Overdue, then Blocked,
// and you would be looking at blocked-AND-overdue work under a tile that counted
// blocked. `owner` is deliberately left alone (except by the Unassigned tile,
// whose whole subject it is): the tile counted the reader's current owner filter,
// so the list must apply it too, or the number and the rows disagree.
//
// TWO DEFINITIONS OF "BLOCKED" LIVE ONE IMPORT APART, and this file uses the
// wider one on purpose. `aggregate.oldestBlockers` counts `blocked` OR
// `waiting_on`, matching `lib/entrySections.bucketFollowUps`' blocked section —
// so the tile equals the list it jumps into, which is the only property that
// makes a number on a panel worth tapping. `store/entries.countEntries.blocked`
// counts only `blocked`; that pill answers a narrower question and is not what
// this tile reports. The `aria-label` says "blocked or waiting" for the same
// reason.
//
// THE WINDOW COMES FROM NumbersStage, not from a second `useState(8)` here. The
// Closed tile and the throughput chart six inches away must count the same weeks
// — `loadClosedSince()` keeps the WIDEST window ever asked for, so a reader who
// looked at 12 weeks and switched back to 4 still has twelve weeks of done rows
// in the store, and a tile that counted all of them would contradict the chart
// under it. Closed-in-window is therefore summed off the same series the chart
// draws, not off `countEntries.closed`.

import { useCallback, useEffect, useMemo, type ReactElement } from 'react'
import { oldestBlockers, throughputByWeek } from '../../lib/aggregate'
import { addDays, todayIso } from '../../lib/dates'
import type { FilterState } from '../../lib/entryFilter'
import { t } from '../../lib/i18n'
import type { MapLens } from '../../lib/mindtree/lens'
import {
  countEntries,
  loadClosedSince,
  loadEntries,
  useFilteredEntries,
  useHealthMap,
} from '../../store/entries'
import type { EntryUpdate } from '../../types'
import { scopeForNumbers, useNumbersWindow } from './NumbersStage'
import './map-numbers.css'

/** How many blockers the tile is willing to name. One, plus the count. */
const NAMED_BLOCKERS = 1

/** Nothing loads threads on this surface; an empty map is the honest input. */
const NO_UPDATES: ReadonlyMap<string, EntryUpdate[]> = new Map()

/** The five tiles that go somewhere. `closed` is the sixth and goes nowhere. */
export type NumberTileKey = 'open' | 'overdue' | 'quiet' | 'blocked' | 'unassigned'

export interface NumberJump {
  lens: MapLens
  patch: Partial<FilterState>
}

/**
 * Where a tile sends the reader, and with what.
 *
 * A FUNCTION AND NOT A TABLE, so every call hands back fresh arrays: the patch
 * is spread straight into the shell's filter state and a shared array would
 * make two saved filters the same object. A switch with no `default:` over a
 * closed union, for the reason lib/mindtree/lens.ts gives — a sixth tile breaks
 * this at compile time instead of silently going nowhere.
 *
 * EVERY BRANCH WRITES BOTH `statuses` AND `health`. A patch that only set its
 * own field would INTERSECT with the previous tile's: tap Overdue, then
 * Blocked, and the list would show blocked-and-overdue work under a tile that
 * counted blocked. `owner` is left alone by four of the five, deliberately —
 * the tile counted whatever owner filter the reader already had, so the list
 * must apply it too or the number and the rows disagree.
 */
export function jumpFor(tile: NumberTileKey): NumberJump {
  switch (tile) {
    case 'open':
      // The board, not the attention list: "open" is the whole population, and
      // the question it invites is "where is it all", which is a column layout.
      return { lens: 'by-status', patch: { statuses: [], health: [] } }
    case 'overdue':
      // BOTH health members. `countEntries.overdue` counts `days_overdue > 0`,
      // and computeHealth resolves exactly that to `overdue` — or to `critical`
      // when the priority is critical. Asking for `overdue` alone would show
      // four items under a tile that counted five.
      return { lens: 'needs-me', patch: { statuses: [], health: ['overdue', 'critical'] } }
    case 'quiet':
      return { lens: 'needs-me', patch: { statuses: [], health: ['stale'] } }
    case 'blocked':
      // The WIDER of the two definitions, matching aggregate.oldestBlockers and
      // entrySections.bucketFollowUps — both mean "someone else owes us
      // something". store/entries.countEntries.blocked counts only `blocked`.
      return { lens: 'needs-me', patch: { statuses: ['blocked', 'waiting_on'], health: [] } }
    case 'unassigned':
      return {
        lens: 'needs-me',
        patch: { statuses: [], health: [], owner: { kind: 'unassigned' } },
      }
  }
}

export interface NumbersPanelProps {
  filter: FilterState
  compact: boolean
  /** 1-tap jump from a number to the list that acts on it. Sets lens AND filter. */
  onJump: (lens: MapLens, patch: Partial<FilterState>) => void
}

export default function NumbersPanel({ filter, compact, onJump }: NumbersPanelProps): ReactElement {
  const { weeks, from, to } = useNumbersWindow()
  const health = useHealthMap()
  const today = todayIso()

  // Both idempotent and deduped in the store. Called here as well as in the
  // stage because the panel is the surface that must be right on arrival, and a
  // reader can open it at a moment the stage is still mounting.
  useEffect(() => {
    void loadEntries()
  }, [])

  useEffect(() => {
    void loadClosedSince(from)
  }, [from])

  const scoped = useMemo<FilterState>(() => scopeForNumbers(filter), [filter])
  const entries = useFilteredEntries(scoped)

  const counts = useMemo(
    () => countEntries(entries, health, today, addDays(today, 7)),
    [entries, health, today],
  )

  const blocked = useMemo(() => {
    const all = oldestBlockers(entries, NO_UPDATES, today, Number.MAX_SAFE_INTEGER)
    return { count: all.length, named: all.slice(0, NAMED_BLOCKERS) }
  }, [entries, today])

  const closedInWindow = useMemo(
    () => throughputByWeek(entries, from, to).reduce((sum, point) => sum + point.closed, 0),
    [entries, from, to],
  )

  /** One tap: the lens and the filter together, from the table above. */
  const jump = useCallback(
    (tile: NumberTileKey) => () => {
      const { lens, patch } = jumpFor(tile)
      onJump(lens, patch)
    },
    [onJump],
  )

  return (
    <ul className="mnum-tiles" data-compact={compact ? '' : undefined}>
      <NumberTile
        label={t('dashboard.statOpen')}
        value={counts.open}
        jumpLabel={t('dashboard.jumpOpen')}
        onJump={jump('open')}
      />
      <NumberTile
        label={t('dashboard.statOverdue')}
        value={counts.overdue}
        tone={counts.overdue > 0 ? 'bad' : undefined}
        jumpLabel={t('dashboard.jumpOverdue')}
        onJump={jump('overdue')}
      />
      <NumberTile
        label={t('dashboard.statQuiet')}
        value={counts.stale}
        tone={counts.stale > 0 ? 'warn' : undefined}
        jumpLabel={t('dashboard.jumpQuiet')}
        onJump={jump('quiet')}
      />
      <NumberTile
        label={t('dashboard.statBlocked')}
        value={blocked.count}
        tone={blocked.count > 0 ? 'warn' : undefined}
        // 0 clicks to the name of the oldest thing that is stuck. Cheap to keep,
        // and the one line on this panel that answers "which one" rather than
        // "how many".
        note={
          blocked.named.length > 0
            ? t('dashboard.blockedOldest', {
                title: blocked.named[0].entry.title,
                count: blocked.named[0].days,
              })
            : t('dashboard.blockedNone')
        }
        jumpLabel={t('dashboard.jumpBlocked')}
        onJump={jump('blocked')}
      />
      <NumberTile
        label={t('dashboard.statUnassigned')}
        value={counts.unassigned}
        jumpLabel={t('dashboard.jumpUnassigned')}
        onJump={jump('unassigned')}
      />
      {/* NO JUMP. There is no lens whose subject is finished work — the map
          draws the open set and the board's Done column is a column, not a
          filter — so a tile that navigated would land the reader somewhere that
          does not show what they tapped. A static tile is honest; a disabled
          link is not. */}
      <NumberTile
        label={t('dashboard.statClosed')}
        value={closedInWindow}
        note={t('dashboard.statClosedNote', { count: weeks })}
      />
    </ul>
  )
}

/**
 * One number, its label, and — when there is somewhere to go — the whole tile as
 * the target.
 *
 * A `<button>` and not a `<div onClick>`: it must be tabbable, announced as a
 * control, and carry the entire sentence in its accessible name, because a
 * screen reader landing on "12" between two other numbers learns nothing from
 * the visual grouping a sighted reader gets for free. A tile with no
 * destination is a plain `<span>`, not a disabled button — a control that
 * cannot be operated is still a stop on the tab order.
 */
function NumberTile({
  label,
  value,
  note,
  tone,
  onJump,
  jumpLabel,
}: {
  label: string
  value: number
  note?: string
  tone?: 'warn' | 'bad'
  onJump?: () => void
  jumpLabel?: string
}): ReactElement {
  const body = (
    <>
      <span className="mnum-tile-value tabular">{value}</span>
      <span className="mnum-tile-label">{label}</span>
      {note !== undefined && <span className="mnum-tile-note">{note}</span>}
    </>
  )
  /**
   * THE NOTE IS IN THE ACCESSIBLE NAME, and it has to be spelled out because
   * `aria-label` REPLACES the element's contents for assistive technology. The
   * dashboard's tile carried `aria-label={`${label}: ${value}. ${linkLabel}`}`
   * over a `<Link>` whose visible body also held "Longest: …" — so the one line
   * on that screen naming the oldest stuck item was announced to nobody. Two
   * keys rather than a concatenation so a translator owns the order.
   */
  const named = (hint: string): string =>
    note === undefined
      ? t('dashboard.tileJumpLabel', { label, count: value, hint })
      : t('dashboard.tileJumpLabelNoted', { label, count: value, note, hint })

  return (
    <li className={tone ? `mnum-tile is-${tone}` : 'mnum-tile'}>
      {onJump && jumpLabel !== undefined ? (
        <button
          type="button"
          className="mnum-tile-face mnum-tile-jump"
          aria-label={named(jumpLabel)}
          onClick={onJump}
        >
          {body}
        </button>
      ) : (
        // No aria-label: with nothing to announce beyond what is written, the
        // element's own contents ARE its name, and an aria-label here would only
        // create a second copy of them to keep in step.
        <span className="mnum-tile-face">{body}</span>
      )}
    </li>
  )
}
