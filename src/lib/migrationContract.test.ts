// The invariants in supabase/migrations that the app depends on, asserted off
// the SQL text.
//
// WHY A TEST FOR SQL NOBODY RUNS HERE. Every other migration in this project
// proves itself at apply time, with a probe block that raises and rolls back —
// which is the right shape and is the authority. It has one gap: the probes only
// ever execute in the Supabase SQL Editor, on a project whose management token
// this repo's CI does not hold. Nothing in `npm run test` has ever read a
// migration, so a regression that DELETED one of these lines would ship green
// and be discovered by a member being assigned work anonymously.
//
// So this asserts the two or three claims per file that are load-bearing for
// application behaviour, and nothing else. It is deliberately NOT a schema
// snapshot: a test that pins the whole text is a test that fails on every
// comment edit and is deleted within a month.
//
// Source is read through import.meta.glob('?raw') rather than node:fs, for the
// reason lib/localeReach.test.ts spells out: tsconfig.app.json pins
// `types: ["vite/client"]`, and adding "node" would leak node globals into the
// type space of every app file.

import { describe, expect, it } from 'vitest'

// The options object has to be an inline literal — Vite parses this statically.
const MIGRATIONS: Record<string, string> = import.meta.glob(
  '../../supabase/migrations/*.sql',
  { query: '?raw', import: 'default', eager: true },
)

/** Every migration, oldest first — the order they are applied in. */
function files(): { name: string; sql: string }[] {
  return Object.entries(MIGRATIONS)
    .map(([path, sql]) => ({ name: path.split('/').pop() ?? path, sql }))
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
}

/**
 * The body of the LAST `create or replace function` for `name`, which is the
 * definition the database ends up with.
 *
 * Terminated on the closing `$$;` rather than by brace matching, because that is
 * how every function in this schema is written and a parser that guessed would
 * be the flakiest thing in the file.
 */
function latestFunctionBody(name: string): { file: string; body: string } | null {
  let found: { file: string; body: string } | null = null
  for (const { name: file, sql } of files()) {
    const at = sql.lastIndexOf(`create or replace function public.${name}`)
    if (at === -1) continue
    const end = sql.indexOf('$$;', at)
    found = { file, body: sql.slice(at, end === -1 ? undefined : end) }
  }
  return found
}

describe('the migration set is readable at all', () => {
  it('finds the files, so nothing below can pass vacuously', () => {
    // The precise failure mode this whole file exists to avoid, applied to
    // itself: a glob that resolved to nothing would make every assertion true.
    const names = files().map((f) => f.name)
    expect(names.length).toBeGreaterThanOrEqual(15)
    expect(names[0]).toBe('0001_opstrack_core.sql')
    expect(names).toContain('0014_recurring_template_authorship.sql')
    expect(names).toContain('0015_entry_write_guard_and_line_authorship.sql')
  })
})

/**
 * FIX-BACKLOG R1-SEC-2 — work assigned to a colleague, delivered as a push, with
 * no record anywhere of who did it.
 *
 * `materialize_template()` is the "Run now" button, granted to `authenticated`
 * and reachable by any member from /settings/recurring. Its INSERT omitted
 * `created_by`; `entries.created_by` has no column default, so the row landed
 * NULL; and `entries_notify()` reads INSERT + NULL author as "the schedule did
 * it" and sends an actor-less "You were assigned ⟨title⟩".
 *
 * The three assertions below are the three halves of the fix that can be
 * checked without a database. The fourth — that the trigger and the columns
 * behave — is migration 0014's own probe blocks.
 */
