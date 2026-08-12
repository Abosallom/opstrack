// importManifest — the tests that stand in for the thing nobody on this fleet
// is allowed to do: run `--undo --apply` against Aziz's live project.
//
// Every case here is a way a reset could destroy real work. The demo data this
// undo exists for is data he is MEANT to use — he will file entries under a
// dummy Organization, add a department under it, correct a name — and every one
// of those makes a row that the manifest names but no longer owns. So the
// fixtures below are built around that: a node with a child the import never
// created, a node with entries filed on it, a link somebody re-statused, a node
// somebody moved. The assertion is always the same shape — NOT DELETED, and
// SAID SO OUT LOUD.
//
// The two properties that would rot first, and are asserted directly:
//   * DEEPEST FIRST — every delete's depth is >= the next one's, and every
//     link removal precedes every delete.
//   * IDEMPOTENT — the same plan, run against a workspace where everything is
//     already gone, produces zero actions and zero errors.

import { readFileSync } from 'node:fs'

import { describe, it, expect } from 'vitest'

import { parseStructureCsv, planStructure, mergeRefusals, keyOf } from './structurePlan.mjs'
import {
  MANIFEST_VERSION,
  buildManifest,
  manifestFileName,
  manifestIsEmpty,
  manifestNodeIds,
  parseManifest,
  planUndo,
  renderUndoPlan,
  serializeManifest,
} from './importManifest.mjs'

// ── fixtures ────────────────────────────────────────────────────────────────
//
// One track (UHR), one pre-existing node (OB, NOT created by the import), and a
// demo branch beneath it: two Organizations, one with a department.

const OB = 'n-ob'

const NODES = [
  { id: 'n-org1', path: ['UHR', 'OB', 'Riyadh General'], depth: 2, parentId: OB, trackId: 't-uhr', implied: false },
  {
    id: 'n-dept1',
    path: ['UHR', 'OB', 'Riyadh General', 'Emergency'],
    depth: 3,
    parentId: 'n-org1',
    trackId: 't-uhr',
    implied: false,
  },
  { id: 'n-org2', path: ['UHR', 'OB', 'Jeddah Clinic'], depth: 2, parentId: OB, trackId: 't-uhr', implied: false },
]

const LINKS = [
  { nodeId: 'n-org1', useCaseId: 'u-adt', path: ['UHR', 'OB', 'Riyadh General'], useCase: 'ADT', status: 'live', previousStatus: null },
  {
    nodeId: 'n-org1',
    useCaseId: 'u-lab',
    path: ['UHR', 'OB', 'Riyadh General'],
    useCase: 'Lab Order',
    status: 'planned',
    previousStatus: null,
  },
  { nodeId: 'n-org2', useCaseId: 'u-adt', path: ['UHR', 'OB', 'Jeddah Clinic'], useCase: 'ADT', status: 'testing', previousStatus: null },
]

function manifest(over = {}) {
  return buildManifest({
    file: 'docs/templates/structure.demo.csv',
    projectRef: 'lrysgpbkmuqgzsjesfkr',
    startedAt: '2026-08-12T09:31:07.412Z',
    finishedAt: '2026-08-12T09:31:11.980Z',
    createdNodes: NODES,
    setUseCases: LINKS,
    ...over,
  })
}

/** The live rows for a manifest where nothing at all has changed since. */
function untouched(m = manifest()) {
  return {
    nodes: m.createdNodes.map((n) => ({
      id: n.id,
      parent_id: n.parentId,
      track_id: n.trackId,
      name: n.path[n.path.length - 1],
      name_ar: '',
      description: '',
      description_ar: '',
      account_manager_id: null,
      vendor: '',
      archived: false,
    })),
    children: m.createdNodes
      .filter((n) => m.createdNodes.some((p) => p.id === n.parentId))
      .map((n) => ({ id: n.id, parent_id: n.parentId, name: n.path[n.path.length - 1], archived: false })),
    entries: [],
    links: m.setUseCases.map((l) => ({ node_id: l.nodeId, use_case_id: l.useCaseId, status: l.status })),
    useCases: [],
    useCaseLinks: [],
  }
}

const kinds = (plan, kind) => plan.actions.filter((a) => a.kind === kind)
const state = (plan, id) => plan.nodeStates.find((s) => s.id === id)

/**
 * The printout with its bidi isolates removed.
 *
 * Every name in the plan is wrapped in FSI…PDI so an Arabic organization does
 * not reorder the ASCII scaffolding around it — which means the rendered text
 * has an invisible character between `Riyadh General` and the two spaces before
 * `DELETE`, and a naive assertion fails against output that is perfectly
 * correct. Asserting on the stripped string keeps the tests about the WORDS;
 * the isolates have their own coverage in structurePlan.test.mjs.
 */
const plain = (text) => text.replace(/\p{Cf}/gu, '')

// ── the file itself ─────────────────────────────────────────────────────────

