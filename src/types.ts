// Hand-written database types, mirroring supabase/migrations/0001_opstrack_core.sql.
//
// These are hand-maintained rather than produced by `supabase gen types` so the
// repo typechecks without a linked project or network access. Field names are
// snake_case because these describe ROWS AS POSTGRES RETURNS THEM — the
// PostgREST client does no key transformation, and quietly camelCasing here
// produced `undefined` everywhere the first time around. View-model types that
// the UI owns (e.g. the session profile in src/store/auth.ts) use camelCase;
// the boundary between the two is the api/ layer.

// ── enum-ish unions (Postgres text columns with check constraints) ──────────
//
// THESE FOUR UNIONS ARE FROZEN and the track manager deliberately does not
// touch them. The app's core logic keys off these exact strings — v_entry_health
// staleness, the closed_at trigger, digest grouping, and i18n keys like
// `status.blocked` — so a value added or removed here is a schema change, a
// migration, and a locale change at once. Sitting 2 makes them RENAMEABLE and
// recolourable through a vocab_options table; the KEYS stay put. A design review
// found that fully-editable statuses admit a two-click merge that silently
// rewrites every completed entry, non-undoably.

export type EntryType =
  | 'action'
  | 'decision'
  | 'issue'
  | 'request'
  | 'change'
  | 'escalation'
  | 'note'

export type EntryStatus =
  | 'new'
  | 'in_progress'
  | 'blocked'
  | 'waiting_on'
  | 'done'
  | 'cancelled'

export type EntryPriority = 'low' | 'medium' | 'high' | 'critical'

/** v_entry_health.health — overdue always outranks stale (see the view). */
export type HealthLevel = 'ok' | 'stale' | 'overdue' | 'critical'

export type UserRole = 'admin' | 'member'

export type Cadence = 'daily' | 'weekly' | 'biweekly' | 'monthly' | 'quarterly' | 'custom'

/** One element of entries.links (jsonb array). */
export interface EntryLink {
  label: string
  url: string
}

// ── tables ─────────────────────────────────────────────────────────────────

/** profiles — one row per auth user, created by the admin edge function. */
export interface Profile {
  id: string
  /** `not null default ''` — may be empty, never null. */
  display_name: string
  /**
   * STILL HERE, AND STILL THE ONLY ADMIN SIGNAL THE CLIENT READS.
   *
   * 0025 does NOT drop this column — it DERIVES it. `profiles_role_sync()` keeps
   * it equal to `'admin'` exactly when `role_id` is the system Admin role, in
   * both directions, because `admin-members`' `set-role` still PATCHes the text
   * with the service role and a one-way derivation would report success and move
   * nobody. Dropping it needs three things first, and they are a later
   * migration's job: no policy reading it, the edge function gating on
   * `has_perm()`, and `src/lib/permissions.ts` no longer branching on it.
   */
  role: UserRole
  /**
   * 0025 — the role this person holds, null until `profiles_role_sync()` or a
   * backfill fills it. `has_perm()` COALESCEs through `role` when it is null, so
   * a profile written by `handle_new_user()` before the trigger ran still
   * resolves; anything counting admins client-side has to reproduce that
   * coalesce or it under-counts. See `admin_holder_count()` in 0025.
   */
  role_id: string | null
  /**
   * 0025 — free text, display only, and deliberately grants nothing. Pinned by
   * `guard_profile_role()` against anyone without `members.manage`. Wave C's
   * altitude must be derived from the ROLE, never by parsing this string.
   */
  position: string
  locale: string
  created_at: string
}

/** tracks — the operational domains; admin-editable under /settings/tracks. */
export interface Track {
  id: string
  name: string
  /** `not null default ''` — fall back to `name` when empty, not when null. */
  name_ar: string
  /** `not null default ''`. */
  description: string
  /** `not null default ''`. */
  description_ar: string
  /**
   * Hex colour for the dark theme's colour bar; mirrors the --track-* tokens.
   * Both hexes are emitted as inline custom properties and CSS picks between
   * them, because a JS helper would not re-render when the `auto` theme flips
   * under the user.
   */
  color: string
  /**
   * Hex colour used instead of `color` under [data-theme='light'].
   *
   * NULLABLE, matching 0002: null means "this track has no light-theme
   * override" and every reader falls back to `color`. Making it not-null with a
   * default would force a colour nobody chose onto every future track.
   */
  color_light: string | null
  /** Free text, resolved by lib/trackIcons.ts — the DB holds no icon CHECK. */
  icon: string
  /**
   * Tags this track proposes at capture and breaks out in the track view and
   * the digest — `text[] not null default '{}'` (0004). Onboarding seeds
   * `{direct-integration,portal}`; the mechanism is per-track on purpose, so a
   * seventh track needs no code change. NOTHING in the codebase names a track.
   */
  suggested_tags: string[]
  sort_order: number
  archived: boolean
  /** Maintained by the tracks_touch() trigger in both directions from `archived`. */
  archived_at: string | null
  created_by: string | null
  created_at: string
  updated_at: string
  /**
   * Which TrackGroup this track sits under — `tracks.group_id` (0018).
   *
   * NULL IS A LEGAL, ORDINARY STATE, not a missing value: a track created in
   * Settings › Tracks before anyone thinks about grouping is ungrouped, and
   * every group-aware surface has to render it (an "Ungrouped" section), never
   * hide it. The column is `on delete set null`, so deleting a group ungroups
   * its tracks rather than taking them — and through them every entry ever
   * filed — with it.
   *
   * OPTIONAL RATHER THAN REQUIRED, and only for the length of this wave. Twelve
   * test files build whole `Track` literals by hand; a required field would red
   * `tsc -b` in all of them at once and block every other worker in the wave on
   * files this one does not own. That is precisely the trade `suggestedTags`
   * below documents, and it is resolved the same way: tighten to
   * `group_id: string | null` in the commit that adds `group_id: null` to those
   * fixtures. Real rows always carry the key — PostgREST returns every column.
   *
   * TEST FOR IT WITH `== null`, NEVER `=== null`. Until it is tightened, absent
   * and null both mean ungrouped, and `=== null` silently files an absent value
   * as if it were a group id. `track.group_id ?? null` is the other safe form.
   */
  group_id?: string | null
}