describe('R1-SEC-2: a materialised entry names the person who asked for it', () => {
  it('gives "Run now" an author', () => {
    const fn = latestFunctionBody('materialize_template')
    expect(fn).not.toBeNull()
    const body = fn?.body ?? ''

    // The column has to be in the INSERT list…
    const columns = /insert into public\.entries \(([\s\S]*?)\)\s*values/.exec(body)?.[1] ?? ''
    expect(columns).toContain('created_by')

    // …and the value has to be resolved from the JWT through `profiles`, not
    // taken raw from auth.uid(): a signed-in user with no profile row would
    // violate the FK and the failure would surface as the member's button
    // simply not working.
    expect(body).toMatch(/from public\.profiles p where p\.id = auth\.uid\(\)/)
  })

  it('leaves the SCHEDULED materialiser writing NULL, which is the honest answer there', () => {
    // The counterpart, and it is not symmetry for its own sake.
    // materialize_due_recurring() runs from store/auth.ts on every sign-in, under
    // whichever member's browser happened to call it. That member is a bystander,
    // and 0004:305-321 records this as a regression already fixed once: naming
    // them made the inbox say "⟨whoever opened the app⟩ assigned you this".
    const fn = latestFunctionBody('materialize_due_recurring')
    expect(fn).not.toBeNull()
    const columns =
      /insert into public\.entries \(([\s\S]*?)\)\s*values/.exec(fn?.body ?? '')?.[1] ?? ''
    expect(columns).not.toBe('')
    expect(columns).not.toContain('created_by')
  })

  it('gives the recipe itself an author, an audit trail, and a guard over both', () => {
    // Closing only the button leaves the same hole one step slower: a member can
    // aim a template at a colleague, set next_run_on to today, and wait for the
    // scheduler to mint the identical anonymous entry. The durable answer is
    // that the row carrying the title and the owner names an author.
    const all = files().map((f) => f.sql).join('\n')

    expect(all).toMatch(
      /alter table public\.recurring_templates\s+add column if not exists created_by uuid/,
    )
    expect(all).toMatch(
      /alter table public\.recurring_templates\s+add column if not exists updated_by uuid/,
    )
    // Server-stamped, so a raw POST cannot forge them…
    expect(all).toContain('create trigger recurring_templates_guard_write_trg')
    // …and a history that survives "edit the template back", which the columns
    // alone do not: they only ever hold the latest value.
    expect(all).toContain('create trigger recurring_templates_audit_trg')
    expect(all).toMatch(/insert into public\.config_audit[\s\S]{0,400}'recurring_templates'/)
  })
})

/**
 * FIX-BACKLOG R1-DB-2 — 0004 widened `entries_update` to every member and named
 * `entry_updates` as the accountability it was traded for. The database does not
 * enforce that (0001 leaves the transition row to the app on purpose, so a
 * trigger cannot race the client's insert), and the comment used to claim it did.
 */
describe('R1-DB-2: the schema does not claim an accountability it cannot keep', () => {
  const zeroFour = (): string =>
    files().find((f) => f.name.startsWith('0004'))?.sql ?? ''

  it('no longer offers the transition row as the thing the widening bought', () => {
    // The exact sentence, not the phrase: the corrected paragraph QUOTES the old
    // claim in order to retract it, so matching the phrase alone would fail on
    // the fix itself.
    expect(zeroFour()).not.toContain(
      'no DELETE policy at all and records every status transition',
    )
    // And it says what is true instead, in the words a reader can act on.
    expect(zeroFour()).toContain('best-effort client write')
  })

  it('still has no trigger writing transition rows, which is why the app must', () => {
    // If one is ever added, src/api/entries.ts's branch has to go in the same
    // commit or every transition is recorded twice — 0001:497-499 warns about
    // exactly this, and this assertion is what makes the warning enforceable.
    const all = files().map((f) => f.sql).join('\n')
    const triggersOnEntryUpdates = [...all.matchAll(/create trigger (\w+)[\s\S]{0,120}?on public\.entry_updates/g)]
      .map((m) => m[1])
    expect(triggersOnEntryUpdates).toEqual(['entry_updates_touch_trg'])
  })
})

