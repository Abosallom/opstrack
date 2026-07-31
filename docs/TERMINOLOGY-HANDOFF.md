# Settings › Terminology — handoff

Branch `feat/terminology`, one commit, **not deployed and not merged**. The spec it
implements is `docs/TERMINOLOGY-SPEC.md` in the main checkout (untracked there; deliberately
not copied onto this branch, so the merge cannot collide with main adding the same file).

> "Instead of giving you feedback in the file, make a configuration page in admin settings."

Every decision below was judged against that sentence: a wording change must be self-service,
live for everyone, in both languages, with no developer and no deploy in the loop.

---

## 1. What shipped

**An override layer over `t()`, not an edit of the bundles.** Resolution is
`override[locale][key] → bundle[locale][key] → bundle.en[key] → key`. Overrides are DATA:
`label_overrides` rows, loaded at sign-in beside config and vocab, cached in `localStorage`
for first paint, pushed into `lib/i18n.ts` by `store/labels.ts`. `t()` stays synchronous and
its signature is unchanged. "Reset to default" is `delete the row`, so no copy of the shipped
string is kept anywhere to go stale.

| Piece | File |
|---|---|
| Resolution + `setOverrides()` + `shippedNode()` | `src/lib/i18n.ts` |
| The validator (placeholders, plurals, bidi, blank) | `src/lib/labelOverrides.ts` |
| Refusals rendered for a reader | `src/lib/labelErrors.ts` |
| The curated section/where map and the catalogue | `src/lib/labelSections.ts` |
| The export/import file format and its planner | `src/lib/labelIO.ts` |
| Read/write surface | `src/api/labels.ts` |
| The one writer of the live layer | `src/store/labels.ts` |
| The screen | `src/pages/settings/Terminology.tsx` + `terminology.css` (`.term-`) |
| Download / upload a wording pass | `src/components/settings/LabelIO.tsx` + `labelio.css` (`.lio-`) |
| Storage, RLS, audit, the reset RPC | `supabase/migrations/0016_label_overrides.sql` **(pending)** |

Route `/settings/terminology`, admin-gated in `App.tsx` with a member redirect, titled through
`routeTitle.ts`, reachable from the Settings admin block beside Vocabulary and from the command
palette. `store/labels.ts` is warmed in the Shell alongside config/vocab/members.

The screen's own strings are overridable like everything else — the spec asks for that
explicitly, and it is survivable because "Reset every change" sits permanently in the header.

## 2. The five hard rules, and where each one lives

1. **Placeholders.** `validateOverride()` requires exactly the shipped token set and NAMES the
   offender **with its braces** — `{name}`, the literal text to type, not `name`.
2. **Plural nodes.** Editable, one CLDR form at a time (§3 below).
3. **Bidi.** Fences are applied on save by mirroring the shipped string token by token, plus a
   digit range in Arabic. Nobody is asked to type U+2068. §6 records what is deliberately *not*
   fenced, and the UI note now promises exactly that much.
4. **The escape hatch.** Per-row Reset, and a `confirm()`-guarded "Reset every change" in the
   header with the count beside it. Both go through `reset_label_overrides()`, optimistic with
   rollback.
5. **Blank means default.** One predicate — `isBlankLabel()` in `lib/labelOverrides.ts` — used
   by all four keepers (validator, api, store cache, resolver), and matched character for
   character by `label_overrides_norm()` in 0016.

## 3. The plural decision, and why

**Plurals are editable, not read-only.** The spec allowed either.

Read-only was the cheap answer and it fails the sentence at the top: counted strings are the
ones an ops lead most wants to reword ("3 items need you" → "3 actions need you"), so freezing
them would send exactly that change back to the developer this screen exists to remove.

What makes it safe is that **no rule lives in the screen**:

- a plural key is overridden ONE FORM AT A TIME, at `key.category` (`overrideKey()` is the only
  place that format is written, and `lib/i18n.ts`'s overlay reads it by the same lexical rule,
  so a row cannot be stored under a key nothing reads);
- `{count}` is required in a range category and optional in an exact one, taken from
  `lib/plural.ts`'s own `EXACT_CATEGORIES` — imported, never restated;
- `selectableCategories()` decides which fields exist, so an English `few` box — a string no
  reader of that language could ever be shown — is never offered;
- a bare-key override of a plural node is refused by the validator AND ignored by the resolver,
  so a row hand-edited into the table cannot freeze one grammatical number for every count.

The form is named for a reader (`A few (3–10)` / `قليل (⁦3–10⁩)`), never by its CLDR identifier.

## 4. Migration 0016 — **PENDING APPLICATION**

