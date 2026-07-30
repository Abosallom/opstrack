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

/** Raise a toast. Returns its id so a caller can dismiss it early. */
export function toast(message: string, opts: ToastOptions = {}): number {
  const id = nextId++
  items = trimStack([...items, { ...opts, id, message }])
  emit()
  schedule(id, opts.duration ?? (opts.action ? ACTION_MS : DEFAULT_MS))
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
