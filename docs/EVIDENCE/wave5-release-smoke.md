# v1.0.0 release smoke — against the deployed site

Run 2026-07-30, 22:13–23:05 +0300, by the Wave-5 RELEASE agent, against
<https://abosallom.github.io/opstrack/> and the live Supabase project
`lrysgpbkmuqgzsjesfkr`. **Nothing here was measured on a dev server.** Every
number was read out of the deployed bundle, the deployed manifest, or the live
database; where a claim rests on a row, the row's id is given so the claim can
be re-checked or falsified later.

Session: an admin magic link minted through the GoTrue admin `generate_link`
endpoint for `az.alsaloom@gmail.com`, opened against the deployed origin — the
established pattern in this repo. No real credential was handled.

**The headline: the smoke found four defects that every prior gate had passed.
Two are fixed and shipped in this release; two are recorded below with their
dispositions and deliberately not fixed at the cut.** A smoke that finds nothing
has usually only proved that it looked where the tests already look.

*(Corrected 2026-07-31: this sentence said "three … one", counting §5.4 as a
design note rather than a defect. `FIX-BACKLOG.md` recorded four from the start —
**R1**–**R4** — and ranks **R4** as the first thing team testing will hit. Four
is the number.)*

> **All four are now fixed.** **R3** and **R4** were fixed in **`v1.0.1`** on
> 2026-07-31, on the owner's instruction, before the team started testing —
> §5.3 and §5.4 carry the details and the live evidence. **This document is not
> rewritten to match.** It is the record of what was measured against the
> deployed site on 30 July, and a record that quietly updates itself is worth
> nothing; the original findings stand in their original words, each with a
> dated note underneath. Read the headings for the current state and the bodies
> for what the run actually saw. **This is a v1.0.0 document. The v1.0.1 gate
> evidence is §7.**

---

## 0. What shipped

| | |
| --- | --- |
| Tag | `v1.0.0`, annotated, pushed. `git rev-parse 'v1.0.0^{}'` → **`79391d1`** (`git rev-parse v1.0.0` answers `67d7229`, the tag *object* — not a commit) |
| Last code commit | `8c888d9`. `79391d1` sits on top of it and is docs-only (`git diff --stat 8c888d9 79391d1` touches three files under `docs/`), so the tagged tree and the tested tree are the same code |
| Live bundle | `assets/index-CCANcPK0.js` |
| `live == HEAD` | **byte-verified 2026-07-31**: the chunk downloaded from the deployed origin and the local `dist/assets/index-CCANcPK0.js` are both `sha256 c4770fe4a58c0b8c400043a8d1b1f9af9e44abe8032ecb4629e8596237da086f`. The original run had only diffed the asset-name set for this cut; that gap is now closed. (The previous cut `7dc0f81` was byte-verified at the time: `sha256 5e766842…` for `index-C2ex0rGZ.js`.) |
| Edge functions live | re-queried **2026-07-31**: `admin-members` **v12**, `claim-account` **v12**, `send-push` **v6**, all `ACTIVE`, all `verify_jwt=true` — unchanged since the Wave-5 lens compared the deployed eszips against HEAD |
| Gates at the tag | `tsc -b` clean · `oxlint` 0 errors · **58 files / 1586 tests** green · `vite build` clean. The suite was **re-run at `79391d1` on 2026-07-31** in a detached worktree, so the count is measured at the tag rather than at a working tree that had drifted past it: `58 passed (58)` / `1586 passed (1586)`, identical |
| Version reachable in the product | Settings › About → `Version 1.0.0`; every export stamped `"appVersion": "1.0.0"` |

Three deploys were made during this run, each green, each verified live:

| Commit | What | Why it is in the release |
| --- | --- | --- |
| `7dc0f81` | version 1.0.0, About card, docs reconciled | the cut |
| `b82a15d` | PWA background colour — **found by this smoke** | §5.1 |
| `8c888d9` | language never persisted — **found by this smoke** | §5.2 |

The `v1.0.0` tag was created at `7dc0f81` and, after the two fixes, **deleted and
re-created at `8c888d9`**. Stated plainly rather than quietly: a release tag
whose tree is not the tree that is live is worse than a tag that moved once,
minutes after it was cut, before anybody had consumed it.

**Corrected 2026-07-31 — it moved once more, and this file could not have known.**
The tag as it stands resolves to `79391d1`, the commit that *added this file*:
writing the smoke evidence into the release was the last act of the cut, and a
tag that excluded it would have pointed at a tree with no record of the run that
qualified it. So the sequence was `7dc0f81` → `8c888d9` → `79391d1`, three
placements in forty-six minutes, all before anyone consumed it, and the last one
is docs-only on top of the second. **Now it will not move again** — v1.0.1 gets
its own tag, and the standing rule is that a tag whose sha is quoted anywhere in
`docs/` is quoted as `git rev-parse 'v<version>^{}'` output, never from memory.

