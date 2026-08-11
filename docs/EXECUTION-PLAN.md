# CoreTrack — Final Execution Plan (merged, critique-applied)

**Document precedence, binding on every worker.** This document supersedes the three source designs. Where it is silent, `/Users/aziz/Claude/opstrack-prompt.md` (the 9-phase spec) governs *behaviour*, and the previously approved plan `/Users/aziz/.claude/plans/sparkling-wibbling-umbrella.md` governs *decisions already made*. No worker may rename, relocate, or re-shape anything in §2. A worker that believes a contract is wrong records the gap and hands it to the wave integrator; it does not edit another worker's file.

**Global invariants (unchanged, hard).** React 19 + TS strict + zustand + react-router v7 · plain co-located CSS, logical properties only (the repo has ZERO physical layout props — keep it that way) · every user-visible string through `t()` with en/ar parity · the Supabase client is nullable and guarded at the top of every api function · **no new runtime dependencies**; exactly one new devDependency, `vitest` · `ApiResult<T>` from `src/api/result.ts` · DB errors → i18n keys via `pgErrorKey()` · narrow-selector zustand hooks · `confirm()` from `components/Confirm.tsx` · `radioGroup` helper for pickers · `trackVars()` CSS-var colour pairs.

**Verified ground truth** (I re-ran these against the repo; do not re-litigate): `entries.description text not null default ''` (0001:304) · `entries_update = created_by ∨ owner_id ∨ is_admin()` (0001:369-376) · `entry_updates` has no UPDATE/DELETE policy (0001:415) · `v_entry_health` is followed by `alter view … security_invoker = on` **and** `grant select … to authenticated` (0001:548-550) · 0001 seeds **five** tracks with `name_ar` = `مكتب إدارة المشاريع` / `عمليات تقنية المعلومات` / `الشبكات` / `البنية التحتية` / `هندسة موثوقية الأنظمة` (0001:204-210) — **not** the values the contracts doc's parser fixtures used · locales are 213/213 at exact parity, roots `app nav route signin settings admin placeholder offline pwa common status priority type health` · `.entry-title` already exists in `global.css:284` as a typography rule · `.offline-banner-count` exists (`app-shell.css:413`) · `tsconfig.app.json` = `types:["vite/client"]`, `include:["src"]`, `noUnusedLocals`/`noUnusedParameters`/`verbatimModuleSyntax` all on · `tsconfig.node.json` includes only `vite.config.ts` · `.oxlintrc.json` ignores `supabase/functions`, `no-unused-vars: error` · `api/entries.ts` writes `description: input.description ?? null` — a guaranteed 23502 on every create.

---

## 1. WAVE PLAN

### 1.0 Ownership rules that make the parallelism safe

