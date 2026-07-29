// Which entry the detail surface is showing, and what "next" means.
//
// THIS TINY MODULE IS WHAT MAKES WAVE 2 FIVE-WIDE. Follow-ups, the board, the
// timeline, capture and the dashboard all need to open the entry detail
// surface. If each imported the detail module, all five would depend on
// W2-DETAIL's file and none could start until it finished. They import this
// instead: five lines of shared state, no rendering, no data.
//
// `/entry/:id` is a THIN ROUTE that calls openEntry(id) on mount, so deep links
// and the browser Back button still work while the desktop "panel over the
// list" UX is preserved. src/pages/Entry.tsx is that route; EntrySheet is the
// connected container it renders.
//
// ROUTE-INDEPENDENT ON PURPOSE. Nothing here navigates. A board that pushed a
// URL on every card tap would fill the history stack with twenty entries the
// Back button then has to walk out of one at a time, and the panel-over-a-list
// interaction is precisely the one that must NOT be a page change. The route
// drives this store; this store never drives the route.
//
// SIBLINGS ARE STORED, NOT COMPUTED IN A SELECTOR. useSheetSiblings() returns
// an object, and an object built inside a selector is a new reference on every
// render — under useSyncExternalStore that reads as "the snapshot changed",
// forever. store/config.ts's header documents the same hazard. So the pair is
// derived once per write and handed out by reference, with a single frozen
// NO_SIBLINGS for the (common) case of an entry opened outside any list.

import { create } from 'zustand'

export interface SheetSiblings {
  prev: string | null
  next: string | null
}

/**
 * The shared "nothing to step to" answer.
 *
 * One frozen instance rather than a fresh `{ prev: null, next: null }` per
 * derive: an entry opened from a deep link, from a toast, or from a list of one
 * all land here, and returning the same reference means the prev/next buttons
 * do not re-render when an unrelated field of this store changes.
 */
const NO_SIBLINGS: SheetSiblings = Object.freeze({ prev: null, next: null })

interface SheetState {
  id: string | null
  /**
   * The sibling ids IN THE ORDER THE CALLER IS DISPLAYING THEM. Not read from
   * store/entries, deliberately: stepping through a filtered, sorted board
   * column has to follow that column's order, and the store's canonical
   * last_activity_at ordering is not it.
   */
  list: readonly string[]
  siblings: SheetSiblings
}

function siblingsOf(id: string | null, list: readonly string[]): SheetSiblings {
  if (id === null) return NO_SIBLINGS
  const at = list.indexOf(id)
  if (at < 0) return NO_SIBLINGS
  const prev = at > 0 ? list[at - 1] : null
  const next = at < list.length - 1 ? list[at + 1] : null
  // An entry that is first AND last in its list has no steps either way, so
  // hand back the shared instance rather than an equal-but-distinct object.
  if (prev === null && next === null) return NO_SIBLINGS
  return { prev, next }
}

const useSheetStore = create<SheetState>(() => ({
  id: null,
  list: [],
  siblings: NO_SIBLINGS,
}))

/**
 * @param opts.list the sibling ids, in the order the CALLER is displaying them
 *                  — which is why they are passed rather than read from
 *                  store/entries. Stepping through a filtered, sorted board
 *                  column has to follow that column's order, not the store's.
 *
 * Omitting `list` KEEPS the current one when the target is already in it. That
 * is what makes stepEntry() work without every caller re-passing the same
 * array, and what lets a toast's "view it" action open an entry the user is
 * already stepping through without truncating the walk.
 */
export function openEntry(id: string, opts?: { list?: string[] }): void {
  useSheetStore.setState((s) => {
    const list = opts?.list ?? (s.list.includes(id) ? s.list : [])
    // Reference-equal state on a repeat open of the same entry: tapping a row
    // that is already open must not re-render the sheet, because the sheet is
    // an editor and a re-render mid-typing is a lost keystroke.
    if (s.id === id && s.list === list) return s
    return { id, list, siblings: siblingsOf(id, list) }
  })
}

export function closeEntry(): void {
  useSheetStore.setState((s) => {
    if (s.id === null) return s
    // The list is dropped with the id. Keeping it would let a later
    // openEntry(x) with no options silently inherit the ordering of a screen
    // the user left three navigations ago.
    return { id: null, list: [], siblings: NO_SIBLINGS }
  })
}

export function useOpenEntryId(): string | null {
  return useSheetStore((s) => s.id)
}

export function useSheetSiblings(): SheetSiblings {
  return useSheetStore((s) => s.siblings)
}

/** J / K and the sheet's prev/next buttons. */
export function stepEntry(dir: 1 | -1): void {
  const { siblings } = useSheetStore.getState()
  const target = dir === 1 ? siblings.next : siblings.prev
  // No wrap. A radiogroup wraps because it is a closed set of options; a list
  // of entries is a position the user is reading through, and jumping from the
  // last item back to the first reads as a bug, not a convenience.
  if (target !== null) openEntry(target)
}

/**
 * Non-React read, for the keyboard layer Wave 4 adds: a global hotkey handler
 * lives outside the component tree and cannot call a hook to find out whether
 * the sheet is open (and should therefore swallow Esc).
 */
export function getOpenEntryId(): string | null {
  return useSheetStore.getState().id
}
