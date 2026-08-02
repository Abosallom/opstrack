// Tiny global toast system: call toast('Entry captured') from anywhere;
// <Toaster /> (mounted once in App) renders the stack.
//
// It is a module-level store rather than context so non-React code — the
// service-worker update hook in main.tsx, API error paths — can raise a toast
// without a component tree reference.

import { useSyncExternalStore, type ReactElement, type ReactNode } from 'react'
import './toast.css'

export interface ToastAction {
  label: string
  onClick: () => void
}

export interface ToastOptions {
  icon?: ReactNode
  action?: ToastAction
  /** ms before auto-dismiss. 0 keeps it until dismissed or actioned. */
  duration?: number
  tone?: 'default' | 'success' | 'error'
  /**
   * A stable name for the SLOT this toast occupies, not for the event that
   * raised it. A second `toast()` with the same key REPLACES the one already on
   * screen instead of stacking a duplicate beside it.
   *
   * Give a key to any prompt whose source can fire more than once for the same
   * standing condition — the service-worker update prompt is the one today.
   * Leave it off for ordinary notifications: two captures deserve two toasts.
   *
   * Unrelated to React's `key`, which <Toaster /> takes from `id`.
   */
  key?: string
  /**
   * Render it, but do NOT let the live region speak it.
   *
   * FOR THE ONE CASE WHERE A TOAST IS THE SECOND VOICE, not the only one. The
   * host below is `role="status" aria-live="polite"` and is mounted
   * persistently, so every ordinary `toast()` is an announcement — which is
   * exactly what it should be. But a surface that already announced the same
   * sentence into its OWN region and raises a toast as the VISUAL half of the
   * same event makes a screen-reader user hear it twice; the mindtree's drag is
   * the one that does (`DragLayer.commitDrop` pairs `announce()` with `toast()`
   * on four paths, so that the sentence keeps its place in the drag's own
   * ordering and a sighted reader still sees the confirmation).
   *
   * Implemented as `aria-hidden` ON THE ITEM rather than as a second host,
   * because a second host would be a second stacking context and the two would
   * overlap. An aria-hidden node inserted into a live region is not part of the
   * accessible text, so nothing is announced — and the toast is still visible,
   * still hoverable, still dismissible with the pointer.
   *
   * DO NOT reach for this to quieten a noisy screen. A toast nobody announced
   * and nobody else spoke is a message a screen-reader user never receives.
   */
  silent?: boolean
}

export interface ToastItem extends ToastOptions {
  id: number
  message: string
}

type Listener = () => void

let items: ToastItem[] = []
let nextId = 1
const listeners = new Set<Listener>()
// Per-toast dismiss timers, kept outside the array so hovering can hold a
// toast open. The toast is often the ONLY recovery path (undo after a capture),
// so it must not expire while the pointer is sitting on it.
const timers = new Map<number, number>()

const MAX_STACK = 3
const DEFAULT_MS = 3200
const ACTION_MS = 6500

function emit(): void {
  for (const l of listeners) l()
}

function subscribe(l: Listener): () => void {
  listeners.add(l)
  return () => {
    listeners.delete(l)
  }
}

function snapshot(): ToastItem[] {
  return items
}

/**
 * The live stack, oldest first — the same reference <Toaster /> subscribes to.
 *
 * Exported for toast.test.ts, which asserts the eviction policy. Read-only by
 * type: the array is the store's own, and mutating it would desynchronise every
 * subscriber from the value they were last notified about.
 */
export function getToasts(): readonly ToastItem[] {
  return items
}

function schedule(id: number, ms: number): void {
  window.clearTimeout(timers.get(id))
  if (ms <= 0) return
  timers.set(
    id,
    window.setTimeout(() => {
      dismissToast(id)
    }, ms),
  )
}

/**
 * `duration: 0` — stays until the user dismisses or actions it.
 *
 * A sticky toast is not a louder notification, it is a toast whose ACTION is
 * the only way to do the thing. main.tsx raises exactly one: "a new version is
 * available", whose button is the sole caller of `updateSW` — it is closed over
 * there and exposed nowhere else in the app.
 */
function isSticky(it: ToastItem): boolean {
  return (it.duration ?? -1) === 0
}

/**
 * Enforce MAX_STACK by dropping the OLDEST AUTO-DISMISSING toast.
 *
 * This used to be `.slice(-MAX_STACK)`, which evicts the oldest full stop — so
 * three ordinary toasts (a capture, an undo, a save) silently pushed the update
 * prompt off the stack and the shipped update could never be applied for the
 * rest of the session. Evicting a toast that was going to disappear on its own
 * in three seconds costs nothing; evicting one that is somebody's only button
 * costs them the release.
 *
 * If the stack is ALL sticky, it is allowed to grow past MAX_STACK rather than
 * drop one. Every sticky toast is a deliberate, user-actionable prompt raised by
 * code that decided it must be seen, and there is one such call site today —
 * "too many undismissed prompts" is a problem the product does not have, and
 * losing one is the bug this function exists to fix.
 *
 * The runaway that WAS observed — the same prompt raised twice, stacking — is
 * handled where it belongs, at the raise: `ToastOptions.key` replaces the toast
 * in that slot instead of appending a second one, so the stack never grows on a
 * repeat. That is the only thing allowed to displace a sticky toast, and it
 * displaces only its own predecessor. Nothing here evicts a sticky, ever.
 */
