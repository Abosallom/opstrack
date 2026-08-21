// The saved Jira reading configuration — one row, read and written here.
//
// WHAT THIS MODULE IS FOR. Settings › Jira can point at a real Jira and show
// what comes back, and until 0028 nothing it was told survived a reload: the
// field mapping, the status words and the JQL were React state and `jira.notSaved`
// said so on screen. This is the other half — the one row (0028), loaded once
// with the rest of the configuration (src/store/config.ts) and saved from the
// Jira screen.
//
// ERRORS HERE ARE i18n KEYS, NOT SENTENCES — api/map.ts's rule verbatim and for
// its stated reason: an Arabic-only admin operating this screen must not be
// shown a Postgres constraint identifier printed left-to-right.
//
// ⚠ AND NO REFUSAL EVER ECHOES WHAT IT REFUSED. `pgErrorKey` hands back a key
//   and interpolates nothing, which is what makes that rule hold here for free —
//   but it is a rule and not an accident, so it is written down: this module
//   never logs, returns or renders `site_base_url`, the JQL or any saved value
//   on a failure path. A screen that helpfully prints back what it just refused
//   prints it into a shared browser, a screenshot and a support ticket. The same
//   discipline is being applied to the `jira-read` function's own base-url
//   refusal this wave; describe the SHAPE of a bad value, never the value.
//
// ═══ status_map IS VALIDATED ON READ, AND UNKNOWN VALUES ARE DROPPED AND
//     COUNTED — NEVER COERCED ═══
//
// `status_map` is `jsonb`: keys are HIS status words (unbounded free text on his
// own board) and values are OUR three (`UseCaseStatus`). 0028 deliberately puts
// NO check constraint on the values, and the reason is the failure the
// coded-values report predicted in as many words:
//
//   "if the stage ladder replaces the 3-status union, statusMap's value type
//    changes and every saved mapping in JiraAdmin is invalidated —
//    statusMapConflicts() will not catch that, because the KEYS still normalise
//    fine."
//
// A CHECK constraint could only REFUSE, and on that day it would make the saved
// row unwritable and the fix ("open the screen and re-pick") unreachable. So the
// database checks the SHAPE and this module checks the VOCABULARY, in the one
// place that can degrade gracefully:
//
//   * a value that is one of ours is kept;
//   * a value that is not is DROPPED, and the drop is COUNTED and returned;
//   * nothing is ever mapped to a neighbouring meaning. Coercing an unreadable
//     'in-review' to 'testing' would put a status on a hospital's integration
//     record that nobody chose, and it would look exactly like a mapping the
//     owner made.
//
// The count is the product, not a diagnostic: the Settings card and the Jira
// screen say "N saved status words no longer mean anything here" so the owner
// knows to go and re-pick them, instead of watching every issue report as
// "status not mapped" and wondering what broke.

import { supabase } from './supabase'
import { fail, notConfigured, type ApiResult } from './result'
import { pgErrorKey } from '../lib/pgError'
import type { UseCaseStatus } from '../types'

/**
 * The id of the one row, and the same constant 0028 checks.
 *
 * SENT ON EVERY WRITE rather than left to the column default, so the two halves
 * name the same row in the same words: `jira_settings_singleton_chk` refuses
 * anything else, and a drift between this file and the migration is a grep
 * rather than a mystery. See 0028's header for why the key is a uuid (the audit
 * table's `row_id` is one) and not the text 'jira'.
 */
export const JIRA_SETTINGS_ID = '00000000-0000-0000-0000-000000000028'

/** The three states this app records, as a runtime list rather than a type alone. */
const STATUSES: readonly UseCaseStatus[] = ['planned', 'testing', 'live']

/**
 * The columns, by name.
 *
 * NAMED RATHER THAN `*`, api/map.ts's LINK_COLUMNS rule: the type below cannot
 * drift from the query when 0028's table gains a column, and a read that
 * silently started carrying a new field would be a field nothing validates.
 */
const SETTINGS_COLUMNS =
  'id, site_base_url, organization_field, use_case_field, status_field, status_map, fold_arabic, jql, enabled, updated_at, updated_by'

/**
 * The saved configuration, camelCase because it is what screens hold.
 *
 * DELIBERATELY SHAPED SO `JiraFieldMapping` (src/lib/jira/types.ts) FALLS OUT OF
 * IT: `organizationField`, `useCaseField`, `statusField`, `statusMap`,
 * `siteBaseUrl` and `foldArabic` are that interface's own field names, so the
 * mapper takes this object without a translation layer between them. `jql` and
 * `enabled` are ours alone — the mapper has no opinion about which issues to ask
 * for or whether the feature is on.
 */