/**
 * The editable half of a track, camelCase because it is a form's view-model —
 * api/tracks.ts hand-maps it to the snake_case columns. `sort_order` and
 * `archived` are absent on purpose: reordering and archiving are their own
 * operations with their own guards, not fields on a form.
 */
export interface TrackInput {
  name: string
  nameAr: string
  description: string
  descriptionAr: string
  color: string
  colorLight: string
  icon: string
  /**
   * Tags this track proposes at capture — `tracks.suggested_tags` (0004).
   *
   * REQUIRED, as of the Wave-1 integration. It shipped optional for the length
   * of the wave because the keystone published types.ts an hour before the
   * worker owning TrackEditor.tsx and api/tracks.ts started, and a required
   * field would have redded the `tsc -b` handshake that gates every other
   * Wave-1 worker on a file the keystone must not edit. The editor field and
   * the column read/write landed in the same commit that tightened it, per
   * WAVE1-ADDENDUM §2.1.
   *
   * An empty array is the honest value for "this track proposes nothing", and
   * it is what the column defaults to; optional would have made "unset" and
   * "deliberately empty" indistinguishable at every call site.
   */
  suggestedTags: string[]
  /**
   * Which group the track belongs to — `tracks.group_id` (0018). `null` is the
   * explicit "no group", which is a choice a form can make and must be able to
   * send.
   *
   * OPTIONAL, and here the optionality is permanent rather than transitional:
   * `updateTrack` patches only the keys it is handed, so `undefined` has a
   * meaning of its own on this type — "leave the group alone" — which is what
   * every caller that is not the group picker wants. `null` and `undefined` are
   * therefore genuinely different instructions, exactly as they are on the
   * PATCH this maps to.
   */
  groupId?: string | null
}

/**
 * track_groups — the level above tracks (0018). Technical and Business today.
 *
 * A CONTAINER FOR TRACKS AND NOTHING ELSE: no entries, no SLAs, no tags are
 * filed against a group. It is two levels by design and not a general tree —
 * there is no `parent_id`, because a depth nobody asked for would have to be
 * understood by the board, the timeline, the Mindtree, the digest and the
 * filter bar at once.
 */
export interface TrackGroup {
  id: string
  name: string
  /** `not null default ''` — fall back to `name` when empty, not when null. */
  name_ar: string
  /** Hex for the dark theme, mirroring `Track.color`. */
  color: string
  /**
   * Hex used instead of `color` under [data-theme='light'].
   *
   * NULLABLE with `Track.color_light`'s exact semantics: null means "no
   * light-theme override" and every reader falls back to `color`. The preset
   * palette in styles/global.css is defined in PAIRS because one hex cannot
   * clear 3:1 on both #212932 and #e9edf1 — shipping a group ring with a single
   * hex would reproduce the defect 0002's seed repair had to go back and fix.
   */
  color_light: string | null
  sort_order: number
  created_by: string | null
  created_at: string
  updated_at: string
}

/**
 * The editable half of a group, camelCase because it is a form's view-model —
 * api/tracks.ts hand-maps it to the snake_case columns, exactly as `TrackInput`
 * is. `sort_order` is absent for the same reason it is absent there: reordering
 * is its own operation with its own guard (`reorderGroups`), not a field on a
 * form.
 */
export interface TrackGroupInput {
  name: string
  nameAr: string
  color: string
  /** '' means "no light-theme override" and is stored as NULL — see TrackGroup. */
  colorLight: string
}

/**
 * How many rows still point at a track. Drives the delete flow: zero everywhere
 * means delete outright, anything else means offer to reassign first — every
 * track_id FK is `on delete set null`, so an unguarded delete orphans rows
 * rather than blocking.
 */
export interface TrackUsage {
  entries: number
  meetings: number
  templates: number
  /**
   * map_nodes on this track (0023). Counted because `delete_track` now reassigns
   * the whole hierarchy and `tracks_block_delete_when_referenced()` counts it —
   * without this the confirmation tells an admin a track is empty while a whole
   * Org tree hangs off it, and the RPC then refuses for a reason nothing on
   * screen explained.
   */
  nodes: number
}

/**
 * config_audit — append-only trail of admin configuration changes, written by an
 * AFTER trigger owned by `postgres`. Table owners are RLS-exempt, which is why
 * the table needs no INSERT policy; it has no UPDATE/DELETE policy either, the
 * same immutability pattern as entry_updates.
 */
export interface ConfigAuditRow {
  id: string
  /** Which config table changed — 'tracks' today, 'vocab_options' in sitting 2. */
  table_name: string
  /** Plain uuid, deliberately NOT a foreign key — it has to stay readable after
      the row it names is deleted, which is the case this table exists for. */
  row_id: string | null
  /**
   * The column carries no CHECK in 0002 on purpose (every writer is in that
   * file, and a value list would just be a second place to edit). These four
   * are the writers that exist: the tracks_audit trigger emits the first three,
   * and delete_track() emits 'move' for the reassignment it performs before the
   * delete — "where did 40 entries go" is a different question from "who
   * deleted the track".
   */
  action: 'insert' | 'update' | 'delete' | 'move'
  actor_id: string | null
  /** Whole-row snapshots; null on the side that does not exist for this action. */
  before: Record<string, unknown> | null
  after: Record<string, unknown> | null
  created_at: string
}

/**
 * entries — the central table.
 *
 * owner_id and owner_name are mutually exclusive: an owner is either a
 * provisioned teammate (owner_id) or free text for someone outside the
 * workspace such as a vendor (owner_name). The UI renders and filters both
 * identically, so read them through a helper rather than branching in views.
 */
