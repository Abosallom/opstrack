// Postgres failures → i18n KEYS.
//
// Why this exists: entries.ts returns `error.message` verbatim, which drops an
// English sentence like `duplicate key value violates unique constraint
// "tracks_name_uidx"` into a fully-Arabic RTL layout. Worse, the useful part of
// that sentence is a constraint identifier the user has never heard of.
//
// So the mapping happens here, at the boundary, and callers get a key to pass
// through t(). The raw message still reaches console.warn — an unmapped failure
// has to stay debuggable, it just must not be rendered.
//
// The identifiers matched below are the contract with
// supabase/migrations/0002_config_foundation.sql, 0003_vocab_options.sql,
// 0018_track_groups.sql, 0023/0024 for the map hierarchy, and 0026/0027 for the
// stage ladder, the progress row and the goals. Renaming an index or a trigger's
// error token there silently demotes a precise message to 'common.error', so keep
// the files in step. 0003 says so in a comment above the raise, which is the
// other half of this handshake; 0026's and 0027's headers carry the same list and
// docs/MIGRATIONS-0026-0027.md §5–6 is the checklist both sides were built from.
//
// ⚠ THE 0026/0027 ARMS ARE LIVE BEFORE THE TABLES ARE. Neither migration has been
//   applied, so every one of those names is currently unreachable — which is
//   deliberate and is the order the runbook requires: the client arms land FIRST,
//   because a rename discovered after the SQL is running is a precise sentence
//   silently demoted, with nothing failing to say so.

/** The subset of a PostgrestError / PostgREST body this module reads. */
interface PgLike {
  code?: unknown
  message?: unknown
  details?: unknown
  hint?: unknown
}

/**
 * Everything textual the error carries, lowercased and concatenated.
 *
 * Which field holds the constraint name depends on how the failure surfaced:
 * PostgREST puts a unique-violation index in `details`, while a trigger's
 * `raise ... using errcode` puts its marker token in `message`. Searching the
 * whole blob avoids caring which.
 */
function haystack(e: PgLike): string {
  const parts = [e.message, e.details, e.hint]
  return parts
    .filter((p): p is string => typeof p === 'string')
    .join(' ')
    .toLowerCase()
}

function codeOf(e: PgLike): string {
  return typeof e.code === 'string' ? e.code : ''
}

/**
 * The four invariants the map hierarchy owns (0023), matched by TOKEN ALONE.
 *
 * THE ONE MAPPING IN THIS FILE THAT IGNORES THE SQLSTATE, and the exception is
 * argued rather than assumed. Everything else here is raised at one place with one
 * `using errcode`, so keying on the code is free and is what stops a short token
 * matching a sentence that merely contains it. These four are raised from six places
 * between them — the insert trigger, the deferred tree check, the reorder RPC and
 * three arms of the move RPC — about the same four facts, refused at whichever
 * moment catches them first. Across this wave 0023 has spelled them `23514`, `22023`
 * and `23502` at different times, which is exactly the churn that turns a precise
 * sentence into the generic one with nothing failing to say so. The reader's next
 * action does not depend on which statement objected, so neither does the mapping.
 *
 * EACH ARM MATCHES TWO TOKEN VOCABULARIES, and that is observation rather than
 * defensiveness: 0023 was rewritten mid-wave and has raised BOTH
 * `map_node_too_deep` and `map_node_depth` for the identical fact, both
 * `map_node_cross_track` and `map_node_track_mismatch`, both `map_node_scope` and
 * the `no_track`/`reorder_*` trio. Matching the pair costs one `||` and is checkable
 * against the migration in either state; matching one of them is a coin flip whose
 * losing side is silent. When the migration settles, deleting the spellings it does
 * not use is a two-minute edit with a grep behind it.
 *
 * The tokens are long, underscored, and unique to this schema: nothing else in
 * Postgres or in these migrations says `map_node_cycle`. None of the pairs is a
 * substring of another, so the order of the tests carries no meaning.
 *
 * Returns null when the text belongs to something else, so the caller falls through
 * to the code-keyed switch.
 */
