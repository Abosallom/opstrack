// THE OPTIMISTIC STAGE OVERLAY — what THIS TAB has written about where an
// organization got to, before store/config has caught up.
//
// ── WHY IT IS A MODULE AND NOT A useState ─────────────────────────────────
//
// store/config.ts's `invalidateConfig()` is correct and heavy — it refetches all
// eight reads to publish one row the caller already holds — and its own header
// named the portfolio as the caller that would need better. That publisher is
// `publishNodeProgress`, and the write is confirmed by republishing THE ONE ROW
// THE DATABASE RETURNED, so forty stage changes down a list are forty small
// publishes rather than forty full reloads.
//
// The optimism still comes first, because even one round trip is a round trip
// the reader must not wait for. So the new rung is held HERE, in a module-level
// map with a `useSyncExternalStore` subscription — components/toast.tsx's shape
// and its stated reason: several surfaces need one answer and none of them is
// another's parent. Each entry RETIRES ITSELF the moment store/config reports
// the same rung — which the targeted publisher makes the very next render — so
// the overlay can never mask a stage a second account manager set; and an entry
// for a node the workspace no longer has is dropped outright, which is what
// empties it on sign-out.
//
// ── WHY IT LIVES IN store/ AND NOT BESIDE THE TABLE THAT WRITES IT ────────
//
// It began inside components/map/PortfolioStage.tsx, which was right while the
// table and the org panel were its only two readers. They are not any more:
// `useMapModel`'s stats walk clocks every organization's rung for the map card
// and the panel's roll-up, and a walk that read the STORE's progress rows alone
// would print "68 days" beside a rung the reader chose a second ago — which
// reads as the write having failed. A page hook importing a component for its
// module state is the wrong direction of dependency, so the PASSIVE half moved
// here and the api-touching half (`writeStage`, `retractStage`, `undoStage`,
// `useStageReconcile`) stayed with the control that owns those decisions. This
// file imports React and types and NOTHING else, which is what lets a page hook,
// a panel and a table all read it without any of them reaching for `api/`.

import { useSyncExternalStore } from 'react'
import type { MapNodeProgress } from '../types'

/** node id → the rung this tab just wrote, before store/config has caught up. */
const pendingStage = new Map<string, string | null>()
let snapshot: ReadonlyMap<string, string | null> = new Map()
const listeners = new Set<() => void>()

function publish(): void {
  // A FRESH MAP PER PUBLISH, and the same one returned until the next: under
  // `useSyncExternalStore` a getSnapshot that built a new object per call would
  // report "changed" forever. store/config.ts's header opens with the loop.
  snapshot = new Map(pendingStage)
  for (const listener of listeners) listener()
}

function subscribeStage(fn: () => void): () => void {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

function readStage(): ReadonlyMap<string, string | null> {
  return snapshot
}

/** What this tab has written and the store has not yet confirmed. */
export function usePendingStages(): ReadonlyMap<string, string | null> {
  return useSyncExternalStore(subscribeStage, readStage, readStage)
}

/**
 * This tab wrote a rung the store has not confirmed. `null` is "cleared".
 *
 * A MUTATOR RATHER THAN AN EXPORTED MAP, so that the one invariant this module
 * has — every mutation is followed by exactly one `publish()` — cannot be
 * forgotten by a caller in another file. It is also what let the write path stay
 * where the api imports are: the caller says WHAT changed and this module owns
 * how anybody hears about it.
 */
export function setPending(nodeId: string, stageId: string | null): void {
  pendingStage.set(nodeId, stageId)
  publish()
}

/** The store caught up, or the write failed and was rolled back. */
export function dropPending(nodeId: string): void {
  pendingStage.delete(nodeId)
  publish()
}

/**
 * The overlay itself, for the reconciler that retires its entries.
 *
 * READ-ONLY BY TYPE. The reconciler needs to iterate what is outstanding and
 * decide, one node at a time, whether the store has caught up; it does not need
 * to reach past `setPending`/`dropPending` to do it.
 */
export function readPendingStages(): ReadonlyMap<string, string | null> {
  return pendingStage
}

/**
 * The store's progress rows with this tab's unconfirmed writes applied.
 *
 * A NEW ROW IS SYNTHESISED WITH `stage_changed_at = now`, because a rung the
 * reader just chose was arrived at just now — reading the OLD stamp would leave
 * the "in stage" column showing sixty-eight days beside a rung the organization
 * reached a second ago, which reads as the write having failed.
 *
 * THE CLOCK IS READ INSIDE THE BODY and never hoisted to a caller's argument:
 * the stamp is EVENT time — the moment the merge is made is the moment the
 * reader is being shown as having arrived — and it is the one value here that is
 * not a whole calendar day. Every caller's memo suppresses `Date.now()` in its
 * dependency list for the opposite reason, and the two rules only stay
 * compatible while this line stays here.
 */
export function mergeProgress(
  progress: ReadonlyMap<string, MapNodeProgress>,
  pending: ReadonlyMap<string, string | null>,
): Map<string, MapNodeProgress> {
  const merged = new Map(progress)
  if (pending.size === 0) return merged
  const stamp = new Date().toISOString()
  for (const [nodeId, stageId] of pending) {
    const held = merged.get(nodeId)
    merged.set(nodeId, {
      node_id: nodeId,
      stage_id: stageId,
      // Null exactly when the rung is null — `map_node_progress_stage_chk`'s
      // invariant, kept on the optimistic row so the two never disagree.
      stage_changed_at: stageId === null ? null : stamp,
      updated_at: held?.updated_at ?? stamp,
      updated_by: held?.updated_by ?? null,
    })
  }
  return merged
}

/**
 * The rung one node stands on, with this tab's own unconfirmed write on top.
 *
 * THE ONE PLACE EVERY SURFACE ASKS. `undefined` from `progress` means nobody has
 * said anything; `null` means somebody cleared it; and the overlay can carry
 * either. Collapsing the three is the failure store/config's `useNodeProgress`
 * header spends a paragraph on.
 */
export function resolveStageId(
  nodeId: string,
  progress: ReadonlyMap<string, Pick<MapNodeProgress, 'stage_id'>>,
  pending: ReadonlyMap<string, string | null>,
): string | null {
  const held = pending.get(nodeId)
  if (held !== undefined) return held
  return progress.get(nodeId)?.stage_id ?? null
}