export interface Entry {
  id: string
  track_id: string | null
  /**
   * `entries.node_id` (0024) — which hierarchy node this row is filed on, or
   * null for a row filed at track level under no organization.
   *
   * `track_id` is authoritative when this is null and DERIVED from the node by
   * the `entries_map_sync` trigger when it is not, so the two can never
   * disagree: there is one filing axis with an optional finer grain, not two.
   */
  node_id: string | null
  title: string
  /** `not null default ''`. */
  description: string
  type: EntryType
  status: EntryStatus
  priority: EntryPriority
  owner_id: string | null
  owner_name: string | null
  /** Who asked for this — free text, often a person outside the workspace. */
  requester: string | null
  /** date columns come back as 'YYYY-MM-DD', not ISO timestamps. */
  due_date: string | null
  follow_up_date: string | null
  tags: string[]
  links: EntryLink[]
  created_by: string | null
  created_at: string
  updated_at: string
  closed_at: string | null
  /**
   * Bumped by trigger on any entry change AND on every appended update.
   * Staleness is computed from this column, never from updated_at — a
   * trigger-only updated_at bump (e.g. a backfill) must not reset an item's age.
   */
  last_activity_at: string
  meeting_id: string | null
  template_id: string | null
}

/**
 * entry_updates — the append-only audit thread.
 *
 * Immutability is enforced by the ABSENCE of UPDATE/DELETE policies under RLS,
 * not by application code. Never add such a policy to "fix" a typo; append a
 * correcting update instead.
 */
export interface EntryUpdate {
  id: string
  entry_id: string
  author_id: string | null
  /** `not null default ''` — empty on a row that only records a transition. */
  body: string
  /** Set only when this update recorded a status transition. */
  status_from: EntryStatus | null
  status_to: EntryStatus | null
  created_at: string
}

/**
 * Fields a caller may set when creating an entry. Only `title` is required —
 * capture must never be blocked on a missing field; everything else can be
 * filled in later from the entry sheet.
 *
 * camelCase because this is a WRITE VIEW-MODEL, not a row: api/entries.ts maps
 * it to snake_case columns through `toEntryRow()`, exactly as `TrackInput`
 * above is mapped by api/tracks.ts. Same boundary, same convention.
 *
 * IT LIVES HERE RATHER THAN IN api/entries.ts, and that is a layering fix, not
 * a filing preference. `lib/capture/parse.ts` returns one from `toNewEntry()`
 * (plan §2.13), and contracts rule 2 forbids `src/lib/**` importing from
 * `src/api/**` — the parser was reaching across the layer for a type alone.
 * api/entries.ts re-exports all three of these, so no call site moved.
 */
export interface NewEntry {
  title: string
  trackId?: string | null
  /**
   * The map node to file this under. `track_id` is derived from it server-side,
   * so sending both is safe only when they agree — which is what `dropRules`
   * and `draftAt` guarantee by reading one branch of one tree.
   */
  mapNodeId?: string | null
  description?: string | null
  type?: EntryType
  status?: EntryStatus
  priority?: EntryPriority
  ownerId?: string | null
  ownerName?: string | null
  requester?: string | null
  dueDate?: string | null
  followUpDate?: string | null
  tags?: string[]
  links?: EntryLink[]
  meetingId?: string | null
  templateId?: string | null
}

/** Fields an editor may change. Undefined keys are left untouched. */
export interface EntryPatch {
  title?: string
  description?: string | null
  type?: EntryType
  status?: EntryStatus
  priority?: EntryPriority
  ownerId?: string | null
  ownerName?: string | null
  requester?: string | null
  dueDate?: string | null
  followUpDate?: string | null
  tags?: string[]
  links?: EntryLink[]
  trackId?: string | null
  /**
   * `entries.node_id`. Named for the dimension, not the column, matching the
   * plan's `FilterState.mapNodeIds`. Null means "under no organization" and is
   * written EXPLICITLY by every drop on a track ring — see `dropRules.foldPath`,
   * or a row dropped on a track's bucket springs back under its old Org one
   * frame after landing.
   */
  mapNodeId?: string | null
}

/** One appended thread post. `statusFrom`/`statusTo` mark a transition row. */
export interface NewEntryUpdate {
  entryId: string
  body: string
  statusFrom?: EntryStatus | null
  statusTo?: EntryStatus | null
}

/** meetings — a live capture session; entries link back via meeting_id. */
export interface Meeting {
  id: string
  title: string
  track_id: string | null
  attendees: string[]
  started_at: string
  ended_at: string | null
  /** `not null default ''`. */
  notes: string
  created_by: string | null
}

/** recurring_templates — materialized into entries by materialize_due_recurring(). */
export interface RecurringTemplate {
  id: string
  track_id: string | null
  title: string
  type: EntryType
  priority: EntryPriority
  owner_id: string | null
  owner_name: string | null
  cadence: Cadence
  /** Only meaningful when cadence = 'custom'. */
  custom_interval_days: number | null
  /** 0–6, only meaningful for weekly/biweekly cadences. */
  day_of_week: number | null
  /** 1–31, only meaningful for monthly/quarterly cadences. */
  day_of_month: number | null
  next_run_on: string
  /** Create the entry this many days before it is due. */
  lead_days: number
  active: boolean
  /**
   * Who wrote this recipe. Server-stamped and pinned by
   * `recurring_templates_guard_write()` (0014); NULL for the SQL editor and the
   * service role. FIX-BACKLOG R1-SEC-2: the table carried no author at all, so a
   * member could aim a template at a colleague, have it delivered as a push, and
   * leave no trace of who did it.
   */
  created_by: string | null
  /**
   * Who last edited the CONTENT. Deliberately NOT moved by a `next_run_on`-only
   * write — both materialisers advance that column under whichever member's
   * browser happened to call, and crediting a bystander is worse than crediting
   * nobody.
   */
  updated_by: string | null
}

/**
 * v_entry_health — one row per OPEN entry (done/cancelled are excluded by the
 * view), carrying the age maths resolved server-side so every client agrees on
 * what "stale" means. It deliberately carries no title or owner: join to
 * `entries` for display fields rather than widening the view.
 */
