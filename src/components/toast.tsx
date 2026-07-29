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

/** Raise a toast. Returns its id so a caller can dismiss it early. */
export function toast(message: string, opts: ToastOptions = {}): number {
  const id = nextId++
  items = [...items, { ...opts, id, message }].slice(-MAX_STACK)
  emit()
  schedule(id, opts.duration ?? (opts.action ? ACTION_MS : DEFAULT_MS))
  return id
}

export function dismissToast(id: number): void {
  window.clearTimeout(timers.get(id))
  timers.delete(id)
  items = items.filter((it) => it.id !== id)
  emit()
}

/** Pointer is over the toast — freeze the countdown. */
function hold(id: number): void {
  window.clearTimeout(timers.get(id))
}

/** Pointer left — restart a shortened grace countdown. */
function release(it: ToastItem): void {
  if ((it.duration ?? 1) === 0) return
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