---

## 1. Every screen, both languages, both themes, both widths

20 routes × {en, ar} × {light, dark} × {1280×800, 375×812} = **160 screen loads.**
Driven through the app's own header toggles for language and theme — not by
writing to `localStorage` — so the toggles are themselves under test.

Each load was measured, not eyeballed:

- `document.title`, and `<html>`'s `lang` / `dir` / `data-theme`
- a walk of every text node in `<body>` for a **leaked i18n key** — any string
  matching `namespace.someKey` against the 30 real namespace roots. This catches
  the failure `t()` makes silently: a key absent from both bundles renders as
  itself, in both languages, and looks like a label
- **horizontal overflow**: `documentElement.scrollWidth > innerWidth`, and when
  it trips, a scan of every element in the document for the widest offender and
  by how many pixels
- the element count under `<main>`, as a structural fingerprint

**Result: 160/160 clean. Zero horizontal overflow. Zero leaked keys. Zero route
mismatches.**

| Route | EN title | AR title | `<main>` nodes |
| --- | --- | --- | --- |
| `#/capture` | Quick capture | التسجيل السريع | 39 |
| `#/followups` | Follow-ups | المتابعات | 811 |
| `#/board` | Board | اللوحة | 684 |
| `#/tracks` | Tracks | المسارات | 543 |
| `#/tracks/:id` | Track | المسار | 337 |
| `#/entry/:id` | Entry | البند | 183 |
| `#/meetings` | Meetings | الاجتماعات | 47 |
| `#/meetings/:id` | Meeting | الاجتماع | 67 |
| `#/meetings/:id/triage` | Triage | الفرز | 222 |
| `#/meetings/:id/minutes` | Minutes | المحضر | 162 |
| `#/dashboard` | Dashboard | لوحة المؤشرات | 469 |
| `#/digest` | Digest | الملخّص | 85 |
| `#/notifications` | Notifications | الإشعارات | 131 |
| `#/settings` | Settings | الإعدادات | 198 |
| `#/settings/tracks` | Tracks | المسارات | 149 |
| `#/settings/vocabulary` | Vocabulary | المصطلحات | 348 |
| `#/settings/recurring` | Recurring items | العناصر المتكرّرة | 37 |
| `#/settings/members` | Members | الأعضاء | 30 |
| `#/settings/export` | Export | التصدير | 43 |
| `#/settings/notifications` | Push notifications | الإشعارات الفورية | 16 |

**The node counts are identical between locales and between themes, per route.**
That is the RTL mirror-equality claim stated as a number: Arabic is not a
different tree with different furniture, it is the same tree laid out the other
way. It is also why the counts are worth recording — a future regression that
drops a control in one direction only shows up here as an asymmetry.

Two rows deserve their own note.

- **`#/settings/notifications` reads "Notifications are blocked for this site"**
  in every one of the eight passes. That is a true statement about the browser
  profile the smoke ran in, not a defect: the permission was never granted here.
  It is the correct rendering of the denied state, which is worth having seen.
- **`#/settings/members` and `#/settings/vocabulary` read low at first** (12 and
  14 nodes) and settled at 30 and 348. Both fetch after mount — members through
  the `admin-members` edge function, which cold-starts. The probe's 900 ms was
  short, not the screens. Re-measured at 1500 ms they are stable, and the table
  above is the settled figure.

Themes were confirmed by computed colour rather than by the class name:
dark `--bg` → `rgb(16, 21, 25)`, light → `rgb(244, 246, 248)`, on every pass.

---

## 2. Capture → assign → notify → move → follow-up

A throwaway member was created **through the product's own screen**, not by
`curl`: Settings › Team members › Add member.

