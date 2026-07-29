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

export function ConfirmHost(): ReactElement {
  const [pending, setPending] = useState<Pending | null>(null)
  const [armed, setArmed] = useState(false)
  const sheetRef = useRef<HTMLDivElement>(null)
  const confirmBtn = useRef<HTMLButtonElement>(null)
  const restoreFocus = useRef<HTMLElement | null>(null)
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
      const el = restoreFocus.current
      // isConnected matters: the trigger is usually a row action button that
      // the confirmed delete just unmounted. focus() on a detached node is a
      // no-op that dumps focus on <body>, and a screen-reader user loses their
      // place in the list entirely.
      if (el?.isConnected) el.focus()
      return
    }
    setArmed(false)
    confirmBtn.current?.focus()
    const id = window.setTimeout(() => setArmed(true), ARM_DELAY_MS)

    // Escape is bound to the DOCUMENT, not to the sheet, because focus does not
    // reliably stay on the sheet's buttons: drag-selecting the warning text (a
    // normal move when re-reading a destructive confirmation) puts focus on the
    // nearest focusable ancestor, and a keydown that lands anywhere but inside
    // the React root never reaches a JSX onKeyDown at all. Escape has to cancel
    // wherever focus sits, or the only way out of a modal dialog is a mouse.
    // Capture phase so it wins over anything the page behind the scrim binds.
    const onEscape = (event: globalThis.KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      finish(false)
    }
    document.addEventListener('keydown', onEscape, true)

    return () => {
      window.clearTimeout(id)
      document.removeEventListener('keydown', onEscape, true)
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
