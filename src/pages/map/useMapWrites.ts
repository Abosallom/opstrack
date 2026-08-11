// THE WRITE PATH — the only mutation the map's own composition owns.
//
// Extracted from pages/Mindtree.tsx unchanged.
//
// ── EVERY WRITE IS THE STORE'S WRITE ───────────────────────────────────────
//
// A drag is a mutation of real work, and so is a menu item. Both go through
// `store/entries.patchEntry` — the optimistic-write-plus-rollback path the board
// and the entry sheet already use — and neither goes anywhere else. This file
// owns no request, no retry and no rollback of its own. That is what makes "a
// mis-drop is undoable" true without an undo stack: the tree is rebuilt from the
// store, so putting an entry back is not an action this file performs, it is the
// absence of a change this file never made. A failure surfaces as the store's own
// `pgErrorKey` sentence, in a toast, with the map already back where it was.
//
// The bulk arm runs through `lib/pooled` at the shared write concurrency rather
// than firing eighteen requests at once. THE CONFIRMATION IS NOT THIS FILE'S:
// `MIND_BULK_CONFIRM_AT` is applied inside NodeMenu and inside DragLayer, each
// beside the gesture it guards, and both hand this file a run that has already
// been agreed to. A surface that asked as well would ask twice.

import { useCallback } from 'react'
import { toast } from '../../components/toast'
import type { MindMenuRun } from '../../components/mindtree/NodeMenu'
import { t } from '../../lib/i18n'
import { pooled } from '../../lib/pooled'
import { WHY_GONE } from '../../lib/mindtree/actions'
import { DROP_UNCHANGED_KEY } from '../../lib/mindtree/dropRules'
import type { MindLabel, MindNode as MindNodeModel } from '../../lib/mindtree/model'
import { patchEntry } from '../../store/entries'
import { openEntry } from '../../store/entrySheet'
import { setMindCollapsed } from '../../store/mindtree'
import { memberLabel, type Member } from '../../store/members'
import { sendNudge } from '../../store/nudges'
import type { Entry } from '../../types'

/**
 * store/entries.ts's private `QUEUED_KEY`, which is NOT a failure: the write is
 * in the outbox and lands on reconnect.
 *
 * Duplicated as a literal because the store does not export it, exactly as
 * pages/Board.tsx, pages/tracks/TracksIndex.tsx and
 * components/mindtree/DragLayer.tsx already do. Four copies of one string is a
 * recorded extension-slot gap, not a licence to reach across the module boundary
 * — and reading it as an error here would tell a reader on a train that the six
 * items they just reassigned went nowhere.
 */
const QUEUED_ERROR_KEY = 'offline.queued'

export interface MapWritesOptions {
  drawnEntryIds: readonly string[]
  entryById: ReadonlyMap<string, Entry>
  memberById: ReadonlyMap<string, Member>
  meId: string | null
  requestRefocus: (entryId: string) => void
  setLive: (text: string) => void
  textOf: (label: MindLabel) => string
  toggleFold: (id: string) => void
  focusBranch: (nodeId: string | null) => void
  openAdd: (at: { nodeId: string; x: number; y: number }) => void
}

