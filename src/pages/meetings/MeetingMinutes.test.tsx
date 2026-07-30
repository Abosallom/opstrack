// Render proof for `/meetings/:id/minutes`.
//
// WHY renderToStaticMarkup AND NOT A DOM — the reasons pages/Entry.test.tsx
// gives: vitest.config.ts is `environment: 'node'` on purpose and the repo's
// one-new-devDependency budget went on vitest itself, so there is no jsdom and
// no testing-library. react-dom/server exercises the real component tree, the
// real hooks, the real class names and the real ARIA.
//
// WHAT IT CANNOT SEE: server rendering runs no effects, so `settled` never
// flips and the not-found branch is unreachable from here. What it proves is
// the part that matters for a DOCUMENT — that the model reaches the DOM
// intact, in the right bands, with the sheet carrying its own `lang`/`dir`.
// The document's own strings are covered exhaustively by lib/minutes.test.ts.
//
// THE CHROME IS ASSERTED THROUGH t(), never as a literal. This file was written
// before `minutes` was registered in the integrator-owned `src/locales/index.ts`
// (§1.0.2), when `t('minutes.print')` still fell back to echoing its own key,
// and the one assertion that named the toolbar baked that broken state in as
// the expectation — so registering the namespace turned it red. Going through
// t() is correct in both states and in both languages, which is why it is the
// house form everywhere else. The rest of the assertions below stay about
// STRUCTURE and about the document's strings (which come from lib/minutes.ts,
// reading the namespace files directly); `minutes.test.ts` proves every key
// this page asks for exists in both files.

import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import type { Entry, Meeting, MeetingLine, Track } from '../../types'

const fx = vi.hoisted(() => {
  // lib/i18n reads localStorage at module scope; vi.hoisted runs before the
  // import graph is evaluated, which a beforeAll() would be far too late for.
  const mem = new Map<string, string>()
  ;(globalThis as { localStorage?: Storage }).localStorage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => void mem.set(k, v),
    removeItem: (k: string) => void mem.delete(k),
    clear: () => mem.clear(),
    key: (i: number) => [...mem.keys()][i] ?? null,
    get length() {
      return mem.size
    },
  } as Storage

  const START = new Date(2026, 6, 29, 14, 5).toISOString()

  const track: Track = {
    id: 'trk-net',
    name: 'Networks',
    name_ar: 'الشبكات',
    description: '',
    description_ar: '',
    color: '#e0a020',
    color_light: '#9c6600',
    icon: 'network',
    suggested_tags: [],
    sort_order: 3,
    archived: false,
    archived_at: null,
    created_by: null,
    created_at: START,
    updated_at: START,
  }

  const meeting: Meeting = {
    id: 'm1',
    title: 'Weekly ops sync',
    track_id: 'trk-net',
    attendees: ['Aziz Alsaloom', 'Layla Al-Harbi'],
    started_at: START,
    ended_at: new Date(2026, 6, 29, 15, 10).toISOString(),
    notes: 'Vendor call next week.',
    created_by: 'u1',
  }

  const entry = (over: Partial<Entry> & { id: string }): Entry => ({
    track_id: 'trk-net',
    title: '',
    description: '',
    type: 'action',
    status: 'new',
    priority: 'medium',
    owner_id: null,
    owner_name: null,
    requester: null,
    due_date: null,
    follow_up_date: null,
    tags: [],
    links: [],
    created_by: 'u1',
    created_at: START,
    updated_at: START,
    closed_at: null,
    last_activity_at: START,
    meeting_id: 'm1',
    template_id: null,
    ...over,
  })

  const line = (seq: number, over: Partial<MeetingLine>): MeetingLine => ({
    id: `l${seq}`,
    meeting_id: 'm1',
    seq,
    raw: '',
    parsed: null,
    state: 'pending',
    entry_id: null,
    created_by: 'u1',
    created_at: START,
    updated_at: START,
    ...over,
  })

  const entries: Entry[] = [
    entry({ id: 'e1', type: 'decision', title: 'Cutover moves to 3 August' }),
    entry({
      id: 'e2',
      title: 'Fix the VPN tunnel',
      owner_id: 'u2',
      due_date: '2026-08-03',
      description: 'Vendor confirmed the window.',
    }),
  ]

  const lines: MeetingLine[] = [
    line(1, { state: 'committed', entry_id: 'e1', raw: 'cutover' }),
    line(2, { state: 'committed', entry_id: 'e2', raw: 'tunnel' }),
    line(3, { state: 'discarded', raw: 'ask about the coffee machine' }),
    // Committed, but its entry is not in the working set — the closed-during-
    // the-meeting case. It must still appear, as its own captured text.
    line(4, { state: 'committed', entry_id: 'e-gone', raw: 'rotate the certs' }),
  ]

  /** Posed per test, so one import of the tree covers every state. */
  const state = { meeting: meeting as Meeting | undefined }

  return { track, meeting, entries, lines, state }
})

vi.mock('../../store/config', () => ({
  loadConfig: () => Promise.resolve(),
  useTrackMap: () => new Map([[fx.track.id, fx.track]]),
}))