1. **One owner per file per wave.** Ownership *transfers* between waves; it never overlaps within one.
2. **Integrator-only files, always:** `src/App.tsx`, `src/main.tsx`, `vite.config.ts`, `index.html`, `src/locales/index.ts` (after Wave 1), `src/locales/en/settings.json` + `ar/settings.json` + `admin.json` (after Wave 1). Feature workers build self-contained modules and hand the integrator a diff.
3. **Frozen after Wave 1:** `src/styles/global.css` (except the Wave 5 auditor) and `src/types.ts` (append-only thereafter, and only by the wave integrator).
4. **Extension slot.** A worker short one api function does **not** edit another's file. It records the gap in its handoff; the integrator applies it during the close. This is the pressure valve for §7 risk 1.
5. **Skeleton convention (literal).** `export function f(_a: A, _b: B): R { throw new Error('TODO') }` — underscore-prefixed params satisfy `noUnusedParameters` and oxlint; a throwing body satisfies any return type. Barrels must re-export types with `export type { … }` (`verbatimModuleSyntax: true`).
6. **Tests import explicitly** — `import { describe, it, expect } from 'vitest'`. No globals config; nothing is added to `tsconfig.app.json`'s `types` array.
7. **CSS prefix registry.** Each co-located sheet owns exactly one prefix and may not style another's, nor a `global.css` primitive:
   `global.css` → the primitives already there **plus** `.kanban-* .chart-* .segmented* .triage-* .rail-* .swipe-* .dnd-* .print-*`; it **retains `.entry-title`** as a typography primitive (carve-out — `entry.css` must not restyle it).
   `entry.css` → `.entry-row* .entry-card* .entry-sheet* .upd-* .status-pill .prio-dot .health-pill .age-pill .owner-badge .tag-chip .due-label .track-ref .link-list*` · `sheet.css → .sheetx-*` · `fields.css → .fld-*` · `pickers.css → .pick-*` · `filters.css → .flt-*` · `capture.css → .cap-*` · `followups.css → .fu-*` · `board.css → .bd-*` · `tracks.css → .tl-*` · `meetings.css → .mt-*` · `dashboard.css → .db-*` · `charts.css → .cht-*` · `digest.css → .dg-*` · `vocab.css → .vocab-*` · `members.css → .mem-*` · `cmd.css → .cmd-*`.
   **Added at the Wave-2 close** (two sheets the wave plan did not anticipate, registered here per §1.0.4 rather than folded into a neighbour's prefix): `entry-page.css → .epg-*` — the `/entry/:id` page frame, distinct from `entry.css`, which owns the detail component the frame wraps · `track-sla.css → .tsla-*` — the SLA-override matrix inside TrackEditor, kept out of `admin.css` because it is the one part of that screen writing a second table (`track_slas`).
   **Added with the Mindtree:** `mindtree.css → .mtree-*` — the map, its nodes and edges, and its accessible table. **`.mtree-`, not `.mt-`:** `meetings.css` already owns `.mt-*`, and MINDTREE-SPEC's own file list said `.mt-*` before catching it in the next sentence. One sheet for three files (`pages/Mindtree.tsx`, `components/mindtree/MindNode.tsx` + `MindEdge.tsx`, `components/mindtree/MindtreeTable.tsx`) because they exist only inside this feature and three sheets would have to agree about the same six variables — §1.0.4 is the rule against that.

   **Added by the interactive Mindtree** (six co-located sheets under `src/components/mindtree/`, each owning a **disjoint slice of the same `.mtree-` prefix**). This is a deliberate exception to "one prefix per sheet", and it is the narrower reading rather than a wider one: the prefix still has exactly one owner — the feature — and each sheet's slice is named in its own header and in `mindtree.css`'s. The alternative, six new top-level prefixes for one screen, would spend six registry entries on components that cannot exist outside it. `pages/mindtree.css` keeps `.mtree-node* .mtree-edge* .mtree-tbl* .mtree-selbar*` and the screen frame; no rule in it may name a sibling's classes and no rule in a sibling may name its. · `drag-layer.css → .mtree-drag-*` — the ghost, the drop-target outlines, the refusal chip and the keyboard bar. Its own sheet because the ghost is `position: fixed` HTML that must escape `.mtree-canvas`'s `overflow: hidden`, which is the one rule in the page's sheet it could never live under · `node-menu.css → .mtree-menu*` — the actions panel and its sub-menus · `quick-add.css → .mtree-qa*` — the "add an item here" form. Kept out of `.mtree-menu*` because it owns a text input and a submit loop that the menu knows nothing about, exactly as `labelio.css` was kept out of `terminology.css` · `node-card.css → .mtree-card*` — the hover/focus detail card · `breadcrumb.css → .mtree-crumbbar*` — the drill-in trail. **`-crumbbar` and not `-crumb`** because `mindtree.css` owned `.mtree-crumbs`/`.mtree-crumb-sep` for the page's first hand-rolled trail; those two rules were **deleted at the integration** and the deletion is recorded in place · `pulse-layer.css → .mtree-pulses .mtree-pulse .mtree-ghost` — the watch layer's marks. Everything in it is about TIME, and `mindtree.css`'s MOTION paragraph is only half the answer without it.
   **Added by the App Store readiness pass** (one sheet): `privacy.css → .pv-*` — the privacy policy page. Registered rather than folded into `signin.css` or `claim.css` because it is the only route in the app that renders on BOTH sides of the auth gate: signed out it owns a full-viewport frame the way those two do, signed in it is a plain column inside the shell, and neither of them could grow the other half without one of its rules reaching a screen it does not own.

   **Added by the map decomposition** (`src/components/map/`, continuing the disjoint-slice exception the interactive Mindtree established above — the prefix still has exactly one owner, the feature): `map-list.css → .mtree-list-*` — the list rendering of the same tree, and the split wrapper the page puts it in. · **`.mcap-*` is RESERVED, not yet registered**, and this line exists so nobody claims it: `components/map/MapCapture.tsx` renders about thirty `.mcap-` classes and imports a `map-capture.css` THAT DOES NOT EXIST. The component is unreferenced, so nothing resolves that import and no gate catches it — see docs/MAP-UNFINISHED.md. Whoever wires capture onto the canvas writes that sheet and converts this sentence into a real entry.

   **Added by Settings › Terminology** (docs/TERMINOLOGY-SPEC.md; two sheets, because the screen and its file-transfer block are two components with two lifetimes): `terminology.css → .term-*` — the label editor: the search box, the seven collapsible sections, and the row/slot editor with its two inputs · `labelio.css → .lio-*` — the export/import card at the foot of that screen, kept out of `.term-` because it owns a file picker, a rejection report and a state machine that the row editor knows nothing about, and because it is the piece most likely to be reused when the wording pass moves to another workspace.
   **Added by Phase A** (0018–0021; three sheets, one per feature, none of them folded into a neighbour): `groups.css → .grp-*` — Settings › Groups: the two group cards with their palette and reorder controls, and the per-track group `<select>` beneath them. Kept out of `admin.css` for the reason `track-sla.css` was: it is the part of the settings tree writing a SECOND table (`track_groups`), and it owns a colour-pair invariant no other admin screen has · `nudge.css → .ndg-*` — the ask and the record of one (`components/entry/NudgeButton.tsx`). NOT in `entry.css`, which owns the row and the sheet as SURFACES: this is one control that appears inside three of them and must ink to whatever it is dropped into, which is why the screen's difference arrives as a `className` prop (`fu-act`) and this sheet never names a screen · `ai-suggest.css → .ais-*` — the capture assist. **One sheet, two consumers** (`components/capture/AiSuggestion.tsx` and `pages/settings/AiSettings.tsx`) on the §1.0.4 rule the Mindtree cites: the row and the settings screen render the same Preview badge, the same privacy statement and the same disclosure tone, and two sheets would have to agree about the same variables forever.

   **Added at the Wave-5 hardening audit** (`global.css` primitives, registered here rather than left implicit): `.tap-44` — the 44px block-axis hit-area overlay, promoted out of four hand-copied duplicates (`.btn-sm`, `.chip`, `signin.css .signin-reveal`, `claim.css .claim-reveal`), all four of which shared a `-6px` inset that resolved against the padding box and shipped a 42px target · `--vocab-ink` — the AA-safe reading of an admin-chosen hex used as text, consumed by `.status-pill`, `.vocab-pill`, `.bd-col-title`, `.bd-rail`, `.bd-overflow-label`.

### 1.1 Audit/fix cadence — identical in every wave

Each wave runs **build → integrate → audit → fix → gate**:

- **T0 build.** Workers run in parallel on disjoint file sets. Each ends with a handoff note: files touched, contracts consumed, gaps found, locale keys requested.
- **T1 integrate (1 worker).** Merges, wires routes/`App.tsx`/`main.tsx`/`vite.config.ts`, applies extension-slot additions and requested locale keys into the integrator-owned namespaces, runs `npm run lint && npm run build && npm run test`.
- **T2 audit (1 worker per ~3 builders; never a builder auditing own files).** Runs the wave's audit checklist (listed per wave below) plus the four standing greps, on every wave:
  `grep -nE '\b(width|height|left|right|margin-left|margin-right|padding-left|padding-right)\s*:' src/**/*.css` → **must be empty**;
  `grep -rn "from '\.\./store\|from '\.\./api" src/lib/` → **must be empty** (layering rule);
  hardcoded user-facing strings in JSX outside `t()`;
  `any` / `@ts-expect-error`.
  The auditor **reports**, does not fix.
- **T3 fix (1 worker).** Applies audit findings only. No new features.
- **T4 gate.** The named acceptance gate is re-run from scratch after the fix pass. A wave closes only on a green gate; **no wave closes on unverified migrations** (this is why Wave 0 exists).

Wave 0 is verify-only (1 verifier, no audit/fix pair). Wave 5 *is* the audit, so its pair is integrate+fix.

### 1.2 Phase → wave map (publish this; it was only implicit before)

| Spec unit | Wave |
|---|---|
| Sitting 2 (vocab table, view rewrite, vocabulary editor) | schema+store **W1**, editor UI **W2** |
| Phase 2 (entries CRUD, detail sheet, update thread, realtime) | store/api **W1**, screens **W2** |
| Phase 3 (capture parser + vitest) | parser **W1**, capture screen **W2** |
| Phase 4 (follow-ups home) | **W2** |
| Phase 5 (board) | **W2**; (per-track timeline) **W3** |
| Phase 6 (meeting mode) | **W3** |
| Phase 7 (recurring templates UI) | **W3** |
| Phase 8 (dashboard + digest) | **W3** |
| Phase 9 (offline outbox, PWA, palette, member admin, export) | **W4**; (RTL/a11y audit, seed verification, release) **W5** |

---

### WAVE 0 — Live spine

**Goal.** A real repo, a real Supabase project, a green pipeline, and a signed-in admin on the live URL — **before any feature code**. Every later gate is written as "prove it against the real project"; that is impossible if the project is created last. This also converts deploy day from a big-bang risk into a smoke test.

| Worker | Owns (exact) | Consumes |
|---|---|---|
| **W0-REL** | `git` init + first commit · `gh repo create Abosallom/opstrack` · `.github/workflows/deploy.yml` (the three Wave-0 edits below) · `.gitignore` verification · repo secrets · local `.env` | repo as-is |

Owner-paired browser steps (cannot be automated) are enumerated in §5 S1–S10.

**`deploy.yml` — three edits land in the Wave-0 commit, not later.** (a) `concurrency.cancel-in-progress: true → false` (cancelling mid-`deploy-pages` wedges the Pages deployment and the *next* run fails); (b) a fail-fast secret-presence step before `npm run build` — without it a missing secret produces a *successful* build that can never sign in, and it reads like a Supabase outage; (c) Pages enabled deterministically via `gh api -X POST repos/Abosallom/opstrack/pages -f build_type=workflow` rather than relying on `configure-pages@v5 enablement: true`, which can 403 on a fresh repo. `npm run test` is added to the workflow in Wave 1 by W1-I18N, not here.

**Acceptance gate.** (a) `git log` shows one commit; `git ls-files | grep -iE '\.env|key|secret'` returns only `.env.example`; `git check-ignore -v .env dist node_modules` prints the matching rules. (b) Actions run green with both secrets present. (c) The Pages URL serves the built app; `curl -s …/manifest.webmanifest` returns JSON, not the SPA fallback. (d) OTP sign-in completes from the owner's phone on the deployed URL. (e) `select u.email, p.role from public.profiles p join auth.users u on u.id=p.id;` returns exactly one row, `role='admin'` — **pasted SQL-editor output, not an assertion**. (f) 0001 and 0002 each re-run cleanly a second time. (g) `admin-members` invoked twice (the first call cold-starts and may time out once).

**Commit message.** `chore: initial import — schema 0001+0002, app shell, track manager`

---

### WAVE 1 — Foundations

**Goal.** Every surface waves 2–4 share, proven against the live project. This wave exists so Waves 2 and 3 can be 5–6 wide with zero shared files.

**Keystone step (serial, ~60–90 min, before the other five start).** Waves' 8-wide risk model rests on a `tsc -b` handshake that cannot run while `types.ts` and `api/entries.ts` are unwritten. So:

1. **W1-I18N** publishes: `tsconfig.app.json` + `tsconfig.node.json` changes (add `vitest.config.ts` to the node project's `include`), `vitest.config.ts`, `package.json` (`"test": "vitest run"`, `"seed": "node scripts/seed.mjs"`, vitest devDep), the locale directory tree + `src/locales/index.ts` + a passing empty parity test.
2. **W1-DOMAIN** publishes **final** `src/types.ts` (additions in §2.1) plus throwing skeletons for `lib/health.ts`, `lib/entryFilter.ts`, `lib/entrySections.ts`, `lib/permissions.ts`, `lib/vocabStyle.ts`, `store/vocab.ts`, `api/config.ts`.
3. **W1-DATA** publishes throwing skeletons for `api/entries.ts`, `api/members.ts`, `api/realtime.ts`, `store/entries.ts`, `store/outbox.ts`, `store/members.ts`, `store/entrySheet.ts`.
4. **W1-PARSE** publishes `src/lib/text.ts` **complete** (not a skeleton — W1-DOMAIN's `entryFilter` needs `normalizeSearch` the same day) plus a `lib/dates.ts` skeleton.
5. **W1-CSS** publishes the class-name registry as a comment block at the head of `global.css` (names only, no rules).

Integrator runs `tsc -b && npm run lint && npm run test`. Green → the remaining workers start. This converts the wave's biggest risk from "we hope the doc held" into a gate, at a cost of one hour on a six-gate critical path.

| Worker | Owns (exact paths) | Consumes |
|---|---|---|
| **W1-DB** | `supabase/migrations/0003_vocab_options.sql`, `supabase/migrations/0004_workspace_data.sql`, `scripts/seed.mjs`, `ADMIN.md` | live project (W0) |
| **W1-I18N** | `src/lib/i18n.ts`, `src/locales/**` (tree, `index.ts`, the shared namespace set), `src/locales/locales.test.ts`, `package.json`, `package-lock.json`, `vitest.config.ts`, `tsconfig.app.json`, `tsconfig.node.json`, `.github/workflows/deploy.yml` | §4 |
| **W1-CSS** | `src/styles/global.css`, `src/app-shell.css` | §1.0.7 registry |
| **W1-UI** | `src/components/icons.tsx` (all ~25 new glyphs, enumerated up front so no later wave touches this file), `src/components/shared.tsx`, `src/components/Sheet.tsx`+`sheet.css`, `src/components/fields/*`+`fields.css`, `src/components/pickers/*`+`pickers.css`, `src/components/filters/FilterBar.tsx`+`filters.css`, `src/lib/radioGroup.ts` | W1-CSS registry, `lib/entryFilter.FilterState` |
| **W1-PARSE** | `src/lib/text.ts`, `src/lib/dates.ts`+`dates.test.ts`, `src/lib/capture/grammar.ts`, `src/lib/capture/parse.ts`+`parse.test.ts` | §2.5, §2.6 |
| **W1-DOMAIN** | `src/types.ts`, `src/lib/health.ts`+test, `src/lib/entryFilter.ts`+test, `src/lib/entrySections.ts`+test, `src/lib/permissions.ts`, `src/lib/labels.ts`, `src/lib/pgError.ts`, `src/lib/vocabStyle.ts`, `src/api/config.ts`, `src/api/tracks.ts` (adds `suggestedTags`), `src/store/vocab.ts`+test, `src/store/config.ts`, `src/pages/settings/TrackEditor.tsx` (adds the suggested-tags field) | 0003/0004 shapes (§3) |
| **W1-DATA** | `src/api/entries.ts`, `src/api/members.ts`, `src/api/realtime.ts`, `src/store/entries.ts`, `src/store/outbox.ts`, `src/store/members.ts`, `src/store/entrySheet.ts`, `src/lib/cache.ts` | W1-DOMAIN types |
| **W1-KIT** | `src/components/entry/*` (15 exports, §2.4) + `src/components/entry/entry.css` + `src/components/entry/index.ts`, `src/locales/{en,ar}/entry.json` | W1-CSS, W1-DOMAIN, W1-UI |

**Acceptance gate.** (a) `npm run build && npm run lint && npm run test` green. (b) 0003 and 0004 applied **twice** to the live project, no error. (c) SQL proofs pasted: `v_entry_health` honours a *changed* `stale_after_days` (edit a priority row, re-query, revert); **`select * from public.v_entry_health limit 1` executed as a plain member succeeds** (proves the `security_invoker` + `grant` were re-applied after the `drop view`); six tracks present with `suggested_tags={direct-integration,portal}` on Onboarding; `materialize_template` creates exactly one entry and is idempotent; `meeting_lines` RLS rejects a cross-user delete; the vocab "last visible option" trigger raises `23514/last_visible_option`. (d) **One real `createEntry()` round-trip against the live project succeeds** (this is the 23502 regression test). (e) `npm run seed` populates ~35 entries with varied ages/owners/statuses/tags across all six tracks, creates **no tracks**, and refuses to re-run against a non-empty `entries` table without `--force`. (f) Locale parity test: 0 missing / 0 extra per namespace pair, no duplicate root across files, no empty values, `{token}` sets identical per key, and **all 213 pre-existing keys present** (fixture list). (g) `health.ts` matches `v_entry_health` on a fixed injected `now` with UTC-anchored fixtures; the live comparison tolerates **±1 day** on `days_since_activity` and the tolerance is documented in `health.test.ts`'s header. (h) Parser tests: every token kind, every AR alias, the ten worked examples, and a 500-string fuzz pass asserting `parse()` never throws and every token's `[start,end)` slices back to its `raw`. (i) **`grep` proof that every track name/`name_ar` used in `parse.test.ts` is byte-identical to the seed values in 0001/0004.** (j) The four standing greps clean. (k) `git diff package.json` shows exactly one added dependency: `vitest`, in devDependencies. (l) Every Wave-1 module is exercised by a test or reachable in the `?shell` dev harness.

**Commit message.** `feat(foundations): vocab options + view rewrite, locale split, entry kit, entries store + write seam`

---

### WAVE 2 — Entry interaction

**Goal.** The product becomes usable: capture → follow-ups → detail → board. All five workers are decoupled by `openEntry()` and by routes; none imports another's module.

| Worker | Owns | Consumes |
|---|---|---|
| **W2-DETAIL** | `src/pages/Entry.tsx`+`entry-page.css`, `src/components/entry/EntrySheet.tsx`, `src/components/entry/UpdateThread.tsx` (both transferred from W1-KIT), `src/locales/{en,ar}/entry.json` (transferred) | Sheet/fields/pickers (W1-UI), `store/entries`, `store/entrySheet`, `api/realtime`, kit atoms |
| **W2-CAPTURE** | `src/pages/Capture.tsx`+`capture.css`, `src/locales/{en,ar}/capture.json` | `lib/capture/parse`, `lib/dates`, `store/entries.createEntryOptimistic`, `store/outbox`, toast |
| **W2-FOLLOWUPS** | `src/pages/FollowUps.tsx`+`followups.css`, `src/locales/{en,ar}/followups.json` | `lib/entrySections.bucketFollowUps`, `useHealthMap`, FilterBar, kit, `openEntry` |
| **W2-BOARD** | `src/pages/Board.tsx`+`board.css`, `src/lib/dnd.ts`, `src/locales/{en,ar}/board.json` | as above, plus `useVocab('status')` for column order/visibility |
| **W2-VOCABUI** | `src/pages/settings/VocabularyAdmin.tsx`+`vocab.css`, `src/locales/{en,ar}/vocabadmin.json` | `api/config`, `store/vocab`, `Confirm`, `radioGroup`, `vocabVars` |

Integrator owns `App.tsx` (routes `/entry/:id`, `/settings/vocabulary` + `titleKeyFor()` branches, longest-prefix-first **before** the `/settings/tracks` checks), `Settings.tsx` and `settings.json`/`admin.json` additions.

**Acceptance gate.** (a) build/lint/test green. (b) Full round trip on the live project: capture → the row appears in the correct follow-ups section → open detail → inline-edit a field → change status → the auto-written transition row is visible in the thread **and** in SQL. (c) Realtime proven with two browser sessions side by side, including the "updated by ⟨name⟩" flash and its 8 s TTL. (d) Capture parses the full token set in EN and AR and writes a correct row, under 5 s from keystroke to cleared input. (e) Board drag changes status **and** the keyboard-only path (menu button on every card) does the same, with a visible focus ring and an `aria-live` announcement. (f) **Permission behaviour matches the DB**: with `ENTRIES_UPDATE_IS_OPEN=false`, a member sees another member's card as non-draggable with a disabled affordance and no toast; with `true`, the drag succeeds. Whichever branch shipped, the *other* is exercised once by temporarily flipping the constant in a dev build. (g) Editing a vocab label re-labels historical `status_from`/`status_to` in the thread with **zero writes** — prove it (the frozen-key payoff). (h) `entry_updates` immutability re-proven from the client: a PATCH and a DELETE are both rejected, and the assertion is on a **re-read** of `body`, not on the HTTP status. (i) Every screen screenshotted EN and AR at 375 px and 1280 px; swipe directions mirror correctly in RTL. (j) Standing greps clean.

**Commit message.** `feat(entries): detail sheet + thread, quick capture, follow-ups, board, vocabulary admin`

---

### WAVE 3 — Aggregate and long-form screens

**Goal.** Everything that reads across many entries. Six workers, fully parallel — meeting mode, dashboard, digest, timeline and templates share only Wave-1 surfaces and Wave-2's detail panel *by route/store, not by import*. W3-MEETING is split in two (it was the acknowledged pace-setter and there is budget).

| Worker | Owns | Consumes |
|---|---|---|
| **W3-MEET-LIVE** | `src/pages/meetings/MeetingsIndex.tsx`, `src/pages/meetings/MeetingLive.tsx`, `src/pages/meetings/MeetingTriage.tsx`, `src/pages/meetings/meetings.css`, `src/api/meetings.ts`, `src/store/meetings.ts`, `src/locales/{en,ar}/meeting.json` | `meeting_lines` (0004), parser, pickers, outbox |
| **W3-MEET-MIN** | `src/pages/meetings/MeetingMinutes.tsx`, `src/lib/minutes.ts`+test | `api/meetings` read surface (contract), `lib/dates`, `lib/text` |
| **W3-TIMELINE** | `src/pages/Tracks.tsx`+`tracks.css`, `src/api/timeline.ts`, `src/lib/timeline.ts`+test, `src/locales/{en,ar}/track.json` | entries api, kit, `tracks.suggested_tags` for the tag breakdown |
| **W3-TEMPLATES** | `src/pages/settings/RecurringAdmin.tsx`+`recurring.css`, `src/api/templates.ts`, `src/lib/recurrence.ts`+test, `src/locales/{en,ar}/recurring.json` | `materialize_template` (0004), `materialize_due_recurring` (0001) |
| **W3-DASH** | `src/pages/Dashboard.tsx`+`dashboard.css`, `src/components/charts/*`+`charts.css`, `src/lib/aggregate.ts`+test, `src/locales/{en,ar}/dashboard.json` | entries api, `lib/health`, W1-CSS chart primitives |
| **W3-DIGEST** | `src/lib/digest/{types,build,markdown,plain,html,index}.ts`+tests, `src/api/digestCollect.ts`, `src/pages/Digest.tsx`+`digest.css`, `src/locales/{en,ar}/digest.json` | `lib/entrySections`, `lib/labels.trackLabel` (bare), `store/vocab.getVocabSnapshot`, `store/members.getMembersSnapshot`, `lib/dates` |

Integrator owns `App.tsx` (`/meetings/:id`, `/digest`, `/settings/recurring`), `Settings.tsx`, `settings.json`/`admin.json`/`nav.json`/`route.json` additions.

**Acceptance gate.** (a) build/lint/test green. (b) A real meeting run end to end on the live project: 10 lines captured live (**each persisted to `meeting_lines` as typed — kill the tab mid-meeting and reload; nothing is lost**), triaged with "same as above" quick-fill, bulk-committed via `commitMeetingLines` into 10 entries linked to the meeting, 2 discarded lines still present as notes, minutes copied to clipboard and pasted correctly in EN and AR. (c) Dashboard numbers reconciled against SQL — every chart total re-derived with a query, not eyeballed. (d) Digest output diffed against the spec §4.7 sample in all three formats × both languages, with the Onboarding tag breakdown present, and **an Arabic digest generated while the UI is in English** (proves no renderer calls `t()` or a store). (e) Timeline interleaves entries and updates in correct order under a date range + search, verified against SQL. (f) "Run now" creates exactly one entry and does not corrupt `next_run_on`; `lib/recurrence.ts` matches `advance_recurrence` across month-end and leap-year fixtures. (g) All screens EN/AR at 375/1280; print stylesheet checked for minutes and digest. (h) Standing greps clean.

**Commit message.** `feat(aggregate): meeting mode, track timeline, recurring templates, dashboard, digest`

---

### WAVE 4 — Platform polish

**Goal.** Offline, keyboard, member administration, export. The Wave-1 write seam pays off here: `store/outbox.ts` gains persistence and retry behind an unchanged signature — **`store/entries.ts` does not change**.

| Worker | Owns | Consumes |
|---|---|---|
| **W4-KEYS** | `src/lib/hotkeys.ts`, `src/components/CommandPalette.tsx`+`cmd.css`, `src/components/Cheatsheet.tsx`, `src/locales/{en,ar}/cmd.json` | every route from waves 2–3; `store/entries` for palette search |
| **W4-OFFLINE** | `src/store/outbox.ts` (transferred), `src/lib/offline.ts`, `src/lib/cache.ts` (transferred), `src/components/OfflineBanner.tsx`+`offline-banner.css`, `src/locales/{en,ar}/offline.json` | the Wave-1 seam. **Hands the `main.tsx` and `vite.config.ts` diffs to the integrator** |
| **W4-ADMIN** | `src/pages/settings/Members.tsx`+`members.css`, `src/pages/settings/Export.tsx`, `src/lib/export.ts`+test, `supabase/functions/admin-members/index.ts`, `src/locales/{en,ar}/members.json` | edge function (deployed W0) |

Integrator owns `App.tsx` (`/settings/members`), `main.tsx` (SW registration + `flushOutbox` wiring), `vite.config.ts`, `Settings.tsx`.

**Acceptance gate.** (a) build/lint/test green. (b) Airplane-mode test on the owner's phone against the *installed* PWA: app opens, reads from cache, three captures + two updates queue with a visible pending count in `.offline-banner-count`, all five flush on reconnect and appear in SQL **exactly once** — no duplicates, no lost writes, and a `create → update` pair lands in dependency order with the temp id rewritten. (c) Last-write-wins verified on a deliberate two-device conflict on the same entry field. (d) Every spec shortcut (`C / Cmd+K / J / K / E / U / 1-4 / Esc / ?`) works, is listed in the cheatsheet, and the palette reaches any track, entry or action. (e) An admin creates and removes a member through the edge function; a **member** account is proven unable to (403/42501, not a hidden button). (f) **The edge function is redeployed after modification and invoked twice** — it is the one file no lint or `tsc` covers (`.oxlintrc.json` ignores `supabase/functions`; `tsconfig.app.json` is `src`-only). (g) **The `ADMIN_EMAILS` hardcode is resolved**: either the gate becomes a service-role `profiles.role='admin'` lookup, or it stays an allow-list and `README.md:80-81`, `README.md:121` and the function's own header comment are corrected in the same commit. A second admin promoted via `profiles.role` must either be able to provision members or the limitation must be documented in `ADMIN.md`. (h) JSON and CSV export round-trip with Arabic text, commas and newlines intact. (i) PWA update prompt appears on a new deploy and applies only on tap.

**Commit message.** `feat(platform): offline outbox + PWA, command palette, member admin, export`

---

### WAVE 5 — Hardening and release

**Goal.** Ship it. Two workers, **serial** — the auditor owns the whole repo by definition and cannot share a wave.

| Worker | Owns | Job |
|---|---|---|
| **W5-AUDIT** | whole repo (read + fix) | RTL/a11y/contrast sweep on every screen: logical-properties grep still zero; `src/lib/**` imports nothing from `store/`/`api/`; no hardcoded user-facing string; no `any`; keyboard reachability and a visible focus ring on every interactive element; `aria-live` on toasts and board moves; WCAG AA for `--text-dim`/`--text-faint` against **every** elevation surface in both themes (not just `--bg`); `prefers-reduced-motion` honoured incl. the flash fade; 44 px touch targets; safe-area insets in both orientations; duplicate co-located CSS promoted into `global.css` (the only wave permitted to touch it) |
| **W5-RELEASE** | `README.md`, `ADMIN.md`, `package.json` version, git tag | Final live smoke (§5), install on the owner's phone, docs reconciled against what shipped, `v1.0.0` tag |

**Acceptance gate.** Every screen × both languages × both themes × 375 px and 1280 px; a keyboard-only pass and a screen-reader pass; the owner completes one real capture-to-digest cycle on his phone against the live deployment; CI green on the tagged commit; `ADMIN.md`'s first-admin order matches §5 S8 (the current "sign in once" instruction is **impossible** with `shouldCreateUser:false`).

**Commit message.** `chore(release): RTL/a11y audit fixes, docs, v1.0.0`

---

### 1.3 Critical path and budget

`W0 spine → W1 (DATA/DOMAIN/KIT) → W2-DETAIL → W3-MEET-LIVE → W4-OFFLINE → W5-AUDIT → W5-RELEASE` — six sequential gates. Pace-setters: W1 → W1-DB and W1-CSS (tie; both publish contracts the whole wave reads); W2 → W2-DETAIL; W3 → W3-MEET-LIVE; W4 → W4-OFFLINE; W5 → the audit.

| Wave | Builders | Closers (integrate/audit/fix) | Subtotal |
|---|---|---|---|
| 0 | 1 | 1 (verify only) | 2 |
| 1 | 8 | 3 | 11 |
| 2 | 5 | 3 | 8 |
| 3 | 6 | 3 | 9 |
| 4 | 3 | 3 | 6 |
| 5 | 2 | 2 | 4 |
| **Total** | **25** | **15** | **40** |

Five spare slots, deliberately unspent — reserve them for a second fix pass on Wave 1 or Wave 3.

---

## 2. SHARED CONTRACTS

Frozen. Add to them; never rename or re-shape. Three global rules:
**(1) One import path per concept** — `FilterState` only from `src/lib/entryFilter.ts`; entry components only from `src/components/entry` (the barrel); date formatting only from `src/lib/dates.ts` (a component calling `toLocaleDateString()` is a bug).
**(2) Pure logic in `src/lib/`, state in `src/store/`, I/O in `src/api/`.** `src/lib/**` must not import from `src/store/**` or `src/api/**` — only `types.ts`, `lib/i18n.ts`, and other `lib/`. This is mechanically enforced by the standing grep and is what makes the parser, dates, health, filter, sections, aggregate and digest vitest-testable with zero mocking.
**(3) All writes funnel through `src/store/outbox.ts`.** `store/entries.ts` never calls `api/entries.ts` for a mutation. Wave 1 ships the funnel with a pass-through transport; Wave 4 adds persistence and retry behind the same signature. `src/api/mutate.ts` **does not exist** — it is deleted from the plan.

### 2.1 `src/types.ts` additions (W1-DOMAIN, keystone)

```ts
// Track gains one column (0004):
suggested_tags: string[]           // `not null default '{}'`
// TrackInput gains:  suggestedTags: string[]

export type VocabKind = 'status' | 'priority' | 'type'
export interface VocabRow {
  kind: VocabKind; key: string
  label: string; label_ar: string            // both `not null default ''`
  color: string | null; sort_order: number; hidden: boolean
  stale_after_days: number | null             // priority rows only
  updated_at: string; updated_by: string | null
}
export type MeetingLineState = 'pending' | 'committed' | 'discarded' | 'note'
export interface MeetingLine {
  id: string; meeting_id: string; seq: number
  raw: string; parsed: Record<string, unknown> | null
  state: MeetingLineState; entry_id: string | null
  created_by: string | null; created_at: string; updated_at: string
}
```
The four unions (`EntryType`, `EntryStatus`, `EntryPriority`, `HealthLevel`) and `UserRole`, `Cadence` stay **frozen**. Vocabulary makes keys renameable and recolourable; the keys themselves never change.

### 2.2 Write seam — `src/store/outbox.ts` (W1-DATA; transferred to W4-OFFLINE)

The op envelope carries everything needed to replay a write later without the caller knowing — this is the single point the whole offline story rests on.

```ts
export type MutTable =
  | 'entries' | 'entry_updates' | 'meetings' | 'meeting_lines'
  | 'recurring_templates' | 'vocab_options' | 'tracks'

export interface MutOp<P = unknown> {
  table: MutTable
  op: 'insert' | 'update' | 'delete'
  /** Target row id for update/delete; null for insert. */
  id: string | null
  /** Client-minted id for insert, so dependent ops can reference the row
   *  before the server replies. `TEMP_PREFIX + crypto.randomUUID()`. */
  tempId: string | null
  payload: P
  /** Collapses repeated edits of the same target while queued.
   *  Convention: `${table}:${op}:${id ?? tempId}:${sortedPayloadKeys}`. */
  dedupeKey: string
  /** Temp ids that must land first (e.g. an update on a not-yet-created entry). */
  dependsOn: string[]
}

export interface OutboxItem { id: string; op: MutOp; attempts: number; queuedAt: number; error: string | null }

/** THE only write path. Never throws. Returns i18n KEYS on failure.
 *  Wave 1: online → transport call; offline → queue + `fail('offline.queued')`. */
export function submit<T>(op: MutOp): Promise<ApiResult<T>>
export function useOutbox(): OutboxItem[]
export function usePendingCount(): number      // feeds .offline-banner-count
export function flushOutbox(): Promise<void>   // W4: on 'online' and on app focus
export function discardOutboxItem(id: string): void
export function resetOutbox(): void
export const TEMP_PREFIX = 'temp_'
export function isTempId(id: string): boolean
```

**Transport registry.** A static `Record<`​`${MutTable}:${op}`​`, (op: MutOp) => Promise<ApiResult<unknown>>>` inside `outbox.ts`, importing the `api/*` write functions directly. `store → api` is the allowed direction; `api → store` is not. Wave 4 adds `localStorage` persistence (`opstrack_outbox_v1`), exponential backoff, temp-id rewriting, and `dependsOn` ordering **inside this file only**. Conflict rule (spec §6): last-write-wins on entry fields; updates never conflict.

### 2.3 `src/store/entries.ts` (W1-DATA)

**Fetch strategy — decided, and it overrides the "full filter surface" brief.** The dataset is a small trusted team's ops log (low thousands of rows, full read visibility under RLS). Therefore **one working-set fetch, client-side filtering everywhere**. Screens do **not** issue per-filter queries. This is the single decision that stops five agents writing five query builders. `api/entries.ts` therefore exposes exactly the loaders below and nothing more.

```ts
interface EntriesState {
  byId: Map<string, Entry>              // canonical rows, incl. optimistic temp rows
  list: Entry[]                         // derived ONCE per write, last_activity_at desc, reference-stable
  health: Map<string, EntryHealth>
  updates: Map<string, EntryUpdate[]>   // per entry, created_at asc, lazily loaded
  updatesLoading: Set<string>
  pending: Map<string, PendingOp>
  flash: Map<string, FlashMark>
  coverage: EntriesCoverage
  loading: boolean
  error: string | null                  // i18n KEY
}
```
`derive()` recomputes `list` from `byId` on every write, exactly as `store/config.ts` does. **Never build an array or Map inside a selector** — that is the `getSnapshot should be cached` infinite-loop hazard documented in `config.ts`. Cache key `opstrack_entries_v1`, debounced 1 s, read at module init for first paint; `STALE_AFTER_MS = 45_000` with the same `window.addEventListener('focus')` refetch gate.

```ts
export type ApplySource = 'fetch' | 'realtime' | 'local' | 'outbox'
export interface PendingOp { id: string; kind: 'create'|'patch'|'update'; since: number; error: string|null; queued: boolean }
export interface FlashMark { actorId: string|null; actorName: string|null; kind: 'new'|'edit'|'update'; at: number }
export interface EntriesCoverage { openLoaded: boolean; closedSince: IsoDate|null; trackHistory: Record<string,{from:IsoDate;to:IsoDate}>; loadedAt: number|null }
export interface EntryCounts { total:number; open:number; overdue:number; stale:number; blocked:number; unassigned:number; dueThisWeek:number; closed:number }

// reads (narrow, reference-stable)
export function useEntryList(): Entry[]
export function useEntryMap(): ReadonlyMap<string, Entry>
export function useEntry(id: string|null|undefined): Entry|undefined
export function useEntriesLoading(): boolean
export function useEntriesError(): string|null            // i18n key
export function useEntriesCoverage(): EntriesCoverage
export function useHealthMap(): ReadonlyMap<string, EntryHealth>
export function useEntryHealth(id: string|null|undefined): EntryHealth|undefined
export function usePendingOp(id: string|null|undefined): PendingOp|undefined
export function useEntryFlash(id: string|null|undefined): FlashMark|undefined
/** SELF-LOADING, deduped in-flight. Callers must not write their own fetch effect. */
export function useEntryUpdates(entryId: string|null): { updates: EntryUpdate[]; loading: boolean; error: string|null }

// derived (useMemo over the stable list; pure work lives in lib/)
export function useFilteredEntries(filter: FilterState): Entry[]
export function useEntryCounts(filter?: FilterState): EntryCounts
export function useFilterContext(): FilterContext

// loading
export function loadEntries(force?: boolean): Promise<void>          // open entries + v_entry_health
export function loadClosedSince(since: IsoDate): Promise<void>
export function loadTrackHistory(trackId: string, from: IsoDate, to: IsoDate): Promise<void>
export function loadUpdates(entryId: string, force?: boolean): Promise<void>
export function refreshEntries(): Promise<void>
export function invalidateEntries(): void
export function resetEntries(): void

// writes — optimistic, all through outbox.submit()
export function createEntryOptimistic(input: NewEntry): Promise<ApiResult<Entry>>
export function patchEntry(id: string, patch: EntryPatch): Promise<ApiResult<Entry>>
export function setStatus(id: string, status: EntryStatus): Promise<ApiResult<Entry>>
export function snoozeFollowUp(id: string, days: number): Promise<ApiResult<Entry>>
export function postUpdate(input: NewEntryUpdate): Promise<ApiResult<EntryUpdate>>
export function undoCapture(id: string): Promise<ApiResult<null>>
/** Meeting triage commits server-side; see api/meetings.commitMeetingLines. This
 *  is for any other multi-insert. Partial success is reported, not rolled back. */
export function bulkCreate(inputs: NewEntry[]): Promise<ApiResult<Entry[]>>

// shared with realtime + outbox (not for screens)
export function applyServerRow(row: Entry, source: ApplySource, actor?: FlashMark): void
export function applyServerUpdate(row: EntryUpdate, source: ApplySource): void
export function removeEntryLocal(id: string): void
```

**Optimistic mutation flow — implement it once, here.**
1. Apply locally: merge the patch into `byId`, bump `last_activity_at` to now (matching what the server will do, so the row jumps to the top of every list), set `pending`, re-derive. **Snapshot the pre-change row.**
2. `await submit({...})`.
3. Settle: on `ok`, `applyServerRow(data,'local')` — the server row wins wholesale — then `pending.delete(id)`. On failure, restore the **snapshot** (not an inverse patch), `pending.delete(id)`, `toast(t(result.error), {tone:'error'})`.
4. Creates insert a synthetic row keyed `TEMP_PREFIX + crypto.randomUUID()`. On success the temp row is **deleted and replaced by the server row in one `setState`** — a two-step swap makes the row visibly flicker out of the list. A `postUpdate` issued against a temp id before settlement is re-keyed by the outbox via `dependsOn`.

**Monotonic guard — the rule that makes realtime and optimism coexist:**
```
applyServerRow(row, source) accepts iff
  (a) no local entry exists for row.id, OR
  (b) !pending.has(row.id) AND row.updated_at >= existing.updated_at, OR
  (c) source === 'local'   // our own settled write; always wins
An echo of our own write arriving over realtime while pending is DROPPED.
```

### 2.4 `src/api/entries.ts` — the narrowed loader surface (W1-DATA)

```ts
export async function listEntries(opts?: { openOnly?: boolean; limit?: number }): Promise<ApiResult<Entry[]>>
export async function listClosedSince(since: IsoDate): Promise<ApiResult<Entry[]>>
export async function listHealth(): Promise<ApiResult<EntryHealth[]>>
export async function listTrackHistory(trackId: string, from: IsoDate, to: IsoDate): Promise<ApiResult<{ entries: Entry[]; updates: EntryUpdate[] }>>
export async function listUpdates(entryId: string): Promise<ApiResult<EntryUpdate[]>>
/** Batched — the digest's N+1 avoidance. One `.in('entry_id', ids)` ordered desc. */
export async function listUpdatesFor(entryIds: string[], since?: IsoDate): Promise<ApiResult<EntryUpdate[]>>
export async function getEntry(id: string): Promise<ApiResult<Entry | null>>
// writes — called ONLY by the outbox transport registry
export async function createEntry(input: NewEntry): Promise<ApiResult<Entry>>
export async function updateEntry(id: string, patch: EntryPatch): Promise<ApiResult<Entry>>
export async function addUpdate(input: NewEntryUpdate): Promise<ApiResult<EntryUpdate>>
export async function healthCheck(): Promise<ApiResult<true>>
export async function materializeRecurring(): Promise<ApiResult<number>>
```

**Three corrections W1-DATA applies to the existing file in its first commit.**
1. **`description: input.description ?? ''`** — the column is `not null default ''`; `?? null` is a guaranteed 23502 on every create. Same coalesce on the patch side when the sheet clears the field. This has never fired only because nothing calls `createEntry()` yet; Wave 2 and Wave 3 both will, on day one.
2. **Errors become i18n keys.** Every `fail(error.message)` becomes `fail(pgErrorKey(error))`. The file currently returns raw Postgres English, which lands an untranslated sentence in an RTL layout. Do it here, once — the file has no callers below `materializeRecurring()` today.
3. `EntryFilter` stays exported for `filterToParams` round-tripping but is no longer a query-builder input.

### 2.5 Entry render layer — `src/components/entry/` (W1-KIT)

**Connectedness rule (frozen).**

| Tier | Components | May subscribe to | Must NOT |
|---|---|---|---|
| **Atoms** | `StatusPill` `PriorityDot` `HealthPill` `AgePill` `DueLabel` `OwnerBadge` `TagChip` `TrackDot` `LinkList` | `useVocabLabel/Color`, `useTrackMap/useTrackLabel`, `useMemberMap`, `useLocale` | read `store/entries`, mutate, fetch |
| **Rows** | `EntryRow` `EntryCard` `EntrySection` | atoms' stores only | read `store/entries` — the **list owner** subscribes and passes `entry` down |
| **Containers** | `EntrySheet` `UpdateThread` | everything | — |

Rows render 60–200 at a time; if each subscribed to `store/entries`, one realtime patch re-renders the whole board. Atoms may subscribe to `config`/`vocab`/`members` because those change roughly monthly and the alternative is prop-drilling a track object and a member map through every list.

```tsx
// atoms
interface StatusPillProps   { status: EntryStatus; size?: 'sm'|'md'; onChange?: (n: EntryStatus)=>void; disabled?: boolean; className?: string }
interface PriorityDotProps  { priority: EntryPriority; withLabel?: boolean; className?: string }
interface HealthPillProps   { health: HealthLevel; daysOverdue?: number; className?: string }
interface AgePillProps      { days: number; health?: HealthLevel; reason?: 'activity'|'blocked'|'status'; className?: string }
interface DueLabelProps     { date: IsoDate|null; kind?: 'due'|'followUp'; today?: IsoDate; showIcon?: boolean; className?: string }
interface OwnerBadgeProps   { ownerId?: string|null; ownerName?: string|null; size?: 'sm'|'md'; showName?: boolean; className?: string }
interface TagChipProps      { tag: string; active?: boolean; onToggle?: (t:string)=>void; onRemove?: (t:string)=>void; className?: string }
interface TrackDotProps     { trackId: string|null|undefined; variant?: 'dot'|'bar'|'glyph'|'chip'; showLabel?: boolean; className?: string }
interface LinkListProps     { links: EntryLink[]; onRemove?: (i:number)=>void; readOnly?: boolean; className?: string }

// rows
interface EntryRowProps {
  entry: Entry; health?: EntryHealth
  density?: 'comfortable'|'compact'
  show?: Partial<Record<'track'|'owner'|'due'|'age'|'priority'|'tags'|'status', boolean>>
  selected?: boolean; flash?: FlashMark; pending?: PendingOp; canEdit?: boolean
  onOpen: (id:string)=>void; onAddUpdate?: (id:string)=>void; onSnooze?: (id:string)=>void
  actions?: ReactNode; tabIndex?: number
}
interface EntryCardProps {
  entry: Entry; health?: EntryHealth; flash?: FlashMark; pending?: PendingOp
  dragging?: boolean; canEdit?: boolean
  onOpen: (id:string)=>void
  /** The ACCESSIBLE non-drag path — a menu button on every card. REQUIRED. */
  onMove: (id:string, status:EntryStatus)=>void
  dragHandleProps?: HTMLAttributes<HTMLElement>
}
interface EntrySectionProps { id:string; title:string; count:number; tone?:'danger'|'warn'|'default'; collapsible?:boolean; emptyLabel?:string; children:ReactNode }

// containers
interface EntrySheetProps { entryId: string|null; onClose: ()=>void; onNavigate?: (id:string)=>void }
export default function EntrySheet(p: EntrySheetProps): ReactElement | null
interface UpdateThreadProps { entryId: string; autoFocusCompose?: boolean; readOnly?: boolean; collapseAfter?: number }
export default function UpdateThread(p: UpdateThreadProps): ReactElement

// the shared gesture hook — lives here, NOT in lib/ (it is a React hook)
export interface SwipeActions { onStart?: ()=>void; onEnd?: ()=>void; threshold?: number }
/** Direction is LOGICAL: resolves document.dir at gesture start, so RTL mirrors for free. */
export function useSwipeActions(a: SwipeActions): {
  handlers: Pick<HTMLAttributes<HTMLElement>,'onPointerDown'|'onPointerMove'|'onPointerUp'|'onPointerCancel'>
  offset: number; active: 'start'|'end'|null
}
```
Every atom resolves its own colour via `trackVars()`/`vocabVars()` and renders null-safely — `trackId: null` → a neutral dot with `aria-label={t('entry.noTrack')}`; never crashes on an archived or deleted track missing from the map. `EntrySheet` is `.panel` (inline-end) at ≥768 px and `.sheet` (bottom) below; it owns Escape-to-close and the focus trap. `UpdateThread` is compose-on-top, immutable thread below, oldest first (it reads as a conversation, matching `listUpdates`' ordering). The barrel `index.ts` re-exports all 15 plus their prop types with `export type { … }`. Every file imports `./entry.css` (Vite dedupes).

### 2.6 Permissions — `src/lib/permissions.ts` (W1-DOMAIN) — **NEW, and it is load-bearing**

RLS `entries_update` is narrower than SELECT: everyone sees everything, almost nobody can edit most of it. Without this module, a member drags another member's card, watches it move, snap back, and toast "Something went wrong" — because `updateEntry()` uses `.update(...).select().single()`, an RLS-blocked patch returns **zero rows** → PGRST116 → an unmapped generic error.

```ts
/** Mirrors the shipped 0004 policy. Flip in ONE place if the policy changes. */
export const ENTRIES_UPDATE_IS_OPEN: boolean
export function canEditEntry(e: Entry, meId: string|null, role: UserRole): boolean
export function canDeleteEntry(role: UserRole): boolean
export function canAdmin(role: UserRole): boolean
```
`canEditEntry` = `ENTRIES_UPDATE_IS_OPEN ? !!meId : (e.created_by===meId || e.owner_id===meId || role==='admin')`. Consumed by `EntryRow`/`EntryCard`/`EntrySheet` for the disabled affordance, and by follow-ups (snooze) and board (drag).

**`pgErrorKey()` additions (W1-DOMAIN):** `'PGRST116'` → `'entry.errNotYours'`; `23514` + `last_visible_option` → `'vocabadmin.errLastVisible'`; `23502` → `'common.error'` with a `console.warn` (it should now be unreachable).

**⚠ OWNER DECISION, required before W1-DB writes 0004 — this is a product call, not an engineering one.** As written, a member cannot drag another member's board card, cannot snooze another member's follow-up, and cannot mark another member's item done. Every screen in phases 4–6 is designed as if they can. **Default in this plan: widen `entries_update` to `public.is_member()` in 0004** (DELETE stays admin-only; the append-only `entry_updates` thread already makes every change attributable, which is the actual audit guarantee). It is a two-line change now and a migration-plus-audit conversation later. If the owner declines, delete the clearly-marked block from 0004, set `ENTRIES_UPDATE_IS_OPEN = false`, and the disabled-affordance path above is the shipped behaviour — both branches are fully specified, and Wave 2 gate (f) exercises both.

### 2.7 `src/store/entrySheet.ts` (W1-DATA) — **NEW; this is what makes Wave 2 five-wide**

Follow-ups, board, timeline, capture and dashboard open the detail surface without importing the detail module.

```ts
export function openEntry(id: string, opts?: { list?: string[] }): void
export function closeEntry(): void
export function useOpenEntryId(): string | null
export function useSheetSiblings(): { prev: string | null; next: string | null }
export function stepEntry(dir: 1 | -1): void
```
`/entry/:id` is a **thin route** that calls `openEntry(id)` on mount, so deep links and the browser Back button still work while the desktop "panel over the list" UX is preserved. `src/pages/Entry.tsx` is that route; `EntrySheet` is the connected container it renders.

### 2.8 Vocabulary — `src/api/config.ts` + `src/store/vocab.ts` (W1-DOMAIN)

```ts
// api/config.ts — errors are i18n keys via pgErrorKey() (the api/tracks.ts convention)
export interface VocabPatch { label?: string; labelAr?: string; color?: string|null; hidden?: boolean; staleAfterDays?: number|null }
export async function listVocab(): Promise<ApiResult<VocabRow[]>>
export async function updateVocab(kind: VocabKind, key: string, patch: VocabPatch): Promise<ApiResult<VocabRow>>
export async function reorderVocab(kind: VocabKind, keys: string[]): Promise<ApiResult<number>>   // rpc reorder_vocab
export async function resetVocab(kind: VocabKind, key?: string): Promise<ApiResult<number>>       // rpc reset_vocab

// store/vocab.ts
export interface VocabItem { kind: VocabKind; key: string; label: string; color: string|null; hidden: boolean; sortOrder: number; staleAfterDays: number|null }
export interface VocabSnapshot { rows: readonly VocabRow[]; loadedAt: number|null }
export function useVocab(kind: VocabKind): VocabItem[]          // visible only, sort order
export function useVocabAll(kind: VocabKind): VocabItem[]       // incl. hidden — admin editor, historic values
export function useVocabLabel(): (kind: VocabKind, key: string) => string
export function useVocabColor(): (kind: VocabKind, key: string) => string|null
export function useStaleDays(): (p: EntryPriority) => number
export function useVocabLoading(): boolean
// non-React (digest, parser aliases, tests)
export function getVocabSnapshot(): VocabSnapshot
export function vocabLabel(s: VocabSnapshot, kind: VocabKind, key: string, locale: Locale): string
export function vocabItems(s: VocabSnapshot, kind: VocabKind, locale: Locale, o?: { includeHidden?: boolean }): VocabItem[]
export function staleDays(s: VocabSnapshot, p: EntryPriority): number
export function loadVocab(force?: boolean): Promise<void>
export function invalidateVocab(): void                        // after ANY vocab mutation
export const DEFAULT_STALE_DAYS: Readonly<Record<EntryPriority, number>>   // {critical:2,high:4,medium:8,low:15}
export const FROZEN_KEYS: Readonly<Record<VocabKind, readonly string[]>>
```

**Label resolution order (frozen).** 1) `ar` && `label_ar.trim()` → `label_ar`. 2) `en` && `label.trim()` → `label`. 3) `ar` && blank `label_ar` → **fall through to 4**, never to the English override. 4) `t('${kind}.${key}')`. 5) the raw key. Rule 3 is the one that bites: an admin who renames only the English label must not blank the Arabic UI. Mirrors `trackLabel()`'s empty-not-null test in `lib/labels.ts`.

