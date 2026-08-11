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
  role: UserRole
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
