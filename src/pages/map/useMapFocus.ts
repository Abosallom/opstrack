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
//
// `defaultFocusFor` IS NOT A FOURTH WRITER, and that is deliberate. It answers
// where the map OPENS when nothing has been said, and its answer is handed to
// `resolveFocus` as the requested id — it never reaches `setMindFocus`. So the
// store keeps its null, the reconciler below stays silent (it fires on
// `missingId !== null`, and a resolvable default produces none), and the URL
// mirror — which is keyed on the STORE's focus, not on the resolved view —
// leaves the address bar clean. A default that persisted itself would stop being
// a default after one paint and would then travel into a shared link.
//
// ── WHAT THE CAMERA CHANGES HERE: NOTHING IN THIS FILE ─────────────────────
//
// `docs/MAP-ZOOM.md §5` gives the camera one mount-time input, and it is
// `focusView.node` — the world the initial framing is struck around. That is a
// new READER of this hook's output, not a new writer of its state, and the
// three-writer convergence above is untouched by it. It is recorded here
// because the tempting shortcut is to have the camera re-derive the drill-in
// itself ("it only needs an id"), which would make a fourth writer out of a
// second resolver and put this file's fallback and that copy's fallback one
// refactor away from disagreeing.
//
// AND THE STANDING CONSTRAINT, stated where a future feature will read it: the
// URL carries the WORLD's node id — `?focus=` — and NEVER the camera's
// coordinates. The whole geometry is a pure function of the department tree, so
// an admin adding a department shifts every radius and makes any remembered
// coordinate stale, while the id still names the same place. `useMapUrl`
// already works this way; a "save my camera position" feature must not quietly
// change it.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { t } from '../../lib/i18n'
import type { MindLabel, MindNode as MindNodeModel } from '../../lib/mindtree/model'
import { defaultFocusFor, resolveFocus } from '../../lib/mindtree/focus'
import { useMapNodes } from '../../store/config'
import { expandMindNode, setMindCollapsed, setMindFocus } from '../../store/mindtree'

export interface MapFocusOptions {
  tree: MindNodeModel
  focusPref: string | null
  entriesLoaded: boolean
  expandedIds: ReadonlySet<string>
  textOf: (label: MindLabel) => string
  setLive: (text: string) => void
  /**
   * WHO IS LOOKING — the two facts the opening camera is chosen from, and the
   * two `useMapModel` already returns (`model.meId`, `model.role`).
   *
   * OPTIONAL WITH SAFE DEFAULTS, and the defaults are the honest ones rather
   * than convenient ones: `null` means "nobody has signed in yet", which the
   * resolver answers with the workspace's own opening world — the same picture
   * an admin gets, and never somebody else's book. pages/Board.tsx's rule about
   * never inventing a stand-in id is the same rule.
   */
  meId?: string | null
  role?: string
}

/**
 * WHICH ID `resolveFocus` IS ASKED FOR — the whole precedence, as one pure
 * function so that it can be asserted without a DOM.
 *
 * EXPORTED FOR ITS TEST, and for the reason `useMapUrl.test.ts`'s header states
 * at length: `vitest.config.ts` is `environment: 'node'`, jsdom is not in the
 * dependency budget and effects do not run in a server render, so a decision a
 * hook takes is proven by exporting the decision rather than by rendering the
 * hook. This is the only line of `useMapFocus` that chooses a place.
 *
 * THE ORDER, HIGHEST FIRST, and every rung is a different sentence:
 *
 *   1. the persisted focus   "I was here"        — and `?focus=` arrives as this
 *                                                  (`useMapUrl.ts:582` writes it
 *                                                  through `focusBranch`)
 *   2. `wantsWorkspace`      "show me everything" — this session, this mount
 *   3. `defaultFocusFor`     "you belong here"    — wave 5
 *   4. null                  the drawn root
 *
 * 2 SITS ABOVE 3 AND NOT BELOW IT, which is the correction wave 5's integration
 * needed: without it, `MapList.tsx:952`'s Clear-focus button — the one control
 * in the app that means "the whole workspace" — resolves straight back to the
 * default and the workspace becomes unreachable. See `wantsWorkspace`.
 */
export function requestedFocusId(
  focusPref: string | null,
  wantsWorkspace: boolean,
  defaultFocus: string | null,
): string | null {
  // `focusPref === ''` is "no focus" to `resolveFocus` and must be "no focus"
  // here too, or an empty persisted string would out-rank the default silently.
  if (focusPref !== null && focusPref !== '') return focusPref
  return wantsWorkspace ? null : defaultFocus
}