describe('the manifest file', () => {
  it('round-trips through JSON unchanged', () => {
    const m = manifest()
    const { manifest: back, errors } = parseManifest(serializeManifest(m))
    expect(errors).toEqual([])
    expect(back.createdNodes).toEqual(m.createdNodes)
    expect(back.setUseCases).toEqual(m.setUseCases)
    expect(back.projectRef).toBe('lrysgpbkmuqgzsjesfkr')
    expect(back.manifestVersion).toBe(MANIFEST_VERSION)
  })

  it('refuses to record a node with no id, rather than recording a row nothing can name', () => {
    expect(() => buildManifest({ createdNodes: [{ path: ['UHR', 'X'] }] })).toThrow(/could never be undone/u)
  })

  it('refuses to record a link with no capability id', () => {
    expect(() => buildManifest({ setUseCases: [{ nodeId: 'n-1', path: ['UHR', 'X'], useCase: 'ADT' }] })).toThrow(
      /could never be undone/u,
    )
  })

  it('reads back nothing from a file that is not JSON', () => {
    const { manifest: m, errors } = parseManifest('path,name_ar,kind\nUHR > OB,,Phase\n')
    expect(m).toBeNull()
    expect(errors[0]).toMatch(/not valid JSON/u)
  })

  it('refuses a manifest from a future version instead of undoing the parts it recognises', () => {
    const raw = { ...manifest(), manifestVersion: MANIFEST_VERSION + 1 }
    const { manifest: m, errors } = parseManifest(JSON.stringify(raw))
    expect(m).toBeNull()
    expect(errors.join(' ')).toMatch(/version/u)
  })

  it('refuses a JSON file written by something else', () => {
    const { manifest: m, errors } = parseManifest(JSON.stringify({ tool: 'provision-people', manifestVersion: 1 }))
    expect(m).toBeNull()
    expect(errors.join(' ')).toMatch(/not by import-structure/u)
  })

  it('refuses a manifest whose sections have been hand-edited into something else', () => {
    const { manifest: m, errors } = parseManifest(JSON.stringify({ ...manifest(), createdNodes: 'all of them' }))
    expect(m).toBeNull()
    expect(errors.join(' ')).toMatch(/not a list/u)
  })

  it('knows when a run wrote nothing at all', () => {
    expect(manifestIsEmpty(buildManifest({}))).toBe(true)
    expect(manifestIsEmpty(manifest())).toBe(false)
  })

  it('names files so the newest sorts last', () => {
    const a = manifestFileName('2026-08-12T09:31:07.412Z', 'lrysgpbkmuqgzsjesfkr')
    const b = manifestFileName('2026-08-12T11:02:44.000Z', 'lrysgpbkmuqgzsjesfkr')
    expect(a).toBe('import-20260812T093107Z-lrysgpbkmuqgzsjesfkr.json')
    expect([b, a].sort()).toEqual([a, b])
  })

  it('lists every node id the CLI has to re-read, once each', () => {
    const ids = manifestNodeIds(manifest())
    expect(ids).toEqual(['n-org1', 'n-dept1', 'n-org2'])
  })
})

// ── the reversal, when nothing has changed ──────────────────────────────────

describe('a clean undo', () => {
  it('deletes every node it created and clears every link it set', () => {
    const m = manifest()
    const plan = planUndo({ manifest: m, ...untouched(m) })
    expect(kinds(plan, 'delete-node').map((a) => a.path.join(' > '))).toEqual([
      'UHR > OB > Riyadh General > Emergency',
      'UHR > OB > Jeddah Clinic',
      'UHR > OB > Riyadh General',
    ])
    expect(plan.summary).toMatchObject({ remove: 3, refused: 0, alreadyGone: 0, clearLinks: 3, restoreLinks: 0 })
    expect(plan.summary.partial).toBe(false)
  })

  it('never touches the node the import did not create', () => {
    const plan = planUndo({ manifest: manifest(), ...untouched() })
    const touched = plan.actions.map((a) => a.nodeId)
    expect(touched).not.toContain(OB)
  })

  // ⚠ THE ORDERING PROPERTY. 0023 refuses to delete a node while anything points
  // at it, so a shallow-first pass fails on the first parent and leaves the tree
  // half-removed.
  it('deletes deepest first', () => {
    const plan = planUndo({ manifest: manifest(), ...untouched() })
    const depths = kinds(plan, 'delete-node').map((a) => a.depth)
    expect(depths).toEqual([...depths].sort((a, b) => b - a))
  })

  it('takes the links off before it deletes anything', () => {
    const plan = planUndo({ manifest: manifest(), ...untouched() })
    const lastLink = plan.actions.map((a) => a.kind).lastIndexOf('remove-links')
    const firstDelete = plan.actions.findIndex((a) => a.kind === 'delete-node')
    expect(lastLink).toBeLessThan(firstDelete)
  })

  it('batches link removals into one statement per node', () => {
    const plan = planUndo({ manifest: manifest(), ...untouched() })
    const batch = kinds(plan, 'remove-links').find((a) => a.nodeId === 'n-org1')
    expect(batch.useCaseIds.sort()).toEqual(['u-adt', 'u-lab'])
    expect(kinds(plan, 'remove-links')).toHaveLength(2)
  })
})

// ── idempotence ─────────────────────────────────────────────────────────────

describe('running it twice', () => {
  it('is a no-op when everything is already gone', () => {
    const plan = planUndo({ manifest: manifest(), nodes: [], children: [], entries: [], links: [] })
    expect(plan.actions).toEqual([])
    expect(plan.summary).toMatchObject({ remove: 0, refused: 0, alreadyGone: 3, clearLinks: 0 })
    expect(plan.summary.goneLinks).toBe(3)
  })

  it('is a no-op for the half somebody removed by hand in the app', () => {
    const m = manifest()
    const live = untouched(m)
    live.nodes = live.nodes.filter((n) => n.id !== 'n-org2')
    live.links = live.links.filter((l) => l.node_id !== 'n-org2')
    const plan = planUndo({ manifest: m, ...live })
    expect(state(plan, 'n-org2').disposition).toBe('already-gone')
    expect(plan.summary).toMatchObject({ remove: 2, alreadyGone: 1 })
  })
})

// ── the refusals: a node that has gained real work ──────────────────────────

