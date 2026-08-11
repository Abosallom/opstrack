// Render proof for the two halves of "leaving the map and coming back".
//
// WHY renderToStaticMarkup AND NOT A DOM. vitest.config.ts is `environment:
// 'node'` and jsdom is not in the dependency budget; NotificationBell.test.tsx,
// Board.test.tsx and FollowUps.test.tsx all open with the same paragraph.
// react-dom/server exercises the real tree, the real router and the real i18n
// bundle, and hands back markup to assert on.
//
// TWO OF THESE ASSERTIONS ARE SOURCE SCANS, NOT RENDERS, and that is deliberate.
// The most valuable guarantee this unit owes is an ABSENCE — the frame must not
// claim Enter, Shift+Enter or Escape, because meeting live capture is zero
// pointer interactions and Escape already has four claimants in a decided order
// (MapPanel.tsx's header). A static render cannot prove the absence of a
// handler: `onKeyDown` leaves no trace in markup. Reading the source through
// `?raw` can, and it is the same mechanism localeReach.test.ts uses to see keys
// a regex over a running app never could.
//
// WHAT THIS FILE CANNOT SEE, and therefore claims nothing about: anything behind
// an effect. `loadMeetings()` runs in a `useEffect` that a server render never
// invokes, so the live badge is asserted from an injected store snapshot rather
// than from a fetch. The badge's ARRIVAL — a meeting that starts while the map
// is open — is a realtime path this harness has no way to drive.

import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { Meeting } from '../../types'

const fx = vi.hoisted(() => {
  // lib/i18n reads localStorage at module scope, so the shim cannot wait for a
  // beforeAll(). lib/theme reads matchMedia at import time for the same reason.
  const mem = new Map<string, string>()
  const g = globalThis as unknown as Record<string, unknown>
  g.localStorage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => void mem.set(k, v),
    removeItem: (k: string) => void mem.delete(k),
    clear: () => mem.clear(),
    key: (i: number) => [...mem.keys()][i] ?? null,
    get length() {
      return mem.size
    },
  }
  g.addEventListener = () => {}
  g.removeEventListener = () => {}
  g.window = globalThis
  g.matchMedia = () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} })
  g.document = { documentElement: { dir: 'ltr', lang: 'en' } }

  const meeting = (over: Partial<Meeting> & Pick<Meeting, 'id'>): Meeting => ({
    title: 'Weekly network sync',
    track_id: null,
    attendees: [],
    started_at: '2026-08-11T08:00:00.000Z',
    ended_at: '2026-08-11T09:00:00.000Z',
    notes: '',
    created_by: null,
    ...over,
  })

  const state: { meetings: Meeting[] } = { meetings: [] }
  return { meeting, state }
})

// The store is mocked whole: importing the real one pulls api/meetings and the
// Supabase client into a node process that has no session and no fetch worth
// making.
vi.mock('../../store/meetings', () => ({
  useMeetings: () => fx.state.meetings,
  loadMeetings: () => Promise.resolve(),
}))

const { MemoryRouter } = await import('react-router-dom')
const ModeFrame = (await import('./ModeFrame')).default
const MapModeBar = (await import('./MapModeBar')).default
const { setLocale, t } = await import('../../lib/i18n')

/** The two files this unit owns, as text. Same mechanism as localeReach.test.ts. */
const RAW: Record<string, string> = import.meta.glob('./{ModeFrame,MapModeBar}.tsx', {
  query: '?raw',
  import: 'default',
  eager: true,
})
const sourceOf = (name: string): string => RAW[`./${name}.tsx`] ?? ''

const frame = (props: { titleKey: string; wide?: boolean }, body = 'THE MODE'): string =>
  renderToStaticMarkup(
    <MemoryRouter initialEntries={['/digest']}>
      <ModeFrame titleKey={props.titleKey} wide={props.wide}>
        <h1>{body}</h1>
      </ModeFrame>
    </MemoryRouter>,
  )

const bar = (compact = false): string =>
  renderToStaticMarkup(
    <MemoryRouter initialEntries={['/mindtree']}>
      <MapModeBar compact={compact} />
    </MemoryRouter>,
  )

const inLocale = <T,>(locale: 'en' | 'ar', run: () => T): T => {
  setLocale(locale)
  try {
    return run()
  } finally {
    setLocale('en')
  }
}

