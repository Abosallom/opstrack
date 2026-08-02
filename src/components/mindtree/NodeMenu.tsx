// The per-node menu — what this branch or item LETS YOU DO, as a real menu.
//
// IT DECIDES NOTHING ABOUT PERMISSION OR POLICY, and that is the whole shape of
// this file. `lib/mindtree/actions.mindActionsFor()` has already answered "which
// verbs, enabled or not, and why not" before a single row is drawn, and
// `lib/mindtree/dropRules.evaluateDrop()` answers "what does choosing THIS value
// do to THIS row" — the same function a DROP onto the same bucket calls. This
// component turns those two answers into markup, keyboard behaviour and one
// confirmation. Nothing here recomputes a rule, and nothing here writes.
//
// WHY A DISABLED ITEM STAYS ON SCREEN. An ops lead who cannot do a thing needs
// to know WHY he cannot, once, rather than hunt for a verb that is not there.
// So every refused verb renders with `aria-disabled` and its own sentence —
// `MindAction.reasonKey`, already an i18n key naming the refusal — and stays
// FOCUSABLE, which is the APG guidance for menus and the only way a screen
// reader user meets the explanation at all. The two shapes that are absent
// rather than disabled are absent upstream, in actions.ts, and for its stated
// reason: "collapse" on a leaf is not a refusal, it is a category error.
//
// THE VALUE SUB-MENU IS A DRILL-IN, NOT A FLY-OUT. "Assign to…", "Change the
// status…" and "Change the priority…" each need a value, and this component
// opens it by REPLACING the panel rather than hanging a second panel off its
// inline edge. Three reasons, in order of how much they cost: a fly-out has to
// choose a side, and the side flips in Arabic; a fly-out on a phone is a 200px
// panel hanging off a 44px row with nowhere to go; and a replaced panel is one
// roving-focus ring instead of two, which is the difference between an arrow key
// that works and an arrow key that works most of the time. The rows are
// `role="menuitemradio"` and the row the entry is ALREADY in carries
// `aria-checked` — computed from `evaluateDrop`'s `noop` arm, so "which value is
// current" is answered by the module that owns what a bucket means rather than
// by a second comparison here that could drift from it.
//
// THE CONFIRM IS RAISED AFTER THE MENU CLOSES, deliberately, and the ordering is
// a focus fix rather than a style choice. `components/Confirm.tsx` captures
// `document.activeElement` when it opens and restores it when it closes; if the
// menu were still up, that capture would be a menu row this component is about
// to unmount, and Confirm's own `focusRestoreTarget` would find it detached and
// fall back to `<main>`. Closing first means Confirm captures the NODE — which
// is where the reader was and where they must end up — and it means the branch
// being changed is visible behind the dialog while the question is on screen.
//
// WHAT IT DOES NOT DO: WRITE. `onRun` hands the surface a fully decided
// `MindMenuRun` — the ids, the patch, and the `DropOutcome` that produced it —
// and the surface performs it through `store/entries`, the same optimistic-
// write-plus-rollback path the board, the tree and the drag all use. A second
// write path on this screen would be a second rollback path, and only one of
// them would be the one that has been tested.

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactElement,
  type RefObject,
} from 'react'
import { createPortal } from 'react-dom'
import { confirm, focusRestoreTarget } from '../Confirm'
import { isolate } from '../../lib/bidi'
import { t } from '../../lib/i18n'
import { pushOverlay } from '../../lib/overlayStack'
import {
  mindActionsFor,
  type MindAction,
  type MindActionCtx,
  type MindActionKind,
} from '../../lib/mindtree/actions'
import { closesEntry, evaluateDrop, type DropOutcome } from '../../lib/mindtree/dropRules'
import type { MindNode } from '../../lib/mindtree/model'
import type { EntryPatch } from '../../types'
import './node-menu.css'

/* ────────────────────────────── the contract ─────────────────────────────── */

/**
 * The three axes a verb can pick a value on.
 *
 * `MindDimension` minus `health`, and the subtraction is the point: a health
 * group is DERIVED by `v_entry_health` from due dates and activity, so there is
 * no column for a menu to set. `dropRules` refuses that drop by name; this type
 * makes the same refusal unrepresentable.
 */
export type MindChoiceAxis = 'owner' | 'status' | 'priority'

/** One value in a sub-menu. */
export interface MindMenuChoice {
  /**
   * The BUCKET KEY, exactly as `model.ts` spells it on a branch: a status or
   * priority key, a member id, `name:<free text>` for somebody outside the
   * roster, or `NO_VALUE` (the empty string) for unassigned. It is handed
   * straight to `evaluateDrop`, so a choice and a drop onto the branch of the
   * same name cannot mean two different things.
   */
  readonly value: string
  /** Already translated, and NOT isolated — this component fences it. */
  readonly label: string
  /** A hidden vocabulary option, or an owner the roster has forgotten. */
  readonly retired?: boolean
}

