// THE LENS, WIRED — the store, the derived stage and subject, the phone's
// detent, and the sentence a screen reader hears when any of it moves.
//
// It holds NO effect that writes the URL. `useMapUrl` owns the address bar for
// this screen and mirrors `lens`/`stage` in the same pair of effects that mirror
// `focus`/`dim`, for the reason its header gives: two effects calling
// `setParams` on one render both start from the same snapshot, and the second
// drops the first's contribution. This hook writes the STORE; that one mirrors
// it. Called LAST in the composition, after `useMapUrl`, so it cannot move any
// of the eleven hooks whose order is a hard requirement of the hooks themselves.
//
// THE STAGE IS DERIVED FROM TWO THINGS THE STORE ALREADY HELD. The lens decides
// the surface; `view` — MapToolbar's map⇄table switch, persisted since before
// lenses existed — decides how the open tree is drawn. A second persisted
// `stage` would be two records of one idea and they would disagree the first
// time either writer ran alone, which is the defect the contract's risk 6 names
// for the collapse state and the same trap in a different corner.
//
// THE DETENT IS SESSION STATE, DELIBERATELY, and this is the one departure worth
// reading twice. `phoneDetentFor` gives every subject its opening height, and
// `needs-me` and `what-changed` open at `full` because anything less shows a
// phone reader fewer rows than /followups does today — the exact regression the
// whole collapse exists to avoid. Persisting a height the reader once dragged to
// on some other lens would quietly re-introduce it a session later, so the
// height is recomputed whenever the panel's SUBJECT KIND changes and remembered
// within that subject for as long as the reader stays on it.
//
// EVERY SETTER ANNOUNCES. The chips change what the whole screen is about, and a
// sighted reader gets that from the paint; `announce` is the page's own polite
// region (MapSummary's, keyed on a counter so the same sentence twice is still
// two announcements).

import { useCallback, useMemo, useRef, useState } from 'react'
import { t } from '../../lib/i18n'
import {
  DETENT_KEY,
  LENS_KEY,
  STAGE_KEY,
  allowedStages,
  phoneDetentFor,
  stageWithTable,
  subjectForLens,
  type MapLens,
  type MapStage,
  type PanelDetent,
  type PanelSubject,
} from '../../lib/mindtree/lens'
import {
  setMindLens,
  setMindPanelOpen,
  setMindView,
  useMindLens,
  useMindPanelOpen,
  useMindView,
} from '../../store/mindtree'

/**
 * Re-exported at the name the shell and `MapPanel` import it by. The union is
 * DECLARED in lib/mindtree/lens.ts so that `phoneDetentFor` can be total over it
 * without a pure module importing a hook — `src/lib/**` may not reach into
 * `src/pages/**` any more than into `src/store/**`.
 */
export type { PanelDetent }

export interface MapLensState {
  readonly lens: MapLens
  readonly stage: MapStage
  readonly subject: PanelSubject
  readonly panelOpen: boolean
  readonly detent: PanelDetent
  setLens: (next: MapLens) => void
  setStage: (next: MapStage) => void
  setSubject: (next: PanelSubject) => void
  setPanelOpen: (open: boolean) => void
  setDetent: (next: PanelDetent) => void
}

/**
 * `focusNodeId` is `useMapFocus`'s resolved drill-in — the id ACTUALLY focused
 * after any repair, not the persisted preference, so the branch panel can never
 * address a node the canvas is not drawing.
 */