**Missing table / 0003 unapplied:** `listVocab()` fails → the store keeps an empty row set and every resolver falls to step 4; the app renders identically to today. No `DEFAULT_VOCAB` shim is needed.
**Hidden semantics:** hidden options are excluded from pickers and board columns **unless entries currently hold that value** (board computes `visible ∪ statusesPresentInData`). Hidden never hides existing data.
**`health` is deliberately not a vocab kind** — its four keys are computed by the view; making them configurable invites configuring the algorithm. Health colours stay `global.css` tokens.
**Colour:** `src/lib/vocabStyle.ts` → `vocabVars(color: string|null|undefined): CSSProperties` → `{ '--vocab-c': color }`, mirroring `trackVars()`. Pills use `color-mix(in oklab, var(--vocab-c, var(--text-dim)) 18%, transparent)` for the fill and the raw var for the ink, so one hex works in both themes with no JS theme read — the exact failure `trackStyle.ts` was written to avoid.

### 2.9 Members — `src/api/members.ts` + `src/store/members.ts` (W1-DATA, Wave 1)

Needed in **Wave 1** by `OwnerBadge` and the owner picker — not Wave 4, which only adds the admin *page*. (`profiles_select = is_member()`, so the read works today.)

```ts
export interface Member { id: string; displayName: string; role: UserRole; email?: string|null }
export async function listMembers(): Promise<ApiResult<Member[]>>              // select from profiles
export async function createMember(email: string, displayName: string, role: UserRole): Promise<ApiResult<Member>>  // edge fn
export async function deleteMember(id: string): Promise<ApiResult<null>>       // edge fn
// store — same shape as store/config.ts, cache key opstrack_members_v1
export function useMembers(): Member[]
export function useMemberMap(): ReadonlyMap<string, Member>
export function useMemberLabel(): (ownerId?: string|null, ownerName?: string|null) => string
export function getMembersSnapshot(): readonly Member[]
export function loadMembers(force?: boolean): Promise<void>
export function invalidateMembers(): void
```
`useMemberLabel()`: `ownerId → member.displayName` → `ownerName` → `t('entry.unassigned')`. Free-text and registered owners display and filter identically (spec §3).

