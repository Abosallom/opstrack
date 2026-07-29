import { describe, expect, it } from 'vitest'
import { ENTRIES_UPDATE_IS_OPEN, canAdmin, canDeleteEntry, canEditEntry } from './permissions'
import type { Entry } from '../types'

// WHY THIS SUITE BRANCHES ON THE CONSTANT.
//
// ENTRIES_UPDATE_IS_OPEN mirrors a policy shipped in SQL, and flipping it is a
// one-line deployment decision the owner makes once. A test that hard-coded
// either branch would go red the day the decision changed — reporting a
// regression where there was only a configuration change, which is the fastest
// way to teach a team to ignore a red suite.
//
// So both branches are asserted, and the one that runs is whichever the repo
// actually ships. Wave 2 gate (f) exercises the other end to end, by flipping
// the constant in a dev build.

function entry(partial: Partial<Entry> = {}): Entry {
  return {
    id: 'e1',
    track_id: 'tr1',
    title: 'Migrate the payment gateway',
    description: '',
    type: 'action',
    status: 'in_progress',
    priority: 'high',
    owner_id: 'owner',
    owner_name: null,
    requester: null,
    due_date: null,
    follow_up_date: null,
    tags: [],
    links: [],
    created_by: 'creator',
    created_at: '2026-07-01T12:00:00.000Z',
    updated_at: '2026-07-29T12:00:00.000Z',
    closed_at: null,
    last_activity_at: '2026-07-29T12:00:00.000Z',
    meeting_id: null,
    template_id: null,
    ...partial,
  }
}

describe('canEditEntry', () => {
  it('refuses a signed-out reader under EITHER branch', () => {
    // RLS keys every write policy off auth.uid(), so a null id can only ever
    // produce a rejection. This is the assertion that stays true whichever way
    // the constant is set.
    expect(canEditEntry(entry(), null, 'admin')).toBe(false)
    expect(canEditEntry(entry(), null, 'member')).toBe(false)
  })

  it('matches the shipped 0004 policy', () => {
    const e = entry({ created_by: 'creator', owner_id: 'owner' })
    if (ENTRIES_UPDATE_IS_OPEN) {
      // Widened to is_member(): any signed-in member edits any entry, and the
      // append-only entry_updates thread is what provides attribution.
      expect(canEditEntry(e, 'stranger', 'member')).toBe(true)
      expect(canEditEntry(e, 'creator', 'member')).toBe(true)
      expect(canEditEntry(e, 'owner', 'member')).toBe(true)
    } else {
      // 0001's narrower policy: creator ∨ owner ∨ admin.
      expect(canEditEntry(e, 'stranger', 'member')).toBe(false)
      expect(canEditEntry(e, 'creator', 'member')).toBe(true)
      expect(canEditEntry(e, 'owner', 'member')).toBe(true)
      expect(canEditEntry(e, 'stranger', 'admin')).toBe(true)
    }
  })

  it('lets an admin edit anything, under either branch', () => {
    expect(canEditEntry(entry(), 'stranger', 'admin')).toBe(true)
  })
})

describe('canDeleteEntry / canAdmin', () => {
  it('DELETE stays admin-only under every branch of the 0004 decision', () => {
    expect(canDeleteEntry('admin')).toBe(true)
    expect(canDeleteEntry('member')).toBe(false)
  })

  it('canAdmin is role, and nothing else', () => {
    expect(canAdmin('admin')).toBe(true)
    expect(canAdmin('member')).toBe(false)
  })
})