export interface EntryHealth {
  /** The view exposes the entry id under both names — key by one, join on the other. */
  id: string
  entry_id: string
  track_id: string | null
  status: EntryStatus
  priority: EntryPriority
  due_date: string | null
  last_activity_at: string
  days_since_activity: number
  /** 0 (not null) when there is no due date or the item is not yet overdue. */
  days_overdue: number
  health: HealthLevel
  /**
   * SLA deadline, computed by the view as `created_at + sla_days` for this
   * entry's priority (0003). NULL when the admin has left that priority's
   * `sla_days` unset — which is the seeded state, so SLA is off until someone
   * turns it on. This is a SERVICE commitment and is deliberately distinct from
   * `due_date`: due_date is what a human promised about one item, sla_due_at is
   * what the workspace promised about every item of that priority. An entry can
   * be inside its due date and past its SLA, and both facts matter.
   */
  sla_due_at: string | null
  /** `sla_due_at is not null and now() > sla_due_at` — false whenever SLA is off. */
  sla_breached: boolean
}

// ── vocabulary (0003) ──────────────────────────────────────────────────────
//
// Sitting 2's payoff: the four frozen unions above become RENAMEABLE and
// RECOLOURABLE without becoming editable. An admin can call `waiting_on`
// "Awaiting vendor" in English and "بانتظار المورّد" in Arabic; nobody can add
// a seventh status or merge two, because a merge silently rewrites every
// historical entry and there is no undo.
//
// The frozen keys are what makes a label edit cost ZERO writes: entry rows and
// entry_updates.status_from/status_to keep storing the key, and every screen
// resolves the label at render.

export type VocabKind = 'status' | 'priority' | 'type'

/** One row of `vocab_options`, primary key (kind, key). */
export interface VocabRow {
  kind: VocabKind
  /** A key from the matching frozen union. Never edited, never added to. */
  key: string
  /**
   * `not null default ''` in BOTH languages, seeded empty on purpose: an empty
   * label means "no override", so the i18n default (`t('status.blocked')`)
   * wins until an admin actually types something. That is also why the
   * fallback chain tests for EMPTY rather than null, and why a blank Arabic
   * label falls through to the i18n default and never to the English override.
   */
  label: string
  label_ar: string
  /** Hex, or null for "use the theme's default ink for this kind". */
  color: string | null
  sort_order: number
  /** Hidden options leave pickers but never hide data that already holds them. */
  hidden: boolean
  /**
   * Days of silence before an OPEN entry of this priority reads as stale.
   * PRIORITY ROWS ONLY — a CHECK constraint keeps it null on status and type.
   * `v_entry_health` coalesces it over the hardcoded 2/4/8/15 fallback, so
   * clearing it restores the default rather than disabling staleness.
   */
  stale_after_days: number | null
  /**
   * The admin-defined SLA for this priority, in days from `created_at`.
   * PRIORITY ROWS ONLY, same CHECK. NULL means this priority has no SLA — the
   * seeded state, so nothing is retroactively "breached" the day 0003 runs.
   *
   * Distinct from stale_after_days on purpose: staleness measures SILENCE
   * (`last_activity_at`), the SLA measures ELAPSED TIME (`created_at`). An item
   * updated hourly for a month is never stale and can still blow its SLA.
   */
  sla_days: number | null
  updated_at: string
  updated_by: string | null
}

// ── meetings (0004) ────────────────────────────────────────────────────────

export type MeetingLineState = 'pending' | 'committed' | 'discarded' | 'note'

/**
 * One line typed during a live meeting, PERSISTED AS TYPED rather than held in
 * client state — killing the tab mid-meeting must not lose the meeting, and a
 * discarded line has to survive as a note per spec.
 */
export interface MeetingLine {
  id: string
  meeting_id: string
  seq: number
  /** `not null default ''` — the raw capture string, before triage. */
  raw: string
  /** A serialized ParsedEntry, or null when the line was never parsed. */
  parsed: Record<string, unknown> | null
  state: MeetingLineState
  /** Set when triage committed this line into an entry. */
  entry_id: string | null
  created_by: string | null
  created_at: string
  updated_at: string
}

// ── notifications (0004) ───────────────────────────────────────────────────

/**
 * Why a notification exists. Written by DB triggers and by `nudge_entry()`,
 * never by the client.
 *
 * THESE THREE ARE THE LIVE CHECK, not a superset of it: `notifications_kind_check`
 * on lrysgpbkmuqgzsjesfkr reads `kind = ANY (ARRAY['assigned','completed','nudged'])`
 * after migration 0019 widened it. 'nudged' was added to this union LATE — 0019
 * taught the write side the word and left the read side narrowing every unknown
 * kind to 'assigned', so a nudge told its recipient the item had been assigned to
 * them, on an item `canNudge()` guarantees they already own. A new kind in the
 * database is only half a feature; the other half is a member of this union, a
 * `notif.*` sentence in BOTH locale trees, and an arm in
 * `send-push/index.ts`'s STRINGS table.
 */
export type NotificationKind = 'assigned' | 'completed' | 'nudged'

/**
 * A notification as the UI consumes it — camelCase because this is a VIEW
 * MODEL, not a row. api/notifications.ts maps the snake_case `notifications`
 * row and resolves the two denormalized display fields; the api layer is the
 * boundary between the two conventions (see this file's header).
 *
 * Named AppNotification, not Notification, because `Notification` is a DOM
 * global — shadowing it inside a Web Push module would be a genuinely nasty
 * hour.
 *
 * `entryTitle` and `actorName` are SNAPSHOTS resolved at read time rather than
 * ids the renderer joins: an inbox row has to stay readable after the entry is
 * retitled, and the alternative is every notification row triggering a lookup
 * in a store the notification center may not have loaded.
 */
export interface AppNotification {
  /**
   * A STRING here, a `bigint generated always as identity` on the live table —
   * verified against the project, not assumed, and the one id in this schema
   * that is not a uuid. PostgREST serialises int8 as a JSON *number*, so
   * `toAppNotification()` does `String(row.id)`; without that every realtime
   * dedupe and every React key compares a number against the string the rest of
   * the app carries, and silently loses. Wave 3's notification centre must not
   * assume uuid.
   */
  id: string
  /** The profile this is for. RLS restricts SELECT to `recipient_id = auth.uid()`. */
  recipientId: string
  kind: NotificationKind
  entryId: string
  entryTitle: string
  /** Null when the acting profile has since been deleted (`on delete set null`). */
  actorId: string | null
  /** `not null default ''` — falls back to the members store, then to a generic label. */
  actorName: string
  /** Null while unread. The unread badge counts nulls; there is no `read` boolean. */
  readAt: string | null
  createdAt: string
}