/**
 * The values each axis offers, supplied by the surface.
 *
 * NOT read from `store/vocab` and `store/members` here, for the reason
 * `MindNode.tsx`'s header gives about its own view models: the page already
 * holds both stores and already resolves their labels, and a component that
 * subscribed to them itself would re-render the whole menu on any roster change
 * while it is open — under the reader's finger.
 */
export interface MindMenuChoices {
  readonly owner: readonly MindMenuChoice[]
  readonly status: readonly MindMenuChoice[]
  readonly priority: readonly MindMenuChoice[]
}

/**
 * A decided act, handed to the surface to perform.
 *
 * EVERYTHING IS ALREADY RESOLVED. `targetIds` is filtered to rows the viewer may
 * write AND that the act actually changes; `patch` is the one `dropRules` built,
 * never one reassembled here. A surface performs it with
 * `patchEntry(id, run.patch)` per id and nothing else.
 */
export interface MindMenuRun {
  readonly kind: MindActionKind
  /** The action as `actions.ts` decided it — for the label and the audit trail. */
  readonly action: MindAction
  /** Rows to write. Empty for the read verbs, for `addHere`, and for a no-op. */
  readonly targetIds: readonly string[]
  /** The patch for each of `targetIds`. Null when the verb writes no column. */
  readonly patch: EntryPatch | null
  /**
   * The verdict for the chosen value, when the verb picked one.
   *
   * Carried rather than collapsed into `patch` because the surface needs its
   * other two arms: `noop` is the sentence `DROP_UNCHANGED_KEY` names ("it is
   * already there"), and `field`/`value` are what an announcement says out loud.
   */
  readonly outcome: DropOutcome | null
  /** True when this component already asked and the reader said yes. */
  readonly confirmed: boolean
}

export interface NodeMenuProps {
  /**
   * The ROOT-TO-NODE path, node LAST — the same shape `mindActionsFor` and
   * `evaluateDrop` take, because ring 2 is drawn inside ring 1 and an act on a
   * group branch means the intersection of it and its ancestors.
   *
   * REFERENCE-STABLE WHILE THE MENU IS OPEN, alongside `ctx`: it keys the memo
   * that builds the rows, and a fresh array each render would rebuild every row
   * and re-register the Escape handler on every frame. `pages/Mindtree.tsx`
   * already
   * holds the tree in a memo, so the path is a slice of something stable.
   */
  readonly path: readonly MindNode[]
  /** The node's label as RAW text. This component fences it for direction. */
  readonly label: string
  /** Where the gesture happened, in CLIENT (viewport) pixels. */
  readonly at: { readonly x: number; readonly y: number }
  /** Arabic. Decides which arrow opens a sub-menu, and which viewport edge the
   *  placement measures from. */
  readonly rtl: boolean
  /** Must be reference-stable while the menu is open — it keys the memo that
   *  builds the rows. */
  readonly ctx: MindActionCtx
  readonly choices: MindMenuChoices
  /**
   * The node's own DOM element, so dismissing puts the keyboard back where it
   * was. `pages/Mindtree.tsx` already holds this map — it is what `registerRef`
   * on `MindNode` is for.
   */
  readonly anchorEl: HTMLElement | SVGElement | null
  /** Perform it. Called AFTER `onClose`, and after any confirmation. */
  readonly onRun: (run: MindMenuRun) => void
  /** Dismissed. Focus has already been handed back to `anchorEl`. */
  readonly onClose: () => void
}

/* ─────────────────────────── the pure decisions ──────────────────────────── */

/**
 * Which axis this verb picks a value on, or null when it carries its own.
 *
 * `done` maps to `status` even though it opens no sub-menu: its value is in its
 * name, and routing it through the same axis is what lets one code path decide
 * whether the act closes the entry — see `runFor`.
 */
export function menuAxisFor(kind: MindActionKind): MindChoiceAxis | null {
  switch (kind) {
    case 'assign':
      return 'owner'
    case 'status':
    case 'done':
      return 'status'
    case 'priority':
      return 'priority'
    default:
      return null
  }
}

/** Does this verb replace the panel with a list of values? */
export function opensSubmenu(kind: MindActionKind): boolean {
  return kind !== 'done' && menuAxisFor(kind) !== null
}

/**
 * What choosing `value` on `axis` would do to this entry.
 *
 * THE SAME FUNCTION A DROP CALLS, with a one-step synthetic path standing in for
 * the branch the reader would otherwise have dragged onto. That is not a trick —
 * it is the only way "assign to Dana from the menu" and "drag onto Dana's
 * branch" can be guaranteed to mean the same thing, including the owner XOR
 * (`ownerId` and `ownerName` are mutually exclusive and clearing one requires
 * writing both) and the `noop` arm that keeps a pointless write off the wire.
 *
 * The axis is passed EXPLICITLY rather than taken from `ctx.dimension`: the map
 * may be grouped by owner while the reader changes a priority, and the value
 * they picked is the one that must land.
 */
