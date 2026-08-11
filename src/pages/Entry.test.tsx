// Render proof for the `/entry/:id` page, its overlay host, and the one rule
// the detail surface shares with the notification inbox.
//
// WHY renderToStaticMarkup AND NOT A DOM — the same reasons entry/atoms.test.tsx
// gives: vitest.config.ts is `environment: 'node'` on purpose and the repo's
// one-new-devDependency budget was spent on vitest itself, so there is no jsdom
// and no testing-library. react-dom/server exercises the real component tree,
// the real hooks, the real class names and the real ARIA.
//
// WHAT IT CANNOT SEE, and this is the honest limitation: server rendering does
// not run effects. The deep-link probe, the four self-loading store warmups and
// the not-found verdict they resolve all live in effects, so this file proves
// the surface renders every state it can reach WITHOUT them — the wait, the
// loaded entry, the frame, the host's stand-down rule — and Wave 2 gate (b)/(c)
// covers the rest against the live project with two real browser sessions.
//
// WHY THE MOCKS. Four stores read `window` or `localStorage` at module init and
// two of them register a `focus` listener there, which is fatal under `node`.
// Mocking exactly the stores keeps everything else real: the real `t()`, the
// real `lib/dates`, the real pickers, the real `store/entrySheet` (a pure
// zustand store, which is the point of the sibling assertions below).

import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import type { Entry, EntryHealth, EntryUpdate, Track } from '../types'

const fx = vi.hoisted(() => {
  // `lib/i18n` calls localStorage.getItem() at module scope. Installed here
  // because vi.hoisted runs before the import graph is evaluated; a beforeAll()
  // would be far too late.
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

  const track: Track = {
    id: 'trk-net',
    name: 'Networks',
    name_ar: 'الشبكات',
    description: '',
    description_ar: '',
    color: '#e0a020',
    color_light: '#9c6600',
    icon: 'network',
    suggested_tags: ['vendor'],
    sort_order: 3,
    archived: false,
    archived_at: null,
    created_by: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  }

  const entry: Entry = {
    id: 'e1',
    track_id: 'trk-net',
    node_id: null,
    title: 'Core switch firmware upgrade',
    description: 'Vendor confirmed the window.',
    type: 'change',
    status: 'in_progress',
    priority: 'critical',
    owner_id: 'u1',
    owner_name: null,
    requester: 'Finance',
    due_date: '2026-07-25',
    follow_up_date: '2026-08-04',
    tags: ['network'],
    links: [],
    created_by: 'u1',
    created_at: '2026-07-01T09:00:00Z',
    updated_at: '2026-07-20T09:00:00Z',
    closed_at: null,
    last_activity_at: '2026-07-20T09:00:00Z',
    meeting_id: null,
    template_id: null,
  }

  const health: EntryHealth = {
    id: 'e1',
    entry_id: 'e1',
    track_id: 'trk-net',
    status: 'in_progress',
    priority: 'critical',
    due_date: '2026-07-25',
    last_activity_at: '2026-07-20T09:00:00Z',
    days_since_activity: 9,
    days_overdue: 4,
    health: 'overdue',
    sla_due_at: null,
    sla_breached: false,
  }

  const update: EntryUpdate = {
    id: 'up1',
    entry_id: 'e1',
    author_id: 'u2',
    body: 'Vendor sent the firmware bundle.',
    status_from: null,
    status_to: null,
    created_at: '2026-07-20T09:00:00Z',
  }

  // Mutable so each test can pose the store without re-importing the tree.
  const state = {
    entry: undefined as Entry | undefined,
    flash: undefined as { actorId: string | null; actorName: string | null; kind: 'new' | 'edit' | 'update'; at: number } | undefined,
  }

  return { track, entry, health, update, state }
})

vi.mock('../store/config', () => ({
  loadConfig: () => Promise.resolve(),
  useTrackMap: () => new Map([[fx.track.id, fx.track]]),
  useActiveTracks: () => [fx.track],
}))

vi.mock('../store/members', () => {
  const members = [
    { id: 'u1', displayName: 'Aziz Alsaloom', role: 'admin' as const },
    // The renamer from api/notifications.ts's header: the live profile says one
    // thing, a stored snapshot could say another.
    { id: 'u2', displayName: 'Layla Al-Harbi', role: 'member' as const },
  ]
  return {
    loadMembers: () => Promise.resolve(),
    useMembers: () => members,
    useMemberMap: () => new Map(members.map((m) => [m.id, m])),
    useMemberLabel:
      () =>
      (ownerId?: string | null, ownerName?: string | null): string =>
        members.find((m) => m.id === ownerId)?.displayName ?? (ownerName || 'Unassigned'),
  }
})