describe('a node somebody has used', () => {
  it('is refused when it has a child this import never created', () => {
    const m = manifest()
    const live = untouched(m)
    live.children.push({ id: 'n-hand', parent_id: 'n-org2', name: 'Ward B', archived: false })
    const plan = planUndo({ manifest: m, ...live })
    const s = state(plan, 'n-org2')
    expect(s.disposition).toBe('refused')
    expect(s.reasons[0].message).toMatch(/Ward B/u)
    expect(kinds(plan, 'delete-node').map((a) => a.nodeId)).not.toContain('n-org2')
  })

  it('is refused when entries are filed on it, and says how many', () => {
    const m = manifest()
    const live = untouched(m)
    live.entries = [
      { id: 'e-1', node_id: 'n-org1' },
      { id: 'e-2', node_id: 'n-org1' },
    ]
    const plan = planUndo({ manifest: m, ...live })
    const s = state(plan, 'n-org1')
    expect(s.disposition).toBe('refused')
    expect(s.reasons.some((r) => r.code === 'entries' && /2 entries/u.test(r.message))).toBe(true)
  })

  // The property the whole ordering exists for: a refusal propagates UP. The
  // parent still has a child, so deleting it would fail against 0023 anyway —
  // and saying so beats a raw `map_node_in_use` from the database.
  it('takes its ancestors down with it, by name', () => {
    const m = manifest()
    const live = untouched(m)
    live.entries = [{ id: 'e-1', node_id: 'n-dept1' }]
    const plan = planUndo({ manifest: m, ...live })
    expect(state(plan, 'n-dept1').disposition).toBe('refused')
    const parent = state(plan, 'n-org1')
    expect(parent.disposition).toBe('refused')
    expect(parent.reasons.some((r) => r.code === 'descendant')).toBe(true)
    expect(kinds(plan, 'delete-node').map((a) => a.nodeId)).toEqual(['n-org2'])
  })

  // The half of the brief that is easy to forget: a refused node must not keep
  // demo capability rows nobody can explain.
  it('still has its demo capability links taken off', () => {
    const m = manifest()
    const live = untouched(m)
    live.entries = [{ id: 'e-1', node_id: 'n-org1' }]
    const plan = planUndo({ manifest: m, ...live })
    expect(state(plan, 'n-org1').disposition).toBe('refused')
    const removal = kinds(plan, 'remove-links').find((a) => a.nodeId === 'n-org1')
    expect(removal.useCaseIds.sort()).toEqual(['u-adt', 'u-lab'])
  })

  it('is refused when somebody re-parented it into their own tree', () => {
    const m = manifest()
    const live = untouched(m)
    live.nodes = live.nodes.map((n) => (n.id === 'n-org2' ? { ...n, parent_id: 'n-somewhere-else' } : n))
    const plan = planUndo({ manifest: m, ...live })
    const s = state(plan, 'n-org2')
    expect(s.disposition).toBe('refused')
    expect(s.reasons.some((r) => r.code === 'moved')).toBe(true)
  })

  // A rename is not a refusal — a renamed dummy is still a dummy, and the point
  // of a reset is that it goes. But it is SHOWN, in the dry run, before it goes.
  it('is still deleted after a rename, and the rename is printed', () => {
    const m = manifest()
    const live = untouched(m)
    live.nodes = live.nodes.map((n) => (n.id === 'n-org2' ? { ...n, name: 'Jeddah Polyclinic' } : n))
    const plan = planUndo({ manifest: m, ...live })
    expect(state(plan, 'n-org2').disposition).toBe('delete')
    expect(plain(renderUndoPlan(plan, {}))).toMatch(/renamed since the import/u)
  })

  it('reports the undo as partial and says why', () => {
    const m = manifest()
    const live = untouched(m)
    live.entries = [{ id: 'e-1', node_id: 'n-org2' }]
    const plan = planUndo({ manifest: m, ...live })
    expect(plan.summary.partial).toBe(true)
    const text = renderUndoPlan(plan, {})
    expect(text).toMatch(/THIS UNDO IS PARTIAL/u)
    expect(text).toMatch(/REFUSED — LEFT EXACTLY AS IT IS/u)
  })
})

// ── archive: opt-in, and only where the cascade cannot reach a child ────────

describe('--archive-refused', () => {
  it('archives a refused leaf that is only blocked by entries', () => {
    const m = manifest()
    const live = untouched(m)
    live.entries = [{ id: 'e-1', node_id: 'n-org2' }]
    const plan = planUndo({ manifest: m, ...live, archiveRefused: true })
    expect(state(plan, 'n-org2').disposition).toBe('archive')
    expect(kinds(plan, 'archive-node')).toHaveLength(1)
  })

  // ⚠ 0023's `map_nodes_cascade_archive` archives every descendant. Archiving a
  // node that was refused BECAUSE somebody put a node under it would archive
  // THEIR node — the loss the refusal existed to prevent, through the gentle
  // door.
  it('refuses to archive a node with children, because archiving cascades', () => {
    const m = manifest()
    const live = untouched(m)
    live.children.push({ id: 'n-hand', parent_id: 'n-org2', name: 'Ward B', archived: false })
    const plan = planUndo({ manifest: m, ...live, archiveRefused: true })
    expect(state(plan, 'n-org2').disposition).toBe('refused')
    expect(kinds(plan, 'archive-node')).toEqual([])
    expect(plain(renderUndoPlan(plan, {}))).toMatch(/archiving cascades to its children/u)
  })

  // "Archiving cascades to its children" printed under a node with no children
  // teaches the reader a rule that is not the one that applied.
  it('gives the other reason when the blocker was not entries at all', () => {
    const m = manifest()
    const live = untouched(m)
    live.nodes = live.nodes.map((n) => (n.id === 'n-org2' ? { ...n, parent_id: 'n-elsewhere' } : n))
    const text = plain(renderUndoPlan(planUndo({ manifest: m, ...live, archiveRefused: true }), {}))
    expect(text).toMatch(/covers only a node/u)
    expect(text).not.toMatch(/cascades to its children/u)
  })

  it('is off by default', () => {
    const m = manifest()
    const live = untouched(m)
    live.entries = [{ id: 'e-1', node_id: 'n-org2' }]
    expect(state(planUndo({ manifest: m, ...live }), 'n-org2').disposition).toBe('refused')
  })
})