export function useMapLens(options: {
  focusNodeId: string | null
  compact: boolean
  announce: (text: string) => void
}): MapLensState {
  const { focusNodeId, compact, announce } = options

  const lens = useMindLens()
  const table = useMindView() === 'table'
  const panelOpen = useMindPanelOpen()

  const stage = stageWithTable(lens, table)
  const subject = useMemo(() => subjectForLens(lens, focusNodeId), [lens, focusNodeId])

  const [detent, setDetentState] = useState<PanelDetent>(() => phoneDetentFor(subject))

  /**
   * The panel's opening height follows its SUBJECT KIND, not its identity: a
   * reader who drills from one branch to the next keeps the height they chose,
   * and a reader who switches from a branch to the attention list gets that
   * list's own opening height rather than the branch's.
   *
   * Guarded on the kind rather than the object because `subject` is a fresh
   * object every time the focused node changes.
   *
   * DURING THE RENDER, NOT IN AN EFFECT, and a link is what made the difference
   * visible. `?lens=what-changed` now opens the dock (useMapUrl's inbound
   * effect), and the lens it sets arrives as a STORE write — so the render that
   * first paints the open sheet is not one this hook's setters were called from.
   * In an effect the height lands one paint later, and a phone reader following
   * "See all" watches the sheet open at `peek` and then jump to `full`. React
   * re-runs the component immediately on a render-phase adjustment and discards
   * this pass, so the sheet's FIRST paint is at the right height. The ref is
   * written before the setter, so the adjusted pass sees no change and stops.
   */
  const kindRef = useRef<PanelSubject['kind']>(subject.kind)
  if (kindRef.current !== subject.kind) {
    kindRef.current = subject.kind
    setDetentState(phoneDetentFor(subject))
  }

  const setLens = useCallback(
    (next: MapLens) => {
      setMindLens(next)
      /**
       * A CHIP MEANS "SHOW ME THIS", so it re-opens a dock the reader closed.
       * Closing the panel is how you give the picture the whole width; tapping a
       * lens is how you ask for the list back, and needing two taps for it would
       * put the day's most common act behind a disclosure.
       */
      setMindPanelOpen(true)
      // Set here as well as in the adjustment above, and it is not redundant:
      // this one runs inside the TAP, so the sheet opens at the right height
      // even for a chip whose subject kind does not change (branch → branch on
      // another node), where the adjustment has nothing to react to.
      setDetentState(phoneDetentFor(subjectForLens(next, focusNodeId)))
      announce(t('mindtree.lensChanged', { label: t(LENS_KEY[next]) }))
    },
    [announce, focusNodeId],
  )

  /**
   * The ledger switch. Only the two stages the OPEN TREE can be drawn as are
   * settable: `board` and `numbers` follow from their lens, and letting a caller
   * write one directly would put the shell in a state where the chip bar and the
   * canvas disagree about what the screen is.
   */
  const setStage = useCallback(
    (next: MapStage) => {
      if (!allowedStages(lens).includes(next)) return
      if (next === 'table' || next === 'map') setMindView(next)
      announce(t('mindtree.stageChanged', { label: t(STAGE_KEY[next]) }))
    },
    [announce, lens],
  )

  /**
   * Make this subject the panel's subject — the inverse of `subjectForLens`.
   *
   * `branch` sets the SHAPE lens and nothing else: the drill-in belongs to
   * `useMapFocus`, and a caller asking for a branch panel has just focused that
   * node (or is about to). Writing the focus from here would give one concept
   * two writers, which is how a drill-in and a breadcrumb start disagreeing.
   */
  const setSubject = useCallback(
    (next: PanelSubject) => {
      switch (next.kind) {
        case 'none':
          setMindPanelOpen(false)
          announce(t('mindtree.panelHidden'))
          return
        case 'needsMe':
          setLens('needs-me')
          return
        case 'branch':
          setLens('shape')
          return
        case 'changes':
          setLens('what-changed')
          return
        case 'numbers':
          setLens('numbers')
          return
      }
    },
    [announce, setLens],
  )

  const setPanelOpen = useCallback(
    (open: boolean) => {
      setMindPanelOpen(open)
      announce(t(open ? 'mindtree.panelShown' : 'mindtree.panelHidden'))
    },
    [announce],
  )

  const setDetent = useCallback(
    (next: PanelDetent) => {
      setDetentState(next)
      // Only on a phone: above 768px the panel is an inline-end rail and the
      // detent describes nothing on the screen, so announcing it would be a
      // sentence about a control the reader does not have.
      if (compact) announce(t('mindtree.detentChanged', { label: t(DETENT_KEY[next]) }))
    },
    [announce, compact],
  )

  return {
    lens,
    stage,
    subject,
    panelOpen,
    detent,
    setLens,
    setStage,
    setSubject,
    setPanelOpen,
    setDetent,
  }
}
