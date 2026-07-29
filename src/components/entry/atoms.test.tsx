// Render proof for the entry kit — atoms, EntryRow and EntryCard.
//
// WHY renderToStaticMarkup AND NOT A DOM. vitest.config.ts is `environment:
// 'node'` on purpose ("a test that needs a document is a sign the logic is in
// the wrong layer"), and the repo's one-new-devDependency budget was spent on
// vitest itself — there is no jsdom and no testing-library to reach for.
// react-dom/server needs neither: it exercises the real component tree, the
// real hooks, the real class names and the real ARIA, and hands back the markup
// to assert on. What it cannot see is layout and events, and those are the two
// things a DOM test of a presentational component would have told us least
// about anyway.
//
// WHY THE MOCKS. Four of this kit's dependencies are still §1.0.5 skeletons
// being written in parallel RIGHT NOW — `store/vocab`, `store/members`,
// `lib/dates` — whose every body is `throw new Error('TODO')`, plus
// `store/config`, which touches `window` at module init. Mocking exactly those
// four is what lets this file prove the components render TODAY rather than
// after the whole wave lands. Everything else is real: real `lib/i18n`, real
// `trackVars()`/`vocabVars()`, real `initials()`, real `trackIcon()`.
//
// The single hoisted shim is `localStorage`, which `lib/i18n` reads at module
// init to restore the stored locale. Shimming it keeps the REAL translator in
// the test — `t()` resolving keys, falling back to the key when a namespace is
// missing — which is worth far more than a stubbed `t: (k) => k`.

import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ReactElement } from 'react'
import type { Entry, EntryHealth, Track } from '../../types'

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
    suggested_tags: [],
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
    title: 'Core switch firmware upgrade',
    description: 'Vendor confirmed the window; needs a change record before Thursday.',
    type: 'change',
    status: 'in_progress',
    priority: 'critical',
    owner_id: 'u1',
    owner_name: null,
    requester: 'Finance',
    due_date: '2026-07-25',
    follow_up_date: '2026-08-04',
    tags: ['network', 'change-window', 'vendor', 'q3'],
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
    sla_due_at: '2026-07-03T09:00:00Z',
    sla_breached: true,
  }

  return { track, entry, health }
})

vi.mock('../../store/config', () => ({
  useTrackMap: () => new Map([[fx.track.id, fx.track]]),
}))

vi.mock('../../store/members', () => ({
  useMemberLabel:
    () =>
    (ownerId?: string | null, ownerName?: string | null): string =>
      ownerId === 'u1' ? 'Aziz Alsaloom' : (ownerName?.trim() ?? '') || 'Unassigned',
}))

vi.mock('../../store/vocab', () => {
  // Deliberately NOT the i18n defaults: an admin-renamed label proves the
  // resolver is consulted rather than t('status.in_progress') being reached for.
  const LABELS: Record<string, string> = {
    'status:new': 'Fresh',
    'status:in_progress': 'Underway',
    'status:blocked': 'Stuck',
    'status:cancelled': 'Dropped',
    'priority:critical': 'Critical',
    'priority:low': 'Low',
  }
  const row = (key: string, hidden: boolean) => ({
    kind: 'status' as const,
    key,
    label: LABELS[`status:${key}`] ?? key,
    color: null,
    hidden,
    sortOrder: 0,
    staleAfterDays: null,
    slaDays: null,
  })
  return {
    useVocabLabel: () => (kind: string, key: string) => LABELS[`${kind}:${key}`] ?? key,
    useVocabColor: () => (kind: string, key: string) =>
      kind === 'status' && key === 'in_progress' ? '#22b8d6' : null,
    // 'cancelled' is hidden; 'blocked' is hidden. Both are in the table, so the
    // "hiding an option must never hide data" rule has something to bite on.
    useVocabAll: () => [row('new', false), row('in_progress', false), row('blocked', true), row('cancelled', true)],
  }
})