| Step | Evidence |
| --- | --- |
| Member created | `ZZ Smoke v1.0.0` / `@zz.smoke.v100`, role Member. `profiles.id = 78f915f2-ee7b-4187-b93c-2c0efe5026c2`, `auth.users.email = zz.smoke.v100@opstrack.internal`, created `19:47:06Z` |
| The invite code is shown exactly once | `3QLD-LL2E`, with "This is the only time this code is readable… the server keeps no copy". Card then read **Invite pending · Never signed in · Expires 13/08/2026, 22:47** |
| Capture parsed a real line | `ZZ-SMOKE v1.0.0 release check #network @zz.smoke.v100 !high /action due:+3d fu:tomorrow +verify` → preview resolved Track **Network**, Priority **High**, Type **Action**, Due **02/08/2026**, Follow-up **31/07/2026**, Tag **verify**, before submit |
| Capture wrote it | `entries.id = 4c7ce69f-5f28-4e68-bb76-79009eded3b2`, `19:47:53Z`. **The box cleared immediately**, the "Just captured" strip listed it, and the toast offered Undo |
| Assignment fired a notification | owner set to the member through the entry's own owner picker → `notifications.id = 58`, `kind = assigned`, `entry_title = ZZ-SMOKE v1.0.0 release check`, `actor_name = Aziz`, `recipient = ZZ Smoke v1.0.0`, `read_at = null`, `19:49:38Z` |
| Board move | `#/board`, the card's **Change status** `<select>` (the keyboard path, not drag) New → In progress. Toast: *"ZZ-SMOKE v1.0.0 release check" moved to In progress*. DB: `status = in_progress`, `last_activity_at 19:50:43Z`, and **one `entry_updates` row** written by the move |
| Follow-ups reflowed | the item appeared under **Due soon**, count 6 → 7, header 15 → **16 items need attention** |
| Follow-up snooze | the row's **In 3 days** action moved the follow-up Tomorrow → 02/08/2026, toast *"…moved to 02/08/2026"*, and the row re-rendered in place |

---

## 3. Digest, palette, offline, export

### 3.1 Digest — copy round trip, both languages

`Copy` was exercised with `navigator.clipboard.writeText` wrapped so the exact
string handed to the clipboard could be read back.

- **English**, Markdown: **1 975 characters**, toast *"Digest copied"*, opening
  `# Status digest / Covering 24/07/2026–30/07/2026 / 1 closed · 17 in progress ·
  2 blocked · 1 overdue`, grouped by track, and containing the entry captured
  minutes earlier.
- **Arabic**, Markdown: **2 167 characters**, `# ملخّص الحالة`, and the counts
  line is the one worth reading:
  `بند مُغلق واحد · 17 بندًا قيد التنفيذ · بندان متوقّفان · بند متأخّر`
  — singular, the *dual* (`بندان متوقّفان`, for exactly 2), and the `many`
  accusative form for 17, each correct. Latin entry titles inside the Arabic
  report carry U+2068/U+2069 isolates, so a title like `Draft Q3 steering pack`
  reads left-to-right inside a right-to-left sentence.
- **The report's language is independent of the app's.** Proven the way the
  screen's own hint claims: with `<html lang="en">` and the heading reading
  "Digest", selecting the Arabic *digest* chip produced the fully Arabic report
  above while the interface stayed in English.

> **A correction against myself.** The first time this was measured it looked
> like the digest chip was dragging the whole app into Arabic. It was not — the
> selector `find(b => b.textContent === 'العربية')` matched the *header's*
> language toggle, which appears earlier in the DOM and is labelled with the
> language you would switch **to**. Scoping the query to the
> `aria-label="Digest language"` group showed the property holds. Recorded
> because a smoke log that only lists confirmed findings hides how often the
> first reading is the instrument and not the app.

### 3.2 Command palette

⌘K opens `.cmd-dialog` with the input focused and options grouped (entries,
tracks, screens, actions). Typing `ZZ-SMOKE` narrowed 20+ options to exactly one,
`ZZ-SMOKE v1.0.0 release check — Network · In progress`.

Activating it **does not change the route**, and that is correct: an entry row's
`run()` calls `openEntry()`, which mounts the entry **sheet** over the current
screen. Observed: `role="dialog"`, `aria-label="ZZ-SMOKE v1.0.0 release check"`,
and `panel.contains(document.activeElement) === true` — focus moved into the
sheet rather than being yanked back to `#main`, which is exactly the behaviour
`shouldRestoreFocus()` in `CommandPalette.tsx` was written to produce.

### 3.3 Offline capture and flush

Offline was simulated the way the app detects it: `navigator.onLine` redefined
to `false`, `window.fetch` replaced with a rejecting stub so every request fails
the way a dropped connection does, and an `offline` event dispatched.