vi.mock('../store/vocab', () => {
  const LABELS: Record<string, string> = {
    'status:new': 'New',
    'status:in_progress': 'In progress',
    'priority:critical': 'Critical',
    'type:change': 'Change',
  }
  const row = (kind: string, key: string) => ({
    kind,
    key,
    label: LABELS[`${kind}:${key}`] ?? key,
    color: null,
    hidden: false,
    sortOrder: 0,
    staleAfterDays: null,
    slaDays: null,
  })
  const all = (kind: string) =>
    kind === 'status'
      ? [row('status', 'new'), row('status', 'in_progress')]
      : kind === 'priority'
        ? [row('priority', 'critical')]
        : [row('type', 'change')]
  return {
    loadVocab: () => Promise.resolve(),
    useVocab: all,
    useVocabAll: all,
    useVocabLabel: () => (kind: string, key: string) => LABELS[`${kind}:${key}`] ?? key,
    useVocabColor: () => () => null,
  }
})

vi.mock('../store/auth', () => ({
  useAuth: () => ({
    loading: false,
    session: {},
    profile: { id: 'u1', displayName: 'Aziz Alsaloom', role: 'admin', locale: 'en' },
  }),
}))

// The whole store, because it registers a window focus listener at module init
// and because posing "this entry is missing" is the point of half these tests.
vi.mock('../store/entries', () => ({
  useEntry: () => fx.state.entry,
  useEntryHealth: () => (fx.state.entry ? fx.health : undefined),
  usePendingOp: () => undefined,
  useEntryFlash: () => fx.state.flash,
  useEntryUpdates: () => ({
    updates: fx.state.entry ? [fx.update] : [],
    loading: false,
    error: null,
  }),
  loadEntries: () => Promise.resolve(),
  loadUpdates: () => Promise.resolve(),
  patchEntry: () => Promise.resolve({ ok: true, data: fx.entry }),
  postUpdate: () => Promise.resolve({ ok: true, data: fx.update }),
  applyServerRow: () => undefined,
}))

// api/entries pulls in api/supabase, which builds a client from import.meta.env
// at module scope. Nothing here should reach the network.
vi.mock('../api/entries', () => ({
  getEntry: () => Promise.resolve({ ok: true, data: null }),
}))

const Entry = (await import('./Entry')).default
const { EntryOverlayHost } = await import('./Entry')
const { flashSentence, probeOutlivedItsRow } = await import('../components/entry/EntrySheet')
const { closeEntry, openEntry } = await import('../store/entrySheet')
const { t } = await import('../lib/i18n')

const esc = (s: string): string =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')

/** The page as the router mounts it: `/entry/:id`, params and all. */
function page(id = 'e1'): string {
  return renderToStaticMarkup(
    <MemoryRouter initialEntries={[`/entry/${id}`]}>
      <Routes>
        <Route path="/entry/:id" element={<Entry />} />
      </Routes>
    </MemoryRouter>,
  )
}

function host(path: string): string {
  return renderToStaticMarkup(
    <MemoryRouter initialEntries={[path]}>
      <EntryOverlayHost />
    </MemoryRouter>,
  )
}

// ── the probe, after the row it answered about disappears ──────────────────
//
// The surface's not-found state has one job it must be right about: telling
// "gone" apart from "not loaded yet". The probe decides that, and it refuses to
// re-ask about an id it has already answered for — the guard that stops J/K
// from firing a read per keypress. So a row that leaves `byId` AFTER a
// successful probe strands the panel on "this entry was deleted" for an entry
// that is merely done, which is precisely the lie the probe exists to prevent.
//
// Asserted as a pure decision rather than through a render because this file
// runs under `environment: 'node'` and effects do not run in
// renderToStaticMarkup — the limitation this file's header already states.
describe('probeOutlivedItsRow — a row that vanishes is not a row that never was', () => {
  const answered = { id: 'e1', done: true, error: null }

  it('re-arms the probe when a row this surface HELD disappears', () => {
    expect(probeOutlivedItsRow('e1', false, 'e1', answered)).toBe(true)
  })

  it('leaves the deep-link case alone — no row was ever held', () => {
    // Opened from a chat message: there is no row and there never was one. The
    // probe's own effect owns this, and re-arming here would loop it.
    expect(probeOutlivedItsRow('e1', false, null, null)).toBe(false)
    expect(probeOutlivedItsRow('e1', false, null, answered)).toBe(false)
  })

  it('says nothing while the row is present', () => {
    expect(probeOutlivedItsRow('e1', true, 'e1', answered)).toBe(false)
  })

  it('does not contradict a probe that is still out, or one about another entry', () => {
    expect(probeOutlivedItsRow('e1', false, 'e1', { id: 'e1', done: false, error: null })).toBe(false)
    // Stepped to e2 with J while e1's read was in flight.
    expect(probeOutlivedItsRow('e2', false, 'e2', answered)).toBe(false)
  })

  it('holds for the error branch too — a failed read is not evidence either', () => {
    // The retry affordance is the right control for this state, and re-arming
    // reaches it: the second read decides between error and not-found afresh.
    expect(probeOutlivedItsRow('e1', false, 'e1', { id: 'e1', done: true, error: 'common.error' })).toBe(true)
  })

  it('is inert with no entry in the URL at all', () => {
    expect(probeOutlivedItsRow(null, false, 'e1', answered)).toBe(false)
  })
})