function mapNodeInvariantKey(text: string): string | null {
  // A node under one of its own descendants — the deferred check sees the whole
  // statement, so a subtree move that would close a loop is rejected as one thing
  // rather than half-applied and then noticed. `move_into_self` is the degenerate
  // case, refused up front; one key, because it is one mistake.
  if (text.includes('map_node_cycle') || text.includes('map_node_move_into_self')) {
    return 'mapadmin.errCycle'
  }
  // The depth cap. Mandatory rather than a preference: radial area grows
  // quadratically with depth, so an uncapped tree is a map that cannot be drawn.
  if (text.includes('map_node_too_deep') || text.includes('map_node_depth')) {
    return 'mapadmin.errTooDeep'
  }
  // `track_id` disagreeing with an ancestor's, in either direction. Derived, never
  // asserted — this fires when a writer asserted it anyway, or when a move would
  // split a subtree across two tracks.
  if (text.includes('map_node_cross_track') || text.includes('map_node_track_mismatch')) {
    return 'mapadmin.errCrossTrack'
  }
  // "You did not say WHERE." A root node naming no track, a reorder naming no
  // track, and a reorder holding an id from another branch are one mistake to the
  // reader: the operation was aimed at a scope it does not describe, and the fix is
  // to reload the screen and repeat it against what is actually there.
  if (
    text.includes('map_node_scope') ||
    text.includes('map_node_no_track') ||
    text.includes('map_node_reorder_scope') ||
    text.includes('map_node_reorder_foreign')
  ) {
    return 'mapadmin.errScope'
  }
  return null
}