/**
 * FIX-BACKLOG R2-DB-1 — `entries_guard_update()` pinned `template_id` and
 * `created_by` unconditionally on every UPDATE, which included the UPDATE that
 * Postgres itself issues to honour `on delete set null`. Retiring a recurring
 * template therefore left `entries.template_id` pointing at a row that no
 * longer existed: a dangling foreign key the constraint still reports as
 * validated, so nothing detects it until a `pg_dump` reload refuses the table.
 *
 * 0015 has four probe blocks that prove the behaviour at apply time and they
 * are the authority. These assertions are the CI-side half: what they defend is
 * that nobody re-flattens the two `case` expressions back into a pin, which
 * reads like a simplification and is the whole defect.
 */
describe('R2-DB-1: the entries guard pins against clients, not against the FKs', () => {
  const guard = (): string => latestFunctionBody('entries_guard_update')?.body ?? ''

  it('lets the FK null-out through for template_id and created_by', () => {
    expect(guard()).not.toBe('')
    // The flat pin, which is what 0004 shipped and what must not come back.
    expect(guard()).not.toMatch(/new\.template_id\s*:=\s*old\.template_id\s*;/)
    expect(guard()).not.toMatch(/new\.created_by\s*:=\s*old\.created_by\s*;/)

    // …replaced by "null is only accepted when the referent is gone", which is
    // the one state a client cannot manufacture.
    for (const [col, table] of [
      ['template_id', 'recurring_templates'],
      ['created_by', 'profiles'],
    ]) {
      expect(guard()).toMatch(
        new RegExp(
          `new\\.${col} := case[\\s\\S]{0,240}?not exists \\(select 1 from public\\.${table}`,
        ),
      )
    }
  })

  it('still pins created_at outright, because no FK ever writes it', () => {
    expect(guard()).toMatch(/new\.created_at\s*:=\s*old\.created_at\s*;/)
  })

  it('pins updated_by when nothing else changed, so a bare PATCH cannot erase it', () => {
    // The diff subtracts updated_by; without the `else` the client's value is
    // simply stored, and `{"updated_by": null}` blanks the stamp on any row.
    // 0014:176-179 closed the identical hole on recurring_templates.
    expect(guard()).toMatch(/else\n[\s\S]{0,400}?new\.updated_by := old\.updated_by;\n  end if;/)
  })
})

/**
 * FIX-BACKLOG R2-DB-2 — the column guard was registered `before update` only.
 * `entries_insert` is a row-level check, so a raw POST could choose its own
 * `created_at` (an item that never breaches its SLA), `last_activity_at` (one
 * that never goes stale), or `template_id` (squatting the recurrence
 * idempotency index so a scheduled occurrence is skipped for good).
 */
describe('R2-DB-2: the same guard exists on INSERT', () => {
  const all = (): string => files().map((f) => f.sql).join('\n')

  it('registers a BEFORE INSERT trigger on entries', () => {
    expect(all()).toMatch(
      /create trigger entries_guard_insert\s+before insert on public\.entries/,
    )
  })

  it('overwrites the four clock/provenance columns a client must not choose', () => {
    const fn = latestFunctionBody('entries_guard_insert')?.body ?? ''
    expect(fn).not.toBe('')
    for (const line of [
      'new.created_at       := now();',
      'new.last_activity_at := now();',
      'new.updated_by       := null;',
      'new.template_id      := null;',
    ]) {
      expect(fn).toContain(line)
    }
  })

  it('is SECURITY INVOKER and gates on the client roles, or it breaks recurrence', () => {
    const fn = latestFunctionBody('entries_guard_insert')?.body ?? ''
    // This is the load-bearing one and it is counter-intuitive, so it gets a
    // test rather than a comment. Both materialisers write template_id under a
    // MEMBER's JWT — SECURITY DEFINER changes the role, not the request — so a
    // guard keyed on `auth.uid() is not null` alone would null the column
    // inside the scheduler, disarm entries_template_due_uidx, and mint a
    // duplicate entry for every due template on every sign-in. `current_user`
    // is what tells the two apart, and it only reports the caller when this
    // function is INVOKER.
    expect(fn).not.toMatch(/security definer/)
    expect(fn).toMatch(/current_user not in \('authenticated', 'anon', 'authenticator'\)/)
  })
})