| | |
| --- | --- |
| Banner | *"You're offline — showing the last loaded data."* |
| Capture while offline | `ZZ-OFFLINE-3 v1.0.0 flush proof #network @zz.smoke.v100 !critical /issue due:+5d` |
| Toast | *"Saved on this device: "ZZ-OFFLINE-3 v1.0.0 flush proof". It syncs when you're back online."* |
| Queue | `opstrack_outbox_v1` held one item, `tempId = temp_64f22421-…`, `attempts 0`, dedupe key `entries:insert:temp_…:description,dueDate,followUpDate,ownerId,ownerName,priority,tags,title,trackId,type`, payload intact (`critical` / `issue` / `2026-08-04` / Network) |
| Banner updated | *"1 change waiting to sync — Show pending changes"* |
| Back online | `navigator.onLine` restored, real `fetch` restored, `online` dispatched |
| Flush | outbox drained to `items: []`, banner gone, and the row reached Postgres as `entries.id = 35f58de8-b42e-4b0c-9d4f-f598276e0366` at `19:57:14Z` with every field preserved |

### 3.4 A real export download

`URL.createObjectURL` was wrapped to capture the exact Blob handed to the
`<a download>` — the bytes the browser writes, not a re-derivation.

| | JSON | CSV |
| --- | --- | --- |
| Size | **47 521 B** | **7 921 B** |
| MIME | `application/json;charset=utf-8` | `text/csv;charset=utf-8` |
| Shape | `format: "opstrack-export"`, `version: 1`, `exportedAt`, `locale`, **`appVersion: "1.0.0"`**, `truncated: []`, `counts`, `data` | 23-column header, CRLF, 24 lines |
| Counts | tracks 6 · vocab_options 17 · track_slas 1 · entries 22 · entry_updates 7 · meetings 2 · meeting_lines 11 · recurring_templates 1 · notifications 8 | 22 entry rows |

**`notifications: 8` is the RLS boundary showing up in the artefact.** The
database held nine at that moment; the ninth was `id 58`, addressed to the
throwaway member. The admin's own export contains eight, because an export
contains exactly the rows the account may read — which is what the screen's own
copy promises, now demonstrated rather than asserted.

### 3.5 The update prompt, on a genuinely subsequent deploy

The tab was left open on `index-C2ex0rGZ.js` (the `7dc0f81` build) while
`b82a15d` was pushed, built and published — a real deploy, not a simulated one.

| Step | Evidence |
| --- | --- |
| The check that the app itself schedules | `registration.update()` — the same call `onRegisteredSW`'s interval and `visibilitychange` handler make |
| A worker went to waiting | `installing → waiting`, `waiting.scriptURL = …/opstrack/sw.js` |
| The prompt appeared | a sticky toast, *"يتوفّر إصدار جديد."* with action *"إعادة التحميل"* — observed in Arabic, then re-rendered in English as *"A new version is available." / "Reload"* when the language was toggled under it |
| **Exactly one** | `document.querySelectorAll('.toast').length === 1` after the tab had seen **two** deploys. The `key: 'sw-update'` in `main.tsx` is doing its job: the second raise replaced the first rather than stacking |
| The button works | tapping Reload swapped the tab to `index-BYijmJ9_.js`, cleared the toast, left no waiting worker — **and the session survived**: still signed in, no re-authentication |
| Repeated | the same path was walked again for `8c888d9` → `index-CCANcPK0.js` |

---

## 4. Throwaways deleted, and verified gone

The member was removed **through the app**, which is also the destructive-confirm
proof.

| Step | Evidence |
| --- | --- |
| Confirm dialog | `.confirm-backdrop`, *"Remove this member? ⁨ZZ Smoke v1.0.0⁩ loses access immediately. Their entries, updates and meeting notes stay, credited to their name."* with **Cancel** / **Delete** |
| Deleted | toast *"Member removed"*, row gone from the list |
| Verified in **both** tables | `auth.users where email like 'zz.smoke%'` → **0**; `profiles where display_name like 'ZZ Smoke%'` → **0** |
| Cascade | `notifications.id 58` → **0 rows**. A notification does not outlive its recipient |

Test rows were then removed, including two this run did not create — the Wave-4
ledger (`wave4-live-proof.md`, residue table) had assigned exactly this cleanup
to Wave 5, conditional on §3.1 being accepted, and §3.1 has now been re-proved
end to end by §3.3 above:

```sql
delete from public.entries where title like 'ZZ-OFFLINE-%' or title like 'ZZ-SMOKE%';
delete from public.claim_counters;
```

Final state of the live workspace:

| | |
| --- | --- |
| `entries` matching `ZZ-%` | **0** |
| `claim_counters` | **0** |
| `entries` total | 18 (real workspace data) |
| `profiles` / `auth.users` | **1 / 1** — the owner, and nobody else |
| `notifications` | 8, all the owner's |

**Deliberately left alone**, because the same ledger records them as real
furniture rather than residue: the bilingual meeting `0136ab58-…` and its ten
lines, the seven triage-created entries, the active weekly `recurring_templates`
row `f3492bf8-…`, and the `(Network, high) = 2 days` SLA override. All four are
visible and changeable from the app's own admin screens.

