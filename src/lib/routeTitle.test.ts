// The header-title mapping, and specifically the ORDER of its prefix tests.
//
// Wave 2 added two routes that both sit under an existing prefix — /entry/:id
// under nothing, and /settings/vocabulary under /settings — which is the exact
// shape of the mistake this file exists to catch: a new `startsWith('/settings')`
// test added above the specific ones retitles every admin screen "Settings",
// and nothing else in the repo notices.
//
// Wave 3 added the same shape one level deeper. The meeting flow is four
// screens under one prefix — /meetings, /meetings/:id, /meetings/:id/triage and
// /meetings/:id/minutes — and three of them are absent from both navs, so the
// header is again the only chrome that names them. /settings/recurring joins
// the admin block for the identical reason.

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

  describe('the meeting flow — four screens under one prefix', () => {
    it.each([
      ['/meetings', 'route.meetings'],
      ['/meetings/abc-123', 'route.meeting'],
      ['/meetings/abc-123/triage', 'meeting.triage'],
      ['/meetings/abc-123/minutes', 'route.minutes'],
    ])('%s → %s', (pathname, expected) => {
      expect(title(pathname)).toBe(expected)
    })

    it('gives each of the four a title of its own', () => {
      // Stated as an invariant rather than as four examples: reorder the
      // startsWith tests and at least two of these collapse onto each other.
      const flow = ['/meetings', '/meetings/x', '/meetings/x/triage', '/meetings/x/minutes']
      expect(new Set(flow.map(title)).size).toBe(4)
    })

    it('reads the sub-screen off the END of the path, not off the id', () => {
      // A meeting whose id merely CONTAINS the word is still the live screen —
      // the tests are endsWith, and this is what makes that visible.
      expect(title('/meetings/triage-retro-2026')).toBe('route.meeting')
      expect(title('/meetings/minutes-review')).toBe('route.meeting')
    })
  })

  it('titles the three screens that are in no nav at all', () => {
    // Reached from the bell, from the dashboard, and from the List | Map
    // switcher on /tracks respectively — never from a tab, so the header is the
    // only place any of the three is named.
    expect(title('/notifications')).toBe('notif.title')
    expect(title('/digest')).toBe('digest.title')
    expect(title('/mindtree')).toBe('mindtree.title')
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
      ['/settings/recurring', 'recurring.title'],
      // Wave 4b. Three more screens under the same prefix, none of them in a nav.
      ['/settings/members', 'route.members'],
      ['/settings/export', 'export.title'],
      ['/settings/notifications', 'push.title'],
      // 0018. The level above tracks, absent from both navs like the rest of
      // this block, so the header is the only chrome that names it.
      ['/settings/groups', 'groups.title'],
    ])('%s → %s', (pathname, expected) => {
      expect(title(pathname)).toBe(expected)
    })

    it('never falls through to the plain settings title', () => {
      // The regression stated as an invariant rather than as eight examples: if
      // someone reorders the tests, at least one of these stops being specific.
      const admin = [
        '/settings/tracks',
        '/settings/tracks/new',
        '/settings/tracks/abc-123',
        '/settings/vocabulary',
        '/settings/recurring',
        '/settings/members',
        '/settings/export',
        '/settings/notifications',
        '/settings/groups',
      ]
      for (const p of admin) expect(title(p), p).not.toBe('route.settings')
      // …and they must not all collapse onto one another either.
      expect(new Set(admin.map(title)).size).toBe(9)
    })

    it('does not confuse /settings/notifications with the /notifications page', () => {
      // Two different screens whose paths are a suffix of one another: the inbox
      // HISTORY at the top level, and push preferences under settings. The
      // top-level test is `startsWith('/notifications')`, which cannot see the
      // settings path, and the settings test is below it — but only because
      // neither string is a prefix of the other. Worth pinning: they were one
      // sloppy `includes()` away from sharing a title.
      expect(title('/notifications')).toBe('notif.title')
      expect(title('/settings/notifications')).toBe('push.title')
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
