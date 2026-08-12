// importManifest — what an import actually wrote, and how to take it back.
//
// PURE. No network, no filesystem, no clock. `import-structure.mjs` reads the
// workspace, hands this module a snapshot and prints what it returns; every REST
// call lives there. That is the same division `structurePlan.mjs` already keeps
// with the same CLI, and it exists for the same reason: the half that decides
// what gets DELETED has to be testable without a live project, because there is
// no safe way to test it against one.
//
//
// ═══ WHY A MANIFEST ═══
//
// Aziz asked for demo data he can "reset once we have the real data". The
// obvious answer is a marker on the row — `source = 'demo'` — and it is not
// available: `map_nodes.source` is `check (source in ('local','jira'))`
// (0023:341), a third value needs a migration, and a marker hidden in
// `description` is text a person will edit out on the first pass over the demo.
//
// So the record of what an import wrote lives OUTSIDE the schema, in a file the
// import writes as it lands each row: every node id it created, every use-case
// link it set with the status that was there before, every field it changed with
// the old value beside the new one, the project ref, the CSV, the clock.
// `--undo <manifest>` reverses exactly that list and can touch nothing else.
//
// THIS IS NOT A DEMO FEATURE. It is "undo my last import", and it is worth
// having whether or not the rows were dummies: the same file that resets the
// demo also takes back a real import somebody ran against the wrong project.
//
//
// ═══ WHERE MANIFESTS LIVE, AND WHETHER THEY ARE COMMITTED ═══
//
// `docs/EVIDENCE/` is this repo's home for the record of what was written to the
// live workspace — `deleted-entries-2026-08-12.json` is the precedent — and
// these go in `docs/EVIDENCE/import-runs/`, named `import-<UTC stamp>-<ref>.json`
// so the newest sorts last and is obvious in an `ls`.
//
// COMMIT THEM. They hold node uuids, node names and capability names: no keys,
// no emails, no usernames, nothing `.gitignore` covers. And an undo file that
// only exists on one laptop is not an undo — it has to survive a `git clean`, a
// fresh clone and the machine the demo was loaded from, or the reset he was
// promised depends on a file nobody backed up.
//
//
// ═══ THE FOUR PROPERTIES, AND WHERE EACH ONE IS ENFORCED ═══
//
//   1. DRY RUN BY DEFAULT — the CLI. `planUndo` never writes anything; the CLI
//      prints `renderUndoPlan` and stops unless `--apply` is present.
//   2. REFUSE ANYTHING THAT GAINED REAL WORK — here, in `planUndo`, against a
//      LIVE re-read the CLI performs at undo time. Never against the manifest
//      alone: the manifest is a record of the past and the question is what is
//      true now.
//   3. DEEPEST FIRST — here. `created` is sorted by depth descending before a
//      single disposition is decided, and a parent whose manifest child survived
//      is refused rather than attempted.
//   4. IDEMPOTENT — here. A node that is gone is `already-gone`, not an error;
//      a link that is gone is `already-gone`; a field already back at its old
//      value is nothing at all.
//
//
// ═══ DELETE, NOT ARCHIVE — AND THE MEASUREMENT THAT DECIDED IT ═══
//
// Archive looks like the gentler default and is the wrong one twice over.
//
// The point of a reset is that the demo is GONE. An archived node still exists:
// it holds its name against `map_nodes_sibling_name_uidx`, which spans archived
// rows on purpose (0023:470-474), so an archived demo "Riyadh General Hospital"
// makes the REAL one un-creatable under the same parent — the exact collision
// the reset exists to avoid. It also stays in Settings › Structure forever, and
// eighteen retired dummies in the admin screen is a worse workspace than the
// empty one he started with.
//
// And archive is not a safe fallback for a node a delete was refused on.
// `map_nodes_cascade_archive` (0023:604) archives every descendant of the row it
// touches. A demo Org gets refused precisely because somebody put real work
// under it — so archiving it archives THEIR node too, which is the data loss the
// refusal was there to prevent, arriving through the gentle-looking door.
//
// So: hard DELETE for nodes this manifest created, and a refusal that leaves the
// node exactly as it is. `--archive-refused` exists for the one case where the
// cascade cannot bite — a node with NO children at all, blocked only by entries
// filed on it — and it is opt-in, printed per node, and never the default.

import { isolate, comparePaths } from './structurePlan.mjs'

/**
 * Bumped when the SHAPE changes in a way an older reader would misread. A reader
 * that does not recognise the version refuses the file rather than guessing:
 * guessing here means deleting the wrong uuid.
 */
export const MANIFEST_VERSION = 1

/** Relative to the repo root. The CLI resolves it against `process.cwd()`. */
export const MANIFEST_DIR = 'docs/EVIDENCE/import-runs'

/** What `--apply` records. Nothing outside this list can ever be undone. */
export const MANIFEST_SECTIONS = [
  'createdUseCases',
  'createdNodes',
  'updatedNodes',
  'setUseCases',
  'clearedUseCases',
]

// ── writing one ─────────────────────────────────────────────────────────────

/** One record that could never be reversed. Never escapes this module. */
class UnusableRecord extends Error {}

/**
 * Shape and check a manifest. Throws on a record that could not be reversed —
 * a node with no id, a link with no capability — because a manifest that is
 * silently short is worse than none: it reports success and leaves rows behind
 * that nothing will ever name again.
 *
 * @param {object} input
 * @param {string} input.file        the CSV, as it was typed on the command line
 * @param {string} input.projectRef  `lrysgpbkmuqgzsjesfkr` — never the URL, never the key
 * @param {string} input.startedAt   ISO 8601, UTC
 * @param {string} input.finishedAt  ISO 8601, UTC
 * @param {'complete'|'partial'} input.outcome
 * @param {(problem: string) => void} [onUnusable]
 *   ⚠ STRICT BY DEFAULT; LENIENT ONLY WHERE THE ROWS ARE ALREADY WRITTEN.
 *   Throwing is the right answer for a caller that can still choose not to
 *   write. It is the WORST answer at the end of an `--apply`: one capability
 *   POST that came back without an id — a gateway that ate
 *   `Prefer: return=representation`, a 201 with an empty body — would discard
 *   the record of every one of the other ninety-nine rows that landed
 *   perfectly, and those rows are already in the live project. Passing this
 *   callback is that caller saying "ninety-nine beats none"; each dropped
 *   record is handed over, and the CLI is expected to scream about it.
 */