### 2.10 `src/lib/entryFilter.ts` (W1-DOMAIN) — THE one filter model

```ts
export type OwnerFilter = {kind:'any'}|{kind:'me'}|{kind:'unassigned'}|{kind:'id';id:string}|{kind:'name';name:string}
export type EntryScope = 'open'|'closed'|'all'
export type EntrySort = 'activity'|'due'|'priority'|'created'|'title'
export interface FilterState {
  trackIds: string[]          // [] = all
  statuses: EntryStatus[]; priorities: EntryPriority[]; types: EntryType[]
  owner: OwnerFilter
  tags: string[]              // AND semantics — a row must carry every listed tag
  health: HealthLevel[]
  search: string              // folded match over title + description + tags
  scope: EntryScope
  mine: boolean               // owner_id = me OR created_by = me; independent of `owner`
  from: IsoDate|null; to: IsoDate|null
  sort: EntrySort
}
export interface FilterContext { meId: string|null; today: IsoDate; weekStartsOn?: 0|1|6 }
export const EMPTY_FILTER: Readonly<FilterState>
export function selectEntries(e: Entry[], f: FilterState, h: ReadonlyMap<string,EntryHealth>, c: FilterContext): Entry[]
export function sortEntries(e: Entry[], s: EntrySort): Entry[]
export function matchesFilter(e: Entry, f: FilterState, h: EntryHealth|undefined, c: FilterContext): boolean
export function isFilterEmpty(f: FilterState): boolean
export function countActiveFacets(f: FilterState): number        // the "3 filters" pill
export function filterKey(f: FilterState): string                // stable useMemo dep — never JSON.stringify at a call site
export function filterToParams(f: FilterState): URLSearchParams
export function filterFromParams(p: URLSearchParams): FilterState
```
`useFilteredEntries(filter)` is nothing but `useMemo(() => selectEntries(list, filter, health, ctx), [list, health, filterKey(filter), ctx.meId, ctx.today])`.

### 2.11 `src/lib/entrySections.ts` (W1-DOMAIN) — the one definition of "stale"

```ts
export interface SectionContext { meId: string|null; today: IsoDate; staleDays: (p: EntryPriority)=>number; weekStartsOn?: 0|1|6 }
export interface FollowUpSections { overdue: Entry[]; dueSoon: Entry[]; stale: Entry[]; blocked: Entry[]; unassigned: Entry[] }
/** An entry appears in AT MOST ONE section, in the spec's priority order:
 *  overdue > dueSoon > stale > blocked > unassigned. */
export function bucketFollowUps(entries: Entry[], health: ReadonlyMap<string,EntryHealth>, ctx: SectionContext): FollowUpSections
export function daysInStatus(e: Entry, updates: EntryUpdate[]|undefined, today: IsoDate): number
```
Follow-ups, the board's section counts, the dashboard and the digest all call this. One definition across the product.

### 2.12 `src/lib/dates.ts` + `src/lib/health.ts` + `src/lib/text.ts` (W1-PARSE / W1-DOMAIN)

Every timestamp in this app is either an ISO **date** (`YYYY-MM-DD`, a Postgres `date`) or an ISO **instant** (a `timestamptz`). The two never share a parameter.

