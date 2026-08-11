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
import { pgErrorKey } from '../lib/pgError'
import type {
  MapNode,
  MapNodeInput,
  MapNodeKind,
  MapNodeKindInput,
  MapNodeMoveResult,
  MapNodeUsage,
  MapNodeUseCase,
  UseCase,
  UseCaseInput,
  UseCaseStatus,
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
 * Every node, ordered for display. Archived nodes are hidden unless asked for.
 *
 * ONE FLAT READ, not a recursive walk: the tree is assembled client-side by
 * store/config.ts, which buckets by `parent_id` once when the data lands. A depth-
 * first server query would cost one round trip per level and would still have to be
 * re-bucketed here, because the map draws children in sibling order and a recursive
 * CTE returns them in traversal order.
 *
 * The second sort key is `name` for listTracks' reason: `sort_order` defaults to 0
 * and the reorder RPC only rewrites the ids it was handed, so without a stable tie
 * break two loads of the same data render in different orders — which reads as data
 * loss, not as a sort.
 */
export async function listMapNodes(includeArchived = false): Promise<ApiResult<MapNode[]>> {
  if (!supabase) return notConfigured()
  let query = supabase
    .from('map_nodes')
    .select('*')
    .order('sort_order', { ascending: true })
    .order('name', { ascending: true })
  if (!includeArchived) query = query.eq('archived', false)
  const { data, error } = await query
  if (error) return fail(pgErrorKey(error))
  return { ok: true, data: (data ?? []) as MapNode[] }
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

/** Every kind, ordered for display. Small enough that there is no paging question. */
export async function listMapNodeKinds(): Promise<ApiResult<MapNodeKind[]>> {
  if (!supabase) return notConfigured()
  const { data, error } = await supabase
    .from('map_node_kinds')
    .select('*')
    .order('sort_order', { ascending: true })
    .order('name', { ascending: true })
  if (error) return fail(pgErrorKey(error))
  return { ok: true, data: (data ?? []) as MapNodeKind[] }
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
 */
export async function listUseCases(includeHidden = false): Promise<ApiResult<UseCase[]>> {
  if (!supabase) return notConfigured()
  let query = supabase
    .from('use_cases')
    .select('*')
    .order('sort_order', { ascending: true })
    .order('name', { ascending: true })
  if (!includeHidden) query = query.eq('hidden', false)
  const { data, error } = await query
  if (error) return fail(pgErrorKey(error))
  return { ok: true, data: (data ?? []) as UseCase[] }
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
// AN ABSENT ROW MEANS "NOT INTEGRATED". There is no sentinel status and no zero: the
// two states a (node, use case) cell can be in are "a row with a status" and "no
// row". That is exactly `track_slas`' shape, chosen here for exactly its reason, and
// it is why setNodeUseCase takes `status: UseCaseStatus | null` and DELETES on null
// rather than writing something that means nothing.

/**
 * Every link, or just one node's. Ordered so two loads of the same data render in
 * the same order — the pair is the primary key, so the ordering is total and stable.
 *
 * FETCH-ON-OPEN, NOT STORED. store/config.ts holds the tree and the catalogue
 * because nothing renders a node without them; it deliberately does not hold this,
 * because forty organizations times ten capabilities is four hundred rows that
 * nobody looks at until a panel is open, and a cache of them would have to be
 * invalidated by every tick of a checkbox on every other client.
 *
 * The columns are named rather than `*`, so `MapNodeUseCase` cannot drift from the
 * query when the table gains an audit column — `listTrackSlas`' precedent.
 */
export async function listNodeUseCases(nodeId?: string): Promise<ApiResult<MapNodeUseCase[]>> {
  if (!supabase) return notConfigured()
  let query = supabase
    .from('map_node_use_cases')
    .select('node_id, use_case_id, status')
    .order('node_id', { ascending: true })
    .order('use_case_id', { ascending: true })
  if (nodeId !== undefined) query = query.eq('node_id', nodeId)
  const { data, error } = await query
  if (error) return fail(pgErrorKey(error))
  return { ok: true, data: (data ?? []) as MapNodeUseCase[] }
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
  status: UseCaseStatus | null,
): Promise<ApiResult<MapNodeUseCase | null>> {
  if (!supabase) return notConfigured()

  if (status === null) {
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
      { node_id: nodeId, use_case_id: useCaseId, status },
      { onConflict: 'node_id,use_case_id' },
    )
    .select('node_id, use_case_id, status')
    .single()
  if (error) return fail(pgErrorKey(error))
  return { ok: true, data: data as MapNodeUseCase }
}
