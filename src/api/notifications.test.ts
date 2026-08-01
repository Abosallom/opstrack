// The row → view-model boundary for notifications.
//
// It is one function, and it is tested because it is the only place the
// snake_case/camelCase line this app draws at the api layer is drawn for this
// table — and because both denormalized columns are nullable in a way the view
// model is not. A null slipping through renders as the literal string "null"
// inside a notification sentence.

import { describe, expect, it } from 'vitest'
import { toAppNotification } from './notifications'
import type { NotificationRow } from './notifications'

function row(overrides: Partial<NotificationRow> = {}): NotificationRow {
  return {
    // A JSON number, which is what PostgREST returns for the bigint identity.
    id: 41,
    recipient_id: 'me',
    kind: 'assigned',
    entry_id: 'e1',
    entry_title: 'Firewall rule DC2',
    actor_id: 'm-ahmed',
    actor_name: 'Ahmed Al-Otaibi',
    read_at: null,
    created_at: '2026-07-29T09:00:00.000Z',
    ...overrides,
  }
}

describe('toAppNotification', () => {
  it('stringifies the bigint id, because AppNotification.id is a string', () => {
    // 0004 makes `notifications.id` a bigint identity, unlike every other id in
    // the schema. Leaving it a number makes every dedupe and React key compare
    // unequal against the string the rest of the app carries.
    const mapped = toAppNotification(row({ id: 41 }))
    expect(mapped.id).toBe('41')
    expect(typeof mapped.id).toBe('string')
  })

  it('maps every column to its view-model name', () => {
    expect(toAppNotification(row())).toEqual({
      id: '41',
      recipientId: 'me',
      kind: 'assigned',
      entryId: 'e1',
      entryTitle: 'Firewall rule DC2',
      actorId: 'm-ahmed',
      actorName: 'Ahmed Al-Otaibi',
      readAt: null,
      createdAt: '2026-07-29T09:00:00.000Z',
    })
  })

  it('carries an empty title or actor name through unchanged', () => {
    // Both columns are `not null default ''` on the live table — confirmed
    // against information_schema at the Wave-1 close, which is why the mapper
    // no longer coalesces them. '' is what the trigger writes when it cannot
    // resolve a name, and it is what the renderer must fall back from; a `??`
    // here would have been dead code pretending null was reachable.
    const mapped = toAppNotification(row({ entry_title: '', actor_name: '' }))
    expect(mapped.entryTitle).toBe('')
    expect(mapped.actorName).toBe('')
  })

  it('keeps a null actor_id, because the profile may have been deleted', () => {
    // `on delete set null` — the notification outlives the person who caused it,
    // and the name snapshot is what keeps the row readable afterwards.
    expect(toAppNotification(row({ actor_id: null })).actorId).toBeNull()
  })

  it('narrows an unknown kind to assigned rather than trusting the column', () => {
    // A row written by a trigger this build has never heard of still has to
    // render as something; 'assigned' is the kind whose sentence works for any
    // entry.
    expect(toAppNotification(row({ kind: 'escalated' })).kind).toBe('assigned')
    expect(toAppNotification(row({ kind: 'completed' })).kind).toBe('completed')
  })

  it("carries 'nudged' through instead of collapsing it into assigned", () => {
    // REGRESSION, and a shipped one. Migration 0019 widened
    // `notifications_kind_check` to ('assigned','completed','nudged') and had
    // `nudge_entry()` write the third — but this mapper was still
    // `kind === 'completed' ? 'completed' : 'assigned'`, so every nudge arrived
    // in the inbox as an ASSIGNMENT. `canNudge()` refuses to offer the button on
    // a row you own, so the recipient of a nudge is by construction the owner:
    // "X assigned you this" was not merely imprecise, it was impossible, in both
    // languages and on the push banner too.
    //
    // The narrow is now driven by an exhaustive `Record<NotificationKind, true>`
    // literal, so the next kind cannot repeat this silently — it reds the file.
    expect(toAppNotification(row({ kind: 'nudged' })).kind).toBe('nudged')
  })

  it('carries read_at through as the only unread signal', () => {
    // The badge counts nulls; there is deliberately no `read` boolean to drift
    // from the timestamp.
    expect(toAppNotification(row({ read_at: '2026-07-29T10:00:00.000Z' })).readAt).toBe(
      '2026-07-29T10:00:00.000Z',
    )
  })
})
