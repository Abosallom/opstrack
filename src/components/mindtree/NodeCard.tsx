// The node card — what a branch or a leaf is, in one glance, without opening it.
//
// The map answers WHERE the mass is. It cannot answer "and what exactly is in
// there", because the whole reason it reads at a glance is that a node carries
// two facts and nothing else (size for count, a mark for the breach —
// MINDTREE-SPEC's budget, and mindtree.css's header defends it in ratios). The
// third, fourth and fifth facts have to live somewhere that is NOT on the mark,
// and this is that somewhere: hover a branch and you learn how much of it is
// unclaimed, what has been sitting there longest, and who is carrying it; hover
// a leaf and you learn its status, its owner, when it is due, how old it is, and
// when anyone last touched it. That is the difference between a picture you look
// at and a screen you redistribute a week of work from.
//
// ── FIVE RULES, AND EVERY ONE OF THEM IS A BUG THAT WAS AVOIDED ────────────
//
//  1. IT NEVER COVERS THE NODE IT DESCRIBES. A card that lands on its own
//     subject is worse than no card: the reader loses the thing they were
//     pointing at, and on a pointer device the cover-up instantly triggers
//     `pointerleave` on the node, which unmounts the card, which un-covers the
//     node, which re-enters it — a flicker loop, at frame rate. The placement
//     below is therefore not "beside if possible": the card is pinned FLUSH
//     against one edge of the node's own rectangle and its block-size is capped
//     to the room on that side (`--mtree-card-room`), so overlap is
//     arithmetically impossible rather than merely unlikely.
//
//  2. IT NEVER TAKES THE POINTER. `pointer-events: none` in the sheet, always.
//     The map is a pan-and-pinch surface (`touch-action: none` on the canvas),
//     so a card that swallowed a pointerdown would eat the start of a pan that
//     happened to begin over it — and a control inside it would need a hover
//     tunnel from the node to the card, which is a trap on a surface the reader
//     is dragging. ACTIONS DO NOT LIVE HERE; they live in the node menu that
//     lib/mindtree/actions.ts computes. This is a read.
//
//  3. IT APPEARS ON FOCUS, NOT ONLY ON HOVER. A keyboard reader walking the
//     tree with the arrow keys is doing exactly what a mouse reader does with
//     the pointer, and the two must learn the same things. The page decides
//     which node is "current" (hovered OR focused) and renders one card for it;
//     nothing in this file knows which of the two got it there, which is what
//     makes the parity structural rather than remembered.
//
//  4. IT IS DISMISSIBLE, AND IT COMES BACK. Escape hides it WITHOUT moving the
//     pointer or the focus, and it reappears when the reader moves to a
//     different node. The latch is therefore keyed on the node id
//     (`dismissedFor`), not on a boolean — a boolean would either suppress every
//     later card until something cleared it, or clear itself on a re-render and
//     make Escape look broken.
//
//     WHERE THIS SITS AGAINST WCAG 2.1 SC 1.4.13, stated exactly rather than
//     claimed loosely. Of the criterion's three clauses this card meets two and
//     KNOWINGLY DOES NOT MEET THE THIRD:
//
//       · Dismissable — met, by the Escape latch above.
//       · Persistent — met: nothing hides the card on a timer; it goes when the
//         reader moves away, focuses elsewhere, or starts a drag.
//       · Hoverable — NOT MET on the pointer path. The card is
//         `pointer-events: none` (rule 2) and sits GAP_PX clear of the node, so
//         moving the pointer toward it fires `pointerleave` on the node and the
//         card goes. There is no version of this that also keeps rules 1 and 2:
//         a hoverable card on a `touch-action: none` pan-and-pinch canvas either
//         eats the pointerdown that starts a pan, or — if it does not — covers
//         the node, unmounts itself, uncovers the node and re-enters it at frame
//         rate. node-card.css states that loop at the `pointer-events` line.
//
//     WHAT MAKES THAT AN ACCEPTABLE TRADE RATHER THAN A HOLE: nothing on this
//     card is only on this card. Every fact in it is in the node's own
//     `aria-label`/`aria-describedby` sentence, in the table view, and in the
//     entry sheet a tap or Enter opens — and the FOCUS path has no such problem
//     at all, because a focused card persists until focus moves and needs no
//     hover tunnel. A magnifier user who cannot reach the card can reach all of
//     it by pressing Enter. The gap is real, it is one clause wide, and it is
//     recorded in docs/MINDTREE-INTERACTIVE-HANDOFF.md rather than papered over
//     here with a conformance claim this file does not earn.
//
//  5. A DRAG CANCELS IT OUTRIGHT. `dragging` is a prop rather than a rule the
//     page is asked to remember, so "the card cannot be in the way of a drop"
//     is enforced in this file. It also resets the delay: releasing a drag over
//     a node must not pop a card that was mid-timer when the finger went down.
//
// ── DELAY IN, NONE OUT ─────────────────────────────────────────────────────
//
// `NODE_CARD_DELAY_MS` is measured against the gesture, not chosen for feel. The
// canvas is a pan surface, so the pointer crosses nodes in TRANSIT constantly; a
// card that appeared instantly would strobe across a sweep. A node is ~150 CSS
// px on the inline axis and an unhurried mouse sweep is ~1000 px/s, so a node in
// transit is under the pointer for ~150 ms. 250 ms clears that with margin and
// is still under the ~300 ms at which a reader starts to think nothing happened.
// There is no delay OUT at all: the page stops rendering the card and it is
// gone, because a lingering card over a map the reader has moved on from is a
// stale fact sitting on top of a live one.
//
// The delay is per MOUNT, not per node: once a card is up, moving along a row of
// branches swaps its contents instantly. That is the behaviour of every tooltip
// a reader has met, and it falls out for free from the page unmounting the
// component only when nothing at all is hovered or focused.
//
// ── PURE GIVEN THE ACTIVE LOCALE ───────────────────────────────────────────
//
// `buildNodeCard` is the whole feature and it is a plain function of its
// arguments — no store read, no ref, no DOM. Everything it needs arrives as
// data, exactly as MindtreeTable.buildTableRows does, and for the same reason:
// the arithmetic (which entries, whose, how old) is what can silently go wrong,
// and it is asserted in a `node` environment with no mock in sight. The
// component below it decides only WHERE the box goes.
//
// COLOUR: the card carries NO track hue, deliberately. mindtree.css resolves the
// `--track-c-*` pair on `.mtree-edge, .mtree-node` and nowhere else; adding a
// third selector here would put the same colour recipe in two sheets (§1.0.4's
// rule against exactly that) and would owe a fourth full-sRGB contrast sweep for
// text on a tinted panel. The card is a detail panel, not a mark on the map — it
// uses the neutral elevated surface every other panel in the app uses.