describe('flashSentence — the notifications resolution order', () => {
  const members = new Map([
    ['u2', { id: 'u2', displayName: 'Layla Al-Harbi', role: 'member' as const }],
  ])

  it('prefers the LIVE profile over the stored snapshot', () => {
    // api/notifications.ts's header: `actor_name` is forgeable (a member may
    // rename themselves, act, and rename back), `actor_id` is durable. The live
    // name must win, or an entry can be made to say it was updated by anyone.
    const out = flashSentence(
      { actorId: 'u2', actorName: 'Aziz Alsaloom', kind: 'edit', at: 0 },
      members,
    )
    expect(out).toBe(t('entry.updatedBy', { name: 'Layla Al-Harbi' }))
    expect(out).not.toContain('Aziz')
  })

  it('falls back to the snapshot only for an actor whose profile is gone', () => {
    const out = flashSentence({ actorId: 'u9', actorName: 'Removed Person', kind: 'edit', at: 0 }, members)
    expect(out).toBe(t('entry.updatedBy', { name: 'Removed Person' }))
  })

  it('never invents a name — an unresolvable actor gets the actor-less sentence', () => {
    // This is the case realtime actually produces: `entries` carries no actor
    // column, so a patch with no correlated thread row has nobody to name.
    expect(flashSentence({ actorId: null, actorName: null, kind: 'edit', at: 0 }, members)).toBe(
      t('entry.updatedGeneric'),
    )
    expect(flashSentence({ actorId: 'u9', actorName: '   ', kind: 'edit', at: 0 }, members)).toBe(
      t('entry.updatedGeneric'),
    )
  })

  it('uses the sentence that matches what happened', () => {
    const mark = { actorId: 'u2', actorName: null }
    expect(flashSentence({ ...mark, kind: 'new', at: 0 }, members)).toBe(
      t('entry.flashNew', { name: 'Layla Al-Harbi' }),
    )
    expect(flashSentence({ ...mark, kind: 'update', at: 0 }, members)).toBe(
      t('entry.flashUpdate', { name: 'Layla Al-Harbi' }),
    )
  })
})