// ── links ───────────────────────────────────────────────────────────────────

describe('use-case links', () => {
  it('restores the status that was there instead of deleting the row', () => {
    const m = manifest({
      createdNodes: [],
      setUseCases: [
        { nodeId: OB, useCaseId: 'u-adt', path: ['UHR', 'OB'], useCase: 'ADT', status: 'live', previousStatus: 'planned' },
      ],
    })
    const plan = planUndo({
      manifest: m,
      nodes: [],
      links: [{ node_id: OB, use_case_id: 'u-adt', status: 'live' }],
    })
    expect(kinds(plan, 'restore-link')).toEqual([
      { kind: 'restore-link', nodeId: OB, useCaseId: 'u-adt', path: ['UHR', 'OB'], useCase: 'ADT', status: 'planned' },
    ])
    expect(kinds(plan, 'remove-links')).toEqual([])
  })

  // WE ONLY UNDO WHAT STILL LOOKS EXACTLY LIKE WHAT WE WROTE. `testing` is a
  // human statement about a real integration; this script did not make it.
  it('leaves a link somebody has re-statused alone', () => {
    const m = manifest()
    const live = untouched(m)
    live.links = live.links.map((l) => (l.use_case_id === 'u-lab' ? { ...l, status: 'testing' } : l))
    const plan = planUndo({ manifest: m, ...live })
    const s = plan.linkStates.find((x) => x.useCaseId === 'u-lab')
    expect(s.disposition).toBe('changed-since')
    expect(kinds(plan, 'remove-links').find((a) => a.nodeId === 'n-org1').useCaseIds).toEqual(['u-adt'])
    expect(plain(renderUndoPlan(plan, {}))).toMatch(/says testing, the import wrote planned — left alone/u)
  })

  it('puts back a link the import cleared', () => {
    const m = manifest({
      createdNodes: [],
      setUseCases: [],
      clearedUseCases: [
        { nodeId: OB, useCaseId: 'u-adt', path: ['UHR', 'OB'], useCase: 'ADT', previousStatus: 'live' },
      ],
    })
    const plan = planUndo({ manifest: m, nodes: [], links: [] })
    expect(kinds(plan, 'restore-link')[0]).toMatchObject({ nodeId: OB, status: 'live' })
  })

  it('does not overwrite a cleared link somebody has re-added themselves', () => {
    const m = manifest({
      createdNodes: [],
      setUseCases: [],
      clearedUseCases: [
        { nodeId: OB, useCaseId: 'u-adt', path: ['UHR', 'OB'], useCase: 'ADT', previousStatus: 'live' },
      ],
    })
    const plan = planUndo({ manifest: m, nodes: [], links: [{ node_id: OB, use_case_id: 'u-adt', status: 'planned' }] })
    expect(plan.actions).toEqual([])
    expect(plan.linkStates[0].disposition).toBe('already-there')
  })
})

// ── fields the import overwrote ─────────────────────────────────────────────

describe('fields', () => {
  const updated = () =>
    manifest({
      createdNodes: [],
      setUseCases: [],
      updatedNodes: [
        {
          id: OB,
          path: ['UHR', 'OB'],
          changes: [
            { column: 'vendor', from: '', to: 'Mirqab Integration Co.' },
            { column: 'description', from: 'Onboarding', to: 'Provider onboarding' },
          ],
        },
      ],
    })

  it('puts the old values back', () => {
    const plan = planUndo({
      manifest: updated(),
      nodes: [{ id: OB, parent_id: null, vendor: 'Mirqab Integration Co.', description: 'Provider onboarding' }],
    })
    expect(kinds(plan, 'revert-node')[0].patch).toEqual({ vendor: '', description: 'Onboarding' })
    expect(plan.summary.revertFields).toBe(2)
  })

  it('leaves a field somebody has edited since, and says so', () => {
    const plan = planUndo({
      manifest: updated(),
      nodes: [{ id: OB, parent_id: null, vendor: 'Wasel Health', description: 'Provider onboarding' }],
    })
    expect(kinds(plan, 'revert-node')[0].patch).toEqual({ description: 'Onboarding' })
    expect(plan.summary.skippedFields).toBe(1)
    expect(plain(renderUndoPlan(plan, {}))).toMatch(/vendor: edited since the import — left alone/u)
  })

  it('treats null and the empty string as the same absence', () => {
    const m = manifest({
      createdNodes: [],
      setUseCases: [],
      updatedNodes: [{ id: OB, path: ['UHR', 'OB'], changes: [{ column: 'name_ar', from: '', to: 'التسجيل' }] }],
    })
    const plan = planUndo({ manifest: m, nodes: [{ id: OB, parent_id: null, name_ar: 'التسجيل' }] })
    expect(kinds(plan, 'revert-node')[0].patch).toEqual({ name_ar: '' })
  })
})

// ── capabilities the import created ─────────────────────────────────────────

