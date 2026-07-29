// The app's one overlay surface: an inline-end panel on a desktop width, a
// bottom sheet on a phone.
//
// ONE COMPONENT, TWO PRESENTATIONS, and the choice is made in JavaScript rather
// than by putting both `.panel` and `.sheet` on the element and letting a media
// query pick. Those two global primitives set conflicting insets — `.panel` is
// inset-block: 0 / inset-inline-end: 0, `.sheet` is inset-inline: 0 /
// inset-block-end: 0 — so an element carrying both gets whichever declarations
// happen to come later in global.css on each individual property, which is a
// layout nobody designed. The presentations also differ structurally: only the
// bottom sheet gets a grab handle, and only the panel gets prev/next room in
// its header. matchMedia is the honest tool for "these are two different
// components below and above 768px".
//
// IT IS MODAL IN BOTH PRESENTATIONS. The desktop UX is "a panel over the list",
// which argues for leaving the list behind it live — but a non-modal panel is
// only keyboard-safe if the rest of the app is marked `inert`, and the app
// shell that would have to carry that attribute is integrator-owned; a
// component cannot reach outside itself to inert its siblings. So the sheet
// traps focus, sets aria-modal, and gives the user the affordances it can
// actually guarantee: Escape, a labelled close button, a scrim that dismisses,
// and its own prev/next for stepping the list without going back to it.
//
// NO BODY SCROLL LOCK, deliberately. `.panel` and `.sheet` both carry
// `overscroll-behavior: contain`, which already stops a scroll gesture inside
// the sheet from chaining to the page. Toggling `document.body.style.overflow`
// on top of that reflows the whole app, and on iOS Safari it discards the
// list's scroll position — so closing the sheet would dump the user back at the
// top of a hundred-row follow-ups screen every time.

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useSyncExternalStore,
  type KeyboardEvent,
  type ReactElement,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
import { t } from '../../lib/i18n'
import { IconClose } from '../fields/glyphs'
import './sheet.css'

/**
 * Everything the browser will hand focus to with Tab. Recomputed per keypress
 * rather than cached: the sheet is an editor whose controls appear and vanish
 * as fields go in and out of edit mode, and a cached list would trap focus on a
 * button that no longer exists.
 */
const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]),' +
  ' textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

const WIDE_QUERY = '(min-width: 768px)'

function subscribeWide(onChange: () => void): () => void {
  const mq = window.matchMedia(WIDE_QUERY)
  mq.addEventListener('change', onChange)
  return () => mq.removeEventListener('change', onChange)
}

function readWide(): boolean {
  return window.matchMedia(WIDE_QUERY).matches
}

/**
 * True at `.panel` widths. useSyncExternalStore rather than a resize listener
 * plus state: matchMedia fires only when the breakpoint is actually crossed,
 * where a resize handler fires on every pixel of a window drag and re-renders
 * an open editor each time.
 */
function useIsWide(): boolean {
  return useSyncExternalStore(subscribeWide, readWide, readWide)
}

export interface SheetProps {
  open: boolean
  /** Called by Escape, the close button, and a scrim click. */
  onClose: () => void
  /**
   * The dialog's accessible name. Required unless `labelledBy` names an element
   * inside the sheet — a dialog with neither is announced as just "dialog".
   */
  label?: string
  labelledBy?: string
  /** Header content, at the reading start. Usually the entry's title. */
  title?: ReactNode
  /** Header controls at the reading end, before the close button. */
  actions?: ReactNode
  /** Pinned below the scrolling body — the compose box, a save bar. */
  footer?: ReactNode
  children: ReactNode
  /**
   * `'bottom'` forces the sheet presentation at every width. For surfaces that
   * are a sheet even on desktop (a picker over a form), where an inline-end
   * panel would read as a second navigation level.
   */
  presentation?: 'auto' | 'bottom'
  /** `'lg'` widens the desktop panel for two-column content. */
  size?: 'md' | 'lg'
  className?: string
}

