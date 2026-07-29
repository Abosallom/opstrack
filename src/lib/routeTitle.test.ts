// The header-title mapping, and specifically the ORDER of its prefix tests.
//
// Wave 2 added two routes that both sit under an existing prefix — /entry/:id
// under nothing, and /settings/vocabulary under /settings — which is the exact
// shape of the mistake this file exists to catch: a new `startsWith('/settings')`
// test added above the specific ones retitles every admin screen "Settings",
// and nothing else in the repo notices.

import { describe, expect, it } from 'vitest'
import { titleKeyFor, type TitledRoute } from './routeTitle'

/** The Wave-2 NAV table, reduced to the two fields the function reads. */
const NAV: readonly TitledRoute[] = [
  { to: '/capture', titleKey: 'route.capture' },
  { to: '/followups', titleKey: 'route.followups' },
  { to: '/board', titleKey: 'route.board' },
  { to: '/tracks', titleKey: 'route.tracks' },
  { to: '/meetings', titleKey: 'route.meetings' },
  { to: '/dashboard', titleKey: 'route.dashboard' },
]

const title = (p: string): string => titleKeyFor(p, NAV)

describe('titleKeyFor', () => {
  it('titles every primary destination from the nav table', () => {
    for (const dest of NAV) expect(title(dest.to)).toBe(dest.titleKey)
  })

  it('distinguishes a track log from the track index', () => {
    expect(title('/tracks')).toBe('route.tracks')
    expect(title('/tracks/abc-123')).toBe('route.trackDetail')
  })

  it('titles the entry route for any id', () => {
    expect(title('/entry/abc-123')).toBe('route.entry')
    // The id is a uuid in practice; nothing here may depend on its shape.
    expect(title('/entry/00000000-0000-0000-0000-000000000000')).toBe('route.entry')
  })

  describe('admin paths under /settings — longest prefix first', () => {
    // Each of these also matches '/settings', which is the whole point.
    it.each([
      ['/settings', 'route.settings'],
      ['/settings/tracks', 'admin.tracks.title'],
      ['/settings/tracks/new', 'admin.tracks.add'],
      ['/settings/tracks/abc-123', 'admin.tracks.edit'],
      ['/settings/vocabulary', 'vocabadmin.title'],
    ])('%s → %s', (pathname, expected) => {
      expect(title(pathname)).toBe(expected)
    })

    it('never falls through to the plain settings title', () => {
      // The regression stated as an invariant rather than as five examples: if
      // someone reorders the tests, at least one of these stops being specific.
      const admin = [
        '/settings/tracks',
        '/settings/tracks/new',
        '/settings/tracks/abc-123',
        '/settings/vocabulary',
      ]
      for (const p of admin) expect(title(p), p).not.toBe('route.settings')
      // …and they must not all collapse onto one another either.
      expect(new Set(admin.map(title)).size).toBe(4)
    })

    it('creating a track is not mistaken for editing one called "new"', () => {
      expect(title('/settings/tracks/new')).toBe('admin.tracks.add')
      expect(title('/settings/tracks/new')).not.toBe('admin.tracks.edit')
    })
  })

  it('falls back to the home screen for anything unrecognised', () => {
    // Matches the '*' route, which redirects to /followups — the header and the
    // redirect must agree, or the title flashes the wrong screen's name.
    expect(title('/nope')).toBe('route.followups')
    expect(title('/')).toBe('route.followups')
  })
})
