// Render proof for the three meeting screens.
//
// WHY renderToStaticMarkup AND NOT A DOM. vitest.config.ts is `environment:
// 'node'` and jsdom is not in the dependency budget — Board.test.tsx,
// FollowUps.test.tsx, the entry kit's test and the tracks tree's test all open
// with the same paragraph. react-dom/server exercises the real tree and hands
// back markup to assert on.
//
// WHAT THIS FILE CANNOT SEE, and therefore claims nothing about: anything behind
// a state change — typing a line, opening the start form, the confirm dialog,
// the debounce that writes a triage draft. What is left is the half a server
// render CAN prove, and it is the half an audit asks about:
//
//  · the live screen renders EVERY captured line, newest first, and marks its
//    state — the acceptance gate's "kill the tab and reload, nothing is lost"
//    has no meaning if a reloaded line does not render;
//  · an ENDED meeting offers triage and reopen instead of a dead input;
//  · triage gives every open line all five dropdowns plus a decision, and seeds
//    them from the stored plan rather than from defaults;
//  · a committed line leaves the table and keeps its link to the entry;
//  · "same as above" exists on every row but the first, and fill-down only
//    appears when there is more than one row to fill.
//
// WHY THE STORES ARE MOCKED AND lib/ IS NOT. Only the data sources at the
// screen's edge are stubbed. `lib/i18n`, `lib/dates`, `lib/labels` and
// api/meetings' pure `decodePlan` are the real modules — a test that mocked the
// decode would assert that this file can call a function.

import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ReactElement } from 'react'
import type { LinePlan } from '../../api/meetings'
import type { Meeting, MeetingLine, Track } from '../../types'

const fx = vi.hoisted(() => {
  // lib/i18n reads localStorage at module scope, store/config adds a window
  // focus listener at module scope, and lib/theme reads matchMedia — all three
  // at IMPORT time, so the shims cannot wait for a beforeAll().
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

  const track = (over: Partial<Track> & Pick<Track, 'id' | 'name'>): Track => ({
    name_ar: '',
    description: '',
    description_ar: '',
    color: '#4f9cf9',
    color_light: null,
    icon: 'network',
    suggested_tags: [],
    sort_order: 0,
    archived: false,
    archived_at: null,
    created_by: null,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...over,
  })

  const meeting = (over: Partial<Meeting> & Pick<Meeting, 'id' | 'title'>): Meeting => ({
    track_id: 't-net',
    attendees: ['Me', 'Layla'],
    started_at: '2026-07-29T09:00:00.000Z',
    ended_at: null,
    notes: '',
    created_by: 'u1',
    ...over,
  })

  const line = (over: Partial<MeetingLine> & Pick<MeetingLine, 'id' | 'seq' | 'raw'>): MeetingLine => ({
    meeting_id: 'm1',
    parsed: null,
    state: 'pending',
    entry_id: null,
    created_by: 'u1',
    created_at: '2026-07-29T09:05:00.000Z',
    updated_at: '2026-07-29T09:05:00.000Z',
    ...over,
  })

  const plan = (over: Partial<LinePlan> & Pick<LinePlan, 'title'>): LinePlan => ({
    trackId: null,
    type: 'action',
    priority: 'medium',
    ownerId: null,
    ownerName: null,
    dueDate: null,
    followUpDate: null,
    tags: [],
    ...over,
  })

  const net = track({ id: 't-net', name: 'Network' })
  const pmo = track({ id: 't-pmo', name: 'PMO', sort_order: 1 })

  const members = [
    { id: 'u1', displayName: 'Me', role: 'member' as const },
    { id: 'u2', displayName: 'Layla', role: 'member' as const },
  ]

  const vocab = (kind: 'type' | 'priority', rows: [string, string][]) =>
    rows.map(([key, label], i) => ({
      kind,
      key,
      label,
      color: null,
      hidden: false,
      sortOrder: i,
      staleAfterDays: null,
      slaDays: null,
    }))

  const types = vocab('type', [
    ['action', 'Action'],
    ['issue', 'Issue'],
    ['decision', 'Decision'],
  ])
  const priorities = vocab('priority', [
    ['critical', 'Critical'],
    ['high', 'High'],
    ['medium', 'Normal'],
  ])

  const live = meeting({ id: 'm1', title: 'Weekly network sync' })
  const done = meeting({
    id: 'm2',
    title: 'Vendor review',
    ended_at: '2026-07-28T11:00:00.000Z',
    started_at: '2026-07-28T10:00:00.000Z',
    track_id: null,
  })

  const lines: MeetingLine[] = [
    line({ id: 'l1', seq: 1, raw: 'Firewall rule DC2 #network @Layla' }),
    line({ id: 'l2', seq: 2, raw: 'Room agreed to defer the migration', state: 'note' }),
    line({ id: 'l3', seq: 3, raw: 'Order transceivers' }),
    line({ id: 'l4', seq: 4, raw: 'Scratch that', state: 'discarded' }),
    line({ id: 'l5', seq: 5, raw: 'Renew the DC2 support contract', state: 'committed', entry_id: 'e9' }),
  ]

  const plans = new Map<string, LinePlan>([
    ['l1', plan({ title: 'Firewall rule DC2', trackId: 't-net', ownerId: 'u2', priority: 'high' })],
    ['l2', plan({ title: 'Room agreed to defer the migration' })],
    ['l3', plan({ title: 'Order transceivers', ownerName: 'Acme', dueDate: '2026-08-03' })],
    ['l4', plan({ title: 'Scratch that' })],
  ])

  const state = {
    meetings: [live, done] as Meeting[],
    lines,
    plans,
    /**
     * Who is signed in. Both fixture meetings are `created_by: 'u1'`, so the
     * default is the creator and the two controls RLS reserves for them (End
     * and Resume, plus the notes field in triage) render; a test that wants the
     * other side sets this to 'u2' and puts it back afterwards.
     */
    me: { id: 'u1', displayName: 'Me', role: 'member' as const, locale: 'en' } as {
      id: string
      displayName: string
      role: 'member' | 'admin'
      locale: string
    } | null,
    counts: new Map([
      ['m1', { total: 5, pending: 2, note: 1, discarded: 1, committed: 1 }],
      ['m2', { total: 0, pending: 0, note: 0, discarded: 0, committed: 0 }],
    ]),
    loading: false,
    error: null as string | null,
    tracks: [net, pmo],
  }

  return { track, meeting, line, plan, net, pmo, members, types, priorities, live, done, lines, plans, state, mem }
})