**Not deleted, and flagged instead:** a handful of entries and one meeting whose
titles begin `Mobile 375 verification…` / `Mobile verification pass — Wave 2`.
They look like a previous pass's fixtures but carry **no disposition** in any
ledger, and removing another run's evidence without one is precisely what the
EVIDENCE protocol forbids. They are ordinary workspace rows; the owner can
delete them from the app in two taps if they are noise.

---

## 5. Defects the smoke found

### 5.1 One dark background, declared four ways — FIXED (`b82a15d`)

Measured on the deployed origin with `getComputedStyle`, and against the
deployed `manifest.webmanifest`:

| Declaration | Was | Real `--bg` |
| --- | --- | --- |
| `src/styles/global.css` — the truth | `#101519` / `#f4f6f8` | — |
| `src/lib/theme.ts` runtime `<meta theme-color>` | `#0f1115` / `#f7f8fa` | both wrong |
| `index.html` static `<meta theme-color>` | `#101215` | wrong |
| `vite.config.ts` manifest `theme_color` + `background_color` | `#101215` | wrong |
| `capacitor.config.json` | `#101519` | correct |

Every one of the three wrong ones carried a comment claiming it matched.
`APP-STORE.md` §5 had reported two of them at the Wave-4b close and correctly
left them alone as another owner's files, calling the cost "three characters,
but a visible seam on the PWA splash". That undersells where it lands: **Android
paints an installed PWA's splash screen with `background_color` and iOS Safari
tints the status bar with `theme-color`** — so the seam was going to sit above
every screen of the first install this release is being handed to.

No test can catch this shape. A CSS custom property is not readable from module
scope, and reading it from the live document would make `applyTheme()` depend on
the stylesheet load it deliberately runs before. `theme.ts` now carries the
measurement instead of the assertion. **Verified live after the fix:**
`<meta theme-color>` `#f4f6f8` against `body` `rgb(244, 246, 248)` in light, and
`#101519` against `rgb(16, 21, 25)` in dark — exact, both ways.

### 5.2 The language choice never reached the profile — FIXED (`8c888d9`)

Found by clicking the header's language toggle on the deployed site and then
reading the database. **The interface switched to Arabic. `profiles.locale` still
said `en`.**

```ts
void client.from('profiles').update({ locale: l }).eq('id', userId)
```

A PostgREST query builder is a **thenable, not a promise**. `postgrest-js` sets
the headers, builds the URL and calls `fetch` inside `PostgrestBuilder.then()`
(verified this run in `node_modules/@supabase/postgrest-js/dist/index.cjs:277`).
`void` evaluates its operand and discards it without ever subscribing — so the
line built a request object, dropped it, and sent nothing. A patched
`window.fetch` on the live origin recorded **zero** requests to `/profiles`
across a full toggle.

The cost: `store/auth`'s `applyProfileLocale` reads that column once per sign-in
and applies it, which is right — the profile is how a preference follows you to a
second device. With the write missing, the column was frozen at whatever
`handle_new_user` inserted, so **every load pulled the interface back to
English.** Change the language, reload, you are in English again. On a product
whose Arabic is a first-class locale down to the bidi isolates, the app forgot
its language every single time it was opened.

Why every gate missed it: not a type error (the expression is well-typed, and
`void` is the lint-approved way to write "deliberately not awaited" — oxlint is
satisfied by exactly the token that causes the bug); not a runtime error (nothing
rejects, nothing logs); and invisible in the session that causes it, because
`lib/i18n` has already switched the UI and written `opstrack_locale`. The symptom
lands on the *next* load, on a different screen.

`src/store/settings.test.ts` now fakes the client with a builder whose `then`
increments a counter — subscription is the only observable that separates "sent"
from "built and discarded"; asserting `.update()` was called passes against the
bug. Checked both ways: reverted to the `void` form the test fails
`expected +0 to be 1`. The tree was swept for the same shape; this was the only
occurrence.

**Verified live after the fix:** toggled to Arabic → `profiles.locale = 'ar'`;
then `localStorage.removeItem('opstrack_locale')` and reloaded, so that only the
profile could supply the language → the app came back **Arabic**, nav reading
`تسجيل · المتابعات · اللوحة · المسارات`, About card `عن التطبيق / الإصدار ⁨1.0.0⁩`.

### 5.3 Deleting a member drops the credit it promises to keep — FIXED in `v1.0.1`

The confirm dialog says:

> ⁨ZZ Smoke v1.0.0⁩ loses access immediately. **Their entries, updates and meeting
> notes stay, credited to their name.**

Measured after the delete: the entry stayed, and `owner_id` **and** `owner_name`
are both `null`. The entry now reads **Unassigned**. The substantive half of the
promise holds — nothing was destroyed, `created_by` is intact — but the
attribution clause is not true. `owner_name` exists precisely to hold a name with
no account behind it, so the schema already has the right shape; nothing writes
into it on the way out.

**Deliberately not fixed at the cut.** The fix belongs in the `admin-members`
edge function or a trigger — copy `display_name` into `owner_name` for every row
about to lose its `owner_id` — which means a migration or a function redeploy on
the destructive member-delete path, shipped with no reviewer left in the wave. A
wrong attribution line is a smaller risk than an unreviewed change to the code
that deletes accounts. Filed in `FIX-BACKLOG.md`. Either the behaviour changes or
the sentence does; the sentence should not change first.

> **v1.0.1, 2026-07-31 — fixed, and live.** Everything above stands as the record
> of what was measured on 30 July. What changed: `0012_preserve_owner_name.sql`
> adds a `before delete` trigger on `public.profiles` that copies `display_name`
> into `entries.owner_name` and `recurring_templates.owner_name` while nulling
> `owner_id` in the same statement, and puts `updated_at`/`last_activity_at` back
> afterwards so a departure does not reset the staleness clock on everything the
> person owned.
>
> **A trigger and not `admin-members`, which is the part this note got wrong.**
> The section above says the fix "belongs in the `admin-members` edge function or
> a trigger" as if the two were interchangeable. They are not: an account can die
> through four live doors — the function, the dashboard's Authentication → Delete
> user, a SQL-Editor `delete from auth.users`, and `delete from profiles` over
> PostgREST, which 0001's `profiles_delete` policy already permits any admin. A
> TypeScript fix covers one of the four and the confirm dialog would then be
> telling the truth only when the delete came through the app.
>
> **"Not live until redeployed" — resolved the other way.** No function was
> redeployed, because no function changed; the migration is the deliverable, and
> it was applied to `lrysgpbkmuqgzsjesfkr` twice, its three probes passing both
> times (a GoTrue delete, a blank display name, and the PostgREST door). The
> comment added to `admin-members` is a comment only.
>
> **The dialog copy changed too**, in both languages, and had to: entries keep the
> name, but `entry_updates.author_id` and `meetings.created_by` have no name
> column beside them, so the old sentence was two-thirds true. It now says the
> updates and meeting notes stay *without* the name.

### 5.4 `@username` does not assign — FIXED in `v1.0.1`

`matchMemberTiers()` in `src/lib/capture/parse.ts` matches an `@handle` against
`displayName` and `aliases` **only**, on exact or prefix match, never on
subsequence — deliberately, and the comment explains why: silently assigning work
to the wrong person is worse than leaving free text. An unmatched handle becomes
`owner_name`, which the schema models as a first-class case for vendors and
people outside the workspace. All correct.

The friction is that **members are provisioned by username.** The Members screen
identifies people as `ZZ Smoke v1.0.0 @zz.smoke.v100`, the code you hand over is
tied to that username, and the capture placeholder is `@ahmed` — handle-shaped.
Typing the identifier you were actually given, `@zz.smoke.v100`, produced a
free-text owner both times this smoke tried it: **no assignment, and therefore no
notification.** Nothing turns red; the chip renders and the capture succeeds.

The seeded example hides it: `@ahmed` matches *because* it is a prefix of the
display name `Ahmed Al-Otaibi`. `@ahmed.otaibi` — the username — would not.

Not a defect against the spec, so not fixed here. The parser's own comment names
the fix and says it needs no reopening of that file: `ParseMember.aliases` is
already threaded through, and `foldedForms(member.displayName, '', …)` has an
empty slot where a handle would go. Filed in `FIX-BACKLOG.md` as the most likely
first-run surprise for the team.