export function buildManifest(
  {
    file = '',
    projectRef = '',
    startedAt = '',
    finishedAt = '',
    outcome = 'complete',
    createdUseCases = [],
    createdNodes = [],
    updatedNodes = [],
    setUseCases = [],
    clearedUseCases = [],
  } = {},
  onUnusable = null,
) {
  const need = (value, what, where) => {
    if (value === null || value === undefined || value === '') {
      const problem = `${where} has no ${what}, so it could never be undone`
      if (!onUnusable) throw new Error(`manifest: ${problem}`)
      throw new UnusableRecord(problem)
    }
    return value
  }

  /** Map every record, dropping only the ones `need` rejected — never the run. */
  const usable = (rows, map) =>
    rows.flatMap((row) => {
      try {
        return [map(row)]
      } catch (e) {
        if (e instanceof UnusableRecord) {
          onUnusable(e.message)
          return []
        }
        throw e
      }
    })

  return {
    manifestVersion: MANIFEST_VERSION,
    tool: 'import-structure',
    file: String(file),
    projectRef: String(projectRef),
    startedAt: String(startedAt),
    finishedAt: String(finishedAt),
    // `partial` is not cosmetic. A run that stopped halfway wrote rows the plan
    // no longer describes, and the undo says so at the top of its printout —
    // "this manifest is the only record of what landed" is the sentence that
    // stops somebody hand-deleting the rest.
    outcome: outcome === 'partial' ? 'partial' : 'complete',

    createdUseCases: usable(createdUseCases, (u) => ({
      id: need(u.id, 'id', `created use case "${u.name}"`),
      name: String(u.name ?? ''),
    })),

    // `parentId` rides along so the undo can tell a node that is where we left
    // it from one somebody re-parented into their real tree. `depth` is the
    // manifest's own, not the live one: it orders the deletes, and a node that
    // moved is refused before its depth matters.
    createdNodes: usable(createdNodes, (n) => ({
      id: need(n.id, 'id', `created node ${(n.path ?? []).join(' > ')}`),
      path: [...(n.path ?? [])].map(String),
      // The planner's `depth` counts NODE segments, so a direct child of a track
      // is 1 while its `path` is 2 long. The fallback has to agree, or a file
      // written by hand sorts its deletes into a different order than one
      // written by --apply and a parent is attempted before its child.
      depth: Number(n.depth ?? Math.max(0, (n.path ?? []).length - 1)),
      parentId: n.parentId ?? null,
      trackId: n.trackId ?? null,
      implied: Boolean(n.implied),
    })),

    // The old value of every field this run overwrote, by COLUMN name — the
    // undo issues a PATCH and must not have to know that the planner spells
    // `kind_id` as `kind`.
    updatedNodes: usable(updatedNodes, (n) => ({
      id: need(n.id, 'id', `updated node ${(n.path ?? []).join(' > ')}`),
      path: [...(n.path ?? [])].map(String),
      changes: (n.changes ?? []).map((c) => ({
        column: need(c.column, 'column', `an update on ${(n.path ?? []).join(' > ')}`),
        from: c.from ?? null,
        to: c.to ?? null,
        fromLabel: c.fromLabel ?? null,
        toLabel: c.toLabel ?? null,
      })),
    })),

    // `previousStatus` IS THE UNDO. A link this run created reverses to nothing;
    // a link it re-statused reverses to the status that was there. Without this
    // field both cases look identical and the second one loses a real statement
    // somebody made about a real organization.
    setUseCases: usable(setUseCases, (l) => ({
      nodeId: need(l.nodeId, 'node id', `a use-case link on ${(l.path ?? []).join(' > ')}`),
      useCaseId: need(l.useCaseId, 'capability id', `link "${l.useCase}"`),
      path: [...(l.path ?? [])].map(String),
      useCase: String(l.useCase ?? ''),
      status: String(l.status ?? ''),
      previousStatus: l.previousStatus ?? null,
    })),

    // The import can DELETE a link too (a blank cell clears one). Undoing that
    // is putting it back, at the status it had.
    clearedUseCases: usable(clearedUseCases, (l) => ({
      nodeId: need(l.nodeId, 'node id', `a cleared link on ${(l.path ?? []).join(' > ')}`),
      useCaseId: need(l.useCaseId, 'capability id', `cleared link "${l.useCase}"`),
      path: [...(l.path ?? [])].map(String),
      useCase: String(l.useCase ?? ''),
      previousStatus: l.previousStatus ?? null,
    })),
  }
}

/** Is there anything here at all? An empty run writes no file. */
export function manifestIsEmpty(manifest) {
  return MANIFEST_SECTIONS.every((k) => !(manifest?.[k] ?? []).length)
}

/** Two spaces and a trailing newline: this file is read in a diff. */
export function serializeManifest(manifest) {
  return `${JSON.stringify(manifest, null, 2)}\n`
}

/**
 * `import-2026-08-12T093107Z-lrysgpbk.json`.
 *
 * ISO first so a plain `ls` sorts oldest to newest and the last line is the run
 * you just did; the project ref after it so two projects in one directory can
 * never be confused for two runs against one.
 */
export function manifestFileName(startedAt, projectRef) {
  const stamp = String(startedAt)
    .replace(/\.\d+/u, '')
    .replace(/[:-]/gu, '')
  const ref = String(projectRef).replace(/[^a-z0-9]/giu, '') || 'unknown'
  return `import-${stamp}-${ref}.json`
}

