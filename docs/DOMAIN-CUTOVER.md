# The domain cut-over — `nphiescore.com`

**Written 19 August 2026, the day the domain was bought.** This is the whole
procedure for moving the app off `https://abosallom.github.io/opstrack/` and onto
`https://nphiescore.com/`. Three things have to land; two of them are yours.

It also **cancels** the queued `/nphiescore/` base-path move. That move existed
only to get the old product's name out of the URL, and it was expensive — it
needed a repo rename, a Supabase redirect step and a storage migration, all at
once. A custom domain decouples the public URL from the repo name entirely, so
the repo stays `opstrack`, every frozen `opstrack_*` identifier stays frozen, and
the rename sitting never happens. See §6.

---

## 0. Why this is not cosmetic

`src/api/supabase.ts` carries a measured defect at the top of the file, and this
is its fix. supabase-js keeps the **refresh** token in `localStorage`, and
`localStorage` is scoped to the ORIGIN, never to the path. Measured 2026-07-31:
`/opstrack/`, `/raed-tracker/`, `/misbar-report/` and `/portfolio-sim/` all
answer 200 on `https://abosallom.github.io`. Three unrelated hobby apps therefore
run in the same store as the department's tracker, and one of them loads
`chart.js` from a CDN with no `integrity` attribute. GitHub Pages sends no CSP.
An XSS in any sibling reads the key and replays the token — and if the holder is
the owner, it also authorizes `supabase/functions/admin-members`, which gates on
the caller's JWT alone.

Giving the app its own origin is the fix that file names. Nothing else in the
list of mitigations removes the sharing; they only shrink the blast radius.

**So the cut-over is worth doing before the 16 people are provisioned**, not
after — see §4.

---

## 1. What has to land, in order

| # | Step | Whose hands | Blocks |
|---|---|---|---|
| 1 | The DNS records at the registrar | **Yours** | everything |
| 2 | `main` deployed with `public/CNAME` in the artifact | mine, on your word | HTTPS, the app being live |
| 3 | Supabase Site URL + redirect allow-list | **Yours** (or mine with a token) | every emailed sign-in link |

**The order is not a preference.** Setting the custom domain before DNS resolves
takes the app OFFLINE: GitHub starts 301-ing `abosallom.github.io/opstrack/` to
`nphiescore.com`, and if `nphiescore.com` does not yet answer, there is no
working URL left for you or Nasser. DNS first, always.

Step 3 after step 2 is the safe order but not a hard gate — the allow-list can
hold both origins at once, and should during the transition.

---

## 2. Step 1 — DNS at the registrar (yours, ~5 min + propagation)

The apex is the canonical host. `www` redirects to it.

| Type | Name | Value | TTL |
|---|---|---|---|
| A | `@` | `185.199.108.153` | 3600 |
| A | `@` | `185.199.109.153` | 3600 |
| A | `@` | `185.199.110.153` | 3600 |
| A | `@` | `185.199.111.153` | 3600 |
| AAAA | `@` | `2606:50c0:8000::153` | 3600 |
| AAAA | `@` | `2606:50c0:8001::153` | 3600 |
| AAAA | `@` | `2606:50c0:8002::153` | 3600 |
| AAAA | `@` | `2606:50c0:8003::153` | 3600 |
| CNAME | `www` | `abosallom.github.io.` | 3600 |

All four A records and all four AAAA records — GitHub load-balances across them,
and a partial set works until the day it doesn't. The `www` value is the **Pages
host**, not the domain; the trailing dot matters at some registrars and is
harmless at the rest.

If your registrar offers "ALIAS" or "ANAME" at the apex, the A/AAAA records above
are still the documented path and are what GitHub verifies against. Use them.

**Check it before touching anything on GitHub:**

```bash
dig +short nphiescore.com A
dig +short nphiescore.com AAAA
dig +short www.nphiescore.com CNAME
```

Four addresses, four addresses, and `abosallom.github.io.`. Until that is what
comes back, stop here — step 2 is the one that can take the app down.

---

## 3. Step 2 — Deploy (mine, on your word)

`public/CNAME` is already committed. Two things about it are worth knowing,
because both have a silent failure mode:

- **The custom domain lives in the artifact, not in the repo setting.** Pages
  here is `build_type: workflow`. GitHub reads `CNAME` out of each deployed tree,
  so a build that drops the file un-sets the domain and quietly moves the app
  back onto the shared origin. `.github/workflows/deploy.yml` now fails the build
  if `dist/CNAME` is missing or reads anything else.
- **No Vite change was needed.** A Pages *project* site with a custom domain
  serves at the APEX — `/`, not `/opstrack/`. `vite.config.ts` already sets
  `base: './'`, and `src/lib/appBase.ts` derives the app root from the document
  URL at runtime rather than from `BASE_URL`. `src/lib/appBase.test.ts` asserts
  both sides of the cut-over.

The deploy itself:

```bash
# from feat/map-hierarchy, once the tour in OWNER-PLAYBOOK §6 has passed
git checkout main && git merge --no-ff feat/map-hierarchy && git push origin main
gh run watch                      # the Actions run that builds and deploys
```

Then, once GitHub reports the domain:

```bash
gh api repos/Abosallom/opstrack/pages | python3 -m json.tool | grep -E 'cname|https'
```

`"cname": "nphiescore.com"` and `"https_enforced": true`. The certificate is
issued by GitHub via Let's Encrypt and can take up to 24 hours; **"Certificate
provisioning" is a normal state, not a failure.** Enforce HTTPS only after it
clears — turning it on early makes the site unreachable rather than insecure.

**Verification, the same shape the release smoke uses:**

```bash
curl -sI https://nphiescore.com/ | head -1                  # 200
curl -s  https://nphiescore.com/manifest.webmanifest | head -c 80   # JSON, not the SPA page
curl -s  https://nphiescore.com/ | grep -o 'src="[^"]*"'    # relative ./assets/…
curl -sI https://www.nphiescore.com/ | head -1              # 301 to the apex
curl -sI https://abosallom.github.io/opstrack/ | head -1    # 301 to nphiescore.com
```

A manifest that returns the SPA page means the base path is wrong — stop there.

---

## 4. Step 3 — Supabase Auth (yours, ~3 min)

**This is the step whose omission is invisible until someone tries to sign in.**
The app does not pass a redirect, so Supabase falls back to the project's Site
URL for every magic link, every recovery mail and the `/reset` landing.

Dashboard → **Authentication → URL Configuration** on project
`lrysgpbkmuqgzsjesfkr`:

| Field | Value |
|---|---|
| Site URL | `https://nphiescore.com` |
| Redirect URLs | `https://nphiescore.com/**` — **add**, keep the existing `https://abosallom.github.io/opstrack/**` and `http://localhost:5173/**` |

Keep the old entry through the transition. Remove it once you have signed in on
the new origin and confirmed nothing is bookmarked to the old one — it costs
nothing to leave for a week, and removing it early strands anyone mid-flow.

### What the origin change does to people

An origin change is a clean break, by design, and this is why §0 says do it
before Step 4 of the playbook:

- **`localStorage` does not follow.** Everyone is signed out once. Passwords and
  accounts are untouched — the session store is what moves, not the identity.
- **The service worker and the PWA install do not follow.** An installed
  home-screen app still points at the old origin. It has to be removed and
  re-installed from `nphiescore.com`.
- **Push subscriptions do not follow.** They are registered against the old
  scope. Every device that wants notifications goes to Settings → Push
  notifications, off and on again, on the new origin. Nothing can do this for
  them — the same rule as a VAPID rotation (RUNBOOK §4).

`profiles` currently holds **two rows**: you and Nasser. That is the entire cost
of moving today. Provision the 16 first and it is eighteen re-installs, eighteen
re-signs-in, and sixteen invite codes handed out against a URL you are about to
abandon.

---

## 5. Domain verification, once (yours, 2 min)

GitHub Settings → **Pages** → *Add a domain* → `nphiescore.com`, add the `TXT`
record it prints under `_github-pages-challenge-abosallom`, then Verify.

This is not the same thing as the site working — the site works without it. It
stops someone else claiming `nphiescore.com` on their own GitHub account if a DNS
record ever dangles. Two minutes now against a hostile takeover of the department
tracker's hostname later.

---

## 6. What deliberately does NOT change

A new domain is exactly the moment a well-meaning sweep does damage.
`src/lib/brand.test.ts` is the gate that catches it, and it is not decoration:

- **`@opstrack.internal`** — PERMANENT. Those are real rows in `auth.users`.
  Renaming the domain locks every member out of their own account, silently.
- **`opstrack_*` localStorage keys**, the **`opstrack-live`** realtime channel,
  the **`opstrack`** notification tag — matched on by parsers, read by nobody.
- **`format: 'opstrack-export'`** and **`LABEL_FILE_FORMAT =
  'coretrack-terminology'`** — `readLabels()` refuses on a mismatch, so renaming
  a tag makes every file exported before that build unreadable, with no migration
  to undo it.
- **The repo name `opstrack`** and the applied migrations. The domain is what
  makes renaming the repo unnecessary; do not do it anyway.
- **`HashRouter`.** URLs read `nphiescore.com/#/mindtree`. Removing the `#` means
  `BrowserRouter` plus a 404 shim, and the Supabase auth flow currently arrives
  in the hash fragment. Cosmetic, and not worth the risk in the same change.

---

## 7. Rollback

Cheap, at every stage. Delete `public/CNAME`, deploy, and Pages reverts to
`https://abosallom.github.io/opstrack/` on the next run — the DNS records can
stay, pointing at nothing, until you try again. The only thing that does not roll
back for free is people: anyone who signed in on the new origin is signed out
again by the return trip, for the same reason as §4.

---

## 8. The state of this cut-over

| Step | State |
|---|---|
| `public/CNAME`, the deploy guard, the resolver test | ✅ committed, 19 Aug 2026 |
| DNS at the registrar | ⬜ yours |
| `main` merged and deployed | ⬜ waits on OWNER-PLAYBOOK §1 and the tour |
| Supabase Site URL + allow-list | ⬜ yours |
| Domain verified on GitHub | ⬜ yours |
| Enforce HTTPS | ⬜ after the certificate issues |
