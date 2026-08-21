// THE GROUP-BY MENU — ONE target where there were four, at every width.
//
// WHAT LEFT, AND WHERE IT WENT. This file used to be the map's whole toolbar
// row: four group-by chips, Expand all, Collapse all, Compact, three zoom
// controls, Fit, and the export disclosure — twelve controls in one line of
// chrome above a canvas that then started 54% of the way down a 900px viewport.
//   · Expand all / Collapse all / Zoom − / "Zoom 100%" / Zoom + / Fit
//     -> `MapDiveRail`. One continuous control, and Fit is its zero rung. The
//        two batch verbs are not replaced, they are RETIRED: every child is
//        already in the drawing, waiting at its own distance, so there is no
//        fold to open. `useMapToolbar` keeps both exported for the node menu and
//        the table stage, which still mean something by them.
//   · Compact -> DELETED. The LOD bands are absolute CSS pixels, so density is a
//     camera position now rather than a preference. The store value survives for
//     the linear/table path.
//   · The export <details> -> MapModeBar, which is where the two things that
//     leave the map already live.
//
// ── AND NOW THE FOUR CHIPS COLLAPSE AT EVERY WIDTH, WHICH REVERSES THIS
//    FILE'S OWN EARLIER ARGUMENT. THE REVERSAL IS DELIBERATE. ──────────────
//
// What this file used to say, and it was a good argument: `lib/mindtree/
// dropRules.ts` writes A DIFFERENT PATCH PER DIMENSION — a drag onto a status
// ring sets the status, onto an owner ring reassigns — so the row is the map's
// MODE SELECTOR FOR EDITING, and a mode selector is the last control you bury.
// A comparison sweep costs 3 taps with the chips out and 6 with them in a menu.
//
// All of that is still true and it is now OUTWEIGHED, for a reason that is a
// measurement rather than a preference. The unit's budget is 12 persistent
// targets on a canvas the reader is trying to read; four chips is a third of it
// spent on a control whose own case is "a comparison sweep costs three taps
// instead of six". The summary NAMES THE ACTIVE DIMENSION, so the mode is not
// invisible — which was the actual failure mode the argument was defending
// against — and the sweep is three extra taps, not a lost capability.
//
// So the phone path is not a phone path any more: it is THE path, and the
// desktop's `.chip-row` is deleted. The compact flag survives only as a
// placement hint on the wrapper, so the shell can put the summary where the
// width allows without this file growing a second breakpoint.
//
// THE `GROUP BY` LABEL IS DELETED, AND THAT IS A WIRING CHANGE RATHER THAN A CSS
// ONE. The `.mtree-bar-label` span carried `id="mtree-groupby"` and the chip row
// pointed at it with `aria-labelledby`. Deleting the span alone would have left
// the group silently nameless — an `aria-labelledby` pointing at nothing
// contributes NO name, it does not fall back. So the group takes the same words
// as a direct `aria-label` from the same key, and `mindtree.groupBy` is NOT
// retired.
//
// ── AND WAVE 6 ADDS A SECOND MENU BESIDE THE FIRST, WHICH IS ONE MORE TARGET
//    THAN THE PARAGRAPH ABOVE SPENT ITS BUDGET ON. ───────────────────────────
//
// The budget stands; what changed is that there are now two axes and not two
// spellings of one. `dimension` buckets the ENTRIES under a branch (status,
// owner, priority, health) and `grouping` buckets the ORGANIZATIONS themselves
// (`?by=` — stage, team, vendors, or none), which is the only control that can
// turn a ring of four hundred into six named cards. Folding them into one menu
// would have made "Grouped by Owner · Stage" one summary saying two things, and
// hiding the new one behind the old one's popover would have cost the rows their
// 44px clearance (see the `grouping` prop). Two summaries, each naming its own
// value, each one tap.
//
// THE SECOND MENU IS ABSENT WHEN THE MAP DRAWS NO ORGANIZATIONS, so the small
// workspace this file was written against still sees exactly one target.
//
// THE ACTIONS THEMSELVES stay at page level (pages/Mindtree.tsx and
// pages/map/useMapToolbar.ts): the dimension trim needs the persisted focus, and
// the grouping is a write to the ADDRESS BAR that the portfolio's table reads
// back. What this file owns is the chrome.

