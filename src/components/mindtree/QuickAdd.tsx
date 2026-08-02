// "Add an item here" — a one-line composer anchored to a branch of the map.
//
// THE POINT OF IT. This screen exists so a lead can redistribute a week of work
// from one picture; capturing the work is the other half of that, and a branch
// that can receive a drop but cannot receive a NEW item sends the reader to a
// different screen, where they then have to say in words ("Network", "blocked")
// what they had already said by pointing. So the branch's own filing IS the
// form: the whole root-to-node path is folded into the draft before the reader
// types a character.
//
// THE FOLD IS `actions.draftAt()`, NOT A LOCAL ONE, and the difference matters
// in exactly the case that is easy to get wrong. Ring 2 is drawn INSIDE ring 1,
// so the "Blocked" node under Network means "blocked AND on Network" — an item
// created there with only its status set would be filed untracked and appear
// somewhere else entirely, which is the reader watching their own click land in
// the wrong place. `draftAt` folds every step; this file maps its `EntryPatch`
// onto a `NewEntry` and does no filing of its own.
//
// ONE CREATE PATH, AND IT IS CAPTURE'S. `store/entries.createEntryOptimistic()`
// is the only function in the repo that inserts an entry: it applies the
// optimistic row synchronously, funnels the write through `store/outbox`, keeps
// it when the answer is `offline.queued`, and rolls it back with a toast when it
// genuinely fails. A second create here would be a second rollback path, and
// only one of the two would be the one that has been tested against a queue that
// has been sitting for an hour.
//
// WHAT HAPPENS TO THE TYPED LINE, precisely, because this is where a quick-add
// loses somebody's words. The box is cleared BEFORE the await — the optimistic
// row is already on the map by then, and putting a network round trip in front
// of the next thought is the one thing a composer must not do (pages/Capture.tsx
// states it first). On a GENUINE failure the line is put back, selected, so the
// next keystroke either fixes it or replaces it. A queued write is a success
// that has not left the building yet and never restores anything.

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type FocusEvent as ReactFocusEvent,
  type FormEvent,
  type ReactElement,
  type RefObject,
} from 'react'
import { createPortal } from 'react-dom'
import { focusRestoreTarget } from '../Confirm'
import { t } from '../../lib/i18n'
import { pushOverlay } from '../../lib/overlayStack'
import { draftAt, draftRefusal, WHY_SIGNED_OUT } from '../../lib/mindtree/actions'
import type { MindDimension, MindNode } from '../../lib/mindtree/model'
import { createEntryOptimistic } from '../../store/entries'
// The geometry, not the menu. `menuPlacement` converts a pointer's `clientX`
// into a distance from the viewport's INLINE-START edge and flips the panel
// toward that edge rather than clamping it — a rule this popover has to obey
// identically, because the two open from the same gesture on the same node and a
// reader who saw the menu open one way must not see the composer open the other.
import { menuPlacement, type MenuOffset } from './NodeMenu'
import type { EntryPatch, NewEntry } from '../../types'
import './quick-add.css'

/* ────────────────────────────── the contract ─────────────────────────────── */

export interface QuickAddProps {
  /**
   * The ROOT-TO-BRANCH path, branch LAST — the shape `draftAt` folds. A leaf or
   * a "+N more" cannot hold new work and `actions.ts` never offers the verb on
   * one; if one arrives anyway this renders the refusal rather than a form.
   */
  readonly path: readonly MindNode[]
  /** The branch's label as RAW text. This component fences it for direction. */
  readonly label: string
  /** The axis ring 2 is cut on — decides what a group bucket MEANS. */
  readonly dimension: MindDimension
  /** Where the gesture happened, in CLIENT (viewport) pixels. */
  readonly at: { readonly x: number; readonly y: number }
  readonly rtl: boolean
  /**
   * The signed-in profile's id, or null.
   *
   * `entries_insert` is `is_member() and created_by = auth.uid()`, so a null id
   * can only ever produce a rejection — the same first test `actions.editVerdict`
   * makes, and for the same reason: "that branch is no longer in use" would send
   * a signed-out reader looking for an admin instead of a sign-in button.
   */
  readonly meId: string | null
  /** The branch's own DOM element, so cancelling puts the keyboard back on it. */
  readonly anchorEl: HTMLElement | SVGElement | null
  /**
   * The screen's live region. REQUIRED, not optional: "Enter adds it and keeps
   * focus for the next one" means the ONLY confirmation a keyboard user gets is
   * the sentence this speaks, and an optional callback is one a surface forgets.
   */
  readonly announce: (text: string) => void
  /** One item landed. `entryId` is null when the write went to the outbox. */
  readonly onAdded?: (entryId: string | null, title: string) => void
  /** Dismissed. Focus has already been handed back to `anchorEl`. */
  readonly onClose: () => void
}