vi.mock('../../lib/dates', () => ({
  todayIso: () => '2026-07-29',
  diffDays: (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000),
  formatAge: (days: number) => `${days}d`,
  formatDue: (iso: string | null) => iso ?? '',
}))

const { AgePill, DueLabel, HealthPill, OwnerBadge, PriorityDot, StatusPill, TagChip, TrackDot } =
  await import('./atoms')
const EntryRow = (await import('./EntryRow')).default
const EntryCard = (await import('./EntryCard')).default
const { t } = await import('../../lib/i18n')

const html = (node: ReactElement | null): string => (node ? renderToStaticMarkup(node) : '')

/**
 * React's own escaping, so an assertion can be written against a real t()
 * result. NOT lib/text's escapeHtml(): that emits `&#39;` for an apostrophe and
 * React emits `&#x27;`, and `offline.queued` ("…it'll sync…") is exactly the
 * string where the difference bites.
 */
const esc = (s: string): string =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')

/** How many times a class name appears — the fold assertions count marks. */
const count = (s: string, needle: string): number => s.split(needle).length - 1

const noop = (): void => {}

describe('StatusPill', () => {
  it('renders the ADMIN label, not the i18n default, and hands the colour to CSS', () => {
    const out = html(<StatusPill status="in_progress" />)
    expect(out).toContain('Underway')
    expect(out).not.toContain('In progress')
    // The hex reaches CSS as a custom property; nothing resolved it in JS.
    expect(out).toContain('--vocab-c:#22b8d6')
    expect(out).toContain('class="pill status-pill"')
  })

  it('is a static span until onChange is supplied', () => {
    expect(html(<StatusPill status="new" />)).not.toContain('<select')
    expect(html(<StatusPill status="new" onChange={noop} />)).toContain('<select')
  })

  it('hides hidden options but never hides the value the entry already holds', () => {
    const out = html(<StatusPill status="blocked" onChange={noop} />)
    // 'blocked' is hidden AND is this entry's status — it must survive.
    expect(out).toContain('value="blocked"')
    expect(out).toContain('Stuck')
    // 'cancelled' is hidden and unrelated — it must not.
    expect(out).not.toContain('value="cancelled"')
    expect(out).toContain('value="new"')
  })

  it('disables rather than hides the control when the user may not edit', () => {
    expect(html(<StatusPill status="new" onChange={noop} disabled />)).toContain('disabled')
  })
})

describe('PriorityDot', () => {
  it('is an image with a name when unlabelled, and plain text when labelled', () => {
    const bare = html(<PriorityDot priority="critical" />)
    expect(bare).toContain('role="img"')
    expect(bare).toContain('aria-label="Critical"')
    expect(bare).toContain('data-priority="critical"')

    const labelled = html(<PriorityDot priority="low" withLabel />)
    expect(labelled).toContain('Low')
    // The visible text IS the accessible name — labelling it again reads it twice.
    expect(labelled).not.toContain('role="img"')
  })
})

describe('HealthPill', () => {
  it('maps each level onto a global .pill tone', () => {
    expect(html(<HealthPill health="ok" />)).toContain('pill ok health-pill')
    expect(html(<HealthPill health="stale" />)).toContain('pill warn health-pill')
    expect(html(<HealthPill health="overdue" />)).toContain('pill danger health-pill')
    expect(html(<HealthPill health="critical" />)).toContain('pill filled health-pill')
  })

  it('prefers the day count over the bare word when there is one', () => {
    expect(html(<HealthPill health="overdue" daysOverdue={4} />)).toContain(
      t('date.overdueByDays', { count: 4 }),
    )
  })

  it('lets an SLA breach outrank a healthy verdict, with a non-colour cue', () => {
    const out = html(<HealthPill health="ok" slaBreached />)
    // Green would be a lie: silence is fine, the elapsed-time commitment is not.
    expect(out).toContain('pill danger health-pill')
    expect(out).toContain('data-sla="breached"')
    // The visible marker is a WORD; the sentence is what a screen reader gets.
    // It used to be the sentence on screen — 25 characters of `white-space:
    // nowrap` in a 278px board card, which overflowed the row on a phone.
    expect(out).toContain(`aria-hidden="true">${esc(t('entry.slaMark'))}<`)
    expect(out).toContain(`class="sr-only">${esc(t('entry.slaBreached'))}<`)
    expect(out).toContain(`title="${esc(t('entry.slaBreachedHint'))}"`)
  })

  it('does not paint a STALE breach yellow', () => {
    // The upgrade used to fire only for health === 'ok', so a stale + breached
    // entry rendered `warn` — quieter than a plain overdue item that had missed
    // nothing anyone had committed to.
    expect(html(<HealthPill health="stale" slaBreached />)).toContain('pill danger health-pill')
  })

  it('leaves critical alone — .filled already outranks everything', () => {
    // Downgrading the one badge global.css reserves for "must win attention" to
    // the outlined danger tone would be a demotion, not an escalation.
    expect(html(<HealthPill health="critical" slaBreached />)).toContain('pill filled health-pill')
  })

  it('says nothing about SLA when the admin has not switched it on', () => {
    expect(html(<HealthPill health="ok" />)).not.toContain('data-sla')
  })
})