/**
 * FIX-BACKLOG R2-SEC-2 — `meeting_lines_delete` is scoped to the author
 * because "deleting someone else's line removes it from the record with no
 * trace" (0004:112). `raw` stayed writable by any member so triage could stay
 * collaborative, and writing it EMPTY is a delete: lineItem() returns null for
 * an empty line, so the sentence leaves the minutes, the clipboard copy and the
 * export. Nothing recorded who did it, either — meeting_lines had no
 * updated_by in any of the first fourteen migrations.
 */
describe('R2-SEC-2: a meeting line cannot be erased, and names its last editor', () => {
  const guard = (): string => latestFunctionBody('meeting_lines_guard_update')?.body ?? ''
  const all = (): string => files().map((f) => f.sql).join('\n')

  it('refuses to let a client blank a non-empty line', () => {
    expect(guard()).toMatch(/btrim\(new\.raw\) = ''\s+and btrim\(old\.raw\) <> ''/)
    expect(guard()).toContain('new.raw := old.raw;')
  })

  it('keeps 0008 four pins, which is what makes the delete policy enforceable', () => {
    for (const col of ['id', 'meeting_id', 'created_by', 'created_at']) {
      expect(guard()).toMatch(new RegExp(`new\\.${col}\\s+:= old\\.${col};`))
    }
  })

  it('gives the line an updated_by column, stamped from the JWT and unerasable', () => {
    expect(all()).toMatch(
      /alter table public\.meeting_lines add column if not exists updated_by uuid/,
    )
    expect(guard()).toMatch(/from public\.profiles p where p\.id = auth\.uid\(\)/)
    expect(guard()).toMatch(/else\n[\s\S]{0,400}?new\.updated_by := old\.updated_by;\n  end if;/)
  })

  it('appends the previous wording to config_audit when the text changes', () => {
    // The column alone only ever holds the latest editor, which does not
    // survive "reword it, then reword it back" — the same threat 0014 answered
    // for recurring_templates.
    expect(all()).toMatch(
      /create trigger meeting_lines_audit_trg\s+after update on public\.meeting_lines/,
    )
    const fn = latestFunctionBody('meeting_lines_audit')?.body ?? ''
    expect(fn).toMatch(/if new\.raw is distinct from old\.raw then/)
    expect(fn).toMatch(/insert into public\.config_audit[\s\S]{0,300}'meeting_lines'/)
    // Directly, not through log_config_audit(), whose is_admin() guard would
    // 42501 every ordinary member's triage edit (0002:345-348, 0014:209-216).
    expect(fn).not.toContain('log_config_audit')
  })

  it('subtracts updated_by from meeting_lines_touch, which is 0007 lesson', () => {
    // The guard sorts first by name and writes updated_by into NEW; a diff that
    // counted it would treat the stamp about the write as evidence of a write.
    const touch = latestFunctionBody('meeting_lines_touch')?.body ?? ''
    expect(touch).toContain("- 'updated_by'")
  })
})

/**
 * FIX-BACKLOG R3-SEC-1 — a member could permanently rename themselves to a
 * colleague. `profiles_update` lets them write their own row, and
 * `guard_profile_role()` was the only column-level control on the table and
 * pinned `role` alone. Attribution resolves the LIVE profile everywhere
 * (0011:309 for push, store/members.ts:136, NotificationBell.tsx:145) — the
 * mitigation 0004:196-207 built against a TRANSIENT rename — so a permanent one
 * renders the impersonated name on every surface, including lock screens.
 */