export function useMapFocus({
  tree,
  focusPref,
  entriesLoaded,
  expandedIds,
  textOf,
  setLive,
  meId = null,
  role = 'member',
}: MapFocusOptions) {
  const mapNodes = useMapNodes()

  /**
   * WHO MANAGES EACH NODE — `map_nodes.account_manager_id`, keyed by the id
   * `MindNode.bucketKey` carries on an `entity`.
   *
   * READ HERE RATHER THAN THREADED, and the reason is the model's own contract:
   * `useMapModel.ts:250` drops `account_manager_id` on the way into the tree
   * ("a model that carried it would invalidate the whole tree every time
   * somebody typed a character into that field"), so the tree cannot answer this
   * and must not learn to. This hook already reads a store; one more selector
   * costs a Map of ~400 tiny rows rebuilt only when the map nodes change, and
   * it keeps the whole opening-camera decision inside the hook that owns the
   * drill-in instead of spreading it across the page.
   *
   * `lib/mindtree/focus.ts` stays pure: it takes this as a function.
   */
  const managerOf = useMemo(() => {
    const byNode = new Map<string, string | null>()
    for (const row of mapNodes) byNode.set(row.id, row.account_manager_id)
    return (bucketKey: string): string | null => byNode.get(bucketKey) ?? null
  }, [mapNodes])

  /**
   * WHERE THE MAP OPENS WHEN NOBODY HAS SAID — and NOT ONE STEP FURTHER.
   *
   * Computed only when there is no persisted focus, because the precedence is
   * the point: `?focus=` beats the store (useMapUrl writes the URL's id in),
   * the store beats this, and this beats `ROOT_ID`. A reader who dove somewhere
   * yesterday comes back there; a reader who has never been here lands on their
   * own book instead of on eleven octaves of workspace.
   *
   * IT IS NEVER WRITTEN BACK. It is handed to `resolveFocus` as the REQUESTED
   * id, so the reconciler below still sees `missingId === null` on the happy
   * path and stays silent — which means the store keeps its null, the URL mirror
   * (`useMapUrl`, keyed on `focusPref` and not on the resolved view) keeps its
   * clean address bar, and a link the reader shares carries no book of theirs.
   */
  /**
   * ⚠ AND "SHOW ME THE WHOLE WORKSPACE" BEATS IT, WHICH TAKES STATE.
   *
   * `defaultFocusFor` answers a DRILL-IN, not a camera aim: `resolveFocus` hands
   * back the subtree, `Mindtree.tsx` lays out THAT node, and the rings above it
   * leave the drawing entirely. Measured on the 400-organization fixture — the
   * default resolves `am:1`, and `layoutWorlds(resolveFocus(tree,'am:1').node)`
   * does not contain `root`. So everything that walks back OUT walks inside the
   * account manager's own book: the crumb bar is `ancestorWorlds` of a layout
   * rooted at `am:1` (empty at the opening), the rail's Home is `flyToId(null)`
   * onto that same world, and `cameraBounds` is clamped by `layout.rootD`.
   *
   * That leaves exactly ONE way out, and it is the control `MapList.tsx:952`
   * itself calls "the way out" — `mindtree.clearFocus`, `onFocus(null)`. Without
   * the latch below that button is DEAD: `setMindFocus(null)` on an already-null
   * preference is not even a store change, so nothing re-renders, and if it did
   * the memo above would compute the same default straight back. An account
   * manager could never see the workspace, and an admin could never see the root
   * ring — a trap, not a default.
   *
   * SO THE LATCH RECORDS A FACT THE STORE CANNOT: this reader has asked for the
   * workspace on this mount. `focusPref === null` is one value with two meanings
   * — "nobody has said" and "somebody said EVERYTHING" — and only the second may
   * out-rank the resolver. State and not a ref precisely because the answer has
   * to reach the screen; component state and not the store because the
   * preference is still null, which is what keeps the address bar clean and a
   * shared link free of the sender's book (see the header).
   *
   * NOT STICKY ACROSS A RELOAD, deliberately. "The map OPENS on the reader's own
   * world" is a sentence about opening; a reader who spent this session at the
   * workspace still opens tomorrow on their book, which is the whole feature.
   */
  const [wantsWorkspace, setWantsWorkspace] = useState(false)

  /**
   * WHERE THE MAP OPENS WHEN NOBODY HAS SAID — and NOT ONE STEP FURTHER.
   *
   * Computed only when there is no persisted focus, because the precedence is
   * the point: `?focus=` beats the store (useMapUrl writes the URL's id in),
   * the store beats this, this beats `ROOT_ID` — and an explicit "clear the
   * focus" beats all of them, which is `wantsWorkspace` above.
   *
   * IT IS NEVER WRITTEN BACK. It is handed to `resolveFocus` as the REQUESTED
   * id, so the reconciler below still sees `missingId === null` on the happy
   * path and stays silent — which means the store keeps its null, the URL mirror
   * (`useMapUrl`, keyed on `focusPref` and not on the resolved view) keeps its
   * clean address bar, and a link the reader shares carries no book of theirs.
   *
   * The two rungs above it are tested INSIDE this memo rather than only in
   * `requestedFocusId` because the resolver is a tree walk — O(n·depth), ~25k
   * steps at 3,200 nodes — and a reader who is focused somewhere, or who has
   * asked for the workspace, must not pay for an answer nothing will read.
   */
  const defaultFocus = useMemo(
    () =>
      !wantsWorkspace && (focusPref === null || focusPref === '')
        ? defaultFocusFor(meId, role, tree, managerOf)
        : null,
    [wantsWorkspace, focusPref, meId, role, tree, managerOf],
  )

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
  const requested = requestedFocusId(focusPref, wantsWorkspace, defaultFocus)
  const focusView = useMemo(() => resolveFocus(tree, requested), [tree, requested])
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
   *
   * ⚠ AND `null` IS ALSO WHERE THE OPENING DEFAULT IS DISMISSED. It is the only
   * gesture in the app that means "the whole workspace" — `MapList.tsx:952`'s
   * Clear-focus button is its one caller — and since wave 5 gave `focusPref ===
   * null` a resolver of its own, clearing without saying so would draw the same
   * subtree back. `setMindFocus(null)` on an already-null preference is not even
   * a store change, so this is also the write that makes the button re-render at
   * all. Any NON-null focus leaves the latch alone: drilling in again is not a
   * retraction, and a pasted `?focus=` (which arrives through this same callback,
   * `useMapUrl.ts:582`) is a place, not an opinion about the opening.
   */
  const focusBranch = useCallback((nodeId: string | null) => {
    if (nodeId !== null) setMindCollapsed(nodeId, false)
    else setWantsWorkspace(true)
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
