// Shared fixtures for the digest tests.
//
// A `.ts` file rather than a `.test.ts` one so three suites can import it
// without vitest trying to run it, and so `tsc -b` typechecks it like any other
// source file — a fixture that has drifted from `Entry` is a test that is
// asserting about a shape the app no longer has.
//
// IT IS NOT SHIPPED. Nothing under src/pages, src/api or src/store imports it,
// so Vite tree-shakes it out of every entry point; it exists in the app's type
// space and in no bundle.
//
// EVERY FIXTURE IS ANCHORED TO A FIXED CLOCK. `NOW` is 2026-07-29T09:00:00Z and
// every date below is written relative to it in the comment, never computed —
// a fixture that says `addDays(todayIso(), -3)` passes on every machine and
// proves nothing about the arithmetic under test.

import type { Entry, EntryHealth, EntryUpdate, Track, VocabKind } from '../../types'
import type { DigestMember, DigestOptions, DigestRows } from './types'
import { SECTION_ORDER } from './types'

/** The one clock. Wednesday 29 July 2026, 09:00 UTC. */
export const NOW = new Date('2026-07-29T09:00:00.000Z')
export const TODAY = '2026-07-29'
/** The default window: the last seven days, inclusive of both ends. */
export const FROM = '2026-07-23'
export const TO = '2026-07-29'

export function track(p: Partial<Track> & { id: string; name: string }): Track {
  return {
    id: p.id,
    name: p.name,
    name_ar: p.name_ar ?? '',
    description: '',
    description_ar: '',
    color: '#e0a020',
    color_light: null,
    icon: 'network',
    suggested_tags: p.suggested_tags ?? [],
    sort_order: p.sort_order ?? 1,
    archived: p.archived ?? false,
    archived_at: null,
    created_by: null,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
  }
}

export function entry(p: Partial<Entry> & { id: string; title: string }): Entry {
  const created = p.created_at ?? '2026-07-24T09:00:00.000Z'
  return {
    id: p.id,
    // `=== undefined`, not `??`: an explicit `track_id: null` is the "no track"
    // case half the grouping tests are about, and `??` would silently default it
    // back to a real track.
    track_id: p.track_id === undefined ? 'trk-net' : p.track_id,
    node_id: p.node_id ?? null,
    title: p.title,
    description: p.description ?? '',
    type: p.type ?? 'action',
    status: p.status ?? 'in_progress',
    priority: p.priority ?? 'medium',
    owner_id: p.owner_id ?? null,
    owner_name: p.owner_name ?? null,
    requester: null,
    due_date: p.due_date ?? null,
    follow_up_date: p.follow_up_date ?? null,
    tags: p.tags ?? [],
    links: [],
    created_by: null,
    created_at: created,
    updated_at: p.updated_at ?? created,
    closed_at: p.closed_at ?? null,
    last_activity_at: p.last_activity_at ?? created,
    meeting_id: null,
    template_id: null,
  }
}

export function health(p: Partial<EntryHealth> & { entry_id: string }): EntryHealth {
  return {
    id: p.entry_id,
    entry_id: p.entry_id,
    track_id: p.track_id ?? 'trk-net',
    status: p.status ?? 'in_progress',
    priority: p.priority ?? 'medium',
    due_date: p.due_date ?? null,
    last_activity_at: p.last_activity_at ?? '2026-07-24T09:00:00.000Z',
    days_since_activity: p.days_since_activity ?? 5,
    days_overdue: p.days_overdue ?? 0,
    health: p.health ?? 'ok',
    sla_due_at: p.sla_due_at ?? null,
    sla_breached: p.sla_breached ?? false,
  }
}

export function update(id: string, entryId: string, body: string, at: string): EntryUpdate {
  return {
    id,
    entry_id: entryId,
    author_id: null,
    body,
    status_from: null,
    status_to: null,
    created_at: at,
  }
}

export const MEMBERS: readonly DigestMember[] = [
  { id: 'usr-ahmed', displayName: 'Ahmed' },
  { id: 'usr-sara', displayName: 'سارة' },
  // A provisioned account nobody has named yet: `profiles.display_name` is
  // `not null default ''`, and the resolver must fall THROUGH it.
  { id: 'usr-blank', displayName: '  ' },
]

/**
 * A two-word stand-in for the frozen vocabulary resolver.
 *
 * Deliberately NOT the real one: `buildDigestModel` takes the labeller as a
 * parameter precisely so a test needs no store, and a stub that returns
 * recognisable strings proves the injection point is wired without asserting
 * anything about store/vocab's own (separately tested) resolution order.
 */
export const LABELS: Record<string, string> = {
  'status:blocked': 'Blocked',
  'status:waiting_on': 'Waiting on',
  'status:in_progress': 'In progress',
  'status:new': 'New',
  'status:done': 'Done',
}

export function vocabLabel(kind: VocabKind, key: string): string {
  return LABELS[`${kind}:${key}`] ?? key
}

export function options(p: Partial<DigestOptions> = {}): DigestOptions {
  return {
    locale: p.locale ?? 'en',
    from: p.from ?? FROM,
    to: p.to ?? TO,
    sections: p.sections ?? [...SECTION_ORDER],
    trackIds: p.trackIds ?? [],
    tagBreakdown: p.tagBreakdown,
    includeNotes: p.includeNotes ?? false,
    includeEmptyTracks: p.includeEmptyTracks ?? false,
    now: p.now ?? NOW,
    vocabLabel: p.vocabLabel ?? vocabLabel,
  }
}

export function rows(p: Partial<DigestRows> = {}): DigestRows {
  return {
    entries: p.entries ?? [],
    health: p.health ?? [],
    lastUpdate: p.lastUpdate ?? new Map(),
    tracks: p.tracks ?? [track({ id: 'trk-net', name: 'Network', name_ar: 'الشبكات' })],
    members: p.members ?? MEMBERS,
    truncated: p.truncated ?? false,
  }
}
