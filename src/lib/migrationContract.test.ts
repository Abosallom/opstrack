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
