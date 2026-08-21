// Proof for the map's branch composer.
//
// WHY renderToStaticMarkup AND NOT A DOM. vitest.config.ts is `environment:
// 'node'` and jsdom is not in the dependency budget — Board.test.tsx,
// MindtreeTable.test.tsx and the entry kit's own test all open with that
// paragraph. `react-dom/server` exercises the real tree and the real locale
// bundle and hands back markup to assert on.
//
// WHAT IS MOCKED AND WHAT IS NOT. `store/entries` is stubbed, because it reaches
// `store/outbox` and `api/*` and this file has nothing to say about either.
// `lib/mindtree/actions.draftAt` is the REAL module: the assertion this file
// exists for is that a branch three rings deep files a new item under EVERY step
// of its path, and a test that mocked the fold would be asserting that this
// component can call a function.
//
// WHAT IT CANNOT SEE, and claims nothing about: the portal, the placement pass,
// the submit round trip and the restore-on-failure path — all four are behind a
// state change, an await or a layout effect that a server render does not run.
// The panel is therefore a separate component taking its position as a prop, and
// the one decision that could silently lose data — mapping a folded draft onto
// the shape `createEntryOptimistic` takes, with the owner pair intact — is a
// pure function asserted below without rendering anything.

import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { createRef } from 'react'
import type { MindNode } from '../../lib/mindtree/model'

vi.hoisted(() => {
  // lib/i18n reads localStorage at module scope, so this cannot wait for a
  // beforeAll(): the imports below run first.
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
})

// The store's edge, stubbed. Nothing below calls it — the component half that
// does is behind an await — but importing QuickAdd pulls the module in.
vi.mock('../../store/entries', () => ({
  createEntryOptimistic: () => Promise.resolve({ ok: false, error: 'common.error' }),
}))

// Imported for `invalidateConfig`. The real module registers a `window` focus
// listener at module scope and there is no DOM here.
vi.mock('../../store/config', () => ({ invalidateConfig: () => {} }))

const { QuickAddPanel, draftToNewEntry } = await import('./QuickAdd')
const { draftAt, draftRefusal } = await import('../../lib/mindtree/actions')
const { NO_VALUE, NAME_PREFIX } = await import('../../lib/mindtree/dropRules')

/* ────────────────────────────── fixtures ─────────────────────────────────── */

function node(over: Partial<MindNode> & Pick<MindNode, 'id' | 'kind'>): MindNode {
  return {
    label: { kind: 'text', text: 'Network' },
    count: 3,
    colourVars: {},
    health: { levels: { ok: 3, stale: 0, overdue: 0, critical: 0 }, slaBreached: false },
    children: [],
    collapsed: false,
    depth: 1,
    entryId: null,
    bucketKey: null,
    entityType: null,
    retired: false,
    ...over,
  }
}

const ROOT = node({ id: 'root', kind: 'root', depth: 0 })
const TRACK = node({ id: 'root/track:t-net', kind: 'track', bucketKey: 't-net' })

function group(bucketKey: string, over: Partial<MindNode> = {}): MindNode {
  return node({
    id: `root/track:t-net/group:${bucketKey}`,
    kind: 'group',
    depth: 2,
    bucketKey,
    ...over,
  })
}

/* ───────────────────── the fold, mapped onto a create ────────────────────── */

describe('draftToNewEntry', () => {
  it('files a new item under EVERY step of the branch it was raised from', () => {
    // The bug this closes: ring 2 is drawn INSIDE ring 1, so "Blocked" under
    // Network means "blocked AND on Network". An item created there carrying
    // only its status would be filed untracked and appear somewhere else — the
    // reader watching their own click land in the wrong place.
    // `mapNodeId: null` is EXPLICIT, not absent: a track step means "on this
    // track, under none of its organizations", and an absent key would leave a
    // dragged row filed under whatever Org it came from.
    const draft = draftAt([ROOT, TRACK, group('blocked')], 'status')
    expect(draft).toEqual({ trackId: 't-net', mapNodeId: null, status: 'blocked' })
    expect(draftToNewEntry(draft ?? {}, '  Patch the edge switch  ')).toEqual({
      title: '  Patch the edge switch  ',
      trackId: 't-net',
      mapNodeId: null,
      status: 'blocked',
    })
  })

  it('carries BOTH owner keys when the branch is Unassigned', () => {
    // `ownerId: null` is falsy, so the XOR clears nothing on its own. Copying
    // the pair as two independent optional fields is what preserves the fix
    // dropRules.ownerPatch exists for.
    const draft = draftAt([ROOT, TRACK, group(NO_VALUE)], 'owner')
    expect(draft).toEqual({ trackId: 't-net', mapNodeId: null, ownerId: null, ownerName: null })
    const input = draftToNewEntry(draft ?? {}, 'x')
    expect(input.ownerId).toBeNull()
    expect(input.ownerName).toBeNull()
    expect('ownerName' in input).toBe(true)
  })

  it('carries a free-text owner through as a name, never as an id', () => {
    const draft = draftAt([ROOT, TRACK, group(`${NAME_PREFIX}Acme Ltd`)], 'owner')
    const input = draftToNewEntry(draft ?? {}, 'x')
    expect(input.ownerName).toBe('Acme Ltd')
    expect(input.ownerId).toBeNull()
  })

  it('files under the track alone when the branch is a track', () => {
    expect(draftToNewEntry(draftAt([ROOT, TRACK], 'status') ?? {}, 'x')).toEqual({
      title: 'x',
      trackId: 't-net',
      mapNodeId: null,
    })
  })

  it('sets nothing at all from the root', () => {
    expect(draftToNewEntry({}, 'x')).toEqual({ title: 'x' })
  })

  it('copies no key the draft did not set', () => {
    // Field by field, not a spread: a sixth key arriving on EntryPatch later
    // must not silently become part of every create raised from the map.
    const input = draftToNewEntry({ trackId: 't-net' }, 'x')
    expect(Object.keys(input).sort()).toEqual(['title', 'trackId'])
  })
})