vi.mock('../../store/members', () => {
  const members = [
    { id: 'u1', displayName: 'Aziz Alsaloom', role: 'admin' as const },
    { id: 'u2', displayName: 'Layla Al-Harbi', role: 'member' as const },
  ]
  return {
    loadMembers: () => Promise.resolve(),
    useMemberMap: () => new Map(members.map((m) => [m.id, m])),
  }
})

vi.mock('../../store/vocab', () => ({
  loadVocab: () => Promise.resolve(),
  getVocabSnapshot: () => ({ rows: [], loadedAt: null }),
  vocabLabel: (_s: unknown, kind: string, key: string) => `${kind}.${key}`,
  useVocabLabel: () => (kind: string, key: string) => `${kind}.${key}`,
}))

vi.mock('../../store/entries', () => ({
  loadEntries: () => Promise.resolve(),
  loadClosedSince: () => Promise.resolve(),
  useEntryList: () => fx.entries,
  useEntryMap: () => new Map(fx.entries.map((e) => [e.id, e])),
}))

vi.mock('../../store/entrySheet', () => ({ openEntry: () => undefined }))

vi.mock('../../store/meetings', () => ({
  loadMeetings: () => Promise.resolve(),
  loadLines: () => Promise.resolve(),
  useMeeting: () => fx.state.meeting,
  useMeetingLines: () => fx.lines,
  useLinesLoading: () => false,
  useLinesError: () => null,
  useMeetingsError: () => null,
}))

const { default: MeetingMinutes } = await import('./MeetingMinutes')
const { t } = await import('../../lib/i18n')

function render(): string {
  return renderToStaticMarkup(
    <MemoryRouter initialEntries={['/meetings/m1/minutes']}>
      <Routes>
        <Route path="/meetings/:id/minutes" element={<MeetingMinutes />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('MeetingMinutes', () => {
  it('waits before it decides the meeting is missing', () => {
    fx.state.meeting = undefined
    // No effects under server rendering, so `settled` is still false — which is
    // exactly the state a first paint is in, and it must not accuse the URL of
    // being wrong.
    const html = render()
    expect(html).toContain('ops-spinner')
    expect(html).not.toContain('empty-state')
    fx.state.meeting = fx.meeting
  })

  it('renders the document, its header and every band', () => {
    const html = render()
    expect(html).toContain('Weekly ops sync')
    expect(html).toContain('29 July 2026')
    expect(html).toContain('14:05 – 15:10')
    expect(html).toContain('Networks')
    expect(html).toContain('Aziz Alsaloom')
    expect(html).toContain('Decisions')
    expect(html).toContain('Cutover moves to 3 August')
    expect(html).toContain('Actions')
    expect(html).toContain('Fix the VPN tunnel')
    expect(html).toContain('Notes')
    expect(html).toContain('ask about the coffee machine')
    expect(html).toContain('Closing notes')
    expect(html).toContain('Vendor call next week.')
  })

  it('keeps a committed line whose entry is not loaded', () => {
    expect(render()).toContain('rotate the certs')
  })

  it('stamps the sheet with the document language and direction', () => {
    // Both attributes, on the sheet and not on an ancestor: the document can be
    // written in the other direction from the app around it, and the toolbar
    // above it must not move when it is. (Which way each locale maps is
    // lib/minutes.test.ts's 'sets the document direction from the locale'.)
    expect(render()).toContain('<article class="card mdoc-sheet" lang="en" dir="ltr"')
  })

  it('gives every value its own bidi context', () => {
    // dir="auto" per value, per attendee: a Latin name in an Arabic roster (or
    // the reverse) resolves against its own first strong character instead of
    // the paragraph's, which is what stops a mixed list rendering out of order.
    const html = render()
    expect(html).toContain('<span class="mdoc-person" dir="auto">Aziz Alsaloom</span>')
    expect(html).toContain('<p class="mdoc-text" dir="auto">Fix the VPN tunnel</p>')
  })

  it('marks up actions as a task list and decisions as a numbered one', () => {
    const html = render()
    expect(html).toContain('<ol class="mdoc-list mdoc-list-tasks" role="list">')
    expect(html).toContain('mdoc-check')
    expect(html).toContain('<ol class="mdoc-list mdoc-list-numbers" role="list">')
    expect(html).toContain('<ul class="mdoc-list mdoc-list-bullets" role="list">')
  })

  it('offers a way back into the entry behind a row', () => {
    const html = render()
    // btn-icon carries global.css's 44px minimum; the label is the accessible
    // name of an icon-only control.
    expect(html).toContain('btn btn-ghost btn-icon mdoc-open')
    expect(html).toContain(`aria-label="${t('minutes.openEntry')}"`)
  })

  it('renders the toolbar outside the sheet, so chrome keeps the UI language', () => {
    const html = render()
    const bar = html.indexOf('mdoc-bar')
    const sheet = html.indexOf('mdoc-sheet')
    expect(bar).toBeGreaterThan(-1)
    expect(bar).toBeLessThan(sheet)
    expect(html).toContain('role="group"')
    expect(html).toContain('aria-pressed="true"')
  })
})
