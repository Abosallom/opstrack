// Data access for the map hierarchy — nodes, the kinds they are, and the HL7/FHIR
// use cases an organization integrates.
//
// ONE MODULE, THREE LEVELS, exactly as api/tracks.ts holds both tracks and the
// groups above them. The reasoning is that file's, one level down: nothing ever
// wants a node without knowing what kind of thing it is, and the admin screen that
// edits the catalogue is the screen that edits the tree with different fields. Three
// modules would be three import paths for one screen and three chances for the
// conventions to drift.
//
// ERRORS HERE ARE i18n KEYS, NOT SENTENCES. Every function returns `pgErrorKey(...)`
// on failure — `mapadmin.errCycle`, not `duplicate key value violates unique
// constraint "map_nodes_sibling_name_uidx"`. Callers render them through
// `t(result.error)`. This is api/tracks.ts's rule verbatim and for its stated
// reason: these screens are the ones an Arabic-only admin will actually operate, and
// a raw Postgres sentence in an RTL layout is a constraint identifier the reader has
// never heard of, printed left-to-right, in the wrong language.
//
// NO NEW SERVER-SIDE AUTHORIZATION IS NEEDED, and the split is deliberate. 0023/0024
// gate `map_nodes`, `map_node_kinds` and `use_cases` writes on is_admin() and
// `map_node_use_cases` writes on is_member(): Aziz owns the SHAPE of the tree and
// the catalogue, his team records which organization integrated what. Admin-gating
// the join would make him the data-entry bottleneck for the data his team collects,
// which is the opposite of the point. A member calling one of the admin-gated
// functions gets 42501 and the UI shows the forbidden key.
//
// WHAT IS NOT HERE: per-node use-case links are DATA, not configuration. They are
// fetched when a panel opens (listNodeUseCases) and are deliberately absent from
// store/config.ts — a workspace with forty organizations and ten capabilities is
// four hundred rows nobody looks at until one panel is open.

import { supabase } from './supabase'
import { fail, notConfigured, type ApiResult } from './result'
import { chunkIds, fetchAllPages } from './paging'
import { pgErrorKey } from '../lib/pgError'
// The one place `rung` and the deprecated `status` are reconciled — see below.
import { statusForRung } from '../lib/mapNodes'
// TYPE-ONLY, so entries.ts's doctrine comment at 82-98 stays the one place
// `Loaded<T>` is explained and this module gains no runtime coupling to the
// entries loader.
import type { Loaded } from './entries'
import type {
  MapNode,
  HisProduct,
  MapNodeInput,
  NodeReadiness,
  SsoState,
  MapNodeKind,
  MapNodeKindInput,
  MapNodeMoveResult,
  MapNodeOpenCounts,
  MapNodeProgress,
  MapNodeStage,
  MapNodeStageInput,
  MapNodeStageUsage,
  MapNodeUsage,
  MapNodeUseCase,
  UseCase,
  UseCaseInput,
  UseCaseRung,
  UseCaseScope,
} from '../types'

/** The id of the signed-in user, or null when the session has gone. */
async function currentUserId(): Promise<string | null> {
  if (!supabase) return null
  const { data } = await supabase.auth.getUser()
  return data.user?.id ?? null
}

/**
 * Where a new row lands at the end of a list, computed client-side.
 *
 * api/tracks.ts has this twice, once per table, and this is the same function with
 * the table named: every new row defaulting to the column's `sort_order` 0 would
 * pile them all at the top in reverse creation order. Parameterised here because
 * three tables need it and three copies is where the fourth one gets it wrong.
 *
 * `scope` narrows the maximum to one sibling set — node ordering is per parent, so
 * the last child of one phase must not be pushed past the last child of another.
 * Passing no scope takes the maximum over the whole table, which is what the two
 * flat catalogues want.
 */
async function nextSortOrder(
  table: string,
  scope?: { column: string; value: string | null },
): Promise<number> {
  if (!supabase) return 0
  let query = supabase
    .from(table)
    .select('sort_order')
    .order('sort_order', { ascending: false })
    .limit(1)
  if (scope) {
    query = scope.value === null ? query.is(scope.column, null) : query.eq(scope.column, scope.value)
  }
  const { data } = await query.maybeSingle()
  const row = data as { sort_order: number } | null
  return (row?.sort_order ?? 0) + 1
}

// ── nodes (0023) ────────────────────────────────────────────────────────────

/**
 * The page ceiling for every read in this module — five pages, so 5,000 rows.
 *
 * The portfolio this map exists for is ~400 organizations under a handful of
 * phases; five pages is an order of magnitude of headroom and still a bound, so a
 * bug somewhere else cannot turn a page loop into an infinite one. Past it the read
 * comes back `truncated` and the screen says so — which is the whole point of this
 * wave: a map missing rows must never look like a map.
 */
const MAX_PAGES = 5

/**
 * Every node, ordered for display. Archived nodes are hidden unless asked for.
 *
 * ONE FLAT READ, not a recursive walk: the tree is assembled client-side by
 * store/config.ts, which buckets by `parent_id` once when the data lands. A depth-
 * first server query would cost one round trip per level and would still have to be
 * re-bucketed here, because the map draws children in sibling order and a recursive
 * CTE returns them in traversal order.
 *
 * PAGED, AND THAT IS THE POINT OF THE WHOLE UNIT. Unpaged, this read stopped at
 * PostgREST's 1,000-row ceiling and reported success: `buildMindtree` then received
 * a truncated list, every count on every ring was silently low, and the tree itself
 * carried no mark. That is the worst failure available here — a correct-LOOKING
 * wrong number in front of an executive — and it is why the return type is
 * `Loaded<MapNode>` rather than an array. The flag has a reader: store/config.ts
 * keeps it as `mapNodesTruncated` and the map shell renders a sentence from it.
 *
 * The second sort key is `name` for listTracks' reason: `sort_order` defaults to 0
 * and the reorder RPC only rewrites the ids it was handed, so without a stable tie
 * break two loads of the same data render in different orders — which reads as data
 * loss, not as a sort.
 *
 * THE THIRD SORT KEY IS `id`, AND PAGING IS WHAT ADDED IT. `(sort_order, name)` is
 * not unique — two organizations under different phases may hold both — and a
 * non-total order under `.range()` is not merely unstable, it drops and duplicates
 * rows: the server is free to return a tied row on page 1 and again on page 2, or
 * on neither. `id` makes the order total. It changes nothing a reader can see,
 * because it only breaks ties that previously reshuffled between loads anyway.
 */
export async function listMapNodes(includeArchived = false): Promise<ApiResult<Loaded<MapNode>>> {
  if (!supabase) return notConfigured()
  const client = supabase
  return await fetchAllPages<MapNode>((from, to) => {
    let query = client
      .from('map_nodes')
      .select('*')
      .order('sort_order', { ascending: true })
      .order('name', { ascending: true })
      .order('id', { ascending: true })
      .range(from, to)
    if (!includeArchived) query = query.eq('archived', false)
    return query
  }, MAX_PAGES)
}

/**
 * Create a node under a parent, or at depth 0 under a track.
 *
 * `track_id` IS SENT EVEN WHEN THERE IS A PARENT, and that is not redundancy. The
 * column is `not null` on every row, the database derives it from the parent, and
 * `map_node_cross_track` rejects a value that disagrees — so sending it makes the
 * caller's belief checkable instead of leaving the row's most load-bearing column to
 * a trigger nobody can see from here. For a root node there is no parent and this is
 * the only place the answer can come from.
 *
 * `source` is written explicitly rather than left to the column default, for
 * createTrack's reason about `group_id`: this function sends the whole row it means,
 * and a default is the same answer silently, only for as long as the default stays
 * put.
 */