`supabase/migrations/0016_label_overrides.sql` has **never been run**. The Supabase management
token is revoked, so nothing on this branch could apply it. Until it is applied the feature
degrades exactly as designed: the read fails, the layer stays empty, every `t()` lands on its
shipped string, the screen still renders in full from the bundles, and only saving fails —
with a message that now says *the table is not set up* only when PostgREST actually says so.

**It is 0016, not 0015 as the spec says**: `0015_entry_write_guard_and_line_authorship.sql` was
taken while this branch was being built. There is no ordering dependency beyond "after 0003".

### Copy-paste steps for the owner

1. Open the Supabase dashboard for project `lrysgpbkmuqgzsjesfkr` → **SQL Editor** → **New query**.
2. Open `supabase/migrations/0016_label_overrides.sql` and copy **the whole file**.
3. Paste and press **Run**.
4. Read the **Notices** panel. Three lines must appear, one per probe:
   - `OpsTrack 0016 probe 1: blank normalised to null … Rolled back.`
   - `OpsTrack 0016 probe 2: all nine real key shapes accepted … Rolled back.`
   - `OpsTrack 0016 probe 3: a member read the override … Rolled back.`
     (or `probe 3 SKIPPED`, if the editor's role cannot `set role authenticated` — the policies
     are still installed; verify by hand as the notice describes.)
5. Any `OpsTrack 0016 FAILED:` message rolls the **whole** migration back. The text names what
   broke and what it means for the owner; nothing is half-applied.
6. Re-running the file at any time is safe and changes no stored override in either direction.
7. Then reload the app and open **Settings › Terminology**. Rename one label, save, and check it
   on another device — that round trip is the feature.

The file is re-runnable from the top in any partial state: `create table if not exists`, `add
column if not exists`, `drop constraint/policy/trigger if exists` before every add, `create or
replace` on every function, and probes that roll themselves back.

**What has already been proved, so "pending" is not read as "unverified":** the three functions
that need no Supabase machinery — `label_overrides_norm()`, `label_overrides_touch()`,
`label_overrides_prune_empty()` — were extracted from the file *by text* and run against a real
Postgres (pglite 0.5.4) on 2026-07-31 together with probe 1's fixtures. Every blank shape was
normalised to null and pruned, a soft hyphen inside a real word survived unchanged,
`'  Assigned  to  '` stored as `'Assigned  to'`, a one-sided override survived clearing the
other language, and clearing both removed the row. RLS, the audit trail and the reset RPC still
wait on the SQL Editor — that is what probes 2 and 3 are for.

## 5. What this pass fixed (the seal)

Ten findings were handed over; all ten were verified against the branch, and all ten were real.