export function pgErrorKey(error: unknown): string {
  if (typeof error !== 'object' || error === null) return 'common.error'
  const e = error as PgLike
  const code = codeOf(e)
  const text = haystack(e)

  // Before the switch, because these four are the only failures here whose SQLSTATE
  // is an implementation detail rather than a contract — see mapNodeInvariantKey().
  const mapInvariant = mapNodeInvariantKey(text)
  if (mapInvariant) return mapInvariant

  switch (code) {
    case '23505':
      // Each pair reads `_ar_` first, matching the tracks pair that was here
      // already. Neither name contains the other, so this is house order rather
      // than a correctness requirement — but keeping all three pairs written the
      // same way is what makes a fourth pair obviously right or obviously wrong.
      if (text.includes('tracks_name_ar_uidx')) return 'admin.tracks.errNameArTaken'
      if (text.includes('tracks_name_uidx')) return 'admin.tracks.errNameTaken'
      // track_groups (0018). These two were UNMAPPED until now, and a duplicate
      // group name fell through to the generic key — recorded as debt in the header
      // of api/tracks.ts's groups section, which could not fix it because it does
      // not own this file. Both sentences already exist in both locale trees.
      if (text.includes('track_groups_name_ar_uidx')) return 'groups.errNameArTaken'
      if (text.includes('track_groups_name_uidx')) return 'groups.errNameTaken'
      // map_nodes (0023). SIBLING-scoped, not global: two organizations called
      // "Emergency" under two different phases are two real things, and a
      // workspace-wide unique name would be a rule about the tree that the tree
      // does not have. The sentence has to say "under the same parent" or the admin
      // goes looking for a duplicate that is three rings away.
      //
      // The base index also fires on a path that has nothing to do with typing a
      // name: 0023's delete_track() reassigns a deleted track's nodes, so
      // reassigning a track whose root ring holds "OB" onto a track that already has
      // an "OB" lands here. The sentence must therefore not assume the admin was
      // renaming something.
      if (text.includes('map_nodes_sibling_name_ar_uidx')) return 'mapadmin.errNameArTaken'
      if (text.includes('map_nodes_sibling_name_uidx')) return 'mapadmin.errNameTaken'
      // map_node_kinds (0023) — Programme, Phase, Organization.
      if (text.includes('map_node_kinds_name_ar_uidx')) return 'mapadmin.errKindNameArTaken'
      if (text.includes('map_node_kinds_name_uidx')) return 'mapadmin.errKindNameTaken'
      // use_cases (0024). GLOBAL, unlike the node names above: the catalogue is one
      // flat list every organization is scored against, so two rows called "ADT"
      // would make "6 of 9 live" a number nobody can reconcile.
      if (text.includes('use_cases_name_ar_uidx')) return 'mapadmin.errUseCaseNameArTaken'
      if (text.includes('use_cases_name_uidx')) return 'mapadmin.errUseCaseNameTaken'
      // map_node_stages (0026) — the onboarding ladder. GLOBAL like the catalogue
      // above and unlike the sibling-scoped node names: there is exactly ONE
      // ladder, and two rungs called "Live" would make every portfolio count
      // unreconcilable. Case-insensitive and btrim'd on the SQL side, so the
      // sentence must not promise that a different capitalisation would work.
      //
      // ⚠ THE ARABIC ARM MUST STAY FIRST even though neither name contains the
      //   other, because `map_node_stages_name_ar_uidx` is PARTIAL (0026 seeds
      //   name_ar blank on all seven rungs, so a non-partial index would reject
      //   the second untranslated rung) — which means it fires only for rungs
      //   that HAVE Arabic names, and pointing that reader at the English field
      //   would send them to a box that is fine.
      if (text.includes('map_node_stages_name_ar_uidx')) return 'mapadmin.errStageNameArTaken'
      if (text.includes('map_node_stages_name_uidx')) return 'mapadmin.errStageNameTaken'
      // map_node_progress (0026), and THE ONE AN ACCOUNT MANAGER IS LIKELIEST TO
      // MEET. `node_id` is the primary key, so a plain INSERT against an
      // organization that already has a progress row raises 23505 naming this —
      // two AMs on the portfolio at once, the second one's 30-second refetch not
      // yet landed. api/map.ts's setNodeStage upserts on `node_id`, which makes
      // this unreachable through the app; the arm exists for the tab that got
      // there some other way, because the stage picker's optimistic write with an
      // undo toast degrades to an unexplained failure otherwise.
      if (text.includes('map_node_progress_pkey')) return 'mapadmin.errStageAlreadyRecorded'
      // jira_settings (0028) holds ONE row, and the primary key is one of the two
      // things that says so. Unreachable through the app — api/jiraSettings.ts
      // upserts on the singleton id — so this is the sentence for a second row
      // arriving some other way, and it is deliberately the SAME sentence the
      // CHECK gets below: "there is one Jira configuration and something tried to
      // write a second" is one fact, and which half caught it is not the reader's
      // problem.
      if (text.includes('jira_settings_pkey')) return 'jiraconfig.errSingleton'
      break
    case '23503':
      // Raised by tracks_block_delete_when_referenced(), which counts the
      // entries/meetings/templates still pointing at the track. The UI answers
      // this by offering the reassign step rather than repeating the counts.
      if (text.includes('track_in_use')) return 'admin.tracks.errInUse'
      // The same guard one level down (0023): a node still has children or entries.
      // getMapNodeUsage() is what the screen shows BEFORE the click, so this key is
      // the backstop for the delete that raced another session, not the ordinary
      // path.
      if (text.includes('map_node_in_use')) return 'mapadmin.errInUse'
      // Deleting a use case that organizations are recorded against. There is no
      // token to match because there is no guard trigger to raise one: 0024 makes
      // `map_node_use_cases.use_case_id` `on delete restrict`, so the FK itself
      // refuses and names its own constraint. Matching the constraint name is the
      // only handle there is, and it is a better one than a trigger would be — the
      // rule cannot be dropped without dropping the reference it protects.
      if (text.includes('map_node_use_cases_use_case_id_fkey')) return 'mapadmin.errUseCaseInUse'
      // map_node_progress (0026). TWO RACES, TWO SENTENCES, and the split is
      // worth the second key: a stale tab recording a stage against a branch a
      // colleague just deleted has lost the ORGANIZATION, while the same tab
      // naming a rung that was retired a minute ago has lost the STAGE. The
      // first means "reload, that node is gone"; the second means "reload, pick
      // a different rung" — and the node is still there.
      if (text.includes('map_node_progress_node_id_fkey')) return 'mapadmin.errNodeGone'
      if (text.includes('map_node_progress_stage_id_fkey')) return 'mapadmin.errStageGone'
      break
    case '23514':
      // tracks_keep_one_active() — fires on archive as well as delete, so the
      // workspace always has somewhere to file work.
      if (text.includes('last_active_track')) return 'admin.tracks.errLastTrack'
      // vocab_last_visible_option() — 0003. Hiding the final visible option of a
      // kind would leave a picker with nothing to pick, and every entry already
      // holding that key unreachable through the UI. The trigger raises on the
      // whole statement, so a batch that hides several at once is rolled back
      // entirely; the message says what must remain, not which row lost.
      if (text.includes('last_visible_option')) return 'vocabadmin.errLastVisible'
      // label_overrides_text_len / _key_shape / _key_len — 0017. The migration
      // splits these three constraints APART specifically so this file can tell
      // them from each other; "that wording is too long" and "that is not a
      // label key" want different sentences, and both used to arrive as the
      // generic key, which the terminology screen then annotated with "the
      // table is not installed" — a confident, wrong diagnosis.
      if (text.includes('label_overrides_text_len')) return 'terminology.errTooLong'
      if (text.includes('label_overrides_key_shape') || text.includes('label_overrides_key_len')) {
        return 'terminology.errBadKey'
      }
      // jira_settings (0028) — the saved Jira configuration. FOUR CONSTRAINTS,
      // FOUR SENTENCES, and the split is 0017's argument one table over: "that
      // address cannot be a link" and "that query is too long" send the reader to
      // different boxes on the same screen, and both arriving as the generic key
      // is what makes a screen guess.
      //
      // ⚠ NONE OF THESE SENTENCES MAY EVER QUOTE WHAT WAS REFUSED. This file
      //   returns KEYS and interpolates nothing, so the rule holds structurally —
      //   but it is written here because the temptation is real and specific: the
      //   Postgres `details` for a check violation can carry the FAILING ROW, and
      //   a screen that echoed it back would print a site address, a token pasted
      //   into the wrong box, or a JQL naming internal projects into a shared
      //   browser and the next screenshot. Describe the SHAPE a value must have;
      //   never the value.
      if (text.includes('jira_settings_singleton_chk')) return 'jiraconfig.errSingleton'
      if (text.includes('jira_settings_site_base_url_chk')) return 'jiraconfig.errBadSiteUrl'
      if (text.includes('jira_settings_field_len_chk')) return 'jiraconfig.errFieldTooLong'
      if (text.includes('jira_settings_jql_len_chk')) return 'jiraconfig.errJqlTooLong'
      // The SHAPE of status_map, never its vocabulary. 0028 deliberately puts no
      // CHECK on the VALUES — a saved word this app no longer knows is dropped
      // and counted on read (api/jiraSettings.ts), because a constraint could
      // only refuse and would make the fix unreachable. This arm therefore fires
      // only for a status_map that is not an object at all.
      if (text.includes('jira_settings_status_map_chk')) return 'jiraconfig.errStatusMapShape'
      // map_node_stages (0026) — THREE CONSTRAINTS, THREE SENTENCES, 0017's
      // argument one table over: "that number is out of range", "that name is too
      // long" and "that ARABIC name is too long" send the reader to three
      // different boxes on one form, and a generic key makes the screen guess
      // which. The Arabic one matters most: an RTL form with two name fields and
      // nothing saying which one was refused is where a person starts deleting
      // characters at random.
      //
      // The client enforces both bounds itself (STAGE_NAME_MAX = 40 as a
      // maxlength on both fields, 1..3650 on the threshold), so these are the
      // backstop for a paste that outran the maxlength or a value that arrived
      // some other way — not the ordinary path.
      if (text.includes('map_node_stages_expected_days_chk')) return 'mapadmin.errStageExpectedDays'
      if (text.includes('map_node_stages_name_ar_len_chk')) return 'mapadmin.errStageNameArLength'
      if (text.includes('map_node_stages_name_len_chk')) return 'mapadmin.errStageNameLength'
      // UNREACHABLE THROUGH THE APP, and mapped anyway. 0026's stamp trigger is
      // the only writer of `stage_changed_at` and keeps it in step with
      // `stage_id` on every path a client can take, so this CHECK is the backstop
      // for a direct SQL write with the trigger disabled. It is here because a
      // constraint that fires must still say something — an unmapped 23514 naming
      // an identifier nobody has heard of is the exact failure this file exists
      // to prevent, and "unreachable" is a claim about today's write paths.
      if (text.includes('map_node_progress_stage_chk')) return 'mapadmin.errStageStampMismatch'
      // map_node_goals (0027) — the token and its backstop, both to one key. The
      // guard trigger raises the token with errcode 23514 and the CHECK catches
      // the same fact if the trigger is ever dropped, so the two are one sentence
      // for the reader: a goal has to name a positive number of organizations.
      //
      // The order matters and the two names are NOT substrings of each other —
      // `map_node_goal_target` (token) vs `map_node_goals_target_chk`
      // (constraint), which differ at the 's'. Both arms are required.
      if (text.includes('map_node_goal_target')) return 'mapadmin.errGoalTarget'
      if (text.includes('map_node_goals_target_chk')) return 'mapadmin.errGoalTarget'
      // REQUIRED, NOT OPTIONAL, and 0027's header says so: these two constraints
      // have NO token behind them, so a label pasted out of a planning deck
      // arrives as a raw `violates check constraint
      // "map_node_goals_label_ar_len_chk"` on a form with two label fields, in an
      // RTL layout, with nothing saying which field is wrong.
      if (text.includes('map_node_goals_label_ar_len_chk')) return 'mapadmin.errGoalLabelArLength'
      if (text.includes('map_node_goals_label_len_chk')) return 'mapadmin.errGoalLabelLength'
      break
    case '23502':
      // NOT NULL violated. This should now be UNREACHABLE: the one column that
      // ever produced it is `entries.description` (`not null default ''`), and
      // toEntryRow()/toEntryPatchRow() coalesce to '' rather than null, with
      // tests pinning both. Kept as an explicit case anyway — if it ever fires
      // again a new nullable-looking column has been added somewhere, and the
      // named warn below is the difference between finding it in a minute and
      // reading it as one more anonymous 'common.error'.
      console.warn('[pg] 23502 not-null violation — a column lost its coalesce:', e.message)
      return 'common.error'
    case '22023':
      // delete_track() rejecting a destination it must not move rows onto. An
      // archived track is hidden from every picker and stops its recurring
      // templates, so landing entries there is a silent loss, not a placement.
      if (text.includes('reassign_archived')) return 'admin.tracks.errReassignArchived'
      if (text.includes('reassign_self')) return 'admin.tracks.errReassignSelf'
      break
    case 'P0002':
      // The track (or the destination) was deleted by another session while
      // this screen sat open.
      if (text.includes('track_missing')) return 'admin.tracks.errNotFound'
      // The node (or the destination of a move) was deleted by another session
      // while this screen sat open — the tree admin's version of the same race.
      if (text.includes('map_node_missing')) return 'mapadmin.errNotFound'
      // 0027's guard, and it needs its own arm rather than riding the one above:
      // `map_node_goal_node_missing` does NOT contain the substring
      // `map_node_missing` (the word `goal` sits between them), so the 0023 arm
      // would let it fall through to the generic key. Adjacent on purpose —
      // whoever edits one has to see the other. Same fact, same sentence: the
      // branch this goal is pinned to was deleted by another session.
      if (text.includes('map_node_goal_node_missing')) return 'mapadmin.errNotFound'
      break
    case '42501':
      // BEFORE the generic arm below, which returns unconditionally: 0026's
      // reorder RPC raises 42501 with this token when a caller without
      // structure.edit drags a rung, and the generic "you do not have permission"
      // is not wrong so much as unactionable next to a ladder that visibly did
      // not move. Without the token the alternative is worse than a vague
      // sentence — the RPC's own `update` would have affected zero rows and the
      // screen would have reported a successful drag.
      if (text.includes('map_node_stage_reorder_denied')) return 'mapadmin.errStageReorderDenied'
      // RLS rejected the write. In practice: the UI thinks this user is an
      // admin and profiles.role disagrees.
      return 'admin.errForbidden'
    case 'PGRST116':
      // Not a SQLSTATE — PostgREST's own code for ".single() got zero rows".
      //
      // This is the failure lib/permissions.ts exists to pre-empt. An
      // RLS-blocked UPDATE is not an error to Postgres; the row simply does not
      // match the policy, so the statement affects nothing and `.select()
      // .single()` finds nothing to return. Left unmapped it reached the user as
      // a generic "something went wrong" after their card had already animated
      // into place and snapped back — the app looking broken when it was working
      // exactly as designed.
      //
      // Honest caveat: a row deleted by another session between load and save
      // lands here too, and this sentence is a shade wrong for that case. It is
      // the far rarer of the two, and both end the same way — the change did not
      // land and re-reading the screen is the next step. A message that hedged
      // over which it was would help nobody.
      return 'entry.errNotYours'
    case 'PGRST205':
      // Not a SQLSTATE either — PostgREST's "could not find the table in the
      // schema cache", i.e. a migration that has not been applied to this
      // project. It is a SUPPORTED state rather than a fault for a feature
      // whose table is optional (label_overrides today, vocab_options once),
      // and it is the one failure a screen can explain precisely: naming it
      // here is what lets a screen offer the runbook line instead of guessing
      // that every generic failure means the same thing.
      return 'common.errMissingTable'
    default:
      break
  }

  console.warn('[pg] unmapped error:', code, e.message)
  return 'common.error'
}