export async function createMapNode(input: MapNodeInput): Promise<ApiResult<MapNode>> {
  if (!supabase) return notConfigured()
  const name = input.name.trim()
  if (!name) return fail('common.error')

  const userId = await currentUserId()
  if (!userId) return fail('common.notSignedIn')

  const row = {
    parent_id: input.parentId,
    track_id: input.trackId,
    kind_id: input.kindId,
    name,
    name_ar: input.nameAr.trim(),
    description: input.description.trim(),
    description_ar: input.descriptionAr.trim(),
    account_manager_id: input.accountManagerId,
    // Trimmed like the names, not like the ids: it is free text a person types,
    // so ' Acme ' and 'Acme' must be the same vendor to a filter.
    vendor: input.vendor.trim(),
    sort_order: await nextSortOrder('map_nodes', { column: 'parent_id', value: input.parentId }),
    source: 'local',
    created_by: userId,
  }

  const { data, error } = await supabase.from('map_nodes').insert(row).select('*').single()
  if (error) return fail(pgErrorKey(error))
  return { ok: true, data: data as MapNode }
}

/**
 * Patch a node. Undefined keys are left untouched, exactly like updateTrack.
 *
 * `parentId` and `trackId` ARE NOT PATCHABLE HERE — the parameter type subtracts
 * them, so reaching for one is a compile error rather than a key this function
 * silently drops. Re-parenting has to rewrite every descendant's `track_id` in a
 * single statement or a half-applied move leaves a subtree claiming a track its root
 * has left; that is moveMapNode, and splitting them is what makes "this function
 * cannot break the invariant" true by construction.
 */
export async function updateMapNode(
  id: string,
  input: Partial<Omit<MapNodeInput, 'parentId' | 'trackId'>>,
): Promise<ApiResult<MapNode>> {
  if (!supabase) return notConfigured()

  const row: Record<string, unknown> = {}
  if (input.name !== undefined) row.name = input.name.trim()
  if (input.nameAr !== undefined) row.name_ar = input.nameAr.trim()
  if (input.description !== undefined) row.description = input.description.trim()
  if (input.descriptionAr !== undefined) row.description_ar = input.descriptionAr.trim()
  // `null` is a real instruction on both of these — "this node has no kind", "nobody
  // is named on this node yet" — and it is NOT the same as leaving the key off,
  // which means "do not touch it". The `!== undefined` test is what keeps those two
  // apart; a truthiness test would silently turn every clearing into a no-op, which
  // is updateTrack's `group_id` lesson word for word.
  if (input.kindId !== undefined) row.kind_id = input.kindId
  if (input.accountManagerId !== undefined) row.account_manager_id = input.accountManagerId
  if (input.vendor !== undefined) row.vendor = input.vendor.trim()
  // Null clears it — `his_id` is a real FK and "no system recorded" is null,
  // not the empty string `vendor` uses. The two differ because one is a
  // reference to a catalogue and the other is free text; see MapNode.
  if (input.hisId !== undefined) row.his_id = input.hisId

  // A no-op PATCH would come back with zero rows and .single() would then error out
  // on a request that did nothing wrong. Read the row back instead.
  if (Object.keys(row).length === 0) {
    const { data, error } = await supabase.from('map_nodes').select('*').eq('id', id).single()
    if (error) return fail(pgErrorKey(error))
    return { ok: true, data: data as MapNode }
  }

  const { data, error } = await supabase
    .from('map_nodes')
    .update(row)
    .eq('id', id)
    .select('*')
    .single()
  if (error) return fail(pgErrorKey(error))
  return { ok: true, data: data as MapNode }
}

/**
 * Archive or restore a node.
 *
 * Only `archived` is written. `archived_at` is maintained by 0023's
 * `map_nodes_archive_stamp()` trigger in BOTH directions, so setting it here would
 * fight the trigger and lose — setTrackArchived's rule, one table over.
 *
 * ARCHIVING A NODE HIDES ITS SUBTREE. store/config.ts drops the children of an
 * archived parent from `mapChildren`, because a phase that is put away and four
 * organizations that stay on the map is a tree the reader cannot explain. The
 * screen has to say so before the click; this function does not, and must not,
 * discover it afterwards.
 */
export async function setMapNodeArchived(
  id: string,
  archived: boolean,
): Promise<ApiResult<MapNode>> {
  if (!supabase) return notConfigured()
  const { data, error } = await supabase
    .from('map_nodes')
    .update({ archived })
    .eq('id', id)
    .select('*')
    .single()
  if (error) return fail(pgErrorKey(error))
  return { ok: true, data: data as MapNode }
}

/**
 * Rewrite sort_order for one sibling set, in array order, returning how many rows
 * moved.
 *
 * An RPC rather than N PATCHes, for reorderTracks' reason: a half-applied reorder
 * leaves duplicate positions behind, and only a single statement is atomic under
 * PostgREST. `security invoker` on the SQL side — the function needs atomicity, not
 * privilege, so RLS rejects a member exactly as if they had run the update by hand.
 *
 * IT TAKES THE SCOPE AS WELL AS THE IDS, which is the difference from
 * reorderTracks and reorderGroups and is not an inconvenience to route around.
 * Those two renumber one flat list; here there are as many lists as there are
 * branches, and 0023's function PROVES every id belongs to (track, parent) before
 * writing anything. An id from another branch — a stale client, a mis-built drag
 * payload — would otherwise silently renumber a branch nobody is looking at. Pass
 * `parentId: null` for the root ring; the function compares with `is not distinct
 * from`, so null is a real scope and not a wildcard.
 */
export async function reorderMapNodes(
  trackId: string,
  parentId: string | null,
  ids: string[],
): Promise<ApiResult<number>> {
  if (!supabase) return notConfigured()
  if (ids.length === 0) return { ok: true, data: 0 }
  const { data, error } = await supabase.rpc('reorder_map_nodes', {
    p_parent: parentId,
    p_track: trackId,
    p_ids: ids,
  })
  if (error) return fail(pgErrorKey(error))
  return { ok: true, data: typeof data === 'number' ? data : ids.length }
}

/**
 * Move a node — and everything beneath it — under a new parent, or up to depth 0
 * under a track. Resolves with what the move actually did: how many nodes were
 * rewritten, how many ENTRIES changed track underneath them, and whether the track
 * changed at all.
 *
 * AN RPC, AND THE ONE FUNCTION IN THIS FILE THAT COULD NOT BE A PATCH. A cross-track
 * move has to rewrite `track_id` on every descendant, and PostgREST gives one
 * statement of atomicity: a PATCH of the node followed by a PATCH of its children is
 * two statements, and the gap between them is a tree in which a phase belongs to UHR
 * and its organizations still belong to the track it left. The invariant that makes
 * two filing axes unrepresentable would hold for every row and be false for the
 * tree.
 *
 * `trackId` is the destination track for a move to depth 0, where there is no parent
 * to derive it from. With a parent, pass null and let the database derive it —
 * asserting a track that disagrees with the parent's is what `map_node_cross_track`
 * exists to reject.
 *
 * A move that would put a node under one of its own descendants is refused for the
 * cycle it would create, and one that would push the tree past the depth cap is
 * refused for the depth. Both are checked by a DEFERRED constraint trigger, so a
 * multi-statement rearrangement is judged on the state it ends in rather than on
 * whichever order the statements happened to run — no bypass flag, and no correct
 * move rejected for arriving in an awkward sequence.
 *
 * The RPC answers with a jsonb object, so the three fields are read defensively
 * rather than cast: a missing key means an older function is deployed, and reporting
 * "0 entries moved" when the answer is unknown is the one number that must not be
 * invented. A malformed reply degrades to a move that reports nothing, not to a
 * move that claims nothing happened.
 */
export async function moveMapNode(
  id: string,
  parentId: string | null,
  trackId: string | null = null,
): Promise<ApiResult<MapNodeMoveResult>> {
  if (!supabase) return notConfigured()
  const { data, error } = await supabase.rpc('move_map_node', {
    p_id: id,
    p_parent: parentId,
    p_track: trackId,
  })
  if (error) return fail(pgErrorKey(error))

  const reply = (typeof data === 'object' && data !== null ? data : {}) as Record<string, unknown>
  return {
    ok: true,
    data: {
      nodes: typeof reply.nodes === 'number' ? reply.nodes : 0,
      entries: typeof reply.entries === 'number' ? reply.entries : 0,
      trackChanged: reply.track_changed === true,
    },
  }
}

/** One head-only count. PostgREST returns the count in the header, no rows. */
async function countReferencing(table: string, column: string, id: string): Promise<number> {
  if (!supabase) return 0
  const { count, error } = await supabase
    .from(table)
    .select(column, { head: true, count: 'exact' })
    .eq(column, id)
  if (error) {
    console.warn(`[map] usage count failed for ${table}.${column}:`, error.message)
    return 0
  }
  return count ?? 0
}