/**
 * `offline.queued` — a create that went to the outbox instead of the wire.
 *
 * Restated here rather than imported because `store/entries` keeps its copy
 * private; `pages/Board.tsx` holds the third copy for the same reason. It is a
 * SUCCESS: the optimistic row stays, the queue owns the write, and putting the
 * reader's line back would duplicate the item when the queue drains.
 */
const QUEUED_ERROR_KEY = 'offline.queued'

/** Matches `EntrySheet` and the board composer — `entries.title` is text, and
 *  200 is the length past which a title is a description. */
const TITLE_MAX = 200

/**
 * Where focus goes when the branch did not survive the create — a new item can
 * change a "+N more" fold into a branch and re-key the node. Confirm.tsx names
 * the same anchor for the same reason.
 */
const FOCUS_FALLBACK_ID = 'main'

/* ─────────────────────────── the pure decision ───────────────────────────── */

/**
 * The branch's draft, as the shape `createEntryOptimistic` takes.
 *
 * FIELD BY FIELD, NOT A SPREAD, and the owner pair is why. `EntryPatch` and
 * `NewEntry` happen to share five key names today; a spread would silently carry
 * across any sixth that arrives later, and — worse — it reads as though the two
 * types are interchangeable when the thing that actually matters here is that
 * `ownerId` and `ownerName` are a MUTUALLY EXCLUSIVE PAIR. `dropRules.ownerPatch`
 * writes both whenever it writes either (a `null` owner id is falsy, so the XOR
 * clears nothing on its own), `draftAt` inherits that, and copying them as two
 * independent optional fields is what preserves it.
 */
export function draftToNewEntry(draft: EntryPatch, title: string): NewEntry {
  const input: NewEntry = { title }
  if (draft.trackId !== undefined) input.trackId = draft.trackId
  if (draft.status !== undefined) input.status = draft.status
  if (draft.priority !== undefined) input.priority = draft.priority
  if (draft.ownerId !== undefined) input.ownerId = draft.ownerId
  if (draft.ownerName !== undefined) input.ownerName = draft.ownerName
  return input
}

/* ────────────────────────────── the component ────────────────────────────── */