/**
 * Per-user delivery preferences.
 *
 * `assigned` and `completed` mirror the two trigger kinds. `allCompletions` is
 * the admin-only opt-in to every completion in the workspace, not just the ones
 * they raised — a member setting it changes nothing, because the trigger's
 * fan-out is gated on `profiles.role`. `push` is Wave 4's Web Push channel and
 * is independent: switching it off keeps the in-app inbox working.
 */
export interface NotificationPrefs {
  assigned: boolean
  completed: boolean
  allCompletions: boolean
  push: boolean
}

// ── username auth ──────────────────────────────────────────────────────────

/**
 * What a member types on the claim screen, once, to turn the account an admin
 * predefined into an account they can sign in to.
 *
 * The invite code is what stops a stranger claiming a known username first —
 * usernames are guessable by construction (they are handed out in person), so
 * the code, not the username, is the secret. It is single-use; an admin
 * reissues one as the password-reset path, because a synthetic
 * `<username>@opstrack.internal` address cannot receive a reset mail.
 *
 * `password` NEVER reaches this app's own storage: it goes straight to the
 * claim-account edge function, which sets it with the service role.
 */
export interface ClaimInput {
  username: string
  inviteCode: string
  password: string
}

// ── label overrides (Settings › Terminology) ────────────────────────────────

/**
 * One row of `label_overrides` (migration 0017): an admin-authored replacement
 * for a shipped i18n string, in either or both languages.
 *
 * NAMED `…Row` LIKE `VocabRow`, AND NOT `LabelOverride`, because lib/i18n.ts
 * already exports that name for a different thing — the `{en, ar}` pair it holds
 * in memory, with no key and no audit columns. This is the DATABASE row; that is
 * the resolved value. Collapsing the two names would make every import site a
 * guess about which layer it is in.
 *
 * `en` and `ar` are BOTH NULLABLE and that is a real case, not a defect:
 * rewording only the Arabic of `entry.owner` must leave the English alone. Null
 * and blank mean the same thing — no override for this language — and 0017's
 * `label_overrides_touch()` collapses blank to null on the way in, so a row read
 * back from the table carries null and never `''`.
 *
 * `key` is a dot path into the locale bundles (`nav.map`). For a CLDR plural
 * node it carries the category too (`board.total.one`), because a plural key has
 * no single string to override — lib/labelOverrides.ts's `overrideKey()` is the
 * one place that format is written.
 */
export interface LabelOverrideRow {
  key: string
  en: string | null
  ar: string | null
  updated_by: string | null
  updated_at: string
}

/**
 * The override layer as lib/i18n.ts resolves against it: one flat `key → string`
 * record PER LANGUAGE, consulted before the shipped bundle.
 *
 * IT LIVES HERE, NOT IN lib/i18n.ts, BECAUSE THREE LAYERS TOUCH IT AND ONLY THIS
 * FILE SITS BELOW ALL THREE — api/labels.ts reads the rows, store/labels.ts
 * builds the map, i18n consumes it, and `src/lib/**` may not import from
 * `src/store/**`. Declaring it in i18n and importing it into the store would
 * work, but then the api layer would be reaching into lib/ to name the shape of
 * data it produced. This file is already the shared vocabulary; lib/labels.ts
 * imports `Track` from it for the same reason.
 *
 * SPLIT BY LANGUAGE RATHER THAN `key → {en, ar}` so a lookup is one record index
 * in the locale being rendered — a path t() takes for every string on every
 * screen. It is also the exact shape of the resolution order the feature is
 * specified in: `override[locale][key]`. Rows are the other way round because a
 * row IS the pair, and that is what one editor row saves.
 *
 * EVERY VALUE IS A NON-EMPTY STRING. store/labels.ts's buildMap() drops null and
 * blank on the way in, so a hit can be returned as-is and no override can render
 * a label as empty space (spec §5). A key present in `ar` and absent from `en`
 * is the ordinary case of rewording one language.
 */
export interface LabelOverrideMap {
  readonly en: Readonly<Record<string, string>>
  readonly ar: Readonly<Record<string, string>>
}

// ── the map hierarchy (0023 map_nodes, 0024 map_use_cases) ──────────────────
//
// THE ONE INVARIANT: TRACKS STAY. This hierarchy hangs BELOW them. `entries.track_id`
// is still what colours a row, what the track × priority SLA matrix is keyed on and
// what the track timeline reads; a node is a FINER GRAIN inside a track, never a
// replacement for one. UHR is a track, OB a node beneath it, each Org a node beneath
// OB, to arbitrary depth.
//
// Which is why `MapNode.track_id` is `string`, not `string | null`: every node
// carries the track it lives under, denormalised, and the database derives it from
// the parent rather than trusting a writer to assert it. An entry gaining a
// `node_id` therefore cannot end up filed under two different tracks at once — the
// second filing axis is unrepresentable rather than merely detected.
//
// EVERY FIELD BELOW IS REQUIRED. `Track.group_id` is optional only because twelve
// test files build Track literals by hand and a required field would have redded
// `tsc -b` in all of them at once (see its comment). These types are new and have no
// such fixtures, so the debt is not repeated: a row PostgREST returns carries every
// column, and a type that admits `undefined` teaches every reader to write `?? null`
// forever.

/**
 * Where a node's content came from — `map_nodes.source` (0023).
 *
 * 'jira' is provisioned from day one and written by nothing yet: the sync is
 * deliberately not built (a two-way sync is gated on the tracker being verified),
 * but the columns exist so turning it on later is a feature, not a migration of
 * live rows. Everything a person creates in this app is 'local'.
 */
export type MapNodeSource = 'local' | 'jira'