import { useEffect, useMemo, useState, type CSSProperties, type ReactElement } from 'react'
import { isolate } from '../../lib/bidi'
import {
  diffDays,
  formatAge,
  formatDue,
  formatRelativeTime,
  instantToIsoDate,
  type IsoDate,
} from '../../lib/dates'
import { t, useLocale, type Locale } from '../../lib/i18n'
import { normalizeSearch } from '../../lib/text'
import { pushOverlay } from '../../lib/overlayStack'
import type { MindDimension, MindLabel, MindNode } from '../../lib/mindtree/model'
import { memberLabel } from '../../store/members'
import type { Member } from '../../api/members'
import type { Entry, VocabKind } from '../../types'
import './node-card.css'

/* ────────────────────────────── the constants ────────────────────────────── */

/**
 * The card's DOM id, so the page can point the focused treeitem's
 * `aria-describedby` at it.
 *
 * A single stable id rather than a generated one, because there is exactly one
 * card on the screen at a time by construction (the page renders one node's
 * worth) and a `useId` would hand the page a value it has to thread back down
 * into a component it does not own. A dangling idref — the card is not shown —
 * is ignored by every engine, which is precisely the behaviour wanted here.
 */
export const NODE_CARD_ID = 'mtree-node-card'

/** See the header. Exported so a page test can wait the same number it renders. */
export const NODE_CARD_DELAY_MS = 250

/** Space between the node's edge and the card. On the 4px grid. */
const GAP_PX = 8

/** Space kept between the card and the canvas edge. */
const EDGE_PX = 8

/**
 * The card's inline size, in CSS pixels.
 *
 * A NUMBER RATHER THAN A `max-inline-size`, because the placement arithmetic
 * below needs the box's inline extent to centre it on the node and clamp it
 * inside the canvas, and measuring the rendered element to find out would put a
 * layout read on the hover path and a frame of wrong position on the screen.
 * 276 is ~46ch at the 12.5px face this sheet uses — long enough for a two-line
 * entry title, short enough to sit beside a node on a 375px canvas.
 */
const CARD_W_PX = 276

/**
 * Below this, there is nowhere to put the card and it is not drawn.
 *
 * Reached only when the node very nearly fills the canvas — a single-track
 * workspace zoomed all the way in. Two rows of content is the least that says
 * anything; a 40px sliver of a card is worse than the absence of one.
 */