export function chooseOutcome(
  ctx: MindActionCtx,
  entryId: string | null,
  axis: MindChoiceAxis,
  choice: { readonly value: string; readonly retired?: boolean },
): DropOutcome {
  return evaluateDrop({
    source: { kind: 'entry', entryId },
    entry: entryId === null ? undefined : ctx.entryById.get(entryId),
    path: [{ kind: 'group', bucketKey: choice.value, retired: choice.retired === true }],
    dimension: axis,
  })
}

/**
 * Does this act owe the reader a question first?
 *
 * TWO CAUSES, AND THEY ARE DIFFERENT KINDS OF IRREVERSIBLE. A bulk act is large
 * (`actions.MIND_BULK_CONFIRM_AT`, ten) and has no bulk undo — re-filing forty
 * items by hand is the cost of a mis-click. Closing an entry is small and takes
 * the row off every open list on the screen, which is the one act on this map
 * that REMOVES work from view rather than moving it; `dropRules.closesEntry` is
 * the only definition of that and is imported rather than restated.
 *
 * BOTH SHAPES OF "IT CLOSES" ARE ASKED ABOUT. A verb that picks a value hands
 * over the `DropOutcome` that value produced, and `closesEntry` reads it. The
 * BULK verb hands over none — `actions.selectionAction` evaluates one per ticked
 * row and keeps only the shared patch — so it carries the verdict on the action
 * itself. Reading only the outcome is how nine ticked items got closed with no
 * dialog while dragging the same nine onto the same branch asked first.
 */
export function needsConfirm(action: MindAction, outcome: DropOutcome | null): boolean {
  if (action.confirm || action.closes) return true
  return outcome !== null && closesEntry(outcome)
}

/**
 * The index a vertical menu key moves to, or null when the key is not ours.
 *
 * WRAPPING, per the APG menu pattern: a menu is a closed set, so there is no
 * "past the end" to fall out of. A `current` below zero means nothing is focused
 * yet — the panel has just been replaced — and is handled explicitly rather than
 * by modular arithmetic, which would send ArrowUp to the second-to-last row.
 */
export function nextMenuIndex(key: string, current: number, count: number): number | null {
  if (count <= 0) return null
  switch (key) {
    case 'ArrowDown':
      return current < 0 ? 0 : (current + 1) % count
    case 'ArrowUp':
      return current < 0 ? count - 1 : (current - 1 + count) % count
    case 'Home':
      return 0
    case 'End':
      return count - 1
    default:
      return null
  }
}

/**
 * An inline arrow key, resolved into a direction the menu understands.
 *
 * Mapped through `rtl` rather than assumed, for the reason `lib/radioGroup.ts`
 * states about the same two keys: in the Arabic UI "deeper" is to the LEFT, and
 * an unmapped ArrowRight would step BACK out of the sub-menu the reader just
 * opened. Up/Down are axis-neutral and are never mapped.
 */
export function menuInlineStep(key: string, rtl: boolean): 'forward' | 'back' | null {
  if (key === 'ArrowRight') return rtl ? 'back' : 'forward'
  if (key === 'ArrowLeft') return rtl ? 'forward' : 'back'
  return null
}

/**
 * Is this the keystroke that opens a context menu?
 *
 * Exported because the GESTURE belongs to whoever owns the node's keydown —
 * `pages/Mindtree.tsx` — while the RULE belongs here, beside the menu it opens.
 * Both spellings are real: `ContextMenu` is the dedicated key on a full-size
 * keyboard, and Shift+F10 is what every laptop without one uses.
 */
export function isMenuKey(event: { readonly key: string; readonly shiftKey: boolean }): boolean {
  if (event.key === 'ContextMenu') return true
  return event.shiftKey && event.key === 'F10'
}

/* ──────────────────────────────── placement ──────────────────────────────── */

export interface MenuBox {
  readonly inlineSize: number
  readonly blockSize: number
}

/** Offsets from the viewport's INLINE-START and BLOCK-START edges, in px. */
export interface MenuOffset {
  readonly inlineStart: number
  readonly blockStart: number
}

/** Breathing room between the panel and the edge it would otherwise touch. */
export const MENU_MARGIN_PX = 8