```ts
export type IsoDate = string; export type IsoInstant = string
export function todayIso(now?: Date): IsoDate
export function toIsoDate(d: Date): IsoDate
/** LOCAL-calendar parse. Never `new Date('2026-08-14')` — that is UTC midnight and
 *  reads back as Aug 13 west of Greenwich. Returns null on anything malformed. */
export function parseIsoDate(s: string|null|undefined): Date|null
export function addDays(iso: IsoDate, n: number): IsoDate
export function addMonths(iso: IsoDate, n: number): IsoDate       // clamps: Jan 31 +1m → Feb 28/29
export function diffDays(a: IsoDate, b: IsoDate): number          // b - a
export function isoWeekday(iso: IsoDate): number                  // 0 = Sunday
export function clampIso(iso: IsoDate, min?: IsoDate, max?: IsoDate): IsoDate
export function instantToIsoDate(ts: IsoInstant): IsoDate
export function daysSince(ts: IsoInstant, now?: Date): number
export interface RelativeDateOptions { now: Date; locale: Locale; weekStartsOn?: 0|1|6 }
export function parseRelativeDate(input: string, o: RelativeDateOptions): IsoDate|null   // null on no match, never throws
export function formatDate(iso: IsoDate|null, locale: Locale): string
export function formatDateLong(iso: IsoDate|null, locale: Locale): string
export function formatDateRange(from: IsoDate, to: IsoDate, locale: Locale): string
export function formatTimestamp(ts: IsoInstant, locale: Locale): string
export function formatRelativeTime(ts: IsoInstant, locale: Locale, now?: Date): string
export function formatAge(days: number, locale: Locale): string       // '14d' / '14ي', Latin numerals in both
export function formatDue(iso: IsoDate|null, locale: Locale, now?: Date): string
export function formatWeekday(iso: IsoDate, locale: Locale, style?: 'short'|'long'): string
export type DueBucket = 'none'|'overdue'|'today'|'week'|'later'
export function dueBucket(iso: IsoDate|null, now?: Date, weekStartsOn?: 0|1|6): DueBucket
export type AgeBucket = '0-3'|'4-7'|'8-14'|'15+'
export function bucketAge(days: number): AgeBucket
export function weekBounds(now: Date, weekStartsOn?: 0|1|6): { from: IsoDate; to: IsoDate }
export function lastNDays(n: number, now?: Date): { from: IsoDate; to: IsoDate }
```
**Two traps this module exists to centralise.** *Calendar:* `Intl` with `'ar'` defaults to the **Islamic** calendar and Arabic-Indic numerals — both forbidden by spec §5. Every formatter builds its `Intl.DateTimeFormat` with `'ar-u-ca-gregory-nu-latn'` (EN uses `'en-GB'`, day-first). Hard-code that in one private `fmt()` helper; **no other file in the repo may construct an `Intl.DateTimeFormat`.** *UTC drift:* `v_entry_health` counts days against the server's UTC `current_date`; `lib/health.ts` uses local dates for optimistic and offline rows. They can disagree by one day near midnight. **Accepted** — the pill is an ageing signal, not an SLA (0001's own comment says so). Do not "fix" it by switching the client to UTC; that makes "due today" wrong for the user's actual today. Tests assert on a fixed injected `now`; live comparison tolerates ±1 day.

```ts
// lib/health.ts
export function computeHealth(e: Entry, staleAfterDays: number, now?: Date): EntryHealth
export function isOpen(status: EntryStatus): boolean
export const CLOSED_STATUSES: readonly EntryStatus[]      // ['done','cancelled'] — the source of truth
// lib/text.ts  (delivered COMPLETE in the Wave-1 keystone)
export function foldArabic(s: string): string   // strip tashkeel/tatweel; أإآ→ا ى→ي ة→ه ؤ→و ئ→ي
export function foldDigits(s: string): string   // Arabic-Indic + Eastern Arabic → Latin
export function stemArabic(s: string): string   // strips ONE trailing ات|ه|ين|ون when len ≥ 5
export function normalizeSearch(s: string): string
export function initials(name: string): string  // first letters of the first two words, Arabic-safe
export function escapeHtml(s: string): string
export function truncate(s: string, n: number): string
```
`store/entries.ts` prefers the server view row and falls back to `computeHealth()`.

### 2.13 Parser — `src/lib/capture/parse.ts` + `grammar.ts` (W1-PARSE)

**Pure. Permitted imports: `../dates`, `../text`, `../../types`, `./grammar`. Not even `i18n`** — errors are returned as keys and the caller translates.

```ts
export type TokenKind = 'track'|'owner'|'priority'|'type'|'due'|'followUp'|'tag'|'recurring'|'unknown'
export interface ParseTrack { id: string; name: string; nameAr: string; aliases?: string[] }
export interface ParseMember { id: string; displayName: string; aliases?: string[] }
export interface ParseContext {
  tracks: readonly ParseTrack[]; members: readonly ParseMember[]
  now: Date; locale: Locale
  weekStartsOn?: 0|1|6                       // default 0 (Sunday) — the Saudi work week
  vocabAliases?: Partial<Record<'status'|'priority'|'type', Record<string, string[]>>>
  defaults?: { trackId?: string|null; priority?: EntryPriority; type?: EntryType }
}
export interface ParsedToken { kind: TokenKind; raw: string; start: number; end: number; ok: boolean; value?: string; refId?: string|null; candidates?: string[]; error?: string }
export interface ParseProblem { key: string; token?: ParsedToken; vars?: Record<string, string|number> }
export interface ParsedRecurrence { cadence: Cadence; customIntervalDays: number|null; dayOfWeek: number|null; dayOfMonth: number|null; firstRunOn: IsoDate }
export interface ParsedEntry {
  title: string; trackId: string|null; ownerId: string|null; ownerName: string|null
  priority: EntryPriority|null; type: EntryType|null
  dueDate: IsoDate|null; followUpDate: IsoDate|null
  tags: string[]; recurrence: ParsedRecurrence|null
  tokens: ParsedToken[]; problems: ParseProblem[]; isEmpty: boolean
}
export function parse(input: string, ctx: ParseContext): ParsedEntry        // never throws, total over any string
export function canSubmit(p: ParsedEntry): boolean                          // title non-empty after trim
export function toNewEntry(p: ParsedEntry, ctx: ParseContext): NewEntry|null           // null if recurrence or !canSubmit
export interface NewTemplate { title:string; trackId:string|null; type:EntryType; priority:EntryPriority; ownerId:string|null; ownerName:string|null; cadence:Cadence; customIntervalDays:number|null; dayOfWeek:number|null; dayOfMonth:number|null; nextRunOn:IsoDate; leadDays:number }
export function toRecurringTemplateInput(p: ParsedEntry, ctx: ParseContext): NewTemplate|null
export function matchTrack(q: string, tracks: readonly ParseTrack[]): { id: string|null; candidates: string[] }
export function matchMember(q: string, members: readonly ParseMember[]): string|null
```

**Token grammar (EN + AR).** A token starts only at string start or after whitespace (so `jira/x#INC-42` and `and/or` are safe). `\#`, `\@`, `\!`, `\+`, `\/` escape to literals. Values run to the next whitespace; `#"IT Operations"` and `@"Ali Hassan"` accept quoted multi-word values.

| Sigil/key | Kind | Consumed from title? |
|---|---|---|
| `#v` | track (fuzzy vs `name`/`name_ar`/aliases) | always |
| `@v` | owner (exact-fold vs displayName/aliases; else free text) | always |
| `!v` | priority | **only if resolved** |
| `/v` | type | **only if resolved** |
| `+v` | tag (lowercased, deduped) | always |
| `due:v` / `d:v` | due | always |
| `fu:v` / `f:v` | followUp | always |
| `every:v` / `ev:v` | recurring | always |

**The consume rule, stated once:** open-vocabulary sigils (`#`,`@`,`+`) and keyed tokens (`due:`,`fu:`,`every:`) are *always* removed from the title — the sigil is unambiguous intent, and leaving `due:asdf` in a title is noise. Closed-vocabulary sigils (`!`,`/`) are removed *only when the value resolves*, because `Ship it!` and `read/write` are ordinary title text. A bare sigil with no word characters (`####`, `@@`, `+`) is not a token at all. Tags accumulate and dedupe; every other field is **last-wins** and a second occurrence emits `capture.warnDuplicate`.

**Dates** delegate wholesale to `parseRelativeDate`: `today|tod|اليوم` · `tomorrow|tmr|غدا|غداً|بكرة` · `yesterday|أمس` · EN weekdays short/long · AR weekdays with or without `ال` · `+Nd|+Nw|+Nm` incl. Arabic-Indic digits · ISO `2026-08-14` · `14/8` and `14/8/2026` **day-first only** (the ambiguous US order is not accepted) · `eow|eom` / `نهاية الأسبوع|نهاية الشهر`. **Weekday rule (frozen):** a bare weekday means the *next strictly-future* occurrence — `thu` typed on a Thursday is +7, never today.

**Cadence:** `daily|d|يومي` · `weekly|w|أسبوعي` · `biweekly|2w|كل أسبوعين` · `monthly|m|شهري` · `quarterly|q|ربع سنوي` · `Nd` → `custom`. `every:weekly` alone anchors `dayOfWeek` to today's weekday; `every:monthly` anchors `dayOfMonth`; `due:` overrides both by supplying `firstRunOn`.

**`matchTrack` tiers** — first tier yielding exactly one hit wins. Folding = `foldArabic(foldDigits(lower(s)))`, collapse whitespace, strip `-_`.
1. exact fold-equal on `name`/`name_ar`/alias;
2. **prefix fold-match OR `stemArabic()`-equal** ← *this second clause is new and mandatory*;
3. subsequence fold-match (`itops` → "IT Operations").
Ties inside a tier → `{id:null, candidates:[…]}` + `capture.errTrackAmbiguous`. Zero hits → `{id:null,candidates:[]}` + `capture.errTrackUnknown` (token still consumed; the chip renders as unknown and is clickable).
**Why the stem clause exists — this is a real, verified bug in the source design.** The contracts doc's fixture list used `name_ar = الشبكة` for Network; 0001 actually seeds **`الشبكات`**. Under `ة→ه` folding, `#الشبكة` → `الشبكه`; tier 1 fails, tier 2 prefix fails (`الشبكات`.startsWith(`الشبكه`) is false), tier 3 fails (no `ه` in `الشبكات`). The Arabic half of the parser would have shipped broken **and green**, because the tests were written from the same wrong fixtures. `stemArabic` folds both to `الشبك` and they match at tier 2.
`matchMember` uses tiers 1–2 only — never subsequence; silently assigning work to the wrong person is worse than free text. Unmatched `@x` → `ownerName = x` + `capture.newOwner` as an *informational* problem, not an error. `profiles` has no `display_name_ar`, so `@أحمد` will not match `Ahmed Al-Otaibi` and becomes free text; `ParseMember.aliases` exists so a future one-column migration or an admin-typed alias list fixes this **without touching the parser**.

**Fixtures are the seed values, verbatim.** `parse.test.ts` uses `PMO / مكتب إدارة المشاريع`, `IT Operations / عمليات تقنية المعلومات`, `Network / الشبكات`, `Infrastructure / البنية التحتية`, `SRE / هندسة موثوقية الأنظمة`, `Onboarding / الانضمام`. Wave 1 gate (i) greps this list against the migrations.

**`ParsedEntry → NewEntry` mapping.**
```
title = p.title · trackId = p.trackId ?? ctx.defaults?.trackId ?? null
ownerId = p.ownerId · ownerName = p.ownerId ? null : p.ownerName      // the XOR the DB enforces
priority = p.priority ?? ctx.defaults?.priority ?? 'medium'
type = p.type ?? ctx.defaults?.type ?? 'action' · status = 'new'      // capture never sets status
dueDate = p.dueDate · followUpDate = p.followUpDate · tags = p.tags
description = ''                                                      // NOT null — the column is NOT NULL
meetingId = supplied by the caller (meeting mode), never by the parser
```

**Ten worked examples** (context: `now = 2026-07-29`, a **Wednesday**; tracks as seeded; members `Ahmed Al-Otaibi (m-ahmed)`, `Sara Nasser (m-sara)`):
1. `Firewall rule DC2 #network @ahmed !high due:thu` → title `Firewall rule DC2`, `t-net`, `m-ahmed`, `high`, `2026-07-30`, 4 ok tokens, no problems.
2. `#onb New vendor portal access +portal @Fatimah due:+3d /request` → `t-onb` (prefix), `ownerName:"Fatimah"`, `tags:['portal']`, `2026-08-01`, `request`, problems `[capture.newOwner]`.
3. `ترقية سويتش الكور #الشبكات @ahmed !عاجل due:الخميس` (ar) → `t-net` (matched on `name_ar`), `m-ahmed`, `critical`, `2026-07-30`. **`#الشبكة` must also resolve, via the stem clause.**
4. `اجتماع مراجعة الشبكة due:غدا fu:الأحد !متوسط` (ar) → `trackId: null` — the word الشبكة inside the title is **not** a track match; only sigils match — `2026-07-30`, `2026-08-02`, `medium`.
5. `Weekly network capacity review #network every:weekly @sara !medium` → `recurrence {weekly, dayOfWeek:3, firstRunOn:'2026-07-29'}`, `toNewEntry() === null`, `toRecurringTemplateInput()` → the NewTemplate with `leadDays:0`.
6. `Ticket https://jira.corp/x#INC-42 for @sara due:2026-08-14` → title keeps the URL (`#INC-42` is mid-token), `m-sara`, `2026-08-14`.
7. garbage `#### @@ !urgent-ish due:someday /nope +` → title `#### @@ !urgent-ish /nope +`; `due:someday` **is** consumed, `dueDate:null`; problems `[errDate, errPriority, errType]`; `canSubmit: true`.
8. ambiguity `#i Rebuild jump host` → `candidates:['t-inf','t-ito']`, `capture.errTrackAmbiguous`, chip renders a two-option picker.
9. self-correction `#pmo Kickoff deck #network !low !critical` → last-wins `t-net`/`critical`, `warnDuplicate ×2`.
10. blank `"   "` → `isEmpty:true`, `canSubmit:false`, **no error toast** — an empty box is not an error.

### 2.14 Realtime — `src/api/realtime.ts` (W1-DATA)

Moved out of `lib/` because it imports `api/supabase` — the layering rule is enforced by grep, and an exception would defeat it.

```ts
export type RealtimeStatus = 'idle'|'connecting'|'live'|'degraded'|'error'
export type RealtimeTable = 'entries'|'entry_updates'|'meeting_lines'
export interface RealtimeEvent<T> { table: RealtimeTable; eventType: 'INSERT'|'UPDATE'|'DELETE'; row: T|null; oldId: string|null }
export function startRealtime(): void          // idempotent; called once from Shell when a session exists
export function stopRealtime(): void           // sign-out and Shell unmount
export function useRealtimeStatus(): RealtimeStatus
export function onRealtime<T>(table: RealtimeTable, handler: (batch: RealtimeEvent<T>[]) => void): () => void
export const CHANNEL_NAME = 'opstrack-live'
```
**Policy, frozen.** **One channel** for the whole app — a channel per entry or per screen means 60 subscriptions on a board and a reconnect storm on every route change. Events land in a `Map<`​`${table}:${id}`​`, RealtimeEvent>` where a later event **replaces** an earlier one for the same row; flush on a **120 ms trailing debounce with a 500 ms hard cap** — a meeting bulk-commit of 20 rows produces one `setState`, not twenty. **Never flush inside the supabase callback.** The batch handler calls `applyServerRow`/`applyServerUpdate` under the §2.3 monotonic guard, then re-derives once; an `entry_updates` INSERT also bumps the parent's `last_activity_at` locally. **Reconnect:** `postgres_changes` has no replay — on any `SUBSCRIBED` following a `CLOSED`/`CHANNEL_ERROR`, and on `visibilitychange → visible` after >60 s, call `refreshEntries()`; status goes `degraded` while disconnected, surfacing in the existing `.offline-banner`. **Flash:** written **only when the actor is not me**, TTL 8 s, swept by a single module-level interval (not a timer per row); an `entries` UPDATE carries no actor column, so a matching `entry_updates` insert in the same batch supplies the name, otherwise `actorName: null` → render `t('entry.updatedGeneric')` rather than inventing a name; `.entry-row.is-flash` fades over 1.2 s, suppressed under the global `prefers-reduced-motion` kill-switch. **Guard:** `if (!supabase) return` at the top of `startRealtime` — a credential-less build must still boot.

