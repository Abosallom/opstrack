// The drill-in trail — where you are in the map, and every way back out.
//
// Focusing a branch makes it the whole screen. That is the point (lib/mindtree/
// focus.ts's header argues it: a lead chasing one track wants that track to BE
// the screen for a minute), and it is also the risk: a reader two rings deep is
// looking at a picture that gives no clue what it is a picture OF. This is the
// clue, and it is the only control on the screen that can undo a drill-in.
//
// ── THE ROOT IS ALWAYS ONE PRESS AWAY ──────────────────────────────────────
//
// Not "reachable", not "two crumbs back" — ONE PRESS, from any depth. It falls
// out of rendering the WHOLE trail rather than an ellipsis or a "…" fold: the
// first crumb is the root, always, and the trail is at most four hops deep
// because model.ts's tree is (root → track → group → more → entry) and
// focus.ts's `canFocus` refuses the leaf. There is nothing here to truncate, so
// nothing here truncates — the row WRAPS instead of scrolling, because a crumb
// that has scrolled out of a horizontal strip is a crumb the reader cannot press
// without first finding it.
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
        {trail.slice(0, -1).map((node, at) => {
          const label = at === 0 ? t('mindtree.backToRoot') : labelText(node.label)
          return (
            <li key={node.id} className="mtree-crumbbar-item">
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