// ── reading one ─────────────────────────────────────────────────────────────

/**
 * Parse and CHECK. Returns `{ manifest, errors }` and never throws: a manifest
 * is a file on disk that somebody may have opened, half-edited and saved, and
 * the honest answer to that is a list of what is wrong with it — not a stack
 * trace, and never a partial object that the planner then treats as complete.
 */
export function parseManifest(text) {
  const errors = []
  let raw
  try {
    raw = JSON.parse(String(text))
  } catch (e) {
    return { manifest: null, errors: [`this file is not valid JSON: ${e.message}`] }
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { manifest: null, errors: ['this file is JSON, but not a manifest object'] }
  }
  if (raw.tool !== 'import-structure') {
    errors.push(
      `this manifest was written by \`${String(raw.tool ?? '(nothing)')}\`, not by import-structure. Nothing here can undo it.`,
    )
  }
  if (raw.manifestVersion !== MANIFEST_VERSION) {
    // ⚠ REFUSE, DO NOT ADAPT. A future manifest may record a section this build
    // has never heard of; undoing the parts it recognises would leave the rest
    // behind with nothing left to name it.
    errors.push(
      `manifest version ${String(raw.manifestVersion)} — this build understands version ${MANIFEST_VERSION} only. Use the build that wrote it.`,
    )
  }
  if (!raw.projectRef) {
    errors.push('this manifest does not say which project it was applied to, so it cannot be checked against the one you are pointed at.')
  }
  for (const section of MANIFEST_SECTIONS) {
    if (raw[section] !== undefined && !Array.isArray(raw[section])) {
      errors.push(`\`${section}\` is not a list.`)
    }
  }
  const list = (k) => (Array.isArray(raw[k]) ? raw[k] : [])
  // ⚠ A RECORD THAT CANNOT BE PRINTED MUST NOT BE EXECUTABLE. `renderUndoPlan`
  // indents by `path.length - 1` — which throws RangeError on an empty path —
  // and `continue`s a one-segment path outright. So a hand-edited manifest with
  // a short path was either a stack trace or, worse, a `delete-node` that ran
  // without ever appearing in the list somebody read and approved. Every path a
  // record carries names a node, so it has the track plus at least one segment.
  const needsPath = (row, where) => {
    if (!Array.isArray(row.path) || row.path.length < 2 || row.path.some((s) => typeof s !== 'string')) {
      errors.push(`${where} has no usable path — a path names the track and at least one node below it.`)
    }
  }
  for (const n of list('createdNodes')) {
    if (!n || typeof n.id !== 'string' || !n.id) errors.push('a createdNodes entry has no id.')
    else needsPath(n, `the createdNodes entry \`${n.id}\``)
  }
  for (const n of list('updatedNodes')) {
    if (!n || typeof n.id !== 'string' || !n.id) errors.push('an updatedNodes entry has no id.')
    else needsPath(n, `the updatedNodes entry \`${n.id}\``)
  }
  for (const l of [...list('setUseCases'), ...list('clearedUseCases')]) {
    if (!l || typeof l.nodeId !== 'string' || typeof l.useCaseId !== 'string') {
      errors.push('a use-case entry is missing its node id or capability id.')
    } else needsPath(l, `the use-case entry on \`${l.nodeId}\``)
  }
  if (errors.length) return { manifest: null, errors }

  return {
    manifest: {
      manifestVersion: raw.manifestVersion,
      tool: raw.tool,
      file: String(raw.file ?? ''),
      projectRef: String(raw.projectRef),
      startedAt: String(raw.startedAt ?? ''),
      finishedAt: String(raw.finishedAt ?? ''),
      outcome: raw.outcome === 'partial' ? 'partial' : 'complete',
      createdUseCases: list('createdUseCases'),
      createdNodes: list('createdNodes').map((n) => ({
        ...n,
        path: Array.isArray(n.path) ? n.path.map(String) : [],
        depth: Number(n.depth ?? Math.max(0, (Array.isArray(n.path) ? n.path.length : 1) - 1)),
        parentId: n.parentId ?? null,
        // Normalised to `null` rather than left `undefined`, because `planUndo`
        // reads "no trackId recorded" as "do not compare tracks" and the two
        // spellings of absent must not mean two different things there.
        trackId: n.trackId ?? null,
      })),
      updatedNodes: list('updatedNodes').map((n) => ({
        ...n,
        path: Array.isArray(n.path) ? n.path.map(String) : [],
        changes: Array.isArray(n.changes) ? n.changes : [],
      })),
      setUseCases: list('setUseCases').map((l) => ({ ...l, path: Array.isArray(l.path) ? l.path.map(String) : [] })),
      clearedUseCases: list('clearedUseCases').map((l) => ({
        ...l,
        path: Array.isArray(l.path) ? l.path.map(String) : [],
      })),
    },
    errors: [],
  }
}

/** Every node id a manifest names, in one set — what the CLI has to re-read. */
export function manifestNodeIds(manifest) {
  const ids = new Set()
  for (const n of manifest.createdNodes ?? []) ids.add(n.id)
  for (const n of manifest.updatedNodes ?? []) ids.add(n.id)
  for (const l of manifest.setUseCases ?? []) ids.add(l.nodeId)
  for (const l of manifest.clearedUseCases ?? []) ids.add(l.nodeId)
  return [...ids].filter(Boolean)
}

// ── the reversal ────────────────────────────────────────────────────────────

const LINK = (nodeId, useCaseId) => `${nodeId}\u0000${useCaseId}`

/** null, undefined and '' are one value here: "nothing was there". */
const norm = (v) => (v === null || v === undefined ? '' : String(v))

