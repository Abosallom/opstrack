# Wave 1 Addendum — delta contracts

**Written by the Wave-1 serial keystone. Binding on every worker in waves 1–5.**

`docs/EXECUTION-PLAN.md` remains the governing document. It was written before five additions were
approved, so where this file and the plan disagree, **this file wins** — and it disagrees in exactly
the places listed below and nowhere else. Everything in the plan not named here is untouched: the
frozen unions, the write seam, the connectedness rule, the layering rule, the label-resolution
order, the fetch strategy, the file-ownership table.

The purpose of this document is to be the one place an auditor can check a Wave-1+ claim against,
without re-deriving it from a chat log.

---

## 1. The five approved additions

| # | Addition | Where it lands |
|---|---|---|
| 1 | **Notifications** — a `notifications` table written by DB triggers (assigned → owner; done → the entry's **creator**; never self-notify), in-app centre first, Web Push after | 0004 (table + triggers) · `api/notifications.ts` + `store/notifications.ts` (W1-DATA) · bell/inbox UI (W3) · Web Push (W4) |
| 2 | **App-Store-ready** — Capacitor iOS wrapper, verified in the Simulator | W4. Submission needs an Apple Developer account: documented, not blocking. No Wave-1 surface. |
| 3 | **Username sign-in** — admin predefines a username, member claims it once with a one-time invite code and a password they choose | `admin-members` v2 + new `claim-account` edge function, `store/auth.ts`, `api/members.ts` (W1-AUTH) · SignIn rewrite (W2) · Members page (W4) |
| 4 | **Active Directory** — read as Azure AD / Entra SSO through Supabase's Azure OIDC provider. On-prem LDAP is unreachable from a static PWA and is flagged as such. | W4, button-only until the owner's tenant supplies a client id/secret. Wave 1 ships `signin.microsoft` and nothing else. |
| 5 | **SLA on tasks** — `sla_days` per **priority** row in `vocab_options`, admin-editable; `v_entry_health` computes `sla_due_at` and `sla_breached` | 0003 (column + view) · `types.ts` (keystone) · `lib/health.ts` (W1-DOMAIN) · badges/sections (W2) · compliance % (W3) |

Additions 2 and 4 have **no Wave-1 code surface** and are listed only so an auditor does not go
looking for one.

---

## 2. Delta contracts — normative

### 2.1 `src/types.ts` (published FINAL by the keystone, not by W1-DOMAIN)

The plan assigns `types.ts` to W1-DOMAIN. **It is published by the keystone instead**, so the
`tsc -b` handshake exists before any parallel worker starts. W1-DOMAIN must **not** rewrite it;
append-only, and only through the wave integrator, per plan §1.0.3.

Beyond plan §2.1, `types.ts` now carries:

```ts
VocabRow.sla_days: number | null        // priority rows only, same CHECK as stale_after_days
EntryHealth.sla_due_at: string | null   // created_at + sla_days, NULL when SLA is off
EntryHealth.sla_breached: boolean       // false whenever sla_due_at is null

export type NotificationKind = 'assigned' | 'completed'
export interface AppNotification {      // VIEW MODEL, camelCase; api/ maps the row
  id; recipientId; kind: NotificationKind
  entryId; entryTitle                   // title is a SNAPSHOT, not a join
  actorId: string | null; actorName: string
  readAt: string | null; createdAt
}
export interface NotificationPrefs { assigned; completed; allCompletions; push }  // all boolean
export interface ClaimInput { username; inviteCode; password }                    // all string
```

`Entry` gains **nothing** — SLA is computed, never stored on the entry.

Named `AppNotification`, not `Notification`, because `Notification` is a DOM global and Wave 4's
Web Push module would shadow it.

`NotificationPrefs`' four fields are a keystone judgement call (the approved scope named only the
behaviours). `allCompletions` is the admin-only opt-in to every completion, gated server-side on
`profiles.role` — a member setting it changes nothing.

**One deliberate weakening, and it is temporary.** `TrackInput.suggestedTags` ships as
`suggestedTags?: string[]`, not required. `TrackEditor.tsx` passes an object literal to
`createTrack()`, and that file belongs to W1-DOMAIN; a required field would red `tsc -b` on a file
the keystone must not edit, and the keystone's whole job is a green handshake.
**W1-DOMAIN tightens it to `suggestedTags: string[]` in the same commit that adds the editor
field and the `api/tracks.ts` column read/write.** The Wave-1 auditor checks that it happened.

