// What a departed member's work looks like to the app — the browser half of
// migration 0012 (FIX-BACKLOG R3).
//
// THE SHAPE THIS FILE IS ABOUT. Deleting a member used to null `owner_id` and
// leave `owner_name` null with it, so every entry that person owned rendered
// "Unassigned" while the delete confirmation promised the work would stay
// "credited to their name". `0012_preserve_owner_name.sql` closes that in the
// database: a BEFORE DELETE trigger on `profiles` copies `display_name` into
// `owner_name` in the same statement that nulls `owner_id`. From that moment the
// row is INDISTINGUISHABLE FROM A VENDOR-OWNED ROW — id null, name set — which
// is a shape the app has always supported.
//
// "Has always supported" is exactly the kind of claim that rots, and the
// migration's header leans on it in writing. So this file pins it: one fixture
// entry in the post-0012 shape, put through every reader that decides what an
// owner is. If a later change makes any of them treat a name-owned row as
// unowned, the migration silently stops keeping the promise and this file fails
// instead.
//
// NOT MOCKED, ON PURPOSE. `memberLabel` is the real resolver out of
// `store/members` — every other test in the repo mocks that module, so this is
// the only place its actual body runs. Everything else it is checked against is
// a pure function from `lib/`.
//
// WHY THIS FILE LIVES IN `store/` AND NOT NEXT TO THE `lib/` functions it also
// calls. It reads across three layers at once, and only one directory in the
// repo is allowed to do that. `src/lib/` is the bottom layer: the standing
// layering grep — `grep -rn "from '\.\./store\|from '\.\./api" src/lib/` — must
// come back empty, because a `lib/` module that knows about a store is a cycle
// waiting to happen. A test file is still a file in that directory, and this one
// needs `memberLabel` (a store export) and `Member` (an api type) unmocked, so
// `lib/` cannot host it honestly. `store/` can: it already imports both, by
// design. The subject is a store function anyway — the `lib/` readers are what
// it is being checked AGAINST.
//
// OUT OF SCOPE HERE, and covered where it belongs: OwnerBadge's markup for a
// name-owned row is `components/entry/atoms.test.tsx` ("renders a free-text
// vendor identically to a teammate"), and the database side is the migration's
// own two probe blocks, which run on every application.

import { describe, expect, it, vi } from 'vitest'
import type { Entry, EntryHealth } from '../types'

vi.hoisted(() => {
  // Two module-scope reads to survive, both in the import graph of the subject:
  // lib/i18n restores the stored locale from localStorage, and store/members
  // registers a focus listener on window. vitest.config.ts is `environment:
  // 'node'`, so neither global exists; hoisting is what puts them in place
  // before the imports below are evaluated.
  const g = globalThis as Record<string, unknown>
  g.window = globalThis
  g.addEventListener = () => {}
  g.removeEventListener = () => {}
  // setLocale() writes lang/dir onto the document element on the way through.
  g.document = { documentElement: { dir: 'ltr', lang: 'en' } }
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
})

// store/members' I/O half only — `hasSession()` reads a live client and
// `listMembers()` is a network call. `memberLabel`, the subject, is untouched.
vi.mock('./auth', () => ({ hasSession: () => false }))
vi.mock('../api/members', () => ({ listMembers: () => Promise.resolve({ ok: false, error: 'x' }) }))

const { memberLabel } = await import('./members')
const { bucketFollowUps } = await import('../lib/entrySections')
const { EMPTY_FILTER, matchesFilter } = await import('../lib/entryFilter')
const { loadPerOwner } = await import('../lib/aggregate')
const { ENTRY_CSV_COLUMNS, entryCsvRow } = await import('../lib/export')
const { setLocale, t } = await import('../lib/i18n')
const { normalizeSearch } = await import('../lib/text')
import type { Member } from '../api/members'
import type { EntryCsvContext } from '../lib/export'

/** The name the deleted member had, as 0012 snapshots it onto the rows. */
const GONE = 'Ahmed Al-Otaibi'