/**
 * Where the panel goes, in LOGICAL offsets.
 *
 * WHY LOGICAL AT ALL, when the input is a physical `clientX`. Because the output
 * is fed to `inset-inline-start` on a `position: fixed` element, and a fixed
 * element resolves that against the viewport using its OWN direction — so in
 * Arabic the same number means "this far from the right edge". Converting the
 * pointer once, here (`rtl ? viewport - x : x`), is what lets the rest of this
 * component and the whole of node-menu.css contain no physical direction at all.
 * The alternative — `left`/`right` plus a mirror rule — is the second copy of
 * the layout that mindtree.css's header refuses to keep.
 *
 * THE FLIP IS TOWARD INLINE-START, not a clamp. A menu clamped against the edge
 * covers the node it belongs to; a menu opened the other way keeps the branch
 * visible, which matters here more than anywhere else in the app because the
 * reader is choosing where work goes by looking at the picture behind it. The
 * clamp is still there underneath, for the case where the panel is wider than
 * the viewport (a narrow phone in landscape with a long owner name).
 */
export function menuPlacement(
  at: { readonly x: number; readonly y: number },
  box: MenuBox,
  viewport: MenuBox,
  rtl: boolean,
  margin: number = MENU_MARGIN_PX,
): MenuOffset {
  const inlineAt = rtl ? viewport.inlineSize - at.x : at.x

  let inlineStart = inlineAt
  if (inlineStart + box.inlineSize > viewport.inlineSize - margin) {
    inlineStart = inlineAt - box.inlineSize
  }
  inlineStart = clamp(inlineStart, margin, viewport.inlineSize - box.inlineSize - margin)

  let blockStart = at.y
  if (blockStart + box.blockSize > viewport.blockSize - margin) {
    blockStart = at.y - box.blockSize
  }
  blockStart = clamp(blockStart, margin, viewport.blockSize - box.blockSize - margin)

  return { inlineStart, blockStart }
}

/**
 * `max` applied LAST, so a panel bigger than the viewport pins to the start edge
 * and scrolls rather than being pushed off it by its own size.
 */
function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(value, max))
}

/* ────────────────────────────────── rows ─────────────────────────────────── */

/**
 * What one line of the panel is.
 *
 * A FLAT LIST, both panels, because the roving tabindex, the arrow keys and the
 * ref map all index into it — and an index into a tree is where an off-by-one
 * lives. `shape` is what the row IS to assistive technology; `action` and
 * `choice` are what it does.
 */
export interface MenuRow {
  readonly key: string
  readonly shape: 'item' | 'submenu' | 'radio' | 'back'
  /** Already translated. Never isolated — the panel fences it where it renders. */
  readonly label: string
  readonly enabled: boolean
  /** The refusal, already translated, or null. */
  readonly reason: string | null
  /** True on the value the entry already holds. `role="menuitemradio"` only. */
  readonly checked: boolean
  readonly action: MindAction | null
  readonly choice: MindMenuChoice | null
  readonly outcome: DropOutcome | null
}

/**
 * The verbs, as rows. One per `MindAction`, in the order actions.ts gave them —
 * that order is part of its contract and this adds nothing and drops nothing.
 */
export function rootMenuRows(actions: readonly MindAction[]): readonly MenuRow[] {
  return actions.map((action) => ({
    key: `act:${action.kind}`,
    shape: opensSubmenu(action.kind) ? 'submenu' : 'item',
    label: t(action.labelKey),
    enabled: action.enabled,
    reason: action.reasonKey === null ? null : t(action.reasonKey),
    checked: false,
    action,
    choice: null,
    outcome: null,
  }))
}

/**
 * The values for one axis, as rows, with "Back" at the head.
 *
 * `enabled` and `checked` are BOTH read off `evaluateDrop` rather than decided
 * here: a refusal is a retired bucket or a row the store has dropped, and
 * "checked" is its `noop` arm — the repo's one answer to "is this the bucket the
 * row is already in". Deriving either a second time is how a menu and a drag
 * start disagreeing about the same branch.
 */
export function valueMenuRows(
  ctx: MindActionCtx,
  entryId: string | null,
  axis: MindChoiceAxis,
  choices: readonly MindMenuChoice[],
  parent: MindAction,
): readonly MenuRow[] {
  const back: MenuRow = {
    key: 'back',
    shape: 'back',
    label: t('mindtree.menuBack'),
    enabled: true,
    reason: null,
    checked: false,
    action: null,
    choice: null,
    outcome: null,
  }
  const values = choices.map((choice): MenuRow => {
    const outcome = chooseOutcome(ctx, entryId, axis, choice)
    return {
      key: `val:${axis}:${choice.value}`,
      shape: 'radio',
      label: choice.label,
      // A refused value stays visible with its sentence, exactly as a refused
      // verb does — see the header on why nothing here vanishes.
      enabled: outcome.kind !== 'refused',
      reason: outcome.kind === 'refused' ? t(outcome.reasonKey) : null,
      checked: outcome.kind === 'noop',
      action: parent,
      choice,
      outcome,
    }
  })
  return [back, ...values]
}

