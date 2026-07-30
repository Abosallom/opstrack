# v1.0.1 live verification — against the deployed site

Run **2026-07-31, 01:03–01:23 +0300**, by the V101-VERIFY agent, against
<https://abosallom.github.io/opstrack/> and the live Supabase project
`lrysgpbkmuqgzsjesfkr`. **Nothing here was measured on a dev server.** Every
claim that rests on a row gives the row's id, so it can be re-checked or
falsified later.

This document exists because the owner reviewed the final critic report and
decided that **R4** and **R3** had to be fixed *before the team started testing*
— and a fix that has only been tested by its own test suite is a fix nobody has
seen work. `fb1c8a8` claims four things. This run tries to break all four
against the bundle GitHub Pages actually serves.

**Result: four proofs attempted, four passed.** Two facts that are not failures
but that the team needs before it starts are recorded in §6, and one thing this
run could not measure is recorded in §5.2 rather than being quietly dropped.

---

## 0. What was under test, and how that was established

| | |
| --- | --- |
| HEAD | `d74eb5c` — `docs(v1.0.1): byte-verify live == HEAD`, on top of the fix commit `fb1c8a8` |
| `package.json` | `1.0.1` |
| Live entry chunk | `assets/index-XKeBLgBU.js` |
| `live == HEAD` | **85 of 85 files** byte-identical between the deployed origin and the local `dist/` — every asset, not a sample, each fetched with `Cache-Control: no-cache` and compared by `sha256`. `d74eb5c` had checked 14; this run checked the whole tree and found zero mismatches |
| Version reachable in the product | the JSON export taken in §4.1 carries `"appVersion": "1.0.1"` — read out of a file the deployed build generated, not out of a source tree |
| Edge functions live | re-queried at 01:23 — `admin-members` **v12**, `claim-account` **v12**, `send-push` **v6**, all `ACTIVE`, all `verify_jwt=true` |
| Migrations live | `member_directory()` present, `prosecdef = true` (0013); `profiles_preserve_owner_name` present on `public.profiles` as `BEFORE DELETE ... FOR EACH ROW` (0012) |

Session: an admin magic link minted through the GoTrue admin `generate_link`
endpoint for `az.alsaloom@gmail.com`, opened against the deployed origin. Token
claims read back from the tab: `sub 397d3122-7e3c-4046-ab4d-b45d154c7ac4`,
`amr: [{method: "otp", timestamp: 1785449009}]`. **No real credential was
handled at any point.** Two throwaway accounts were created and destroyed; their
one-time invite codes were displayed once on screen by design and are
deliberately **not** recorded here.

### 0.1 The first thing this run found was that it was testing the wrong bundle

The tab opened on `index-D5iltHie.js` while the deployed `index.html` referenced
`index-XKeBLgBU.js`. The service worker was serving its precache. Which build
`D5iltHie` belonged to cannot now be established and is not claimed here — the
origin answers **404** for it, and for `index-CCANcPK0.js` (the chunk the v1.0.0
smoke names as live) as well, because a Pages deploy replaces the whole tree and
only the current build's assets survive. What is established is that it was
**not** the bundle under test. Every measurement below was taken only after the
`opstrack` registration was unregistered, `workbox-precache-v2-.../opstrack/`
deleted, and the page reloaded onto the chunk names the live `index.html`
actually lists.

This is not a defect. `vite.config.ts` sets `registerType: 'prompt'` on purpose,
so the worker is *supposed* to hold the old bundle until a person accepts the
swap, and the app's **"A new version is available. Reload"** toast did appear
during this run once the worker re-registered. It is recorded because it is the
single most likely way this verification, or the team's testing, silently
measures the wrong build — the stale bundle was caught by diffing the tab's
loaded chunk names against the deployed `index.html`, not by noticing a prompt.
See §6.1.

---

## 1. R4 — `@username` assigns

> **Claim (`fb1c8a8`)** — an exact username is parser **tier 0**, above an exact
> display name, and `listMembers()` now carries the handle because
> `member_directory()` reaches `auth.users` where PostgREST cannot.

### 1.1 The fixtures, and why there are two

`@zz.v101.handle → that member` is satisfiable by accident: if the handle merely
fell through to some fuzzy tier and matched, the test would pass while the fix
did nothing. So the run provisioned **two** accounts through
`/settings/members`, arranged so that tier 0 and tier 1 disagree:

| | display name | username | id |
| --- | --- | --- | --- |
| **A** | `Bandar` | `zz.v101.handle` | `c93fcc08-9827-45c6-8424-0af3c0feeb3b` |
| **B** | `zz.v101.handle` | `zz.v101.other` | `9103e5b0-4edc-4bbb-9c0b-79c06d0b5451` |

**B's display name is A's username.** Typing `@zz.v101.handle` is now a question
with two different right answers depending on which tier wins:

- tier 0 (exact username) → **A**
- tier 1 (exact display name) → **B**
- no tier 0 at all, both hits → two candidates → ambiguous → **free text**

Both accounts were created through the Members screen in the browser, not
through the edge function directly — the admin's real path, invite code and all.

`member_directory()` as it stands on the live database derives the handle from
the sign-in address, exactly as the commit says, and not from the metadata bag
the client can write:

```sql
select p.id, p.display_name, p.role, public.username_from_email(u.email)
from public.profiles p left join auth.users u on u.id = p.id
where public.is_member()
order by p.display_name
```

`STABLE SECURITY DEFINER`, `search_path = public`, gated on `is_member()`.

### 1.2 The three probes

Typed into quick capture on the deployed site. The chip strip was read out of
the DOM as the parser produced it, before submitting.

| # | line typed | chip `data-kind` / `data-ok` / rendered value | verdict |
| --- | --- | --- | --- |
| **A** | `V101 probe A username tier @zz.v101.handle` | `owner` / `true` / **`Bandar`** | **tier 0 wins** |
| **B** | `V101 probe B display name tier @Bandar` | `owner` / `true` / **`Bandar`** | display name still resolves |
| **C** | `V101 probe C unknown handle @zz.nobody.here` | `owner` / `true` / **`zz.nobody.here`** | free text survives |

Probe **A** is the whole fix in one line. The chip reads `Bandar` — A's display
name — from a line that typed A's *username*, while a different member's display
name is that exact string. Under v1.0.0 the client did not know anyone's
username at all, and this line would have gone to B or to free text. Under a
naive one-tier fix it would have gone to B. It went to A.

Probe **C** additionally raised the informational notice, verbatim from the
page: *"⁨zz.nobody.here⁩ isn't a teammate — keeping it as free text."* — the chip
is not red, because an outside owner is a modelled case and not an error.

### 1.3 What landed in the live database

```
entries
  7687ce8e-4842-4f80-8ae9-78ac3f0df3fc  V101 probe A username tier
      owner_id = c93fcc08-9827-45c6-8424-0af3c0feeb3b   owner_name = NULL
  0c7e9541-4fac-41ae-a724-8ea7a476e57a  V101 probe B display name tier
      owner_id = c93fcc08-9827-45c6-8424-0af3c0feeb3b   owner_name = NULL
  80357cb1-58ca-4d85-9514-d127bd12bc08  V101 probe C unknown handle
      owner_id = NULL                                   owner_name = 'zz.nobody.here'
```

`owner_id` is **set**, which is the half of R4 that was broken. `owner_name` is
null wherever `owner_id` is set — the mutual exclusion the schema models — and
the free-text probe is the exact mirror image.

**And the notification landed**, which is the half of R4 that matters to the
person being assigned work:

| id | recipient | kind | entry | actor |
| --- | --- | --- | --- | --- |
| **106** | `c93fcc08-…` (A) | `assigned` | `7687ce8e-…` | `397d3122-…` "Aziz" |
| **107** | `c93fcc08-…` (A) | `assigned` | `0c7e9541-…` | `397d3122-…` "Aziz" |

No notification exists for probe C, correctly: there is nobody to notify.

> **R4 — PASS.** `@username` resolves above an exact display-name collision,
> `@display name` still resolves, an unknown `@handle` is still free text, and
> assignment produces both the `owner_id` and the notification row.

---

## 2. R3 — a departing member leaves the credit behind

> **Claim (`fb1c8a8`)** — a `BEFORE DELETE` trigger on `public.profiles` moves
> `owner_id` into `owner_name` in one statement, on all four doors an account can
> die through, and the activity clocks are restored so a departure does not make
> stale work look attended to.

Member **A** owned two entries. She was removed through the Members screen —
the product's own path, its own confirm dialog, not SQL.

The dialog read, verbatim: *"Remove this member? ⁨Bandar⁩ loses access
immediately. Their entries stay, credited to their name. Their updates and
meeting notes stay too, but without their name on them."* That is the corrected
copy: it no longer promises a name on updates and meeting notes, which have no
name column to keep one in.

### 2.1 In the database