describe('the branches that cannot hold new work', () => {
  it('refuses the health axis, because the ring is derived', () => {
    // v_entry_health works the levels out from due dates and activity, so there
    // is no column to seed.
    const path = [ROOT, TRACK, group('late')]
    expect(draftAt(path, 'health')).toBeNull()
    expect(draftRefusal(path, 'health')).toBe('mindtree.whyDerived')
  })

  it('refuses a retired bucket anywhere on the path', () => {
    // Archiving is a filing decision, and creating new items under an archived
    // track is how one quietly comes back to life.
    const path = [ROOT, node({ ...TRACK, retired: true }), group('blocked')]
    expect(draftAt(path, 'status')).toBeNull()
    expect(draftRefusal(path, 'status')).toBe('mindtree.whyRetired')
  })

  it('refuses a leaf', () => {
    const leaf = node({ id: 'root/track:t-net/entry:e1', kind: 'entry', entryId: 'e1', depth: 3 })
    expect(draftAt([ROOT, TRACK, leaf], 'status')).toBeNull()
  })
})

/* ──────────────────────────────── the panel ──────────────────────────────── */

describe('QuickAddPanel', () => {
  function render(over: Partial<Parameters<typeof QuickAddPanel>[0]> = {}): string {
    return renderToStaticMarkup(
      <QuickAddPanel
        panelRef={createRef<HTMLDivElement>()}
        inputRef={createRef<HTMLInputElement>()}
        titleId="qt"
        hintId="qh"
        heading="Add under ⁨Blocked⁩"
        title=""
        busy={false}
        refusal={null}
        offset={{ inlineStart: 20, blockStart: 40 }}
        onTitle={() => {}}
        onSubmit={() => {}}
        onCancel={() => {}}
        onBlurCapture={() => {}}
        {...over}
      />,
    )
  }

  const html = render()

  it('names itself after the branch it is filing into', () => {
    // The popover opens away from the node, and an item filed under the wrong
    // branch is the one thing this control must never do quietly.
    expect(html).toContain('aria-labelledby="qt"')
    expect(html).toContain('id="qt"')
    expect(html).toContain('Add under ⁨Blocked⁩')
  })

  it('is a group, not a dialog', () => {
    // It does not trap focus and it does not make the map inert; calling it a
    // dialog would tell a screen reader to expect both.
    expect(html).toContain('role="group"')
    expect(html).not.toContain('aria-modal')
  })

  it('gives the field a name, a placeholder and the hint it is described by', () => {
    expect(html).toContain('aria-label="New item"')
    expect(html).toContain('placeholder="What needs doing?"')
    expect(html).toContain('aria-describedby="qh"')
    expect(html).toContain('id="qh"')
    expect(html).toContain('Enter adds it and leaves the box open for the next one.')
  })

  it('wears the BRANCH strings in branch mode', () => {
    // The one half of the branch composer a server render can see: same panel,
    // same form, four different strings. If these ever come back as the entry
    // set, `mode` has stopped reaching the panel and the reader is being asked
    // "What needs doing?" while naming a department.
    const branch = render({ mode: 'branch', heading: 'New branch under ⁨UHR⁩' })
    expect(branch).toContain('aria-label="Branch name"')
    expect(branch).toContain('placeholder="Name this branch"')
    expect(branch).toContain('Add branch')
    expect(branch).toContain('New branch under ⁨UHR⁩')
    // And not the item strings, which is the failure worth naming.
    expect(branch).not.toContain('aria-label="New item"')
    expect(branch).not.toContain('placeholder="What needs doing?"')
  })

  it('refuses to submit an empty line', () => {
    expect(html).toContain('disabled=""')
  })

  it('enables the submit once there is something to add', () => {
    expect(render({ title: 'Patch the edge switch' })).not.toContain('disabled=""')
  })

  it('reports that a write is in flight', () => {
    expect(render({ title: 'x', busy: true })).toContain('aria-busy="true"')
  })

  it('draws NO form at all when the branch cannot hold new work', () => {
    // An input that cannot submit teaches the reader to press Enter and get
    // nothing. actions.ts already disables the verb; this is the frame where the
    // tree changed underneath an open popover.
    const refused = render({ refusal: 'That branch is no longer in use and cannot take new work.' })
    expect(refused).not.toContain('<input')
    expect(refused).not.toContain('<form')
    expect(refused).toContain('That branch is no longer in use and cannot take new work.')
  })

  it('positions on the logical axes only', () => {
    expect(html).toContain('inset-inline-start:20px')
    expect(html).toContain('inset-block-start:40px')
    expect(html).not.toContain('left:')
    expect(html).not.toContain('top:')
  })

  it('stays hidden until it has been measured', () => {
    expect(render({ offset: null })).toContain('visibility:hidden')
  })

  it('caps the title at the length the rest of the app caps it at', () => {
    // Case-insensitive because react-dom/server emits the JSX spelling
    // (`maxLength`) and HTML attribute names are ASCII case-insensitive — the
    // browser reads it as `maxlength` either way. EntrySheet and the board
    // composer both cap at the same 200.
    expect(html).toMatch(/maxlength="200"/i)
  })
})
