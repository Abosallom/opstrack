// The row mappers, which is where the interesting bugs in this file live.
//
// toEntryRow() exists as a named function ONLY so this file can pin the 23502
// regression: `description: input.description ?? null` on a `not null default ''`
// column (0001:304) was a guaranteed failure on every create, and it survived
// review twice because nothing called createEntry() yet. It is a one-character
// mistake to make again and a free one to catch here.
//
// Nothing below touches the network: these are pure functions over plain objects,
// which is exactly why the mapping was pulled out of the query calls.

import { describe, expect, it } from 'vitest'
import { toEntryPatchRow, toEntryRow } from './entries'
import type { NewEntry } from './entries'

const ME = '11111111-1111-1111-1111-111111111111'
const THEM = '22222222-2222-2222-2222-222222222222'

function minimal(overrides: Partial<NewEntry> = {}): NewEntry {
  return { title: 'Firewall rule DC2', ...overrides }
}

describe('toEntryRow', () => {
  it('sends an empty string for a missing description, never null', () => {
    // THE regression. `not null default ''` rejects null with 23502.
    expect(toEntryRow(minimal(), ME).description).toBe('')
    expect(toEntryRow(minimal({ description: null }), ME).description).toBe('')
    expect(toEntryRow(minimal({ description: 'why' }), ME).description).toBe('why')
  })

  it('writes created_by explicitly, because entries_insert checks it', () => {
    // `with check (is_member() and created_by = auth.uid())` — no column default
    // fills this in, so an omitted author is a 42501 and not a null column.
    expect(toEntryRow(minimal(), ME).created_by).toBe(ME)
  })

  it('defaults every not-null column the DB defaults', () => {
    const row = toEntryRow(minimal(), ME)
    expect(row.type).toBe('action')
    expect(row.status).toBe('new')
    expect(row.priority).toBe('medium')
    expect(row.tags).toEqual([])
    expect(row.links).toEqual([])
  })

  it('resolves the owner XOR rather than passing both through', () => {
    // entries_single_owner (0001:327) rejects a row carrying both.
    const row = toEntryRow(minimal({ ownerId: THEM, ownerName: 'Fatimah' }), ME)
    expect(row.owner_id).toBe(THEM)
    expect(row.owner_name).toBeNull()
  })

  it('keeps a free-text owner when there is no owner id', () => {
    const row = toEntryRow(minimal({ ownerName: 'Fatimah' }), ME)
    expect(row.owner_id).toBeNull()
    expect(row.owner_name).toBe('Fatimah')
  })

  it('trims the title so a stray space is not a distinct entry', () => {
    expect(toEntryRow(minimal({ title: '  Rebuild jump host  ' }), ME).title).toBe(
      'Rebuild jump host',
    )
  })
})

describe('toEntryPatchRow', () => {
  it('omits absent keys entirely', () => {
    const row = toEntryPatchRow({ status: 'blocked' })
    expect(Object.keys(row)).toEqual(['status'])
  })

  it('coalesces a cleared description to an empty string', () => {
    // The sheet clears the field by sending null; the column still rejects it.
    expect(toEntryPatchRow({ description: null }).description).toBe('')
  })

  it('clears the free-text owner when a teammate is assigned', () => {
    const row = toEntryPatchRow({ ownerId: THEM })
    expect(row.owner_id).toBe(THEM)
    expect(row.owner_name).toBeNull()
  })

  it('clears the teammate when a free-text owner is typed', () => {
    const row = toEntryPatchRow({ ownerName: 'Vendor' })
    expect(row.owner_name).toBe('Vendor')
    expect(row.owner_id).toBeNull()
  })

  it('unassigns without clearing the other side', () => {
    // Clearing owner_id to null is "unassign", not "reassign to a vendor", so it
    // must not blank a name that was never there and must not invent one.
    const row = toEntryPatchRow({ ownerId: null })
    expect(row.owner_id).toBeNull()
    expect('owner_name' in row).toBe(false)
  })

  it('passes null through for the nullable date columns', () => {
    const row = toEntryPatchRow({ dueDate: null, followUpDate: null })
    expect(row.due_date).toBeNull()
    expect(row.follow_up_date).toBeNull()
  })

  it('is empty for an empty patch, which is what the read-back branch keys off', () => {
    expect(Object.keys(toEntryPatchRow({}))).toHaveLength(0)
  })
})
