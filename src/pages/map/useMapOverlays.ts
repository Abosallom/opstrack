// THE OVERLAYS — the two panels this screen raises over the drawing, the
// context every action decision is made against, and the anchor the hover card
// is positioned from.
//
// Extracted from pages/Mindtree.tsx unchanged.
//
// OVERLAY ANCHORING IS FROZEN AT GESTURE TIME, and that is a known bound rather
// than an oversight: `menuAt`/`addAt` hold CLIENT pixel coordinates captured
// when the panel opened, and the panel does not follow its node if the map pans,
// zooms or relayouts underneath it. It is survivable today only because both
// components dismiss on outside pointerdown. Anything that keeps an overlay open
// across a relayout has to re-derive the anchor from `layout.byId` instead.

import { useCallback, useMemo, useState } from 'react'
import type { MutableRefObject } from 'react'
import { canNudge, askOffer, outstandingAsk } from '../../components/entry/NudgeButton'
import type { MindMenuChoice, MindMenuChoices } from '../../components/mindtree/NodeMenu'
import type { QuickAddMode } from '../../components/mindtree/QuickAdd'
import { t } from '../../lib/i18n'
import type { MindActionCtx, MindNudgeVerdict } from '../../lib/mindtree/actions'
import { NO_VALUE, NAME_PREFIX } from '../../lib/mindtree/dropRules'
import { trailTo } from '../../lib/mindtree/focus'
import type { DrawnLayout, PositionedNode } from '../../lib/mindtree/layout'
import type {
  MindDimension,
  MindNode as MindNodeModel,
  MindVocabOption,
} from '../../lib/mindtree/model'
import { readLocalAsk } from '../../store/nudges'
import { useHasPerm } from '../../store/auth'
import { memberLabel, type Member } from '../../store/members'
import type { Entry, UserRole } from '../../types'
import type { Box } from './useMapViewport'

export interface MapOverlaysOptions {
  tree: MindNodeModel
  layout: DrawnLayout<MindNodeModel>
  nodeRefs: MutableRefObject<Map<string, SVGGElement>>
  rtl: boolean
  locale: string
  meId: string | null
  role: UserRole
  entryById: ReadonlyMap<string, Entry>
  entries: readonly Entry[]
  members: readonly Member[]
  memberById: ReadonlyMap<string, Member>
  selection: ReadonlySet<string>
  dimension: MindDimension
  focusedId: string | null
  statusVocab: readonly MindVocabOption[]
  priorityVocab: readonly MindVocabOption[]
  hoveredId: string | null
  treeFocused: boolean
  cursorId: string | null
  box: Box
  viewWidth: number
  viewHeight: number
  centerX: number
  centerY: number
}