vi.mock('../../store/meetings', () => ({
  useMeetings: () => fx.state.meetings,
  useMeeting: (id: string) => fx.state.meetings.find((m) => m.id === id),
  useMeetingsLoading: () => fx.state.loading,
  useMeetingsError: () => fx.state.error,
  useMeetingLines: () => fx.state.lines,
  useLinesLoading: () => false,
  useLinesError: () => null,
  useLineCounts: (id: string) =>
    fx.state.counts.get(id) ?? { total: 0, pending: 0, note: 0, discarded: 0, committed: 0 },
  useLinePlan: (id: string) => fx.state.plans.get(id),
  useLineSaving: () => false,
  useCommitting: () => false,
  getMeetingsSnapshot: () => ({ meetings: fx.state.meetings, lines: new Map(), plans: fx.state.plans }),
  loadMeetings: () => Promise.resolve(),
  loadLines: () => Promise.resolve(),
  startMeetingsRealtime: () => () => {},
  startMeeting: () => Promise.resolve({ ok: false, error: 'common.error' }),
  appendMeetingLine: () => Promise.resolve({ ok: false, error: 'common.error' }),
  editLine: () => Promise.resolve({ ok: false, error: 'common.error' }),
  setLineState: () => Promise.resolve({ ok: false, error: 'common.error' }),
  setLinePlan: () => {},
  flushLinePlans: () => Promise.resolve(),
  commitTriage: () => Promise.resolve({ ok: false, error: 'common.error' }),
  endMeetingNow: () => Promise.resolve({ ok: false, error: 'common.error' }),
  resumeMeetingNow: () => Promise.resolve({ ok: false, error: 'common.error' }),
  saveMeetingNotes: () => Promise.resolve({ ok: false, error: 'common.error' }),
}))