export interface JiraSettings {
  siteBaseUrl: string | null
  organizationField: string
  useCaseField: string
  statusField: string
  statusMap: Record<string, UseCaseStatus>
  foldArabic: boolean
  jql: string
  /**
   * THE OFF-SWITCH. False by default at the database (0028) and false whenever
   * this row has never been written. Read it through `useJiraEnabled()` and
   * nowhere else, so there is one answer.
   */
  enabled: boolean
  updatedAt: string | null
  updatedBy: string | null
}

/**
 * What a read of the configuration produced.
 *
 * TWO FIELDS, BECAUSE THE DROP IS PART OF THE ANSWER AND NOT A SIDE EFFECT.
 * `settings` is null when nobody has saved anything yet — a state the screens
 * name ("not set up yet") rather than showing as an empty form indistinguishable
 * from one somebody cleared. `droppedStatuses` is how many saved status words
 * carried a value this app no longer knows; they were left out, never guessed at.
 */
export interface JiraSettingsRead {
  settings: JiraSettings | null
  droppedStatuses: number
}

/** The editable half — every field the Jira screen can save. */
export type JiraSettingsInput = Omit<JiraSettings, 'updatedAt' | 'updatedBy'>

/** The row shape 0028 stores, before it is read into `JiraSettings`. */
interface JiraSettingsRow {
  id?: unknown
  site_base_url?: unknown
  organization_field?: unknown
  use_case_field?: unknown
  status_field?: unknown
  status_map?: unknown
  fold_arabic?: unknown
  jql?: unknown
  enabled?: unknown
  updated_at?: unknown
  updated_by?: unknown
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function nullableText(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

/**
 * `status_map` → the pairs this app can act on, plus how many it could not.
 *
 * THE ONE FUNCTION THIS MODULE EXISTS FOR. Exported so its behaviour is pinned
 * by a test directly rather than through a fake PostgREST chain, and so a future
 * reader looking for "where do unknown statuses go" finds a named answer.
 *
 * WHAT IT REFUSES TO DO, in order of how tempting each is:
 *
 *   * it does not COERCE. An unknown value is dropped, never nudged into the
 *     nearest of ours. The nearest of ours is a status on a hospital's
 *     integration record that nobody chose.
 *   * it does not DROP SILENTLY. Every dropped pair is counted and the count is
 *     returned, because the fix is a person re-picking a word on a screen and
 *     nobody re-picks a word they were never told about.
 *   * it does not NORMALISE THE KEYS. The keys are his words; matching them
 *     against a Jira status is `normalizeName`'s job in the mapper, where the
 *     conflict between two keys that normalise alike is reported rather than
 *     resolved by whichever happened to be last.
 *
 * A `status_map` that is not an object at all yields an empty mapping and a
 * count of zero, and that is honest rather than lazy: there are no PAIRS to
 * count, and 0028's `jira_settings_status_map_chk` makes the state unreachable
 * through the database in the first place.
 */
export function readStatusMap(raw: unknown): {
  statusMap: Record<string, UseCaseStatus>
  dropped: number
} {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { statusMap: {}, dropped: 0 }
  }
  const statusMap: Record<string, UseCaseStatus> = {}
  let dropped = 0
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value === 'string' && (STATUSES as readonly string[]).includes(value)) {
      statusMap[key] = value as UseCaseStatus
      continue
    }
    dropped += 1
  }
  return { statusMap, dropped }
}

/**
 * One row → the settings a screen holds, with the drop count beside it.
 *
 * Every field is read defensively for the reason `readRowCache` gives one layer
 * up: the realistic corruption is a row written by an older column set, and a
 * missing boolean must read as false rather than as undefined leaking into a
 * `checked` prop.
 */
function readRow(row: JiraSettingsRow): JiraSettingsRead {
  const { statusMap, dropped } = readStatusMap(row.status_map)
  return {
    settings: {
      siteBaseUrl: nullableText(row.site_base_url),
      organizationField: text(row.organization_field),
      useCaseField: text(row.use_case_field),
      statusField: text(row.status_field),
      statusMap,
      foldArabic: row.fold_arabic === true,
      jql: text(row.jql),
      // STRICT EQUALITY, NOT TRUTHINESS. The off-switch fails closed: anything
      // that is not literally `true` — absent, null, the string 'false' out of
      // some future cache — means Jira is off.
      enabled: row.enabled === true,
      updatedAt: nullableText(row.updated_at),
      updatedBy: nullableText(row.updated_by),
    },
    droppedStatuses: dropped,
  }
}

