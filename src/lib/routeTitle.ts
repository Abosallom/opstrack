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
  // Same shape, one level deeper. The three meeting sub-screens are ordered
  // longest-first for the same reason the admin block below is: '/meetings/'
  // matches all three, so a shorter test placed above them would title triage
  // and the minutes document "Meeting". The NAV scan is an exact-match lookup,
  // so it cannot claim these — but it also cannot be relied on not to, since
  // that is a property of the scan and not of this ordering.
  if (pathname.startsWith('/meetings/') && pathname.endsWith('/minutes')) return 'route.minutes'
  if (pathname.startsWith('/meetings/') && pathname.endsWith('/triage')) return 'meeting.triage'
  if (pathname.startsWith('/meetings/')) return 'route.meeting'
  const hit = nav.find((n) => pathname === n.to)
  if (hit) return hit.titleKey
  // Most specific first. All four admin paths also match the plain '/settings'
  // prefix below, so a shorter test placed earlier would title every one of
  // them "Settings".
  // Two screens outside every nav, named out of their OWN namespaces rather
  // than through route.* — the same call the vocabulary screen makes below:
  // `digest.title` and `notif.title` already ship in both languages, and a
  // route.* twin would only ever hold the same two strings.
  if (pathname.startsWith('/digest')) return 'digest.title'
  if (pathname.startsWith('/notifications')) return 'notif.title'
  if (pathname === '/settings/tracks/new') return 'admin.tracks.add'
  if (pathname.startsWith('/settings/tracks/')) return 'admin.tracks.edit'
  if (pathname.startsWith('/settings/tracks')) return 'admin.tracks.title'
  // The vocabulary screen names itself out of its own namespace rather than
  // through route.*: 'vocabadmin.title' already ships in both languages and a
  // route.vocabulary key would only ever hold the same two strings.
  if (pathname.startsWith('/settings/vocabulary')) return 'vocabadmin.title'
  // Same rule, same namespace argument: 'recurring.title' is "Recurring items"
  // in both languages, which is a better header than route.recurring's bare
  // "Recurring" and costs no new key.
  if (pathname.startsWith('/settings/recurring')) return 'recurring.title'
  // Wave 4b's three screens, all under the same prefix and all absent from both
  // navs — so the header is again the only chrome that names them, and all three
  // sit above the '/settings' test for the reason the whole file exists.
  //
  // Members is the one that names itself through route.*: `route.members` was
  // added in Wave 3 for the palette and the roster list's aria-label, so a
  // members.title would be a second string holding the same word. Export and
  // push follow the vocabulary/recurring precedent and name themselves out of
  // their own namespaces — 'export.title' and 'push.title' already ship in both
  // languages, and a route.* twin would only ever restate them.
  // Same precedent again, and the same reason it must sit above '/settings':
  // the terminology screen is absent from both navs, so this header is the only
  // chrome that names it. 'terminology.title' ships in both languages — and,
  // like every other string, is itself renameable from the screen it names.
  if (pathname.startsWith('/settings/terminology')) return 'terminology.title'
  if (pathname.startsWith('/settings/members')) return 'route.members'
  if (pathname.startsWith('/settings/export')) return 'export.title'
  if (pathname.startsWith('/settings/notifications')) return 'push.title'
  if (pathname.startsWith('/settings')) return 'route.settings'
  return 'route.followups'
}