### 2.15 Meetings — `src/api/meetings.ts` + `src/store/meetings.ts` (W3-MEET-LIVE)

Draft lines are **persisted per line**, not held in client state: a browser crash mid-meeting must not lose the meeting, and discarded lines must survive as notes per spec.

```ts
export async function createMeeting(input: { title: string; trackId: string|null; attendees: string[] }): Promise<ApiResult<Meeting>>
export async function appendLine(meetingId: string, raw: string, parsed: ParsedEntry|null): Promise<ApiResult<MeetingLine>>
export async function patchLine(id: string, patch: Partial<Pick<MeetingLine,'raw'|'parsed'|'state'>>): Promise<ApiResult<MeetingLine>>
export async function listLines(meetingId: string): Promise<ApiResult<MeetingLine[]>>
/** Server-side batch commit. Partial success is REPORTED, not rolled back. */
export async function commitMeetingLines(meetingId: string, lineIds: string[]): Promise<ApiResult<{ created: Entry[]; failed: { lineId: string; error: string }[] }>>
export async function endMeeting(id: string, notes: string): Promise<ApiResult<Meeting>>
export async function listMeetings(limit?: number): Promise<ApiResult<Meeting[]>>
```
`store/meetings.ts` mirrors `store/config.ts`'s shape and routes every write through `outbox.submit()`.

### 2.16 Templates, timeline, aggregate, digest

```ts
// api/templates.ts (W3-TEMPLATES)
export async function listTemplates(): Promise<ApiResult<RecurringTemplate[]>>
export async function createTemplate(t: NewTemplate): Promise<ApiResult<RecurringTemplate>>
export async function updateTemplate(id: string, p: Partial<NewTemplate>): Promise<ApiResult<RecurringTemplate>>
export async function setTemplateActive(id: string, active: boolean): Promise<ApiResult<RecurringTemplate>>
export async function deleteTemplate(id: string): Promise<ApiResult<null>>
export async function runTemplateNow(id: string): Promise<ApiResult<string|null>>     // rpc materialize_template
// lib/recurrence.ts — JS mirror of advance_recurrence, tested against the DB fixture matrix
export function advanceRecurrence(from: IsoDate, c: Cadence, interval: number|null, dow: number|null, dom: number|null): IsoDate
export function previewRuns(t: RecurringTemplate, n: number): IsoDate[]

// api/timeline.ts (W3-TIMELINE) — I/O
export async function loadTrackTimeline(trackId: string, from: IsoDate, to: IsoDate): Promise<ApiResult<{ entries: Entry[]; updates: EntryUpdate[] }>>
// lib/timeline.ts — PURE interleave. These are two different modules, not a naming conflict.
export type TimelineItem = { kind:'entry'; at: IsoInstant; entry: Entry } | { kind:'update'; at: IsoInstant; update: EntryUpdate; entry: Entry|undefined }
export function buildTimeline(entries: Entry[], updates: EntryUpdate[], opts?: { search?: string }): TimelineItem[]
export function tagBreakdown(entries: Entry[], tags: string[]): { tag: string; open: number; closed: number }[]

// lib/aggregate.ts (W3-DASH) — PURE bucketing; components/charts/* render hand-rolled SVG
export function openPerTrack(e: Entry[]): { trackId: string|null; count: number }[]
export function agingHistogram(e: Entry[], h: ReadonlyMap<string,EntryHealth>): Record<AgeBucket, number>
export function throughput(e: Entry[], from: IsoDate, to: IsoDate): { day: IsoDate; created: number; closed: number }[]
export function loadPerOwner(e: Entry[], h: ReadonlyMap<string,EntryHealth>, ctx: FilterContext): { ownerKey: string; open: number; overdue: number; stale: number }[]
export function oldestBlockers(e: Entry[], updates: ReadonlyMap<string,EntryUpdate[]>, today: IsoDate, n: number): { entry: Entry; days: number }[]
```

**Digest — collection is impure and lives in `api/`; the model builder and all three renderers are pure.**
```
src/api/digestCollect.ts   — the ONLY file that touches api/store
src/lib/digest/types.ts    — DigestModel and friends
src/lib/digest/build.ts    — buildDigestModel(): PURE
src/lib/digest/{markdown,plain,html}.ts — PURE
src/lib/digest/index.ts    — barrel + renderDigest()
```
```ts
export interface DigestQuery { from: IsoDate; to: IsoDate; trackIds: string[]; sections: DigestSectionKind[]; includeUpdates: boolean }
export interface DigestRows { entries: Entry[]; health: EntryHealth[]; lastUpdate: Map<string, EntryUpdate>; tracks: Track[]; members: Member[] }
export async function collectDigest(q: DigestQuery): Promise<ApiResult<DigestRows>>   // ONE batched listUpdatesFor(ids) — no N+1
export function buildDigestModel(rows: DigestRows, o: DigestOptions): DigestModel
export function renderMarkdown(m: DigestModel): string
export function renderPlain(m: DigestModel): string
export function renderHtml(m: DigestModel): string
export function renderDigest(m: DigestModel, f: DigestFormat): string
export function digestFilename(m: DigestModel, f: DigestFormat): string   // 'opstrack-2026-07-22_2026-07-29.md'
export function digestMimeType(f: DigestFormat): string
export interface DigestOptions {
  locale: Locale; sections: DigestSectionKind[]      // order honoured verbatim
  trackIds: string[]
  /** DEFAULTS from tracks.suggested_tags (any track with a non-empty array);
   *  an explicit id list overrides. One mechanism, not two. */
  tagBreakdown?: string[]
  includeNotes: boolean; includeEmptyTracks: boolean; now: Date
}
```
**Window membership, stated once so the dashboard and the digest cannot disagree:** an entry is in `[from,to]` if `closed_at ∈ window` **or** `created_at ∈ window` **or** (open **and** `last_activity_at ∈ window`) **or** (open **and** overdue as of `to`).
**Frozen rule: no renderer calls `t()`, `Intl`, or any store.** Every user-visible string — headings, owner labels, status labels, date labels, the fixed words in `DigestStrings` — is resolved during `buildDigestModel`, which receives an explicit `locale`. That is what makes "generate the Arabic digest while the UI is English" work, makes all three renderers testable against a hand-written model literal, and makes them impossible to drift apart. `markdown` follows spec §4.7 exactly (`## Track` / `**Section (n)**` / `- Title — Owner — detail`); `plain` drops `#*_`, uses `•`, sized for WhatsApp; `html` is a self-contained document with **inline styles only** (no `<style>` block — Gmail strips it), `dir` and `lang` on the wrapper, `text-align:start` on cells, every user string through `escapeHtml()`. All three carry `m.dir` and rely on no stylesheet, because there is none in an email.

### 2.17 Where this plan overrules the critique

Three places. Everything else in the critique is adopted.

1. **`lib/timeline.ts` vs `api/timeline.ts` is not a conflict.** The critique's conflict table lists it as one. They are two different modules with different jobs — a pure interleave/breakdown function and a query. **Both ship**, as specified in §2.16. Keeping only one would either put a query in `lib/` (breaking rule 2) or make the interleave untestable.
2. **The entry-atom list is not five renames.** `OwnerBadge`/`TrackDot`/`TagChip`/`DueLabel`/`EntrySection` win over `OwnerChip`/`TrackChip`/`TagChips` (contracts names are authoritative), but `HealthPill` and `LinkList` are genuinely **additional** components, not alternate names — follow-ups needs the health pill, and `entries.links` is a real jsonb column the sheet must render. Both are kept, bringing the barrel to 15 exports.
3. **The stated reason for killing `api/mutate.ts` is imprecise; the conclusion stands.** Rule 2 forbids `lib/**` importing `store/`/`api/` — it does not literally forbid `api/` importing `store/`. The real reason to keep `store/outbox.ts` is directional: the transport registry must import `api/*`, and if the outbox lived in `api/` that import would run backwards through the layer it belongs to. `api/mutate.ts` is deleted from the plan on that basis.

---

## 3. MIGRATIONS

Numbering is final. Both new files are written by **W1-DB in Wave 1** and applied to the live project **twice** before the wave closes.

| File | Wave | Owner | Contents |
|---|---|---|---|
| `0003_vocab_options.sql` | 1 | W1-DB | vocab table + seed + RLS + guards + RPCs + **`v_entry_health` rewrite** |
| `0004_workspace_data.sql` | 1 | W1-DB | Onboarding track, `suggested_tags`, `meeting_lines`, `materialize_template()`, tag index, **the `entries_update` widening block** |
| `0005_*` | — | reserved | At most one per later wave, allocated only when a wave proves it needs schema it could not have known in Wave 1. **Default: never written.** W3-TIMELINE explicitly does not need one — PostgREST inner-join filtering (`entry_updates?select=*,entries!inner(track_id)`) interleaves updates by track with no view. |

**Ordering rationale.** 0003 keeps the number the approved plan already assigned it and is the one migration with a hard consumer deadline (`v_entry_health` is read by `lib/health.ts` parity tests in Wave 1 and by follow-ups in Wave 2). 0004 is purely additive, so it could go either side; putting it after keeps the dependency direction one-way and lets it reference vocab rows later without a renumber.

### 0003_vocab_options.sql

- `create table if not exists public.vocab_options (kind text not null check (kind in ('status','priority','type')), key text not null, label text not null default '', label_ar text not null default '', color text, sort_order int not null default 0, hidden boolean not null default false, stale_after_days int, updated_at timestamptz not null default now(), updated_by uuid references public.profiles(id) on delete set null, primary key (kind, key))` plus two named constraints, each preceded by `drop constraint if exists`: `vocab_stale_only_priority check (kind = 'priority' or stale_after_days is null)` and `vocab_stale_range check (stale_after_days is null or stale_after_days between 1 and 365)`.
- **Seed 17 rows** `on conflict (kind, key) do nothing` — 6 statuses, 4 priorities (`stale_after_days` 2/4/8/15 for critical/high/medium/low), 7 types — with `label`/`label_ar` deliberately **empty strings** so the frozen i18n defaults win until an admin overrides one, and `sort_order` matching the union order in `types.ts`.
- RLS: `enable`; `select using (public.is_member())`; insert/update/delete `using (public.is_admin()) with check (public.is_admin())`. Every policy preceded by `drop policy if exists`.
- `vocab_keep_one_visible()` BEFORE UPDATE trigger: if the row is being hidden and it is the last visible option for its kind, `raise exception using errcode = '23514', message = 'last_visible_option'`. (`pgErrorKey()` maps it to `vocabadmin.errLastVisible`.)
- `vocab_touch()` trigger maintaining `updated_at`/`updated_by`.
- Audit: attach 0002's existing `log_config_audit` AFTER trigger to `vocab_options` so vocabulary edits land in `config_audit` alongside track edits.
- `reorder_vocab(p_kind text, p_keys text[]) returns int` and `reset_vocab(p_kind text, p_key text default null) returns int` — both `create or replace`, both gated on `is_admin()`, following the `reorder_tracks` pattern in 0002. `reset_vocab` restores the seed row (`label=''`, `label_ar=''`, `color=null`, `hidden=false`, seed `sort_order`, seed `stale_after_days`).
- **`v_entry_health` rewrite — the exact four-statement sequence, in this order, no substitutions:**
  ```sql
  drop view if exists public.v_entry_health;
  create view public.v_entry_health as … ;              -- identical column list, both id aliases
  alter view public.v_entry_health set (security_invoker = on);
  grant select on public.v_entry_health to authenticated;
  ```
  The only change to the body is that the hardcoded `case e.priority when 'critical' then 2 …` becomes `coalesce(vp.stale_after_days, <the same case expression>)` via `left join public.vocab_options vp on vp.kind = 'priority' and vp.key = e.priority`. `create or replace view` is **not** an option. **`drop view` discards the `security_invoker` setting and every grant** — omit either re-application and the view leaks every row past RLS *or* fails closed at runtime with a permission error and no compile-time signal, on a screen that is not built until the next wave. Wave 1 gate (c) executes a `select` on the view **as a plain member** for exactly this reason.

### 0004_workspace_data.sql

- **Onboarding, the sixth track** — the decided requirement that exists nowhere in the codebase today:
  `insert into public.tracks (name, name_ar, color, color_light, icon, sort_order) values ('Onboarding','الانضمام','#22c55e','#15803d','user-plus',6) on conflict (lower(name)) do nothing;` — `color_light` **must** be supplied here, because 0002's seed-repair block only covers the original five and a null would make the green illegible on the light theme.
- `alter table public.tracks add column if not exists suggested_tags text[] not null default '{}';` then `update public.tracks set suggested_tags = '{direct-integration,portal}' where lower(name) = 'onboarding' and suggested_tags = '{}';` — scoped so a later admin edit is never clobbered by a re-run. Nothing in the codebase names a track: `suggested_tags` is per-track, so the mechanism generalises.
- `create index if not exists entries_tags_gidx on public.entries using gin (tags);` — the tag filters on board and follow-ups read it.
- **`meeting_lines`**: `id uuid pk default gen_random_uuid()`, `meeting_id uuid not null references public.meetings(id) on delete cascade`, `seq int not null`, `raw text not null default ''`, `parsed jsonb`, `state text not null default 'pending' check (state in ('pending','committed','discarded','note'))`, `entry_id uuid references public.entries(id) on delete set null`, `created_by uuid references public.profiles(id) on delete set null`, `created_at`/`updated_at timestamptz not null default now()`; `create unique index if not exists meeting_lines_seq_uidx on public.meeting_lines (meeting_id, seq)`. RLS: select `is_member()`; insert `is_member() and created_by = auth.uid()`; update `is_member()` (triage is collaborative — a second attendee must be able to fix a line); delete `created_by = auth.uid() or is_admin()`. Add it to `supabase_realtime` inside a guarded `do $$ … exception when others then raise notice` block, matching 0001's style, so multi-device live capture works and a publication failure degrades to a notice.
- `materialize_template(p_id uuid, p_advance boolean default true) returns uuid` — creates exactly one entry from one template, honouring `lead_days`, absorbing a second call through the existing `(template_id, due_date)` unique index, and advancing `next_run_on` via `advance_recurrence()` only when `p_advance`. Backs the templates screen's "run now".
- **The `entries_update` widening block** (see the owner decision in §2.6), written between clearly-marked `-- ▼ OWNER DECISION` / `-- ▲` comment fences so it can be deleted wholesale before the file is run:
  ```sql
  drop policy if exists entries_update on public.entries;
  create policy entries_update on public.entries
    for update using (public.is_member()) with check (public.is_member());
  ```
  DELETE stays admin-only. If the block is deleted, 0001's policy survives untouched (0004 never drops it in that path) and `ENTRIES_UPDATE_IS_OPEN` is set to `false`.

### Idempotency discipline — an acceptance criterion, not a style note

Both files must match 0001/0002's proven discipline: `create table/index if not exists`, `add column if not exists`, `create or replace function`, `drop policy if exists` before every `create policy`, `drop trigger if exists` before every trigger, `drop constraint if exists` before every `add constraint`, seeds with `on conflict … do nothing`, and any pg_cron/publication work wrapped in `do $$ … exception when others then raise notice`. **Consequence, verified against both existing files: they are safe to re-run from the top, any number of times, in any partial state.** The recovery for a mid-file error is "fix the statement, re-run the whole file"; the double-run in §5 S7 is the proof, not a formality. One genuine hazard survives: dropping a named constraint before re-adding it leaves the table **without** that constraint if the `add` fails on live data. On a fresh project this cannot happen; on a populated one, check the data first.