export function QuickAdd({
  path,
  label,
  dimension,
  at,
  rtl,
  meId,
  anchorEl,
  announce,
  onAdded,
  onClose,
}: QuickAddProps): ReactElement {
  const panelRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const titleId = useId()
  const hintId = useId()

  const [title, setTitle] = useState('')
  const [busy, setBusy] = useState(false)
  const [offset, setOffset] = useState<MenuOffset | null>(null)

  const draft = draftAt(path, dimension)
  const refusal =
    meId === null ? WHY_SIGNED_OUT : draft === null ? draftRefusal(path, dimension) : null

  /* ── dismissal ──────────────────────────────────────────────────────────── */

  const dismiss = useCallback(() => {
    // Focus BEFORE the unmount, while the anchor is still a live node — the rule
    // `pages/Board.tsx`'s `closeComposer` states, and the reason Esc from the
    // board composer stopped dropping focus onto <body>.
    focusRestoreTarget<HTMLElement | SVGElement>(
      anchorEl,
      document.getElementById(FOCUS_FALLBACK_ID),
    )?.focus()
    onClose()
  }, [anchorEl, onClose])

  // Escape, through the shared arbiter. NOT a handler on the input: the reader
  // may be on the Add button or the Cancel button when they press it, and a
  // keydown that lands outside the React root never reaches a JSX onKeyDown at
  // all. lib/overlayStack's header is the long version.
  useEffect(() => pushOverlay(dismiss), [dismiss])

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  /**
   * The keyboard left the popover — close it.
   *
   * A composer is not modal and must not trap Tab: a reader who tabs past
   * Cancel is done with it. `relatedTarget === null` is deliberately NOT
   * treated as leaving, because that is what a window blur looks like
   * (alt-tab, a devtools panel, the OS taking focus) and a half-typed line
   * must survive one.
   */
  const onBlurCapture = useCallback(
    (event: ReactFocusEvent<HTMLDivElement>): void => {
      const next = event.relatedTarget
      if (next === null) return
      if (event.currentTarget.contains(next)) return
      // No focus restore here: focus has already moved somewhere the reader
      // chose, and yanking it back to the node would undo their Tab.
      onClose()
    },
    [onClose],
  )

  /* ── the write ──────────────────────────────────────────────────────────── */

  const submit = useCallback(
    async (event: FormEvent<HTMLFormElement>): Promise<void> => {
      event.preventDefault()
      const trimmed = title.trim()
      if (trimmed === '' || busy || draft === null) return

      setBusy(true)
      // Cleared BEFORE the await — see the header. `kept` is what goes back if
      // the write genuinely fails.
      const kept = title
      setTitle('')
      inputRef.current?.focus()

      const result = await createEntryOptimistic(draftToNewEntry(draft, trimmed))
      setBusy(false)

      if (!result.ok && result.error !== QUEUED_ERROR_KEY) {
        // The store has already rolled the optimistic row back and toasted the
        // reason. This adds the one thing it cannot: the words. Selected rather
        // than merely restored, so the next keystroke replaces them — the
        // decision pages/Capture.tsx's `fixToken` makes and states.
        setTitle(kept)
        const el = inputRef.current
        if (el !== null) {
          el.focus()
          el.setSelectionRange(0, kept.length)
        }
        return
      }

      const queued = !result.ok
      announce(
        t(queued ? 'mindtree.quickAddQueued' : 'mindtree.quickAddDone', {
          title: trimmed,
          label,
        }),
      )
      // The keyboard stays in the box. The explicit refocus is for the CLICK
      // path: the submit button disables itself the moment the draft empties,
      // and a disabled control drops focus to <body>.
      inputRef.current?.focus()
      onAdded?.(result.ok ? result.data.id : null, trimmed)
    },
    [announce, busy, draft, label, onAdded, title],
  )

  /* ── placement ──────────────────────────────────────────────────────────── */

  const atX = at.x
  const atY = at.y

  useLayoutEffect(() => {
    const el = panelRef.current
    if (el === null) return
    const next = menuPlacement(
      { x: atX, y: atY },
      { inlineSize: el.offsetWidth, blockSize: el.offsetHeight },
      {
        inlineSize: document.documentElement.clientWidth,
        blockSize: document.documentElement.clientHeight,
      },
      rtl,
    )
    setOffset((prev) =>
      prev !== null && prev.inlineStart === next.inlineStart && prev.blockStart === next.blockStart
        ? prev
        : next,
    )
    // NOT re-measured on every keystroke: the panel's inline size is pinned by
    // the stylesheet and the input does not grow, so a placement that chased the
    // draft would only ever recompute the same two numbers — sixty times a
    // second while somebody types.
  }, [atX, atY, refusal, rtl])

  return createPortal(
    <>
      <div className="mtree-qa-catch" role="presentation" onPointerDown={dismiss} />
      <QuickAddPanel
        panelRef={panelRef}
        inputRef={inputRef}
        titleId={titleId}
        hintId={hintId}
        heading={t('mindtree.quickAddUnder', { label })}
        title={title}
        busy={busy}
        refusal={refusal === null ? null : t(refusal)}
        offset={offset}
        onTitle={setTitle}
        onSubmit={(event) => {
          void submit(event)
        }}
        onCancel={dismiss}
        onBlurCapture={onBlurCapture}
      />
    </>,
    document.body,
  )
}