/**
 * How far one organization has got with one HL7/FHIR capability —
 * `map_node_use_cases.status` (0024).
 *
 * THREE STATES AND NO FOURTH, because "not integrated at all" is the ABSENCE of the
 * row, not a value. That is the same shape `track_slas` uses for "inherit" and it is
 * chosen for the same reason: a sentinel value would be a second way to say nothing
 * and both would have to be handled everywhere. See `setNodeUseCase` in api/map.ts,
 * which DELETEs on null.
 */
export type UseCaseStatus = 'planned' | 'testing' | 'live'

/**
 * map_nodes — the tree beneath a track. Programme phases, onboarding phases, and
 * the organizations being onboarded, at whatever depth the admin builds.
 *
 * `vendor` IS A COLUMN, not a facet computed from something else, and it is here
 * because Aziz asked to filter the map by the integrator doing each organization's
 * work. It carries the shape three separate units argued for before it existed:
 * `text not null default ''`, free text rather than an FK for `entries.owner_name`'s
 * reason. `FilterState.mapNodeIds` is what actually delivers the filter (Wave B);
 * this column is what it filters ON.
 */
export interface MapNode {
  id: string
  /**
   * The node above this one, or null for a depth-0 node hanging directly off its
   * track. NOT a general "no parent": null means "this node's parent IS the track",
   * which is why `track_id` is required on the same row.
   */
  parent_id: string | null
  /**
   * Which track this node lives under — NOT NULL on every node, at every depth.
   *
   * DERIVED, NOT ASSERTED: the database sets it from the parent, and a move that
   * crosses tracks rewrites the whole subtree in one statement (`move_map_node`).
   * A client must never compute it for a child node; pass it only when creating or
   * moving a depth-0 node, where there is no parent to derive it from.
   */
  track_id: string
  /**
   * Which `map_node_kinds` row this is — Programme, Phase, Organization.
   *
   * NULLABLE, and legally so: the FK is `on delete set null`, so retiring a kind
   * un-kinds its nodes rather than deleting the organizations filed under it. A
   * node with no kind is still drawn; nothing in the renderer branches on the kind
   * key, because what a Phase shows and what an Org shows is configuration.
   */
  kind_id: string | null
  name: string
  /** `not null default ''` — fall back to `name` when EMPTY, not when null. */
  name_ar: string
  /** `not null default ''`. */
  description: string
  /** `not null default ''`. */
  description_ar: string
  /**
   * The teammate accountable for this node — `profiles.id`, `on delete set null`.
   *
   * A REFERENCE, not a name, so that renaming a person propagates everywhere they
   * are shown instead of leaving a stale string on forty organizations.
   */
  account_manager_id: string | null
  /**
   * The integrator delivering this organization — `not null default ''`.
   *
   * FREE TEXT, NOT A REFERENCE, and the asymmetry with `account_manager_id` right
   * above is the whole point: an account manager is a teammate with a profile, a
   * login and a display name somebody maintains; a vendor is a company outside
   * the workspace with none of those. Empty means "not recorded" — never null, so
   * that filter-by-vendor has one answer to "no vendor" rather than two.
   */
  vendor: string
  sort_order: number
  archived: boolean
  /**
   * Maintained by `map_nodes_archive_stamp()` in BOTH directions from `archived`,
   * exactly as `tracks.archived_at` is. Never write it from the client: the trigger
   * owns it and a client value would be overwritten on the same statement.
   */
  archived_at: string | null
  /** Provenance (0023). 'local' for everything a person created here. */
  source: MapNodeSource
  /** The issue key in the external system, or null. Nothing writes this yet. */
  external_ref: string | null
  /** A link back to the external system, or null. Nothing writes this yet. */
  external_url: string | null
  /**
   * When the external sync last wrote this row, or null for a node no sync has
   * touched. SUBTRACTED FROM THE TOUCH AND AUDIT DIFFS by the migration — a nightly
   * sync that changed nothing must not write one audit row per node per night.
   */
  synced_at: string | null
  /**
   * Column names a person has edited here since the last sync — `text[] not null
   * default '{}'`, so an empty list is `[]` and never null. It is the per-field
   * editing contract decided up front: a synced field shows its provenance, and
   * editing it takes that field out of the sync's hands until it is given back.
   */
  overrides: string[]
  created_by: string | null
  created_at: string
  updated_at: string
}

/**
 * map_node_kinds — Programme, Phase, Organization. What a node IS.
 *
 * NO COLOUR COLUMN, and that is a decision rather than an omission: colour on this
 * map means TRACK, and a node inherits its track's colour at every depth. The map's
 * visual budget is already spent on size-for-count and the breach mark, and a second
 * colour axis would make two different things look like the same thing.
 */
export interface MapNodeKind {
  id: string
  name: string
  /** `not null default ''` — fall back to `name` when EMPTY, not when null. */
  name_ar: string
  sort_order: number
  created_by: string | null
  created_at: string
  updated_at: string
}

/**
 * use_cases — the HL7/FHIR capabilities an organization integrates. ADT, Medication
 * Prescribe V1, Radiology Order, and the rest, "and more to be added later".
 *
 * `vocab_options`' shape but UNFROZEN. vocab_options is frozen because entry status
 * keys are stored in append-only `entry_updates` rows that can never be rewritten;
 * nothing here has that property, so an admin may add, rename and retire freely.
 * Versions are separate rows the admin names ("Medication Prescribe V2"), not a
 * version column — a version schema would have to decide what V1 means once V2
 * exists, and the honest answer is "whatever the admin called it".
 */
export interface UseCase {
  id: string
  name: string
  /**
   * `not null default ''`, and SEEDED BLANK on purpose: an empty Arabic name means
   * "no translation yet" and every reader falls back to `name`, which is the right
   * answer for a capability whose English name is the one everybody in the room
   * actually says. Test for EMPTY, not for null.
   */
  name_ar: string
  sort_order: number
  /**
   * Hidden capabilities leave the pickers but never hide the links that already
   * name them — `vocab_options.hidden`'s exact contract. This is how a capability
   * is retired without erasing which organizations integrated it.
   */
  hidden: boolean
  created_by: string | null
  /** Who last edited this row. 0024 carries both; `map_node_kinds` carries only the first. */
  updated_by: string | null
  created_at: string
  updated_at: string
}