/**
 * The act a row would perform, fully decided, or null when the row performs
 * nothing (a refusal, "Back", a sub-menu opener).
 *
 * PURE, so what a menu WRITES can be asserted without a DOM — which is the same
 * bargain `lib/dnd.ts` struck for the board's drag and the reason its gesture is
 * arithmetic plus a thin listener rather than one stateful component.
 */
export function menuRunFor(
  ctx: MindActionCtx,
  entryId: string | null,
  row: MenuRow,
): MindMenuRun | null {
  const action = row.action
  if (action === null || !row.enabled) return null
  if (row.shape === 'submenu' || row.shape === 'back') return null

  // A value was chosen — from the sub-menu, or from `done`, whose value is in
  // its name. Both arrive as a `DropOutcome`, so both get the no-op arm and both
  // answer `closesEntry` the same way.
  const axis = menuAxisFor(action.kind)
  if (row.shape === 'radio' || action.kind === 'done') {
    if (axis === null) return null
    const outcome = row.outcome ?? chooseOutcome(ctx, entryId, axis, DONE_CHOICE)
    return {
      kind: action.kind,
      action,
      // A no-op writes nothing. The surface still announces
      // `DROP_UNCHANGED_KEY` off the outcome: silence after a deliberate choice
      // reads as a dropped gesture.
      targetIds: outcome.kind === 'patch' ? [outcome.entryId] : EMPTY_IDS,
      patch: outcome.kind === 'patch' ? outcome.patch : null,
      outcome,
      confirmed: false,
    }
  }

  return {
    kind: action.kind,
    action,
    targetIds: action.targetIds,
    patch: action.patch,
    outcome: null,
    confirmed: false,
  }
}

/* ────────────────────────────── the component ────────────────────────────── */