const MIN_ROOM_PX = 96

/** How many owners a branch card names before the tail becomes a count. */
const OWNER_LIMIT = 3

/** The "no owner" bucket. Mirrors model.ts's NO_VALUE and Board's. */
const NO_VALUE = ''

/** Free-text owner prefix. Mirrors model.ts's NAME_PREFIX and Board's. */
const NAME_PREFIX = 'name:'

/* ──────────────────────────────── the model ──────────────────────────────── */

/** A number the card puts in front of a word — open, unassigned, breached. */
export interface NodeCardStat {
  /** The i18n key of the word under the number. Written as a literal at the
   *  call site so lib/localeReach.test.ts can see it. */
  labelKey: string
  value: number
  /** `warn` is work nobody owns; `bad` is work past its deadline. */
  tone: 'plain' | 'warn' | 'bad'
}

/** One person (or vendor) and how much of this branch they are holding. */
export interface NodeCardOwner {
  /** The bucket key — a member id, or `name:Acme`. Unique, so it keys a list. */
  key: string
  /** Already resolved; NEVER isolated here — the renderer isolates for display. */
  name: string
  count: number
}

/** A term and its value: the leaf card's five rows, and the branch's oldest. */
export interface NodeCardRow {
  /** Unique within the card — the React key and nothing else. */
  key: string
  term: string
  value: string
  /** A trailing number set apart from the value: an age, a count. */
  suffix: string | null
  tone: 'plain' | 'warn' | 'bad'
}

/**
 * Everything the card draws, resolved.
 *
 * ONE SHAPE FOR BOTH KINDS rather than a discriminated union, because the two
 * differ by which fields are populated and not by which fields exist: a branch
 * has stats and owners and no rows-with-terms beyond `oldest`; a leaf has rows
 * and neither. A union would make the renderer branch twice — once on the kind,
 * once on each optional — for no safety the emptiness checks do not already give.
 */
export interface NodeCardModel {
  kind: 'branch' | 'leaf'
  /** The node's own label, RAW. The renderer isolates it for display. */
  title: string
  /** An archived track or a hidden vocabulary option that still holds work. */
  retired: boolean
  /** An active track with nothing open on it — the card says "All clear". */
  empty: boolean
  /** Something at or under this node is past its service deadline. */
  breached: boolean
  stats: readonly NodeCardStat[]
  rows: readonly NodeCardRow[]
  owners: readonly NodeCardOwner[]
  /** Owners beyond `OWNER_LIMIT`, as a count. 0 when the list is complete. */
  moreOwners: number
}

/**
 * What `buildNodeCard` needs and cannot know.
 *
 * `today` and `now` are BOTH here and they are not redundant: `today` is the
 * page's `useFilterContext().today` — the workspace's day, which every age in
 * this app is measured against — and `now` is the instant `formatRelativeTime`
 * needs to say "3 h ago". Passing them keeps this function clockless and its
 * assertions arithmetic.
 */
export interface NodeCardContext {
  entryById: ReadonlyMap<string, Entry>
  memberById: ReadonlyMap<string, Member>
  /** `useVocabLabel()` — memoised by the store, so it is a stable reference. */
  vocabLabel: (kind: VocabKind, key: string) => string
  /** The active ring-2 axis. Only used to suppress a redundant row — see below. */
  dimension: MindDimension
  today: IsoDate
  locale: Locale
  now: Date
}

/**
 * A node's label as text.
 *
 * The `key` variant goes through t(); the `text` variant is database text and
 * must NOT — model.ts's MindLabel header explains why the union is discriminated
 * (t() echoes an unknown key, so an Arabic track name handed to it renders as
 * itself and hides the bug in the one language where it matters most).
 */
function labelText(label: MindLabel): string {
  const raw = label.kind === 'key' ? t(label.key, label.vars) : label.text
  const trimmed = raw.trim()
  return trimmed === '' ? t('mindtree.untitled') : trimmed
}

/** True when nothing and nobody owns this row. Mirrors entryFilter's hasOwner. */
function isUnassigned(entry: Entry): boolean {
  return entry.owner_id === null && (entry.owner_name ?? '').trim() === ''
}

/** Which owner bucket a row lands in. Mirrors model.ts's `ownerBucket`. */
function ownerBucket(entry: Entry): string {
  if (entry.owner_id !== null) return entry.owner_id
  const name = (entry.owner_name ?? '').trim()
  return name === '' ? NO_VALUE : NAME_PREFIX + name
}