/**
 * map_node_use_cases — which organization integrated which capability, and how far.
 *
 * NO ID: the pair is the primary key, so the ordering is total and two loads of the
 * same data render in the same order. `TrackSlaRule` is shaped this way for the same
 * reason, and api/map.ts selects these columns by name rather than `*` so the type
 * cannot drift from the query.
 *
 * ABSENCE IS A VALUE. No row means "not integrated", which is why there is no
 * 'none' member of `UseCaseStatus`.
 *
 * THE FIVE JIRA COLUMNS ARE OPTIONAL, AND THAT IS A STATEMENT ABOUT ROWS RATHER
 * THAN ABOUT THE TABLE. 0024 created all five `not null default`/nullable on day one
 * (0024:393-397) and every row in the database has them; what is genuinely optional
 * is whether the value in hand CAME FROM the database. Hand-built rows in fixtures
 * and optimistic rows a panel holds between a tick and its round trip carry the
 * three key columns alone, and a required field would force every one of them to
 * invent a `source` — which is exactly the "seeded default asserting a fact nobody
 * stated" this feature refuses elsewhere. api/map.ts's LINK_COLUMNS populates all
 * eight on every read, so `source === undefined` means "not from a read", never
 * "no source". Test for the field, not for its value.
 */
export interface MapNodeUseCase {
  node_id: string
  use_case_id: string
  status: UseCaseStatus
  /** 'local' unless a sync wrote the row. The frozen twin of `map_nodes.source`. */
  source?: MapNodeSource
  /** The Jira issue key this link mirrors, or null for a link somebody typed. */
  external_ref?: string | null
  /** Deep link to that issue. Null unless `external_ref` names one. */
  external_url?: string | null
  /** When the sync last touched this row; null for a local link. */
  synced_at?: string | null
  /**
   * Fields a person changed by hand that a future sync must not overwrite.
   *
   * Empty on every row today — nothing writes it yet. It is read before it is
   * written on purpose: `held` is only meaningful if the row can say which fields
   * are held, and a write path that discovers that afterwards has already lost the
   * edits it was supposed to protect.
   */
  overrides?: string[]
}

/**
 * The editable half of a node, camelCase because it is a form's view-model —
 * api/map.ts hand-maps it to the snake_case columns, exactly as `TrackInput` is.
 *
 * `sortOrder` and `archived` are absent for `TrackInput`'s reason: reordering and
 * archiving are their own operations with their own guards. `parentId` and `trackId`
 * ARE here because creating a node has to say where it goes — but they are read by
 * `createMapNode` ALONE. `updateMapNode` takes `Partial<Omit<MapNodeInput, 'parentId'
 * | 'trackId'>>` so that re-parenting through the patch endpoint is a type error
 * rather than a silently-ignored key: a subtree move has to rewrite every
 * descendant's `track_id` in one statement, and that is `moveMapNode`.
 */
export interface MapNodeInput {
  /** Null puts the node at depth 0, directly under `trackId`. */
  parentId: string | null
  /**
   * Which track the node lives under. Authoritative only when `parentId` is null;
   * with a parent the database derives it and disagreement is rejected, not
   * silently preferred.
   */
  trackId: string
  name: string
  nameAr: string
  description: string
  descriptionAr: string
  /** Null is the ordinary "no kind chosen", not a missing value. */
  kindId: string | null
  /** Null is the ordinary "nobody named yet". */
  accountManagerId: string | null
  /** `''` is the ordinary "no vendor recorded" — free text, never null. */
  vendor: string
}

/**
 * What `move_map_node()` reports back — a jsonb object, mapped to camelCase by
 * api/map.ts because it is a return value the UI reads, not a row.
 *
 * THREE NUMBERS BECAUSE THE MOVE DOES THREE THINGS, and a single count would make
 * the confirmation lie in the interesting case: a cross-track move rewrites the
 * subtree AND re-files every entry beneath it, and "moved 3" when 40 items changed
 * track is exactly the surprise this app exists to prevent. `trackChanged` is what
 * distinguishes a reorder-shaped move within one track from the one worth warning
 * about beforehand.
 */
export interface MapNodeMoveResult {
  /** Nodes whose row was rewritten — the subtree, including the node itself. */
  nodes: number
  /** Entries re-filed onto the destination track. Zero for a same-track move. */
  entries: number
  /** Whether the subtree changed track. */
  trackChanged: boolean
}

/** The editable half of a node kind. `sort_order` is `reorderMapNodeKinds`' job. */
export interface MapNodeKindInput {
  name: string
  nameAr: string
}

/**
 * The editable half of a use case.
 *
 * `hidden` is OPTIONAL and permanently so, for `TrackInput.groupId`'s reason:
 * `updateUseCase` patches only the keys it is handed, so `undefined` carries its own
 * meaning here — "leave the visibility alone" — which is what the rename form wants
 * and what the hide toggle does not.
 */
export interface UseCaseInput {
  name: string
  nameAr: string
  hidden?: boolean
}

/**
 * How many rows still point at a node, for the delete confirmation. `TrackUsage`'s
 * job, one level down.
 *
 * ALL THREE COUNTS ARE DIRECT, not recursive, and the delete flow depends on that
 * being true: the database refuses to delete a node that still has children, so
 * `children` is the number the admin has to clear first, and a descendant count
 * would tell them to clear more than the guard actually asks for.
 */
export interface MapNodeUsage {
  /** Entries filed directly on this node (`entries.node_id`). */
  entries: number
  /** Nodes whose `parent_id` is this node. */
  children: number
  /** Rows in `map_node_use_cases` for this node. */
  useCases: number
}

