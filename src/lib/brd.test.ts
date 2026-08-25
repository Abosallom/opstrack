// docs/BRD.md is the requirement register, and this is the test that keeps it
// true.
//
// WHY A TEST FOR A MARKDOWN FILE. A register is only worth reading if a reader
// can trust that what it says about the repository is still the case. Prose
// cannot be trusted that way on its own: a requirement citing a file that was
// renamed, a migration nobody ever wrote a requirement for, a share printed
// without its denominator — none of those announce themselves, and all three
// have already happened in this programme. BRD-037's own ground fact is one of
// them: eight `pmo_*` tables were created three days before nobody wrote to
// them and no requirement anywhere explained why. The ledger check below is the
// check that would have caught it on the day the migration landed.
//
// It deliberately does NOT pin the prose. A test that asserts the wording is a
// test that reddens on every edit to a sentence and is deleted within a month.
// It asserts the six claims that are structural, and nothing else.
//
// Source is read through import.meta.glob('?raw') rather than node:fs, for the
// reason migrationContract.test.ts spells out: tsconfig.app.json pins
// `types: ["vite/client"]`, and adding "node" would leak node globals into the
// type space of every app file.

import { describe, expect, it } from 'vitest'

// The options object has to be an inline literal — Vite parses this statically.
const DOC: Record<string, string> = import.meta.glob('../../docs/BRD.md', {
  query: '?raw',
  import: 'default',
  eager: true,
})

const MIGRATIONS: Record<string, string> = import.meta.glob(
  '../../supabase/migrations/*.sql',
  { query: '?raw', import: 'default', eager: true },
)

// EXISTENCE ONLY, SO THIS ONE IS LAZY. The loaders are never called; only the
// KEYS are read. Eager here would inline every asset the register can cite —
// including three JPEGs — into the test bundle to prove they are on disk.
const REPO: Record<string, unknown> = {
  ...import.meta.glob('../../src/**/*.{ts,tsx,css,json}', { query: '?raw', import: 'default' }),
  ...import.meta.glob('../../supabase/**/*.{ts,sql}', { query: '?raw', import: 'default' }),
  ...import.meta.glob('../../docs/**/*.{md,csv,jpg,png}', { query: '?raw', import: 'default' }),
  ...import.meta.glob('../../scripts/**/*.{mjs,js,csv}', { query: '?raw', import: 'default' }),
  ...import.meta.glob('../../ios/**/*.{xcprivacy,plist}', { query: '?raw', import: 'default' }),
}

/** The register's full text. */
const REGISTER: string = Object.values(DOC)[0] ?? ''

/**
 * The register with every run of whitespace flattened to one space.
 *
 * Every prose check below reads this rather than the raw text. The document is
 * hard-wrapped, so `Medication Prescribe V2` is genuinely present and genuinely
 * split across two lines — a check against the raw text reddens on a reflow,
 * which is an edit that changed nothing a reader can see.
 */
const FLAT: string = REGISTER.replace(/\s+/g, ' ')

/**
 * A glob key back to a repo-relative path.
 *
 * Vite normalises the key against THIS file's directory and collapses what it
 * can, so `'../../src/pages/Pmo.tsx'` comes back as `'../pages/Pmo.tsx'` while
 * `'../../docs/BRD.md'` keeps both hops. Stripping the leading `../` blindly
 * therefore yields `pages/Pmo.tsx`, which matches nothing the register cites —
 * measured, and the reason this walks the segments instead.
 */
function repoRelative(key: string): string {
  const parts = 'src/lib'.split('/')
  for (const seg of key.split('/')) {
    if (seg === '..') parts.pop()
    else if (seg !== '.' && seg !== '') parts.push(seg)
  }
  return parts.join('/')
}

/** Every path the repo globs found, repo-relative: `src/pages/Pmo.tsx`. */
const REPO_PATHS: ReadonlySet<string> = new Set(Object.keys(REPO).map(repoRelative))

/** Every migration file name, oldest first. */
const MIGRATION_NAMES: readonly string[] = Object.keys(MIGRATIONS)
  .map((p) => p.split('/').pop() ?? p)
  .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))

type Requirement = {
  id: string
  n: number
  title: string
  body: string
  state: string
  statement: string
  ground: string
  honesty: string
  proof: string
  files: string[]
}

/**
 * One field of a requirement block: everything from `- **Label** — ` up to the
 * next `- **` bullet or the end of the block. Multi-line by design — every
 * statement in the register wraps.
 */
function field(body: string, label: string): string {
  const at = body.indexOf(`- **${label}** — `)
  if (at === -1) return ''
  const from = at + `- **${label}** — `.length
  const rest = body.slice(from)
  // The next bullet, OR a blank line. The blank line matters: `Files` is the
  // LAST bullet in every block, so without it the field runs on past the
  // requirement into whatever follows — for BRD-037 that is the ledger, and 31
  // migration filenames get read as files BRD-037 cites.
  const end = rest.search(/\n- \*\*|\n\s*\n/)
  return (end === -1 ? rest : rest.slice(0, end)).trim()
}

