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

describe('pgErrorKey — the 0026/0027 contract, live before the tables are', () => {
  // THESE ARMS SHIP AHEAD OF THEIR MIGRATIONS, which is the order
  // docs/MIGRATIONS-0026-0027.md §5 requires: the client half lands FIRST, because
  // a name that exists on one side only does not break a build, does not fail a
  // test and does not raise — it turns a precise sentence into 'common.error'
  // months later. Every string below was copied out of the migration headers'
  // token lists, so this table is one half of a handshake neither file can check
  // on its own.
  const cases: ReadonlyArray<[string, { code: string; message: string }, string]> = [
    [
      '0026 duplicate rung name (Arabic first, house order)',
      {
        code: '23505',
        message: 'duplicate key value violates unique constraint "map_node_stages_name_ar_uidx"',
      },
      'mapadmin.errStageNameArTaken',
    ],
    [
      '0026 duplicate rung name',
      {
        code: '23505',
        message: 'duplicate key value violates unique constraint "map_node_stages_name_uidx"',
      },
      'mapadmin.errStageNameTaken',
    ],
    [
      '0026 a second progress row for one node — the AM race',
      {
        code: '23505',
        message: 'duplicate key value violates unique constraint "map_node_progress_pkey"',
      },
      'mapadmin.errStageAlreadyRecorded',
    ],
    [
      '0026 threshold out of the 1..3650 bound',
      { code: '23514', message: 'violates check constraint "map_node_stages_expected_days_chk"' },
      'mapadmin.errStageExpectedDays',
    ],
    [
      '0026 rung name over 40',
      { code: '23514', message: 'violates check constraint "map_node_stages_name_len_chk"' },
      'mapadmin.errStageNameLength',
    ],
    [
      '0026 Arabic rung name over 40',
      { code: '23514', message: 'violates check constraint "map_node_stages_name_ar_len_chk"' },
      'mapadmin.errStageNameArLength',
    ],
    [
      '0026 the stamp backstop, unreachable through the app',
      { code: '23514', message: 'violates check constraint "map_node_progress_stage_chk"' },
      'mapadmin.errStageStampMismatch',
    ],
    [
      '0026 the node vanished under a stage write',
      {
        code: '23503',
        message: 'violates foreign key constraint "map_node_progress_node_id_fkey"',
      },
      'mapadmin.errNodeGone',
    ],
    [
      '0026 the rung was retired under a stage write',
      {
        code: '23503',
        message: 'violates foreign key constraint "map_node_progress_stage_id_fkey"',
      },
      'mapadmin.errStageGone',
    ],
    [
      '0026 a member dragged the ladder',
      { code: '42501', message: 'map_node_stage_reorder_denied: structure.edit is required' },
      'mapadmin.errStageReorderDenied',
    ],
    [
      '0027 goal target token',
      { code: '23514', message: 'map_node_goal_target: a goal target must be positive, got 0' },
      'mapadmin.errGoalTarget',
    ],
    [
      '0027 goal target constraint, the backstop under the token',
      { code: '23514', message: 'violates check constraint "map_node_goals_target_chk"' },
      'mapadmin.errGoalTarget',
    ],
    [
      '0027 goal label over 60',
      { code: '23514', message: 'violates check constraint "map_node_goals_label_len_chk"' },
      'mapadmin.errGoalLabelLength',
    ],
    [
      '0027 Arabic goal label over 60',
      { code: '23514', message: 'violates check constraint "map_node_goals_label_ar_len_chk"' },
      'mapadmin.errGoalLabelArLength',
    ],
    [
      '0027 the goal’s node was deleted mid-edit',
      { code: 'P0002', message: 'map_node_goal_node_missing: node … not found' },
      'mapadmin.errNotFound',
    ],
  ]

  it.each(cases)('%s', (_label, error, expected) => {
    expect(pgErrorKey(error)).toBe(expected)
  })

  it('does not let the reorder token fall into the generic 42501 arm', () => {
    // The generic arm returns unconditionally, so the token arm has to sit above
    // it. Both directions are asserted: an ordinary RLS refusal must still get
    // the generic sentence, or "you cannot reorder the ladder" would be shown to
    // everybody whose write was refused for any reason at all.
    expect(pgErrorKey({ code: '42501', message: 'permission denied for table map_nodes' })).toBe(
      'admin.errForbidden',
    )
  })

  it('does not let 0023’s node arm swallow 0027’s goal token', () => {
    // `map_node_goal_node_missing` does NOT contain `map_node_missing` — the word
    // `goal` sits between them — so the two arms are genuinely separate. This is
    // the assertion that fails if somebody "simplifies" them into one.
    expect(pgErrorKey({ code: 'P0002', message: 'map_node_missing: node … not found' })).toBe(
      'mapadmin.errNotFound',
    )
    expect(pgErrorKey({ code: 'P0002', message: 'map_node_goal_node_missing: …' })).toBe(
      'mapadmin.errNotFound',
    )
  })

  it('does not confuse the goal TOKEN with the goal CONSTRAINT', () => {
    // Two names one character apart — `map_node_goal_target` and
    // `map_node_goals_target_chk` — and neither is a substring of the other.
    // They land on the same key today; if that ever stops being true, this is
    // where it is noticed.
    expect(pgErrorKey({ code: '23514', message: 'map_node_goal_target: got 0' })).toBe(
      'mapadmin.errGoalTarget',
    )
    expect(pgErrorKey({ code: '23514', message: 'map_node_goals_target_chk' })).toBe(
      'mapadmin.errGoalTarget',
    )
  })

  // ⚠ THE LOCALE HALF, AND WHY IT IS NOT `toBeTruthy()` LIKE THE BLOCK ABOVE.
  //   The `stages` namespace carrying these sentences belongs to the admin unit
  //   of this wave, and locale files are one-owner-per-file by design
  //   (src/locales/index.ts). Asserting the keys EXIST would fail this suite
  //   until that lands, which would mean shipping a red gate and waiting — so the
  //   assertion made here is the one that is true both before and after: EN and
  //   AR move TOGETHER. An English sentence added without its Arabic twin is the
  //   real failure mode of a three-file locale change, and it fails here the day
  //   it happens rather than in front of an Arabic-only reader.
  it.each(cases)('%s — EN and AR agree about whether the key exists', (_l, _e, expected) => {
    expect(resolve(en, expected) !== undefined, `${expected}: EN/AR disagree`).toBe(
      resolve(ar, expected) !== undefined,
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

describe('a request that never reached Postgres', () => {
  // ⚠ THE ARM THAT WAS MISSING, and the failure a rollout meets first. Every
  //   other mapping in this file describes something the DATABASE said. When the
  //   network is what failed, postgrest-js catches the fetch rejection and hands
  //   on an error with NO SQLSTATE and a browser sentence for a message — which
  //   fell through everything to `common.error`, "Something went wrong". True,
  //   useless, and it reads as a bug in the app rather than in the wifi.

  it('names the three engines by their own words', () => {
    // Chrome and Firefox say one thing, Safari says another, and neither is
    // specified anywhere. Matching all three is cheaper than being wrong on iOS.
    for (const message of [
      'TypeError: Failed to fetch',
      'NetworkError when attempting to fetch resource.',
      'Load failed',
      'fetch failed',
    ]) {
      expect(pgErrorKey({ message }), message).toBe('common.errNetwork')
    }
  })

  it('takes a bare TypeError, which is what a rejected fetch throws', () => {
    expect(pgErrorKey({ name: 'TypeError', message: '' })).toBe('common.errNetwork')
  })

  it('DEFERS THE MOMENT THERE IS A SQLSTATE, whatever the message says', () => {
    // The load-bearing half. A SQLSTATE means Postgres answered, so this was not
    // the network — and mapping it here would let `store/outbox.ts` queue a
    // write the database has already REFUSED, which then retries forever.
    expect(pgErrorKey({ code: '42501', message: 'Failed to fetch' })).not.toBe('common.errNetwork')
    expect(pgErrorKey({ code: 'PGRST205', message: 'load failed' })).toBe('common.errMissingTable')
    expect(pgErrorKey({ code: '23505', message: 'network error' })).not.toBe('common.errNetwork')
  })

  it('does not claim a plain unmapped failure', () => {
    expect(pgErrorKey({ message: 'something else entirely' })).toBe('common.error')
    expect(pgErrorKey(null)).toBe('common.error')
  })
})
