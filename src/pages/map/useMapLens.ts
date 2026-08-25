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
// ── THE SELECTED LEAF: THE NODE YOU PICKED, BESIDE THE WORLD YOU ARE IN ────
//
// The owner's correction — "make the map when i zoom in until Org itself then a
// side bar to open it" — splits one idea in two. The DRILL-IN says which world
// the reader is inside; it is `useMapFocus`'s and it re-roots the drawing. The
// SELECTION says which node the reader picked; an Organization is a LEAF you
// arrive at, so picking one must move NOTHING on the canvas — no re-root, no
// zoom, no relayout.
//
// `subjectForLens` only ever knew about the first. Fed `focusNodeId`, the panel
// could only ever be about the node the map had re-rooted to, so a tap on an
// Organization opened the branch panel on the DEPARTMENT above it — and, on the
// workspace the owner is looking at today, on nothing at all, because a map with
// no drill-in has `focusNodeId === null` and `shape` with null is `{kind:'none'}`
// and a `none` subject renders no panel. The sidebar opened empty.
//
// So this hook holds the second id, and `panelSubjectFor` is the one place the
// two are resolved: THE SELECTION WINS WHILE IT LASTS. It lasts exactly as long
// as it is still answering the reader's question, which is three rules and no
// more:
//
//   the drill-in MOVES     dropped. The reader dove somewhere else; a panel
//                          still describing the organization they picked two
//                          worlds ago is the stale-panel defect.
//   a CHIP sets the lens   dropped. A chip means "show me this lens, HERE", and
//                          here is where the map is, not what was picked before.
//   the panel CLOSES       dropped. Dismissing the sidebar dismisses its subject;
//                          re-opening it with the shape chip must answer where
//                          the reader is now.
//
// A LENS ARRIVING FROM THE URL IS NOT A CHIP and is deliberately not a fourth
// rule: `useMapUrl` writes the store directly, back/forward is the only way it
// happens, and a link carries a DRILL-IN — so if the reader is somewhere else,
// the first rule has already dropped the pick, and if they are not, the last
// node they asked about is still the right answer.
//
// It is deliberately NOT persisted and NOT in the URL. `useMapUrl` mirrors
// `lens`/`stage`/`focus`, all three of which describe where the map IS; a
// selection is a thing the reader just pointed at, and a link that re-opened
// yesterday's organization over today's map would be describing the pointer
// rather than the map.
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
  useMindViewPinned,
  type MindtreeView,
} from '../../store/mindtree'

/**
 * Re-exported at the name the shell and `MapPanel` import it by. The union is
 * DECLARED in lib/mindtree/lens.ts so that `phoneDetentFor` can be total over it
 * without a pure module importing a hook — `src/lib/**` may not reach into
 * `src/pages/**` any more than into `src/store/**`.
 */
export type { PanelDetent }

/**
 * WHAT THE PANEL IS ABOUT, given both ids — the one place they are resolved.
 *
 * `selectedNodeId` is the leaf the reader PICKED (an Organization tap);
 * `focusNodeId` is the world they are INSIDE (`useMapFocus`'s resolved drill-in,
 * never the persisted preference). The selection wins, because picking a node is
 * the more recent and the more specific of the two acts — and because the only
 * gesture that sets one deliberately leaves the camera where it was, which means
 * the drill-in cannot answer for it.
 *
 * A THIN FUNCTION OVER `subjectForLens`, ON PURPOSE. It adds a precedence and
 * nothing else: no new `PanelSubject`, no new `MapLens`, no second exhaustive
 * switch to keep in step with lens.ts's. Exported so the precedence can be
 * asserted with plain values — the hook it lives in cannot be observed through
 * `renderToStaticMarkup`, whose single pass never sees a setter's effect.
 */
export function panelSubjectFor(
  lens: MapLens,
  selectedNodeId: string | null,
  focusNodeId: string | null,
): PanelSubject {
  return subjectForLens(lens, selectedNodeId ?? focusNodeId)
}

/**
 * IS THERE A PANEL TO BE OPEN — the flag reconciled with what it claims to be
 * about, and the fix for a flag that could say yes about nothing.
 *
 * ── THE PHANTOM ────────────────────────────────────────────────────────────
 *
 * `mindtree.panelOpen` is a persisted preference and `DEFAULT_PREFS.panelOpen`
 * is `true`, so a FRESH workspace already holds `panelOpen === true` while
 * `subjectForLens('shape', null)` is `{kind:'none'}` and `Mindtree` renders no
 * panel at all. Every reader of the raw flag then believed a panel was on
 * screen: Escape's third rung consumed the press and announced "The panel is
 * hidden" about a panel nobody could see, so a keyboard reader who had dived
 * with the camera had to press Escape twice to surface, and a screen-reader
 * reader heard a sentence that was simply false. `applyLens` widened it — it
 * wrote `true` unconditionally, including for lenses that resolve to `none`.
 *
 * useMapUrl.ts:414 already guarded the OTHER writer with exactly this test
 * (`mapLensOpensPanel`), with a comment explaining the hazard. One of the two
 * writers was guarded and one was not, and no test spanned them — so the flag is
 * now RECONCILED on the way out as well as guarded on the way in. A stale `true`
 * held over from a lens that had a subject cannot outlive the subject.
 *
 * IT IS NOT THE WHOLE ANSWER AND DOES NOT PRETEND TO BE. `Mindtree` can decline
 * to render a panel for reasons this hook cannot see — a workspace with no
 * tracks is one — so the page reconciles once more against the panel it actually
 * built. Two guards, because they answer two different questions: "is there a
 * subject" and "did anything get drawn".
 */