function trimStack(list: ToastItem[]): ToastItem[] {
  const out = [...list]
  while (out.length > MAX_STACK) {
    const oldestTransient = out.findIndex((it) => !isSticky(it))
    if (oldestTransient === -1) break
    const [dropped] = out.splice(oldestTransient, 1)
    // Its countdown outlives the array otherwise, and fires dismissToast() on
    // an id that is already gone.
    window.clearTimeout(timers.get(dropped.id))
    timers.delete(dropped.id)
  }
  return out
}

/**
 * Raise a toast. Returns the id of the toast now on screen, so a caller can
 * dismiss it early — with `opts.key`, that is the id of the SLOT, which is the
 * same id a previous keyed raise returned.
 *
 * THE KEYED PATH IS THE FIX FOR THE DUPLICATE UPDATE PROMPT. `onNeedRefresh`
 * fires once per waiting service worker, so a tab left open across two deploys
 * (or one that re-registers) collected two identical "a new version is
 * available" toasts stacked on top of each other, each holding its own
 * `updateSW` closure and neither auto-dismissing — the stack only ever grew.
 *
 * A keyed raise updates the existing toast IN PLACE: same id, same position in
 * the stack. That is deliberate on three counts. It cannot grow the stack, so
 * the all-sticky escape hatch in trimStack() has nothing to escape from. It
 * cannot move the prompt out from under a pointer that is already reaching for
 * its button. And it does not remount the node, so the live region does not
 * announce the same sentence a second time to a screen reader.
 *
 * NOTE WHAT THIS IS NOT: it evicts nothing. Only a NEWER RAISE OF THE SAME KEY
 * displaces a toast, and it displaces exactly the toast it is replacing. A
 * distinct sticky toast is still never dropped to make room for anything — that
 * is the C6 invariant, asserted in toast.test.ts, and keys do not touch it.
 */
export function toast(message: string, opts: ToastOptions = {}): number {
  const ms = opts.duration ?? (opts.action ? ACTION_MS : DEFAULT_MS)
  const at = opts.key === undefined ? -1 : items.findIndex((it) => it.key === opts.key)

  if (at !== -1) {
    const { id } = items[at]
    const next = [...items]
    next[at] = { ...opts, id, message }
    items = next
    emit()
    // Re-arms from scratch against the NEW options: a keyed raise may hand a
    // sticky slot a duration, or a timed one `duration: 0`. schedule() clears
    // the old timer for this id before setting any new one.
    schedule(id, ms)
    return id
  }

  const id = nextId++
  items = trimStack([...items, { ...opts, id, message }])
  emit()
  schedule(id, ms)
  return id
}

export function dismissToast(id: number): void {
  window.clearTimeout(timers.get(id))
  timers.delete(id)
  // Bail before rebuilding the array: a late timer for an already-evicted toast
  // would otherwise mint a new `items` identity and re-render every toast for
  // nothing. useSyncExternalStore compares by reference.
  if (!items.some((it) => it.id === id)) return
  items = items.filter((it) => it.id !== id)
  emit()
}

/** Pointer is over the toast — freeze the countdown. */
function hold(id: number): void {
  window.clearTimeout(timers.get(id))
}

/** Pointer left — restart a shortened grace countdown. */
function release(it: ToastItem): void {
  if (isSticky(it)) return
  schedule(it.id, it.action ? 3000 : 1500)
}

export function Toaster(): ReactElement {
  const list = useSyncExternalStore(subscribe, snapshot, snapshot)
  // The live region must be MOUNTED PERSISTENTLY, not conditionally rendered:
  // assistive tech only announces content inserted into an already-present live
  // region, so rendering the host only when a toast exists silently swallows
  // every announcement.
  //
  // Class names (.toast-host / .toast / .toast-message / .toast-action, and the
  // .error / .success tone modifiers) are owned by app-shell.css.
  return (
    <div className="toast-host" role="status" aria-live="polite">
      {list.map((it) => (
        <div
          key={it.id}
          className={`toast${it.tone && it.tone !== 'default' ? ` ${it.tone}` : ''}`}
          // See ToastOptions.silent: the caller already said this sentence in a
          // live region of its own, and hearing it twice is the defect.
          aria-hidden={it.silent === true ? 'true' : undefined}
          onPointerEnter={() => hold(it.id)}
          onPointerLeave={() => release(it)}
        >
          {it.icon && (
            <span className="toast-icon" aria-hidden="true">
              {it.icon}
            </span>
          )}
          <span className="toast-message">{it.message}</span>
          {it.action && (
            <button
              type="button"
              className="toast-action"
              onClick={() => {
                it.action?.onClick()
                dismissToast(it.id)
              }}
            >
              {it.action.label}
            </button>
          )}
        </div>
      ))}
    </div>
  )
}
