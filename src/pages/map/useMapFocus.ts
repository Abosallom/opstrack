// THE DRILL-IN — which branch the map is currently ABOUT, and the two writes
// that change the shape of what is drawn without changing what is in it.
//
// Extracted from pages/Mindtree.tsx unchanged.
//
// `focus` here means the DRILL-IN — store/mindtree's `focus`, `?focus=` in the
// URL, `resolveFocus`, the breadcrumb. It is NOT the roving tab stop, which
// useMapCursor calls `cursorId` for exactly this reason: two unrelated things
// called focus in one file is how a reader ends up wiring the breadcrumb to the
// arrow keys.
//
// THREE WRITERS OF ONE PIECE OF STATE, and they converge rather than loop only
// because of the guards each one carries:
//   1. the inbound URL effect (useMapUrl), on `[params]` alone;
//   2. the reconciler below, gated on `missingId !== null` AND `entriesLoaded`;
//   3. every user gesture — `focusBranch`, the toolbar's dimension trim, the
//      tap on the drawn root, Escape.
// Drop any one guard and the three fight.

import { useCallback, useEffect, useMemo } from 'react'
import { t } from '../../lib/i18n'
import type { MindLabel, MindNode as MindNodeModel } from '../../lib/mindtree/model'
import { resolveFocus } from '../../lib/mindtree/focus'
import { expandMindNode, setMindCollapsed, setMindFocus } from '../../store/mindtree'

export interface MapFocusOptions {
  tree: MindNodeModel
  focusPref: string | null
  entriesLoaded: boolean
  expandedIds: ReadonlySet<string>
  textOf: (label: MindLabel) => string
  setLive: (text: string) => void
}

export function useMapFocus({
  tree,
  focusPref,
  entriesLoaded,
  expandedIds,
  textOf,
  setLive,
}: MapFocusOptions) {
  /**
   * The drill-in, resolved against the tree AS IT IS RIGHT NOW.
   *
   * `resolveFocus` is total: it answers the subtree, the trail the breadcrumb
   * renders, the id ACTUALLY focused after any fallback, and — when a fallback
   * was taken — the id that was asked for and is gone. The fallback is the
   * DEEPEST SURVIVING ANCESTOR rather than "give up and show everything", which
   * is what makes a focus survive a regroup: switching status→owner rewrites
   * every `group:` segment of the id, but the `root/track:X` prefix still names
   * the same track.
   *
   * A focus can vanish under the reader for four ordinary reasons — the track was
   * archived, a filter keystroke narrowed past it, the last item under it closed,
   * or the dimension changed — and every one of them would otherwise draw an
   * empty canvas with the breadcrumb pointing at a node that is not there.
   */
  const focusView = useMemo(() => resolveFocus(tree, focusPref), [tree, focusPref])
  const drawnRoot = focusView.node

  /**
   * PUT THE STORE BACK IN STEP WITH WHAT IS DRAWN, and say so out loud.
   *
   * store/mindtree's `ensureMindFocus` is the handshake its header asks a surface
   * to call on every rebuild, and this is that call made one step better: it
   * would clear a stale focus to null, and `resolveFocus` has already found the
   * nearest ancestor that is still worth drawing. Writing the resolved id back
   * keeps the persisted preference, the URL and the canvas describing one place;
   * writing null would drop a reader who was two rings deep all the way out
   * because the innermost ring emptied.
   *
   * `missingId !== null` is exactly "a fallback was taken", so the ordinary
   * rebuild — several a second on a live map — does nothing at all here.
   */
  useEffect(() => {
    if (focusView.missingId === null) return
    // NOT BEFORE THE DATA. On a cold load the store is empty for a frame or two,
    // so EVERY focus id resolves to nothing and this would "repair" a perfectly
    // good drill-in to null — which the URL effect then writes back, stripping
    // `?focus=` from the link that was just opened. A shared deep link landed on
    // the whole map with no breadcrumb and no way to tell it had happened. The
    // repair is for a branch that vanished UNDER the reader; until the working
    // set has landed once there is nothing to have vanished from.
    if (!entriesLoaded) return
    setMindFocus(focusView.focusId)
    setLive(
      focusView.focusId === null
        ? t('mindtree.focusGone')
        : t('mindtree.focusGoneTo', { label: textOf(focusView.node.label) }),
    )
  }, [focusView, textOf, entriesLoaded, setLive])

  /**
   * Focus a branch — and OPEN it on the way in.
   *
   * The expand is the whole point and it was learned in the browser. Collapse and
   * focus are independent states: a reader closes Infrastructure on the map, then
   * later asks to see Infrastructure on its own, and the drill-in faithfully
   * draws one card with nothing under it. Recoverable (the inline-forward arrow,
   * the menu's Expand, the trail back) but absurd — "show me this branch" and
   * "show me nothing" cannot be the same gesture.
   *
   * The compact path already documented this hazard for the phone, where it is
   * fatal rather than merely silly; the fix belongs on both, because the two
   * states can disagree on any screen size.
   *
   * `null` clears the focus and touches no collapse: leaving a branch is not an
   * opinion about whether that branch is open.
   */
  const focusBranch = useCallback((nodeId: string | null) => {
    if (nodeId !== null) setMindCollapsed(nodeId, false)
    setMindFocus(nodeId)
  }, [])

  /**
   * Both records move on every toggle, and `store/mindtree.setMindCollapsed`
   * owns that rule now — its header states it: an explicit close beats an
   * explicit open beats `openDepth`'s default, so closing a branch must REMOVE
   * it from `opened` or a branch the reader opened could never be closed again.
   *
   * The page used to hold that arithmetic. It was moved rather than wrapped,
   * because the drag layer and the node menu also close branches, and three
   * copies of a two-set invariant is how the two sets end up disagreeing.
   *
   * It lives beside `focusBranch` because both are collapse writes and both are
   * called from three places apiece — the keyboard, the pointer and the menu.
   */
  const toggleFold = useCallback(
    (id: string) => {
      // A fold has no closed record to clear — it is closed BY DEFAULT, always —
      // so opening one records the open and closing one removes it. That is
      // `expandMindNode` and `setMindCollapsed(id, true)` respectively, and the
      // store's `expandedIds` is the set to ask.
      if (expandedIds.has(id)) setMindCollapsed(id, true)
      else expandMindNode(id)
    },
    [expandedIds],
  )

  return { focusView, drawnRoot, focusBranch, toggleFold }
}

export type MapFocus = ReturnType<typeof useMapFocus>