describe('R3-SEC-1: a display name is not a self-service field', () => {
  const guard = (): string => latestFunctionBody('guard_profile_role')?.body ?? ''

  it('pins display_name and created_at against any writer holding a JWT', () => {
    expect(guard()).not.toBe('')
    expect(guard()).toMatch(/new\.display_name\s*:=\s*old\.display_name\s*;/)
    expect(guard()).toMatch(/new\.created_at\s*:=\s*old\.created_at\s*;/)
  })

  it('keeps both pins inside the auth.uid() test, or nobody can be provisioned', () => {
    // The JWT-less paths — admin-members on the service role, the SQL Editor —
    // are the two writers that are SUPPOSED to set a name. 0001's header
    // records what happens without this test: the write is silently reverted,
    // the statement still reports success, and no admin can ever be created.
    const body = guard()
    const at = body.indexOf('if auth.uid() is not null')
    expect(at).toBeGreaterThan(-1)
    expect(body.indexOf('new.display_name := old.display_name;')).toBeGreaterThan(at)
    expect(body.indexOf('new.created_at := old.created_at;')).toBeGreaterThan(at)
  })

  it('leaves locale alone, which is the only column the app writes', () => {
    // src/store/settings.ts:66-69 is `update({ locale })`. A pin here would
    // make the language toggle stop persisting with no error anywhere.
    expect(guard()).not.toContain('new.locale')
  })

  it('still pins role for a non-admin, which this file rewrote around', () => {
    expect(guard()).toMatch(
      /new\.role is distinct from old\.role[\s\S]{0,120}?not public\.is_admin\(\)[\s\S]{0,120}?new\.role := old\.role;/,
    )
  })
})

/**
 * FIX-BACKLOG R3-DB-2 — `entries_guard_update()` pinned created_at, created_by,
 * template_id and updated_by but not `closed_at`, and `entries_touch()` writes
 * that column only on a status change. So a one-column PATCH re-dated a closed
 * entry — moving it into or out of throughput (aggregate.ts:264), SLA
 * compliance (:444) and the digest's Closed section (digest/build.ts:202) with
 * no status change, no thread row, and nothing on any screen naming who did it.
 */
describe('R3-DB-2: a close date cannot be chosen by a client', () => {
  const guard = (): string => latestFunctionBody('entries_guard_update')?.body ?? ''
  const touch = (): string => latestFunctionBody('entries_touch')?.body ?? ''

  it('pins closed_at outright — no FK writes it, so no `case` exception', () => {
    expect(guard()).not.toBe('')
    expect(guard()).toMatch(/new\.closed_at\s*:=\s*old\.closed_at\s*;/)
  })

  it('leaves the transition itself to entries_touch, which runs after the guard', () => {
    // The pin is only safe because `entries_guard_update` sorts before
    // `entries_touch_trg`. If this block ever leaves entries_touch(), closing an
    // item stops recording when it closed and the closed list empties out.
    expect(touch()).toMatch(/if new\.status is distinct from old\.status then/)
    expect(touch()).toContain('new.closed_at := coalesce(new.closed_at, now());')
    expect(touch()).toContain('new.closed_at := null;')
  })
})

/**
 * FIX-BACKLOG R3-LEAD-1 — measured live: an entry reading `New · 33d · Stale ·
 * Unassigned` left Follow-ups the moment an owner was picked, because
 * `entries_touch()`'s activity diff subtracted `track_id` and not the owner
 * pair. 0007:84-86 states the principle ("a stale item stays stale through a
 * move") and applied it to the track move only; 0012:191-208 calls an owner
 * change "the 0007 failure class exactly" and defends only the member-deletion
 * path. Delegating a neglected item erased the evidence it was neglected.
 */