/**
 * How many rows still point at this node, for the delete confirmation.
 *
 * Three head-only requests rather than one RPC — getTrackUsage's shape and its
 * reasoning: the same numbers the delete guard computes, but readable by the UI
 * BEFORE it commits to anything, and reusing the existing select policies instead of
 * adding a function.
 *
 * ALL THREE ARE DIRECT COUNTS, not recursive ones, and the flow depends on that: the
 * guard refuses the delete while `children` or `entries` is non-zero, so those are
 * exactly what the admin has to clear first. A descendant count would name a bigger
 * number than the rule actually asks for, and the admin would go and empty a subtree
 * the database never objected to.
 *
 * `useCases` IS THE ODD ONE OUT and the confirmation must say so: it does not block
 * anything. `map_node_use_cases.node_id` is `on delete cascade`, so those rows go
 * with the node — silently, and they are the fieldwork somebody drove to a hospital
 * to collect. It is counted here precisely because it is the number nobody would
 * think to ask for and the only one that is destroyed rather than refused.
 */
export async function getMapNodeUsage(id: string): Promise<ApiResult<MapNodeUsage>> {
  if (!supabase) return notConfigured()
  const [entries, children, useCases] = await Promise.all([
    countReferencing('entries', 'node_id', id),
    countReferencing('map_nodes', 'parent_id', id),
    countReferencing('map_node_use_cases', 'node_id', id),
  ])
  return { ok: true, data: { entries, children, useCases } }
}

/**
 * Delete a node. Resolves with what was pointing at it a moment BEFORE the delete,
 * because that is what the caller wants to report and it does not exist afterwards
 * — deleteTrack's contract.
 *
 * NO REASSIGNMENT PARAMETER, and its absence is a decision rather than an omission.
 * 0023's guard refuses outright while ANYTHING still points at the node — child
 * nodes or entries — rather than silently re-parenting a subtree to its grandparent
 * or unfiling forty items, because "delete this phase", "promote its five
 * organizations" and "move its work somewhere sensible" are three different
 * intentions and the screen has to ask which one. deleteTrack could take a
 * destination because a track has exactly one kind of dependant and one obvious
 * answer; a node has two and no obvious answer for either. Emptying it first is
 * moveMapNode and a drag on the map.
 *
 * Note that the guard is stricter than the FKs beneath it: `entries.node_id` is `on
 * delete set null` and would have coped. The guard exists so that unfiling forty
 * items is something an admin DOES, not something a delete does to them.
 */
export async function deleteMapNode(id: string): Promise<ApiResult<MapNodeUsage>> {
  if (!supabase) return notConfigured()

  const before = await getMapNodeUsage(id)
  const usage: MapNodeUsage = before.ok ? before.data : { entries: 0, children: 0, useCases: 0 }

  const { error } = await supabase.from('map_nodes').delete().eq('id', id)
  if (error) return fail(pgErrorKey(error))
  return { ok: true, data: usage }
}

// ── node kinds (0023) ───────────────────────────────────────────────────────
//
// Programme, Phase, Organization — what a node IS. Four functions in the shape the
// tracks half of api/tracks.ts uses, because a reader who has understood that one
// has understood this one.
//
// NOTHING IN THE APP BRANCHES ON A KIND. The panel that renders an Organization and
// the panel that renders a Phase are the same component with different fields, and
// which fields is configuration. That is why this table has no frozen key column and
// why an admin may add a fourth kind without a code change — and it is also why the
// kinds carry no colour: colour on this map means track, at every depth.

/**
 * Every kind, ordered for display.
 *
 * PAGED TOO, THOUGH THIS TABLE HOLDS THREE ROWS — and the reason is not symmetry
 * for its own sake. "Small enough that there is no paging question" is exactly what
 * the old comment here said, and it is a judgement about today's data written into
 * a function that outlives it; the same sentence was true of `map_nodes` when it was
 * written. One `.range()` and a `Loaded<T>` cost a caller `.rows` and remove the
 * category of bug entirely. The loop makes exactly one request while the table is
 * short, which it will be for years.
 *
 * `id` joins the sort keys for listMapNodes' reason: `.range()` needs a total order.
 */
export async function listMapNodeKinds(): Promise<ApiResult<Loaded<MapNodeKind>>> {
  if (!supabase) return notConfigured()
  const client = supabase
  return await fetchAllPages<MapNodeKind>(
    (from, to) =>
      client
        .from('map_node_kinds')
        .select('*')
        .order('sort_order', { ascending: true })
        .order('name', { ascending: true })
        .order('id', { ascending: true })
        .range(from, to),
    MAX_PAGES,
  )
}

export async function createMapNodeKind(
  input: MapNodeKindInput,
): Promise<ApiResult<MapNodeKind>> {
  if (!supabase) return notConfigured()
  const name = input.name.trim()
  if (!name) return fail('common.error')

  const userId = await currentUserId()
  if (!userId) return fail('common.notSignedIn')

  const { data, error } = await supabase
    .from('map_node_kinds')
    .insert({
      name,
      name_ar: input.nameAr.trim(),
      sort_order: await nextSortOrder('map_node_kinds'),
      created_by: userId,
    })
    .select('*')
    .single()
  if (error) return fail(pgErrorKey(error))
  return { ok: true, data: data as MapNodeKind }
}

/** Patch a kind. Undefined keys are left untouched, exactly like updateTrack. */
export async function updateMapNodeKind(
  id: string,
  input: Partial<MapNodeKindInput>,
): Promise<ApiResult<MapNodeKind>> {
  if (!supabase) return notConfigured()

  const row: Record<string, unknown> = {}
  if (input.name !== undefined) row.name = input.name.trim()
  if (input.nameAr !== undefined) row.name_ar = input.nameAr.trim()

  // A no-op PATCH returns zero rows and .single() errors on a request that did
  // nothing wrong — updateTrack's reasoning, verbatim.
  if (Object.keys(row).length === 0) {
    const { data, error } = await supabase.from('map_node_kinds').select('*').eq('id', id).single()
    if (error) return fail(pgErrorKey(error))
    return { ok: true, data: data as MapNodeKind }
  }

  const { data, error } = await supabase
    .from('map_node_kinds')
    .update(row)
    .eq('id', id)
    .select('*')
    .single()
  if (error) return fail(pgErrorKey(error))
  return { ok: true, data: data as MapNodeKind }
}

/**
 * Rewrite sort_order for the given kind ids, in array order.
 *
 * `security invoker` for reorderTracks' reason: atomicity, not privilege. The kinds
 * are one flat list, so unlike reorder_map_nodes there is no sibling scope to prove
 * and the RPC takes ids alone — the same signature reorder_tracks and reorder_groups
 * have.
 */
export async function reorderMapNodeKinds(ids: string[]): Promise<ApiResult<number>> {
  if (!supabase) return notConfigured()
  if (ids.length === 0) return { ok: true, data: 0 }
  const { data, error } = await supabase.rpc('reorder_map_node_kinds', { p_ids: ids })
  if (error) return fail(pgErrorKey(error))
  return { ok: true, data: typeof data === 'number' ? data : ids.length }
}

/**
 * Delete a kind. `map_nodes.kind_id` is `on delete set null`, so this un-kinds the
 * nodes that used it rather than taking the organizations filed under it with them —
 * the same `on delete set null` reading that makes deleting a track group ungroup
 * its tracks. A node with no kind is still a node and is still drawn.
 */
export async function deleteMapNodeKind(id: string): Promise<ApiResult<void>> {
  if (!supabase) return notConfigured()
  const { error } = await supabase.from('map_node_kinds').delete().eq('id', id)
  if (error) return fail(pgErrorKey(error))
  return { ok: true, data: undefined }
}