interface Walked {
  unassigned: number
  breached: number
  /** The entry raised longest ago, by `created_at`. */
  oldest: { title: string; days: number } | null
  /** Bucket key → how many rows it holds. Unassigned is NOT in here. */
  owners: Map<string, number>
}

/**
 * Every entry under a node, totalled in one pass.
 *
 * WALKS `children`, NOT `visibleChildren` — a collapsed branch and an unopened
 * "+N more" are still under this node, and a card whose numbers changed when the
 * reader clicked a chevron would be describing the picture rather than the work.
 * MindtreeTable's `collectStats` holds the same contract for the same reason.
 *
 * THE BREACH IS READ OFF THE LEAF NODE (`health.slaBreached`) rather than out of
 * a health map passed in beside it. model.ts already resolved it there, and the
 * map, the table and this card reading it from three places is how three numbers
 * on one screen come to disagree about one item.
 *
 * AGE IS MEASURED FROM `created_at`, matching MindtreeTable and the dashboard's
 * `ageDescCreated`. Not from `last_activity_at`: that is SILENCE, which
 * lib/health.ts keeps as a separate question, and an item chased daily for a
 * month is not young.
 */
function walk(node: MindNode, ctx: NodeCardContext, out: Walked): void {
  if (node.kind === 'entry') {
    if (node.health.slaBreached) out.breached += 1
    const entry = node.entryId === null ? undefined : ctx.entryById.get(node.entryId)
    // An id the working set no longer explains contributes nothing rather than
    // throwing: the only way it happens is a tree built from rows that have
    // since been pruned mid-render, and that must cost this row its facts, not
    // the whole card.
    if (entry === undefined) return
    if (isUnassigned(entry)) out.unassigned += 1
    else {
      const key = ownerBucket(entry)
      out.owners.set(key, (out.owners.get(key) ?? 0) + 1)
    }
    const days = Math.max(0, diffDays(instantToIsoDate(entry.created_at), ctx.today))
    if (out.oldest === null || days > out.oldest.days) {
      out.oldest = { title: entry.title.trim() === '' ? t('mindtree.untitled') : entry.title, days }
    }
    return
  }
  for (const child of node.children) walk(child, ctx, out)
}

/**
 * The owner tally, biggest first.
 *
 * TOTAL ORDER, like every other ranking in this feature: ties break on the
 * FOLDED name and then on the raw key, never on `localeCompare`, which is
 * host-dependent and would rank two people differently in the test runner and
 * the browser (model.ts's `ownerGroups` and entryFilter's title sort take the
 * same line). Without the tiebreak two people holding four items each swap
 * places between renders, and a card that reshuffles under a stationary pointer
 * reads as broken.
 */
function rankOwners(
  tally: ReadonlyMap<string, number>,
  memberById: ReadonlyMap<string, Member>,
): NodeCardOwner[] {
  const rows: NodeCardOwner[] = []
  for (const [key, count] of tally) {
    const name = key.startsWith(NAME_PREFIX)
      ? key.slice(NAME_PREFIX.length)
      : memberLabel(memberById, key, null)
    rows.push({ key, name, count })
  }
  rows.sort((a, b) => {
    if (b.count !== a.count) return b.count - a.count
    const x = normalizeSearch(a.name)
    const y = normalizeSearch(b.name)
    if (x !== y) return x < y ? -1 : 1
    return a.key < b.key ? -1 : a.key > b.key ? 1 : 0
  })
  return rows
}

/**
 * The card's content for one node. PURE given the active locale.
 *
 * Exported and asserted directly, which is the reason it is a function rather
 * than a body of JSX: the numbers are what can silently be wrong, and they are
 * checkable without rendering anything.
 */