/**
 * Load the saved configuration. Resolves with `settings: null` when nobody has
 * saved one yet.
 *
 * `maybeSingle`, not `single`: PostgREST's `.single()` treats zero rows as the
 * error PGRST116, and "nobody has configured Jira" is the ORDINARY state of this
 * table — the state it ships in — not a failure. Reporting it as one would put a
 * red banner on the Settings page of every workspace that has never used Jira.
 *
 * ⚠ A MISSING TABLE IS A FAILURE, AND THE STORE IS WHAT MAKES IT HARMLESS.
 *   On a project where 0028 has not been applied this returns
 *   `common.errMissingTable` (pgError.ts maps PGRST205), and src/store/config.ts
 *   keeps `jiraSettings` null — so `useJiraEnabled()` answers false and every
 *   Jira surface stays absent. The off-switch fails closed through the failure
 *   path as well as the happy one, which is the property that makes shipping
 *   this client half before the migration is applied safe.
 */
export async function loadJiraSettings(): Promise<ApiResult<JiraSettingsRead>> {
  if (!supabase) return notConfigured()
  const { data, error } = await supabase
    .from('jira_settings')
    .select(SETTINGS_COLUMNS)
    .eq('id', JIRA_SETTINGS_ID)
    .maybeSingle()
  if (error) return fail(pgErrorKey(error))
  if (!data) return { ok: true, data: { settings: null, droppedStatuses: 0 } }
  return { ok: true, data: readRow(data as JiraSettingsRow) }
}

/**
 * Save the configuration. Resolves with the row as it was STORED, re-read
 * through the same validator.
 *
 * UPSERT ON THE SINGLETON KEY, never `insert`: there is one row and no caller
 * should have to know whether it exists yet. 0028's `jira_settings_pkey` would
 * otherwise raise 23505 on the second save of the workspace's life, which is a
 * failure the person saving cannot act on.
 *
 * THE ANSWER IS THE STORED ROW AND NOT THE INPUT, and that is the difference
 * between a screen that shows what it saved and one that shows what it sent.
 * `updated_at`/`updated_by` are the trigger's (0028), and `status_map` goes
 * through `readRow` on the way back, so a value the database accepted and this
 * app cannot use is reported as dropped HERE — at the moment of saving, where
 * the person can still fix it — rather than on the next load.
 *
 * `updated_at`/`updated_by` are NOT sent. They are server-owned; 0028's touch
 * trigger overrules a client value on insert and pins it back on a no-op save,
 * so sending them would be ceremony that the database undoes.
 */
export async function saveJiraSettings(
  input: JiraSettingsInput,
): Promise<ApiResult<JiraSettingsRead>> {
  if (!supabase) return notConfigured()

  const siteBaseUrl = input.siteBaseUrl?.trim() ?? ''
  const { data, error } = await supabase
    .from('jira_settings')
    .upsert(
      {
        id: JIRA_SETTINGS_ID,
        // Blank goes in as NULL, api/labels.ts's rule: `''` and null would be
        // two ways to say "no site address", and 0028's CHECK only admits one
        // of them.
        site_base_url: siteBaseUrl.length > 0 ? siteBaseUrl : null,
        organization_field: input.organizationField.trim(),
        use_case_field: input.useCaseField.trim(),
        status_field: input.statusField.trim(),
        // Sent as given. The keys are his words and the values were picked from
        // our own three by a `<select>`; this function does not re-validate what
        // the screen offered, it validates what came BACK.
        status_map: input.statusMap,
        fold_arabic: input.foldArabic,
        // NOT trimmed. JQL is a query language where leading whitespace is
        // meaningless but trailing content is not, and rewriting what somebody
        // typed into a query box is how a screen stops being trustworthy. 0028
        // bounds the length; it does not edit the text.
        jql: input.jql,
        enabled: input.enabled,
      },
      { onConflict: 'id' },
    )
    .select(SETTINGS_COLUMNS)
    .single()
  if (error) return fail(pgErrorKey(error))
  return { ok: true, data: readRow(data as JiraSettingsRow) }
}
