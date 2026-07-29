// Who owns this Escape keypress?
//
// The app has two dismissible overlays — Sheet and Confirm — and both need to
// hear Escape from ANYWHERE, not just from a control inside them. Drag-selecting
// an update body or a confirmation's warning text (a normal move when copying a
// note out, or when re-reading something destructive) puts focus on the nearest
// focusable ancestor, and a keydown that lands outside the React root never
// reaches a JSX onKeyDown at all. So the listener has to be on `document`.
//
// Each overlay owning its own document listener produced two bugs that only a
// shared arbiter can fix:
//
//   1. THE LISTENERS WERE ON THE CAPTURE PHASE AND CALLED stopPropagation().
//      React attaches its own listeners to the root container and, for a portal,
//      to the portal container — both strictly BELOW document. A capture
//      listener on document therefore runs before React can dispatch anything,
//      and stopping propagation there meant no control inside an overlay could
//      ever see Escape. InlineText's documented "Escape cancels the edit" was
//      unreachable for the entry sheet's title, description and requester
//      fields: pressing Escape to abandon a bad edit closed the whole sheet and
//      threw the draft away.
//
//   2. stopPropagation() DOES NOT STOP A SIBLING LISTENER ON THE SAME NODE
//      (that needs stopImmediatePropagation). A Confirm opened over a Sheet ran
//      both handlers, so one Escape cancelled the confirm AND closed the sheet
//      underneath it.
//
// Both are fixed by the same two decisions here. The listener is on the BUBBLE
// phase, so React has already dispatched and a control that handled Escape has
// already set `defaultPrevented` — which this bails on. And there is exactly ONE
// listener, arbitrating a LIFO stack, so a keypress dismisses one layer: the
// topmost.
//
// preventDefault() but NOT stopPropagation(): the overlay is modal, so there is
// nothing behind the scrim with a legitimate claim on the key, and marking the
// event handled is enough to tell any other bubble listener it has been dealt
// with.

/** What an overlay does when Escape reaches it. */
export type OverlayDismiss = () => void

/** Newest overlay last. Only the last entry ever acts. */
const stack: OverlayDismiss[] = []

let bound = false

function onKeyDown(event: KeyboardEvent): void {
  if (event.key !== 'Escape') return
  // A control inside the overlay already handled it — an inline edit cancelling,
  // a picker closing. The overlay itself is not what the user wants out of.
  if (event.defaultPrevented) return
  const top = stack[stack.length - 1]
  if (top === undefined) return
  event.preventDefault()
  top()
}

/**
 * Register an open overlay. Returns its own removal, so an effect can return it
 * directly.
 *
 * The listener is installed on the first push and never removed: it is one
 * handler for the life of the tab that does nothing at all while the stack is
 * empty, and add/remove churn on every sheet open is a worse trade. Guarded on
 * `document` because this module is imported by node-environment tests.
 */
export function pushOverlay(dismiss: OverlayDismiss): () => void {
  if (!bound && typeof document !== 'undefined') {
    document.addEventListener('keydown', onKeyDown)
    bound = true
  }
  stack.push(dismiss)
  return () => {
    // lastIndexOf, not indexOf: two overlays can in principle share a dismiss
    // identity, and the one being torn down is the newer of them.
    const at = stack.lastIndexOf(dismiss)
    if (at !== -1) stack.splice(at, 1)
  }
}

/** How many overlays are open. For tests, and for anything that must not act
 *  while a modal is up. */
export function overlayDepth(): number {
  return stack.length
}