describe('/entry/:id page', () => {
  it('renders the page frame, not a dialog — a deep link has no list behind it', () => {
    fx.state.entry = fx.entry
    fx.state.flash = undefined
    const out = page()
    expect(out).toContain('class="epg"')
    expect(out).toContain('class="epg-bar"')
    expect(out).toContain('class="epg-body"')
    // The overlay's chrome must be nowhere near it.
    expect(out).not.toContain('role="dialog"')
    expect(out).not.toContain('sheetx-scrim')
  })

  it('shows the entry, its thread and its provenance', () => {
    fx.state.entry = fx.entry
    const out = page()
    expect(out).toContain(esc(fx.entry.title))
    expect(out).toContain(esc(fx.update.body))
    // The thread author resolves through the member map, not the raw id.
    expect(out).toContain('Layla Al-Harbi')
    expect(out).toContain('sheetx-provenance')
  })

  it('offers back and copy-link, and hides copy-link when there is nothing to link to', () => {
    fx.state.entry = fx.entry
    expect(page()).toContain(esc(t('entry.copyLink')))
    fx.state.entry = undefined
    const missing = page()
    expect(missing).toContain(esc(t('common.back')))
    expect(missing).not.toContain(esc(t('entry.copyLink')))
  })

  it('waits rather than claiming the entry is gone', () => {
    // Server rendering runs no effects, so the deep-link probe has not answered
    // — which is exactly the state this assertion is about: an unanswered probe
    // must read as "loading", never as "deleted". Reporting "deleted" for
    // "still fetching" sends someone looking for a culprit.
    fx.state.entry = undefined
    const out = page()
    expect(out).toContain(`aria-label="${esc(t('common.loading'))}"`)
    expect(out).toContain('class="skeleton"')
    expect(out).not.toContain(esc(t('entry.notFound')))
  })

  it('shows the updated-by flash from another session, resolved through the member map', () => {
    fx.state.entry = fx.entry
    fx.state.flash = { actorId: 'u2', actorName: null, kind: 'edit', at: Date.now() }
    const out = page()
    expect(out).toContain('sheetx-flash')
    expect(out).toContain('aria-live="polite"')
    expect(out).toContain(esc(t('entry.updatedBy', { name: 'Layla Al-Harbi' })))
    fx.state.flash = undefined
  })

  // R2-A11Y-4. The region has to be in the DOM BEFORE the sentence is, because
  // assistive tech announces content inserted into an already-present live
  // region and swallows a region that arrives carrying its own text. The old
  // `{flash && <p aria-live>…</p>}` was exactly that swallowed case: the sheet
  // had no working announcement of a teammate's remote edit at all, so a screen
  // reader user read a value, acted on it, and found out it had moved when
  // their own edit was refused. toast.tsx:210 states the rule; Board.tsx:1655
  // follows it; this surface did not.
  it('mounts the flash live region even with nothing to announce', () => {
    fx.state.entry = fx.entry
    fx.state.flash = undefined
    const out = page()
    expect(out).toContain('class="sheetx-flash" aria-live="polite"')
    // Present and EMPTY — `.sheetx-flash:empty` collapses the box in CSS rather
    // than `display: none`, which would take it back out of the a11y tree.
    expect(out).toContain('<p class="sheetx-flash" aria-live="polite"></p>')
    expect(out).not.toContain('sheetx-flash-text')
  })

  it('puts the sentence in a keyed child so a repeat edit re-announces', () => {
    // Two edits by the same colleague resolve to the SAME string; without a new
    // node the region has no insertion to announce. The key is the mark's
    // timestamp, so the span re-mounts per mark.
    fx.state.entry = fx.entry
    fx.state.flash = { actorId: 'u2', actorName: null, kind: 'edit', at: 1 }
    const out = page()
    expect(out).toContain('<span class="sheetx-flash-text">')
    // The region itself is the same element in both states — that is the point.
    expect(out).toContain('class="sheetx-flash" aria-live="polite"')
    fx.state.flash = undefined
  })

  it('offers no stepper on a cold deep link', () => {
    // Nothing has opened a list, so there are no siblings — and two permanently
    // dead arrows are worse than none, which is the opposite of the overlay's
    // choice because the overlay is always opened FROM a list.
    //
    // The other half of this rule — arrows appearing once a list IS being
    // walked — is deliberately not asserted here: zustand v5 serves
    // `getInitialState` as the server snapshot, so a store written before
    // renderToStaticMarkup() is invisible to it. store/entrySheet.test.ts owns
    // the sibling derivation, and Wave 2 gate (b) walks it in a browser.
    fx.state.entry = fx.entry
    closeEntry()
    expect(page()).not.toContain(esc(t('entry.next')))
  })
})

describe('EntryOverlayHost', () => {
  it('renders nothing when no entry is open', () => {
    closeEntry()
    expect(host('/followups')).toBe('')
  })

  it('stands down on the entry route, so the page and a panel cannot both paint', () => {
    // The route calls openEntry() itself — that is how the rest of the app
    // learns what is open — so without this rule a deep link would render the
    // page and an overlay over it, both bound to the same entry.
    openEntry('e1')
    expect(host('/entry/e1')).toBe('')
    closeEntry()
  })
})

describe('the kit is imported, never re-implemented', () => {
  it('renders the shared detail groupings rather than a second copy of them', () => {
    fx.state.entry = fx.entry
    const out = page()
    // sheet.css calls these "generic groupings the sheet's children compose";
    // the page composes the same ones. If this ever fails because the classes
    // were renamed to `.epg-section`, sixty lines of CSS have been duplicated.
    expect(out).toContain('sheetx-section')
    expect(out).toContain('sheetx-meta')
    // The pickers, fields and atoms are the kit's, not this page's: a picker
    // rendered here under a `.epg-` class would mean one was re-implemented.
    expect(out).toContain('class="pick pick-chips"')
    expect(out).toContain('class="fld-row"')
    expect(out).toContain('track-ref')
    expect(out).not.toContain('epg-section')
  })
})