/**
 * map_node_stages — the onboarding ladder a node climbs (0026). Not started →
 * Kickoff → Integrating → Testing/UAT → Go-live ready → Live → Paused.
 *
 * THE COLUMN LIST IS 0026's, NOT A DESIGN'S. Every field below is one the
 * migration creates, spelled the way it spells it, and there is no `updated_by` —
 * `map_node_kinds` carries none either and this table copies it.
 *
 * NO COLOUR COLUMN, and 0026's probe 1 fails the migration if one ever appears:
 * colour on this map means TRACK at every depth, the map's two visual variables
 * are already spent, and an ORDERED list draws as position rather than hue.
 *
 * Member-read, `structure.edit`-write, AUDITED — renaming a rung restates what
 * every portfolio count MEANS, which is exactly the change one person makes with
 * nobody watching.
 */
export interface MapNodeStage {
  id: string
  name: string
  /**
   * `not null default ''`, and SEEDED BLANK for all seven rungs on purpose —
   * those words are the programme's own vocabulary and Aziz translates them
   * himself. Fall back to `name` when EMPTY, not when null (`stageLabel`).
   */
  name_ar: string
  sort_order: number
  /**
   * `use_cases.hidden`'s contract: the rung leaves the pickers and never
   * un-stages the organizations already standing on it.
   */
  hidden: boolean
  /**
   * An organization at this stage HAS ARRIVED. The portfolio's live count is
   * `count(*) where terminal` and NEVER a comparison against the word "Live" —
   * lib/mapNodes.ts's "the terminal status is a parameter, never the literal"
   * promoted from a TS constant to a column the admin owns. Deliberately not
   * derived from the highest `sort_order`, because that is draggable.
   */
  terminal: boolean
  /**
   * The clock is deliberately stopped here. lib/lifecycle.ts's `isAtRisk` counts
   * a node only when NOT terminal and NOT paused, so "blocked on the customer
   * since March" is a fact somebody recorded rather than an alarm the app raises
   * every morning.
   */
  paused: boolean
  /**
   * How long a node is expected to sit on this rung before it counts as stalled,
   * bounded 1..3650 by `map_node_stages_expected_days_chk`.
   *
   * NULL IS THE ORDINARY STATE AND THE SEEDED STATE — 0026 sets it on no row,
   * which is 0003's SLA-off reasoning: a threshold nobody chose is a number the
   * app would then chase people with. `resolveStallDays` reads it.
   */
  expected_days: number | null
  created_at: string
  updated_at: string
  created_by: string | null
}

/**
 * The editable half of a stage — a form's view-model, camelCase, hand-mapped to
 * 0026's snake_case columns by api/map.ts exactly as `MapNodeKindInput` is.
 *
 * `sortOrder` is absent for `MapNodeKindInput`'s reason: ordering is
 * `reorderMapNodeStages`' job, and on this table it is a heavier operation than
 * it looks — reordering the ladder restates every count-form goal.
 *
 * The last four are OPTIONAL and permanently so, for `UseCaseInput.hidden`'s
 * reason: `updateMapNodeStage` patches only the keys it is handed, so
 * `undefined` carries its own meaning — "leave that flag alone" — which is what
 * the rename form wants and what the flag toggles do not. `expectedDays: null`
 * is a real instruction ("no expectation on this rung") and is NOT the same as
 * leaving the key off.
 */
export interface MapNodeStageInput {
  name: string
  nameAr: string
  hidden?: boolean
  terminal?: boolean
  paused?: boolean
  expectedDays?: number | null
}

/**
 * map_node_progress — which rung of the ladder one node is standing on, and
 * since when (0026).
 *
 * NO ID: `node_id` IS the primary key, at most one row per node, exactly as
 * `MapNodeUseCase` is keyed by its pair. That is also why every write is an
 * upsert on `node_id` — see `setNodeStage` in api/map.ts.
 *
 * ⚠ THE ABSENCE OF A ROW IS MEANINGFUL, AND IT IS NOT THE SAME FACT AS
 *   `stage_id: null`. No row means NOBODY HAS SAID ANYTHING YET — the state all
 *   400 imported organizations are in, because 0026 ships no backfill on
 *   purpose. `stage_id: null` means somebody looked and cleared it. Returning a
 *   node to "nobody has said" is a DELETE, not a null.
 *
 * MEMBER-WRITABLE, unlike `map_node_stages`: the owner owns the ladder, the
 * three account managers own where each organization got to.
 */
export interface MapNodeProgress {
  node_id: string
  /** The rung, or null. `on delete set null`, so retiring a rung un-stages its nodes. */
  stage_id: string | null
  /**
   * When this node arrived on its current rung — NULL exactly when `stage_id` is
   * null, which `map_node_progress_stage_chk` enforces as a backstop.
   *
   * WRITTEN ONLY BY `map_node_progress_stage_stamp()`. A value sent by a client
   * is OVERRULED, not rejected, so a write that carries one reads as working and
   * is not. Never send it.
   */
  stage_changed_at: string | null
  /** Server-owned, diffed by `map_node_progress_touch()`. Never send it. */
  updated_at: string
  /**
   * Who last recorded this node's position — resolved through `profiles` from
   * `auth.uid()`, never a field a screen offers. Null when the write had no JWT
   * (the SQL editor, the importer).
   */
  updated_by: string | null
}

/**
 * What retiring a rung would cost, for the delete confirmation — `MapNodeUsage`'s
 * job one table over.
 *
 * BOTH NUMBERS ARE NEEDED BEFORE THE CLICK, and neither of them blocks the
 * delete: `map_node_progress.stage_id` and `map_node_goals.stage_id` are both
 * `on delete set null`, so deleting a rung un-stages the organizations standing
 * on it and blanks the rung out of the goals that named it. Nothing is refused
 * and nothing raises — which is exactly why the sentence has to be said in
 * advance rather than discovered afterwards. `hidden` is the operation an admin
 * almost always wants instead.
 */
export interface MapNodeStageUsage {
  /** Nodes currently recorded at this stage (`map_node_progress.stage_id`). */
  progress: number
  /**
   * Goals whose target names this stage (`map_node_goals.stage_id`, 0027).
   *
   * 0 on a database where 0027 has not been applied, and that is the honest
   * answer rather than a swallowed error: a table that does not exist holds no
   * goals. api/map.ts's `countReferencing` warns to the console and answers 0.
   */
  goals: number
}