export function NodeMenu({
  path,
  label,
  at,
  rtl,
  ctx,
  choices,
  anchorEl,
  onRun,
  onClose,
}: NodeMenuProps): ReactElement {
  const panelRef = useRef<HTMLDivElement>(null)
  const rowEls = useRef(new Map<number, HTMLButtonElement>())
  const labelId = useId()

  /** The open sub-menu's parent verb, or null on the root panel. */
  const [openKind, setOpenKind] = useState<MindActionKind | null>(null)
  const [activeIndex, setActiveIndex] = useState(0)
  const [offset, setOffset] = useState<MenuOffset | null>(null)

  const node = path[path.length - 1]
  const entryId = node?.entryId ?? null

  const actions = useMemo(() => mindActionsFor(path, ctx), [path, ctx])

  const rootRows = useMemo(() => rootMenuRows(actions), [actions])

  const openAction = useMemo(
    () => (openKind === null ? null : (actions.find((a) => a.kind === openKind) ?? null)),
    [actions, openKind],
  )

  const submenuRows = useMemo<readonly MenuRow[]>(() => {
    const axis = openAction === null ? null : menuAxisFor(openAction.kind)
    if (openAction === null || axis === null) return EMPTY_ROWS
    return valueMenuRows(ctx, entryId, axis, choices[axis], openAction)
  }, [choices, ctx, entryId, openAction])

  const rows = openKind === null ? rootRows : submenuRows

  /* ── the sub-menu ───────────────────────────────────────────────────────── */

  const openSubmenu = useCallback((kind: MindActionKind) => {
    setOpenKind(kind)
    // Row 0 is "Back". Landing on it would make the first ArrowDown a wasted
    // press, so focus starts on the first VALUE; Back is reached by arrowing up
    // (which wraps) or by the inline-back key.
    setActiveIndex(1)
  }, [])

  const closeSubmenu = useCallback(
    (kind: MindActionKind) => {
      setOpenKind(null)
      // Back onto the verb that opened it, not onto the top of the panel: the
      // reader's place in a list of nine verbs is not something a cancelled
      // sub-menu should cost them.
      const index = rootRows.findIndex((row) => row.action?.kind === kind)
      setActiveIndex(index < 0 ? 0 : index)
    },
    [rootRows],
  )

  /* ── dismissal ──────────────────────────────────────────────────────────── */

  /**
   * Hand the keyboard back, THEN unmount.
   *
   * The focus call comes first for the reason `pages/Board.tsx`'s
   * `closeComposer` documents: React batches the re-render to the end of the
   * handler, so the anchor is still a live, connected DOM node here. Doing it
   * from an unmount effect instead would be a `focus()` on a node that the
   * rebuild the act itself caused may already have replaced.
   */
  const dismiss = useCallback(() => {
    focusRestoreTarget<HTMLElement | SVGElement>(
      anchorEl,
      document.getElementById(FOCUS_FALLBACK_ID),
    )?.focus()
    onClose()
  }, [anchorEl, onClose])

  /**
   * Escape, arbitrated by `lib/overlayStack` rather than by a listener of our
   * own — that module exists because two overlays each binding `document` made
   * one keypress close both. A sub-menu is a layer of its own to the reader, so
   * the first Escape steps BACK to the root panel and only the second closes.
   */
  useEffect(() => {
    return pushOverlay(() => {
      if (openKind !== null) closeSubmenu(openKind)
      else dismiss()
    })
  }, [closeSubmenu, dismiss, openKind])

  /* ── running an act ─────────────────────────────────────────────────────── */

  const runFor = useCallback(
    (row: MenuRow): MindMenuRun | null => menuRunFor(ctx, entryId, row),
    [ctx, entryId],
  )

  /**
   * The two nouns the confirmation sentences need: WHAT is being changed and
   * WHERE it is going.
   *
   * Resolved here rather than inside `confirmFor` because only the component
   * knows which shape the run is. The destination has three spellings and they
   * are not interchangeable:
   *
   *  - a sub-menu pick names the VALUE the reader just chose (`row.choice`);
   *  - "Mark as done" names no value in its label, so the Done option's own
   *    translated label is looked up in `choices.status` — interpolating the
   *    verb would read "Mark ⁨X⁩ as ⁨Mark as done⁩?";
   *  - a bulk apply names the BRANCH, which is this menu's own `label` prop —
   *    the same string `DragLayer` passes as `plan.targetLabel`.
   *
   * The title comes from the row the act writes rather than from `entryId`, so
   * the single-row bulk case (a branch menu with one item ticked) still names
   * the item instead of the branch.
   */
  const confirmCopyFor = useCallback(
    (run: MindMenuRun, row: MenuRow): ConfirmCopy => {
      const target = run.targetIds[0]
      const entry = target === undefined ? undefined : ctx.entryById.get(target)
      const destination =
        row.choice?.label ??
        (row.action?.kind === 'done'
          ? (choices.status.find((c) => c.value === DONE_CHOICE.value)?.label ?? label)
          : label)
      return confirmFor(run, entry?.title ?? label, destination)
    },
    [choices, ctx, label],
  )

  const activate = useCallback(
    async (row: MenuRow): Promise<void> => {
      if (row.shape === 'back') {
        if (openKind !== null) closeSubmenu(openKind)
        return
      }
      if (!row.enabled || row.action === null) return
      if (row.shape === 'submenu') {
        openSubmenu(row.action.kind)
        return
      }

      const run = runFor(row)
      if (run === null) return

      // CLOSE FIRST — see the header. Confirm captures `document.activeElement`
      // on open, and it has to capture the node rather than a row that is about
      // to be unmounted out from under it.
      dismiss()

      if (!needsConfirm(row.action, run.outcome)) {
        onRun(run)
        return
      }

      const ok = await confirm(confirmCopyFor(run, row))
      if (!ok) return
      onRun({ ...run, confirmed: true })
    },
    [closeSubmenu, confirmCopyFor, dismiss, onRun, openKind, openSubmenu, runFor],
  )

  /* ── roving focus ───────────────────────────────────────────────────────── */

  useEffect(() => {
    rowEls.current.get(activeIndex)?.focus()
  }, [activeIndex, openKind])

  const onKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>): void => {
      const next = nextMenuIndex(event.key, activeIndex, rows.length)
      if (next !== null) {
        event.preventDefault()
        setActiveIndex(next)
        return
      }

      const step = menuInlineStep(event.key, rtl)
      if (step !== null) {
        const row = rows[activeIndex]
        if (step === 'forward' && row?.shape === 'submenu' && row.enabled && row.action !== null) {
          event.preventDefault()
          openSubmenu(row.action.kind)
        } else if (step === 'back' && openKind !== null) {
          event.preventDefault()
          closeSubmenu(openKind)
        }
        return
      }

      // Tab closes the menu rather than walking out of it into a page the reader
      // can no longer see — the APG rule, and the same reason the confirm dialog
      // traps it. `preventDefault` so focus lands back on the node rather than
      // on whatever happens to follow the portal in document order.
      if (event.key === 'Tab') {
        event.preventDefault()
        dismiss()
      }
      // Escape is handled at the document level, through lib/overlayStack.
    },
    [activeIndex, closeSubmenu, dismiss, openKind, openSubmenu, rows, rtl],
  )

  /* ── placement ──────────────────────────────────────────────────────────── */

  const atX = at.x
  const atY = at.y
  const rowCount = rows.length

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
    // Same-value guard: this effect runs on every panel swap and setState with a
    // fresh object would re-render forever if the deps ever became unstable.
    setOffset((prev) =>
      prev !== null && prev.inlineStart === next.inlineStart && prev.blockStart === next.blockStart
        ? prev
        : next,
    )
    // Re-measured when the PANEL changes: a sub-menu of twelve owners is not the
    // size of a root panel of six verbs, and keeping the first panel's offset
    // would hang the second off the block-end edge.
  }, [atX, atY, openKind, rowCount, rtl])

  if (rows.length === 0) return <></>

  const menuLabel =
    openAction === null
      ? t('mindtree.menuLabel', { label })
      : t('mindtree.menuValueLabel', { action: t(openAction.labelKey), label })

  return createPortal(
    <>
      {/* Light dismiss. A menu is not modal, so this carries no scrim and no
          colour — but it does have to swallow the press, or the same click that
          closes the menu also lands on the node behind it and opens the entry
          the reader was steering away from. */}
      <div className="mtree-menu-catch" role="presentation" onPointerDown={dismiss} />
      <NodeMenuPanel
        panelRef={panelRef}
        labelId={labelId}
        menuLabel={menuLabel}
        rows={rows}
        activeIndex={activeIndex}
        offset={offset}
        onKeyDown={onKeyDown}
        onActivate={(row) => {
          void activate(row)
        }}
        onHover={setActiveIndex}
        registerRow={(index, el) => {
          if (el) rowEls.current.set(index, el)
          else rowEls.current.delete(index)
        }}
      />
    </>,
    document.body,
  )
}

