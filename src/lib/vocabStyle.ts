// A vocabulary option's admin-chosen colour, handed to CSS as an inline custom
// property. The exact mirror of lib/trackStyle.ts's trackVars(), and shipped
// complete rather than as a skeleton because it is four lines and every atom in
// the entry kit needs it on day one.
//
// ONE HEX, BOTH THEMES — and that is why there is no vocabColor() returning a
// resolved colour. Tracks carry two hexes because their colour bars are large
// saturated fills that fail contrast on white; a status pill is small and
// derives BOTH its fill and its ink from the single stored hex:
//
//   background: color-mix(in oklab, var(--vocab-c, var(--text-dim)) 18%, transparent);
//   color:      var(--vocab-c, var(--text-dim));
//
// The 18% mix reads as a tint on near-black and as a wash on white with no JS
// theme read anywhere — which is the exact failure trackStyle.ts's header
// documents: a hex picked in JavaScript is picked once, at render, and keeps
// yesterday's colour when the `auto` theme flips at sunset because nothing
// re-renders. A custom property re-cascades on the data-theme attribute change
// for free.
//
// Consumers set the var and a class that consumes it; they never write
// --vocab-c inline themselves.

import type { CSSProperties } from 'react'

/**
 * @param color `vocab_options.color`, nullable — null means "this option has no
 *              override". The var is then OMITTED rather than set to a
 *              fallback string, so the `var(--vocab-c, var(--text-dim))`
 *              default in the stylesheet is what applies. Setting it to the
 *              literal 'null' or '' would make the substitution invalid and
 *              drop the declaration, taking the pill's ink with it.
 */
export function vocabVars(color: string | null | undefined): CSSProperties {
  return (color ? { '--vocab-c': color } : {}) as CSSProperties
}