| entry | before delete | after delete |
| --- | --- | --- |
| `7687ce8e-…` | `owner_id c93fcc08-…`, `owner_name NULL` | `owner_id NULL`, **`owner_name 'Bandar'`** |
| `0c7e9541-…` | `owner_id c93fcc08-…`, `owner_name NULL` | `owner_id NULL`, **`owner_name 'Bandar'`** |

The account is genuinely gone — `auth.users` 0 rows, `public.profiles` 0 rows
for `c93fcc08-…`. The credit outlived it.

**The clocks did not move.** `updated_at` and `last_activity_at` on both entries
read `22:12:01.06115+00` and `22:12:18.35821+00` after the delete — byte-identical
to their values before it. This is the specific trap the commit says 0012 avoids:
a departure that bumped the activity clock would make two months of untouched
work look attended to this morning. It did not.

### 2.2 In the UI

Board, after a reload, hit-tested per card:

| card | `data-assigned` | initials | rendered owner |
| --- | --- | --- | --- |
| `V101 probe A username tier` | `true` | `B` | **`Bandar`** |
| `V101 probe B display name tier` | `true` | `B` | **`Bandar`** |
| `V101 probe C unknown handle` | `true` | `Z` | `zz.nobody.here` |

Not `Unassigned`. The entry detail screen agrees: the owner picker has
**"Outside the workspace"** `aria-checked="true"`, and its free-text field holds
`Bandar`. A member who left renders identically to a vendor who was never in the
workspace, which is what the atom's contract says it should do.

> **R3 — PASS.** In the database and on two different screens.

---

## 3. STICKY-OFFSET — the offline strip clears the header

> **Claim (`fb1c8a8`)** — `app-shell.css` publishes `--app-header-block-size`
> and the strip pins below it. The z-index was not lowered; that was the trap.

`navigator.onLine` forced false and the `offline` event dispatched — the same
signal DevTools' offline checkbox makes the page observe. The strip came up
reading *"You're offline — showing the last loaded data."*

| | at `scrollY 0` | at `scrollY 556` |
| --- | --- | --- |
| `.app-header` bottom | 64.5px | 64.5px |
| `.offline-region` top | **65px** | **65px** |
| **overlap** | **0px** | **0px** |
| header controls reachable by hit-test | **4 / 4** | **4 / 4** |

Reachability is `document.elementFromPoint()` at each control's centre, asserting
the element returned *is* that control — the test the v1.0.0 bug fails, because
there the strip was the hit target. All four of *Open notifications*, *Change
theme*, *Switch language*, *Settings* answer for themselves, both pinned and
scrolled.

The offset is not a constant that happens to be right. Read off the live page:

```
--app-header-block-size: max(56px, calc(44px + max(10px, 0px) + 10px + 1px))
```

which resolves to 65px — the measured `stripTop` exactly. The strip is reading
the header's own published geometry, as the fix describes, not a copied number.

> **STICKY-OFFSET — PASS** at the width measured. See §5.2 for the width that
> was not measured.

---

## 4. Brand residuals

### 4.1 Generated filenames

Driven through the product's own buttons on the deployed site. The `download`
attribute was captured at click time *and* the resulting files confirmed on disk:

| what | filename |
| --- | --- |
| Export → Download JSON | **`coretrack-export-2026-07-31-0118.json`** |
| Export → Download CSV | **`coretrack-export-2026-07-31-0118.csv`** |
| Digest → Download | **`coretrack-2026-07-25_2026-07-31.md`** |

All three carry `coretrack-`. They landed in a Downloads folder that still holds
the v1.0.0 files — `opstrack-export-2026-07-30-1955.json`,
`…-1958.csv`, `…-1959.csv` — so the before and the after sit side by side in one
listing. That is the residual, fixed, visible in the one place it was ever
visible to a person.

### 4.2 The envelope tag is deliberately unchanged

The JSON export's own header, read out of the downloaded file:

```json
{ "format": "opstrack-export", "appVersion": "1.0.1", … }
```

`format` is still `opstrack-export`, exactly as `fb1c8a8` says it must be: it is
a magic value a reader matches on to identify the file, and renaming it would
make every export taken before this build unreadable to every reader written
after. Two strings that shared a spelling and never shared a reason. The
`appVersion` beside it is independent confirmation that the deployed bundle is
1.0.1.

> **Residuals — PASS.**

---

## 5. What this run did not prove

Recorded here rather than left for a reader to assume.

### 5.1 S5-1 was not re-probed, by instruction