> **v1.0.1, 2026-07-31 — fixed, and live.** The wording above is kept as the
> record of what was measured on 30 July. "Not a defect against the spec" was the
> right call at the cut and the wrong thing to leave standing into the first week:
> the identifier the admin hands out has to be the identifier that assigns.
>
> **The prescribed fix was half of it, and the inert half.** This section says the
> parser's own comment "names the fix" — feed the handle into
> `foldedForms(member.displayName, '', …)`. That change alone would have done
> nothing, because the client is never told anyone's username: `listMembers()`
> read `profiles`, and a username lives in `auth.users`, which PostgREST cannot
> reach with a select at all. There was no handle in memory to fold.
>
> So the fix has two halves. **Data:** `0013_member_usernames.sql` adds
> `member_directory()` — SECURITY DEFINER over `profiles ⟕ auth.users`, gated on
> the same `is_member()` predicate as `profiles_select`, execute revoked from
> `anon` — and `listMembers()` is now that RPC. The handle is derived from the
> sign-in address and deliberately **not** from `raw_user_meta_data`, which any
> signed-in member can write; reading it there would have let someone spoof the
> lead's handle and quietly collect their assignments. **Matcher:** an exact
> username is now **tier 0**, above an exact display name, because a handle is
> unique by construction and must not be outvoted by a name that merely starts
> with the same letters. Subsequence is still not a tier — the reasoning quoted
> above is untouched.
>
> Live, on `lrysgpbkmuqgzsjesfkr`: migration applied twice; `anon` calling the RPC
> over real PostgREST is refused `401 / 42501`; a signed-in member gets the roster
> with handles; a `zz.gate.v101` fixture round-tripped `@handle → assignment →
> deletion → credit` in a transaction that was rolled back.

---

## 6. What this run did not cover

Stated so nobody reads a green smoke as more than it is.

- **A real phone.** Every measurement above is a desktop browser at a 375-wide
  viewport, which is a layout test, not a device test. Touch, momentum scrolling,
  the iOS keyboard, the safe-area inset on a notched screen and real network
  transitions are all still unverified on hardware.
- **Push on iOS.** `#/settings/notifications` rendered its denied state in all
  eight passes because the permission was never granted in this profile. Web push
  end-to-end is proven on desktop Chrome, with row ids, in `RUNBOOK.md` §9.4;
  iOS/Safari, a locked screen, and `notificationclick` focusing the right entry
  remain owed to a manual pass.
- **A second human.** Everything was done as one admin. Two people editing the
  same entry, realtime arriving from another session, and the member-claim flow
  at `/claim` were not exercised this run.
- **Native iOS.** Untouched here; `APP-STORE.md` §4 is the standing list.
- **Screenshots.** None. The browser pane was hidden for this run, and measured
  values — computed colours, overflow in pixels, node counts, row ids — are
  better evidence than an image anyway. Where a screenshot would have been the
  only proof, the claim is marked unverified above instead.
- **Security. This was a functional smoke and nothing in it is a security
  result.** Added 2026-07-31, because a green release-smoke sitting next to a
  security section in the backlog invites exactly the wrong inference. The
  Wave-5 security lens reported four items and **one arrived**: `S5-1` (a
  Supabase platform endpoint confirms whether a username exists) is recorded,
  was escalated, and is now `accepted` by the owner — a username is not a secret
  in this product. Its **config finding, its correctness finding and its
  residuals never reached integration at all** and stand as `S5-2`, `S5-3`,
  `S5-R`, disposition *not received*. Nothing in this run substitutes for them;
  re-running those two passes is named work in
  [`../FIX-BACKLOG.md`](../FIX-BACKLOG.md).

---

## 7. v1.0.1 — the gate that closed R3 and R4

Run 2026-07-31 by the Gate agent, against the same live project
`lrysgpbkmuqgzsjesfkr`. **This is a gate, not a second smoke.** Nothing here
re-walks the eight screen passes of §1 or the round trip of §2; it records what
was verified about the four changes v1.0.1 carries, and it is deliberately
shorter than §§1–5 because the release is deliberately smaller.

### 7.1 What v1.0.1 contains

| | |
| --- | --- |
| **R4** | `@username` now assigns. Migration `0013` + `listMembers()` on an RPC + username as parser tier 0. §5.4 |
| **R3** | A deleted member's work keeps their name. Migration `0012`, a `before delete` trigger on `profiles`. §5.3 |
| `STICKY-OFFSET` | The offline strip pins below the header instead of over it; `app-shell.css` publishes `--app-header-block-size`. |
| Brand residuals | Generated **filenames** carry `coretrack-`; the icon comment lost the retired product name. The export envelope's `format: 'opstrack-export'` is **unchanged and pinned** — it is a magic value readers match on, not a brand. |
| **S5-1** | `accepted` by the owner. No code change; the docs that implied a project-wide "no username oracle" now scope that property to the claim flow. |

### 7.2 Gates

