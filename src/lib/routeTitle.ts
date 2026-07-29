// Which locale key the app header shows for a given path.
//
// EXTRACTED FROM App.tsx AT THE WAVE-2 CLOSE, for one reason: the ordering of
// the tests below is load-bearing and was the only logic in an integrator-only
// file with nothing asserting it. Every admin path also matches the shorter
// '/settings' prefix, so a test placed one line too early silently retitles
// three screens "Settings" — and since these screens are deliberately absent
// from both navs, the header is the ONLY chrome that names them. The failure is
// invisible to a typecheck, invisible to a build, and looks like a design
// choice in a screenshot.
//
// Pure by construction and importing nothing at all — not even i18n, since it
// returns the KEY and lets the caller translate. The nav list is a parameter
// rather than an import because it lives in App.tsx beside the two renderers it
// feeds, and dragging a table of React icon components into src/lib to make one
// function testable would be the tail wagging the dog.

/** The shape `titleKeyFor` needs from App.tsx's NAV table — nothing more. */
export interface TitledRoute {
  to: string
  titleKey: string
}

/**
 * Longest prefix first. The order of the `startsWith` tests IS the behaviour;
 * see the header before moving one.
 *
 * @param pathname router pathname, no hash and no query
 * @param nav      the primary-navigation destinations, matched exactly
 */
export function titleKeyFor(pathname: string, nav: readonly TitledRoute[]): string {
  if (pathname.startsWith('/entry/')) return 'route.entry'
  // Checked before the NAV scan: /tracks/:id is one track's log, not the track
  // index, and the header is the only thing that says which screen this is.
  if (pathname.startsWith('/tracks/')) return 'route.trackDetail'
  const hit = nav.find((n) => pathname === n.to)
  if (hit) return hit.titleKey
  // Most specific first. All four admin paths also match the plain '/settings'
  // prefix below, so a shorter test placed earlier would title every one of
  // them "Settings".
  if (pathname === '/settings/tracks/new') return 'admin.tracks.add'
  if (pathname.startsWith('/settings/tracks/')) return 'admin.tracks.edit'
  if (pathname.startsWith('/settings/tracks')) return 'admin.tracks.title'
  // The vocabulary screen names itself out of its own namespace rather than
  // through route.*: 'vocabadmin.title' already ships in both languages and a
  // route.vocabulary key would only ever hold the same two strings.
  if (pathname.startsWith('/settings/vocabulary')) return 'vocabadmin.title'
  if (pathname.startsWith('/settings')) return 'route.settings'
  return 'route.followups'
}
