// The digest collector's one job beyond gathering: not lying about what it
// gathered.
//
// This module's header states the principle — "a status report missing its
// oldest rows with no caveat is worse than one that fails" — and it used to miss
// it for the read most likely to fail. `collectDigest` awaits `loadClosedSince`
// inside a `Promise.all` whose only checked member is `tracks`, and
// `loadEntries(force)` short-circuits on the store the Shell already warmed — so
// the closed read is usually the ONLY entries fetch a digest makes. When it
// failed, the collector still answered ok with no closed rows, buildDigestModel
// dropped the Closed section entirely (empty buckets are skipped) and the
// summary line quietly lost its "N closed" clause. A report that under-states
// finished work and looks exactly like a quiet week.
//
// The stores are mocked because the store-side half — that a failed closed read
// is recorded at all — is pinned in store/closedWindow.test.ts. What is asserted
// here is the collector's response to it.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { collectDigest } from './digestCollect'
import type { EntriesCoverage } from '../store/entries'

const state = vi.hoisted(() => ({
  coverage: {
    openLoaded: true,
    closedSince: '2026-07-01',
    trackHistory: {},
    loadedAt: 1,
    truncated: false,
    closedTruncated: false,
    closedError: null,
  } as EntriesCoverage,
  tracksOk: true,
}))

vi.mock('./tracks', () => ({
  listTracks: () =>
    Promise.resolve(state.tracksOk ? { ok: true, data: [] } : { ok: false, error: 'common.error' }),
}))

vi.mock('./entries', () => ({
  listUpdatesFor: () => Promise.resolve({ ok: true, data: [] }),
}))

vi.mock('../store/entries', () => ({
  getEntriesCoverage: () => state.coverage,
  getEntriesSnapshot: () => ({ byId: new Map(), health: new Map() }),
  loadEntries: () => Promise.resolve(),
  loadClosedSince: () => Promise.resolve(),
}))

vi.mock('../store/members', () => ({
  getMembersSnapshot: () => [],
  loadMembers: () => Promise.resolve(),
}))

vi.mock('../store/vocab', () => ({
  getVocabSnapshot: () => [],
  loadVocab: () => Promise.resolve(),
  vocabLabel: (_s: unknown, _k: unknown, key: string) => key,
}))

const query = {
  from: '2026-07-01',
  to: '2026-07-31',
  trackIds: [] as string[],
  sections: [] as never[],
  includeUpdates: false,
}

beforeEach(() => {
  state.tracksOk = true
  state.coverage = { ...state.coverage, closedError: null, truncated: false, closedTruncated: false }
})

describe('collectDigest and the closed window', () => {
  it('fails rather than shipping a document with a silently empty Closed section', async () => {
    state.coverage = { ...state.coverage, closedError: 'common.offline' }

    const result = await collectDigest(query)

    // The key travels to Digest.tsx, which already renders a failed collect as
    // an error panel with a Retry — so the reader is told, and can try again,
    // instead of pasting an under-count into an email.
    expect(result).toEqual({ ok: false, error: 'common.offline' })
  })

  it('collects normally when the closed read succeeded', async () => {
    const result = await collectDigest(query)
    expect(result.ok).toBe(true)
  })

  it('still carries a CLIP as a caveat rather than a failure', async () => {
    // The distinction the fix must not blur: a clip is data the reader can be
    // warned about, a failure is data nobody has.
    state.coverage = { ...state.coverage, closedTruncated: true }

    const result = await collectDigest(query)

    expect(result.ok).toBe(true)
    if (result.ok) expect(result.data.truncated).toBe(true)
  })
})
