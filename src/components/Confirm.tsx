// Promise-based confirmation sheet replacing window.confirm — app chrome
// instead of browser chrome, and translatable, which the native dialog is not.
//
//   if (await confirm({ title, body, confirmLabel, cancelLabel, danger: true })) …
//
// <ConfirmHost /> must be mounted exactly once, in the App shell beside
// <Toaster />. Like the toast system this is a module-level listener rather
// than context, so an API error path or a store action can raise a dialog
// without holding a reference into the component tree.
//
// EVERY string arrives already translated. The dialog never calls t() itself:
// it is mounted above the router and would otherwise re-render on a language
// toggle out of step with the caller that composed the sentence.

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactElement,
} from 'react'
import { pushOverlay } from '../lib/overlayStack'
import './confirm.css'

export interface ConfirmOptions {
  title: string
  body?: string
  confirmLabel: string
  cancelLabel: string
  danger?: boolean
}

interface Pending extends ConfirmOptions {
  resolve: (ok: boolean) => void
}

type Listener = (p: Pending) => void

let listener: Listener | null = null

/** Raise a confirmation. Resolves true only on an explicit confirm. */
export function confirm(opts: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    if (!listener) {
      // Host not mounted. This should not happen, but the alternative to a
      // fallback is a promise that never settles, which hangs the caller
      // mid-delete with no error and no dialog. Native confirm is ugly; a
      // silently dead "Delete" button is worse.
      resolve(window.confirm(opts.body ? `${opts.title}\n\n${opts.body}` : opts.title))
      return
    }
    listener({ ...opts, resolve })
  })
}

// The confirm button is auto-focused on open, so a HELD Enter on the trigger
// button (key auto-repeat) or a fast double press would land on it and fire a
// destructive action before the user has read a word. The window blocks that.
//
// It is spent as a VISIBLE disabled state, not as a silent no-op: swallowing a
// deliberate click with no feedback is indistinguishable from a broken button,
// and the user's next move is to click harder — right as the window expires.
const ARM_DELAY_MS = 350

/**
 * The element focus lands on when the trigger did not survive the action.
 *
 * `<main id="main" tabIndex={-1}>` in App.tsx — the same node the skip link
 * aims at, and the only always-present, always-focusable anchor in the shell.
 * Confirm.test.tsx asserts App.tsx still renders it, because a rename here is
 * silent: getElementById returns null, the fallback quietly does nothing, and
 * focus is back on <body> with no test failing.
 */
const FOCUS_FALLBACK_ID = 'main'

/** The subset of an element the restore decision reads. */
interface FocusCandidate {
  isConnected: boolean
  tagName: string
}

/**
 * Where focus goes when the dialog closes.
 *
 * THE TRIGGER IS USUALLY GONE. On the destructive path — which is the path this
 * component exists for — the confirmed delete unmounts the row the button was
 * in, so by the time the restore runs `document.activeElement` is `<body>` and
 * the stored trigger is detached. `focus()` on a detached node is a no-op, so
 * an `isConnected` guard alone LEAVES focus on `<body>`: the next Tab restarts
 * at the top of the document, and a screen reader announces nothing at all.
 * That is the whole bug — the guard prevented a wrong call without making a
 * right one.
 *
 * `<body>` is treated as no answer for the same reason it is not one: it is
 * where the browser parks focus when nothing holds it, so restoring "to" it
 * restores nothing. It is also what a confirm() raised from a hotkey or an API
 * error path captures as its trigger, and that case wants the fallback too.
 *
 * Structural rather than `HTMLElement` so the rule is testable without a DOM —
 * vitest.config.ts is `environment: 'node'` by design.
 */
export function focusRestoreTarget<T extends FocusCandidate>(
  trigger: T | null,
  fallback: T | null,
): T | null {
  if (trigger !== null && trigger.isConnected && trigger.tagName !== 'BODY') return trigger
  if (fallback !== null && fallback.isConnected) return fallback
  return null
}