// ── use cases (0024) ────────────────────────────────────────────────────────
//
// The catalogue of HL7/FHIR capabilities: ADT, Medication Prescribe V1 and V2,
// Medication Dispense V1 and V2, Radiology Order, Radiology Report, Lab Order, Lab
// Results, Clinical Notes — and, in Aziz's words, "more to be added later", which is
// why this is a table and not a union in types.ts.
//
// THERE IS NO reorderUseCases, and its absence is a gap rather than a decision:
// 0023 ships `reorder_map_nodes` and `reorder_map_node_kinds`, and 0024 ships no
// counterpart for this table. Writing one here as N PATCHes would contradict the
// argument every reorder in this codebase rests on — a half-applied reorder leaves
// two rows sharing a position, and only a single statement is atomic under PostgREST
// — so shipping nothing is better than shipping something that is wrong the first
// time a request fails halfway. `listUseCases` sorts by `sort_order` then `name` and
// `createUseCase` appends, so the order is stable and meaningful; it is just not
// draggable. `reorder_use_cases(p_ids uuid[])` is named in the handoff.

/**
 * Every use case, ordered for display.
 *
 * Hidden ones are excluded by default and the parameter is `includeHidden`, not
 * `includeArchived`, because that is the semantics `vocab_options` established and
 * this table copies: hiding removes a capability from the pickers and changes
 * nothing about the links that already name it. The admin screen passes true; the
 * panel that offers a member a capability to tick passes nothing.
 *
 * PAGED for listMapNodeKinds' reason — "more to be added later" is this table's
 * stated future (see the section header), and a catalogue that quietly stopped at
 * 1,000 capabilities would leave every matrix short a column with nothing on screen
 * to say so. `id` joins the sort keys because `.range()` needs a total order.
 */
export async function listUseCases(includeHidden = false): Promise<ApiResult<Loaded<UseCase>>> {
  if (!supabase) return notConfigured()
  const client = supabase
  return await fetchAllPages<UseCase>((from, to) => {
    let query = client
      .from('use_cases')
      .select('*')
      .order('sort_order', { ascending: true })
      .order('name', { ascending: true })
      .order('id', { ascending: true })
      .range(from, to)
    if (!includeHidden) query = query.eq('hidden', false)
    return query
  }, MAX_PAGES)
}

/**
 * The hospital information systems an organization can run — 0034's catalogue.
 *
 * `listUseCases`' shape exactly, and for its reasons: named columns are not
 * worth it on a table this small, `hidden` retires a product from the picker
 * without un-tagging the organizations already on it, and the read is paged
 * because "more to be added later" is this table's stated future too.
 *
 * ⚠ FAILS QUIET ON A WORKSPACE THAT HAS NOT RUN 0034. The 0026 reads above set
 *   the precedent: a missing table renders "nothing recorded", never an error
 *   bar across a page whose other nine sections are fine.
 */
export async function listHisProducts(
  includeHidden = false,
): Promise<ApiResult<Loaded<HisProduct>>> {
  if (!supabase) return notConfigured()
  const client = supabase
  return await fetchAllPages<HisProduct>((from, to) => {
    let query = client
      .from('his_products')
      .select('*')
      .order('sort_order', { ascending: true })
      .order('name', { ascending: true })
      .order('id', { ascending: true })
      .range(from, to)
    if (!includeHidden) query = query.eq('hidden', false)
    return query
  }, MAX_PAGES)
}

export async function createUseCase(input: UseCaseInput): Promise<ApiResult<UseCase>> {
  if (!supabase) return notConfigured()
  const name = input.name.trim()
  if (!name) return fail('common.error')

  const userId = await currentUserId()
  if (!userId) return fail('common.notSignedIn')

  const { data, error } = await supabase
    .from('use_cases')
    .insert({
      name,
      name_ar: input.nameAr.trim(),
      // Explicit rather than left to the column default, for createTrack's reason:
      // this row is the whole row it means. A capability created hidden is a real
      // thing an admin may want (staging next quarter's list), so the key is sent
      // whenever the form has an answer and defaults to visible when it does not.
      hidden: input.hidden ?? false,
      sort_order: await nextSortOrder('use_cases'),
      created_by: userId,
    })
    .select('*')
    .single()
  if (error) return fail(pgErrorKey(error))
  return { ok: true, data: data as UseCase }
}

/** Patch a use case. Undefined keys are left untouched, exactly like updateTrack. */
export async function updateUseCase(
  id: string,
  input: Partial<UseCaseInput>,
): Promise<ApiResult<UseCase>> {
  if (!supabase) return notConfigured()

  const row: Record<string, unknown> = {}
  if (input.name !== undefined) row.name = input.name.trim()
  if (input.nameAr !== undefined) row.name_ar = input.nameAr.trim()
  if (input.hidden !== undefined) row.hidden = input.hidden

  if (Object.keys(row).length === 0) {
    const { data, error } = await supabase.from('use_cases').select('*').eq('id', id).single()
    if (error) return fail(pgErrorKey(error))
    return { ok: true, data: data as UseCase }
  }

  const { data, error } = await supabase
    .from('use_cases')
    .update(row)
    .eq('id', id)
    .select('*')
    .single()
  if (error) return fail(pgErrorKey(error))
  return { ok: true, data: data as UseCase }
}

/**
 * Delete a use case.
 *
 * IT IS REFUSED THE MOMENT ANYBODY HAS USED IT. `map_node_use_cases.use_case_id` is
 * `on delete restrict`, so a capability twelve hospitals are recorded against cannot
 * be deleted at all — the FK raises 23503 naming its own constraint, which is why
 * pgError.ts matches that name. `hidden` is the operation an admin almost always
 * wants (it clears the pickers and keeps the history); a delete is for a row typed
 * by mistake this morning, and that is exactly the row the restrict lets through.
 * The database decides which deletes are legal and this function does not
 * second-guess it, exactly as deleteTrack does not.
 */
export async function deleteUseCase(id: string): Promise<ApiResult<void>> {
  if (!supabase) return notConfigured()
  const { error } = await supabase.from('use_cases').delete().eq('id', id)
  if (error) return fail(pgErrorKey(error))
  return { ok: true, data: undefined }
}

// ── the join: which organization integrated what (0024) ─────────────────────
//
// MEMBER-WRITABLE, unlike everything above it. The shape of the tree and the
// catalogue are the admin's; which organization has reached which state on which
// capability is the data the team collects, and gating it on is_admin() would make
// one person the bottleneck for the only numbers this feature exists to produce.
//
// AN ABSENT ROW MEANS "NOBODY HAS SAID". There is no sentinel rung and no zero: the
// two states a (node, use case) cell can be in are "a row on the ladder" and "no
// row". That is exactly `track_slas`' shape, chosen here for exactly its reason, and
// it is why setNodeUseCase takes `rung: UseCaseRung | null` and DELETES on null
// rather than writing something that means nothing.
//
// ⚠ AND "DOES NOT APPLY HERE" IS NOT THAT ABSENCE. 0032 added `scope` precisely so a
//   hospital with no radiology department can say so — a ROW reading
//   `not_applicable`, which leaves the denominator and reads "6 of 10". Deleting the
//   row would say nobody had looked, which is the opposite of a decision somebody
//   made, and the stamp trigger is BEFORE INSERT OR UPDATE, so a DELETE is the one
//   change the audit log cannot see. Ruling a pair out is a scope write, never a
//   delete; the delete stays for "this was recorded by mistake".

/**
 * The columns every link read asks for, by name.
 *
 * NAMED RATHER THAN `*` so `MapNodeUseCase` cannot drift from the query when the
 * table gains an audit column — `listTrackSlas`' precedent — and WIDER than the
 * three key columns it used to be. 0024 gave this table `source`, `external_ref`,
 * `external_url`, `synced_at` and `overrides` on the day it was created, and
 * nothing has ever read them: a link that came from Jira has looked exactly like a
 * link somebody typed. One list, used by every reader here, is what keeps the
 * widening from being true of one loader and false of the next — the kind of
 * two-answers-for-one-question seam this wave exists to close.
 *
 * ⚠ `status` AND `rung` ARE BOTH HERE, AND THAT IS NOT DUPLICATION. 0032 added
 *   `rung` — the five-rung ladder that is now the truth — and backfilled it from
 *   `status`, keeping both until a later migration drops the older column. The
 *   panel reads `rung`; the portfolio surfaces still read `status`. They agree
 *   because every write sets both from one expression (`setNodeUseCase` below),
 *   and the day `status` is dropped is the day it leaves this list and those
 *   surfaces move. Selecting only one of the two would make one half of the app
 *   silently blind.
 *
 * ⚠ AND THE PORTFOLIO PAYS FOR THE PANEL'S COLUMNS. `listNodeUseCasesFor` pulls
 *   1,540 rows and now carries thirteen more per row, most of them empty. That
 *   is the cheaper of the two mistakes: two lists would mean a `MapNodeUseCase`
 *   from one path has fields the other lacks, which destroys the property this
 *   type stands on — `source === undefined` means "not from a read", never "no
 *   source". When the COC queue's read outgrows this, it gets a row type of its
 *   own with its own select, never a narrower `MapNodeUseCase`.
 */
