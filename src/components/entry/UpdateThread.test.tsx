// The update thread's COMPOSER, and the one decision it makes.
//
// WHY renderToStaticMarkup AND NOT A DOM. vitest.config.ts is `environment:
// 'node'` on purpose and there is no jsdom in the dependency budget —
// atoms.test.tsx, Entry.test.tsx and FollowUps.test.tsx all open with the same
// paragraph. So the composer's decision is not asserted by pressing a button;
// it is asserted where the fix put it, in `submitComposerUpdate()`, which
// answers one question — may the box clear? — and takes its two effects as
// parameters.
//
// WHY THE MOCKS. The four stores this component reads touch `window` or
// `localStorage` at module init, which is fatal under `node`. Everything else
// is real: the real `t()`, so an assertion can name the sentence a user sees
// rather than the key it came from.

import { describe, expect, it, vi } from 'vitest'
import type { ApiResult } from '../../api/result'
import type { EntryUpdate } from '../../types'

vi.hoisted(() => {
  const mem = new Map<string, string>()
  const g = globalThis as unknown as Record<string, unknown>
  g.localStorage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => void mem.set(k, v),
    removeItem: (k: string) => void mem.delete(k),
    clear: () => mem.clear(),
    key: (i: number) => [...mem.keys()][i] ?? null,
    get length() {
      return mem.size
    },
  }
  g.addEventListener = () => {}
  g.removeEventListener = () => {}
  g.window = globalThis
  g.document = { documentElement: { dir: 'ltr', lang: 'en' } }
})

vi.mock('../../store/entries', () => ({
  useEntryUpdates: () => ({ updates: [], loading: false, error: null }),
  loadUpdates: () => Promise.resolve(),
  postUpdate: () => Promise.resolve({ ok: false, error: 'common.error' }),
}))

vi.mock('../../store/auth', () => ({
  useAuth: () => ({ session: null, profile: { id: 'u1', displayName: 'Me', role: 'member', locale: null }, loading: false }),
}))

vi.mock('../../store/members', () => ({
  useMemberMap: () => new Map(),
}))

vi.mock('../../store/vocab', () => ({
  useVocabLabel: () => (_kind: string, key: string) => key,
}))

const { submitComposerUpdate } = await import('./UpdateThread')
const { t } = await import('../../lib/i18n')

// The component's own source, for the wiring assertions at the bottom. Read
// through import.meta.glob('?raw') rather than node:fs, for the reason
// lib/localeReach.test.ts gives: tsconfig.app.json pins `types:
// ["vite/client"]`, and widening it to include "node" would leak node globals
// into the type space of every app file.
const SOURCES: Record<string, string> = import.meta.glob('./UpdateThread.tsx', {
  query: '?raw',
  import: 'default',
  eager: true,
})
const SOURCE = SOURCES['./UpdateThread.tsx'] ?? ''

const landed = (body: string): Promise<ApiResult<EntryUpdate>> =>
  Promise.resolve({
    ok: true,
    data: {
      id: 'u-1',
      entry_id: 'e1',
      author_id: 'u1',
      body,
      status_from: null,
      status_to: null,
      created_at: '2026-07-29T09:00:00Z',
    },
  })

/* ─────────── R2-ARCH-3: a queued post is a post, not a failure ─────────── */
//
// `store/outbox.ts:488` freezes the contract: `fail('offline.queued')` is a
// NOTICE, and callers "must not roll their optimistic state back on it".
// `postUpdate()` honours it (entries.ts:1625) — the optimistic thread row stays
// and `markQueued()` is set — but this composer used to read `if (result.ok)
// setBody('')`, which left the sentence sitting in the box with the SAME
// sentence already rendered in the thread below it and nothing anywhere saying
// it was saved.
//
// The second Post that invites is not a retry. `postUpdate()` mints a fresh
// tempId per call (entries.ts:1576) and `dedupeKeyFor()` (312-318) builds the
// outbox's collapse key from it, so two presses are two items with two keys and
// both flush. `entry_updates` has no UPDATE and no DELETE policy (0001:408-416,
// reaffirmed by 0009:92-97) — this file's own header is about exactly that — so
// once they land, neither copy can be removed by anyone, ever.
describe('UpdateThread — submitComposerUpdate', () => {
  it('clears the box on a landed post, and says nothing', async () => {
    const said: string[] = []
    const clear = await submitComposerUpdate(
      { entryId: 'e1', body: 'ring switch replaced' },
      (i) => landed(i.body ?? ''),
      (m) => void said.push(m),
    )
    expect(clear).toBe(true)
    // The row appearing in the thread IS the feedback; a toast on every post
    // would be noise on the screen where updates are written all day.
    expect(said).toEqual([])
  })

  it('clears the box on a QUEUED post, and says so', async () => {
    const said: string[] = []
    const clear = await submitComposerUpdate(
      { entryId: 'e1', body: 'ring switch replaced' },
      () => Promise.resolve({ ok: false, error: 'offline.queued' }),
      (m) => void said.push(m),
    )
    expect(clear).toBe(true)
    // The notice is not decoration. The optimistic row is visually identical to
    // a landed one — `.upd-list` renders no queued badge — so without this
    // sentence the two states are indistinguishable, which is what made a
    // second press the reasonable thing to do.
    expect(said).toEqual([t('offline.queued')])
  })

  it('KEEPS the box on a real failure: the text is the only copy left', async () => {
    const said: string[] = []
    const clear = await submitComposerUpdate(
      { entryId: 'e1', body: 'ring switch replaced' },
      () => Promise.resolve({ ok: false, error: 'entry.errNotYours' }),
      (m) => void said.push(m),
    )
    expect(clear).toBe(false)
    // The store has already toasted the reason; saying it twice is not clarity.
    expect(said).toEqual([])
  })

  it('posts exactly once, with the entry id and body it was handed', async () => {
    // The failure this fix prevents is a SECOND WRITE, so a regression that
    // "fixes" the toast by posting again has to fail here.
    const calls: { entryId: string; body?: string }[] = []
    await submitComposerUpdate({ entryId: 'e1', body: 'ring switch replaced' }, (i) => {
      calls.push(i)
      return landed(i.body ?? '')
    })
    expect(calls).toEqual([{ entryId: 'e1', body: 'ring switch replaced' }])
  })
})

describe('UpdateThread — the composer is wired to that decision', () => {
  /** The `const post = async …` statement, to its closing brace. */
  const block = ((): string => {
    const at = SOURCE.indexOf('const post = async ()')
    if (at === -1) return ''
    const end = SOURCE.indexOf('\n  }\n', at)
    return SOURCE.slice(at, end === -1 ? undefined : end)
  })()

  it('found the handler at all', () => {
    // Guards the two assertions below against being vacuously true.
    expect(block).not.toBe('')
  })

  it('clears on the helper answer rather than on `result.ok`', () => {
    expect(block).toContain('await submitComposerUpdate(')
    expect(block).toContain('if (clear) setBody')
    // The defect in one token: branching on ok alone folds "queued" into
    // "failed", because a queued write returns ok: false.
    expect(block).not.toContain('result.ok')
  })
})