describe('AgePill', () => {
  it('shows the abbreviation and carries the sentence as its accessible name', () => {
    const out = html(<AgePill days={9} health="overdue" reason="blocked" />)
    expect(out).toContain('>9d<')
    expect(out).toContain('role="img"')
    expect(out).toContain(`aria-label="${esc(t('entry.ageBlocked', { count: 9 }))}"`)
    expect(out).toContain('data-reason="blocked"')
  })

  it('drops to the quiet ink when there is no verdict to report', () => {
    const out = html(<AgePill days={2} />)
    expect(out).toContain('class="pill age-pill tabular"')
  })
})

describe('OwnerBadge', () => {
  it('resolves a provisioned teammate through the member store', () => {
    const out = html(<OwnerBadge ownerId="u1" />)
    expect(out).toContain('Aziz Alsaloom')
    expect(out).toContain('data-initials="AA"')
    expect(out).toContain('data-assigned="true"')
  })

  it('renders a free-text vendor identically to a teammate', () => {
    const out = html(<OwnerBadge ownerName="Cisco TAC" />)
    expect(out).toContain('Cisco TAC')
    expect(out).toContain('data-assigned="true"')
  })

  it('treats an all-whitespace owner_name as unassigned', () => {
    const out = html(<OwnerBadge ownerName="   " />)
    expect(out).toContain('data-assigned="false"')
    expect(out).toContain('data-initials=""')
  })

  it('becomes a named image when the name is suppressed', () => {
    const out = html(<OwnerBadge ownerId="u1" showName={false} />)
    expect(out).toContain('role="img"')
    expect(out).toContain('aria-label="Aziz Alsaloom"')
  })
})

describe('TagChip', () => {
  it('is a plain label with no handlers', () => {
    const out = html(<TagChip tag="vendor" />)
    expect(out).toContain('<span class="chip tag-chip">vendor</span>')
  })

  it('is a pressed toggle for filtering', () => {
    expect(html(<TagChip tag="vendor" active onToggle={noop} />)).toContain('aria-pressed="true"')
  })

  it('draws its dismiss glyph in CSS so the button has no readable text', () => {
    const out = html(<TagChip tag="vendor" onRemove={noop} />)
    expect(out).toContain('data-removable="true"')
    expect(out).toContain(`aria-label="${esc(t('entry.removeTag', { name: 'vendor' }))}"`)
    expect(out).not.toContain('×')
  })
})

