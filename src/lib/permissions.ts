// WHY THIS MODULE IS LOAD-BEARING. RLS `entries_update` is narrower than
// SELECT: everyone sees everything, and almost nobody can edit most of it.
// Without a client-side mirror of the policy, a member drags another member's
// card, watches it move, snap back, and toast "Something went wrong" — because
// updateEntry() uses `.update(...).select().single()`, and an RLS-blocked patch
// returns ZERO ROWS, which PostgREST reports as PGRST116, which nothing maps.
// The user's read of that is "the app is broken", not "I am not allowed".
//
// So the permission answer is computed BEFORE the affordance renders: a card
// the user cannot move is not draggable and says so, and no request is sent.

import type { Entry, UserRole } from '../types'

/**
 * Mirrors the `entries_update` policy ACTUALLY SHIPPED in migration 0004.
 * Flip in ONE place if the policy changes; nothing else in the app may branch
 * on the policy.
 *
 * `true` = 0004's widening block was kept: any member may edit any entry
 * (DELETE stays admin-only, and the append-only entry_updates thread is what
 * provides attribution — that is the real audit guarantee, not write locking).
 * `false` = the block was deleted and 0001's narrower policy survives:
 * creator ∨ owner ∨ admin.
 *
 * ⚠ W1-DB: this is set to the plan's DEFAULT (widen). If the owner declines the
 * widening and you delete the marked block from 0004, this constant MUST be
 * flipped to false in the same commit — and it is the only line that changes.
 * Wave 2 gate (f) exercises both branches.
 */
export const ENTRIES_UPDATE_IS_OPEN: boolean = true

/**
 * `ENTRIES_UPDATE_IS_OPEN ? !!meId : (created_by === meId || owner_id === meId || role === 'admin')`
 *
 * Consumed by EntryRow/EntryCard/EntrySheet for the disabled affordance, by
 * follow-ups for snooze, and by the board for drag.
 */
export function canEditEntry(e: Entry, meId: string | null, role: UserRole): boolean {
  // A signed-out reader edits nothing under either branch — RLS keys every
  // write policy off auth.uid(), so a null id can only ever produce a rejection.
  // Testing it first means the open branch is `!!meId` rather than an
  // unqualified `true`, which is what the policy actually says.
  if (meId === null) return false
  if (ENTRIES_UPDATE_IS_OPEN) return true
  return e.created_by === meId || e.owner_id === meId || role === 'admin'
}

/** DELETE is admin-only under every branch of the 0004 decision. */
export function canDeleteEntry(role: UserRole): boolean {
  return role === 'admin'
}

export function canAdmin(role: UserRole): boolean {
  return role === 'admin'
}