describe('R3-LEAD-1: a handover is bookkeeping, not activity', () => {
  const body = (): string => latestFunctionBody('entries_touch')?.body ?? ''

  /** The two diffs, split on the statement that ends the first one. */
  function diffs(): { bookkeeping: string; activity: string } {
    const src = body()
    const firstEnd = src.indexOf('new.updated_at := now();')
    const secondEnd = src.indexOf('new.last_activity_at := now();')
    expect(firstEnd).toBeGreaterThan(-1)
    expect(secondEnd).toBeGreaterThan(firstEnd)
    return {
      bookkeeping: src.slice(0, firstEnd),
      activity: src.slice(firstEnd, secondEnd),
    }
  }

  it('subtracts BOTH owner columns from the activity diff', () => {
    // owner_name as well as owner_id, because entries_single_owner forbids
    // holding both: assigning a teammate clears the free-text name in the same
    // statement (api/entries.ts:445-454), so subtracting one leaves every real
    // assignment still bumping the clock through the other.
    expect(diffs().activity).toContain("- 'owner_id'")
    expect(diffs().activity).toContain("- 'owner_name'")
    // …and 0002's original, which this sits beside rather than replaces.
    expect(diffs().activity).toContain("- 'track_id'")
  })

  it('does NOT subtract them from the bookkeeping diff, so updated_at still moves', () => {
    // The handover must remain visible: updated_at ticks, entries_notify()
    // still tells the new owner. Only the staleness clock holds.
    expect(diffs().bookkeeping).not.toContain("- 'owner_id'")
    expect(diffs().bookkeeping).not.toContain("- 'owner_name'")
    expect(diffs().bookkeeping).not.toContain("- 'track_id'")
  })

  it('keeps the three server-bookkeeping columns out of both diffs', () => {
    // 0007's fix, which a rewrite of this function is the obvious way to lose.
    for (const col of ['updated_at', 'last_activity_at', 'updated_by']) {
      expect(diffs().bookkeeping).toContain(`- '${col}'`)
      expect(diffs().activity).toContain(`- '${col}'`)
    }
  })
})

/**
 * 0030 — `map_view_settings`, the one row that says how the map draws.
 *
 * The file's own three probe blocks are the authority and they run in the SQL
 * Editor. These are the CI-side half, and they defend the two decisions in that
 * file that a later reader is most likely to "tidy": the single-value CHECK on
 * `colour_by`, which reads like an oversight and is a deliberate register of the
 * fact that exactly one hue source exists; and the shape-only CHECK on
 * `node_fields`, which reads like an omission and is the layering 0028 argued
 * for at length — the database checks shape, the client drops and counts.
 */
describe('0030: the map view settings singleton stays inside the map\'s own refusals', () => {
  const sql = (): string => files().find((f) => f.name === '0030_map_view_settings.sql')?.sql ?? ''

  it('exists, so nothing below passes vacuously', () => {
    // The same guard the top of this file applies to the glob, applied to one
    // file: a rename would otherwise make both assertions below trivially true.
    expect(sql()).not.toBe('')
  })

  it('colour_by cannot name a hue source that does not exist', () => {
    // model.ts:71-79 "COLOUR IS INHERITED, NEVER PICKED" and 0023:49-55's refusal:
    // the CHECK widens only in the migration that ships a second source. Widened
    // hopefully — `in ('track','kind','stage')` — it lets a save name a source
    // nothing can resolve, and the map renders colourless with no error anywhere.
    expect(sql()).toMatch(/check \(colour_by in \('track'\)\)/)
  })

  it('node_fields is shape-checked and never vocabulary-checked', () => {
    // 0028's status_map layering: the DATABASE checks shape, the CLIENT drops and
    // counts. A CHECK on the field names could only refuse, and the day the field
    // list changes it makes the saved row unwritable AND the fix unreachable,
    // because the screen's save carries the whole object it is replacing.
    expect(sql()).toContain("jsonb_typeof(node_fields) = 'object'")
    expect(sql()).not.toMatch(/node_fields[\s\S]{0,200}?jsonb_path_exists/)
  })
})