const TODAY = '2026-07-29'

const base: Entry = {
  id: 'e-gone',
  track_id: null,
  title: 'Renew the vendor support contract',
  description: '',
  type: 'action',
  status: 'in_progress',
  priority: 'medium',
  owner_id: null,
  owner_name: null,
  requester: null,
  due_date: null,
  follow_up_date: null,
  tags: [],
  links: [],
  created_by: null,
  created_at: '2026-07-01T09:00:00Z',
  updated_at: '2026-07-28T09:00:00Z',
  closed_at: null,
  // Yesterday, so no section below can claim this row for staleness instead of
  // for its owner. The point of every assertion here is the owner and only the
  // owner.
  last_activity_at: '2026-07-28T09:00:00Z',
  meeting_id: null,
  template_id: null,
}

/** The row after 0012: the id is gone, the name is on it. */
const departed: Entry = { ...base, owner_name: GONE }

/** The same row before 0012 shipped — and the bug, in one object. */
const stripped: Entry = { ...base, id: 'e-stripped' }

/** Still here, still an account. Nothing about this row may change. */
const live: Entry = { ...base, id: 'e-live', owner_id: 'u-live' }

const roster: ReadonlyMap<string, Member> = new Map([
  ['u-live', { id: 'u-live', displayName: 'Sara Al-Harbi', role: 'member' as const }],
])

const NO_HEALTH: ReadonlyMap<string, EntryHealth> = new Map()

const sectionCtx = { meId: null, today: TODAY, staleDays: (): number => 8 }
const filterCtx = { meId: null, today: TODAY }

describe('memberLabel — the one resolver', () => {
  it('reads the carried name when the account behind the id is gone', () => {
    // The whole fix in one assertion: after 0012 the row arrives id-less and
    // named, and this is what turns it back into a person on screen.
    expect(memberLabel(roster, departed.owner_id, departed.owner_name)).toBe(GONE)
  })

  it('says Unassigned for the pre-0012 row, which is R3 exactly', () => {
    expect(memberLabel(roster, stripped.owner_id, stripped.owner_name)).toBe(t('entry.unassigned'))
  })

  it('still prefers a live member`s current display name over anything stored', () => {
    // A member who is still here must be unaffected by this change, INCLUDING a
    // row that somehow carries both — the id wins, so a rename shows everywhere.
    expect(memberLabel(roster, 'u-live', 'Stale Spelling')).toBe('Sara Al-Harbi')
  })

  it('treats a whitespace-only name as nobody, not as a person called " "', () => {
    // 0012 writes `nullif(btrim(display_name), '')` for this reason: '' and '  '
    // must both mean unassigned, on both sides of the wire.
    expect(memberLabel(roster, null, '   ')).toBe(t('entry.unassigned'))
    expect(memberLabel(roster, null, '')).toBe(t('entry.unassigned'))
  })
})

describe('the Follow-ups sections', () => {
  it('keeps a departed member`s entry out of Unassigned', () => {
    const out = bucketFollowUps([departed, stripped], NO_HEALTH, sectionCtx)
    expect(out.unassigned.map((e) => e.id)).toEqual(['e-stripped'])
  })
})

describe('the owner filter', () => {
  it('does not collect a departed member`s entry under Unassigned', () => {
    const f = { ...EMPTY_FILTER, owner: { kind: 'unassigned' as const } }
    expect(matchesFilter(departed, f, undefined, filterCtx)).toBe(false)
    expect(matchesFilter(stripped, f, undefined, filterCtx)).toBe(true)
  })

  it('finds it by name, folded, the way the picker emits it', () => {
    const f = { ...EMPTY_FILTER, owner: { kind: 'name' as const, name: '  ahmed AL-otaibi ' } }
    expect(normalizeSearch(GONE)).toBe(normalizeSearch(f.owner.name))
    expect(matchesFilter(departed, f, undefined, filterCtx)).toBe(true)
    expect(matchesFilter(live, f, undefined, filterCtx)).toBe(false)
  })
})

