import { describe, expect, it } from 'vitest'
import {
  ENTRIES_UPDATE_IS_OPEN,
  canAdmin,
  canDeleteEntry,
  canEditEntry,
  canEditEntryUnder,
} from './permissions'
import type { Entry } from '../types'

// WHY THIS SUITE TESTS BOTH BRANCHES UNCONDITIONALLY.
//
// ENTRIES_UPDATE_IS_OPEN mirrors a policy shipped in SQL, and flipping it is a
// one-line deployment decision the owner makes once. A test that hard-coded
// either branch would go red the day the decision changed — reporting a
// regression where there was only a configuration change, which is the fastest
// way to teach a team to ignore a red suite.
//
// SO THIS FILE USED TO WRITE `if (ENTRIES_UPDATE_IS_OPEN) … else …`, AND THAT
// WAS THE BUG (FIX-BACKLOG **PERM-BRANCH**). Branching at RUNTIME means the
// `else` is dead code in every run: the narrow policy's line in permissions.ts
// was never executed, and everything the suite actually asserted collapsed to
// `meId !== null`. A mutation to the narrow branch — the one the board's drag
// affordance and every disabled control read — could not turn this suite red.
//
// The fix is to make the decision a PARAMETER. `canEditEntryUnder(open, …)`
// takes both branches for real, in one run, and a separate assertion pins
// `canEditEntry` to whichever branch the repo ships. That keeps the original
// property (a flip is a config change, not a regression) without paying for it
// in coverage.

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

  it('lets an admin edit anything, under either branch', () => {
    expect(canEditEntry(entry(), 'stranger', 'admin')).toBe(true)
  })
})

describe('canEditEntryUnder — both policies, in one run', () => {
  const e = entry({ created_by: 'creator', owner_id: 'owner' })

  it('WIDE (0004 kept its widening block): any signed-in member edits anything', () => {
    // Widened to is_member(): the append-only entry_updates thread is what
    // provides attribution, not write locking.
    expect(canEditEntryUnder(true, e, 'stranger', 'member')).toBe(true)
    expect(canEditEntryUnder(true, e, 'creator', 'member')).toBe(true)
    expect(canEditEntryUnder(true, e, 'owner', 'member')).toBe(true)
    expect(canEditEntryUnder(true, e, 'stranger', 'admin')).toBe(true)
    // …and the open branch is `!!meId`, not an unqualified `true`.
    expect(canEditEntryUnder(true, e, null, 'admin')).toBe(false)
  })

  it('NARROW (0001 survives): creator ∨ owner ∨ admin, and nobody else', () => {
    // THE line that never executed. A stranger who is not an admin is the whole
    // point of the narrow policy, and the disabled affordance the board renders
    // for them is computed here.
    expect(canEditEntryUnder(false, e, 'stranger', 'member')).toBe(false)
    expect(canEditEntryUnder(false, e, 'creator', 'member')).toBe(true)
    expect(canEditEntryUnder(false, e, 'owner', 'member')).toBe(true)
    expect(canEditEntryUnder(false, e, 'stranger', 'admin')).toBe(true)
    expect(canEditEntryUnder(false, e, null, 'admin')).toBe(false)
  })

  it('distinguishes the two branches on the case that separates them', () => {
    // If this ever stops being an inequality, the branch collapsed and one of
    // the two blocks above became a duplicate of the other.
    const stranger = ['stranger', 'member'] as const
    expect(canEditEntryUnder(true, e, ...stranger)).not.toBe(
      canEditEntryUnder(false, e, ...stranger),
    )
  })

  it('is what canEditEntry ships, for whichever branch the repo is on', () => {
    // The one assertion that reads the constant: it pins the wiring, not the
    // rule. A flip of ENTRIES_UPDATE_IS_OPEN keeps this green; a
    // canEditEntry that stopped delegating does not.
    for (const meId of [null, 'stranger', 'creator', 'owner']) {
      for (const role of ['member', 'admin'] as const) {
        expect(canEditEntry(e, meId, role)).toBe(
          canEditEntryUnder(ENTRIES_UPDATE_IS_OPEN, e, meId, role),
        )
      }
    }
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