const EMPTY_IDS: readonly string[] = Object.freeze([])
const EMPTY_ROWS: readonly MenuRow[] = Object.freeze([])

/**
 * The value behind "Mark as done".
 *
 * A literal rather than a read of `MindAction.patch`, so that `done` and a
 * "Done" row in the status sub-menu travel the same `evaluateDrop` path and
 * cannot end up disagreeing about whether the act closes the entry. `actions.ts`
 * chooses 'done' over 'cancelled' for this verb and says why.
 */
const DONE_CHOICE: MindMenuChoice = Object.freeze({ value: 'done', label: '' })

/**
 * Where focus goes when the node itself did not survive the act.
 *
 * `<main id="main" tabIndex={-1}>` in App.tsx — the same anchor Confirm.tsx
 * falls back to, named here rather than imported because Confirm keeps its own
 * copy private, and `Confirm.test.ts` already asserts App.tsx still renders it.
 */
const FOCUS_FALLBACK_ID = 'main'

/** What `confirm()` needs, already translated. */
interface ConfirmCopy {
  title: string
  body: string
  confirmLabel: string
  cancelLabel: string
  danger: boolean
}

/**
 * The question a destructive act asks.
 *
 * Every string is resolved HERE and handed over already translated — the dialog
 * is mounted above the router and never calls `t()` itself, which is its own
 * header's rule.
 *
 * BOTH SENTENCES TAKE VARIABLES, and this function used to pass neither. The
 * strings are `"Mark ⁨{title}⁩ as ⁨{label}⁩?"` and `"They all move to ⁨{label}⁩…"`;
 * `lib/i18n.t()` skips interpolation entirely when `vars` is undefined and
 * `interpolate` leaves an unknown placeholder verbatim, so the reader met a
 * literal `{title}` on every "Mark as done" and a literal `{label}` on every
 * ten-plus bulk apply — the one sentence that says WHERE the batch is going.
 * `DragLayer.commitDrop` passes both correctly for the same two keys, which is
 * why only the menu path was wrong. The two callers now read the same.
 *
 * `title` is the row being closed and `label` is the DESTINATION — the value
 * picked in the sub-menu, or the branch the selection is being applied to. The
 * caller resolves both, because only it knows which of the two shapes this run
 * is (see `confirmCopyFor` in the component).
 */
export function confirmFor(run: MindMenuRun, title: string, label: string): ConfirmCopy {
  const cancelLabel = t('common.cancel')
  const closes = run.action.closes || (run.outcome !== null && closesEntry(run.outcome))
  // ONE ROW AND IT CLOSES — the close-flavoured question, which names the item.
  // Anything wider gets the batch question, still marked dangerous when the
  // batch closes. `DragLayer.commitDrop` splits on exactly `plan.closes &&
  // single`, and the two must not word the same act two ways.
  if (closes && run.targetIds.length <= 1) {
    return {
      title: t('mindtree.confirmCloseTitle', { title, label }),
      body: t('mindtree.confirmCloseBody'),
      confirmLabel: t('mindtree.confirmCloseOk'),
      danger: true,
      cancelLabel,
    }
  }
  const count = run.targetIds.length
  return {
    title: t('mindtree.confirmBulkTitle', { count }),
    body: t('mindtree.confirmBulkBody', { label }),
    confirmLabel: t('mindtree.confirmBulkOk'),
    danger: closes,
    cancelLabel,
  }
}

/* ─────────────────────────────── the panel ───────────────────────────────── */

