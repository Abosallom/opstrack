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
  sort_order: number
  archived: boolean
  /** Maintained by the tracks_touch() trigger in both directions from `archived`. */
  archived_at: string | null
  created_by: string | null
  created_at: string
  updated_at: string
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
}