export function panelOpenFor(open: boolean, subject: PanelSubject): boolean {
  return open && subject.kind !== 'none'
}

/**
 * PICTURE OR LEDGER — THE LEDGER IS THE OPENING AT EVERY WIDTH, UNTIL THE READER
 * SAYS OTHERWISE.
 *
 * ⚠ WHY THE WIDTH NO LONGER APPEARS IN THIS FUNCTION AT ALL. It used to:
 *   `pinned ? stored === 'table' : compact`, so the ledger was the honest
 *   default on a 375px phone (a hundred and four organizations at roughly
 *   fourteen CSS pixels each is a smear of unlabelled specks) and the picture
 *   stayed the opening everywhere else. The owner has now said TWICE that the
 *   picture is in the way and the list is the readable one — on the desktop
 *   they actually work on, not only on the phone. A tidy tree of a whole
 *   workspace is a thing a reader chooses to look at; it is not an answer to
 *   "what is going on today", and it should not be what the screen opens with
 *   before anybody has asked for it. So the width stopped being the tiebreak:
 *   the unopinionated reader gets the ledger, and the picture is one press
 *   away.
 *
 * IT IS STILL A DEFAULT AND NOT AN OVERRIDE, and that half is unchanged and must
 * stay unchanged. `viewPinned` is false until the reader uses MapToolbar's
 * map⇄ledger switch; the moment they press it `setMindView` records the choice
 * (it is the only writer of the pin — store/mindtree.ts carries the argument in
 * full) and from then on THEIR answer wins, at every width and for good.
 * Silently ignoring an explicit press would be a worse defect than the one this
 * fixes.
 *
 * The pin exists because `view` alone cannot tell "never chose" from "chose the
 * picture" — both read `'map'`, and `DEFAULT_LENS` and `DEFAULT_PREFS.view` are
 * deliberately untouched by this change: the stage is DERIVED, so the opening
 * drawing moves without rewriting what a device has on disk.
 *
 * `board`, `numbers` and `portfolio` are not affected by any of it —
 * `stageWithTable` only ever answers `table` for the lenses whose stage is the
 * open tree, so those three follow their lens exactly as before.
 *
 * Exported as a function of plain values because vitest runs `environment:
 * 'node'`: a hook is not a thing this repo's suite can observe, which is the
 * same reason `panelSubjectFor` and `panelOpenFor` above are exported.
 */