The owner **accepted** S5-1 (username enumeration through the GoTrue
`/auth/v1/recover` platform endpoint) and instructed that no platform workaround
be attempted. This run made no auth-config change and ran no enumeration probe.
`docs/FIX-BACKLOG.md` §"The decision, 2026-07-31" carries the reasoning and
scopes the "no username oracle" property to the claim flow; `README.md` and
`ADMIN.md` make no project-wide claim. `docs/WAVE1-ADDENDUM.md:171-173` still
says usernames are "handed out in person precisely so they are not public" — it
is scoped to the sign-in wrong-credentials branch, where it remains true, and it
is a dated wave design note, so it was **read and deliberately left**, on the
same principle that keeps the v1.0.0 smoke document unrewritten.

### 5.2 The offline strip was measured at one viewport width, not two

§3's numbers are at `innerWidth 1600`. The narrow case matters — `app-shell.css`
changes the header height across the 768px breakpoint, and a hardcoded offset
would be wrong on one side of it — and this run **failed to measure it**. The
resize call reported success but `innerWidth` stayed 1600, so the browser pane
never actually narrowed. Rather than report a number taken at the wrong width,
it is left open.

What *is* established is the thing the breakpoint would break: the offset is the
computed value of `--app-header-block-size`, published by `app-shell.css` and
read by the strip, so it is the header's own height by construction rather than
a constant that has to be kept in step. The 375px measurement should be taken
the first time a tester picks up a phone.

---

## 6. Two things the team needs before it starts

### 6.1 A tester who already installed v1.0.0 will be looking at v1.0.0

`registerType: 'prompt'` means the service worker never swaps under someone
mid-task — a deliberate choice, and the right one for an app whose whole point
is that a half-typed capture line is not lost. The consequence is that anybody
who opened CoreTrack before today keeps the old bundle until they take the **"A
new version is available. Reload"** prompt. §0.1 is this run walking into it.

**Tell the team to take the reload prompt before they start**, or the first bug
report will be R4 again.

### 6.2 Deleting a member deletes their notifications

Not a defect, and not a promise the confirm dialog makes — stated because it is
adjacent to R3 and someone will wonder. Notification rows 106 and 107, both
addressed to the departing member, went with the account on cascade. The
**entries** kept her name; the **notifications telling her about them** did not
survive her, which is correct — a notification is addressed to a person, and
that person no longer exists. Zero orphan notifications remain.

---

## 7. Cleanup, verified

Both fixture members were removed **through the Members screen**, not through
SQL. The three probe entries have no delete path in the product by design —
`entries_delete` is admin-only by policy and the UI cancels rather than deletes —
so they were removed with an admin statement.

The live database was then compared against the snapshot taken before the run
started:

| | before | after |
| --- | --- | --- |
| `auth.users` | 1 | **1** |
| accounts on `@opstrack.internal` | 0 | **0** |
| `public.profiles` | 1 | **1** |
| `entries` | 16 | **16** |
| `notifications` | 8 | **8** |
| `tracks` | 6 | **6** |
| `meetings` | 1 | **1** |
| `entry_updates` | — | 6 |
| `claim_counters` | — | 0 |

Counts are the weak form of that claim, so the strong form was taken too: the
**set of 16 entry ids is identical** to the pre-run snapshot, and **no
pre-existing row's `owner_id` or `owner_name` changed**. Zero rows titled
`V101%`, zero rows carrying `Bandar`, `zz.v101.handle` or `zz.nobody.here` as an
owner name, zero orphan notifications, zero `claim_counters`.

The workspace is byte-for-byte where it was at 01:05.

---

## 8. Verdict

| | |
| --- | --- |
| **R4** — `@username` assigns, above a colliding display name | **PASS** |
| **R4** — `@display name` still assigns | **PASS** |
| **R4** — unknown `@handle` still files free text | **PASS** |
| **R4** — assignment writes `owner_id` **and** a notification row | **PASS** |
| **R3** — delete moves `owner_id` → `owner_name` | **PASS** |
| **R3** — the row renders the departed member's name, not "Unassigned" | **PASS** |
| **R3** — activity clocks not disturbed by the departure | **PASS** |
| STICKY-OFFSET — header cluster reachable under the banner (1600px) | **PASS** |
| Brand — export and digest filenames read `coretrack-` | **PASS** |
| Brand — export envelope `format` deliberately unchanged | **PASS** |
| `live == HEAD` | **PASS** — 85/85 assets |
| Fixture cleanup | **PASS** — zero rows, ids diffed |
| STICKY-OFFSET at 375px | **NOT MEASURED** — §5.2 |

v1.0.1 is fit for the team to start testing. §6.1 is the one thing to say to
them first.