/* ─────────────────────────────── the panel ───────────────────────────────── */

export interface QuickAddPanelProps {
  readonly panelRef: RefObject<HTMLDivElement | null>
  readonly inputRef: RefObject<HTMLInputElement | null>
  readonly titleId: string
  readonly hintId: string
  /** Already translated and fenced by the locale string. */
  readonly heading: string
  readonly title: string
  readonly busy: boolean
  /** Already translated, or null when the branch can hold new work. */
  readonly refusal: string | null
  readonly offset: MenuOffset | null
  readonly onTitle: (value: string) => void
  readonly onSubmit: (event: FormEvent<HTMLFormElement>) => void
  readonly onCancel: () => void
  readonly onBlurCapture: (event: ReactFocusEvent<HTMLDivElement>) => void
}

/**
 * The markup, separated from the behaviour — the split `CommandPalette` makes
 * and for its reason: `react-dom/server` throws on a portal and does nothing
 * with a layout effect, so the half above this line cannot be asserted from a
 * node test. This half takes its position as a prop and renders.
 */
export function QuickAddPanel({
  panelRef,
  inputRef,
  titleId,
  hintId,
  heading,
  title,
  busy,
  refusal,
  offset,
  onTitle,
  onSubmit,
  onCancel,
  onBlurCapture,
}: QuickAddPanelProps): ReactElement {
  return (
    <div
      ref={panelRef}
      className="mtree-qa"
      style={
        offset === null
          ? { visibility: 'hidden' }
          : {
              insetInlineStart: `${offset.inlineStart}px`,
              insetBlockStart: `${offset.blockStart}px`,
            }
      }
      // A group rather than a dialog: it does not trap focus, it does not make
      // the map inert, and calling it a dialog would tell a screen reader to
      // expect both. `pages/Mindtree.tsx` makes the same call for its export
      // popover, in the opposite direction, and says so.
      role="group"
      aria-labelledby={titleId}
      onBlurCapture={onBlurCapture}
    >
      <p className="mtree-qa-title" id={titleId}>
        {heading}
      </p>

      {refusal !== null ? (
        // No form at all. An input that cannot submit is a control that teaches
        // the reader to press Enter and get nothing — actions.ts already
        // disables the verb, and this is the frame where the tree changed
        // underneath an open popover.
        <p className="mtree-qa-why">{refusal}</p>
      ) : (
        <form className="mtree-qa-form" onSubmit={onSubmit}>
          <input
            ref={inputRef}
            className="input mtree-qa-input"
            type="text"
            value={title}
            maxLength={TITLE_MAX}
            enterKeyHint="done"
            autoComplete="off"
            aria-label={t('mindtree.quickAddField')}
            aria-describedby={hintId}
            placeholder={t('mindtree.quickAddPlaceholder')}
            onChange={(event) => onTitle(event.target.value)}
          />
          <div className="mtree-qa-row">
            <button
              type="submit"
              className="btn btn-sm btn-primary"
              aria-busy={busy}
              disabled={title.trim() === '' || busy}
            >
              {t('mindtree.quickAddSubmit')}
            </button>
            <button type="button" className="btn btn-sm btn-ghost" onClick={onCancel}>
              {t('common.cancel')}
            </button>
          </div>
          {/* Pointed at by the field rather than left for the reader to find:
              "Enter keeps the box open" is the whole behaviour of this control,
              and a hint nobody is sent to is a hint nobody reads. */}
          <p className="mtree-qa-hint" id={hintId}>
            {t('mindtree.quickAddHint')}
          </p>
        </form>
      )}
    </div>
  )
}

export default QuickAdd