export function buildNodeCard(node: MindNode, ctx: NodeCardContext): NodeCardModel {
  const title = labelText(node.label)

  if (node.kind === 'entry') {
    const entry = node.entryId === null ? undefined : ctx.entryById.get(node.entryId)
    const rows: NodeCardRow[] = []
    if (entry !== undefined) {
      // Straight off the live vocabulary, so an admin's rename reaches this
      // sentence with no write here at all — the frozen-key payoff store/vocab.ts
      // was built for.
      rows.push({
        key: 'status',
        term: t('entry.status'),
        value: ctx.vocabLabel('status', entry.status),
        suffix: null,
        tone: 'plain',
      })
      rows.push({
        key: 'owner',
        term: t('entry.owner'),
        value: isUnassigned(entry)
          ? t('entry.unassigned')
          : memberLabel(ctx.memberById, entry.owner_id, entry.owner_name),
        suffix: null,
        tone: isUnassigned(entry) ? 'warn' : 'plain',
      })
      const overdue = entry.due_date !== null && diffDays(ctx.today, entry.due_date) < 0
      rows.push({
        key: 'due',
        term: t('entry.due'),
        value: entry.due_date === null ? t('entry.noDueDate') : formatDue(entry.due_date, ctx.locale, ctx.now),
        suffix: null,
        tone: overdue ? 'bad' : 'plain',
      })
      rows.push({
        key: 'age',
        term: t('entry.age'),
        value: formatAge(
          Math.max(0, diffDays(instantToIsoDate(entry.created_at), ctx.today)),
          ctx.locale,
        ),
        suffix: null,
        tone: 'plain',
      })
      // LAST, and it is the row this card exists for as much as any other: "who
      // has gone quiet" is the question an ops lead is actually asking when they
      // hover an item they did not raise.
      rows.push({
        key: 'activity',
        term: t('mindtree.cardLastUpdate'),
        value: formatRelativeTime(entry.last_activity_at, ctx.locale, ctx.now),
        suffix: null,
        tone: 'plain',
      })
    }
    return {
      kind: 'leaf',
      title: entry === undefined || entry.title.trim() === '' ? title : entry.title,
      retired: node.retired,
      empty: false,
      breached: node.health.slaBreached,
      stats: [],
      rows,
      owners: [],
      moreOwners: 0,
    }
  }

  const found: Walked = { unassigned: 0, breached: 0, oldest: null, owners: new Map() }
  walk(node, ctx, found)

  const stats: NodeCardStat[] = [
    { labelKey: 'mindtree.colOpen', value: node.count, tone: 'plain' },
    {
      labelKey: 'mindtree.colUnassigned',
      value: found.unassigned,
      tone: found.unassigned > 0 ? 'warn' : 'plain',
    },
    {
      labelKey: 'mindtree.colBreached',
      value: found.breached,
      tone: found.breached > 0 ? 'bad' : 'plain',
    },
  ]

  const rows: NodeCardRow[] = []
  if (found.oldest !== null) {
    rows.push({
      key: 'oldest',
      term: t('mindtree.cardOldest'),
      value: found.oldest.title,
      suffix: formatAge(found.oldest.days, ctx.locale),
      // Not toned: an old item is a fact, not a failure. The breach is what the
      // map already marks in red, and spending the same colour on age would make
      // the two impossible to tell apart at a glance.
      tone: 'plain',
    })
  }

  // A GROUP UNDER THE OWNER AXIS IS ONE PERSON, so listing "who is carrying it"
  // there would restate the node's own label as a one-row table. Every other
  // combination is worth drawing: a track holds many owners whatever the axis
  // is, and a status or priority group holds many owners too.
  const redundant = ctx.dimension === 'owner' && node.kind === 'group'
  const ranked = redundant ? [] : rankOwners(found.owners, ctx.memberById)

  return {
    kind: 'branch',
    title,
    retired: node.retired,
    empty: node.count === 0,
    breached: node.health.slaBreached,
    stats,
    rows,
    owners: ranked.slice(0, OWNER_LIMIT),
    moreOwners: Math.max(0, ranked.length - OWNER_LIMIT),
  }
}

/* ─────────────────────────────── the placement ───────────────────────────── */

/**
 * The node's rectangle, in CSS pixels relative to the canvas box.
 *
 * PHYSICAL, not logical, and that is the same carve-out mindtree.css's header
 * states for the drawing itself: lib/mindtree/layout.ts mirrors the whole map by
 * ARITHMETIC for RTL rather than letting `dir` do it, so a node's x is already
 * the x it is painted at in both languages. A card placed from those numbers
 * must use the same coordinate space or it would mirror a second time and land
 * on the far side of the canvas in Arabic — the exact bug MindNode.tsx's header
 * records making with `text-anchor`.
 */
export interface NodeCardAnchor {
  x: number
  y: number
  width: number
  height: number
}

export interface NodeCardPlacement {
  /** Physical offset from the canvas's top-left corner. */
  x: number
  y: number
  /** `0%` (the card hangs down from y) or `-100%` (it hangs up from y). */
  flip: string
  /** The block room on the chosen side — the card's `max-block-size`. */
  room: number
  side: 'above' | 'below'
}

function clamp(value: number, min: number, max: number): number {
  // `max` first, so a canvas narrower than the card degrades to the start edge
  // rather than to a negative offset that would put it off screen entirely.
  return Math.max(min, Math.min(max, value))
}