describe('capabilities', () => {
  const withUseCase = () =>
    manifest({
      createdNodes: [],
      setUseCases: [
        { nodeId: 'n-org1', useCaseId: 'u-new', path: ['UHR', 'OB', 'Riyadh General'], useCase: 'Radiology Order', status: 'live', previousStatus: null },
      ],
      createdUseCases: [{ id: 'u-new', name: 'Radiology Order' }],
    })

  it('is removed when nothing points at it once this undo has run', () => {
    const plan = planUndo({
      manifest: withUseCase(),
      nodes: [],
      links: [{ node_id: 'n-org1', use_case_id: 'u-new', status: 'live' }],
      useCases: [{ id: 'u-new', name: 'Radiology Order' }],
      useCaseLinks: [{ node_id: 'n-org1', use_case_id: 'u-new', status: 'live' }],
    })
    expect(kinds(plan, 'delete-use-case')).toHaveLength(1)
  })

  // 0024 makes `use_case_id` ON DELETE RESTRICT so that deleting a capability
  // cannot silently erase the record of who integrated it. A link this import
  // never set is exactly that record.
  it('is KEPT when a link this import never set still uses it', () => {
    const plan = planUndo({
      manifest: withUseCase(),
      nodes: [],
      links: [{ node_id: 'n-org1', use_case_id: 'u-new', status: 'live' }],
      useCases: [{ id: 'u-new', name: 'Radiology Order' }],
      useCaseLinks: [
        { node_id: 'n-org1', use_case_id: 'u-new', status: 'live' },
        { node_id: 'n-real', use_case_id: 'u-new', status: 'live' },
      ],
    })
    expect(kinds(plan, 'delete-use-case')).toEqual([])
    expect(plan.useCaseStates[0]).toMatchObject({ disposition: 'kept', remaining: 1 })
    expect(plan.summary.partial).toBe(true)
  })

  it('is a no-op when it has already been deleted', () => {
    const plan = planUndo({ manifest: withUseCase(), nodes: [], links: [], useCases: [], useCaseLinks: [] })
    expect(plan.useCaseStates[0].disposition).toBe('already-gone')
  })
})

// ── the printout ────────────────────────────────────────────────────────────

describe('the printout', () => {
  it('says dry run until it does not', () => {
    const plan = planUndo({ manifest: manifest(), ...untouched() })
    expect(renderUndoPlan(plan, { apply: false })).toMatch(/dry run — nothing will be removed/u)
    expect(renderUndoPlan(plan, { apply: true })).toMatch(/THIS RUN REMOVES ROWS FROM THE LIVE PROJECT/u)
  })

  it('draws the tree, marks each node with what happens to it, and reconciles', () => {
    const m = manifest()
    const live = untouched(m)
    live.entries = [{ id: 'e-1', node_id: 'n-org2' }]
    live.nodes = live.nodes.filter((n) => n.id !== 'n-dept1')
    live.links = live.links.filter((l) => l.node_id !== 'n-dept1')
    const text = plain(
      renderUndoPlan(planUndo({ manifest: m, ...live }), {
        manifestPath: 'docs/EVIDENCE/import-runs/x.json',
        manifest: m,
      }),
    )
    expect(text).toMatch(/Riyadh General {3}DELETE/u)
    expect(text).toMatch(/Jeddah Clinic {3}REFUSED/u)
    expect(text).toMatch(/Emergency {3}already gone/u)
    expect(text).toMatch(/ADT: live -> \(link deleted\)/u)
    expect(text).toMatch(
      /1 node\(s\) to remove · 0 to archive · 1 refused because work is attached · 1 already gone/u,
    )
    expect(text).toMatch(/docs\/EVIDENCE\/import-runs\/x\.json/u)
  })

  it('says out loud when the run it is reversing stopped part-way', () => {
    const m = manifest({ outcome: 'partial' })
    const text = renderUndoPlan(planUndo({ manifest: m, ...untouched(m) }), { manifest: m })
    expect(text).toMatch(/STOPPED PART-WAY/u)
  })

  it('holds no secret and no uuid — paths and names only', () => {
    const m = manifest()
    const text = renderUndoPlan(planUndo({ manifest: m, ...untouched(m) }), { manifestPath: 'x.json', manifest: m })
    expect(text).not.toMatch(/n-org1|u-adt|t-uhr/u)
  })
})

// ── THE WHOLE ROUND TRIP, ON THE FILE THAT ACTUALLY GETS APPLIED ────────────
//
// Everything above is fixtures: three hand-written nodes shaped to exercise one
// rule each. This block is the other kind of proof — the real
// `docs/templates/structure.demo.csv`, planned against the live workspace as it
// was measured (UHR, one node `UHR > OB`, two members), applied into an
// in-memory snapshot, and then reversed through the manifest that a real
// `--apply` would have written from exactly those actions.
//
// ⚠ IT EXISTS BECAUSE THE LIVE VERSION OF IT IS FORBIDDEN. Nobody on this fleet
// may run `--apply` against Aziz's project, so the sentence "the demo imports
// and comes back out exactly" had, until this block, been checked only in two
// halves that never met: the planner's own round trip, and the undo's
// hand-written fixtures. The join between them — twenty-two real ids flowing
// out of an apply and back into a delete — was the part nobody had executed,
// and it is the part that deletes rows.
//
// The four properties asserted, in the words of the brief:
//   1. the undo removes EXACTLY the nodes and links the manifest names,
//   2. deepest-first ordering holds across all twenty-two,
//   3. a node given a child the manifest never created is REFUSED,
//   4. a second undo is a no-op.

const TEMPLATE_DIR = new URL('../../docs/templates/', import.meta.url)
const DEMO = readFileSync(new URL('structure.demo.csv', TEMPLATE_DIR), 'utf8')

const DEMO_USE_CASES = [
  'ADT',
  'Medication Prescribe V1',
  'Medication Prescribe V2',
  'Medication Dispense V1',
  'Medication Dispense V2',
  'Radiology Order',
  'Radiology Report',
  'Lab Order',
  'Lab Results',
  'Clinical Notes',
]