export interface NodeMenuPanelProps {
  readonly panelRef: RefObject<HTMLDivElement | null>
  readonly labelId: string
  readonly menuLabel: string
  readonly rows: readonly MenuRow[]
  readonly activeIndex: number
  /** Null until the first layout pass has measured the panel — see the header. */
  readonly offset: MenuOffset | null
  readonly onKeyDown: (event: ReactKeyboardEvent<HTMLDivElement>) => void
  readonly onActivate: (row: MenuRow) => void
  readonly onHover: (index: number) => void
  readonly registerRow: (index: number, el: HTMLButtonElement | null) => void
}

/**
 * The markup, separated from the behaviour.
 *
 * A SEPARATE COMPONENT FOR THE REASON `CommandPalette`'s dialog is one:
 * `react-dom/server` throws on a portal and does nothing with a layout effect,
 * so everything above this line is unassertable from a node test. This half
 * takes its position as a prop and renders — which makes the roles, the names,
 * the checked states and the refusal sentences provable with
 * `renderToStaticMarkup`, the repo's only rendering test tool.
 */
export function NodeMenuPanel({
  panelRef,
  labelId,
  menuLabel,
  rows,
  activeIndex,
  offset,
  onKeyDown,
  onActivate,
  onHover,
  registerRow,
}: NodeMenuPanelProps): ReactElement {
  return (
    <div
      ref={panelRef}
      className="mtree-menu"
      style={
        offset === null
          ? // Measured on the first layout pass, before the browser paints, so
            // nothing flashes — but a panel drawn at the default offset while it
            // is being measured is a panel drawn in the corner.
            { visibility: 'hidden' }
          : {
              insetInlineStart: `${offset.inlineStart}px`,
              insetBlockStart: `${offset.blockStart}px`,
            }
      }
      role="menu"
      aria-labelledby={labelId}
      onKeyDown={onKeyDown}
    >
      <p className="mtree-menu-title" id={labelId}>
        {menuLabel}
      </p>
      {rows.map((row, index) => {
        const reasonId = row.reason === null ? undefined : `${labelId}-why-${index}`
        return (
          <button
            key={row.key}
            type="button"
            className="mtree-menu-item"
            ref={(el) => {
              // A block body: React 19 treats a ref callback's return value as a
              // cleanup function, and `map.set(...)` returns the Map. MindNode.tsx
              // paid for this one already.
              registerRow(index, el)
            }}
            data-shape={row.shape}
            role={row.shape === 'radio' ? 'menuitemradio' : 'menuitem'}
            aria-checked={row.shape === 'radio' ? row.checked : undefined}
            aria-haspopup={row.shape === 'submenu' ? 'menu' : undefined}
            // Never true: the sub-menu REPLACES this panel, so a row advertising
            // an expanded child while it is off screen would promise a subtree
            // nobody can reach — the same rule MindNode.tsx holds for a branch
            // sitting on the mobile depth limit.
            aria-expanded={row.shape === 'submenu' ? false : undefined}
            // aria-disabled, never `disabled`: a disabled button cannot take
            // focus, and a refusal nobody can reach explains nothing to the one
            // reader who most needs it. Confirm.tsx's arming window makes the
            // same call for the same reason.
            aria-disabled={row.enabled ? undefined : true}
            aria-describedby={reasonId}
            // ONE tab stop for the whole menu. The arrow keys move inside it and
            // Tab leaves it — which is what `role="menu"` promised.
            tabIndex={index === activeIndex ? 0 : -1}
            onClick={() => onActivate(row)}
            onPointerEnter={() => onHover(index)}
          >
            <span className="mtree-menu-tick" aria-hidden="true">
              {row.shape === 'radio' && row.checked && (
                <svg viewBox="0 0 16 16" focusable="false">
                  <path d="M3 8.5 L6.5 12 L13 4.5" />
                </svg>
              )}
            </span>
            <span className="mtree-menu-body">
              <span className="mtree-menu-label">{isolate(row.label)}</span>
              {row.reason !== null && (
                <span className="mtree-menu-why" id={reasonId}>
                  {row.reason}
                </span>
              )}
            </span>
            {/* NO CHEVRON on a sub-menu row, and its absence is the direction
                decision this file would otherwise have to make. An inline-forward
                arrow is a PHYSICAL shape — SVG has no logical properties, so it
                would need either the app's first `[dir='rtl']` override (which
                sheet.css deliberately avoided) or a second path to keep in step
                with the first. It is also redundant: `actions.ts` names these
                three verbs "Assign to…", "Change the status…", "Change the
                priority…" in both bundles, so the ellipsis already says a value
                is coming, and `aria-haspopup="menu"` says it to everyone else. */}
          </button>
        )
      })}
    </div>
  )
}

export default NodeMenu