| # | Fix | Root |
|---|---|---|
| 1 | **Blank means default was defeated by invisible characters.** An override of a single U+200B / U+200E / U+200F / U+061C / U+2060 / U+00AD passed all four emptiness tests and rendered as a genuinely empty label — including on this screen's own Reset buttons. Now one shared `isBlankLabel()` (`stripInvisible()` + `trim()`), used by the validator, the api, the store cache and the resolver, and mirrored exactly by 0016's `label_overrides_norm()`. The migration's old `nullif(btrim(x), '')` did not even collapse a tab: one-argument `btrim` removes spaces only, measured. | `lib/bidi.ts`, `lib/labelOverrides.ts`, `lib/i18n.ts`, `store/labels.ts`, `api/labels.ts`, `lib/labelIO.ts`, `0016` |
| 2 | **`listOverrides()` was the only unbounded read in `src/api`.** A complete wording pass is ~2,100 rows (1,670 keys, 91 plural nodes) and the import path can write them all at once; PostgREST's 1000-row ceiling would have silently dropped everything after `followups.showAll` — in the live layer, the cache, the header count and the export. Now paged with `.range()` to a 4-page cap, returning `{rows, truncated}`; a clipped read is applied but never stamped and never cached. | `api/labels.ts`, `store/labels.ts` |
| 3 | **Placeholder refusals named the token without its braces** — "put `name` back", while `errTokenUnknown` ended "braces and all". | `lib/labelOverrides.ts` |
| 4 | **The raw CLDR category leaked into owner-facing errors** — an untranslated `few` inside an Arabic sentence, naming a field by a word that appears nowhere in the UI. Both render sites now go through one helper that swaps in the form's own name. | new `lib/labelErrors.ts`, `Terminology.tsx`, `LabelIO.tsx` |
| 5 | **The bidi note promised more than the save delivered.** Both bundles reworded to the truth, and the one literal that genuinely reorders — a digit range in Arabic, `3–10` laid out as `10–3` — is now fenced (idempotently, FSI, `ar` only). | `lib/labelOverrides.ts`, both `terminology.json` |
| 6 | **THE BIGGEST ONE: search only ever matched the SHIPPED wording.** Rename "Follow-ups" to "My Desk", come back next week, type the only name the app still shows you, and the answer was "Nothing matches My Desk" — the screen worked the first time and stopped working the second. The match now unions the owner's own wording (`labelMatches()`, keyed on `byKey`, built once per save, zero allocation per keystroke), and both hints say so. | `lib/labelSections.ts`, `Terminology.tsx`, both `terminology.json` |
| 7 | **Twelve groups of rows were indistinguishable** — same section, same where-note, same English and same Arabic ("Details" ×2, "Open", "Closed", "Track" ×2, "Someone else", "Every day", "Discard", "{count} lines", `ahmed.otaibi`, and two recurring errors that are word-for-word identical). Where-notes refined for all of them, and a test now fails on any future collision. | `lib/labelSections.ts`, both `terminology.json` |
| 8 | **`loadLabels()` returned the in-flight promise before honouring `force`,** so the invalidate every mutation ends with could be swallowed — "Reset every change" could be undone by a read that predated it, and re-cached. `force` now chains a genuinely fresh read, and an epoch counter drops any response that predates a mutation. | `store/labels.ts` |
| 9 | **0016's stated contract with `pgError.ts` was unimplemented,** so an over-long paste failed as a bare 23514 and the screen told the owner the table was not installed — when it was. Both constraints mapped, `PGRST205` mapped to `common.errMissingTable`, `maxLength={4000}` on both inputs, and the "not installed" note gated on the error that actually means it. | `lib/pgError.ts`, `Terminology.tsx`, both `common.json`, both `terminology.json` |
| 10 | **`clearOverrides()` had no caller and a docstring asserting two.** Removed: it was a second door into a layer whose optimistic rollback depends on having one writer, and a sign-out clear would be wrong anyway (these are workspace-wide data, and the cache is what puts the owner's wording on the sign-in screen). `shippedKeys()` went the same way — a second walker over a tree `labelSections.ts` already walks. | `lib/i18n.ts` |

Every behavioural fix carries a regression test. Notable ones: the blank table in
`labelOverrides.test.ts` and `i18n.test.ts` now lists every invisible character *and* asserts
the escape hatch's own label survives it; `api/labels.test.ts` walks two pages and asserts the
clipped answer; `store/labels.test.ts` holds a read open across a reset-all; `labelSections.test.ts`
has the search union and the no-two-rows-alike gate; `labelErrors.test.ts` is new.

## 6. Deliberately not done

- **A general Arabic auto-isolator.** Only `{placeholders}` (mirroring the shipped string) and
  digit ranges are fenced. A heuristic that guessed at Latin words next to punctuation would be
  rewriting the owner's words on a rule no gate can review — the shipped tree gets its fences
  reviewed by `bidi.test.ts`, an override cannot. The UI note was narrowed to match instead. If
  a real case shows up, `ltrIsolate()` and a new case in `bidi.test.ts` are where it goes.
- **`LabelIO`'s `disabled` prop is still not passed.** Its contract is "true when the table is
  not installed or the reader is not an admin"; the second is impossible on this screen (the
  redirect), and the first is only knowable after a failed write, since `store/labels.ts`
  swallows a failed load by design. Now that `PGRST205` has a key of its own, a future pass
  could surface an install signal in the store and wire it.
- **`upsertOverrides()` is still two statements.** A file that both clears and sets keys can
  fail with the clears already done; `terminology.errImport` says nothing changed, which is true
  for every file that only sets keys and overstates it for the other kind. The refetch keeps the
  SCREEN honest. The fix is an RPC, which 0016 does not have and this feature does not yet need.
- **`download()` is duplicated** between `LabelIO.tsx` and `pages/settings/Export.tsx`. The only
  honest home for a shared copy is a new `lib/download.ts`, which means editing a shipped page
  from a feature branch. Dedupe candidate for after the merge.