/**
 * Where the card goes, decided by ARITHMETIC ALONE — no measurement, no second
 * layout pass, no frame of wrong position.
 *
 * That is the whole reason the block-size is capped rather than the box being
 * measured and clamped: the only unknown about the card is how tall it wants to
 * be, and `max-block-size` answers it in CSS at the moment it matters. Measuring
 * instead would mean rendering the card somewhere provisional, reading its
 * height, and moving it — a visible jump on the one component whose entire job
 * is to appear calmly beside something.
 *
 * THE SIDE WITH MORE ROOM WINS, ties to below (which is reading order, and the
 * side a pointer is usually travelling away from). The card is then flush
 * against the node's own edge, so it CANNOT overlap the node whatever it holds.
 */
export function placeNodeCard(
  anchor: NodeCardAnchor,
  canvas: { width: number; height: number },
): NodeCardPlacement | null {
  const roomBelow = canvas.height - (anchor.y + anchor.height) - GAP_PX - EDGE_PX
  const roomAbove = anchor.y - GAP_PX - EDGE_PX
  const below = roomBelow >= roomAbove
  const room = below ? roomBelow : roomAbove
  if (room < MIN_ROOM_PX) return null

  const centred = anchor.x + anchor.width / 2 - CARD_W_PX / 2
  return {
    x: clamp(centred, EDGE_PX, Math.max(EDGE_PX, canvas.width - CARD_W_PX - EDGE_PX)),
    y: below ? anchor.y + anchor.height + GAP_PX : anchor.y - GAP_PX,
    flip: below ? '0%' : '-100%',
    room,
    side: below ? 'below' : 'above',
  }
}

/* ────────────────────────────── the dismissal ────────────────────────────── */

/**
 * The open card's dismissal, for a keydown handler that runs BEFORE the
 * document listener the overlay stack owns.
 *
 * It exists because of an ordering fact rather than a design preference. React
 * attaches its listeners to the root container, which is strictly below
 * `document`, so pages/Mindtree.tsx's `onKeyDown` on the <svg> fires before
 * lib/overlayStack's document listener can. With focus on a treeitem — which is
 * exactly where it is when the card was raised BY that focus — the page's own
 * Escape (step out of the drill-in) would therefore always win, and the card
 * would be the one thing on the screen Escape could not close.
 *
 * So the page calls this first and yields if it returns true. Everywhere else —
 * focus in the toolbar, in the filter bar, nowhere at all — the overlay stack
 * handles it, which is what makes the card dismissible without the reader having
 * to move the pointer or the focus first (SC 1.4.13).
 *
 * A module-level handle rather than a store: there is exactly one card mounted
 * at a time by construction, it is never read during render, and
 * store/entrySheet's `getOpenEntryId` exists for the same reason — a key handler
 * outside the component tree needs an answer the component tree is not exporting.
 */
let openDismiss: (() => void) | null = null

export function dismissMindNodeCard(): boolean {
  if (openDismiss === null) return false
  openDismiss()
  return true
}

/* ───────────────────────────────── the card ──────────────────────────────── */

export interface NodeCardProps {
  /**
   * The node to describe — hovered OR focused, resolved by the page.
   *
   * The page renders this component only while there IS one, which is what makes
   * "no delay out" and "delay in on first appearance" fall out of mounting
   * rather than out of a second timer.
   */
  node: MindNode
  anchor: NodeCardAnchor
  /** The canvas box in CSS pixels — the page already measures it. */
  canvas: { width: number; height: number }
  /** A drag is in flight. The card is cancelled and its timer reset. */
  dragging: boolean
  entryById: ReadonlyMap<string, Entry>
  memberById: ReadonlyMap<string, Member>
  /** `useVocabLabel()` — memoised by the store, so it is a stable reference. */
  vocabLabel: (kind: VocabKind, key: string) => string
  dimension: MindDimension
  /** `useFilterContext().today` — the same day the table measures ages against. */
  today: IsoDate
}

/**
 * FLAT PROPS RATHER THAN THE `NodeCardContext` OBJECT, and the reason is the
 * memo below it.
 *
 * A single `ctx` prop would have to be memoised by the PAGE or `buildNodeCard`
 * would re-walk the subtree on every render — and the page re-renders on every
 * frame of a pan (`setPan`), which on a track branch holding three hundred
 * entries is a full subtree walk sixty times a second, for a card whose contents
 * did not change. Making the dependency list explicit here moves that guarantee
 * out of the integrator's memory and into this file.
 */