/** The live workspace as measured on 2026-08-12. */
const demoWorkspace = () => ({
  tracks: [{ id: 't-uhr', name: 'UHR', name_ar: 'السجل الصحي الموحد', archived: false }],
  nodes: [
    {
      id: 'n-ob',
      parent_id: null,
      track_id: 't-uhr',
      kind_id: null,
      name: 'OB',
      name_ar: '',
      description: '',
      description_ar: '',
      account_manager_id: null,
      vendor: '',
      sort_order: 1,
      archived: false,
      map_node_use_cases: [],
    },
  ],
  kinds: [
    { id: 'k-prog', name: 'Programme' },
    { id: 'k-phase', name: 'Phase' },
    { id: 'k-org', name: 'Organization' },
  ],
  members: [
    { id: 'p-aziz', display_name: 'Aziz', username: null, email: 'az.alsaloom@gmail.com' },
    { id: 'p-nasser', display_name: 'Nasser Alabri', username: 'nasser', email: 'nasser@opstrack.internal' },
  ],
  useCases: DEMO_USE_CASES.map((name, i) => ({ id: `u-${i}`, name, sort_order: i + 1 })),
})

/**
 * Plan the demo file, apply it into a snapshot, and build the manifest from the
 * rows that landed — the same three steps `import-structure.mjs --apply` takes,
 * in the same order, from the same two pure modules it calls.
 *
 * ⚠ THE MANIFEST IS BUILT FROM WHAT LANDED, NOT FROM THE PLAN. That is the
 * CLI's own rule (`wrote` is pushed inside the success branch of each call,
 * after the database hands back an id) and copying the plan here instead would
 * test a manifest no run ever produces.
 */
function importDemo() {
  const workspace = demoWorkspace()
  const parsed = parseStructureCsv(DEMO)
  const plan = planStructure({ ...workspace, rows: parsed.rows })
  const refusals = mergeRefusals(parsed.refusals, plan)
  expect(refusals).toEqual([])
  // The demo only ever CREATES. Asserted rather than assumed, because the whole
  // exactness claim below rests on it: a file that updated a pre-existing node
  // would need `updatedNodes` records too, and this harness writes none.
  expect(plan.actions.every((a) => a.kind === 'create-node' || a.kind === 'set-use-case')).toBe(true)

  const live = {
    ...workspace,
    nodes: workspace.nodes.map((n) => ({ ...n, map_node_use_cases: [...n.map_node_use_cases] })),
  }
  const idByKey = new Map()
  for (const n of live.nodes) idByKey.set(keyOf(n.track_id, [n.name]), n.id)

  const wrote = { createdNodes: [], setUseCases: [] }
  let seq = 0
  for (const action of plan.actions) {
    if (action.kind === 'create-node') {
      const id = `n-demo-${(seq += 1)}`
      const parentId = action.parentKey ? idByKey.get(action.parentKey) : null
      live.nodes.push({
        id,
        parent_id: parentId,
        track_id: action.trackId,
        kind_id: action.values.kind_id,
        name: action.name,
        name_ar: action.values.name_ar,
        description: action.values.description,
        description_ar: action.values.description_ar,
        account_manager_id: action.values.account_manager_id,
        vendor: action.values.vendor,
        sort_order: action.sortOrder,
        archived: false,
        map_node_use_cases: [],
      })
      idByKey.set(keyOf(action.trackId, action.path.slice(1)), id)
      wrote.createdNodes.push({
        id,
        path: action.path,
        depth: action.depth,
        parentId,
        trackId: action.trackId,
        implied: Boolean(action.implied),
      })
      continue
    }
    const nodeId = action.nodeId ?? idByKey.get(action.key)
    const useCaseId = action.useCaseId ?? live.useCases.find((u) => u.name === action.useCase).id
    live.nodes.find((n) => n.id === nodeId).map_node_use_cases.push({ use_case_id: useCaseId, status: action.status })
    wrote.setUseCases.push({
      nodeId,
      useCaseId,
      path: action.path,
      useCase: action.useCase,
      status: action.status,
      previousStatus: action.from ?? null,
    })
  }

  const m = buildManifest({
    file: 'docs/templates/structure.demo.csv',
    projectRef: 'lrysgpbkmuqgzsjesfkr',
    startedAt: '2026-08-12T19:04:00.000Z',
    finishedAt: '2026-08-12T19:04:31.000Z',
    ...wrote,
  })
  return { live, manifest: m, plan }
}

/**
 * The six reads `import-structure.mjs --undo` performs, computed off a snapshot
 * instead of PostgREST — same columns, same filters. `children` is read by
 * `parent_id` and NOT taken from the manifest, which is the entire point: the
 * child the manifest has never heard of is the one that must refuse a delete.
 */
function probe(live, m, extra = { entries: [] }) {
  const ids = new Set(manifestNodeIds(m))
  return {
    nodes: live.nodes
      .filter((n) => ids.has(n.id))
      .map((n) => ({
        id: n.id,
        parent_id: n.parent_id,
        track_id: n.track_id,
        kind_id: n.kind_id,
        name: n.name,
        name_ar: n.name_ar,
        description: n.description,
        description_ar: n.description_ar,
        account_manager_id: n.account_manager_id,
        vendor: n.vendor,
        archived: n.archived,
      })),
    children: live.nodes
      .filter((n) => n.parent_id && ids.has(n.parent_id))
      .map((n) => ({ id: n.id, parent_id: n.parent_id, name: n.name, archived: n.archived })),
    entries: extra.entries ?? [],
    links: live.nodes
      .filter((n) => ids.has(n.id))
      .flatMap((n) => n.map_node_use_cases.map((l) => ({ node_id: n.id, use_case_id: l.use_case_id, status: l.status }))),
    useCases: [],
    useCaseLinks: [],
  }
}