- **The dormant `signin.username*` pair was not deleted.** `localeParity.test.ts` pins all 213
  pre-split signin keys (see `SignIn.tsx`'s DORMANT KEYS note), so instead they carry a
  where-note that tells the owner renaming them changes nothing on screen. Other dormant signin
  keys (`sendCode`, `codeSent`, `codeResent`, `errEmailRequired`, `useEmail`, `useUsername`)
  could take the same note.
- **`terminology.errLoad` / `errLoadHint` are unused.** There is no load-error banner by design
  — a failed load is not a failure the owner needs to act on. Left in place rather than deleted,
  because the two strings are the right ones the day a banner is wanted.
- **No browser verification.** The pane is shared and this assignment did not own it. The screen
  builds (`Terminology-*.js`, 37.5 kB / 10.2 kB gzip) and every gate is green, but nobody has
  looked at it in a browser on this branch. Worth doing before the owner sees it:
  `preview_start` → `http://localhost:5198/opstrack/?shell#/settings/terminology`.

## 7. Merge surface — what the orchestrator should expect

**Modified files that also exist on `main`** (conflict candidates, all small and additive):

| File | What this branch adds |
|---|---|
| `src/App.tsx` | lazy `Terminology` import, one admin-gated route, `loadLabels()` in the Shell warm-up |
| `src/pages/Settings.tsx` | one `<Section>` card in the admin block |
| `src/locales/index.ts` | the `terminology` namespace, three lines per language |
| `src/lib/routeTitle.ts` | one `startsWith('/settings/terminology')` branch, above `/settings` |
| `src/components/CommandPalette.tsx` | one entry in `ADMIN_SCREENS` |
| `src/types.ts` | `LabelOverrideRow`, `LabelOverrideMap` |
| `src/lib/i18n.ts` | **the largest edit** — the whole override layer, the revision counter, the storage guards |
| `src/lib/bidi.ts` | `stripInvisible()` (additive) |
| `src/lib/pgError.ts` | two 23514 branches and a `PGRST205` case |
| `src/locales/{en,ar}/common.json` | one key, `errMissingTable` |
| `src/lib/brand.test.ts` | the terminology export filename joins the generated-filename list |
| `docs/EXECUTION-PLAN.md` | §1.0.7 registers `.term-` and `.lio-` |

**New files** (no conflict possible): `src/lib/label{Overrides,Sections,IO,Errors}.ts` + suites,
`src/api/labels.ts` + suite, `src/store/labels.ts` + suite, `src/lib/i18n.test.ts`,
`src/pages/settings/Terminology.tsx`, `src/pages/settings/terminology.css`,
`src/components/settings/LabelIO.tsx` + `labelio.css` + suite,
`src/locales/{en,ar}/terminology.json`, `supabase/migrations/0016_label_overrides.sql`,
`docs/TERMINOLOGY-HANDOFF.md`.

**Measured against main's working tree at 2026-07-31 21:0x** (a second fleet is building
`Mindtree` there): they have `docs/EXECUTION-PLAN.md`, `src/App.tsx`,
`src/components/CommandPalette.tsx`, `src/lib/brand.test.ts`, `src/lib/routeTitle.ts`,
`src/lib/routeTitle.test.ts` and `src/locales/index.ts` open — **seven of the twelve files
above**. All seven collide in the same way and resolve the same way: each side adds a route, a
palette entry, a namespace import or a `titleKeyFor` branch, and the resolution is to keep both
in the order they appear. `src/lib/routeTitle.ts` is the one to read carefully — both branches
insert a `startsWith` branch and both must sit ABOVE the `/settings` catch-all. They also carry
`docs/TERMINOLOGY-SPEC.md` untracked, which is why this branch does not add it.

**If main touches `src/lib/i18n.ts`** the merge is worth reading rather than resolving
mechanically: this branch rewrote `notify()`, added the override layer above `resolve()` and
removed `clearOverrides()`/`shippedKeys()`.

**Anything main adds to `src/locales/` needs one line in `NAMESPACE_PLACEMENT`** — a new
namespace with no entry there is an orphan, and `labelSections.test.ts` fails by name. That is
the safety property that keeps the rename screen true as the app grows.

## 8. Gates, as run from `/Users/aziz/Claude/coretrack-terminology`

```
npx tsc -p tsconfig.app.json --noEmit   → clean
npm run lint (oxlint)                    → 0 errors, 30 warnings, all pre-existing
                                           react(only-export-components) in files this branch
                                           does not touch
npm test  (vitest run)                   → 79 files, 1991 tests, all passing
npm run build (tsc -b && vite build)     → built; Terminology-*.js 37.52 kB / 10.19 kB gzip
```

Standing greps:

```
physical CSS properties in terminology.css / labelio.css        → none
grep -rn "from '../store|from '../api" src/lib/                 → empty (layering holds)
: any | as any | @ts-expect-error in the feature's files         → none
hardcoded user-facing strings outside t() on the new screens     → none
```

Locale gates (part of the suite above): parity, reach, plural shape, bidi balance and the brand
sweep all pass, in both trees.
