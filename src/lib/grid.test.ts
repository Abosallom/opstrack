// scripts/report/grid.mjs fills the use-case grid, and this is the test that
// keeps it honest.
//
// WHY A TEST FOR A ONE-SHOT SCRIPT. The script itself runs once and its output
// is checked by measurement. What outlives it is the RULE it encodes, and that
// rule is not obvious enough to survive a well-meaning edit: the script reads
// two kinds of ticket and is only allowed to believe one of them.
//
// The measurement that produced the rule, taken over the owner's own export:
// of the tickets that name an organization and a use case WITHOUT being written
// in the onboarding convention, 298 are Resolved or Closed and read as fault
// reports — `Gama - ADT SSL issue in stg`, `Aljouf - Medication dispense -
// Raqeeb 400 Error`. Read the way an onboarding ticket is read, each of those
// would mark a cell LIVE because somebody fixed an SSL error. Three hundred
// invented go-lives is worse than the blank grid it replaced, and it is exactly
// the class of error this repository's honesty rules exist to refuse: a number
// nobody measured, printed as though somebody had.
//
// ⚠ WHAT THIS TEST CANNOT DO. It reads the script as TEXT, because the script
//   opens a Supabase connection at import time and cannot be loaded into a test
//   process. So it proves the rule is WRITTEN, not that it RAN. Each assertion
//   below was checked by mutation — flip the constant, the test reddens — which
//   is the most a source scan can earn.
//
// Read through import.meta.glob('?raw') rather than node:fs, for the reason
// brd.test.ts spells out: tsconfig.app.json pins types to vite/client.

import { describe, expect, it } from 'vitest'

const FILES: Record<string, string> = import.meta.glob('../../scripts/report/grid.mjs', {
  query: '?raw',
  import: 'default',
  eager: true,
})
const SRC = Object.values(FILES)[0] ?? ''

// The eleven and the two-vocabulary bridge live in their own module, because
// tickets.mjs needs the same reconciliation and a second copy of it is how the
// two would drift.
const VOCAB_FILES: Record<string, string> = import.meta.glob('../../scripts/report/useCases.mjs', {
  query: '?raw',
  import: 'default',
  eager: true,
})
const VOCAB = Object.values(VOCAB_FILES)[0] ?? ''

describe('grid.mjs — the seed', () => {
  it('is loaded at all', () => {
    expect(SRC.length).toBeGreaterThan(2000)
    expect(VOCAB.length).toBeGreaterThan(200)
  })

  it('names exactly eleven use cases, in the catalogue’s vocabulary', () => {
    const block = /export const ELEVEN = \[([\s\S]*?)\]/.exec(VOCAB)?.[1] ?? ''
    const names = [...block.matchAll(/'([^']+)'/g)].map((m) => m[1])
    expect(names).toHaveLength(11)
    // The catalogue says `Rad Report`; rebuild.mjs's rules answer `Radiology
    // Report`. Seeding the reader's vocabulary would silently drop three of the
    // eleven — a quarter of the grid — so the bridge is what must be present.
    expect(names).toContain('Rad Report')
    expect(names).toContain('Rad Order')
    expect(names).toContain('Lab Result')
    expect(names).not.toContain('Radiology Report')
    expect(VOCAB).toMatch(/BRIDGE\s*=\s*new Map\(\[/)
  })

  it('refuses to seed a partial grid when a use case is missing', () => {
    // Ten seeded rows out of eleven looks complete and is not.
    expect(SRC).toMatch(/if \(!row\) throw new Error\(`\[grid\] the catalogue has no use case named/)
  })
})

describe('grid.mjs — what the export is allowed to say', () => {
  it('caps the loose tier at testing, never live', () => {
    const ceiling = /const TIER2_CEILING = '([a-z]+)'/.exec(SRC)?.[1]
    expect(ceiling).toBe('testing')
    // ⚠ ANCHORED ON THE USE, not only the declaration. An earlier test in this
    //   repository matched a function's own signature instead of its call site
    //   and stayed green through the bug it was written for.
    expect(SRC).toMatch(/offer\(hit\.org, uc2, RANK\[state\] > RANK\[TIER2_CEILING\] \? TIER2_CEILING : state, 2\)/)
  })

  it('never lowers a cell, and never overwrites a person', () => {
    expect(SRC).toMatch(/if \(now && touched\(now\)\) continue/)
    expect(SRC).toMatch(/if \(RANK\[cell\.state\] <= RANK\[from\]\) continue/)
    // `touched` is what makes the second guard mean anything.
    expect(SRC).toMatch(/const touched = \(l\) => l\.updated_by !== null \|\| \(l\.overrides \?\? \[\]\)\.length > 0/)
  })

  it('drops an organization stem two organizations share', () => {
    // `Aseer (Care Ware)` and `Aseer (Vida Plus)` both reduce to `Aseer`, as do
    // the two Jazan clusters — the two pairs the owner ruled must stay apart.
    expect(SRC).toMatch(/if \(\(stemsSeen\.get\(stem\.toLowerCase\(\)\) \?\? 0\) > 1\) \{ ambiguous\.add\(stem\); continue \}/)
  })
})

describe('grid.mjs — the destructive-script convention', () => {
  it('is a dry run unless --apply', () => {
    expect(SRC).toMatch(/const APPLY = process\.argv\.includes\('--apply'\)/)
    expect(SRC).toMatch(/if \(!APPLY\) \{[\s\S]*?process\.exit\(0\)/)
  })

  it('writes its undo manifest before its first write', () => {
    const manifest = SRC.indexOf('manifest written first')
    const firstWrite = SRC.indexOf("await send('POST', 'map_node_use_cases'")
    expect(manifest).toBeGreaterThan(0)
    expect(firstWrite).toBeGreaterThan(0)
    expect(manifest).toBeLessThan(firstWrite)
  })
})