// ⚠ ONE STRING LITERAL, NOT A CONCATENATION, and it has to stay that way.
//   supabase-js infers the row shape from the literal it is handed; `'a' + 'b'`
//   widens to `string` and the inference collapses, which surfaces forty lines
//   away as "PostgrestFilterBuilder is not assignable to PromiseLike<Page<…>>"
//   on a line nobody touched. Long line, kept whole on purpose.
const LINK_COLUMNS =
  'node_id, use_case_id, status, rung, scope, blocked_since, blocked_reason, pending_with, target_date, live_on, status_changed_at, coc_submitted_on, coc_contact, coc_reference, coc_signed_on, updated_by, source, external_ref, external_url, synced_at, overrides'

/**
 * One node's links. Ordered so two loads of the same data render in the same order —
 * the pair is the primary key, so the ordering is total and stable.
 *
 * FETCH-ON-OPEN, NOT STORED. store/config.ts holds the tree and the catalogue
 * because nothing renders a node without them; it deliberately does not hold this,
 * because forty organizations times ten capabilities is four hundred rows that
 * nobody looks at until a panel is open, and a cache of them would have to be
 * invalidated by every tick of a checkbox on every other client.
 *
 * THE OPTIONAL ARGUMENT IS GONE, AND ITS ABSENCE IS THE FIX. `nodeId?: string` is
 * precisely the shape that let a caller issue the unbounded read of the whole join
 * — four thousand rows at 400 organizations — which came back with the first
 * thousand and reported success. Removing the optional makes that read
 * UNREPRESENTABLE rather than merely bounded, which is `updateMapNode`'s idiom one
 * function up: it subtracts `parentId`/`trackId` from its own parameter type so
 * that reaching for one is a compile error instead of a key silently dropped. The
 * bulk read now has its own name and its own paging — `listNodeUseCasesFor` below.
 *
 * THIS PATH STAYS UNPAGED, deliberately. MapBranchDetail.tsx:65-74 argues that its
 * capability numbers are immune to PostgREST's 1,000-row clamp BY CONSTRUCTION —
 * one node's links are at most one row per capability — and that argument has to
 * stay true, not merely be believed: it is why the item count, which is not immune,
 * sits on the stats band under `track.statsPartial` instead. A `Loaded<T>` here
 * would suggest a doubt this read does not have.
 */
export async function listNodeUseCases(nodeId: string): Promise<ApiResult<MapNodeUseCase[]>> {
  if (!supabase) return notConfigured()
  const { data, error } = await supabase
    .from('map_node_use_cases')
    .select(LINK_COLUMNS)
    .eq('node_id', nodeId)
    .order('node_id', { ascending: true })
    .order('use_case_id', { ascending: true })
  if (error) return fail(pgErrorKey(error))
  return { ok: true, data: (data ?? []) as unknown as MapNodeUseCase[] }
}

/**
 * The links for a SET of nodes — the portfolio's read, and the one that had to be
 * built rather than reached for.
 *
 * CHUNKED, BECAUSE THE FILTER TRAVELS IN THE URL. 400 uuids in one `.in()` is a
 * ~15KB query string that a proxy rejects before Postgres ever sees it, so the ids
 * go in `ID_CHUNK`-sized pieces — `entries.ts:113-120`'s constant and its reasoning,
 * now in api/paging.ts where both callers can see it.
 *
 * EACH CHUNK IS PAGED AND THE VERDICTS ARE OR-ED. 150 organizations times ten
 * capabilities is 1,500 rows, which is already past the ceiling for one chunk — the
 * exact shape of failure that made this whole unit necessary, one level down. A
 * chunk that hit the cap truncates the WHOLE answer, because the caller is asking
 * one question ("the links for these nodes") and a partial answer to it is partial
 * however few of its pieces were clipped.
 *
 * NOT ON BOOT. At 400 × 10 this is ~4,000 rows and ~250KB; store/config.ts's header
 * draws the line and this side of it is data, not configuration. The portfolio
 * surface opens it deliberately (`src/store/portfolio.ts`, wave 3) and pays for it.
 *
 * An empty `nodeIds` resolves with an empty, untruncated answer and makes NO
 * request: `.in('node_id', [])` asks the server for nothing, and a round trip to be
 * told what the caller already knew is one the portfolio pays on every render where
 * the filter matched no organizations.
 */
export async function listNodeUseCasesFor(
  nodeIds: readonly string[],
): Promise<ApiResult<Loaded<MapNodeUseCase>>> {
  if (!supabase) return notConfigured()
  const client = supabase

  const rows: MapNodeUseCase[] = []
  let truncated = false
  for (const chunk of chunkIds(nodeIds)) {
    const result = await fetchAllPages<MapNodeUseCase>(
      (from, to) =>
        client
          .from('map_node_use_cases')
          .select(LINK_COLUMNS)
          .in('node_id', chunk)
          .order('node_id', { ascending: true })
          .order('use_case_id', { ascending: true })
          .range(from, to),
      MAX_PAGES,
    )
    // A failed chunk fails the read. Returning what the earlier chunks held with
    // `truncated: true` would be a different sentence on screen — "some rows are
    // missing because the workspace is big" — for what is actually an error, and
    // the two must not be told apart by whether the caller happened to look.
    if (!result.ok) return result
    rows.push(...result.data.rows)
    truncated = truncated || result.data.truncated
  }
  return { ok: true, data: { rows, truncated } }
}

/**
 * Record, change or clear one cell of the organization × capability matrix.
 *
 * `status === null` clears the link — a DELETE, because "not integrated" is the
 * absence of a row. DELETING A LINK THAT WAS NEVER THERE IS NOT AN ERROR and must
 * not be reported as one: the panel saves whatever changed since it opened, and a
 * checkbox a member ticked and then unticked has to be a no-op, not a red banner.
 * That paragraph is setTrackSla's, and it is here because this is the same decision
 * about the same kind of absence.
 *
 * Otherwise an upsert on the composite key, so no caller has to know whether this
 * organization already had a status for this capability. Resolves with the stored
 * row, or null when the link was cleared.
 *
 * The status vocabulary is enforced by the database (a CHECK on the column) and
 * surfaces as 23514 through pgErrorKey; the union in types.ts is the same three
 * words, and neither is a substitute for the other.
 */