describe('the per-owner load on the dashboard', () => {
  it('gives the departed member their own row rather than folding them into nobody', () => {
    const rows = loadPerOwner([departed, stripped, live], NO_HEALTH, { meId: null, today: TODAY })
    const gone = rows.find((r) => r.ownerName === GONE)
    expect(gone).toBeDefined()
    expect(gone?.ownerKey).toBe(`name:${GONE}`)
    expect(gone?.ownerId).toBeNull()
    expect(gone?.open).toBe(1)
    // …and the unowned row is still its own separate thing, holding only the
    // entry that genuinely has no owner.
    expect(rows.find((r) => r.ownerKey === '')?.open).toBe(1)
  })
})

describe('the CSV export', () => {
  /** Wired exactly as pages/settings/Export.tsx wires it. */
  const ctx: EntryCsvContext = {
    trackName: () => '',
    personName: (ownerId, ownerName) => memberLabel(roster, ownerId, ownerName),
  }
  const cell = (e: Entry, column: (typeof ENTRY_CSV_COLUMNS)[number]): unknown =>
    entryCsvRow(e, ctx)[ENTRY_CSV_COLUMNS.indexOf(column)]

  it('writes the name into the resolved owner column and keeps the raw one beside it', () => {
    expect(cell(departed, 'owner')).toBe(GONE)
    expect(cell(departed, 'owner_id')).toBeNull()
    expect(cell(departed, 'owner_name')).toBe(GONE)
  })
})

describe('the delete confirmation says what the code now does', () => {
  // The sentence changed with the behaviour: entries keep the name (0012), while
  // updates and meeting notes keep only the row — `entry_updates.author_id` and
  // `meetings.created_by` have no name column to carry, so the copy no longer
  // claims they do. This asserts the string still RESOLVES and still takes the
  // one token Members.tsx passes it; the promise itself is proved by 0012's
  // probes, not by matching prose here.
  it('resolves with its {name} token in both languages', () => {
    for (const locale of ['en', 'ar'] as const) {
      setLocale(locale)
      const out = t('members.deleteBody', { name: GONE })
      expect(out).not.toBe('members.deleteBody')
      expect(out).toContain(GONE)
      expect(out).not.toMatch(/\{[a-zA-Z]+\}/)
    }
    setLocale('en')
  })
})

describe('memberLabel survives a malformed cached member', () => {
  // REGRESSION. The members map is rehydrated from an unvalidated localStorage
  // cache, so a row written by an older build can carry undefined where the
  // Member type promises a string. `?.displayName.trim()` — optional on the
  // lookup but NOT on the field — threw for real during the Mindtree build and
  // white-screened every list at once, because memberLabel runs on every owner
  // badge on every screen. The cast is the point of the test: it reproduces
  // data the type system says cannot exist but the cache can produce.
  const broken = new Map<string, Member>([
    ['m1', { id: 'm1', displayName: undefined, role: 'member' } as unknown as Member],
    ['m2', { id: 'm2', displayName: '   ', role: 'member' } as unknown as Member],
  ])

  it('falls through to the free-text name instead of throwing', () => {
    expect(() => memberLabel(broken, 'm1', 'Bandar')).not.toThrow()
    expect(memberLabel(broken, 'm1', 'Bandar')).toBe('Bandar')
  })

  it('falls through to Unassigned when there is nothing else', () => {
    expect(memberLabel(broken, 'm1', null)).toBe(t('entry.unassigned'))
    expect(memberLabel(broken, 'm2', null)).toBe(t('entry.unassigned'))
  })

  it('still prefers a well-formed member over the free text', () => {
    const ok = new Map<string, Member>([
      ['m3', { id: 'm3', displayName: 'Layla', role: 'member' } as unknown as Member],
    ])
    expect(memberLabel(ok, 'm3', 'stale free text')).toBe('Layla')
  })
})