export default function Sheet({
  open,
  onClose,
  label,
  labelledBy,
  title,
  actions,
  footer,
  children,
  presentation = 'auto',
  size = 'md',
  className,
}: SheetProps): ReactElement | null {
  const wide = useIsWide() && presentation === 'auto'
  const surface = useRef<HTMLDivElement>(null)
  const restoreFocus = useRef<HTMLElement | null>(null)
  const headingId = useId()

  // Read through a ref inside the document-level Escape listener so the effect
  // below binds once per open instead of re-binding on every parent render.
  // Written in an effect rather than during render — a ref mutated in the
  // render body is a side effect React is allowed to discard and re-run.
  const onCloseRef = useRef(onClose)
  useEffect(() => {
    onCloseRef.current = onClose
  })

  // Focus restoration on UNMOUNT, which is how this component usually goes
  // away: EntrySheet returns null when its entryId does, so `open` never flips
  // to false and the effect below never gets to run its close branch. Without
  // this, dismissing the sheet leaves focus on <body> and a keyboard user
  // restarts from the top of the page. The open→false branch nulls the ref, so
  // the two paths cannot both fire.
  useEffect(() => {
    return () => {
      const el = restoreFocus.current
      if (el?.isConnected) el.focus()
    }
  }, [])

  useEffect(() => {
    if (!open) {
      const el = restoreFocus.current
      restoreFocus.current = null
      // isConnected matters: the control that opened the sheet is often a row
      // the sheet's own edit just re-keyed out of the list. focus() on a
      // detached node is a no-op that drops focus on <body>, and a screen-reader
      // user loses their place in the list entirely.
      if (el?.isConnected) el.focus()
      return
    }

    restoreFocus.current = document.activeElement as HTMLElement | null
    // Focus the surface, not the first control. The first control in an entry
    // sheet is the title's edit button, and auto-focusing it makes a screen
    // reader announce "edit title" before it has said which entry is open.
    // The surface carries the dialog role and its accessible name, so focusing
    // it announces the entry, and one Tab reaches the first control.
    surface.current?.focus()

    // Escape is bound to the DOCUMENT rather than to the surface, because focus
    // does not reliably stay inside: drag-selecting an update body (a normal
    // move when copying a note out) puts focus on the nearest focusable
    // ancestor, and a keydown that lands outside the React root never reaches a
    // JSX onKeyDown. Capture phase so it wins over whatever the page behind the
    // scrim binds. This mirrors components/Confirm.tsx, for the same reasons.
    const onEscape = (event: globalThis.KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      // A picker or a native <select> popup open INSIDE the sheet gets Escape
      // first and stops it there; anything that reaches the document means the
      // sheet itself is what the user wants out of.
      event.preventDefault()
      event.stopPropagation()
      onCloseRef.current()
    }
    document.addEventListener('keydown', onEscape, true)
    return () => document.removeEventListener('keydown', onEscape, true)
  }, [open])

  const onKeyDown = useCallback((event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key !== 'Tab') return
    const root = surface.current
    if (!root) return
    const items = Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
      // offsetParent is null for anything display:none — a collapsed section's
      // controls are in the DOM and must not be Tab stops.
      (el) => el.offsetParent !== null || el === document.activeElement,
    )
    if (items.length === 0) return
    const first = items[0]
    const last = items[items.length - 1]
    const active = document.activeElement
    // The surface itself counts as "before the first control": it holds focus
    // after a click on inert content (that is what its tabIndex -1 is for), and
    // from there a plain Tab already falls to `first` in document order while
    // Shift+Tab would step out of an aria-modal dialog into the page behind it.
    if (event.shiftKey && (active === first || active === root)) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && active === last) {
      event.preventDefault()
      first.focus()
    }
  }, [])

  if (!open) return null

  const surfaceClass = [
    wide ? 'panel' : 'sheet',
    'sheetx',
    wide ? 'sheetx-panel' : 'sheetx-bottom',
    size === 'lg' ? 'sheetx-lg' : '',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ')

  // PORTALLED TO <body>, and this is not decoration. `.panel` and `.sheet` are
  // `position: fixed`, and a fixed element is positioned against the nearest
  // ancestor with a transform, filter or containment — not against the
  // viewport. global.css ships `.fade-in` with `animation-fill-mode: both`,
  // which leaves `transform: translateY(0)` on the element FOREVER after it
  // runs; the first screen that wraps its content in it would silently trap
  // this sheet inside a scrolling column. React events still bubble through the
  // React tree, so the parent keeps every handler it had.
  return createPortal(
    <>
      {/* role="presentation" keeps the scrim out of the accessibility tree: it
          is a dismiss target for a pointer, and the keyboard equivalent is
          Escape, which is already bound. */}
      <div className="scrim sheetx-scrim" role="presentation" onClick={onClose} />
      <div
        ref={surface}
        className={surfaceClass}
        role="dialog"
        aria-modal="true"
        aria-label={labelledBy ? undefined : label}
        aria-labelledby={labelledBy ?? (title ? headingId : undefined)}
        // Keeps focus INSIDE the dialog when a click lands on inert content:
        // the browser's focus fixup walks up to the nearest focusable ancestor,
        // and without this that ancestor is <body> — outside the trap below.
        tabIndex={-1}
        onKeyDown={onKeyDown}
      >
        {/* Decorative: the sheet is always dismissible by the labelled close
            button and by Escape. It exists because a bottom sheet with no lip
            reads as a stuck page on a phone. */}
        {!wide && <div className="sheet-handle" aria-hidden="true" />}
        <div className="sheetx-header">
          {title !== undefined && (
            <h2 className="sheetx-title" id={headingId}>
              {title}
            </h2>
          )}
          <div className="sheetx-actions">
            {actions}
            <button
              type="button"
              className="btn btn-ghost btn-icon sheetx-close"
              onClick={onClose}
              aria-label={t('common.close')}
            >
              <IconClose size={20} />
            </button>
          </div>
        </div>
        <div className="sheetx-body">{children}</div>
        {footer !== undefined && <div className="sheetx-footer">{footer}</div>}
      </div>
    </>,
    document.body,
  )
}
