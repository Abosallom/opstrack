// pgErrorKey() is a contract with the migrations, and a contract only one side
// can see is not a contract. 0002 and 0003 raise tokens (`last_active_track`,
// `track_in_use`, `last_visible_option`, …); this module matches on them; a
// rename on either side degrades a precise sentence to 'common.error' with
// nothing turning red. These cases are that alarm.
//
// Every expected key is also resolved against the real locale tree, because a
// mapping that returns a key nobody translated renders the dot path at a user —
// which is worse than the Postgres English it replaced.
//
// Vitest imports are explicit: no globals config anywhere in this repo.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { pgErrorKey } from './pgError'
import { ar, en } from '../locales'
import type { LocaleTree } from '../locales'

function resolve(tree: LocaleTree, path: string): string | undefined {
  let node: LocaleTree | string | undefined = tree
  for (const seg of path.split('.')) {
    if (typeof node !== 'object' || node === null || !(seg in node)) return undefined
    node = node[seg]
  }
  return typeof node === 'string' ? node : undefined
}

// The module warns on every unmapped code by design; silence it so a passing
// run is quiet, and so the assertions below can count the calls that matter.
let warn: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(() => {
  warn.mockRestore()
})

describe('pgErrorKey — migration token contract', () => {
  const cases: ReadonlyArray<[string, { code: string; message: string }, string]> = [
    [
      'unique index on the Arabic name',
      { code: '23505', message: 'duplicate key value violates unique constraint "tracks_name_ar_uidx"' },
      'admin.tracks.errNameArTaken',
    ],
    [
      'unique index on the name',
      { code: '23505', message: 'duplicate key value violates unique constraint "tracks_name_uidx"' },
      'admin.tracks.errNameTaken',
    ],
    [
      'track still referenced',
      { code: '23503', message: 'track_in_use: 4 entries still point here' },
      'admin.tracks.errInUse',
    ],
    [
      'last active track (0002)',
      { code: '23514', message: 'last_active_track: the workspace needs one active track' },
      'admin.tracks.errLastTrack',
    ],
    [
      'last visible vocab option (0003)',
      { code: '23514', message: 'last_visible_option: status must keep at least one visible option' },
      'vocabadmin.errLastVisible',
    ],
    [
      'reassign onto an archived track',
      { code: '22023', message: 'reassign_archived' },
      'admin.tracks.errReassignArchived',
    ],
    ['reassign onto itself', { code: '22023', message: 'reassign_self' }, 'admin.tracks.errReassignSelf'],
    ['track vanished mid-edit', { code: 'P0002', message: 'track_missing' }, 'admin.tracks.errNotFound'],
    ['RLS refused the write', { code: '42501', message: 'permission denied' }, 'admin.errForbidden'],
    [
      'RLS-blocked update returns zero rows',
      { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned' },
      'entry.errNotYours',
    ],
  ]

  it.each(cases)('%s', (_label, error, expected) => {
    expect(pgErrorKey(error)).toBe(expected)
  })

  it.each(cases)('%s — the key it returns is translated in both languages', (_l, _e, expected) => {
    expect(resolve(en, expected), `${expected} missing from en`).toBeTruthy()
    expect(resolve(ar, expected), `${expected} missing from ar`).toBeTruthy()
  })

  it('does not confuse the two 23514 tokens', () => {
    // Both trigger on the same SQLSTATE from different migrations. Matching on
    // the code alone would make whichever case was written first swallow both.
    expect(pgErrorKey({ code: '23514', message: 'last_active_track' })).toBe(
      'admin.tracks.errLastTrack',
    )
    expect(pgErrorKey({ code: '23514', message: 'last_visible_option' })).toBe(
      'vocabadmin.errLastVisible',
    )
    // A 23514 from some constraint nobody has mapped is still generic.
    expect(pgErrorKey({ code: '23514', message: 'some_other_check' })).toBe('common.error')
  })

  it('finds the token wherever PostgREST put it', () => {
    // A unique violation arrives with the index name in `details`; a trigger's
    // raise puts its token in `message`. The matcher reads the whole blob so
    // neither shape needs its own branch.
    expect(pgErrorKey({ code: '23505', details: 'Key (name)=(PMO) violates tracks_name_uidx' })).toBe(
      'admin.tracks.errNameTaken',
    )
    expect(pgErrorKey({ code: '23503', hint: 'track_in_use' })).toBe('admin.tracks.errInUse')
  })

  it('is case-insensitive about the token', () => {
    expect(pgErrorKey({ code: '23514', message: 'LAST_VISIBLE_OPTION: status …' })).toBe(
      'vocabadmin.errLastVisible',
    )
  })
})

describe('pgErrorKey — 23502 is mapped but should be unreachable', () => {
  it('returns the generic key and warns by name', () => {
    // entries.description is `not null default ''` and toEntryRow() coalesces to
    // ''. If this ever fires in production, a new column lost its coalesce — the
    // named warn is what makes that a one-minute find.
    const key = pgErrorKey({
      code: '23502',
      message: 'null value in column "description" violates not-null constraint',
    })
    expect(key).toBe('common.error')
    expect(warn).toHaveBeenCalledTimes(1)
    expect(String(warn.mock.calls[0]?.[0])).toContain('23502')
  })
})

describe('pgErrorKey — degrades safely', () => {
  it.each([
    ['null', null],
    ['undefined', undefined],
    ['a string', 'boom'],
    ['a number', 500],
    ['an empty object', {}],
    ['a non-string code', { code: 42 }],
  ])('%s → common.error', (_label, input) => {
    expect(pgErrorKey(input)).toBe('common.error')
  })

  it('never renders Postgres English at a user', () => {
    // The whole point of the module: the raw sentence goes to the console, the
    // return value is always a key. An unmapped code must not leak `message`.
    const raw = 'relation "entries" does not exist'
    expect(pgErrorKey({ code: '42P01', message: raw })).toBe('common.error')
    expect(warn).toHaveBeenCalled()
  })

  it('keeps the raw message debuggable on the unmapped path', () => {
    pgErrorKey({ code: '42P01', message: 'relation "entries" does not exist' })
    expect(warn.mock.calls[0]).toContain('42P01')
  })
})