export function useMapOverlays({
  tree,
  layout,
  nodeRefs,
  rtl,
  locale,
  meId,
  role,
  entryById,
  entries,
  members,
  memberById,
  selection,
  dimension,
  focusedId,
  statusVocab,
  priorityVocab,
  hoveredId,
  treeFocused,
  cursorId,
  box,
  viewWidth,
  viewHeight,
  centerX,
  centerY,
}: MapOverlaysOptions) {
  /** The open node menu — its path is a memo slice, so the component's memo holds. */
  const [menuAt, setMenuAt] = useState<{ nodeId: string; x: number; y: number } | null>(null)
  /**
   * The open quick-add form, same shape and the same reference discipline —
   * plus WHICH THING IS BEING NAMED.
   *
   * `mode` is carried because it cannot be inferred: the same Organization
   * offers both `addHere` (an item filed on it) and `addBranch` (a child branch
   * under it), and the path is identical for the two. The menu row the reader
   * pressed is the only thing that knows which they meant.
   */
  const [addAt, setAddAt] = useState<{
    nodeId: string
    x: number
    y: number
    mode: QuickAddMode
  } | null>(null)

  /**
   * The nudge verdict, SUPPLIED rather than computed by `lib/mindtree/actions`.
   *
   * That module's header says why it cannot work this out for itself: `canNudge`
   * / `outstandingAsk` / `askOffer` are documented in
   * components/entry/NudgeButton.tsx as "PURE, EXPORTED, AND THE ONLY
   * DEFINITION", and `src/lib/**` may import neither a component nor a store.
   * The screen already holds all three, so the screen answers.
   *
   * `readLocalAsk` and not `useLocalAsk`: this is a plain function called once
   * per row while a menu is being built, and a hook cannot be called in a loop.
   * The cost is that an ask made in this session while the menu is ALREADY open
   * does not re-grey the row — which cannot happen, because sending one closes
   * the menu.
   */
  const nudgeVerdict = useCallback(
    (entry: Entry): MindNudgeVerdict => {
      // Unassigned, or already yours. `actions.ts`'s own WHY_NO_NUDGE says
      // exactly that, so `null` accepts it rather than restating it here.
      if (!canNudge(entry, meId)) return { offer: null, blockedKey: null }
      const offer = askOffer(outstandingAsk(entry, readLocalAsk(entry.id)))
      // Inside the 24-hour window migration 0019 enforces. The generic sentence
      // would be wrong — there IS somebody to ask — so the precise one is named.
      return { offer, blockedKey: offer === null ? 'nudge.errTooSoon' : null }
    },
    [meId],
  )

  /**
   * May this reader SHAPE the hierarchy — the grant that decides whether the two
   * structural verbs appear on a branch at all.
   *
   * READ HERE rather than inside `lib/mindtree/actions.ts` because that module
   * may not import a store; the same reason `nudgeVerdict` above is supplied
   * rather than computed. A page hook is exactly where a store may be read.
   */
  const canEditStructure = useHasPerm('structure.edit')

  /**
   * The context every action decision is made against — the node menu's, and the
   * keyboard's refusal sentences.
   *
   * MEMOISED BECAUSE `NodeMenu` REQUIRES IT TO BE: its props say `ctx` must be
   * reference-stable while the menu is open, since it keys the memo that builds
   * the rows. Everything in it is either a store value or a stable callback, so
   * it changes when the workspace does and not when the pointer moves.
   */
  const mindCtx = useMemo<MindActionCtx>(
    () => ({
      meId,
      role,
      entryById,
      selection,
      dimension,
      focusedId,
      nudge: nudgeVerdict,
      canEditStructure,
    }),
    [meId, role, entryById, selection, dimension, focusedId, nudgeVerdict, canEditStructure],
  )

  /**
   * Open the actions menu on a node.
   *
   * The pointer path passes the gesture's own client coordinates; the KEYBOARD
   * path has none, so it hangs the panel off the node's own box — the corner a
   * click on that card would have landed near. `menuPlacement` flips and clamps
   * from there, so a node at the block-end edge still gets a panel on screen.
   *
   * DECLARED BEFORE THE DRAG CONTROLLER, not beside the other menu code, because
   * the layer takes it as an option: a hold on a phone, where there is nowhere
   * to drop, opens this instead of lifting a ghost.
   */
  const openMenuFor = useCallback(
    (pos: PositionedNode<MindNodeModel>, at?: { x: number; y: number }) => {
      if (at !== undefined) {
        setMenuAt({ nodeId: pos.id, x: at.x, y: at.y })
        return
      }
      const rect = nodeRefs.current.get(pos.id)?.getBoundingClientRect()
      setMenuAt({
        nodeId: pos.id,
        x: rect === undefined ? 0 : rtl ? rect.right : rect.left,
        y: rect === undefined ? 0 : rect.bottom,
      })
    },
    [rtl, nodeRefs],
  )

  /**
   * The root-to-node path for the open menu, and for the open quick-add.
   *
   * MEMOISED ON THE NODE ID, because both components require a reference-stable
   * `path` while they are open — it keys the memo that builds their rows, and a
   * fresh array on every render would rebuild every row and re-register the
   * Escape handler on every frame of a pan. `trailTo` walks the WHOLE tree, not the
   * drawn subtree, because an act on a group means the intersection of it and
   * its ancestors and the drill-in root would drop the track.
   */
  const menuPath = useMemo(
    () => (menuAt === null ? null : trailTo(tree, menuAt.nodeId)),
    [tree, menuAt],
  )
  const addPath = useMemo(() => (addAt === null ? null : trailTo(tree, addAt.nodeId)), [tree, addAt])

  /**
   * The values each sub-menu offers, with the bucket key `model.ts` spells.
   *
   * Built here rather than read inside NodeMenu for the reason that component's
   * props give: this page already holds both stores and already resolves their
   * labels, and a menu that subscribed itself would re-render under the reader's
   * finger on any roster change.
   *
   * RETIRED OPTIONS ARE INCLUDED AND MARKED. `useVocabAll` is what the tree is
   * built from, so an entry still holding a hidden status has a branch — and a
   * menu that omitted the value would offer no way to see, or leave, the bucket
   * the map is drawing. `dropRules` refuses to MOVE work into one; the menu says
   * so rather than pretending it does not exist.
   */
  const menuChoices = useMemo<MindMenuChoices>(() => {
    const owner: MindMenuChoice[] = [
      { value: NO_VALUE, label: t('entry.unassigned') },
      ...members.map((m) => ({ value: m.id, label: memberLabel(memberById, m.id, null) })),
    ]
    // An owner the roster has forgotten but the work still names — model.ts
    // buckets those under `name:<text>`, so the menu can offer them back.
    const freeNames = new Set<string>()
    for (const entry of entries) {
      const name = (entry.owner_name ?? '').trim()
      if (entry.owner_id === null && name !== '') freeNames.add(name)
    }
    for (const name of [...freeNames].sort((a, b) => a.localeCompare(b, locale))) {
      owner.push({ value: `${NAME_PREFIX}${name}`, label: name, retired: true })
    }
    // `o.label` is already resolved for the live locale — `useVocabAll` builds
    // its items through the store's own resolver, so calling `vocabLabelOf` here
    // would be the same lookup done twice.
    const toChoice = (o: MindVocabOption): MindMenuChoice => ({
      value: o.key,
      label: o.label,
      retired: o.hidden ? true : undefined,
    })
    return {
      owner,
      status: statusVocab.map(toChoice),
      priority: priorityVocab.map(toChoice),
    }
  }, [members, memberById, entries, locale, statusVocab, priorityVocab])

  /* ── the hover card ───────────────────────────────────────────────────── */

  /**
   * Which node the card describes: the POINTER's node, or the keyboard's — but
   * the keyboard's ONLY WHILE THE TREE ACTUALLY HAS FOCUS.
   *
   * That last clause is the whole rule and it was learned the hard way. `activeId`
   * is the roving tab stop, which is never null: it falls back to the first node
   * so that a Tab into the map always lands somewhere. Keying the card on it
   * directly put a card on the root node on FIRST PAINT, covering the middle of a
   * map nobody had touched yet. A roving tabindex means "this is where focus
   * would go", not "this is where focus is".
   *
   * So the card follows real attention: `hoveredId` for a pointer, and the cursor
   * only once `focusin` has actually fired inside the drawing. Hover wins over
   * focus when both are live, because a pointer is a deliberate momentary
   * question and the cursor is a persistent place.
   */
  const cardPos = useMemo(() => {
    const id = hoveredId ?? (treeFocused ? cursorId : null)
    if (id === null) return null
    return layout.byId.get(id) ?? null
  }, [hoveredId, treeFocused, cursorId, layout])

  /**
   * The node's box in CSS pixels, relative to the canvas — the space the card is
   * positioned in.
   *
   * `preserveAspectRatio="xMidYMid meet"` is honoured explicitly rather than
   * assumed away: the effective scale is the MIN of the two ratios and the
   * remainder is split as a centring offset. The two ratios agree here to within
   * one drawing unit (`fitToViewBox` derives the box from the measured viewport),
   * but writing the general form costs two lines and means a card cannot drift
   * off its node in the one frame between a resize and the ResizeObserver.
   */
  const cardAnchor = useMemo(() => {
    if (cardPos === null || box.width <= 0 || box.height <= 0) return null
    if (viewWidth <= 0 || viewHeight <= 0) return null
    const scale = Math.min(box.width / viewWidth, box.height / viewHeight)
    const offX = (box.width - viewWidth * scale) / 2
    const offY = (box.height - viewHeight * scale) / 2
    const viewX = centerX - viewWidth / 2
    const viewY = centerY - viewHeight / 2
    return {
      x: offX + (cardPos.x - viewX) * scale,
      y: offY + (cardPos.y - viewY) * scale,
      width: cardPos.width * scale,
      height: cardPos.height * scale,
    }
  }, [cardPos, box, viewWidth, viewHeight, centerX, centerY])

  return {
    menuAt,
    setMenuAt,
    addAt,
    setAddAt,
    openMenuFor,
    menuPath,
    addPath,
    mindCtx,
    menuChoices,
    cardPos,
    cardAnchor,
  }
}

export type MapOverlays = ReturnType<typeof useMapOverlays>