| Gate | Result |
| --- | --- |
| `tsc -b` | clean, exit 0 |
| `oxlint` | exit 0 — 25 warnings, all `react(only-export-components)`, the standing v1.0.0 baseline; **0 errors** |
| `vitest run` | **59 files / 1615 tests** passed. v1.0.0 was 58/1586, re-measured at `79391d1` in a detached worktree the same day; the +1/+29 is itemised per file in `FIX-BACKLOG.md` |
| `vite build` | clean; PWA precache 83 entries |
| Standing grep — logical CSS | clean. The naive `\b(width|height|left|right|…)\s*:` form returns ~150 lines, **every one a false positive**: 116 `line-height`, 20 `max-width`, 8 `min-width`, 5 `stroke-width`, 3 `scrollbar-width`, and 4 occurrences of the words *width*/*height*/*right* in comment prose. Anchored so the property must start a declaration — `(^|[;{]|\*/)\s*(width|height|left|right|margin-left|margin-right|padding-left|padding-right)\s*:` — the count is **0** |
| Standing grep — layering | clean **after a fix**; see §7.3 |
| Standing grep — hardcoded JSX strings | clean. Hits are all `<button>`/`<details>` inside comment prose and `=> Promise<boolean>` in type positions |
| Standing grep — `any` / `@ts-expect-error` | clean. `@ts-expect-error`, `@ts-ignore`, `@ts-nocheck`: **0**. The `any` hits are the English words *any*/*anything* in prose; excluding comment lines, **0** |
| Locale parity / reach / plural / bidi | 7 suites, 182 tests, green — includes the brand gate and its new generated-filename coverage |

### 7.3 The layering grep caught a real regression, and it was fixed rather than silenced

`src/lib/departedOwner.test.ts` — the browser-side pin for R3 — was written into
`src/lib/`, and `grep -rn "from '\.\./store\|from '\.\./api" src/lib/` returned
one line. HEAD was clean, so this was new.

The one line the grep sees was not the whole problem. The file also reached
across the layer three more times, in forms the grep's `from '` pattern cannot
match — `vi.mock('../store/auth')`, `vi.mock('../api/members')` and
`await import('../store/members')`. Deleting the static type import would have
made the gate green and changed nothing real.

**Fixed by moving the file to `src/store/departedOwner.test.ts`.** Its subject,
`memberLabel`, is a store export; the `lib/` functions it also calls are what it
is checked *against*. `src/store/` already imports both `../api/` and `../lib/`
by design, so the file is correctly placed there and misplaced where it was. All
four cross-layer references are now legal, `grep -rnE "(import|vi\.mock)\(\s*'\.\./(store|api)" src/lib/`
is empty as well, the ten tests pass unchanged, and `0012`'s header — which cites
the file by path — was updated with it.

### 7.4 Live

Both migrations were **applied twice** through the Management API, all probes
passing on both runs. That the probes are load-bearing was itself checked: a
deliberate `raise exception` through the same endpoint answers `HTTP 400` with
the message, so the four `HTTP 201`s mean the probe blocks ran and did not raise.

| Check | Result |
| --- | --- |
| `0012` re-applied ×2 | `201`, `201`. Probes: GoTrue delete keeps the name and both clocks; a blank `display_name` leaves the row honestly unassigned; the PostgREST door gives the same answer |
| `0013` re-applied ×2 | `201`, `201`. Probes: the synthetic-domain fold, a real address yielding `NULL`, `anon` denied, `authenticated` granted, the helper revoked from both, `0` rows with no session, the full roster to a member |
| `member_directory()` live signature | `TABLE(id uuid, display_name text, role text, username text)`, `prosecdef = true`, `stable` |
| `anon` over **real PostgREST** | `POST /rest/v1/rpc/member_directory` → **`401`**, `{"code":"42501","message":"permission denied for function member_directory"}` |
| PostgREST schema cache | carries the new function: an unknown name answers `404 / PGRST202`, and its hint reads *"Perhaps you meant to call the function public.member_directory"*. The 42501 above is therefore a grant refusal, not a missing route |
| R4 + R3 end to end | a `zz.gate.v101@opstrack.internal` fixture: `member_directory()` answered `zz.gate.v101` to a signed-in member (R4); deleting the account left `owner_id NULL`, `owner_name 'V101 Gate Smoke'`, both clocks unmoved (R3) |
| Fixtures | **none leaked.** The whole probe ran in a subtransaction discarded by a sentinel exception; re-queried after: 0 leftover users, 0 profiles, 0 entries, 0 templates, roster still 1 |

**What §7 does not cover.** No browser pass was run for v1.0.1 — the `@handle`
round trip is proven at the database and in 1615 unit tests, not on the deployed
page, and `STICKY-OFFSET` is verified by reading the computed formula (65px at
both widths) rather than by re-measuring `elementFromPoint` on the deployed CSS.
Both are named here so nobody reads §7 as a repeat of §1.
