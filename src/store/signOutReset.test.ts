// Every store's sign-out reset is actually called on sign-out.
//
// WHY THIS IS A SOURCE-READING TEST AND NOT A UNIT TEST. The bug it exists to
// close is a WIRING bug, and wiring is invisible to a test that mocks either
// side: store/meetings.ts's `resetMeetings()` was written, documented ("Another
// account's meetings and, worse, another account's unsaved triage drafts must
// not survive into the next session in this tab"), exported — and never called
// from anywhere, for two release rounds. Every test of the meetings store still
// passed, because a test calls the function itself. The only thing that could
// have caught it is an assertion about the COMPOSITION ROOT, which is what this
// is. store/outbox.test.ts asserts the transport registry against main.tsx the
// same way and for the same reason.
//
// WHAT COUNTS AS WIRED. Shell's unmount cleanup in src/App.tsx is the sign-out
// teardown — Shell renders only while there is a session, so its cleanup runs
// exactly when one ends. A reset is wired if it is called there. store/auth.ts
// publishes no reset of its own and needs none: it OWNS the session, and a
// teardown driven by the auth store cannot also be the thing that clears it.
//
// Source is read through import.meta.glob('?raw') rather than node:fs, for the
// reason lib/localeReach.test.ts spells out: tsconfig.app.json pins
// `types: ["vite/client"]`, and adding "node" would leak node globals into the
// type space of every app file.

import { describe, expect, it } from 'vitest'

// The options object has to be an inline literal — Vite parses this statically.
const STORE_FILES: Record<string, string> = import.meta.glob('./*.ts', {
  query: '?raw',
  import: 'default',
  eager: true,
})
const APP_FILE: Record<string, string> = import.meta.glob('../App.tsx', {
  query: '?raw',
  import: 'default',
  eager: true,
})

/**
 * Resets that are deliberately NOT part of Shell's teardown, each with the
 * reason. EMPTY TODAY, and that is the point: all six are wired. The map exists
 * so that the day a store has a real reason to opt out, the reason has to be
 * written down next to the name instead of the assertion being loosened. The
 * third test below fails on an exemption whose function no longer exists, so it
 * cannot rot into a blanket permission.
 */
const EXEMPT = new Map<string, string>()

function appSource(): string {
  const entry = Object.values(APP_FILE)[0]
  if (entry === undefined) throw new Error('src/App.tsx not found by import.meta.glob')
  return entry
}

/** Every `export function reset*()` under src/store, with the file it is in. */
function resetExports(): { file: string; name: string }[] {
  const RE = /export\s+function\s+(reset[A-Z]\w*)\s*\(/g
  const out: { file: string; name: string }[] = []
  for (const [path, text] of Object.entries(STORE_FILES)) {
    if (path.endsWith('.test.ts')) continue
    for (const m of text.matchAll(RE)) out.push({ file: path.replace('./', 'src/store/'), name: m[1] })
  }
  return out
}

/** Shell's cleanup block: everything between `return () => {` and its close. */
function shellCleanup(): string {
  const src = appSource()
  const at = src.indexOf('return () => {')
  if (at < 0) throw new Error("Shell's cleanup block not found in src/App.tsx")
  // The block ends at the first line that closes it at the same indentation.
  const end = src.indexOf('\n    }', at)
  if (end < 0) throw new Error("Shell's cleanup block is unterminated in src/App.tsx")
  return src.slice(at, end)
}

describe('sign-out reset coverage', () => {
  it('finds the reset exports it is supposed to be checking', () => {
    // A regex that silently matched nothing would make the assertion below
    // vacuously true — the precise failure mode that let resetMeetings ship
    // with no caller.
    const resets = resetExports()
    expect(resets.length).toBeGreaterThanOrEqual(6)
    expect(resets.map((r) => r.name)).toContain('resetMeetings')
    expect(shellCleanup()).toContain('resetEntries()')
  })

  it('calls every store reset from Shell, or names why not', () => {
    const cleanup = shellCleanup()
    const missing = resetExports()
      .filter((r) => !EXEMPT.has(r.name) && !cleanup.includes(`${r.name}()`))
      .map((r) => `${r.file} exports ${r.name}(), which Shell's sign-out cleanup never calls`)
    expect(missing).toEqual([])
  })

  it('keeps the exemption list honest — no reason for a reset that is gone', () => {
    // An exemption that outlives the function it excuses is how a list like this
    // rots into a blanket permission. Deleting a store must fail here until its
    // line is deleted too.
    const names = new Set(resetExports().map((r) => r.name))
    const stale = [...EXEMPT.keys()].filter((name) => !names.has(name))
    expect(stale).toEqual([])
  })
})