import { useEffect, useRef, type ReactElement, type ReactNode } from 'react'
import { t } from '../../lib/i18n'
import {
  MIND_DIMENSIONS,
  MIND_GROUPINGS,
  type MindDimension,
  type MindGrouping,
} from '../../lib/mindtree/model'
import './map-altitude.css'

export interface MapToolbarProps {
  dimension: MindDimension
  onDimension: (next: MindDimension) => void
  /**
   * WHAT THE ORGANIZATIONS BUCKET BY — the second axis, and a SECOND MENU
   * beside the first rather than a second group inside it.
   *
   * TWO DISCLOSURES, ARGUED. The budget paragraph above is why this was not
   * simply four more chips on the row, and the same arithmetic says why they are
   * not stacked inside the existing popover either: `.malt-pop` is a flex column
   * whose 16px gap exists because two `.tap-44` rows any closer have OVERLAPPING
   * hit areas, and a nested group would need its own copy of that rule in a
   * sheet this component does not own. What a reader gets instead is two
   * summaries that each NAME THEIR CURRENT VALUE — "Grouped by Status",
   * "Organizations by Stage" — which is the one property the collapsed control
   * had to keep.
   *
   * `null` MEANS THERE IS NOTHING TO GROUP, and it is a different answer from an
   * empty list of choices: a workspace with no organizations drawn (none
   * recorded, all archived, all filtered away) gets no second target at all,
   * because a control whose every setting draws the same picture is a control
   * that reads as broken. The shell decides it — see `MapModel.hasEntities`.
   */
  grouping: MindGrouping
  onGrouping: (next: MindGrouping) => void
  /**
   * The groupings this map can actually be put into, in the model's own order.
   *
   * A LIST RATHER THAN `MIND_GROUPINGS` ITSELF, because not every member of that
   * union round-trips through `?by=`: `type` is a rung of the overflow ladder
   * that the URL never spells, and a chip for it could not light after a reload.
   * The shell owns that mapping (`CANVAS_GROUPINGS`), so this component renders
   * what it is given and orders it by `MIND_GROUPINGS` regardless.
   */
  groupings: readonly MindGrouping[] | null
  /**
   * Placement only. The CONTROL is the same object at every width now; this
   * decides where the shell's sheet puts it, from the shell's ONE reading of
   * `(max-width: 767px)` rather than a second breakpoint in CSS that could
   * disagree with it — MapLensBar, MapModeBar and MapPanel take the same value
   * from the same place.
   */
  compact: boolean
}

export default function MapToolbar({
  dimension,
  onDimension,
  grouping,
  onGrouping,
  groupings,
  compact,
}: MapToolbarProps): ReactElement {
  const activeDim = MIND_DIMENSIONS.find((d) => d.key === dimension) ?? MIND_DIMENSIONS[0]
  const activeGroup = MIND_GROUPINGS.find((g) => g.key === grouping) ?? MIND_GROUPINGS[0]
  // The offered list, in MIND_GROUPINGS order — see the prop's own note. Held
  // as a Set so the order comes from the model and the membership from the
  // shell, rather than from whichever of the two the caller happened to sort.
  const offered = groupings === null ? null : new Set<MindGrouping>(groupings)

  return (
    <div className="mtree-bar" data-compact={compact ? '' : undefined}>
      <AxisMenu
        summary={t('mindtree.groupByCurrent', {
          label: t(activeDim?.labelKey ?? 'mindtree.dimStatus'),
        })}
        label={t('mindtree.groupBy')}
      >
        {MIND_DIMENSIONS.map((d) => (
          <AxisStop
            key={d.key}
            label={t(d.labelKey)}
            pressed={dimension === d.key}
            onChoose={() => onDimension(d.key)}
          />
        ))}
      </AxisMenu>
      {offered !== null && (
        <AxisMenu
          /* "Organizations by Stage" — except at `none`, which gets a sentence
             of its own rather than "Organizations by None". The chip's word IS
             "None" and that is right on a chip, where it sits beside the other
             three; read alone on a collapsed control it names a grouping that
             does not exist. Both spellings still say which state the control is
             in, which is the property this summary exists for. */
          summary={
            grouping === 'none'
              ? t('mindtree.groupingNone')
              : t('mindtree.groupingCurrent', { label: t(activeGroup?.labelKey ?? 'common.none') })
          }
          // `portfolioBy`, DELIBERATELY — the portfolio's chip group already
          // asks this exact question in these exact words ("Group the
          // organizations by"), and it is the SAME control: one `?by=`, two
          // surfaces. A second key saying the same sentence is two rows in
          // Settings › Terminology for one idea, which is the collision
          // labelSections.test.ts fails the build over. The key's `portfolio`
          // prefix is a fact about where it was first written, not about who
          // may render it.
          label={t('mindtree.portfolioBy')}
        >
          {MIND_GROUPINGS.filter((g) => offered.has(g.key)).map((g) => (
            <AxisStop
              key={g.key}
              label={t(g.labelKey)}
              pressed={grouping === g.key}
              onChoose={() => onGrouping(g.key)}
            />
          ))}
        </AxisMenu>
      )}
    </div>
  )
}