vi.mock('../../store/config', () => ({
  useActiveTracks: () => fx.state.tracks,
  useTrackMap: () => new Map(fx.state.tracks.map((tr) => [tr.id, tr])),
  useConfigLoading: () => false,
  loadConfig: () => Promise.resolve(),
}))

vi.mock('../../store/members', () => ({
  useMembers: () => fx.members,
  useMemberMap: () => new Map(fx.members.map((m) => [m.id, m])),
  loadMembers: () => Promise.resolve(),
}))

vi.mock('../../store/vocab', () => {
  const of = (kind: string) => (kind === 'type' ? fx.types : kind === 'priority' ? fx.priorities : [])
  return {
    useVocab: (kind: string) => of(kind),
    useVocabAll: (kind: string) => of(kind),
    useVocabLabel: () => (kind: string, key: string) =>
      of(kind).find((o) => o.key === key)?.label ?? key,
    getVocabSnapshot: () => ({ rows: [], loadedAt: 1 }),
    loadVocab: () => Promise.resolve(),
  }
})

vi.mock('../../store/entrySheet', () => ({ openEntry: () => {} }))

// `meetings_update` is creator-or-admin, and ./access mirrors it — so who is
// signed in decides whether End, Resume and the notes field render at all.
vi.mock('../../store/auth', () => ({
  useAuth: () => ({ loading: false, session: null, profile: fx.state.me }),
}))

const { MemoryRouter, Route, Routes } = await import('react-router-dom')
const MeetingsIndex = (await import('./MeetingsIndex')).default
const MeetingLive = (await import('./MeetingLive')).default
const MeetingTriage = (await import('./MeetingTriage')).default
const { setLocale, t } = await import('../../lib/i18n')

function render(element: ReactElement, url: string, path: string): string {
  return renderToStaticMarkup(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path={path} element={element} />
      </Routes>
    </MemoryRouter>,
  )
}

const index = (): string => render(<MeetingsIndex />, '/meetings', '/meetings')
const live = (id = 'm1'): string => render(<MeetingLive />, `/meetings/${id}`, '/meetings/:id')
const triage = (id = 'm1'): string =>
  render(<MeetingTriage />, `/meetings/${id}/triage`, '/meetings/:id/triage')

afterEach(() => {
  setLocale('en')
  fx.state.meetings = [fx.live, fx.done]
  fx.state.lines = fx.lines
  fx.state.loading = false
  fx.state.error = null
  fx.state.me = { id: 'u1', displayName: 'Me', role: 'member', locale: 'en' }
  fx.mem.clear()
})

/* ─────────────────────────────── the index ─────────────────────────────── */

describe('MeetingsIndex', () => {
  it('leads with the start control, collapsed', () => {
    const html = index()
    expect(html).toContain('mt-start-toggle')
    // The form itself is behind the disclosure, so none of its fields render.
    expect(html).not.toContain('mt-start-form')
  })

  it('renders one row per meeting, with its state badge', () => {
    const html = index()
    expect(html).toContain('Weekly network sync')
    expect(html).toContain('Vendor review')
    expect(html).toContain(t('meeting.badgeLive'))
    expect(html).toContain(t('meeting.badgeEnded'))
  })

  it('badges the meetings that still owe a triage', () => {
    // m1 has two pending lines; m2 has none at all.
    const html = index()
    expect(html).toContain('mt-count-pending')
    expect(html).toContain('mt-count-total')
  })

  it('names the attendee count for a screen reader', () => {
    // The people glyph is aria-hidden, so a bare "2" would be announced with
    // nothing attached to it.
    expect(index()).toContain(t('meeting.attendeesLabel'))
  })

  it('offers a way forward when there are no meetings at all', () => {
    fx.state.meetings = []
    const html = index()
    expect(html).toContain(t('meeting.empty'))
    expect(html).toContain(t('meeting.emptyHint'))
  })

  it('surfaces a load failure with a retry rather than an empty list', () => {
    fx.state.meetings = []
    fx.state.error = 'meeting.loadFailed'
    const html = index()
    expect(html).toContain(t('meeting.loadFailed'))
    expect(html).toContain(t('common.retry'))
    expect(html).not.toContain(t('meeting.emptyHint'))
  })
})