export default function NodeCard({
  node,
  anchor,
  canvas,
  dragging,
  entryById,
  memberById,
  vocabLabel,
  dimension,
  today,
}: NodeCardProps): ReactElement | null {
  const locale = useLocale()
  const [shown, setShown] = useState(false)
  /**
   * The clock, sampled ONCE per mount rather than taken as a prop.
   *
   * `formatRelativeTime` needs an instant and a card lives for seconds, so
   * re-reading the clock on every render would buy nothing and would bust the
   * memo below on every frame of a pan. The lazy initialiser is what keeps it
   * out of the render path on the renders that do not need it.
   */
  const [now] = useState(() => new Date())
  /**
   * The Escape latch, and the node it was set on — see rule 4 in the header.
   *
   * IT CLEARS WHEN THE TARGET CHANGES, which is the half of SC 1.4.13 that is
   * easy to miss: dismissing has to hide THIS card, not suppress the feature.
   * Adjusted DURING RENDER rather than in an effect, which is React's own
   * documented pattern for "reset some state when a prop changes" — an effect
   * would paint one frame of the stale latch first, so a reader who dismissed
   * one card and moved to the next would watch the next one flicker.
   *
   * A → B → A therefore shows A again: returning to a node is a new look at it,
   * and a latch that outlived the visit would read as the card being broken.
   */
  const [dismissed, setDismissed] = useState(false)
  const [latchedOn, setLatchedOn] = useState(node.id)
  if (latchedOn !== node.id) {
    setLatchedOn(node.id)
    setDismissed(false)
  }

  useEffect(() => {
    if (dragging) {
      // Not merely hidden: the timer restarts from zero when the drag ends, so
      // releasing over a node does not pop a card that was mid-delay when the
      // finger went down.
      setShown(false)
      return
    }
    const timer = window.setTimeout(() => setShown(true), NODE_CARD_DELAY_MS)
    return () => window.clearTimeout(timer)
  }, [dragging])

  const visible = shown && !dragging && !dismissed

  useEffect(() => {
    if (!visible) return
    const dismiss = (): void => setDismissed(true)
    openDismiss = dismiss
    const drop = pushOverlay(dismiss)
    return () => {
      // Only clear the handle if it is still OURS. A re-render that swaps the
      // node runs the new effect before this cleanup in StrictMode's double
      // invoke, and blindly nulling would leave the live card unreachable from
      // `dismissMindNodeCard`.
      if (openDismiss === dismiss) openDismiss = null
      drop()
    }
  }, [visible, node.id])

  const model = useMemo(
    () =>
      buildNodeCard(node, {
        entryById,
        memberById,
        vocabLabel,
        dimension,
        today,
        locale,
        now,
      }),
    // `locale` is a dependency whose USE the rule cannot see — every t() and
    // every format* call below reads lib/i18n's module-level current locale
    // rather than an argument. Without it here a language switch would leave the
    // card holding English. pages/Mindtree.tsx and MindtreeTable.tsx carry the
    // same dependency for the same reason.
    [node, entryById, memberById, vocabLabel, dimension, today, locale, now],
  )

  const placed = placeNodeCard(anchor, canvas)

  if (!visible || placed === null) return null

  const style = {
    '--mtree-card-x': `${placed.x}px`,
    '--mtree-card-y': `${placed.y}px`,
    '--mtree-card-flip': placed.flip,
    '--mtree-card-room': `${placed.room}px`,
    '--mtree-card-w': `${CARD_W_PX}px`,
  } as CSSProperties

  return (
    <div
      id={NODE_CARD_ID}
      className="mtree-card"
      // A tooltip rather than a dialog or a region: it describes the thing the
      // reader is pointing at, it takes no focus, and it holds no control. The
      // page points the focused treeitem's `aria-describedby` here; an
      // unreferenced tooltip is still read in DOM order by a virtual cursor, so
      // the facts are never locked behind wiring that might be forgotten.
      //
      // A <div> and not an <aside>: `aside` is a COMPLEMENTARY LANDMARK, and a
      // transient hover panel that comes and goes under the pointer would add
      // and remove a landmark from the page's landmark list several times a
      // minute. The role below is what this element is; the tag should not
      // quietly claim something else first.
      role="tooltip"
      data-side={placed.side}
      data-kind={model.kind}
      style={style}
    >
      <NodeCardBody model={model} />
    </div>
  )
}