**Hard rule, no exceptions: no schema object may exist only in the dashboard.** There is no down-migration and no PITR on the free tier; the practical rollback is "recreate the project and re-run the files", which is cheap *only* if nothing was ever hand-clicked.

---

## 4. LOCALE OWNERSHIP

### 4.1 The split (Wave 1, W1-I18N)

`src/locales/{en,ar}.json` is the worst contention point in the plan — 25 workers across 6 waves all need keys, and one owner per wave would serialise half the build. Wave 1 refactors to:

```
src/locales/en/<namespace>.json      one file per top-level key
src/locales/ar/<namespace>.json      the mirror
src/locales/index.ts                 static imports, merged in a fixed order
src/locales/locales.test.ts          the parity gate
```
`t()`'s public API is **unchanged** — zero call-site churn. `index.ts` builds the same `Tree` shape `lib/i18n.ts` already consumes (`resolveJsonModule` is on; the imports are static so Vite tree-shakes and inlines them). A namespace file's name **is** its single top-level key; the merge asserts no root appears in two files.

### 4.2 Ownership table

| Namespace file | Owner | Wave | Approx. keys |
|---|---|---|---|
| `app, nav, route, common, date, filter, offline, pwa, signin, placeholder, status, priority, type, health` (**the shared set**) | **W1-I18N**, then **integrator-only** | 1 | 213 existing + ~70 new |
| `settings`, `admin` | **W1-I18N** in W1, then **integrator-only** | 1+ | existing + additions |
| `entry` | W1-KIT → **W2-DETAIL** (transfer at the Wave-2 open) | 1→2 | ~55 |
| `vocabadmin` | W2-VOCABUI | 2 | ~30 |
| `capture` | W2-CAPTURE | 2 | ~40 |
| `followups` | W2-FOLLOWUPS | 2 | ~26 |
| `board` | W2-BOARD | 2 | ~24 |
| `track` | W3-TIMELINE | 3 | ~24 |
| `meeting` | W3-MEET-LIVE (W3-MEET-MIN requests through it) | 3 | ~34 |
| `recurring` | W3-TEMPLATES | 3 | ~26 |
| `dashboard` | W3-DASH | 3 | ~28 |
| `digest` | W3-DIGEST | 3 | ~40 |
| `cmd` | W4-KEYS | 4 | ~22 |
| `members` | W4-ADMIN | 4 | ~22 |

**The rule that removes every collision the source designs had:** `common`, `date`, `route`, `nav`, `filter`, `offline`, `settings` and `admin` are **cross-cutting** — they are populated in Wave 1 from the full key map below and are integrator-only thereafter. A feature worker needing a key in any of them puts the exact key + EN + AR strings in its handoff note; the integrator applies them during the close. No feature worker ever opens a shared namespace file. This is why `route.entry` (W2-DETAIL) and `route.vocabulary` (W2-VOCABUI) do not collide, why W1-UI's `FilterBar` can use `filter.*` a wave before follow-ups exists, and why `dates.ts` can format with `date.*` in Wave 1.

Because they are populated up front, W1-I18N writes these in Wave 1 even though nothing consumes them yet:
`filter.*` (~24): `title open apply clear clearAll active activeCount track owner priority type tag health status search searchPlaceholder scopeOpen scopeClosed scopeAll mine everyone anyOwner unassigned noResults noResultsHint savedView`
`date.*` (~18): `today tomorrow yesterday thisWeek nextWeek overdue never justNow minutesAgo hoursAgo daysAgo inDays daysShort hoursShort overdueByDays dueInDays weekStart rangeSep`
`common.*` additions (~22): `add edit delete confirm apply clear all mine today copy copied download undo yes no optional required selectAll selectNone more less offline of`
`route.*` additions (6): `entry meeting digest vocabulary recurring members` · `nav.*` additions (2): `digest dashboardShort` · `offline.*` additions (10): `queued syncing synced syncFailed retry outbox outboxHint discardTitle discardBody discarded`

Feature namespace key lists are as specified in the contracts document's §8 table and are reproduced in each worker's brief; they are unchanged except that owners are now single and unambiguous.

### 4.3 Conventions

`err*` = error sentence · `warn*` = non-blocking notice · `*Hint` = helper text under a field · `*Placeholder` = input placeholder · `*Title`/`*Body` = a `confirm()` pair · `*Toast` = post-action toast. Interpolation is `{count}`, `{name}`, `{from}`, `{to}`. **No plural machinery exists** — phrase every count key so one form works in both languages (`"{count} items"` → `"عناصر: {count}"`); Arabic's six plural forms are not worth a runtime. Keys are namespaced by **feature**, never by component — `entry.due` is used by the row, the card, the sheet and the digest builder. Two features needing the same word in different senses each get their own key; never reuse across namespaces. The shared vocabulary blocks (`status.*`, `priority.*`, `type.*`, `health.*`) are **frozen and already complete** — consume as `t('status.' + entry.status)`; never add a fourteenth status string somewhere else.

### 4.4 Parity enforcement — one mechanism, in vitest

`src/locales/locales.test.ts` (W1-I18N), run by `npm run test`, wired into `deploy.yml` in Wave 1. `scripts/i18n-check.mjs` is **not** written — vitest now exists and a second mechanism is a second thing to drift. The test asserts, per namespace pair and across the merged bundle:

1. **Key-set equality** — 0 missing, 0 extra, per file pair.
2. **No duplicate root** across files; each file's name equals its single top-level key.
3. **Baseline preservation** — all 213 pre-existing keys are present, checked against a committed fixture list (this is what proves the split lost nothing).
4. **No empty values** in either language.
5. **Interpolation parity** — the set of `{token}`s in each EN value equals the set in its AR value. (This catches the class of bug where an Arabic translation silently drops `{count}`.)
6. **No nested-object/string type mismatch** between the two trees.

Baseline 213 keys at exact parity today; this plan adds roughly 430, landing near 645.

---

## 5. RELEASE RUNBOOK

**[EARLY]** marks everything that runs in **Wave 0, today**, before another line of feature code. The repo does not need finished code; it needs a green pipeline and a live database. From the moment they exist, every wave is on the owner's phone the minute it is pushed, and every wave gate can be written as "prove it against the real project".

### 5.1 [EARLY] Git and GitHub

```bash
cd /Users/aziz/Claude/opstrack
git init                                    # → 'main'; init.defaultBranch is already main, matching deploy.yml
git add -A
git status --short                          # eyeball: no .env, no dist/, no node_modules
git check-ignore -v .env dist node_modules  # prove the rules fire, by rule line
git ls-files | grep -iE '\.env|key|secret'  # must return ONLY .env.example
git commit -m "chore: initial import — schema 0001+0002, app shell, track manager"
gh repo create Abosallom/opstrack --public --source . --remote origin   # NOTE: no --push
gh api -X POST repos/Abosallom/opstrack/pages -f build_type=workflow     # deterministic Pages enable
```
`.env` does not exist yet, so `git status` cannot warn about it — `git check-ignore -v .env` proves the rule is live *before* the file exists, which is the only moment the check is cheap. **`--public` publishes the owner's code to the world: confirm at the moment of the click.** Deliberately **no `--push`**: `deploy.yml` fires on every push to `main`, and with no secrets set the build **succeeds** and ships an app that can never sign in. Set secrets first (§5.4), then `git push -u origin main`.