export async function setNodeUseCase(
  nodeId: string,
  useCaseId: string,
  rung: UseCaseRung | null,
  scope: UseCaseScope = 'in_scope',
): Promise<ApiResult<MapNodeUseCase | null>> {
  if (!supabase) return notConfigured()

  if (rung === null) {
    const { error } = await supabase
      .from('map_node_use_cases')
      .delete()
      .eq('node_id', nodeId)
      .eq('use_case_id', useCaseId)
    if (error) return fail(pgErrorKey(error))
    return { ok: true, data: null }
  }

  const { data, error } = await supabase
    .from('map_node_use_cases')
    .upsert(
      // ⚠ `overrides: ['status']` IS THE HELD CONTRACT, AND IT IS WRITTEN HERE
      //   BECAUSE THIS IS THE ONLY PLACE A PERSON EDITS THIS CELL.
      //
      //   `overrides` is 0024's per-field editing contract: the column names the
      //   fields a HUMAN has changed since the last sync, and a future Jira
      //   write path must never overwrite one of them — `JiraEffect.held`
      //   (src/lib/jira/map.ts:196) is that promise rendered as a value on the
      //   preview screen. Until this line, nothing in the app ever wrote the
      //   column, so `held` would have counted 0 on every preview forever: a
      //   proud zero that means "we checked and found nothing" when it actually
      //   means "we have never recorded anything to find". The refusal has to be
      //   TRUE from the first run of a sync that does not exist yet, which is
      //   why it is stamped now and not with the writer.
      //
      //   THE SET FORM IS THE APPEND FORM TODAY, and that is a fact about the
      //   product rather than a shortcut: `status` is the only field of this row
      //   a person can edit, so the array is only ever `[]` or `['status']` and
      //   writing it whole is writing the union. THE DAY A SECOND FIELD BECOMES
      //   EDITABLE HERE, THIS LINE IS WRONG — it would drop the other entry —
      //   and the fix is a read-modify-write or a Postgres `array_agg` in an
      //   RPC, because PostgREST cannot union an array in an upsert. That is a
      //   sentence on the future writer's own ticket, not a TODO: the wave that
      //   adds the second editable field is the wave that must find this.
      //
      //   Nothing to do on the DELETE path above: clearing a cell removes the
      //   row, and a row that does not exist holds nothing.
      //
      // ⚠ BOTH COLUMNS, FROM ONE EXPRESSION, AND THIS IS THE WHOLE OF THE FIX.
      //
      //   `status` is `not null default 'live'` (0024:360). Send `rung` without
      //   it and a brand-new INTAKE cell lands as LIVE on the home screen, in
      //   the portfolio bar and in the PMO exception list — a false positive,
      //   which is strictly worse than the null it replaces. Send `status`
      //   without `rung` — which is what this line did until 0032 applied — and
      //   the estate splits into backfilled rows that have a rung and app-written
      //   rows that do not, while the stamp trigger records an event reading
      //   "moved to nowhere".
      //
      //   Neither is representable here: the two keys are spread from a SINGLE
      //   call to `statusForRung`, so an edit cannot move one without moving the
      //   other. `statusForRung` is lossy on purpose and has no inverse — see
      //   lib/mapNodes.ts. The pair dies together the day `status` is dropped.
      {
        node_id: nodeId,
        use_case_id: useCaseId,
        rung,
        status: statusForRung(rung),
        scope,
        // ⚠ `overrides` NOW NAMES EVERY FIELD THIS WRITE TOUCHES. The paragraph
        //   above said in capitals that the whole-array form "is wrong the day a
        //   second field becomes editable here" — 0032 made `rung` and `scope`
        //   that second and third field. This is still a whole-array write and
        //   therefore still the union only because these three are the only
        //   editable fields today; the moment a fourth arrives on a DIFFERENT
        //   screen, two screens will start dropping each other's entries and the
        //   fix is the trigger, not a longer literal. `status` is not listed: a
        //   person edits a rung and the older column follows.
        overrides: ['rung', 'scope'],
      },
      { onConflict: 'node_id,use_case_id' },
    )
    // The same LINK_COLUMNS the reads ask for, so the row this hands back is the
    // row a reload would show — including `source`, which the database defaults
    // and this function never sends, and `overrides`, which it now does.
    .select(LINK_COLUMNS)
    .single()
  if (error) return fail(pgErrorKey(error))
  return { ok: true, data: data as unknown as MapNodeUseCase }
}

// ── the stage ladder, and where each node got to (0026) ─────────────────────
//
// TWO TABLES WITH OPPOSITE PERMISSIONS, and the split is the whole reason 0026
// put the stage in a side table instead of a column on `map_nodes`:
//
//   `map_node_stages`   — the LADDER. structure.edit-write, audited. Renaming a
//                         rung restates what every portfolio count MEANS.
//   `map_node_progress` — where ONE node got to. MEMBER-write, not audited. The
//                         three account managers record it, and gating it on
//                         structure.edit would make the two senior experts the
//                         data-entry bottleneck for the data their team collects.
//
// ⚠ EVERY READ HERE MUST FAIL CLOSED AND QUIET UNTIL 0026 IS APPLIED. Both
//   tables are absent from the live database as this ships, so both reads answer
//   42P01/PGRST205 on every load. That is a SUPPORTED state, not a fault:
//   store/config.ts's settle() keeps the previous (empty) rows and logs, exactly
//   as store/auth.ts's loadPermissions does for a workspace that predates 0025,
//   and every screen renders "no stages configured yet" rather than an error.
//   Nothing in this section may throw, toast, or latch.
//
// SERVER-OWNED COLUMNS ARE NEVER SENT. On progress that is `stage_changed_at`,
// `updated_at` and `updated_by`; on stages it is `updated_at`, `created_at` and
// `created_by` on the update path. 0026's stamp trigger OVERRULES a client value
// rather than rejecting it, so sending one reads as working and is not — which
// is the failure mode this rule exists for.

/**
 * The columns every progress read asks for, by name.
 *
 * NAMED RATHER THAN `*`, LINK_COLUMNS' precedent one table over: `MapNodeProgress`
 * cannot then drift from the query when the table gains a column, and a rename on
 * the SQL side surfaces as a failed read rather than as a field that is silently
 * `undefined` in a panel.
 */
const PROGRESS_COLUMNS = 'node_id, stage_id, stage_changed_at, updated_at, updated_by'

/**
 * Every rung of the ladder, ordered for display. HIDDEN ONES INCLUDED, ALWAYS.
 *
 * NO `includeHidden` PARAMETER, and that is the difference from `listUseCases`
 * rather than an omission. This list is read ONCE on boot into store/config.ts and
 * serves two readers with opposite needs — the admin screen, which has to see a
 * hidden rung in order to restore it, and every picker, which must not offer one.
 * A parameter would make the store choose for both; the store instead holds the
 * whole ladder and derives the visible slice, which is `useCases` /
 * `visibleUseCases`' shape and its reason: one read, two answers, no way for them
 * to disagree.
 *
 * PAGED for listMapNodeKinds' reason, on a table that holds seven rows: "small
 * enough that there is no paging question" is a judgement about today's data
 * written into a function that outlives it. `id` joins the sort keys because
 * `.range()` needs a total order — `(sort_order, name)` is not unique here either,
 * since `sort_order` defaults to 0 and the reorder RPC only rewrites the ids it
 * was handed.
 */
export async function listMapNodeStages(): Promise<ApiResult<Loaded<MapNodeStage>>> {
  if (!supabase) return notConfigured()
  const client = supabase
  return await fetchAllPages<MapNodeStage>(
    (from, to) =>
      client
        .from('map_node_stages')
        .select('*')
        .order('sort_order', { ascending: true })
        .order('name', { ascending: true })
        .order('id', { ascending: true })
        .range(from, to),
    MAX_PAGES,
  )
}

/**
 * Add a rung to the ladder.
 *
 * The three flags and the threshold are sent EXPLICITLY rather than left to the
 * column defaults, for createTrack's reason: this function sends the whole row it
 * means, and a default is the same answer silently, only for as long as the
 * default stays put. `expected_days` defaults to null — the seed sets it on no
 * row, and a threshold nobody chose is a number the app would then chase people
 * with (0003's SLA-off reasoning).
 */
export async function createMapNodeStage(
  input: MapNodeStageInput,
): Promise<ApiResult<MapNodeStage>> {
  if (!supabase) return notConfigured()
  const name = input.name.trim()
  if (!name) return fail('common.error')

  const userId = await currentUserId()
  if (!userId) return fail('common.notSignedIn')

  const { data, error } = await supabase
    .from('map_node_stages')
    .insert({
      name,
      name_ar: input.nameAr.trim(),
      hidden: input.hidden ?? false,
      terminal: input.terminal ?? false,
      paused: input.paused ?? false,
      expected_days: input.expectedDays ?? null,
      sort_order: await nextSortOrder('map_node_stages'),
      created_by: userId,
    })
    .select('*')
    .single()
  if (error) return fail(pgErrorKey(error))
  return { ok: true, data: data as MapNodeStage }
}

/**
 * Patch a rung. Undefined keys are left untouched, exactly like updateTrack.
 *
 * `expectedDays: null` IS A REAL INSTRUCTION — "this rung has no expectation" —
 * and it is not the same as leaving the key off, which means "do not touch it".
 * The `!== undefined` test is what keeps those two apart; a truthiness test would
 * silently turn every clearing into a no-op AND would swallow the two legitimate
 * `false`s beside it. That is updateMapNode's `kind_id` lesson word for word, with
 * one more way to get it wrong because three of these four fields are booleans.
 *
 * `updated_at`, `created_at` and `created_by` are NEVER in the row: they are
 * server-owned, and 0026's touch trigger pins `updated_at` back on a no-op
 * precisely so a store that PATCHes the whole row it read cannot corrupt it.
 * Sending them anyway would be a write nobody made showing up in the audit trail.
 */