/* ──────────────────────────── the live screen ──────────────────────────── */

describe('MeetingLive', () => {
  it('puts the capture input and its one hint on screen', () => {
    const html = live()
    expect(html).toContain('mt-capture-input')
    expect(html).toContain(t('meeting.hintEnter'))
    expect(html).toContain(t('meeting.linePlaceholder'))
  })

  it('renders every persisted line — this is what "reload loses nothing" means', () => {
    const html = live()
    for (const l of fx.lines) expect(html).toContain(l.raw)
  })

  it('renders lines newest first, directly under the input', () => {
    const html = live()
    expect(html.indexOf('Scratch that')).toBeLessThan(html.indexOf('Firewall rule DC2'))
  })

  it('marks each line with its state so a note is not mistaken for work', () => {
    const html = live()
    expect(html).toContain('data-state="note"')
    expect(html).toContain('data-state="discarded"')
    expect(html).toContain('data-state="committed"')
  })

  it('keeps the line text as the accessible name of its edit control', () => {
    // An aria-label here would REPLACE the words with "edit line 3", leaving a
    // screen-reader user no way to learn what the line says.
    const html = live()
    expect(html).toContain(`title="${t('meeting.editLine')}"`)
    expect(html).not.toContain(t('meeting.editLineLabel', { seq: 1 }))
  })

  it('offers triage and reopen instead of a dead input once the meeting ended', () => {
    const html = live('m2')
    expect(html).toContain('mt-ended-bar')
    expect(html).toContain(t('meeting.triage'))
    expect(html).toContain(t('meeting.resume'))
    expect(html).not.toContain('mt-capture-input')
  })

  // `meetings_update` is creator-or-admin. An attendee who is shown End gets a
  // confirmation dialog, an optimistic close and then a rollback — the sequence
  // lib/permissions.ts exists to prevent — so the answer is computed before the
  // control renders.
  it('withholds End from an attendee who did not start the meeting, and says why', () => {
    fx.state.me = { id: 'u2', displayName: 'Layla', role: 'member', locale: 'en' }
    const html = live()
    expect(html).not.toContain(t('meeting.end'))
    expect(html).toContain(t('meeting.errNotYours'))
    // Capturing stays open to the room: `meeting_lines` insert is is_member().
    expect(html).toContain('mt-capture-input')
  })

  it('withholds Resume from an attendee on an ended meeting', () => {
    fx.state.me = { id: 'u2', displayName: 'Layla', role: 'member', locale: 'en' }
    const html = live('m2')
    expect(html).not.toContain(t('meeting.resume'))
    // The two read paths are still there — nobody is locked out of the record.
    expect(html).toContain(t('meeting.triage'))
    expect(html).toContain(t('route.minutes'))
  })

  it('gives an admin the same controls as the creator', () => {
    fx.state.me = { id: 'u2', displayName: 'Layla', role: 'admin', locale: 'en' }
    expect(live()).toContain(t('meeting.end'))
    expect(live('m2')).toContain(t('meeting.resume'))
  })

  it('waits rather than claiming the meeting is missing before the load lands', () => {
    // The not-found panel is gated on a `settled` flag an effect sets, and a
    // server render runs no effects — so this is the branch a static render CAN
    // prove: an unknown id shows the spinner, never a premature "gone".
    fx.state.meetings = []
    expect(live('nope')).toContain('ops-spinner')
  })
})

/* ───────────────────────────────── triage ──────────────────────────────── */