export function stageForReader(lens: MapLens, view: MindtreeView, pinned: boolean): MapStage {
  return stageWithTable(lens, pinned ? view === 'table' : true)
}

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
  const storedPanelOpen = useMindPanelOpen()

  const stored = useMindView()
  const pinned = useMindViewPinned()
  const stage = stageForReader(lens, stored, pinned)

  /**
   * THE LEAF THE READER PICKED, which is not the world they are inside. Null is
   * the ordinary state: the panel then follows the drill-in exactly as it did
   * before an Organization could be selected at all.
   */
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)

  /**
   * THE DRILL-IN MOVED, SO THE SELECTION IS STALE — dropped in the render that
   * discovers it rather than in an effect, on the same argument the detent
   * adjustment below spells out: an effect lands one paint later, and that paint
   * shows the organization the reader has just dived away from, under the new
   * world's breadcrumb.
   *
   * `selected` is read from the local rather than from state so that the
   * discarded pass is already correct; React re-runs the component immediately
   * on a render-phase adjustment, and the ref is written first so the re-run
   * sees no change and stops.
   */
  const focusRef = useRef(focusNodeId)
  let selected = selectedNodeId
  if (focusRef.current !== focusNodeId) {
    focusRef.current = focusNodeId
    if (selectedNodeId !== null) {
      selected = null
      setSelectedNodeId(null)
    }
  }

  const subject = useMemo(
    () => panelSubjectFor(lens, selected, focusNodeId),
    [lens, selected, focusNodeId],
  )

  /**
   * THE FLAG, RECONCILED WITH WHAT IT IS ABOUT. See `panelOpenFor`: the stored
   * preference defaults to `true`, and a `none` subject means there is nothing
   * for it to be true OF. Derived rather than written back into the store,
   * deliberately — the reader's preference is "I like the panel open", and
   * standing on a lens that has no panel is not them changing their mind.
   */
  const panelOpen = panelOpenFor(storedPanelOpen, subject)

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

  /**
   * SHOW THIS LENS, ABOUT THIS NODE — the half both public setters share, and
   * the reason they can differ at all.
   *
   * `pick` is the leaf being selected, or null for "whatever the map is showing
   * me". It is taken as an argument rather than read from state because both
   * callers run inside the reader's tap, and state written in that tap is not
   * readable until the next render — the detent below would be computed from the
   * PREVIOUS subject, which is how a phone sheet opens at `peek` on an
   * Organization that wanted `half`.
   */
  const applyLens = useCallback(
    (next: MapLens, pick: string | null) => {
      setMindLens(next)
      const wanted = panelSubjectFor(next, pick, focusNodeId)
      /**
       * A CHIP MEANS "SHOW ME THIS", so it re-opens a dock the reader closed.
       * Closing the panel is how you give the picture the whole width; tapping a
       * lens is how you ask for the list back, and needing two taps for it would
       * put the day's most common act behind a disclosure.
       *
       * GUARDED ON THERE BEING SOMETHING TO SHOW, which useMapUrl's inbound
       * write has always been (`mapLensOpensPanel`) and this one was not. A lens
       * resolving to `none` — `shape` with no drill-in, which is the workspace's
       * own opening state — wrote "the panel is open" about a panel that renders
       * nothing, and Escape then had a rung to spend on it. See `panelOpenFor`.
       */
      if (wanted.kind !== 'none') setMindPanelOpen(true)
      // Set here as well as in the adjustment above, and it is not redundant:
      // this one runs inside the TAP, so the sheet opens at the right height
      // even for a chip whose subject kind does not change (branch → branch on
      // another node), where the adjustment has nothing to react to.
      setDetentState(phoneDetentFor(wanted))
    },
    [focusNodeId],
  )

  const setLens = useCallback(
    (next: MapLens) => {
      // A CHIP IS "SHOW ME THIS LENS, HERE". `here` is where the map is, so a
      // leaf picked earlier is dropped: a reader who taps `The shape` after
      // dismissing an organization is asking about the branch they are in, and
      // handing them the organization back would make the chip mean two things.
      setSelectedNodeId(null)
      applyLens(next, null)
      announce(t('mindtree.lensChanged', { label: t(LENS_KEY[next]) }))
    },
    [announce, applyLens],
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
   * Make this subject the panel's subject — the inverse of `panelSubjectFor`.
   *
   * `branch` REMEMBERS THE NODE AND KEEPS THE LENS THE READER IS IN, and it
   * still does not touch the focus. The drill-in belongs to `useMapFocus`;
   * writing it from here would give one concept two writers, which is how a
   * drill-in and a breadcrumb start disagreeing — and for the gesture this
   * exists to serve it would be actively wrong, because selecting an
   * Organization must leave the camera and the drawing exactly where they are.
   *
   * ── THE SIDEBAR FOLLOWS THE READER ─────────────────────────────────────
   *
   * It used to hardcode `applyLens('shape', …)`, which was right while `shape`
   * was the only lens with a branch panel. It is not any more: a tap on a
   * PORTFOLIO ROW opens that organization's panel, and throwing the reader onto
   * the map to see it would close the list they were reading — one tap to open a
   * row, then a chip and a scroll to get back to where they were. The lens is
   * kept whenever it is one that can ANSWER with a branch, which is asked
   * through `subjectForLens` rather than by listing the lenses: that keeps the
   * closed union the one place a panel kind is decided, and it means the arm
   * needs no edit when a seventh lens with a branch panel arrives.
   *
   * `shape` IS STILL THE FALLBACK, and it has to be. `needs-me`, `what-changed`,
   * `numbers` and `by-status` all answer something other than `branch`, so a row
   * or node tap arriving under one of them has asked for a panel that lens
   * cannot show — and `shape` is the lens whose whole subject is "this branch".
   *
   * IT IS THE ONE CASE THAT DOES NOT ANNOUNCE, and that is not an omission. Its
   * only caller is the Organization tap, which holds the node's LABEL; this hook
   * holds nothing but an id. "Now showing The shape" is what the lens sentence
   * would say to a reader who just opened one organization's details, and it is
   * both false and useless. The caller names the node instead — one act, one
   * sentence.
   */
  const setSubject = useCallback(
    (next: PanelSubject) => {
      switch (next.kind) {
        case 'none':
          setSelectedNodeId(null)
          setMindPanelOpen(false)
          announce(t('mindtree.panelHidden'))
          return
        case 'needsMe':
          setLens('needs-me')
          return
        case 'branch':
          setSelectedNodeId(next.nodeId)
          applyLens(subjectForLens(lens, next.nodeId).kind === 'branch' ? lens : 'shape', next.nodeId)
          return
        case 'changes':
          setLens('what-changed')
          return
        case 'numbers':
          setLens('numbers')
          return
      }
    },
    [announce, applyLens, lens, setLens],
  )

  const setPanelOpen = useCallback(
    (open: boolean) => {
      // DISMISSING THE SIDEBAR DISMISSES ITS SUBJECT. Escape and the close
      // button are how a reader says "not this one"; leaving the pick behind
      // would make the next `The shape` chip re-open the organization they just
      // closed instead of the branch they are standing in.
      if (!open) setSelectedNodeId(null)
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