export async function updateMapNodeStage(
  id: string,
  input: Partial<MapNodeStageInput>,
): Promise<ApiResult<MapNodeStage>> {
  if (!supabase) return notConfigured()

  const row: Record<string, unknown> = {}
  if (input.name !== undefined) row.name = input.name.trim()
  if (input.nameAr !== undefined) row.name_ar = input.nameAr.trim()
  if (input.hidden !== undefined) row.hidden = input.hidden
  if (input.terminal !== undefined) row.terminal = input.terminal
  if (input.paused !== undefined) row.paused = input.paused
  if (input.expectedDays !== undefined) row.expected_days = input.expectedDays

  // A no-op PATCH returns zero rows and .single() errors on a request that did
  // nothing wrong — updateTrack's reasoning, verbatim.
  if (Object.keys(row).length === 0) {
    const { data, error } = await supabase.from('map_node_stages').select('*').eq('id', id).single()
    if (error) return fail(pgErrorKey(error))
    return { ok: true, data: data as MapNodeStage }
  }

  const { data, error } = await supabase
    .from('map_node_stages')
    .update(row)
    .eq('id', id)
    .select('*')
    .single()
  if (error) return fail(pgErrorKey(error))
  return { ok: true, data: data as MapNodeStage }
}

/**
 * Retire a rung from the pickers, or bring it back.
 *
 * ITS OWN FUNCTION even though `hidden` is patchable through
 * `updateMapNodeStage`, for setMapNodeArchived's reason one table over: hiding is
 * an operation with its own confirmation and its own sentence ("the organizations
 * standing on this rung keep standing on it"), and routing it through the rename
 * form's patch would make the two indistinguishable at the call site.
 *
 * IT TAKES A BOOLEAN BECAUSE IT IS A TOGGLE. The restore direction is the reason
 * `listMapNodeStages` has no `includeHidden` parameter — the admin cannot bring a
 * rung back it cannot see.
 */
export async function setMapNodeStageHidden(
  id: string,
  hidden: boolean,
): Promise<ApiResult<MapNodeStage>> {
  if (!supabase) return notConfigured()
  const { data, error } = await supabase
    .from('map_node_stages')
    .update({ hidden })
    .eq('id', id)
    .select('*')
    .single()
  if (error) return fail(pgErrorKey(error))
  return { ok: true, data: data as MapNodeStage }
}

/**
 * Rewrite `sort_order` across the ladder, in array order, returning how many rungs
 * moved.
 *
 * THE ARGUMENT NAME IS THE CONTRACT. PostgREST resolves a function from the JSON
 * body's KEYS, so `p_ids` is not a label — a drifted name is a 404 the first time
 * somebody drags a rung, months after both halves were reviewed and found correct
 * on their own. 0026's probe 1 reads `proargnames` and fails the migration if it
 * is not exactly this.
 *
 * ⚠ REORDERING THE LADDER RESTATES EVERY COUNT-FORM GOAL, and the screen has to
 *   say so BEFORE the drag is committed. A goal reading "40 organizations at
 *   Go-live ready or beyond by 31 December" is evaluated as `sort_order >= that
 *   rung's sort_order`, so dragging one rung past another changes which
 *   organizations count towards commitments nobody edited, retroactively, with no
 *   audit row against any goal. This function cannot detect that afterwards and
 *   must not be the place it is discovered.
 *
 * An empty list makes NO request, `reorderMapNodeKinds`' rule: a drag that moved
 * nothing is not a round trip.
 */
export async function reorderMapNodeStages(ids: string[]): Promise<ApiResult<number>> {
  if (!supabase) return notConfigured()
  if (ids.length === 0) return { ok: true, data: 0 }
  const { data, error } = await supabase.rpc('reorder_map_node_stages', { p_ids: ids })
  if (error) return fail(pgErrorKey(error))
  return { ok: true, data: typeof data === 'number' ? data : ids.length }
}

/**
 * What deleting a rung would cost — BOTH NUMBERS, BEFORE THE CLICK.
 *
 * getMapNodeUsage's shape and its reasoning: head-only counts the UI can read
 * while the confirmation is still open, reusing the existing select policies
 * rather than adding a function.
 *
 * ⚠ NEITHER COUNT BLOCKS THE DELETE, WHICH IS WHY BOTH HAVE TO BE SAID IN
 *   ADVANCE. `map_node_progress.stage_id` and `map_node_goals.stage_id` are both
 *   `on delete set null`: deleting "Testing/UAT" un-stages the twelve
 *   organizations standing on it and blanks the rung out of the goals that named
 *   it, and nothing raises. That is the opposite of `deleteUseCase`, where an
 *   `on delete restrict` refuses on the admin's behalf. Here the only guard is
 *   the sentence, and `hidden` is the operation almost always wanted instead.
 *
 * `goals` reads a table 0027 creates. On a database with 0026 but not 0027 the
 * request fails, `countReferencing` warns to the console and answers 0 — which is
 * the true answer (no goals exist) rather than a swallowed error.
 */
export async function getMapNodeStageUsage(id: string): Promise<ApiResult<MapNodeStageUsage>> {
  if (!supabase) return notConfigured()
  const [progress, goals] = await Promise.all([
    countReferencing('map_node_progress', 'stage_id', id),
    countReferencing('map_node_goals', 'stage_id', id),
  ])
  return { ok: true, data: { progress, goals } }
}

/**
 * Delete a rung. Resolves with what was pointing at it a moment BEFORE the delete,
 * because that is what the caller wants to report and it does not exist afterwards
 * — deleteMapNode's contract.
 *
 * There is no guard trigger to refuse this and no reassignment parameter to offer:
 * both referencing columns are `on delete set null`, so the organizations survive
 * un-staged, which is the state every un-started organization is in anyway.
 */
export async function deleteMapNodeStage(id: string): Promise<ApiResult<MapNodeStageUsage>> {
  if (!supabase) return notConfigured()

  const before = await getMapNodeStageUsage(id)
  const usage: MapNodeStageUsage = before.ok ? before.data : { progress: 0, goals: 0 }

  const { error } = await supabase.from('map_node_stages').delete().eq('id', id)
  if (error) return fail(pgErrorKey(error))
  return { ok: true, data: usage }
}

/**
 * Where every node has got to — one row per node AT MOST, and far fewer than
 * there are nodes.
 *
 * ON THE BOOT PATH, unlike `map_node_use_cases`, and the asymmetry is a fact about
 * the data rather than a preference. The links are one row per (organization ×
 * capability) — 4,000 rows at 400 organizations — and nobody looks at them until a
 * panel opens. This is one row per organization at most, it is what draws the
 * portfolio and every stage roll-up on the map itself, and 400 rows of five
 * columns is smaller than the node list that is already fetched beside it.
 *
 * PAGED, and ordered by `node_id` alone because `node_id` IS the primary key: the
 * order is already total, so `.range()` cannot drop or duplicate a row.
 *
 * ⚠ FEWER ROWS THAN NODES IS THE ORDINARY STATE, not a partial read. 0026 ships no
 *   backfill on purpose, so on the day it applies this answers with ZERO rows
 *   against 400 organizations — "nobody has said anything yet", which is the first
 *   number the directors ask for and a number that only exists while "no row" and
 *   "the Not started rung" stay distinct. A reader that treats a missing row as an
 *   error, or fills it in with a default, destroys it.
 */
export async function listMapNodeProgress(): Promise<ApiResult<Loaded<MapNodeProgress>>> {
  if (!supabase) return notConfigured()
  const client = supabase
  return await fetchAllPages<MapNodeProgress>(
    (from, to) =>
      client
        .from('map_node_progress')
        .select(PROGRESS_COLUMNS)
        .order('node_id', { ascending: true })
        .range(from, to),
    MAX_PAGES,
  )
}