/**
 * What undoing this manifest would do, given a LIVE re-read of everything it
 * names. No I/O; deterministic; the CLI executes `actions` in the order they
 * come back and prints `renderUndoPlan` of the same object.
 *
 * @param {object} input
 * @param {object}   input.manifest        from `parseManifest`
 * @param {object[]} input.nodes           live `map_nodes` rows for the ids the manifest
 *                                         names. A missing id means the node is GONE.
 * @param {object[]} input.children        live `map_nodes` rows whose `parent_id` is one
 *                                         of those ids — foreign children live here.
 * @param {object[]} input.entries         live `entries` rows `{ id, node_id }` filed on them
 * @param {object[]} input.links           live `map_node_use_cases` rows on those nodes
 * @param {object[]} input.useCases        live `use_cases` rows for capabilities this run created
 * @param {object[]} input.useCaseLinks    every live link referencing one of those capabilities
 * @param {boolean}  [input.archiveRefused] archive a refused node INSTEAD of leaving it,
 *                                          allowed only where the archive cascade cannot reach
 *                                          a child. Opt-in; see the header.
 */
export function planUndo({
  manifest,
  nodes = [],
  children = [],
  entries = [],
  links = [],
  useCases = [],
  useCaseLinks = [],
  archiveRefused = false,
} = {}) {
  const actions = []
  const notes = []

  const liveById = new Map(nodes.map((n) => [n.id, n]))
  const liveLinks = new Map(links.map((l) => [LINK(l.node_id, l.use_case_id), l.status]))

  const childrenByParent = new Map()
  for (const c of children) {
    const list = childrenByParent.get(c.parent_id) ?? []
    list.push(c)
    childrenByParent.set(c.parent_id, list)
  }
  const entryCount = new Map()
  for (const e of entries) entryCount.set(e.node_id, (entryCount.get(e.node_id) ?? 0) + 1)

  const created = [...(manifest.createdNodes ?? [])]
  const createdIds = new Set(created.map((n) => n.id))

  if (manifest.outcome === 'partial') {
    notes.push(
      'THE RUN THIS MANIFEST RECORDS STOPPED PART-WAY. It holds what actually landed, which is not what that run\'s plan said it would do — so this file, and not the CSV, is the record of what is in the workspace.',
    )
  }

  // ── ① the links ───────────────────────────────────────────────────────────
  //
  // FIRST, AND FOR EVERY NODE INCLUDING THE ONES THAT WILL BE REFUSED. A refused
  // Org that keeps its demo capability rows is a node nobody can explain: it
  // reads as "we integrated ADT here" on the one screen this app exists to draw.
  // For a node that IS deleted the `on delete cascade` on
  // `map_node_use_cases.node_id` (0024:358) would take these anyway — running
  // the same statement for both cases means one code path, tested once, rather
  // than a second one that only ever runs on the day something went wrong.
  const linkStates = []
  const removedLinkKeys = new Set()

  for (const rec of manifest.setUseCases ?? []) {
    const key = LINK(rec.nodeId, rec.useCaseId)
    const current = liveLinks.get(key)
    const base = { ...rec, kind: 'set' }
    if (current === undefined) {
      linkStates.push({ ...base, disposition: 'already-gone' })
      continue
    }
    if (current !== rec.status) {
      // ⚠ SOMEBODY MOVED THIS ONE. The import wrote `live`; it now says
      // `testing`. That is a human statement about a real integration and this
      // script did not make it, so it does not get to take it back. Same rule as
      // the field revert below, stated once: WE ONLY UNDO WHAT STILL LOOKS
      // EXACTLY LIKE WHAT WE WROTE.
      linkStates.push({ ...base, disposition: 'changed-since', current })
      continue
    }
    if (rec.previousStatus === null || rec.previousStatus === undefined) {
      linkStates.push({ ...base, disposition: 'remove' })
      removedLinkKeys.add(key)
    } else {
      linkStates.push({ ...base, disposition: 'restore', to: rec.previousStatus })
    }
  }

  for (const rec of manifest.clearedUseCases ?? []) {
    const key = LINK(rec.nodeId, rec.useCaseId)
    const current = liveLinks.get(key)
    const base = { ...rec, kind: 'cleared' }
    if (current !== undefined) {
      // It is back — somebody re-added the link the import deleted. Putting our
      // remembered status on top of theirs would be an edit, not an undo.
      linkStates.push({ ...base, disposition: 'already-there', current })
      continue
    }
    if (!rec.previousStatus) {
      linkStates.push({ ...base, disposition: 'already-gone' })
      continue
    }
    linkStates.push({ ...base, disposition: 'restore', to: rec.previousStatus })
  }

  // ── ①b WHAT A PERSON HAS SINCE SAID ABOUT A DEMO NODE ────────────────────
  //
  // ⚠ THE REFUSAL THAT WAS MISSING, AND THE ONE THIS APP IS ABOUT. A capability
  // status is not decoration on a demo row — it is the sentence "this hospital
  // integrates ADT", which is the sentence Aziz opened this app to write. The
  // first draft of this module built `reasons` from four codes (foreign
  // children, entries, surviving descendants, moved) and none of them is
  // tripped by somebody typing into the use-case panel. So a demo Organization
  // that a person had spent a week filling in came back `delete`, and the rows
  // went out through `map_node_use_cases.node_id … on delete cascade`
  // (0024:358) without ever being named. The dry run printed `left alone`
  // beside a link it destroyed ninety seconds later.
  //
  // Two shapes, both of them a person typing:
  //   * a link this import wrote whose status has since MOVED (`changed-since`)
  //   * a link on a demo node that the manifest has never heard of at all
  //
  // The second one is invisible to every other loop in this file, because every
  // other loop iterates the MANIFEST. This one iterates the LIVE read — the
  // only place a row nobody recorded can show up.
  const manifestLinkKeys = new Set()
  for (const rec of manifest.setUseCases ?? []) manifestLinkKeys.add(LINK(rec.nodeId, rec.useCaseId))
  for (const rec of manifest.clearedUseCases ?? []) manifestLinkKeys.add(LINK(rec.nodeId, rec.useCaseId))

  const handWork = new Map()
  const noteHand = (nodeId, message) => {
    // Only for a node this import CREATED. On a node that already existed there
    // is no delete to refuse, and the field/link rules above already govern it.
    if (!createdIds.has(nodeId)) return
    handWork.set(nodeId, [...(handWork.get(nodeId) ?? []), message])
  }
  for (const s of linkStates) {
    if (s.kind === 'set' && s.disposition === 'changed-since') {
      noteHand(s.nodeId, `${s.useCase} says ${s.current}, not the ${s.status} this import wrote`)
    }
  }
  const unrecorded = new Map()
  for (const l of links) {
    if (!createdIds.has(l.node_id)) continue
    if (manifestLinkKeys.has(LINK(l.node_id, l.use_case_id))) continue
    unrecorded.set(l.node_id, (unrecorded.get(l.node_id) ?? 0) + 1)
  }
  for (const [nodeId, n] of unrecorded) {
    // The COUNT, not the names: the live read of `map_node_use_cases` carries
    // ids only and the capability catalogue is not an input to this plan. The
    // count is the load-bearing part — it says a person has been here.
    noteHand(nodeId, `${n} capability status(es) this import never wrote are recorded on it`)
  }

  // Removals batched per node: one DELETE with `use_case_id=in.(…)` rather than
  // one request per cell. Fifty organizations × nine capabilities is 450 links,
  // and 450 round trips is a minute of a run that can fail in the middle of it.
  const removalsByNode = new Map()
  for (const s of linkStates) {
    if (s.disposition !== 'remove') continue
    const list = removalsByNode.get(s.nodeId) ?? []
    list.push(s)
    removalsByNode.set(s.nodeId, list)
  }
  for (const [nodeId, list] of removalsByNode) {
    actions.push({
      kind: 'remove-links',
      nodeId,
      path: list[0].path,
      useCaseIds: list.map((s) => s.useCaseId),
      useCases: list.map((s) => s.useCase),
    })
  }
  for (const s of linkStates) {
    if (s.disposition !== 'restore') continue
    actions.push({
      kind: 'restore-link',
      nodeId: s.nodeId,
      useCaseId: s.useCaseId,
      path: s.path,
      useCase: s.useCase,
      status: s.to,
    })
  }

  // ── ② the fields this run overwrote ───────────────────────────────────────
  const fieldStates = []
  for (const rec of manifest.updatedNodes ?? []) {
    const live = liveById.get(rec.id)
    if (!live) {
      fieldStates.push({ ...rec, disposition: 'already-gone', changes: [] })
      continue
    }
    const revert = []
    const skipped = []
    for (const c of rec.changes ?? []) {
      if (norm(live[c.column]) !== norm(c.to)) {
        skipped.push({ ...c, current: live[c.column] ?? null })
        continue
      }
      revert.push(c)
    }
    if (!revert.length && !skipped.length) continue
    fieldStates.push({
      ...rec,
      disposition: revert.length ? 'revert' : 'edited-since',
      changes: revert,
      skipped,
    })
    if (revert.length) {
      const patch = {}
      for (const c of revert) patch[c.column] = c.from ?? null
      actions.push({ kind: 'revert-node', nodeId: rec.id, path: rec.path, patch, changes: revert })
    }
  }

  // ── ③ the nodes, DEEPEST FIRST ────────────────────────────────────────────
  //
  // Explicitly, not incidentally. 0023's `map_nodes_block_delete_when_referenced`
  // raises `map_node_in_use` for a node with children, and the FK on `parent_id`
  // is `on delete restrict` underneath it — so a shallow-first pass fails on the
  // first parent and leaves the tree half-removed. Sorting here, once, is also
  // what lets a parent read its own children's dispositions below: by the time
  // it is considered, every manifest child already knows whether it survived.
  const byDeepest = [...created].sort((a, b) => {
    const d = (b.depth ?? b.path.length) - (a.depth ?? a.path.length)
    if (d !== 0) return d
    return comparePaths(a.path ?? [], b.path ?? [])
  })

  // ── ③b A MOVE IS A STATEMENT ABOUT THE WHOLE SUBTREE ─────────────────────
  //
  // ⚠ COMPUTED IN A PASS OF ITS OWN, BEFORE THE DEEPEST-FIRST LOOP, because a
  // move propagates DOWNWARD and the loop runs upward — by the time a moved
  // parent is reached, its children have already been dispositioned.
  //
  // The bug that forced this: drag one demo Organization into the real tree and
  // its demo departments come WITH it, still parented to it. Their `parent_id`
  // therefore still equals the manifest's, every one of them reads as untouched,
  // and deepest-first deletes all three — then refuses the empty shell, whose
  // `moved` reason finally fires. The refusal landed on the one row that was
  // cheapest to recreate and missed the three that carried the work.
  const recById = new Map(created.map((n) => [n.id, n]))
  const movedIds = new Set()
  for (const rec of created) {
    const live = liveById.get(rec.id)
    if (!live) continue
    // ⚠ TRACK AS WELL AS PARENT. `move_map_node(p_id, p_parent, p_track)`
    // (0023:1023) moves a TOP-LEVEL node between tracks without touching
    // `parent_id` — null before, null after — so a parent-only comparison sees
    // an untouched node and deletes a placement somebody made deliberately.
    // The track is only compared when the manifest carries one: a hand-written
    // file with no `trackId` would otherwise read as "every node moved" and
    // refuse the entire undo.
    const parentMoved = norm(live.parent_id) !== norm(rec.parentId)
    const trackMoved = rec.trackId !== null && rec.trackId !== undefined && norm(live.track_id) !== norm(rec.trackId)
    if (parentMoved || trackMoved) movedIds.add(rec.id)
  }
  const movedAncestorOf = new Map()
  for (const rec of created) {
    const seen = new Set([rec.id])
    let cursor = recById.get(rec.parentId)
    while (cursor && !seen.has(cursor.id)) {
      seen.add(cursor.id)
      if (movedIds.has(cursor.id)) {
        movedAncestorOf.set(rec.id, cursor)
        break
      }
      cursor = recById.get(cursor.parentId)
    }
  }

  const disposition = new Map()
  const nodeStates = []

  for (const rec of byDeepest) {
    const live = liveById.get(rec.id)
    if (!live) {
      // IDEMPOTENT. He will run this twice, or half-way, or after deleting one
      // of these by hand in the app. None of those is an error.
      disposition.set(rec.id, 'already-gone')
      nodeStates.push({ ...rec, disposition: 'already-gone', reasons: [] })
      continue
    }

    const kids = childrenByParent.get(rec.id) ?? []
    const foreign = kids.filter((k) => !createdIds.has(k.id))
    const survivingOwn = kids.filter((k) => {
      if (!createdIds.has(k.id)) return false
      const d = disposition.get(k.id)
      return d !== 'delete' && d !== 'already-gone'
    })
    const filed = entryCount.get(rec.id) ?? 0
    const moved = movedIds.has(rec.id)
    const movedAncestor = movedAncestorOf.get(rec.id)
    const handSet = handWork.get(rec.id) ?? []
    const renamed = norm(live.name) !== norm(rec.path[rec.path.length - 1])

    const reasons = []
    if (foreign.length) {
      reasons.push({
        code: 'children',
        message: `${foreign.length} child node(s) this import did not create: ${foreign.map((k) => k.name).join(', ')}`,
      })
    }
    if (filed) {
      reasons.push({ code: 'entries', message: `${filed} entr${filed === 1 ? 'y is' : 'ies are'} filed on it` })
    }
    if (survivingOwn.length) {
      reasons.push({
        code: 'descendant',
        message: `${survivingOwn.length} node(s) below it are being kept, so this one still has children`,
      })
    }
    if (moved) {
      // Somebody re-parented a demo node into their real tree. It is theirs now:
      // that is a deliberate placement, and the whole promise here is that this
      // script only takes back what it put there, where it put it.
      reasons.push({ code: 'moved', message: 'it has been MOVED since the import — somebody placed it deliberately' })
    }
    if (movedAncestor && !moved) {
      reasons.push({
        code: 'ancestor-moved',
        message: `${movedAncestor.path[movedAncestor.path.length - 1]} above it has been MOVED since the import, so this whole branch was placed deliberately`,
      })
    }
    if (handSet.length) {
      // Never archivable either — see `canArchive` below, which is entries-only.
      // Archiving a node a person has been filling in hides their work instead
      // of destroying it, which is a smaller failure and still not this
      // script's call to make.
      reasons.push({
        code: 'capabilities',
        message: `somebody has recorded integration status on it since the import: ${handSet.join('; ')}`,
      })
    }

    if (!reasons.length) {
      disposition.set(rec.id, 'delete')
      nodeStates.push({ ...rec, disposition: 'delete', reasons: [], renamed: renamed ? live.name : null })
      actions.push({ kind: 'delete-node', nodeId: rec.id, path: rec.path, depth: rec.depth })
      continue
    }

    // The archive fallback, and the ONE case it is allowed in: no children of
    // any kind. `map_nodes_cascade_archive` (0023:604) archives every descendant
    // of the row it touches, so archiving a node that was refused BECAUSE it has
    // children would archive those children — the loss the refusal prevented.
    const canArchive =
      archiveRefused && !live.archived && !kids.length && reasons.every((r) => r.code === 'entries')
    if (canArchive) {
      disposition.set(rec.id, 'archive')
      nodeStates.push({ ...rec, disposition: 'archive', reasons })
      actions.push({ kind: 'archive-node', nodeId: rec.id, path: rec.path, depth: rec.depth })
      continue
    }

    disposition.set(rec.id, 'refused')
    nodeStates.push({
      ...rec,
      disposition: 'refused',
      reasons,
      // WHY THE FALLBACK DID NOT APPLY, in the two different words the two cases
      // deserve. "Archiving cascades to its children" printed under a node with
      // no children is a sentence that teaches the reader the wrong rule.
      archiveBlocked: archiveRefused && !canArchive && !live.archived ? (kids.length ? 'cascade' : 'not-entries-only') : null,
    })
  }

  // Deletes deepest first among themselves. `actions` is built in the loop's
  // order, which is already deepest-first, but sorting the emitted list makes
  // the property readable from the plan itself rather than from this comment.
  const rank = (a) =>
    a.kind === 'remove-links' ? 0
      : a.kind === 'restore-link' ? 1
        : a.kind === 'revert-node' ? 2
          : a.kind === 'delete-node' ? 3
            : a.kind === 'archive-node' ? 4
              : 5
  actions.sort((a, b) => {
    if (rank(a) !== rank(b)) return rank(a) - rank(b)
    if (a.kind === 'delete-node' || a.kind === 'archive-node') {
      if (a.depth !== b.depth) return b.depth - a.depth
      return comparePaths(a.path ?? [], b.path ?? [])
    }
    return comparePaths(a.path ?? [], b.path ?? [])
  })

  // ── ④ capabilities this run created ───────────────────────────────────────
  //
  // `use_cases.id` is `on delete restrict` from `map_node_use_cases` (0024:348)
  // and that restriction is deliberate: deleting "Lab Results" must not silently
  // erase the record of which hospitals integrated it. So a capability comes off
  // only when NOTHING points at it once this undo's own links are gone — and the
  // count subtracts exactly those, nothing more.
  const useCaseStates = []
  const liveUseCaseById = new Map(useCases.map((u) => [u.id, u]))
  for (const rec of manifest.createdUseCases ?? []) {
    if (!liveUseCaseById.has(rec.id)) {
      useCaseStates.push({ ...rec, disposition: 'already-gone', remaining: 0 })
      continue
    }
    const remaining = useCaseLinks.filter(
      (l) => l.use_case_id === rec.id && !removedLinkKeys.has(LINK(l.node_id, l.use_case_id)),
    ).length
    if (remaining) {
      useCaseStates.push({ ...rec, disposition: 'kept', remaining })
      continue
    }
    useCaseStates.push({ ...rec, disposition: 'delete', remaining: 0 })
    actions.push({ kind: 'delete-use-case', useCaseId: rec.id, name: rec.name })
  }

  const count = (list, d) => list.filter((s) => s.disposition === d).length
  const summary = {
    remove: count(nodeStates, 'delete'),
    archive: count(nodeStates, 'archive'),
    refused: count(nodeStates, 'refused'),
    alreadyGone: count(nodeStates, 'already-gone'),
    clearLinks: count(linkStates, 'remove'),
    restoreLinks: count(linkStates, 'restore'),
    skippedLinks: count(linkStates, 'changed-since') + count(linkStates, 'already-there'),
    goneLinks: count(linkStates, 'already-gone'),
    revertFields: fieldStates.reduce((n, f) => n + f.changes.length, 0),
    skippedFields: fieldStates.reduce((n, f) => n + (f.skipped?.length ?? 0), 0),
    removeUseCases: count(useCaseStates, 'delete'),
    keptUseCases: count(useCaseStates, 'kept'),
  }
  summary.partial = summary.refused > 0 || summary.skippedLinks > 0 || summary.skippedFields > 0 || summary.keptUseCases > 0

  return { actions, nodeStates, linkStates, fieldStates, useCaseStates, notes, summary }
}

