// THE BREADCRUMB — the map's primary orientation object, and every way back out.
//
// Diving into a world makes it the whole screen. That is the point (the
// reference the whole redesign is built on is an infinite-zoom illustration:
// the mouth becomes the frame, and then it is gone), and it is also the risk: a
// reader three worlds deep is looking at a picture that gives no clue what it is
// a picture OF. This is the clue.
//
// ── THE ROOT IS ALWAYS ONE PRESS AWAY ──────────────────────────────────────
//
// Not "reachable", not "two crumbs back" — ONE PRESS, from any depth, and that
// is the promise the truncation below is written around rather than in spite of.
//
// ── IT TRUNCATES FROM THE START, WHICH REVERSES WHAT THIS FILE USED TO DO ──
//
// What stood here before: "the trail is at most four hops deep because model.ts's
// tree is (root → track → group → more → entry) and focus.ts's `canFocus` refuses
// the leaf. There is nothing here to truncate, so nothing here truncates."
//
// THAT BOUND IS GONE. The camera can be anywhere, `map_nodes` has a
// self-referencing `parent_id` with a depth cap of six, and the trail is now
// `ancestorWorlds(layout, worldAt(camera))` — as deep as the department tree the
// admin configured. A wrapping row of eight crumbs is two rows of chrome over a
// drawing, which is the fault this whole unit exists to cut.
//
// So it truncates, and the direction is the decision: FROM THE START, keeping
// the ROOT plus the NEAREST hops (`… › Onboarding › Riyadh Cluster`). The near
// end is what you need — it is where you are and what you are about to leave —
// and the far end is one press away because the root is never dropped. The
// hops in between are not lost either: they are what zooming OUT passes through,
// continuously, which is the one navigation this map has that a breadcrumb
// cannot be a substitute for.
//
// THE ELIDED MARKER IS NOT A CONTROL. A "…" that expands would be a second
// disclosure over the picture, and a "…" that navigated would be ambiguous about
// WHICH of the hops it went to. It is a mark with a screen-reader sentence
// saying how many worlds it stands for, and the way to any of them is the rail.
//
// ── IT RENDERS `FocusView.trail` AND COMPUTES NOTHING ──────────────────────
//
// `resolveFocus` already answered "which node, and how did we get here" as one
// object, and its header says why the four fields are only correct together. So
// this takes the trail verbatim: root first, target LAST, inclusive. The tail is
// the CURRENT location and is not a link; every hop before it is. A breadcrumb
// that re-derived its own path from an id would be a second answer to a question
// that already has one, and the two would disagree the first time a focus fell
// back after a regroup — which is the ordinary case, not the exotic one.
//
// `missingId` is deliberately NOT rendered here. "That branch is gone — showing
// its parent" is an ANNOUNCEMENT, and the screen already owns a live region for
// announcements; saying it in the crumb bar as well would put it on screen
// permanently, where it would read as a property of the branch the reader landed
// on rather than as the thing that just happened.
//
// ── RTL ────────────────────────────────────────────────────────────────────
//
// The separator is the one mark on this component that carries a direction, and
// it is an ICON with `className="icon-directional"` rather than the `›`
// character the first cut of the page used. A text chevron does not mirror:
// global.css's rule is `[dir='rtl'] .icon-directional { transform: scaleX(-1) }`
// and a `›` glyph is not an icon, so an Arabic reader got a trail whose arrows
// pointed back the way they came. icons.tsx's own header states the contract
// this component is honouring — directional icons carry the class AT THE CALL
// SITE, never inside the icon, so the same chevron stays un-mirrored where it is
// used decoratively. Everything else is logical properties and needs no mirror.

import type { ReactElement } from 'react'
import { isolate } from '../../lib/bidi'
import { IconChevronEnd } from '../icons'
import { t, useLocale } from '../../lib/i18n'
import type { MindLabel, MindNode } from '../../lib/mindtree/model'
import './breadcrumb.css'

export interface BreadcrumbProps {
  /**
   * `FocusView.trail` — root first, focused node LAST, inclusive.
   *
   * Nothing is drawn for a trail of one (the unfocused map): a bar whose only
   * entry is the place you already are says nothing and costs a row of the
   * screen the map could be using.
   */
  trail: readonly MindNode[]
  /**
   * Focus this node. `null` for the root — the page clears the focus rather than
   * focusing `root`, and lib/mindtree/focus.ts's URL codec writes the two the
   * same way (no `focus` param at all), so passing the root's id instead would
   * make one state reachable by two encodings.
   */
  onFocus: (nodeId: string | null) => void
}

/**
 * A node's label as text.
 *
 * The `key` variant goes through t(); the `text` variant is database text — a
 * track name, a person's name — and must NOT. model.ts's MindLabel header
 * explains why the union is discriminated rather than two optional fields: t()
 * echoes an unknown key, so an Arabic track name handed to it renders as itself
 * and the bug is invisible in English and wrong in Arabic.
 */
function labelText(label: MindLabel): string {
  const raw = label.kind === 'key' ? t(label.key, label.vars) : label.text
  const trimmed = raw.trim()
  return trimmed === '' ? t('mindtree.untitled') : trimmed
}

/**
 * How many LINK crumbs are drawn before the current location.
 *
 * Three: the root, plus the two nearest hops. Four crumb boxes and an elision
 * mark is the widest arrangement that fits the 540px top-centre island at 1080px
 * without wrapping, measured against `.mtree-crumbbar-btn`'s 14rem cap and the
 * 12.5px type — and a fifth would not survive the phone's top rail at all.
 *
 * It is a CEILING on the drawn row and never on the trail: `visibleCrumbs`
 * always returns the root, so the promise this component makes ("the root is one
 * press away, from any depth") is a property of the function rather than of the
 * data it happens to be given.
 */
