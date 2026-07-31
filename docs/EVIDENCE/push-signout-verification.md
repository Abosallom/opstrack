# `PUSH-SIGNOUT` — live verification of the sign-out cleanup

Run **2026-07-31**, against <https://abosallom.github.io/opstrack/> and the live
Supabase project `lrysgpbkmuqgzsjesfkr`, after `c373b5f` deployed.

This document exists because the defect it closes was found by a live run and
could only be closed by one. `PUSH-SIGNOUT` is the finding that a signed-out
user's push endpoint and both of their subscription keys stayed in
`public.push_subscriptions` — measured on 2026-07-30, when the count after
sign-out was still `1`. A unit test cannot establish that the fix works, because
the thing that made the bug invisible is a property of the *database*, not of the
client: `push_subscriptions` is owner-only RLS, so a delete issued without a
session matches no rows and **returns no error**. Success and total failure are
the same response. Only a count taken on the live table can tell them apart.

**Result: the count drops. 0 → 1 → 0.**

**Read §4 before citing this.** Two different people measured two different
halves of it, and the doc is only worth what that split is worth.

---

## 0. What was under test

| | |
| --- | --- |
| Commit | `c373b5f` — `fix(push): give the push registration back before signing out, not after`, rebase-merged from [PR #1](https://github.com/Abosallom/opstrack/pull/1) (pre-merge `f18d791`) |
| Deploy | GitHub Actions run `30624443294`, `success` in 58 s, started 2026-07-31T10:42:00Z |
| Live `index.html` | HTTP 200, 2321 B, fetched with a cache-busting query |
| Live entry chunk **at measurement time** | `assets/index-CFKe9gO6.js` |
| Chunk carrying the fix | `assets/auth-B1-ANWsb.js`, 415 283 B, `sha256 1fa9cb93…c326e8b` |

The fix rides in the `auth` chunk rather than the entry chunk because
`store/auth.ts` now imports `store/push.ts` — see the backlog row. Both are
eager, so nothing about delivery changed.

**A later deploy has since replaced the entry chunk, and the fix's chunk
survived it byte-identical.** `0f44822` (`feat(type): Cairo as the app's single
typeface`) deployed at 11:38 and moved the entry chunk to
`assets/index-DYowL9k5.js`; `auth-B1-ANWsb.js` re-fetched afterwards is the same
415 283 B and the same `sha256`. Vite hashes a filename from its content, so an
unchanged name across an unrelated deploy is itself a check: the code §1 quotes
is still the code being served. Anyone re-reading this can still fetch it — see
§4 for how long that stays true.

---

## 1. The deployed bundle carries the fix, and carries it in the right order

Presence is not the interesting claim — a `delete` statement can ship and still
never run. What had to be established is the **sequencing**, because that is
where the original defect lived. So the shipped chunk was fetched and read back.

Verbatim from `assets/auth-B1-ANWsb.js`, minified names preserved:

```js
async function Vu(){ Y && (await Su(), await Y.auth.signOut(), Eu.setState({session:null,profile:null,loading:!1})) }

function xu(e,t){ return new Promise(n=>{ let r=setTimeout(n,t); e.finally(()=>{ clearTimeout(r), n() }) }) }

function Su(e = $.getState().endpoint){
  return xu(Cu(e).catch(e=>{ console.warn(`[push] releasing this device failed:`, e.message) }), bu)
}

async function Cu(e){
  let t = e ?? await wu();
  let n = null;
  try { n = await Zl() } catch(e){ console.warn(`[push] unsubscribing this device failed:`, e.message) }
  $.setState({endpoint:null});
  let r = n ?? t;
  if(!r || !Y) return;
  let {error:i} = await Y.from(`push_subscriptions`).delete().eq(`endpoint`, r);
  …
}
```

Read against the source, `Vu` is `signOut`, `Su` is `releasePushForSignOut`, `Cu`
is `releaseRegistration`, `xu` is `withBudget`, `wu` is `peekEndpoint` and `Zl`
is `unsubscribeThisDevice`. Four properties are legible in the shipped code:

| Property | Where it is visible |
| --- | --- |
| The release precedes the sign-out | `await Su()` sits before `await Y.auth.signOut()` in `Vu` — this is the whole fix |
| The endpoint is resolved **before** the unsubscribe | `let t = e ?? await wu()` is the first statement of `Cu` |
| A throwing unsubscribe does not take the delete with it | the `try/catch` around `await Zl()` is followed by the delete unconditionally |
| The wait is bounded | `bu = 4e3` — 4000 ms, passed to `xu` |

Also present, all three: `[push] releasing this device failed:`,
`[push] unsubscribing this device failed:`,
`[push] removing the subscription row failed:`. Those are the strings §3 asks a
failing run to paste, so they had to be confirmed to exist in the build a person
would actually be running when they failed.

**What §1 does not establish.** That the delete is *accepted*. Reading the
bundle proves the request is issued, in the right order, with a live token. It
cannot prove the database applied it — that is §2, and it is why §2 exists.

---

## 2. The live table, measured through the product

Run by the owner on a laptop against the deployed origin, following RUNBOOK §9.4
step 9. The product's own UI throughout — the enable button and the sign-out
button, not a console call.

| Point in the run | `select count(*) from public.push_subscriptions` |
| --- | --- |
| After **Turn on for this device**, with the card showing "On for this device" and one row in **Registered devices** | **1** |
| After **Sign out** from the Settings screen | **0** |

**The floor was 0, and that is derived rather than assumed.** `push_subscriptions`
has a unique index on `endpoint` and 0011's `upsert_push_subscription()` is keyed
on it, so subscribing one device adds exactly one row. A count of `1` after
subscribing therefore establishes that the table held `0` before it, whatever the
baseline step did or did not have to clear.

That derivation is the reason the `1` matters as much as the `0`. A run that
went 0 → 0 → 0 would satisfy the final count and prove nothing at all: "no row
afterwards" is only evidence of a deletion if there was a row to delete. The
pair is the measurement; neither number alone is.

Corroborating, though weaker: the UI showed the green "On for this device" pill
and a **Registered devices** list with one row. `applyRows()` sets that state
only when both halves agree — the browser holds a subscription **and** this
account has stored it — so the pill is a second, independent signal that the row
existed before sign-out.

---

## 3. What this run does **not** establish

Four things, none of them failures, all of them left open on purpose.

**The offline path is not fixed and was not tested.** A sign-out with no network
still leaves the row, because nothing can reach PostgREST — the delete is bounded
at 4 s and then abandoned. This is the *original* sharp case reduced, not
removed: the browser subscription is still dropped locally, so that device stops
receiving, but the row survives until a `410` prunes it. RUNBOOK §9.4 step 9
keeps the standing advice — sign a shared machine out **online** — and the manual
remedy.

**iOS was not exercised.** Web Push on iOS requires the app installed to the Home
Screen, and the sign-out path there is the same code but a different
`ServiceWorkerRegistration`. Untested is not the same as broken; it is untested.

**Multi-device was not exercised.** One device, one row. The delete is keyed on
`endpoint`, so a second registered device should be untouched by the first one's
sign-out — that follows from the `eq('endpoint', …)` above, but it was not
measured.

**The two counts are owner-reported, not tool-captured.** See §4.

---

## 4. Provenance — who measured what

This matters more than usual here, because the two halves were established by
different parties and only one of them left an artifact.

**§1 was measured directly.** The deployed `index.html` and
`assets/auth-B1-ANWsb.js` were fetched from the live origin and read; the code
block is an extract from that download, not a re-print of the source tree. It
stays re-checkable for as long as that filename is what the build produces —
already true across one unrelated deploy, as §0 records. A Pages deploy keeps
only the current build's assets, so the chunk will 404 the moment something
changes the code inside it; after that, re-derive it from `c373b5f`.

**§2 was run and reported by the owner**, who alone holds a session on the
project and a browser that can grant the notification permission. The numbers
are `1` and `0` as reported; no screenshot, query log or row id was captured.
That is a genuine limit on this document: it records a measurement, not an
artifact of one. It is recorded as such rather than dressed up, and the run is
cheap to repeat — RUNBOOK §9.4 step 9 is the procedure, and anyone with the SQL
Editor open can falsify it in five minutes.

---

## 5. Disposition

`PUSH-SIGNOUT` moves from **open** to closed, verified live. The backlog row and
RUNBOOK §9.4 step 9 both point here.