// ── the printout ────────────────────────────────────────────────────────────

/**
 * THE PRINTOUT IS THE PRODUCT — the same claim `renderPlan` makes, and it is
 * more literally true here, because this is the last thing anybody reads before
 * rows are deleted from a live project.
 *
 * Same shape as the import's plan on purpose: the tree, indented, with what
 * happens to each row spelled out beside it, then a reconciliation line. He has
 * already learned to read one of these.
 */
export function renderUndoPlan(plan, meta = {}) {
  const { nodeStates, linkStates, fieldStates, useCaseStates, notes, summary } = plan
  const out = []
  const say = (line = '') => out.push(line)

  say('')
  say('  NphiesCore — undo a structure import')
  say(`  ${meta.apply ? '*** --apply: THIS RUN REMOVES ROWS FROM THE LIVE PROJECT ***' : 'dry run — nothing will be removed'}`)
  say('')
  if (meta.manifestPath) say(`  Manifest: ${meta.manifestPath}`)
  if (meta.manifest) {
    const m = meta.manifest
    say(`  That run: ${isolate(m.file || '(no file recorded)')}`)
    say(`            applied ${m.finishedAt || m.startedAt || '(no time recorded)'} · ${m.outcome}`)
    say(
      `            wrote ${(m.createdNodes ?? []).length} node(s) · ${(m.setUseCases ?? []).length} link(s) set · ` +
        `${(m.clearedUseCases ?? []).length} cleared · ${(m.updatedNodes ?? []).length} node(s) updated · ` +
        `${(m.createdUseCases ?? []).length} capabilit${(m.createdUseCases ?? []).length === 1 ? 'y' : 'ies'} created`,
    )
  }
  say('')

  for (const n of notes) {
    for (const chunk of wrap(n, 72)) say(`  ${chunk}`)
    say('')
  }

  // ── the tree ──
  const byPath = new Map()
  const order = []
  const at = (path) => {
    const k = path.join('\u0000')
    if (!byPath.has(k)) {
      byPath.set(k, { path, node: null, links: [], fields: null })
      order.push(k)
    }
    return byPath.get(k)
  }
  for (const s of nodeStates) at(s.path).node = s
  for (const s of linkStates) at(s.path).links.push(s)
  for (const s of fieldStates) at(s.path).fields = s
  for (const k of [...order]) {
    const { path } = byPath.get(k)
    for (let d = 1; d < path.length; d += 1) at(path.slice(0, d))
  }

  if (!byPath.size) {
    say('  This manifest names nothing. There is nothing to undo.')
    say('')
    return out.join('\n')
  }

  say('  WHAT COMES OFF')
  say('')
  const entries = [...byPath.values()].sort((x, y) => comparePaths(x.path, y.path))
  let currentTrack = null
  for (const entry of entries) {
    if (entry.path[0] !== currentTrack) {
      currentTrack = entry.path[0]
      say(`  ${isolate(currentTrack)}`)
    }
    if (entry.path.length === 1) continue
    const indent = '  '.repeat(entry.path.length - 1)
    const name = isolate(entry.path[entry.path.length - 1])
    const s = entry.node

    if (!s) {
      // An ancestor with no disposition of its own is unmarked — UNLESS it is
      // carrying changes, in which case an unmarked line with edits indented
      // under it reads as scaffolding rather than as the node being edited.
      const edited = (entry.fields?.changes?.length ?? 0) > 0 || entry.links.some((l) => l.disposition === 'remove' || l.disposition === 'restore')
      say(`  ${indent}${edited ? '~' : ' '} ${name}${edited ? '   KEPT, edits put back' : ''}`)
    } else if (s.disposition === 'delete') {
      // WHICH ONE, PER NODE, BEFORE IT HAPPENS. Delete and archive are not the
      // same promise and the difference is invisible afterwards.
      say(`  ${indent}- ${name}   DELETE${s.implied ? ' (implied — it had no row of its own)' : ''}`)
      if (s.renamed) {
        say(`  ${indent}      note: renamed since the import — it now reads ${isolate(s.renamed)}`)
      }
    } else if (s.disposition === 'archive') {
      say(`  ${indent}~ ${name}   ARCHIVE (--archive-refused; a delete is refused)`)
      for (const r of s.reasons) say(`  ${indent}      ${r.message}`)
    } else if (s.disposition === 'already-gone') {
      say(`  ${indent}  ${name}   already gone`)
    } else {
      say(`  ${indent}! ${name}   REFUSED — LEFT EXACTLY AS IT IS`)
      for (const r of s.reasons) {
        for (const chunk of wrap(r.message, 60)) say(`  ${indent}      ${chunk}`)
      }
      if (s.archiveBlocked === 'cascade') {
        say(`  ${indent}      not archived either: archiving cascades to its children.`)
      } else if (s.archiveBlocked === 'not-entries-only') {
        say(`  ${indent}      not archived either: --archive-refused covers only a node`)
        say(`  ${indent}      whose sole blocker is the entries filed on it.`)
      }
    }

    if (entry.fields) {
      for (const c of entry.fields.changes ?? []) {
        say(`  ${indent}      ${c.column}: ${label(c.toLabel ?? c.to)} -> ${label(c.fromLabel ?? c.from)}  (put back)`)
      }
      for (const c of entry.fields.skipped ?? []) {
        say(`  ${indent}      ${c.column}: edited since the import — left alone`)
      }
    }

    // ⚠ "LEFT ALONE" IS A LIE OVER A NODE THAT IS BEING DELETED. The link goes
    // with it through `map_node_use_cases.node_id … on delete cascade`
    // (0024:358), so the two words that reassure the reader would describe a row
    // this run destroys seconds later. The refusal in `planUndo` should now make
    // that combination unreachable for a node this import created; this line is
    // the second lock, because the cost of it being wrong is somebody approving
    // a delete on the strength of a sentence that was not true.
    const nodeGoing = s?.disposition === 'delete'
    for (const link of entry.links.sort((a, b) => String(a.useCase).localeCompare(String(b.useCase)))) {
      const what = isolate(link.useCase)
      const alone = nodeGoing ? ' — the node it sits on is being DELETED, so it goes with it' : ' — left alone'
      if (link.disposition === 'remove') say(`  ${indent}      ${what}: ${link.status} -> (link deleted)`)
      else if (link.disposition === 'restore') say(`  ${indent}      ${what}: -> ${link.to}  (put back)`)
      else if (link.disposition === 'changed-since') {
        say(`  ${indent}      ${what}: says ${link.current}, the import wrote ${link.status}${alone}`)
      } else if (link.disposition === 'already-there') {
        say(`  ${indent}      ${what}: someone re-added it (${link.current})${alone}`)
      }
    }
  }
  say('')

  if (useCaseStates.length) {
    say(`  ══ CAPABILITIES THIS IMPORT CREATED (${useCaseStates.length}) ═══════════════════════`)
    for (const u of useCaseStates) {
      if (u.disposition === 'delete') say(`    - ${isolate(u.name)}   DELETE (nothing points at it once the links above are gone)`)
      else if (u.disposition === 'already-gone') say(`      ${isolate(u.name)}   already gone`)
      else say(`    ! ${isolate(u.name)}   KEPT — ${u.remaining} link(s) this import did not set still use it`)
    }
    say('')
  }

  say('  ── the order ─────────────────────────────────────────────────────────')
  say('  Links first, then fields, then nodes DEEPEST FIRST. 0023 refuses to')
  say('  delete a node while anything points at it, so children before parents is')
  say('  not a preference — any other order stops half-way through the tree.')
  say('')

  say(
    `  Summary: ${summary.remove} node(s) to remove · ${summary.archive} to archive · ` +
      `${summary.refused} refused because work is attached · ${summary.alreadyGone} already gone · ` +
      `${summary.clearLinks} link(s) to clear · ${summary.restoreLinks} to put back · ` +
      `${summary.skippedLinks} left alone · ${summary.revertFields} field(s) to put back · ` +
      `${summary.removeUseCases} capabilit${summary.removeUseCases === 1 ? 'y' : 'ies'} to remove`,
  )
  say('')

  if (summary.partial) {
    // SAID AT THE END, WHERE THE EYE LANDS. A partial undo that reads as a
    // success is how somebody concludes the demo is gone and then finds half of
    // it on the map in front of a steering group.
    say('  ⚠ THIS UNDO IS PARTIAL, AND ON PURPOSE.')
    if (summary.refused) {
      say(`  ${summary.refused} node(s) are no longer this import's to remove — a child it never`)
      say('  created, entries filed on them, or a move somebody made deliberately.')
      say('  Each one is named above with exactly what is in the way. Nothing about')
      say('  them is touched: not the node, not its fields. Their demo capability')
      say('  links DO come off, so nothing is left claiming an integration this')
      say('  import invented.')
    }
    if (summary.skippedLinks || summary.skippedFields) {
      say(`  ${summary.skippedLinks} link(s) and ${summary.skippedFields} field(s) have been edited since the import.`)
      say('  This script only takes back what still looks exactly like what it wrote.')
    }
    if (summary.keptUseCases) {
      say(`  ${summary.keptUseCases} capabilit(ies) are still referenced by links this import did not set.`)
    }
    if (summary.refused) {
      say('')
      say('  To finish the job, remove what is named above in Settings › Structure,')
      say('  where the app asks you first — then run this manifest again: a node')
      say('  already gone is a no-op, so a second pass costs nothing.')
    }
    say('')
  }

  return out.join('\n')
}

function label(value) {
  if (value === null || value === undefined || value === '') return '(blank)'
  const flat = String(value)
    .replace(/[\n\r\t]/gu, ' ')
    .replace(/\p{Cc}/gu, '')
  return `"${isolate(flat.length > 48 ? `${flat.slice(0, 47)}…` : flat)}"`
}

function wrap(text, width) {
  const words = String(text).split(/\s+/u)
  const lines = []
  let line = ''
  for (const word of words) {
    if (line && line.length + 1 + word.length > width) {
      lines.push(line)
      line = word
    } else {
      line = line ? `${line} ${word}` : word
    }
  }
  if (line) lines.push(line)
  return lines
}
