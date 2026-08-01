// Track icon registry: the `tracks.icon` text column -> a React component.
//
// This mapping lives in the app, not the database. Migration 0002 deliberately
// puts no CHECK on `tracks.icon`, because a constraint listing valid names
// would put the frontend's component registry in Postgres — every new glyph
// would then need a migration, and a rolled-back deploy would leave rows the
// running code cannot render.
//
// The cost of that freedom is that the column can hold a name nothing matches
// (a seed written before the glyph existed, a hand-edited row, an icon removed
// in a later release). So `trackIcon()` never throws and never returns
// undefined — it falls back to a plain circle, the same forgiving contract
// lib/i18n.ts's t() has with a missing key: degrade to something renderable
// rather than take the page down over a label.

import {
  IconActivity,
  IconChart,
  IconCircle,
  IconClipboardList,
  IconCloud,
  IconDatabase,
  IconLayers,
  IconNetwork,
  IconPlug,
  IconServer,
  IconServerCog,
  IconShieldCheck,
  IconTerminal,
  IconUsers,
  type IconComponent,
} from '../components/icons'

// Insertion order IS the picker's display order, so it runs roughly
// "process -> machines -> network -> data -> people", which is how an ops lead
// describes their domains. The first five are the names migration 0001 seeds,
// and they stay first so the existing tracks' icons are never buried.
const REGISTRY = {
  'clipboard-list': IconClipboardList,
  'server-cog': IconServerCog,
  network: IconNetwork,
  server: IconServer,
  activity: IconActivity,
  database: IconDatabase,
  cloud: IconCloud,
  // Beside `network` and `cloud` in meaning, but it cannot go beside them in
  // position: the first five ARE the names 0001 seeds and moving them would
  // reshuffle the picker under every existing track. So it lands at the head of
  // the second group, where the connectivity glyphs already are.
  //
  // Added because 0018 seeded `Onboarding` with `icon = 'plug'` and this
  // registry had no such key — the track had been drawing itself as the
  // fallback circle. Verified against the live row, not assumed.
  plug: IconPlug,
  terminal: IconTerminal,
  shield: IconShieldCheck,
  layers: IconLayers,
  chart: IconChart,
  users: IconUsers,
} satisfies Record<string, IconComponent>

/** Every name the picker offers, in display order. */
export const TRACK_ICON_NAMES: string[] = Object.keys(REGISTRY)

/**
 * Resolve a stored icon name. Unknown (or empty) names get the circle rather
 * than nothing, so a track row always has a glyph occupying its slot and the
 * list does not go ragged around one bad value.
 */
export function trackIcon(name: string): IconComponent {
  const found = (REGISTRY as Record<string, IconComponent | undefined>)[name]
  return found ?? IconCircle
}