### 2.2 SLA — the full chain

| Hop | Owner · file |
|---|---|
| `vocab_options.sla_days int` + `vocab_stale_only_priority`-style CHECK (`kind = 'priority' or sla_days is null`) and a range CHECK (1–3650) | **W1-DB · 0003** |
| Seed `sla_days` **NULL** on all four priority rows | **W1-DB · 0003** |
| `v_entry_health` gains `sla_due_at` and `sla_breached`, from the same `left join vocab_options vp` the staleness coalesce already uses | **W1-DB · 0003** |
| `reset_vocab()` restores `sla_days` to the seed value (NULL) | **W1-DB · 0003** |
| `VocabPatch.slaDays?: number \| null` · `updateVocab` writes it | **W1-DOMAIN · api/config.ts** |
| `VocabItem.slaDays` · `useSlaDays()` · `slaDays(snapshot, priority)` | **W1-DOMAIN · store/vocab.ts** |
| `computeHealth(e, staleAfterDays, slaDays, now?)` — **the extra third parameter is a delta from plan §2.12** | **W1-DOMAIN · lib/health.ts** |
| SLA badge, SLA-breach section, compliance % | W2 / W3 |

**SLA is OFF until an admin turns it on, per priority.** There is no `DEFAULT_SLA_DAYS`, and
`store/vocab.ts` carries a comment saying so. A seeded default would mark real in-flight work
"breached" the moment 0003 runs, on a workspace that never agreed to the number. `null` propagates
all the way to `sla_due_at: null` / `sla_breached: false`.

SLA is measured from `created_at`; staleness is measured from `last_activity_at`. They are different
questions and neither substitutes for the other: an item updated hourly for a month is never stale
and can still blow its SLA.

### 2.3 Notifications

```ts
// api/notifications.ts (W1-DATA) — reads only; triggers do the writing
listNotifications(opts?: { limit?: number; unreadOnly?: boolean }): Promise<ApiResult<AppNotification[]>>
markRead(ids: string[]): Promise<ApiResult<number>>
markAllRead(): Promise<ApiResult<number>>

// store/notifications.ts (W1-DATA)
useNotifications(): AppNotification[]
useUnreadCount(): number                 // STORED, not counted in the selector — it renders shell-wide
useNotificationsLoading(): boolean
loadNotifications(force?: boolean): Promise<void>
markNotificationsRead(ids: string[]): Promise<void>
markAllNotificationsRead(): Promise<void>
initNotificationsRealtime(): () => void  // idempotent; returns its own teardown
resetNotifications(): void               // sign-out
```

Two frozen consequences for other modules:

- **`MutTable` gains `'notifications'`** (plan §2.2's union). Marking read is a write and every
  write funnels through `outbox.submit()`; routing this one around the seam would make it the
  exception someone later copies.
- **`RealtimeTable` gains `'notifications'`** (plan §2.14's union). It rides the single
  `opstrack-live` channel. A bell that opened its own socket would double every reconnect storm.

The five exports beyond the three the approved scope named (`loadNotifications`, `resetNotifications`,
and the two mark-read wrappers) are a keystone judgement call: without a loader nothing can populate
the store, and without a reset the previous user's inbox survives sign-out.

**Notifications are written by triggers, not by the client**, and that is load-bearing rather than
stylistic: the client that made a change is one of several (another tab, a second device, the
recurrence RPC), and a notification that only exists when a particular screen happened to be open is
worse than no notification system at all.

### 2.4 Username auth

```ts
// store/auth.ts (W1-AUTH implements the two async bodies)
export const USERNAME_EMAIL_DOMAIN = '@opstrack.internal'
export function usernameToEmail(username: string): string        // PURE, shipped real by the keystone
export async function signInPassword(identifier: string, password: string): Promise<string | null>
export async function claimAccount(input: ClaimInput): Promise<string | null>

// api/members.ts (W1-DATA/W1-AUTH)
createUsernameMember(username, displayName, role): Promise<ApiResult<{ member: Member; inviteCode: string }>>
reissueInvite(id): Promise<ApiResult<{ inviteCode: string }>>
claimAccountRequest(input: ClaimInput): Promise<ApiResult<null>>   // UNAUTHENTICATED by necessity
// Member gains: username?: string | null · claimed?: boolean
```

- `signInPassword` / `claimAccount` return a **translated sentence or null**, matching `store/auth.ts`'s
  existing convention, *not* `ApiResult` with an i18n key. Sign-in errors render inline through
  `role="alert"` on a form that has no key resolver. This is the one place in the app where that
  convention differs, and it already did.
- `identifier` is a username **or** a real email; branch on `'@'`. Asking a user to classify their own
  credential is a worse form than reading the one character that distinguishes them.
- The wrong-credentials branch must **not** distinguish "no such username" from "wrong password".
  That difference is a username oracle, and usernames are handed out in person precisely so they are
  not public.
- **OTP is not removed.** Real-email accounts — the owner's — keep both paths. The existing admin
  cannot be locked out by this change, and W1-AUTH proves the claim flow on a throwaway username
  before any real member is migrated.
- `.internal` is RFC 6761 reserved and can never resolve. That is the point: the synthetic address
  must be unable to receive mail, so nothing quietly grows a dependency on emailing it. Password
  reset for a username account is an admin reissuing a one-time code — an honest path instead of a
  "check your inbox" screen for an inbox that does not exist.

### 2.5 Locale tree

`src/locales/{en,ar}.json` are **deleted**. The tree is `src/locales/{en,ar}/<namespace>.json`, one
file per top-level key, assembled by `src/locales/index.ts`. `lib/i18n.ts` changed by exactly two
import lines; **`t()`'s key space is unchanged** and no call site moved.

**The invariant:** a namespace file's basename *is* its single top-level key — `en/board.json`
contains `{ "board": { … } }` and nothing else. `index.ts` merges by flat spread, so a root claimed
by two files would silently lose one; `src/lib/localeParity.test.ts` asserts the rule because the
merge cannot.

Shipped: 17 namespaces × 2 languages, **333 keys at exact parity** (213 pre-existing + 120 new).

| Namespace | Delta |
|---|---|
| `date` (18), `filter` (26) | **new**, populated up front per plan §4.2 so `lib/dates.ts` and `FilterBar` can use them in Wave 1 |
| `notif` (9) | **new** — bell, inbox, and the two trigger sentences. Seeded by the keystone, **integrator-owned**, extended by the Wave-3 notification-centre worker. Not in plan §4.2's table. |
| `common` +23, `route` +5, `nav` +2, `offline` +10 | plan §4.2's enumerated additions (`route.entry` already existed; `route.meeting` is the singular live-meeting route) |
| `signin` +27 | username / password / invite-code / claim / Microsoft-button strings |

All of the above are in the **shared, integrator-only** set. A feature worker needing a key in any of
them puts the exact key plus EN and AR strings in its handoff note; it never opens the file.

The parity test lives at **`src/lib/localeParity.test.ts`**, not `src/locales/locales.test.ts` as
plan §4.4 has it. It enforces all six of §4.4's rules, and `scripts/i18n-check.mjs` is still not
written — one mechanism, so there is nothing to drift.

### 2.6 `src/lib/text.ts`

Ships **complete**, with two exports beyond plan §2.12:

```ts
export function foldKey(s: string): string                          // normalizeSearch + strip -_
export function isSubsequence(needle: string, haystack: string): boolean
```

These are the fuzzy-match scaffolding `matchTrack`'s three tiers need. The tiering itself stays in
`lib/capture/parse.ts` (W1-PARSE) — `text.ts` supplies primitives, not policy.

`src/lib/text.test.ts` ships with it (32 cases). One of them exists because writing the combining-marks
character class with glyphs instead of `\u` escapes produces a range that swallows U+0660–U+0669 —
**the Arabic-Indic digits** — and silently deletes every Arabic numeral in the app. Every *range* in
that file is written as escapes for that reason; single-character folds keep their glyphs.

---

## 3. Skeleton inventory and what is real

`throw new Error('TODO')` bodies, plan §1.0.5 convention. Each file's **owner replaces it wholesale**;
none of these bodies is a partial implementation to build on.

`lib/dates.ts` · `lib/health.ts` · `lib/permissions.ts` · `lib/entryFilter.ts` · `lib/entrySections.ts` ·
`api/config.ts` · `api/members.ts` · `api/realtime.ts` · `api/notifications.ts` · `store/entries.ts` ·
`store/outbox.ts` · `store/members.ts` · `store/entrySheet.ts` · `store/vocab.ts` · `store/notifications.ts`

**Real, not skeletons:** `lib/text.ts` (+ test) · `lib/vocabStyle.ts` · `locales/index.ts` (+ parity
test) · `types.ts` · `outbox.TEMP_PREFIX` / `isTempId` · `entryFilter.EMPTY_FILTER` ·
`health.CLOSED_STATUSES` · `permissions.ENTRIES_UPDATE_IS_OPEN` · `vocab.DEFAULT_STALE_DAYS` /
`FROZEN_KEYS` · `auth.usernameToEmail` / `USERNAME_EMAIL_DOMAIN`.

**Two deliberate non-skeletons.**

- **`api/entries.ts` is a PARTIAL skeleton.** `healthCheck()` and `materializeRecurring()` keep their
  real bodies — they are wired into the running, deployed app (the Settings backend pill and the
  once-per-sign-in recurrence net). Replacing working deployed code with a throwing stub for the
  length of a wave buys no compile-time safety and breaks the live build for anyone who pushes
  mid-wave. Both were switched to `pgErrorKey()` (correction 2 of plan §2.4) since they were being
  touched anyway; corrections 1 and 3 are W1-DATA's, on the bodies it writes.
- **`lib/capture/parse.ts`, `grammar.ts` and `lib/cache.ts` have no skeleton.** The plan's keystone
  step does not list them, W1-PARSE ships the parser complete with tests inside the same wave, and
  `grammar.ts` and `cache.ts` have no frozen signature in §2 to skeleton against — an invented one
  would be a contract nobody agreed to.

---

## 4. Open items, by owner

**W1-DB.** ① `sla_days` column, CHECKs, NULL seed, `reset_vocab` coverage, and the two new
`v_entry_health` columns — see §2.2. ② The `notifications` table, its two triggers, its RLS
(`select`/`update` restricted to `recipient_id = auth.uid()`; no client INSERT policy at all), and its
addition to `supabase_realtime` in the same guarded `do $$ … exception when others then raise notice`
block 0001 uses. ③ **`ENTRIES_UPDATE_IS_OPEN` in `lib/permissions.ts` is currently `true`, the plan's
stated default (widen `entries_update` to `is_member()`).** If the owner declines the widening and you
delete the marked block from 0004, flip that constant to `false` in the same commit. It is one line
and it is the only line.

**W1-DOMAIN.** ① Tighten `TrackInput.suggestedTags` to required — §2.1. ② `computeHealth` takes the
third `slaDays` parameter — §2.2. ③ `pgErrorKey()` additions from plan §2.6 (`PGRST116` →
`entry.errNotYours`; `23514` + `last_visible_option` → `vocabadmin.errLastVisible`; `23502` →
`common.error` with a `console.warn`). Note `pgErrorKey()` is already live on `healthCheck()` and
`materializeRecurring()`, so an unmapped code there now returns `common.error` rather than Postgres
English — intended.

**W1-DATA.** `MutTable` and `RealtimeTable` already carry `'notifications'`; keep them. `store/entries.ts`
must not gain a `notifications` concern — the two stores are independent.

**W1-AUTH.** §2.4 in full. The claim endpoint is unauthenticated; the invite code is single-use even
if the first attempt crashed after setting the password.

**W1-PARSE.** `lib/text.ts` is complete and tested — build `matchTrack` on `foldKey` + `stemArabic` +
`isSubsequence`, and do not re-implement folding in `parse.ts`. `lib/dates.ts` is a skeleton whose
signatures are frozen; the `Intl.DateTimeFormat` monopoly (one private `fmt()`, hard-coded
`ar-u-ca-gregory-nu-latn`) is stated in its header and is an audit item.

**Integrator / W1-I18N.** ① `.github/workflows/deploy.yml` still does not run `npm run test` — plan §1
assigns that to W1-I18N in Wave 1, and the keystone's file list stopped at `package.json`. Until it is
added, the locale parity gate is a local check only, which is precisely the kind of gate that quietly
stops running. ② Owns `locales/index.ts` and every shared namespace from here on: `app nav route common
date filter offline pwa signin placeholder status priority type health settings admin notif`. Adding a
namespace is two imports and two spread entries in `index.ts`, plus the `EN_NAMESPACES`/`AR_NAMESPACES`
maps the parity test iterates.

---

## 5. Gate status at keystone close

`npx tsc -b` · `npm run lint` · `npm run test` — all green. `npm run build` succeeds.
Standing greps clean: no new physical layout properties, no `src/lib/**` import of `store/`/`api/`,
no `any`, no `@ts-expect-error`. 73 tests across 2 files (32 folding cases + 41 locale assertions). `git diff package.json` shows exactly one
added dependency — `vitest`, in devDependencies — plus the `test` and `seed` scripts.