/**
 * What the card SAYS, separated from where the card GOES.
 *
 * The split is not decoration. Everything above this line is timing, geometry
 * and an overlay registration — three things `environment: 'node'` cannot
 * observe, because react-dom/server runs no effects and the card is deliberately
 * absent from the first render. Everything below it is markup, and markup is
 * exactly what renderToStaticMarkup CAN see. Exporting the body is therefore the
 * difference between "the visual half is asserted" and "the visual half is
 * asserted by looking at it", and it is what lets the sheet be previewed
 * standalone in both themes and both directions without wiring the whole screen.
 *
 * It renders no wrapper of its own: the card's box, its placement custom
 * properties and its role belong to the component above, and a second div here
 * would put a layout box between the flex column and its children.
 */
export function NodeCardBody({ model }: { model: NodeCardModel }): ReactElement {
  return (
    <>
      <p className="mtree-card-title">
        {isolate(model.title)}
        {model.retired && <span className="mtree-card-tag">{t('mindtree.archived')}</span>}
      </p>

      {model.breached && <p className="mtree-card-breach">{t('entry.slaBreached')}</p>}

      {model.empty && <p className="mtree-card-quiet">{t('mindtree.branchEmpty')}</p>}

      {model.stats.length > 0 && (
        <ul className="mtree-card-stats">
          {model.stats.map((stat) => (
            <li key={stat.labelKey} className="mtree-card-stat" data-tone={stat.tone}>
              <span className="mtree-card-num tabular">{stat.value}</span>
              <span className="mtree-card-term">{t(stat.labelKey)}</span>
            </li>
          ))}
        </ul>
      )}

      {model.rows.length > 0 && (
        <dl className="mtree-card-rows">
          {model.rows.map((row) => (
            <div key={row.key} className="mtree-card-row">
              <dt className="mtree-card-dt">{row.term}</dt>
              <dd className="mtree-card-dd" data-tone={row.tone}>
                {/* Isolated per VALUE, not around the pair: the value is
                    database text (a title, a person, a vocabulary label an admin
                    typed) and the suffix is a formatted number, and a single
                    isolate around both would hand the number's direction to
                    whatever the value turned out to be. */}
                <span className="mtree-card-value">{isolate(row.value)}</span>
                {row.suffix !== null && (
                  <span className="mtree-card-suffix tabular">{row.suffix}</span>
                )}
              </dd>
            </div>
          ))}
        </dl>
      )}

      {model.owners.length > 0 && (
        <>
          <p className="mtree-card-heading">{t('mindtree.cardOwners')}</p>
          <ul className="mtree-card-owners">
            {model.owners.map((owner) => (
              <li key={owner.key} className="mtree-card-owner">
                <span className="mtree-card-value">{isolate(owner.name)}</span>
                <span className="mtree-card-num tabular">{owner.count}</span>
              </li>
            ))}
            {model.moreOwners > 0 && (
              <li className="mtree-card-owner mtree-card-more">
                {t('mindtree.cardMore', { count: model.moreOwners })}
              </li>
            )}
          </ul>
        </>
      )}

      {/* ── WHAT THIS CARD CAN DO, WHICH THE PICTURE DOES NOT SAY ───────────

          Asked what made the map feel like a screenshot, the owner's answer was
          "I cannot tell what is clickable" — and the audit agreed with it: the
          map is not short on capability, it is short of MARKS. Every verb it has
          sits behind a right-click, a keyboard chord, or a tap whose result (a
          fold) is the least surprising thing a picture can do. Nothing on the
          screen mentions any of them. The caption strip that used to carry the
          legend and the gesture hint is gated off, and the disclosure chevron
          was gated off with the radial drawing.

          THIS IS THE CHEAPEST PLACE TO SAY IT AND THE RIGHT ONE. The card is
          already mounted, already positioned clear of the node, already
          `role="tooltip"` and `pointer-events: none`, and it appears exactly
          when a reader is considering a node. It costs no geometry, and — the
          part that matters — NO NEW HIT TARGET: this file's own header keeps the
          whole node as the target rather than putting a 20px control inside it,
          and a "⋯" button on the card would have been precisely the mark that
          rule exists to refuse.

          TWO SENTENCES, BY KIND, because the first verb genuinely differs: a
          branch folds under a click and a leaf opens its details, and one line
          covering both would have to be vague enough to describe neither.

          ⚠ IT NAMES THE RIGHT-CLICK AND NOT THE HOLD. On a touch screen this
          card appears on the tap that has already begun the gesture, so telling
          a finger about a long press it is halfway through is too late to be
          help. The hold is real — `DragLayer`'s `menuHoldRef` — and saying so
          on a phone is a separate mark in a separate place. */}
      <p className="mtree-card-verbs">
        {t(model.kind === 'branch' ? 'mindtree.cardVerbsBranch' : 'mindtree.cardVerbsLeaf')}
      </p>
    </>
  )
}