**`deploy.yml` edits, in this same Wave-0 commit** (both are hazards from push #1, not release-day cleanups): `concurrency.cancel-in-progress: false`, and a fail-fast guard before the build:
```yaml
- name: Verify build secrets are present
  env: { URL: "${{ secrets.VITE_SUPABASE_URL }}", KEY: "${{ secrets.VITE_SUPABASE_ANON_KEY }}" }
  run: '[ -n "$URL" ] && [ -n "$KEY" ] || { echo "::error::VITE_SUPABASE_* repo secret is empty"; exit 1; }'
```
Correct as written and left alone: `base: './'` + HashRouter (verified — `dist/index.html` emits `./assets/…`, `manifest.start_url: "./"`); secrets on the **build** step (Vite inlines at build time); `pages: write` + `id-token: write`; `npm ci` with `package-lock.json` tracked; no `.nojekyll` needed; `workflow_dispatch` present. Minor, non-blocking: CI pins Node 22 while the machine runs 24.18 (Vite 8 needs `^20.19 || >=22.12`, so both are fine; add `.nvmrc` if the divergence ever bites), and `npm run lint` exits 0 on warnings (`react/only-export-components` is `warn`) — do not tighten mid-build.

**Commit cadence.** One commit for the initial import — do not fake-split shipped work into a pretend history. One commit per wave thereafter, using the §1 messages, so `git log --oneline` doubles as the changelog and `git bisect` lands on a wave boundary. **Push straight to `main`, no branches**: CI runs lint+build+test on every push, a red build means the deploy job never runs and the last good artifact stays live — that is simultaneously the gate and the rollback. Every pushed commit must be green locally first. Migration files are committed in the same wave that applies them, never after.

### 5.2 [EARLY] Supabase provisioning (owner's logged-in browser)

**S1** `supabase.com/dashboard` — confirm identity and org. **[owner decides]** if more than one org. Free tier allows 2 active projects per org; pausing an existing project is his call.
**S2** New project `opstrack`. **Database password → "Generate a password", then Copy/Download into his password manager.** Nothing in this runbook needs it — the SQL editor, the app and the edge function all authenticate by other means. **Region is immutable: Middle East (Bahrain) `me-south-1` if offered, else EU Central (Frankfurt).** [owner decides]. Plan: Free; stop and ask if any paid add-on appears. Provisioning takes 1–3 min and the SQL editor 500s if opened too early — wait for "Project is ready".
**S3** Settings → API: copy **Project URL** and the **anon/public** key. Never touch `service_role`. If both a legacy JWT anon key and an `sb_publishable_…` key are offered, either works with supabase-js 2.110 — pick one and use the *same* value in `.env` and the repo secret.
**S4** Authentication → Providers → Email: provider **enabled**; **Email OTP enabled, length 6** (the app calls `verifyOtp({type:'email'})`; magic-link-only will not satisfy it); **"Allow new users to sign up" → OFF** — the toggle the entire security model in 0001's header depends on. Ordering is safe: `sendOtp` passes `shouldCreateUser: false` (`src/store/auth.ts:107`), specifically so disabling signups does not break sign-in for existing users.
**S5** URL Configuration: Site URL `https://abosallom.github.io/opstrack/`; redirects `https://abosallom.github.io/opstrack/**` and `http://localhost:5173/**`. **Highest-risk step in the whole sequence:** `signInWithOtp` renders the **Magic Link** template, and on a fresh project that template contains a *link*, not a code. Open Authentication → Emails → Magic Link and confirm `{{ .Token }}` is in the body; add it if not. Without it the owner receives a link he cannot type into a 6-digit box and sign-in is impossible.
**S6** Rate limits (read, don't change): built-in SMTP is capped at a handful of emails/hour project-wide with a ~60 s per-address cooldown. The smoke test needs 3–4 codes (live sign-in, second browser for realtime, the separate iOS standalone bucket). Keep sessions alive rather than re-signing-in; space resends. The app already maps 429 → `signin.errRateLimited`. Custom SMTP is the owner's step (credentials).
**S7** SQL Editor: paste the **whole file** → Run → read the NOTICES pane → **run the identical buffer a second time**. Order: `0001` ×2, then S8, then `0002` ×2, then (in Wave 1) `0003` ×2 and `0004` ×2. Before hitting Run, confirm the last visible line matches the file's last line — the browser paste path occasionally truncates a very large buffer.
**S8 — the first admin. The canonical order, and `ADMIN.md` currently gets it wrong.** `handle_new_user()` (installed by 0001) is the *only* thing that writes a `profiles` row, and **there is no backfill anywhere in 0001 or 0002** — an auth user created before 0001 gets no profile ever, authenticates fine, and sees an empty app permanently. 0002's bootstrap promotes an existing profile; it cannot create one. And the app cannot mint the user, because `sendOtp` sends `shouldCreateUser: false`. So `ADMIN.md:22-25` — "run 0001 → run 0002 → sign in once → re-run 0002" — is **impossible on a fresh project**. The order is:
```
0001 ×2  →  Authentication › Users › Add user (az.alsaloom@gmail.com, Auto Confirm ✓)  →  0002 ×2  →  verify
select u.email, p.role, p.display_name from public.profiles p join auth.users u on u.id = p.id;
```
Exactly one row, `role='admin'`. If 0002 ran before the user existed, just re-run it. This works because the SQL editor runs with `auth.uid()` null and `guard_profile_role()` deliberately passes JWT-less callers through — the SQL editor and the service role are the only two principals allowed to assign a role. **⚠ Owner's action:** the Add-user dialog wants a password, or "Send invitation" creates the user with none — either fires the trigger. Creating an account / typing a password is his action, not mine. Fix `ADMIN.md` in Wave 5.
**S9** Edge Functions → Deploy via Editor, named **exactly** `admin-members`, pasting `supabase/functions/admin-members/index.ts`. `SUPABASE_URL`/`ANON_KEY`/`SERVICE_ROLE_KEY` are auto-injected. **Invoke it twice** — the first call after deploy fetches `npm:@supabase/supabase-js@2` and can take 1–3 s or time out once. Leave "Verify JWT" ON (the function re-verifies the caller itself via `anonClient.auth.getUser(token)`, and the gateway answers CORS preflight before JWT verification). **Flagged, resolved in Wave 4 not here:** the function's admin gate is a hardcoded `ADMIN_EMAILS = ['az.alsaloom@gmail.com']` (`index.ts:19`) while the rest of the system moved to `profiles.role` (`src/lib/admin.ts` is now `export {}`). Consequence today: a second admin promoted via `profiles.role` can manage tracks but cannot provision members. Wave 4 gate (g) resolves it and corrects the three stale references (`README.md:80-81`, `README.md:121`, the function's header comment).
**S10** Database → Publications: confirm `supabase_realtime` lists `public.entries` and `public.entry_updates`. 0001 adds them in a guarded block that swallows failures into a notice — if realtime is silent in Wave 2, this is the first place to look.

### 5.3 [EARLY] Secrets

```bash
cp .env.example .env          # paste VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY
git check-ignore -v .env      # must print the .gitignore rule
gh secret set VITE_SUPABASE_URL      --repo Abosallom/opstrack --body "https://<ref>.supabase.co"
gh secret set VITE_SUPABASE_ANON_KEY --repo Abosallom/opstrack < /path/to/anon-key.txt && rm /path/to/anon-key.txt
gh secret list --repo Abosallom/opstrack     # names + timestamps only, never values
```
`gh`'s `repo` scope suffices (verified: authenticated as Abosallom with `gist, read:org, repo, workflow`; the `workflow` scope is required to push `.github/workflows/` at all, and it is present). Pipe the key from a file rather than `--body` so it never sits in shell history. **The anon key is the only credential-shaped value that passes through my hands.** It is public by design — it ships inside the JS bundle, and RLS is the boundary; the secret exists for rotation ergonomics, exactly as the workflow comment says. **The `service_role` key and the database password never do, in any step of this runbook.** Any secret change requires a **rebuild**, not a redeploy: `gh workflow run "Deploy to GitHub Pages" --repo Abosallom/opstrack`.

### 5.4 Per-wave deploy loop (waves 1–4)

One commit → one automatic deploy → one thing the owner can try on his phone. Migrations for a wave are applied in the SQL editor (double-run) as part of that wave, before its gate. Wave gates in §1 are the acceptance criteria; §5.5 runs in full only at Wave 5.

### 5.5 Full live smoke test — `https://abosallom.github.io/opstrack/` (Wave 5)

**Pre-flight (30 s).** `gh run list --limit 3` · `curl -sI …/ | head -1` → 200 · `curl -s …/manifest.webmanifest | head -c 80` → JSON, **not** the 404 page (a manifest returning the SPA page means the base path is wrong — stop there) · `curl -s …/ | grep -o 'src="[^"]*"'` → relative `./assets/…`.

**A. Auth on the real domain.** Clean profile → lands on `#/signin`, not blank (proves HashRouter + base + SW). A **non-provisioned** address → `signin.errNoAccount` (this single check proves signups are OFF *and* that `shouldCreateUser:false` maps correctly). The admin address → **the owner reads the code from his inbox and types it**. Lands on `#/followups`; Settings shows role **Admin** and Backend **Connected** (the real `healthCheck()` round-trip). Hard reload → session persists.

**B. RLS probes with the anon key only**, from the live origin's console or `curl` against `/rest/v1` — the anon key is exactly what an attacker holds.

| # | Probe | Expected |
|---|---|---|
| P1 | No JWT: `GET /entries?select=id` with only `apikey:` | `[]` or 401 — **never rows** |
| P2 | No JWT: `POST /entries` | 401/403, never 201 |
| P3a | Member JWT: `SELECT` any entry | succeeds (open visibility is intentional) |
| P3b | Member JWT: `PATCH` an entry they neither created nor own | **matches the shipped 0004 decision** — 403/0 rows if narrow, 200 if widened |
| P3c | Member JWT: `DELETE` any entry | 403 — delete is admin-only |
| P4a/b | Any JWT: `PATCH` / `DELETE` on `entry_updates` | 0 rows / 403 — **no UPDATE or DELETE policy exists at all** |
| P4c | Re-`SELECT` that row, byte-compare `body` | unchanged — **assert on the re-read, not the status code** |
| P5 | Member JWT: `PATCH /profiles?id=eq.<self>` `{"role":"admin"}` | HTTP may say 200; the **re-SELECT must still say `member`** (`guard_profile_role()` reverts silently) |
| P6 | `config_audit`: admin SELECT works, member SELECT `[]`, anyone INSERT 403 | as stated |
| P7 | Via the UI: delete the last active track → `errLastTrack`; delete a track with entries without reassigning → `errInUse` | proves the `pgErrorKey()` → i18n chain on the live build |

P4c and P5 are the two that **must** assert on a re-read — both failure modes report success.

**C. Track CRUD.** Create, edit name/nameAr/colour/icon/**suggestedTags**, reorder, archive+restore, delete-with-reassign (usage counts must match reality). Signed in as a member, `/settings/tracks` must redirect to `/settings`.
**D. Entry lifecycle.** Create → open the sheet → append an update (thread grows, `last_activity_at` moves) → `new → in_progress → blocked → done` (transition rows appear, `closed_at` set) → cancel path → health/staleness reflected on follow-ups.
**E. Capture.** `#pmo @sara !high due:tomorrow /issue +portal every:weekly` in EN and the AR equivalent — chips must match and the created row must carry the right track/owner/priority/type/tag/date; a plain sentence with zero tokens still produces a sane entry. Arabic-Indic digits in `due:` are the sharp edge and are an explicit vitest case, not just a live check.
**F. Realtime.** Two profiles as two different members: A appends an update / flips a status → B's list *and* open sheet update within ~1–2 s, no reload. If silent, check Network → WS for `wss://<ref>.supabase.co/realtime/v1/websocket`; a missing socket points back to S10. The SW is already `NetworkOnly` for `*.supabase.co` (verified in `vite.config.ts`), so caching is not the suspect.
**G. Digest.** MD/plain/HTML in EN and AR; clipboard write (needs HTTPS — Pages qualifies); paste into Notes and WhatsApp and confirm the Arabic one is not mangled (RTL marks, digit shaping). Onboarding tag breakdown present.
**H. PWA install on iOS Safari — the quirks that actually bite.** (1) **Safari specifically** — Chrome on iOS does not produce a true standalone PWA. (2) **Navigate to the root before adding**: iOS pins the URL currently in the address bar, hash included; `start_url: "./"` does **not** override this on iOS. (3) Share → Add to Home Screen; title prefills "OpsTrack", icon is the 180×180 `apple-touch-icon.png` (verified present, referenced relatively). (4) Launch from the home screen: `black-translucent` status bar sits *over* the app — confirm the header clears the notch (`app-shell.css:544-549` already floors 12 px over `env(safe-area-inset-top)`), both orientations, plus the home indicator. (5) In standalone, external links open with no back button — the only exposure is a `target=_blank` entry link; open one and confirm it hands off to Safari. (6) **The installed app has its own storage bucket** — he signs in *again* inside it, one more OTP; do this last or space it (S6 limit), then kill and relaunch to confirm the session survives. (7) Airplane mode: shell loads from precache, offline banner appears, Supabase calls fail legibly. (8) **Exercise the update path once**: push a commit, wait for the deploy, reopen the installed app → the sticky "new version" toast (`registerType: 'prompt'`, `src/main.tsx:34-57`) appears and Reload swaps the SW. A broken update path is invisible until the day it matters.
**I. AR/RTL on the live build.** `html[dir=rtl]`, sidebar and tab bar mirror, `.icon-directional` chevrons flip, **no horizontal scrollbar anywhere**, Arabic on every page. Reload → locale persists pre-paint (`applyLocale()` runs before render).
**J. Light theme.** Check one track bar in light mode — 0002's `color_light` seed repair is what keeps the seeded cyan/amber/rose legible on white, and 0004 must supply Onboarding's.

### 5.6 Rollback

- **Migration errors mid-file:** assume no transactional guarantee; rely on re-runnability. Fix the statement, re-run the whole file. See §3.
- **Lint/tsc/test failure:** the build job fails, the deploy job never runs, and the previously deployed artifact stays live. Nothing to roll back.
- **Builds but broken at runtime:** `git revert <sha> && git push` → ~90 s to the previous version. Preferred over anything in the Pages UI; history stays honest.
- **Emergency, no code change:** `gh run rerun <last-good-run-id>` rebuilds that commit's source with today's secrets. `upload-pages-artifact` artifacts expire in ~1 day, so re-running the build is the reliable form; there is no one-click "promote previous deployment" for the Actions Pages source.
- **A poisoned service worker can outlive a revert.** `registerType: 'prompt'` limits the blast radius (clients keep the last SW until the user taps Reload); the escape hatch for a truly bad SW is deploying a self-unregistering one. Worth knowing before Wave 4 signs off; not worth pre-building.
- **Supabase has no undo** — no down-migration, no PITR on free tier. See §3's hard rule.

### 5.7 What genuinely needs the owner

The claim "nothing except being logged in to Supabase and GitHub" does not hold. Seven items, all short: (1) approving the **public** repo; (2) Supabase project creation — org, **region** (immutable), the generate-password click and saving it to his password manager; (3) creating the **first auth user** (Add user / Send invitation); (4) **every OTP code** — budget 3–4, mind the ~60 s per-address cooldown; (5) any Supabase consent/ToS/plan dialog and anything touching billing; (6) the **second test account's address** and its OTP for the member-vs-admin probes; (7) the **iOS install** itself. Everything else — `git`, `gh`, secrets, SQL paste, function paste, `curl` probes, dashboard navigation — runs unattended.

---

## 6. DECIDED-REQUIREMENTS TRACE

Every hop is owned. The previous plan delivered the *outcomes* but left three of five plumbing hops unowned; that is fixed here.

| Decided requirement | Hop | Wave · Worker · File |
|---|---|---|
| **Six tracks** (PMO, Onboarding, Infrastructure, IT Operations, Network, SRE) | Onboarding row + `color_light` + `sort_order 6` | **W1 · W1-DB · `0004_workspace_data.sql`** |
| | Seed demo entries across all six (creates **no** tracks) | W1 · W1-DB · `scripts/seed.mjs` |
| | Parser fixtures use the six literal seed names | W1 · W1-PARSE · `parse.test.ts` + gate (i) |
| | Six tracks visible in every picker, board swimlane, dashboard series | W2/W3 · existing `store/config` — no extra work |
| **Onboarding's two integration paths as tags** `+direct-integration` / `+portal` | `tracks.suggested_tags text[]` column + Onboarding seed value | **W1 · W1-DB · `0004`** |
| | `Track.suggested_tags` + `TrackInput.suggestedTags` on the type | **W1 · W1-DOMAIN · `src/types.ts`** |
| | `api/tracks.ts` reads/writes the column | **W1 · W1-DOMAIN · `src/api/tracks.ts`** |
| | Admin edits the list per track | **W1 · W1-DOMAIN · `src/pages/settings/TrackEditor.tsx`** |
| | `+tag` parsed at capture | W1 · W1-PARSE · `lib/capture/parse.ts` |
| | Suggested tags offered as chips in the entry sheet's tag input | W2 · W2-DETAIL (consumes `useTrackMap().suggested_tags`) |
| **Tag filters on board and follow-ups** | `FilterState.tags` (AND semantics) + `selectEntries` | **W1 · W1-DOMAIN · `lib/entryFilter.ts`** |
| | Tag chip row in the shared filter bar | **W1 · W1-UI · `components/filters/FilterBar.tsx`** |
| | `TagChip` atom with `active`/`onToggle` | W1 · W1-KIT · `components/entry/TagChip.tsx` |
| | GIN index on `entries.tags` | W1 · W1-DB · `0004` |
| | Wired on follow-ups / board | **W2 · W2-FOLLOWUPS / W2-BOARD** |
| | URL round-trip so a filtered link is portable | W1 · W1-DOMAIN · `filterToParams`/`filterFromParams` |
| **Tag breakdown in the track view** | `tagBreakdown(entries, tags)` pure helper | W3 · W3-TIMELINE · `src/lib/timeline.ts` |
| | Rendered in the per-track view, driven by that track's `suggested_tags` | **W3 · W3-TIMELINE · `src/pages/Tracks.tsx`** |
| **Tag breakdown in the digest** | `DigestTrack.tagBreakdown` in the model | W3 · W3-DIGEST · `lib/digest/types.ts` |
| | Built from `DigestOptions.tagBreakdown`, **defaulting from `tracks.suggested_tags`**, explicit ids as an override — one mechanism, not two | **W3 · W3-DIGEST · `lib/digest/build.ts`** |
| | Rendered in all three formats × both locales | W3 · W3-DIGEST · `markdown/plain/html.ts` |
| | Proven in the wave gate | W3 gate (d) |
| **Vocabulary keys stay FROZEN** | The four unions carry a "do not edit" comment; `FROZEN_KEYS` is exported and the admin UI has no add/remove control | W1 · W1-DOMAIN; W2 · W2-VOCABUI |
| | Proven: renaming a label re-labels historical `status_from`/`status_to` with zero writes | W2 gate (g) |

**Nothing in the codebase names a track.** `suggested_tags` is per-track, so the Onboarding requirement generalises to any track and a seventh track needs no code change.

---

## 7. RISKS

**1. Wave 1 semantic drift — eight workers building surfaces nobody has consumed yet.** The failure mode is not merge conflict (ownership is disjoint); it is `api/entries.ts` loaders that don't cover what follow-ups needs, CSS class names the kit doesn't use, a vocab API the board can't drive. This is the risk concentrator: if Wave 1 closes soft, waves 2–4 pay for it four times over.
**Mitigations, in order of value:** (a) the **serial keystone step** — `types.ts`, the api signatures, `text.ts` complete, the locale tree, the tsconfig changes and the CSS registry all land and `tsc -b` runs green **before** the other five workers start; this converts a hope into a gate for one hour on a six-gate path. (b) The **skeleton protocol** with its literal convention (`_`-prefixed params, throwing bodies) so `noUnusedParameters` + `no-unused-vars: error` cannot block it. (c) The **extension slot** — gaps go to the integrator during the close, never into someone else's file. (d) The Wave 1 gate refuses to close on anything unproven: every module has a test or a `?shell` harness, and every migration claim is a pasted SQL result.

**2. The RLS permission model versus every screen's design.** `entries_update` is narrower than SELECT: a member cannot edit, snooze, drag or close another member's item, and `updateEntry()`'s `.select().single()` turns the rejection into PGRST116 → an unmapped generic "Something went wrong" *after* the card has visibly moved and snapped back. Phases 4–6 are all designed as if members can act on each other's items.
**Mitigation:** the owner decision is forced **before W1-DB writes 0004**, with a specified default (widen to `is_member()`) and a fully specified fallback. Either way `lib/permissions.ts` + `ENTRIES_UPDATE_IS_OPEN` ship in Wave 1, the disabled affordance exists in the kit, `entry.errNotYours` + the PGRST116 branch exist in `pgErrorKey()`, and **Wave 2 gate (f) exercises both branches** by flipping the constant in a dev build. A later policy change is then a one-constant edit, not a UI rewrite.

**3. Silent Arabic failure — code that ships broken and green.** The verified fixture bug (`الشبكة` vs the seeded `الشبكات`, which fails all three match tiers under the specified folding) is the archetype: the tests were written from the same wrong data as the implementation, so they passed. The same shape of failure is available in `Intl` calendar defaults (an Arabic date silently rendering in the Islamic calendar with Arabic-Indic numerals, both forbidden by spec §5), in a digest renderer accidentally calling `t()`, and in an admin's English-only label rename blanking the Arabic UI.
**Mitigation:** `stemArabic()` in tier 2; **Wave 1 gate (i) greps every parser fixture name against the migration seed**; exactly one private `fmt()` helper may construct an `Intl.DateTimeFormat` and it hard-codes `ar-u-ca-gregory-nu-latn`; the digest's "resolve at build, never in the renderer" rule is proven by Wave 3 gate (d) generating an Arabic digest from an English UI; label resolution rule 3 (blank AR falls through to the i18n default, never to the English override) is a named unit test; and the locale parity test asserts interpolation-token parity, not just key parity.

**4. The offline write path touches everything already shipped.** By Wave 4 there are entry writes, update writes, meeting-line writes, template writes and vocab writes across a dozen modules. Retrofitting an outbox across all of them would be surgery on the whole app.
**Mitigation:** the seam is `store/outbox.ts` from the **first line of Wave 1 code**, and its op envelope carries `table`, `op`, `id`, `tempId`, `payload`, `dedupeKey` and `dependsOn` — enough to be replayed later without the caller knowing, which is precisely what the source designs left undefined. Wave 4 changes one file plus the banner; **`store/entries.ts` does not change**, and Wave 4 gate (b) proves it end to end on the owner's phone in airplane mode, including exactly-once delivery and `create → update` ordering. Residual risk: if the envelope is designed wrong in Wave 1 the mitigation evaporates — so the envelope is frozen in §2.2 and the Wave 1 auditor checks that no module bypasses `submit()`.

**5. Wave 0 depends on the owner's availability, and everything downstream is defined in terms of a live project.** If the browser-paired Supabase session slips, Wave 1 can *start* (SQL authoring, CSS, icons, parser, i18n are all offline work) but **cannot close** — its gate is written entirely in terms of a real database.
**Mitigation:** Wave 0 is scheduled first and is ~45 minutes of owner time in one contiguous block; the seven owner-only items are enumerated in §5.7 so nothing is discovered mid-session; the pipeline can be proven independently by pushing once with no secrets (it deploys a working shell that simply cannot sign in, which validates base path, HashRouter and PWA); and the standing instruction is absolute — **do not let Wave 1 close on unverified migrations**, which is the exact failure the front-loaded-spine decision exists to prevent.