export function ConfirmHost(): ReactElement {
  const [pending, setPending] = useState<Pending | null>(null)
  const [armed, setArmed] = useState(false)
  const sheetRef = useRef<HTMLDivElement>(null)
  const confirmBtn = useRef<HTMLButtonElement>(null)
  const restoreFocus = useRef<HTMLElement | null>(null)
  // Set when a dialog OPENS, cleared once its focus has been put back. The
  // restore branch of the effect below also runs on mount — `pending` starts
  // null — and without this flag the fallback would fire there and pull focus
  // to <main> at app start, before the user has touched anything.
  const restoreDue = useRef(false)
  // Mirror of `pending` readable synchronously from the listener — state is one
  // render behind and this has to settle the OLD promise the instant a second
  // confirm() replaces it.
  const pendingRef = useRef<Pending | null>(null)
  const titleId = useId()
  const bodyId = useId()

  useEffect(() => {
    listener = (p) => {
      // Capture the trigger only on a genuine open. If a second confirm()
      // arrives while one is up, document.activeElement is this dialog's own
      // button, and storing it would restore focus into an unmounted sheet.
      if (!pendingRef.current) {
        restoreFocus.current = document.activeElement as HTMLElement | null
        restoreDue.current = true
      }
      // A replaced dialog must still settle or whoever is awaiting it waits
      // forever. False is the safe answer: the user never saw it.
      pendingRef.current?.resolve(false)
      pendingRef.current = p
      setPending(p)
    }
    return () => {
      listener = null
      pendingRef.current?.resolve(false)
      pendingRef.current = null
    }
  }, [])

  // Reads the pending dialog off the ref rather than closing over state, so the
  // document-level Escape listener below can call it without being re-bound on
  // every render.
  const finish = useCallback((ok: boolean): void => {
    const current = pendingRef.current
    if (!current) return
    pendingRef.current = null
    current.resolve(ok)
    setPending(null)
  }, [])

  useEffect(() => {
    if (!pending) {
      // Only after a dialog that was actually open — see restoreDue.
      if (!restoreDue.current) return
      restoreDue.current = false
      const trigger = restoreFocus.current
      restoreFocus.current = null
      // The trigger is usually a row action button that the confirmed delete
      // just unmounted, so this lands on the fallback far more often than on
      // the trigger. Whichever it is, focus goes SOMEWHERE: an isConnected
      // guard with no alternative left it on <body>, one Tab away from the top
      // of the document and announcing nothing.
      focusRestoreTarget(trigger, document.getElementById(FOCUS_FALLBACK_ID))?.focus()
      return
    }
    setArmed(false)
    confirmBtn.current?.focus()
    const id = window.setTimeout(() => setArmed(true), ARM_DELAY_MS)

    // Escape ends up on the DOCUMENT, because focus does not reliably stay on
    // the sheet's buttons: drag-selecting the warning text (a normal move when
    // re-reading a destructive confirmation) puts focus on the nearest focusable
    // ancestor, and a keydown that lands anywhere but inside the React root
    // never reaches a JSX onKeyDown at all. Escape has to cancel wherever focus
    // sits, or the only way out of a modal dialog is a mouse.
    //
    // It goes through lib/overlayStack rather than through a listener this
    // component owns, because a confirm is very often opened FROM an open Sheet,
    // and Sheet used to bind its own. Two capture-phase listeners on the same
    // node both fire — stopPropagation() does not stop a sibling on the same
    // node, that needs stopImmediatePropagation — so one Escape cancelled the
    // confirm AND closed the sheet behind it. The stack dismisses the top layer
    // only, which here is always this dialog.
    const offEscape = pushOverlay(() => finish(false))

    return () => {
      window.clearTimeout(id)
      offEscape()
    }
  }, [pending, finish])

  if (!pending) return <></>

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    // Escape is handled at the document level, see the effect above.
    if (e.key !== 'Tab') return
    // Focus trap. Without it, Tab walks out of an aria-modal dialog into the
    // page behind it, where the next Enter hits whatever the user has now
    // forgotten is focused. Only the two buttons are tabbable, so the list is
    // short enough to recompute per keypress.
    const buttons = sheetRef.current?.querySelectorAll<HTMLElement>('button')
    if (!buttons || buttons.length === 0) return
    const first = buttons[0]
    const last = buttons[buttons.length - 1]
    const active = document.activeElement
    // The sheet itself counts as "before the first button": it holds focus
    // after a click on the title or body text (that is what its tabIndex -1 is
    // for), and from there a plain Tab already falls to `first` in document
    // order while Shift+Tab would step out of the dialog.
    if (e.shiftKey && (active === first || active === sheetRef.current)) {
      e.preventDefault()
      last.focus()
    } else if (!e.shiftKey && active === last) {
      e.preventDefault()
      first.focus()
    }
  }

  return (
    <div className="confirm-backdrop" onClick={() => finish(false)} role="presentation">
      <div
        ref={sheetRef}
        className="confirm-sheet"
        // tabIndex -1 keeps focus INSIDE the dialog when a click lands on inert
        // content: the browser's focus fixup walks up to the nearest focusable
        // ancestor, and without this that ancestor is <body> — outside the
        // dialog, outside the React root, and outside the Tab trap below, which
        // would then let Tab walk into the page behind an aria-modal dialog.
        tabIndex={-1}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={pending.body ? bodyId : undefined}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={onKeyDown}
      >
        <h2 className="confirm-title" id={titleId}>
          {pending.title}
        </h2>
        {pending.body && (
          <p className="confirm-body" id={bodyId}>
            {pending.body}
          </p>
        )}
        <div className="confirm-actions">
          <button type="button" className="btn" onClick={() => finish(false)}>
            {pending.cancelLabel}
          </button>
          <button
            type="button"
            ref={confirmBtn}
            className={`btn ${pending.danger ? 'btn-danger' : 'btn-primary'}`}
            // aria-disabled, not `disabled`: a disabled button cannot receive
            // focus, so the open-time focus() would fail, the trap would have
            // nothing to hold, and Enter would still be aimed at the trigger
            // behind the dialog. This keeps it focusable and announced as
            // unavailable, and global.css already dims [aria-disabled='true'].
            aria-disabled={!armed}
            // Auto-repeat from a key held down on the trigger arrives here as
            // repeated keydowns; preventDefault stops the browser turning them
            // into clicks.
            onKeyDown={(e) => {
              if (e.repeat) e.preventDefault()
            }}
            onClick={() => {
              if (armed) finish(true)
            }}
          >
            {pending.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