/**
 * One collapsed axis: a 44px summary naming where it is, opening a small stack
 * of 44px rows.
 *
 * ONE COMPONENT FOR BOTH AXES, and the reason is the effect below rather than
 * the markup. Escape and light-dismiss are behaviours `<details>` does not have,
 * and two hand-written copies of them are two places for the focus return to rot
 * — the half a bare `el.open = false` already gets wrong once.
 *
 * THE CLOSE IS THE CONTAINER'S, NOT THE ROW'S, and it has to be: the rows arrive
 * as `children`, and a child cannot reach the `<details>` element that owns it.
 * It fires on the bubble, after the row's own handler, which is the same order
 * the hand-written version ran in.
 */
function AxisMenu({
  summary,
  label,
  children,
}: {
  summary: string
  label: string
  children: ReactNode
}): ReactElement {
  const menuRef = useRef<HTMLDetailsElement | null>(null)

  /**
   * ESCAPE AND LIGHT-DISMISS, because `<details>` provides NEITHER — the same
   * two behaviours, added the same way, that the export disclosure has carried
   * since it lived in this file. Only `<dialog>` and the `popover` attribute get
   * them from the platform; an opened `<details>` stays open forever, and this
   * one floats over a map the reader is about to pan. Focus returns to the
   * summary on Escape, which is the half a bare `el.open = false` gets wrong.
   */
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      const el = menuRef.current
      if (el === null || !el.open) return
      el.open = false
      el.querySelector<HTMLElement>('summary')?.focus()
    }
    // pointerdown, not click: a pointer that goes down outside the panel is
    // already a dismissal, and waiting for the click lets a drag that started on
    // the canvas pan the map underneath an open menu.
    const onDown = (event: PointerEvent): void => {
      const el = menuRef.current
      if (el === null || !el.open) return
      if (event.target instanceof Node && el.contains(event.target)) return
      el.open = false
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('pointerdown', onDown)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('pointerdown', onDown)
    }
  }, [])

  return (
    <details className="malt-menu" ref={menuRef}>
      {/* The summary NAMES THE ACTIVE VALUE rather than the question: a
          collapsed mode selector that does not say which mode it is in has made
          the mode invisible, which is worse than the row it replaced. */}
      <summary className="malt-current tap-44">{summary}</summary>
      <div
        className="malt-pop"
        role="group"
        aria-label={label}
        // ONE CLOSE FOR EVERY ROW, at the container, instead of one per stop:
        // the rows are handed down as children and only the element that OWNS
        // the disclosure can shut it. Fired on the bubble, so the stop's own
        // handler has already run.
        onClick={() => {
          const el = menuRef.current
          if (el !== null) el.open = false
        }}
      >
        {children}
      </div>
    </details>
  )
}

/** One row of one menu. `aria-pressed`, `.tap-44`, and the axis's own word. */
function AxisStop({
  label,
  pressed,
  onChoose,
}: {
  label: string
  pressed: boolean
  onChoose: () => void
}): ReactElement {
  return (
    <button type="button" className="malt-stop tap-44" aria-pressed={pressed} onClick={onChoose}>
      {label}
    </button>
  )
}