/* ───────────────────── the way back, from anywhere ───────────────────── */

describe('ModeFrame — the way back', () => {
  it('is a link to the map route, not a history step, and points at the same place in both languages', () => {
    // `/digest` and `/meetings/:id` are the targets of push notifications, chat
    // links and the share sheet, so a mode is very often the FIRST entry in the
    // history stack. navigate(-1) there goes nowhere.
    for (const locale of ['en', 'ar'] as const) {
      const html = inLocale(locale, () => frame({ titleKey: 'digest.title' }))
      expect(html, locale).toContain('href="/mindtree"')
      expect(html, locale).not.toContain('href="/opstrack/mindtree"')
    }
  })

  it('names the way back with the map’s own name in each language', () => {
    expect(inLocale('en', () => frame({ titleKey: 'digest.title' }))).toContain(t('nav.map'))
    const arName = inLocale('ar', () => t('nav.map'))
    expect(inLocale('ar', () => frame({ titleKey: 'digest.title' }))).toContain(arName)
    // Not the same string twice: if these ever collide the assertion above is
    // proving nothing about Arabic.
    expect(arName).not.toBe(t('nav.map'))
  })

  it('marks both directional icons for RTL mirroring at the call site', () => {
    // icons.tsx's contract: an icon whose meaning depends on reading direction
    // carries `icon-directional` from the CALLER, and global.css mirrors it.
    // The back arrow and the trail separator are both such icons.
    const html = frame({ titleKey: 'digest.title' })
    expect(html.match(/icon-directional/g) ?? []).toHaveLength(2)
  })
})

/* ─────────────────── what the frame must never add ──────────────────── */

describe('ModeFrame — what it must not add', () => {
  it('claims no key: no keyboard handler, no listener, no preventDefault', () => {
    // Requirement 1 and 2 of the unit brief, and the reason this is a source
    // scan: meeting live capture is type-Enter-repeat with zero pointer
    // interactions, Shift+Enter files a line as a note, and Escape has a decided
    // order that this frame is not part of.
    const src = sourceOf('ModeFrame')
    expect(src.length).toBeGreaterThan(500)
    for (const claim of ['onKeyDown', 'onKeyUp', 'onKeyPress', 'addEventListener', 'preventDefault', 'pushOverlay']) {
      // The header prose says "not Escape, not Enter" — strip comments so the
      // explanation cannot satisfy the test that checks the explanation is true.
      expect(src.replace(/\/\/.*$/gm, ''), claim).not.toContain(claim)
    }
  })

  it('renders no input, form or textarea that could take a keystroke', () => {
    const src = sourceOf('ModeFrame').replace(/\/\/.*$/gm, '')
    for (const tag of ['<input', '<form', '<textarea', '<button']) {
      expect(src, tag).not.toContain(tag)
    }
  })

  it('renders no heading of its own, so the mode keeps its <h1>', () => {
    // MeetingLive's h1 is the MEETING'S NAME and MeetingMinutes' is the
    // document's. A frame-level h1 built from a literal key could only ever say
    // "Meeting" over the top of them.
    const html = frame({ titleKey: 'meeting.title' })
    expect(html.match(/<h1/g) ?? []).toHaveLength(1)
    expect(html).not.toContain('<h2')
    expect(html).toContain('<h1>THE MODE</h1>')
  })

  it('renders its children exactly once, wrapped in nothing that scrolls', () => {
    // A second wrapper with its own overflow would break the sticky commit bar
    // in triage; a keyed one would remount the live capture input.
    const html = frame({ titleKey: 'meeting.title' }, 'ONLY ONCE')
    expect(html.match(/ONLY ONCE/g) ?? []).toHaveLength(1)
    expect(html).not.toContain('overflow')
  })
})

/* ──────────────────────── width and the title key ───────────────────── */

describe('ModeFrame — width and title', () => {
  it('releases the reading measure only when the mode asks for it', () => {
    expect(frame({ titleKey: 'meeting.title', wide: true })).toContain('data-wide=""')
    expect(frame({ titleKey: 'meeting.title' })).not.toContain('data-wide')
    expect(frame({ titleKey: 'meeting.title', wide: false })).not.toContain('data-wide')
  })

  it('resolves the literal title key through t() in both bundles', () => {
    // The three keys the wiring will actually pass: the digest's own title, the
    // meetings index's, and `route.minutes` — `minutes.json` has no `title` of
    // its own, and routeTitle.ts already names that document from `route`.
    for (const key of ['digest.title', 'meeting.title', 'route.minutes']) {
      for (const locale of ['en', 'ar'] as const) {
        const [label, html] = inLocale(locale, () => [t(key), frame({ titleKey: key })] as const)
        expect(label, `${key}/${locale}`).not.toBe(key)
        expect(html, `${key}/${locale}`).toContain(label)
      }
    }
  })
})