/** Every `### BRD-xxx — Title` block, in document order. */
function requirements(): Requirement[] {
  const heads = [...REGISTER.matchAll(/^### (BRD-\d{3}) — (.+)$/gm)]
  return heads.map((m, i) => {
    const start = m.index ?? 0
    const end = i + 1 < heads.length ? (heads[i + 1].index ?? REGISTER.length) : REGISTER.length
    const body = REGISTER.slice(start, end)
    return {
      id: m[1],
      n: Number(m[1].slice(4)),
      title: m[2].trim(),
      body,
      state: field(body, 'State'),
      statement: field(body, 'Statement'),
      ground: field(body, 'Ground'),
      honesty: field(body, 'Honesty rule'),
      proof: field(body, 'Proof'),
      // A path is a backticked token; the "none yet" lines carry no backticks.
      files: [...field(body, 'Files').matchAll(/`([^`]+)`/g)].map((f) => f[1]),
    }
  })
}

describe('the register is readable at all', () => {
  it('finds the document and the migrations, so nothing below passes vacuously', () => {
    // The same guard migrationContract.test.ts applies to its own glob. A
    // renamed BRD.md would otherwise make every assertion in this file true.
    expect(REGISTER.length).toBeGreaterThan(5_000)
    expect(REGISTER).toContain('# NphiesCore — the requirement register')
    expect(MIGRATION_NAMES.length).toBeGreaterThanOrEqual(31)
    expect(MIGRATION_NAMES[0]).toBe('0001_opstrack_core.sql')
    expect(REPO_PATHS.size).toBeGreaterThan(100)
    expect(REPO_PATHS.has('src/pages/Pmo.tsx')).toBe(true)
  })

  it('parses every requirement into all eight of its parts', () => {
    const reqs = requirements()
    expect(reqs.length).toBeGreaterThanOrEqual(37)
    for (const r of reqs) {
      expect(r.title, `${r.id} title`).not.toBe('')
      expect(r.state, `${r.id} state`).not.toBe('')
      expect(r.statement, `${r.id} statement`).not.toBe('')
      expect(r.ground, `${r.id} ground`).not.toBe('')
      expect(r.honesty, `${r.id} honesty rule`).not.toBe('')
      expect(r.proof, `${r.id} proof`).not.toBe('')
    }
  })

  it('gives every requirement one of the four declared states', () => {
    for (const r of requirements()) {
      expect(['built', 'agreed', 'gated', 'deferred'], `${r.id}`).toContain(r.state)
    }
  })

  it('carries a ground fact with a NUMBER in it, which is the rule of entry', () => {
    // "A numbered requirement without a measured ground fact does not belong in
    // this document." A ground with no digit in it is a plausible sentence, not
    // a measurement, and it is exactly how the six departments and the 119
    // account managers got printed as facts nobody had stated.
    //
    // Spelled cardinals count. BRD-022's ground is "zero production call sites"
    // and "eight ways to look at data" — both counted, both written the way an
    // English sentence writes a small number, and a digits-only check would
    // reject the one requirement in the register whose measurement is a zero.
    const COUNTED =
      /\d|\b(zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand)\b/i
    for (const r of requirements()) {
      expect(r.ground, `${r.id} ground carries no measured number`).toMatch(COUNTED)
    }
  })
})

describe('the ids are a register, not a list', () => {
  it('every id matches BRD-nnn, is unique, and runs contiguously from 001', () => {
    const reqs = requirements()
    for (const r of reqs) expect(r.id).toMatch(/^BRD-\d{3}$/)

    const numbers = reqs.map((r) => r.n).sort((a, b) => a - b)
    expect(new Set(numbers).size, 'a duplicate id').toBe(numbers.length)
    // Contiguous from 1. A gap means a requirement was deleted rather than
    // superseded, and every reference to it elsewhere now points at nothing —
    // ORG-RULINGS.md already cites BRD-001 by number.
    expect(numbers).toEqual(Array.from({ length: numbers.length }, (_, i) => i + 1))
  })
})

describe('a built requirement points at something that is there', () => {
  it("names at least one file, because 'built' means it is in the repository", () => {
    for (const r of requirements()) {
      if (r.state !== 'built') continue
      expect(r.files.length, `${r.id} is built and names no file`).toBeGreaterThan(0)
    }
  })

  it('every file named anywhere in the register EXISTS', () => {
    // Not only the built ones. A requirement that is going to be built against
    // `src/pages/Pmo.tsx` is worthless the day that file is renamed, and the
    // rename will not think to check a markdown document.
    const missing: string[] = []
    for (const r of requirements()) {
      for (const f of r.files) {
        if (!REPO_PATHS.has(f)) missing.push(`${r.id} → ${f}`)
      }
    }
    expect(missing).toEqual([])
  })
})

describe('every migration is explained by a requirement', () => {
  /**
   * The ledger rows: `| \`0031_pmo_portfolio.sql\` | BRD-037 | … |`.
   * Returns the migration name against the raw "Explained by" cell.
   */
  function ledger(): { file: string; by: string }[] {
    return [...REGISTER.matchAll(/^\| `(\d{4}_[\w-]+\.sql)` \| ([^|]+)\|/gm)].map((m) => ({
      file: m[1],
      by: m[2].trim(),
    }))
  }

  it('lists every migration in supabase/migrations exactly once', () => {
    // THE CHECK THAT WOULD HAVE CAUGHT 0031. A migration no requirement
    // explains is either dead or undocumented; either way somebody has to say
    // which, in writing, before it can sit in this repository unremarked.
    const listed = ledger().map((row) => row.file)
    expect(listed.length).toBeGreaterThan(0)
    expect([...listed].sort()).toEqual([...MIGRATION_NAMES])
  })

  it('names only requirements that exist, and only migrations that exist', () => {
    const ids = new Set(requirements().map((r) => r.id))
    for (const row of ledger()) {
      expect(MIGRATION_NAMES, `${row.file} is not a migration`).toContain(row.file)
      if (row.by === 'pre-brief') continue
      const cited = [...row.by.matchAll(/BRD-\d{3}/g)].map((m) => m[0])
      expect(cited.length, `${row.file} cites nothing`).toBeGreaterThan(0)
      for (const id of cited) {
        expect(ids, `${row.file} cites ${id}, which is not in the register`).toContain(id)
      }
    }
  })

  it("fixes the 'pre-brief' escape hatch at 0022, so a new migration cannot use it", () => {
    // `pre-brief` is an honest answer for the twenty-two OpsTrack migrations
    // this programme inherited and a dishonest one for anything written since.
    // Pinning the SET rather than the marker is what stops the next
    // undocumented table being filed under it.
    const preBrief = ledger().filter((row) => row.by === 'pre-brief').map((row) => row.file)
    expect([...preBrief].sort()).toEqual(
      MIGRATION_NAMES.filter((n) => Number(n.slice(0, 4)) <= 22),
    )
    for (const name of MIGRATION_NAMES.filter((n) => Number(n.slice(0, 4)) >= 23)) {
      const row = ledger().find((r) => r.file === name)
      expect(row?.by, `${name} names no requirement`).toMatch(/BRD-\d{3}/)
    }
  })
})

describe('the permission keys are all written down', () => {
  it('every key pinned by role_permissions_key_ck appears in the register', () => {
    // 0025: "A permission is a PROMISE THE CODE ENFORCES. A key nobody checks
    // grants nothing." The register makes two statements about who may do what
    // — BRD-024 and BRD-037 — and a register that names four of five keys is a
    // register with a silent fifth power in it.
    const sql = MIGRATIONS[
      Object.keys(MIGRATIONS).find((p) => p.includes('0025_roles_permissions')) ?? ''
    ]
    expect(sql, '0025_roles_permissions.sql not found').toBeTruthy()

    const check = /role_permissions_key_ck[\s\S]*?check \(permission_key in \(([\s\S]*?)\)\)/.exec(
      sql ?? '',
    )?.[1]
    expect(check, 'the key catalogue could not be read out of 0025').toBeTruthy()

    const keys = [...(check ?? '').matchAll(/'([a-z_.]+)'/g)].map((m) => m[1])
    // Guard against a regex that matched an empty list and made this vacuous.
    expect(keys.length).toBeGreaterThanOrEqual(5)
    expect(keys).toContain('workspace.admin')

    for (const key of keys) {
      expect(
        FLAT.includes(`\`${key}\``),
        `permission key ${key} is not in the register`,
      ).toBe(true)
    }
  })
})

describe('no bare percentage anywhere in the register', () => {
  it('has no digit followed by a per-cent sign', () => {
    // House rule 1. "222 of 715", never a naked share: a share hides its
    // denominator and the denominator is the honest part. The check is
    // deliberately dumb — a digit then `%` — because every legitimate way to
    // write a proportion in this programme reads `N of M` and contains neither.
    const hits = [...REGISTER.matchAll(/.{0,60}\d\s*%.{0,20}/g)].map((m) => m[0])
    expect(hits).toEqual([])
  })
})

describe('the eleven use cases are spelled the way the decisions spell them', () => {
  // The list IS the universe (BRD-008), and 11 × 141 = 1,551 is the
  // denominator every sentence in the programme is printed against. A
  // misspelling here is a twelfth use case nobody voted for.
  const USE_CASES = [
    'ADT',
    'Medication Prescribe V1',
    'Medication Prescribe V2',
    'Medication Dispense V1',
    'Medication Dispense V2',
    'Rad Report',
    'Rad Order',
    'Lab Result',
    'Lab Order',
    'Clinical Notes',
    'Vital Signs',
  ]

  it('names all eleven, exactly', () => {
    expect(USE_CASES.length).toBe(11)
    for (const name of USE_CASES) {
      expect(FLAT.includes(name), `use case "${name}" is not in the register`).toBe(true)
    }
  })

  it('still prints the grid the eleven produce', () => {
    expect(FLAT.includes('141 × 11 = 1,551')).toBe(true)
  })
})