export const CRUMB_LINKS_MAX = 3

/** One drawn crumb: the node, and the index it had in the FULL trail. */
export interface VisibleCrumb {
  readonly node: MindNode
  /** Index in the original trail — what `crumbTarget` needs. */
  readonly at: number
}

/**
 * The link crumbs to draw, and how many were elided before them.
 *
 * TRUNCATES FROM THE START, keeping the ROOT: `[root, …, near, nearest]`. Pure
 * and total — a trail of any length, in any order, yields a list whose first
 * entry is `at === 0` whenever the input had one.
 *
 * A named export because it is the decision this component makes and
 * `environment: 'node'` cannot measure a rendered row to observe it.
 */
export function visibleCrumbs(trail: readonly MindNode[]): {
  readonly crumbs: readonly VisibleCrumb[]
  readonly elided: number
} {
  const links = trail.slice(0, -1).map((node, at) => ({ node, at }))
  if (links.length <= CRUMB_LINKS_MAX) return { crumbs: links, elided: 0 }

  const root = links[0]
  // The nearest hops, which is what a reader who can be anywhere needs: they
  // are where they are and what they are about to leave.
  const near = links.slice(links.length - (CRUMB_LINKS_MAX - 1))
  return {
    crumbs: root === undefined ? near : [root, ...near],
    elided: links.length - CRUMB_LINKS_MAX,
  }
}

/**
 * What pressing the crumb at `at` asks for.
 *
 * The root crumb clears the focus (`null`) rather than focusing the node whose
 * id is `root`, and the distinction is not pedantry: lib/mindtree/focus.ts's URL
 * codec writes both as NO `focus` param at all, so passing the id would make one
 * state reachable by two encodings — and a reader who pressed "All tracks" would
 * end up on a URL that did not match the one they arrived on.
 *
 * A named export because it is the only DECISION in this component, and
 * `environment: 'node'` cannot click a button to observe it.
 */
export function crumbTarget(at: number, node: MindNode): string | null {
  return at === 0 ? null : node.id
}

export default function Breadcrumb({ trail, onFocus }: BreadcrumbProps): ReactElement | null {
  // Subscribed so a language switch re-renders the labels. Every t() below reads
  // lib/i18n's MODULE-level locale, which React cannot watch on its own.
  useLocale()

  if (trail.length < 2) return null

  const here = trail[trail.length - 1]
  if (here === undefined) return null

  const { crumbs, elided } = visibleCrumbs(trail)

  return (
    <nav className="mtree-crumbbar" aria-label={t('mindtree.breadcrumb')}>
      {/* An ordered list, because the order IS the meaning — this is a path, not
          a set of links that happen to be adjacent, and "list, 3 items" is a
          screen reader telling the reader how deep they are.

          `role="list"` IS NOT REDUNDANT, however much it looks it. The sheet
          sets `list-style: none`, and Safari/VoiceOver strips list semantics
          from any list whose marker has been removed — so the one browser this
          app is installed as a PWA on is the one that would drop the count. The
          role restores the <ol>'s own implicit role and changes nothing
          anywhere else. */}
      <ol className="mtree-crumbbar-list" role="list">
        {crumbs.map(({ node, at }, drawn) => {
          const label = at === 0 ? t('mindtree.backToRoot') : labelText(node.label)
          return (
            <li key={node.id} className="mtree-crumbbar-item">
              {/* THE ELISION SITS BEFORE THE FIRST NEAR CRUMB, never before the
                  root — which is what makes "the root is one press away" true of
                  the drawn row and not only of the data. It is a mark, not a
                  control: pressing it could only be ambiguous about which of the
                  hidden worlds it meant, and the way to any of them is to zoom
                  out, continuously, past every one of them. */}
              {drawn === 1 && elided > 0 && (
                <>
                  <span className="mtree-crumbbar-gap" aria-hidden="true">
                    …
                  </span>
                  <span className="sr-only">{t('mindtree.crumbElided', { count: elided })}</span>
                  <IconChevronEnd className="icon-directional mtree-crumbbar-sep" size={14} />
                </>
              )}
              <button
                type="button"
                className="btn btn-sm btn-ghost mtree-crumbbar-btn"
                // The VISIBLE text is the label and the accessible name adds
                // "Back to" in front of it — which is the order WCAG 2.5.3
                // (Label in Name) needs: a voice-control user says the words
                // they can see, and the name must contain them. The root crumb
                // takes no aria-label at all, because "All tracks" is already
                // both the visible text and the whole sentence.
                aria-label={at === 0 ? undefined : t('mindtree.backTo', { label })}
                onClick={() => onFocus(crumbTarget(at, node))}
              >
                {at === 0 ? label : isolate(label)}
              </button>
              <IconChevronEnd className="icon-directional mtree-crumbbar-sep" size={14} />
            </li>
          )
        })}

        {/* The current location. NOT a button: pressing it would do nothing, and
            a control that does nothing is worse than a heading that says where
            you are. `aria-current="location"` rather than `"page"` — this is a
            place inside one screen, not a document, and `location` is the token
            ARIA defines for exactly that. */}
        <li className="mtree-crumbbar-item">
          <span className="mtree-crumbbar-here" aria-current="location">
            {isolate(labelText(here.label))}
          </span>
        </li>
      </ol>
    </nav>
  )
}