/* ────────────────────────── the two entrances ───────────────────────── */

describe('MapModeBar — the entrances that replace a tab slot', () => {
  it('is one tap to meetings and one tap to the digest, at both widths', () => {
    for (const compact of [false, true]) {
      const html = bar(compact)
      expect(html, String(compact)).toContain('href="/meetings"')
      expect(html, String(compact)).toContain('href="/digest"')
      // Two links and no disclosure: a "More" menu here would make both two taps.
      expect((html.match(/<a /g) ?? []).length, String(compact)).toBe(2)
    }
  })

  it('keeps a 44px hit area on every target at every width', () => {
    for (const compact of [false, true]) {
      expect((bar(compact).match(/tap-44/g) ?? []).length, String(compact)).toBe(2)
    }
  })

  it('labels both destinations in both languages', () => {
    for (const locale of ['en', 'ar'] as const) {
      const html = inLocale(locale, () => bar())
      expect(html, locale).toContain(inLocale(locale, () => t('meeting.title')))
      expect(html, locale).toContain(inLocale(locale, () => t('digest.title')))
    }
  })

  it('marks a compact viewport from the shell’s one reading of the breakpoint', () => {
    expect(bar(true)).toContain('data-compact=""')
    expect(bar(false)).not.toContain('data-compact')
  })

  it('flags a running meeting with text inside the link, not with colour alone', () => {
    fx.state.meetings = [fx.meeting({ id: 'm1', ended_at: null })]
    const html = bar()
    expect(html).toContain(t('meeting.badgeLive'))
    // Inside the anchor, so the accessible name becomes "Meetings Live" with no
    // composed aria-label that could drift from what is drawn.
    const anchor = html.slice(html.indexOf('href="/meetings"'), html.indexOf('href="/digest"'))
    expect(anchor).toContain(t('meeting.badgeLive'))
    fx.state.meetings = []
  })

  it('draws no badge when every meeting has ended', () => {
    fx.state.meetings = [fx.meeting({ id: 'm1' }), fx.meeting({ id: 'm2' })]
    expect(bar()).not.toContain(t('meeting.badgeLive'))
    fx.state.meetings = []
  })

  it('says nothing out loud — no aria-live in the shell header', () => {
    fx.state.meetings = [fx.meeting({ id: 'm1', ended_at: null })]
    expect(bar()).not.toContain('aria-live')
    fx.state.meetings = []
  })
})

/* ─────────────────── the hooks the print rules key on ───────────────── */

// WHY THE PRINT RULE ITSELF IS NOT ASSERTED HERE, stated rather than quietly
// dropped. The unit brief asks for a print-rule assertion "if the harness allows
// one". It does not: vitest.config.ts leaves `test.css` at its default of false,
// which replaces EVERY `.css` import with an empty module — and the `?raw` query
// does not escape it, because the interception matches `.css` before the query.
// Probed directly: `import.meta.glob('./*.css', { query: '?raw', eager: true })`
// returns all seven sheets in this directory as zero-length strings. An
// assertion written against that string passes on an empty file, which is worse
// than no assertion at all: it is a gate that reports green on a deleted rule.
//
// So the sheet's two properties — the `@media print` block, and logical
// properties only — are verified by grep in this unit's report, and what is
// asserted here is the half a test CAN see: that the class hooks those rules
// name are the classes the components actually render. A rename on one side
// without the other is the realistic way the print rule stops matching.
describe('the class hooks map-mode.css keys its print rules on', () => {
  it('renders the frame and the trail the print block hides', () => {
    const html = frame({ titleKey: 'digest.title' })
    expect(html).toContain('class="mmode-frame"')
    expect(html).toContain('class="mmode-trail"')
  })

  it('renders the bar root the print block hides', () => {
    expect(bar()).toContain('class="mmode"')
  })
})