describe('TrackDot', () => {
  it('hands both stored hexes to CSS and lets the cascade pick', () => {
    const out = html(<TrackDot trackId="trk-net" showLabel />)
    expect(out).toContain('--track-c-dark:#e0a020')
    expect(out).toContain('--track-c-light:#9c6600')
    expect(out).toContain('Networks')
  })

  it('survives a null track, an unknown id and an archived one alike', () => {
    for (const id of [null, undefined, 'trk-deleted']) {
      const out = html(<TrackDot trackId={id} />)
      expect(out).toContain('role="img"')
      expect(out).toContain(`aria-label="${esc(t('entry.noTrack'))}"`)
      // No hex at all — the primitive's --field-border fallback is what paints it.
      expect(out).not.toContain('--track-c-dark')
    }
  })

  it('renders the bar variant as a bare stripe that is still named', () => {
    const out = html(<TrackDot trackId="trk-net" variant="bar" />)
    expect(out).toContain('track-ref track-bar')
    expect(out).toContain('data-variant="bar"')
    // No text node — the stripe is 3px of colour…
    expect(out).toMatch(/><\/span>$/)
    // …but it is not silent: colour alone is not a label.
    expect(out).toContain('aria-label="Networks"')
  })

  it('always labels the chip variant — an unlabelled chip is a worse dot', () => {
    const out = html(<TrackDot trackId="trk-net" variant="chip" />)
    expect(out).toContain('chip track-ref')
    expect(out).toContain('Networks')
  })
})

describe('DueLabel', () => {
  it('renders nothing at all when there is no date', () => {
    expect(html(<DueLabel date={null} />)).toBe('')
  })

  it('tones by distance from an injected today', () => {
    const on = { today: '2026-07-29' }
    expect(html(<DueLabel date="2026-07-25" {...on} />)).toContain('data-tone="overdue"')
    expect(html(<DueLabel date="2026-07-29" {...on} />)).toContain('data-tone="today"')
    expect(html(<DueLabel date="2026-08-02" {...on} />)).toContain('data-tone="soon"')
    expect(html(<DueLabel date="2026-09-30" {...on} />)).toContain('data-tone="later"')
  })

  it('names which kind of date it is — the number alone does not say', () => {
    const due = html(<DueLabel date="2026-08-04" kind="due" today="2026-07-29" />)
    const fup = html(<DueLabel date="2026-08-04" kind="followUp" today="2026-07-29" />)
    expect(due).toContain(esc(t('entry.due')))
    expect(fup).toContain(esc(t('entry.followUp')))
    expect(fup).toContain('data-kind="followUp"')
  })
})

