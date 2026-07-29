// A track's two stored hexes, handed to CSS as inline custom properties.
//
// This is the ONLY sanctioned way to paint anything in a track's colour. There
// is deliberately no `trackColor(track)` that returns one hex: JavaScript would
// have to read the active theme to choose, and it would read it exactly once —
// at render. When the `auto` preference flips at sunset, lib/theme.ts rewrites
// data-theme on <html> from a matchMedia listener; nothing re-renders, and every
// mark painted from a JS-picked hex keeps yesterday's colour until the user
// navigates. Custom properties re-cascade on that attribute change for free.
//
// The choosing happens in CSS, in the `--track-color` rules in global.css:
// dark hex by default, light hex under [data-theme='light']. That matters
// because the light-theme hex is not cosmetic — cyan, amber and rose that read
// well on near-black sit at roughly 2:1 on white, which is the failure the
// whole two-hex system exists to prevent.
//
// Consumers set the pair and a class that resolves --track-color
// (.track-bar, .track-dot, .track-glyph, .admin-track-bar); they never set
// --track-color themselves.

import type { CSSProperties } from 'react'

/**
 * @param color      the dark-theme hex (`tracks.color`, always present)
 * @param colorLight the light-theme override (`tracks.color_light`, nullable)
 *
 * A null override falls back to `color` rather than being omitted: an unset
 * custom property makes the light rule's var() substitution invalid, which
 * drops --track-color entirely and takes the mark with it.
 */
export function trackVars(color: string, colorLight?: string | null): CSSProperties {
  return {
    '--track-c-dark': color,
    '--track-c-light': colorLight ?? color,
  } as CSSProperties
}