/** Execute an undo plan against the snapshot, the way the CLI's loop does. */
function runUndo(live, plan) {
  for (const action of plan.actions) {
    if (action.kind === 'remove-links') {
      const node = live.nodes.find((n) => n.id === action.nodeId)
      node.map_node_use_cases = node.map_node_use_cases.filter((l) => !action.useCaseIds.includes(l.use_case_id))
    } else if (action.kind === 'delete-node') {
      // The database refuses a delete while anything points at the row. Modelled
      // here rather than assumed, so a plan that got the ORDER wrong fails this
      // harness the way 0023 would fail it live.
      const kids = live.nodes.filter((n) => n.parent_id === action.nodeId)
      if (kids.length) throw new Error(`map_node_in_use: ${action.path.join(' > ')} still has ${kids.length} child(ren)`)
      live.nodes = live.nodes.filter((n) => n.id !== action.nodeId)
    } else if (action.kind === 'restore-link') {
      const node = live.nodes.find((n) => n.id === action.nodeId)
      node.map_node_use_cases.push({ use_case_id: action.useCaseId, status: action.status })
    }
  }
  return live
}

describe('THE ROUND TRIP — import the demo file, then take it back', () => {
  it('imports 22 nodes and 67 links, and records every one of them', () => {
    const { manifest: m } = importDemo()
    expect(m.createdNodes).toHaveLength(22)
    expect(m.setUseCases).toHaveLength(67)
    expect(m.updatedNodes).toEqual([])
    expect(m.clearedUseCases).toEqual([])
    // Every recorded node is inside the one branch that IS the reset story.
    expect(m.createdNodes.every((n) => n.path[1] === 'Demo Portfolio')).toBe(true)
    // Written by this build, so it survives its own reader.
    expect(parseManifest(serializeManifest(m)).errors).toEqual([])
  })

  it('removes EXACTLY the nodes and links the manifest names, and nothing else', () => {
    const { live, manifest: m } = importDemo()
    const before = live.nodes.map((n) => n.id).sort()
    const plan = planUndo({ manifest: m, ...probe(live, m) })

    expect(plan.summary).toMatchObject({ remove: 22, refused: 0, archive: 0, alreadyGone: 0, clearLinks: 67 })
    // Set equality both ways: nothing the manifest names survives, and nothing
    // it does not name is touched.
    expect(kinds(plan, 'delete-node').map((a) => a.nodeId).sort()).toEqual(m.createdNodes.map((n) => n.id).sort())
    expect(
      kinds(plan, 'remove-links')
        .flatMap((a) => a.useCaseIds.map((u) => `${a.nodeId}|${u}`))
        .sort(),
    ).toEqual(m.setUseCases.map((l) => `${l.nodeId}|${l.useCaseId}`).sort())

    const after = runUndo(live, plan)
    expect(after.nodes.map((n) => n.id)).toEqual(['n-ob'])
    expect(after.nodes[0].map_node_use_cases).toEqual([])
    // `UHR > OB` was in the workspace before the import and is in it after the
    // undo, byte for byte. That is the promise the whole manifest exists for.
    expect(before).toContain('n-ob')
  })

  it('deletes children before parents, across all twenty-two', () => {
    const { live, manifest: m } = importDemo()
    const plan = planUndo({ manifest: m, ...probe(live, m) })
    const deletes = kinds(plan, 'delete-node')
    expect(deletes.map((a) => a.depth)).toEqual([...deletes.map((a) => a.depth)].sort((a, b) => b - a))
    // The ordering property stated the other way round, and the one that
    // actually matters: no node is deleted before something below it.
    const seen = new Set()
    for (const a of deletes) {
      const kids = m.createdNodes.filter((n) => n.parentId === a.nodeId)
      for (const kid of kids) expect(seen.has(kid.id)).toBe(true)
      seen.add(a.nodeId)
    }
    // And the whole plan survives a database that refuses out-of-order deletes.
    expect(() => runUndo(live, plan)).not.toThrow()
  })

  it('REFUSES a demo node somebody has put their own child under, and its ancestors with it', () => {
    const { live, manifest: m } = importDemo()
    const org = m.createdNodes.find((n) => n.path[n.path.length - 1] === 'Nawras General Hospital')
    live.nodes.push({
      id: 'n-real-dept',
      parent_id: org.id,
      track_id: 't-uhr',
      kind_id: null,
      name: 'Emergency Department',
      name_ar: '',
      description: '',
      description_ar: '',
      account_manager_id: null,
      vendor: '',
      sort_order: 1,
      archived: false,
      map_node_use_cases: [],
    })

    const plan = planUndo({ manifest: m, ...probe(live, m) })
    const at = (name) => plan.nodeStates.find((s) => s.path[s.path.length - 1] === name)
    expect(at('Nawras General Hospital').disposition).toBe('refused')
    expect(at('Nawras General Hospital').reasons[0].message).toMatch(/Emergency Department/u)
    // Every ancestor is kept too — a node with a child cannot be deleted, so
    // saying so beats a raw `map_node_in_use` from the database three times.
    expect(at('Wave 1').disposition).toBe('refused')
    expect(at('Demo Portfolio').disposition).toBe('refused')
    // …and everything NOT above it still goes. 22 minus the three kept.
    expect(plan.summary).toMatchObject({ remove: 19, refused: 3 })
    // The refused nodes still lose their demo capability rows, so nothing is
    // left claiming an integration this import invented.
    expect(kinds(plan, 'remove-links').some((a) => a.nodeId === org.id)).toBe(true)
    expect(() => runUndo(live, plan)).not.toThrow()
    expect(live.nodes.map((n) => n.name).sort()).toEqual([
      'Demo Portfolio',
      'Emergency Department',
      'Nawras General Hospital',
      'OB',
      'Wave 1',
    ])
  })

  it('REFUSES a demo node somebody has recorded a real integration status on', () => {
    const { live, manifest: m } = importDemo()
    const org = live.nodes.find((n) => n.name === 'Shurooq Medical Complex')
    // The one thing this app exists for: a person opens a demo Organization and
    // says "Lab Results is live here". The manifest has never heard of that row
    // — the import wrote no links at all on this node — so before the fifth
    // reason code existed it was invisible to every part of the plan, and the
    // node was deleted with the statement inside it.
    org.map_node_use_cases.push({ use_case_id: 'u-8', status: 'live' })

    const plan = planUndo({ manifest: m, ...probe(live, m) })
    const s = plan.nodeStates.find((x) => x.id === org.id)
    expect(s.disposition).toBe('refused')
    expect(s.reasons.some((r) => r.code === 'capabilities')).toBe(true)
    expect(kinds(plan, 'delete-node').map((a) => a.nodeId)).not.toContain(org.id)
    runUndo(live, plan)
    // The statement is still there afterwards, on a node that is still there.
    expect(live.nodes.find((n) => n.id === org.id).map_node_use_cases).toEqual([
      { use_case_id: 'u-8', status: 'live' },
    ])
  })

  it('REFUSES the whole subtree below a demo node somebody has moved', () => {
    const { live, manifest: m } = importDemo()
    const group = live.nodes.find((n) => n.name === 'Sarab Group')
    // Dragged out of Wave 1 and filed under the real node. Its three demo
    // Organizations come WITH it, so their own `parent_id` still matches the
    // manifest exactly — which is precisely why they used to be deleted out from
    // under a placement somebody had made on purpose.
    group.parent_id = 'n-ob'

    const plan = planUndo({ manifest: m, ...probe(live, m) })
    const at = (name) => plan.nodeStates.find((s) => s.path[s.path.length - 1] === name)
    expect(at('Sarab Group').reasons.map((r) => r.code)).toContain('moved')
    for (const child of ['Ghadeer Family Medicine Centre', 'Areej Day Surgery Unit', 'Falak Imaging Centre']) {
      expect(at(child).disposition).toBe('refused')
      expect(at(child).reasons.map((r) => r.code)).toContain('ancestor-moved')
    }
    expect(kinds(plan, 'delete-node').map((a) => a.path.join(' > ')).some((p) => p.includes('Sarab Group'))).toBe(false)
  })

  it('REFUSES a top-level demo node moved to another TRACK, where parent_id never changes', () => {
    const { live, manifest: m } = importDemo()
    // `move_map_node(p_id, p_parent, p_track)` supports root -> root across
    // tracks: `parent_id` is null before and null after, so a parent-only
    // comparison sees an untouched node.
    const root = live.nodes.find((n) => n.name === 'Demo Portfolio')
    root.parent_id = null
    root.track_id = 't-other'

    const plan = planUndo({ manifest: m, ...probe(live, m) })
    const s = plan.nodeStates.find((x) => x.id === root.id)
    expect(s.disposition).toBe('refused')
    expect(s.reasons.map((r) => r.code)).toContain('moved')
  })

  it('IS A NO-OP THE SECOND TIME — an interrupted undo is fixed by re-running', () => {
    const { live, manifest: m } = importDemo()
    const first = planUndo({ manifest: m, ...probe(live, m) })
    runUndo(live, first)

    const second = planUndo({ manifest: m, ...probe(live, m) })
    expect(second.actions).toEqual([])
    expect(second.summary).toMatchObject({ remove: 0, refused: 0, alreadyGone: 22, clearLinks: 0, goneLinks: 67 })
    expect(second.summary.partial).toBe(false)
    expect(renderUndoPlan(second, { manifest: m })).not.toMatch(/THIS UNDO IS PARTIAL/u)
  })

  it('recovers a HALF-FINISHED undo by re-running the same manifest', () => {
    const { live, manifest: m } = importDemo()
    const first = planUndo({ manifest: m, ...probe(live, m) })
    // Stop after the link removals and the four deepest deletes — a dropped
    // connection mid-run, which is the failure the CLI's own printout tells him
    // to recover by re-running.
    let budget = first.actions.filter((a) => a.kind === 'remove-links').length + 4
    runUndo(live, { actions: first.actions.slice(0, budget) })

    const second = planUndo({ manifest: m, ...probe(live, m) })
    expect(second.summary.refused).toBe(0)
    expect(second.summary.remove + second.summary.alreadyGone).toBe(22)
    runUndo(live, second)
    expect(live.nodes.map((n) => n.id)).toEqual(['n-ob'])
  })

  it('prints the demo tree with every node marked, and no uuid anywhere in it', () => {
    const { live, manifest: m } = importDemo()
    const text = plain(
      renderUndoPlan(planUndo({ manifest: m, ...probe(live, m) }), {
        manifestPath: 'docs/EVIDENCE/import-runs/import-20260812T190400Z-lrysgpbkmuqgzsjesfkr.json',
        manifest: m,
      }),
    )
    expect(text).toMatch(/Demo Portfolio {3}DELETE/u)
    expect(text).toMatch(/Sarab Group {3}DELETE \(implied — it had no row of its own\)/u)
    expect(text).toMatch(/22 node\(s\) to remove · 0 to archive · 0 refused/u)
    expect(text).not.toMatch(/n-demo-|u-\d|t-uhr/u)
  })
})