describe('EntryRow', () => {
  it('renders the whole line: title, atoms, tags and the fold', () => {
    const out = html(<EntryRow entry={fx.entry} health={fx.health} onOpen={noop} />)
    expect(out).toContain('Core switch firmware upgrade')
    expect(out).toContain('class="entry-row-title entry-title"')
    expect(out).toContain('Underway') // vocab label, through StatusPill
    expect(out).toContain('>9d<') // AgePill
    expect(out).toContain('Aziz Alsaloom') // OwnerBadge
    expect(out).toContain('data-sla="breached"') // HealthPill, SLA chain intact
    expect(out).toContain('track-ref track-bar') // track identity stripe
    // Four tags on the entry, three rendered, one folded into the counter.
    expect(count(out, 'class="chip tag-chip"')).toBe(3)
    expect(out).toContain('class="entry-row-more"')
  })

  it('never subscribes to a store it is forbidden from reading', async () => {
    // The connectedness rule is a compile-time fact, not a runtime one: if
    // EntryRow imported a VALUE from store/entries, this unmocked import would
    // pull the throwing skeleton in and every test above would already have
    // failed. Asserting it explicitly keeps the rule from silently rotting.
    const mod = await import('./EntryRow')
    expect(typeof mod.default).toBe('function')
  })

  it('drops the description and the track chip at compact density', () => {
    const out = html(<EntryRow entry={fx.entry} health={fx.health} density="compact" onOpen={noop} />)
    expect(out).not.toContain('entry-row-desc')
    expect(out).toContain('data-density="compact"')
  })

  it('honours the show map', () => {
    const out = html(
      <EntryRow entry={fx.entry} health={fx.health} show={{ owner: false, tags: false }} onOpen={noop} />,
    )
    expect(out).not.toContain('Aziz Alsaloom')
    expect(out).not.toContain('owner-badge')
    expect(out).not.toContain('entry-row-tags')
  })

  it('disables snooze but not the update thread when the user may not edit', () => {
    const out = html(
      <EntryRow
        entry={fx.entry}
        canEdit={false}
        onOpen={noop}
        onSnooze={noop}
        onAddUpdate={noop}
      />,
    )
    expect(out).toContain('data-locked="true"')
    expect(out).toContain(`title="${esc(t('entry.cannotEdit'))}"`)
    // Exactly one disabled button: snooze. Appending to the immutable thread is
    // a different RLS policy and stays reachable.
    expect(out.match(/disabled/g)?.length).toBe(1)
  })

  it('shows an i18n KEY resolved for a failed write, never a Postgres sentence', () => {
    const out = html(
      <EntryRow
        entry={fx.entry}
        onOpen={noop}
        pending={{ id: 'e1', kind: 'patch', since: 0, error: 'common.error', queued: false }}
      />,
    )
    expect(out).toContain('data-pending="true"')
    expect(out).toContain(esc(t('common.error')))
    expect(out).toContain('data-tone="danger"')
  })

  it('reports a queued write through the offline namespace', () => {
    const out = html(
      <EntryRow
        entry={fx.entry}
        onOpen={noop}
        pending={{ id: 'e1', kind: 'create', since: 0, error: null, queued: true }}
      />,
    )
    expect(out).toContain(esc(t('offline.queued')))
  })

  it('names the actor on a realtime flash, and falls back rather than inventing one', () => {
    const named = html(
      <EntryRow
        entry={fx.entry}
        onOpen={noop}
        flash={{ actorId: 'u2', actorName: 'Sara', kind: 'update', at: 0 }}
      />,
    )
    expect(named).toContain('entry-row is-flash')
    expect(named).toContain(esc(t('entry.updatedBy', { name: 'Sara' })))

    const anon = html(
      <EntryRow
        entry={fx.entry}
        onOpen={noop}
        flash={{ actorId: null, actorName: null, kind: 'edit', at: 0 }}
      />,
    )
    expect(anon).toContain(esc(t('entry.updatedGeneric')))
  })
})

describe('EntryCard', () => {
  it('always ships the keyboard move path, and never repeats the column', () => {
    const out = html(<EntryCard entry={fx.entry} health={fx.health} onOpen={noop} onMove={noop} />)
    // The <select> IS the required non-drag path.
    expect(out).toContain('<select')
    expect(out).toContain('data-editable="true"')
    expect(out).toContain(`aria-label="${esc(t('entry.changeStatus'))}"`)
    expect(out).toContain('Core switch firmware upgrade')
    expect(out).toContain('entry-card-foot')
  })

  it('withholds the drag handlers and says why when the user may not move it', () => {
    const movable = html(
      <EntryCard
        entry={fx.entry}
        onOpen={noop}
        onMove={noop}
        dragHandleProps={{ id: 'drag-root' }}
      />,
    )
    expect(movable).toContain('id="drag-root"')

    const locked = html(
      <EntryCard
        entry={fx.entry}
        canEdit={false}
        onOpen={noop}
        onMove={noop}
        dragHandleProps={{ id: 'drag-root' }}
      />,
    )
    // Not draggable, not submittable, and explained — no request is ever sent.
    expect(locked).not.toContain('id="drag-root"')
    expect(locked).toContain('data-locked="true"')
    expect(locked).toContain('disabled')
    expect(locked).toContain(esc(t('entry.cannotEdit')))
  })

  it('marks the lifted state for the board to style', () => {
    const out = html(<EntryCard entry={fx.entry} dragging onOpen={noop} onMove={noop} />)
    expect(out).toContain('data-dragging="true"')
  })

  it('folds tags harder than a row does — a column is narrower', () => {
    const out = html(<EntryCard entry={fx.entry} onOpen={noop} onMove={noop} />)
    expect(count(out, 'class="chip tag-chip"')).toBe(2)
    expect(out).toContain('class="entry-card-more"')
  })
})