describe('MeetingTriage', () => {
  it('gives every open line all five dropdowns and a decision', () => {
    const html = triage()
    for (const column of ['track', 'type', 'priority', 'owner', 'due', 'decision']) {
      expect(html).toContain(`mt-col-${column}`)
    }
    // Four open lines (l5 is committed) × one decision select each.
    expect(html.split('mt-cell-decision').length - 1).toBe(4)
  })

  it('seeds the dropdowns from the stored plan, not from defaults', () => {
    const html = triage()
    // l1 was parsed to Network / high / Layla — the parser already answered, and
    // triage opening on "choose one" would throw that answer away.
    expect(html).toContain('<option value="t-net" selected="">Network</option>')
    expect(html).toContain('<option value="high" selected="">High</option>')
    expect(html).toContain('<option value="u2" selected="">Layla</option>')
    expect(html).toContain('value="Firewall rule DC2"')
  })

  it('shows the words as typed when the parser consumed some of them', () => {
    // Without this the person triaging cannot tell whether `#network` became
    // the track or simply vanished.
    expect(triage()).toContain('Firewall rule DC2 #network @Layla')
  })

  it('holds a free-text owner open with its name', () => {
    const html = triage()
    expect(html).toContain('mt-cell-owner-name')
    expect(html).toContain('value="Acme"')
  })

  it('offers "same as above" in every fillable cell of every row but the first', () => {
    // Four open rows, five fillable columns; the first row has nothing above it
    // to copy from, so 3 × 5.
    expect(triage().split('class="mt-same"').length - 1).toBe(15)
  })

  it('offers fill-down once, above the table, for every fillable column', () => {
    const html = triage()
    expect(html).toContain('mt-fill-bar')
    expect(html.split('class="chip mt-fill"').length - 1).toBe(5)
  })

  it('counts only the pending lines into the commit button', () => {
    // l1 and l3 are pending; the note and the discarded line are decisions
    // already made, and the committed one has left the meeting.
    const html = triage()
    expect(html).toContain(t('meeting.commit', { count: 2 }))
    expect(html).toContain('mt-commit-bar')
  })

  it('keeps a committed line visible, with its link to the entry', () => {
    const html = triage()
    expect(html).toContain('mt-committed')
    expect(html).toContain('Renew the DC2 support contract')
    expect(html).toContain(t('meeting.openEntry'))
  })

  it('states that a discarded line is kept, because "discard" reads as delete', () => {
    expect(triage()).toContain(t('meeting.discardedKept'))
  })

  it('says everything is triaged rather than showing an empty table', () => {
    fx.state.lines = fx.lines.map((l) => ({ ...l, state: 'committed' as const, entry_id: 'e1' }))
    const html = triage()
    expect(html).toContain(t('meeting.nothingToTriage'))
    expect(html).not.toContain('mt-commit-bar')
  })

  it('carries the meeting notes field, writable for whoever started it', () => {
    const html = triage()
    expect(html).toContain(t('meeting.notesLabel'))
    expect(html).toContain(t('meeting.notesPlaceholder'))
    expect(html).not.toContain('mt-notes-why')
    expect(html).not.toContain(t('meeting.errNotYours'))
  })

  // The notes column is on the meeting row, which RLS gives to its creator. An
  // attendee who typed into it lost the paragraph on blur: the write was
  // refused, the optimistic apply rolled back, and the field — clean again —
  // followed the store back to the stored value.
  it('shows an attendee the notes read-only, with the reason', () => {
    fx.state.me = { id: 'u2', displayName: 'Layla', role: 'member', locale: 'en' }
    const html = triage()
    expect(html).toContain(t('meeting.notesLabel'))
    // React server-renders the DOM property name as written.
    expect(html).toMatch(/<textarea[^>]*readOnly/i)
    expect(html).toContain('mt-notes-why')
    expect(html).toContain(t('meeting.errNotYours'))
    // Triage itself is NOT gated: `meeting_lines` update is is_member().
    expect(html).toContain('mt-col-decision')
  })
})

/* ─────────────────────────────── RTL parity ────────────────────────────── */

describe('Arabic', () => {
  it('renders the same structure with no physical direction baked in', () => {
    setLocale('ar')
    const html = triage()
    // The layout is CSS logical properties end to end, so the markup is
    // direction-agnostic: same nodes, same controls, no mirrored class names.
    for (const column of ['track', 'type', 'priority', 'owner', 'due', 'decision']) {
      expect(html).toContain(`mt-col-${column}`)
    }
    expect(html).toContain('mt-commit-bar')
    // The one directional glyph on these screens is the back arrow, and it
    // carries the global mirror class rather than a per-locale variant.
    expect(live()).toContain('icon-directional')
  })
})