export function useMapWrites({
  drawnEntryIds,
  entryById,
  memberById,
  meId,
  requestRefocus,
  setLive,
  textOf,
  toggleFold,
  focusBranch,
  openAdd,
}: MapWritesOptions) {
  /**
   * PERFORM a decided act — the menu's write path, and the only one this file
   * owns.
   *
   * `NodeMenu` has already decided everything: `targetIds` is filtered to rows
   * this reader may write AND that the act actually changes, `patch` is the one
   * `dropRules` built, and `confirmed` says the reader was asked and said yes.
   * Nothing is recomputed here — a surface that re-derived the patch would be a
   * second policy, and the first thing to drift.
   *
   * EVERY WRITE IS `patchEntry`, through `pooled` at the shared concurrency, for
   * the reason this file's header states: the store owns the optimistic row, the
   * rollback and the `pgErrorKey` sentence, so a failure puts the map back
   * without this function performing an undo.
   */
  const runMenu = useCallback(
    (run: MindMenuRun, path: readonly MindNodeModel[], at: { x: number; y: number }) => {
      const node = path[path.length - 1]
      if (node === undefined) return
      const label = textOf(node.label)

      switch (run.kind) {
        case 'open':
          if (node.entryId !== null) openEntry(node.entryId, { list: drawnEntryIds })
          return
        case 'focus':
          focusBranch(node.id)
          setLive(t('mindtree.focused', { label }))
          return
        case 'collapse':
          if (node.kind === 'more') toggleFold(node.id)
          else setMindCollapsed(node.id, !node.collapsed)
          return
        case 'addHere':
          // The form opens where the menu was, so the reader's eye does not have
          // to travel. It is a second overlay rather than a field inside the
          // menu because it owns a text input, a submit and a "keep it open for
          // the next one" loop — QuickAdd.tsx's whole argument.
          openAdd({ nodeId: node.id, x: at.x, y: at.y })
          return
        case 'nudge': {
          // An RPC, not a patch: `nudge_entry()` (migration 0019) writes the
          // notification, the audit row and the stamp in one transaction, which
          // is why `actions.ts` hands this verb a null patch. `sendNudge` is the
          // store's wrapper and owns the optimistic overlay.
          const entryId = run.targetIds[0]
          const entry = entryId === undefined ? undefined : entryById.get(entryId)
          if (entry === undefined || meId === null) {
            setLive(t(WHY_GONE))
            return
          }
          const owner = memberLabel(memberById, entry.owner_id, entry.owner_name)
          void sendNudge(entry.id, meId).then((result) => {
            // Names the PERSON and the ITEM, because that is what makes a
            // mis-click visible now rather than tomorrow. Every refusal 0019
            // raises has its own sentence and arrives as a KEY.
            if (result.ok) {
              toast(t('nudge.sent', { name: owner, title: entry.title }), { tone: 'success' })
            } else {
              toast(t(result.error), { tone: 'error' })
            }
          })
          return
        }
        default:
          break
      }

      const patch = run.patch
      if (patch === null || run.targetIds.length === 0) {
        // A no-op — the row is already in the bucket the reader picked. Silence
        // after a deliberate choice reads as a dropped gesture, so the sentence
        // `dropRules` names for exactly this is spoken. A drop onto the branch
        // the row is already under says the same words.
        if (run.outcome !== null && run.outcome.kind === 'noop') setLive(t(DROP_UNCHANGED_KEY))
        return
      }

      const ids = run.targetIds
      // The same repair the drag asks for, and for the same reason: this write
      // rewrites the moved row's node id, `NodeMenu.dismiss()` has just put
      // focus back on the node that is about to unmount, and nothing else would
      // move it. See `requestRefocus` in useMapCursor.
      const moved = ids[0]
      if (moved !== undefined) requestRefocus(moved)
      void (async () => {
        const results = await pooled(ids, (id) => patchEntry(id, patch))
        // `offline.queued` is NOT a failure: the write is in the outbox and lands
        // on reconnect, and the optimistic row is already on the map. Treating it
        // as an error would tell a reader on a train that nothing happened.
        const failed = results.filter(
          (r): r is { ok: false; error: string } => !r.ok && r.error !== QUEUED_ERROR_KEY,
        )
        const wrote = ids.length - failed.length
        if (wrote > 0) {
          setLive(
            wrote === 1
              ? t('mindtree.appliedOne', { label })
              : t('mindtree.appliedMany', { count: wrote, label }),
          )
        }
        const first = failed[0]
        if (first !== undefined) toast(t(first.error), { tone: 'error' })
      })()
    },
    [
      drawnEntryIds,
      entryById,
      memberById,
      meId,
      requestRefocus,
      setLive,
      textOf,
      toggleFold,
      focusBranch,
      openAdd,
    ],
  )

  return { runMenu }
}