/**
 * Record where one node has got to.
 *
 * ⚠ AN UPSERT ON `node_id`, NEVER AN INSERT, AND THIS IS THE ONE LINE IN THE UNIT
 *   THAT HAS TO BE RIGHT. `node_id` is the primary key, so a plain insert against
 *   an organization that already has a progress row raises 23505 naming
 *   `map_node_progress_pkey` — and the case is not exotic, it is TWO ACCOUNT
 *   MANAGERS ON THE PORTFOLIO AT ONCE with the second one's 30-second refetch not
 *   yet landed. The upsert path is a complete no-op when nothing changed
 *   (PostgREST's `do update set` fires the BEFORE UPDATE arm, where the stamp's
 *   `is distinct from` guard and the touch's else arm both hold, and 0026's probe
 *   4 asserts the row comes back byte-identical). pgError.ts still carries an arm
 *   for the 23505, for the tab that got here some other way.
 *
 * `stageId: null` STILL UPSERTS THE ROW — it does not delete it, and the two are
 * different facts the whole feature rests on: no row means "nobody has said
 * anything yet", `stage_id null` means "somebody looked and cleared it". The
 * stamp trigger nulls `stage_changed_at` on the same statement, which is what
 * keeps `map_node_progress_stage_chk` true. Returning a node to "nobody has said"
 * is a DELETE, and it is deliberately not this function.
 *
 * `stage_changed_at`, `updated_at` and `updated_by` ARE NOT SENT. All three are
 * server-written and a client value is OVERRULED rather than rejected — the
 * failure that reads as working — so the row this hands back is the row a reload
 * would show, including the stamp this call never named.
 */
/* ── the three things that come before ADT (0033) ──────────────────────────
 *
 * `map_node_readiness` — Patient Registry, Provider Portal and SSO — is ONE SET
 * PER HOSPITAL and not one per use case: registering with the patient registry
 * is something an organization does once, not something it does again for Lab
 * Order. That is why it is a side table keyed on `node_id` and not four more
 * columns on `map_node_use_cases`.
 *
 * ⚠ AND THE ABSENCE OF A ROW IS "NOBODY HAS SAID", NOT `not_started`. The table
 *   is empty today, so every organization is in that state. The column defaults
 *   describe a row a person has created; they do not describe a row that does
 *   not exist. A screen that rendered the missing row as three unticked boxes
 *   would be printing a measurement nobody took — `map_node_progress`' own
 *   three-state argument, one table over.
 */

/** Every readiness row. One per organization at most, so it is small. */
export async function listReadiness(): Promise<ApiResult<Loaded<NodeReadiness>>> {
  if (!supabase) return notConfigured()
  const client = supabase
  return await fetchAllPages<NodeReadiness>(
    (from, to) =>
      client
        .from('map_node_readiness')
        .select('node_id, patient_registry, provider_portal, sso, updated_at, updated_by')
        .order('node_id', { ascending: true })
        .range(from, to),
    MAX_PAGES,
  )
}

/**
 * Record what an organization has ready.
 *
 * ⚠ AN UPSERT THAT CREATES THE ROW IS A PERSON SAYING SOMETHING, which is the
 *   whole point: until this is called there is no row, and no row means nobody
 *   has said. So the caller must send the WHOLE set rather than one field — a
 *   partial upsert on a missing row would take the column defaults for the other
 *   two and assert, on a person's behalf, that they are not started.
 */
export async function setReadiness(
  nodeId: string,
  input: { patientRegistry: boolean; providerPortal: boolean; sso: SsoState },
): Promise<ApiResult<NodeReadiness>> {
  if (!supabase) return notConfigured()
  const { data, error } = await supabase
    .from('map_node_readiness')
    .upsert(
      {
        node_id: nodeId,
        patient_registry: input.patientRegistry,
        provider_portal: input.providerPortal,
        sso: input.sso,
      },
      { onConflict: 'node_id' },
    )
    .select('node_id, patient_registry, provider_portal, sso, updated_at, updated_by')
    .single()
  if (error) return fail(pgErrorKey(error))
  return { ok: true, data: data as unknown as NodeReadiness }
}

export async function setNodeStage(
  nodeId: string,
  stageId: string | null,
): Promise<ApiResult<MapNodeProgress>> {
  if (!supabase) return notConfigured()
  const { data, error } = await supabase
    .from('map_node_progress')
    .upsert({ node_id: nodeId, stage_id: stageId }, { onConflict: 'node_id' })
    .select(PROGRESS_COLUMNS)
    .single()
  if (error) return fail(pgErrorKey(error))
  return { ok: true, data: data as unknown as MapNodeProgress }
}

/**
 * Return one node to "NOBODY HAS SAID" — the third state, and the only verb that
 * can reach it.
 *
 * ⚠ THIS IS THE ONE `setNodeStage` REFUSES TO BE, and the refusal above is what
 *   makes this function necessary rather than redundant. The table carries three
 *   facts, not two:
 *
 *     no row                  nobody has said anything about this organization.
 *                             Renders as an em-dash, counts into the `unstaged`
 *                             bucket, and has no clock — `stage_changed_at`
 *                             does not exist, so time-in-stage is unanswerable
 *                             rather than zero.
 *     row, `stage_id` null    somebody looked and CLEARED it. A person, a time
 *                             and an author; the clock was stopped by hand.
 *     row, a `stage_id`       where it got to.
 *
 *   0026 ships no backfill precisely so the first of those survives day one
 *   (`listMapNodeProgress`'s own ⚠ says it), and an UNDO that cannot restore it
 *   is an undo that quietly moves an organization from "never touched" to
 *   "touched and cleared" — a fact nobody stated, written by a button labelled
 *   "undo". So the portfolio's undo calls THIS when the row it is undoing did
 *   not exist a moment ago, and `setNodeStage(id, null)` when it did.
 *
 * DELETING A ROW THAT IS NOT THERE IS SUCCESS, not a 404: PostgREST answers a
 * `delete` matching zero rows with 204 and no error, which is the right answer
 * for an undo racing a second tab's own undo. Both readers end at the same
 * state, and only one of them wrote it.
 *
 * NO `select()`. There is no row to hand back — that is the whole point — so the
 * caller republishes by RETRACTING rather than by publishing, which is why this
 * returns `void` where `setNodeStage` returns the stored row.
 *
 * The 0026 cascade (`node_id references map_nodes on delete cascade`) already
 * removes the row when the organization goes; this is the same deletion asked
 * for deliberately, and the RLS policy is the same member-write one — a delete
 * here is fieldwork being taken back, not configuration being changed.
 */
export async function deleteNodeProgress(nodeId: string): Promise<ApiResult<void>> {
  if (!supabase) return notConfigured()
  const { error } = await supabase.from('map_node_progress').delete().eq('node_id', nodeId)
  if (error) return fail(pgErrorKey(error))
  return { ok: true, data: undefined }
}

/**
 * The per-node open counts — `v_map_node_open_counts` (0027), and the first read
 * in this file that answers with FACTS rather than with rows to fold.
 *
 * ⚠ THE VIEW DOES NOT EXIST UNTIL 0027 IS APPLIED BY HAND, so this answers
 *   PGRST205 (`common.errMissingTable`) on every call until Aziz's sitting.
 *   store/portfolio.ts treats that as "no counts yet" and renders nothing —
 *   never an error — because on that side of the sitting nothing is wrong.
 *
 * NOT ON BOOT, for `listNodeUseCasesFor`'s reason one level up: the portfolio
 * surface opens it deliberately. It is cheap (one row per node) but it is the
 * same KIND of fact, and store/config.ts's header draws the line at data.
 *
 * PAGED and ordered by `node_id`, which is unique in this view by construction
 * (`group by n.id`), so `.range()` can neither drop nor duplicate a row.
 *
 * SELECTED BY NAME so `MapNodeOpenCounts` cannot drift from the view — 0027's
 * probe 1 asserts the same five column names from the other side, because a
 * rename here is a silent `undefined` in a panel rather than an error.
 */
export async function listMapNodeOpenCounts(): Promise<ApiResult<Loaded<MapNodeOpenCounts>>> {
  if (!supabase) return notConfigured()
  const client = supabase
  return await fetchAllPages<MapNodeOpenCounts>(
    (from, to) =>
      client
        .from('v_map_node_open_counts')
        .select('node_id, open, overdue, breached, unassigned')
        .order('node_id', { ascending: true })
        .range(from, to),
    MAX_PAGES,
  )
}
