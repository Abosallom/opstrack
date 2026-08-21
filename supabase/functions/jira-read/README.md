# `jira-read` — the read-only Jira window

This is the only thing in NphiesCore that ever holds a Jira credential, and it
can only **read**. It never writes to Jira, and it never writes to this
database either.

You set three secrets, press **Test connection**, and the app starts showing you
what your Jira actually contains. Nothing in NphiesCore changes until you say so
in a later step, and nothing in Jira changes at all.

---

## 1. What it can and cannot do

| | |
|---|---|
| **Reads from Jira** | your account, your projects, your fields, and the issues a JQL matches |
| **Writes to Jira** | never — no issue is created, edited, transitioned, commented on, or deleted |
| **Writes to NphiesCore** | never — no `map_nodes`, no `map_node_use_cases`, no `entries` row is touched |
| **Who may call it** | a signed-in member holding `structure.edit`, or an admin |

This is not a promise in a comment. `index.ts` reaches Jira through a frozen
four-entry allow-list, the HTTP verb is read out of that list rather than passed
in, and the whole file contains exactly one `fetch`. `index.test.ts` checks all
three against the source text on every CI run, so a change that made writing
possible would turn the build red.

### The four operations

| Operation | Jira endpoint | What it is for |
|---|---|---|
| `ping` | `GET /rest/api/3/myself` | **Press this first.** Tells "wrong token" apart from "wrong URL" apart from "no network". |
| `projects` | `GET /rest/api/3/project/search` | See your project keys without leaving the app to look them up. |
| `fields` | `GET /rest/api/3/field` | Lists every field with its id (`customfield_10042`) beside its name ("Organization"). **This is the one that matters** — see §6. |
| `search` | `POST /rest/api/3/search/jql` | Run a JQL and see the issues that come back. |

> `search` is a POST. That is Jira's shape, not a write: Atlassian removed
> `GET /rest/api/3/search` (it now answers `410 Gone`) and replaced it with a
> POST that carries the JQL in a JSON body. It creates nothing. Please don't
> "fix" it back to a GET.

---

## 2. Mint an Atlassian API token

Do this in your own browser, signed in as the Atlassian account you want
NphiesCore to read Jira **as**.

1. Go to **https://id.atlassian.com/manage-profile/security/api-tokens**
2. **Create API token**
3. Label it something you will recognise in a year: `nphiescore-read`
4. If offered an expiry, pick one. A token you have to re-mint is a token you
   still know about.
5. **Copy it now.** Atlassian shows it exactly once.

### What that token actually is — read this once

An Atlassian API token is **not scoped to a project and not scoped to
read-only.** It carries everything the account can do, everywhere. Two
consequences:

- **Keep the account boring.** The permission this integration needs is
  *Browse Projects* on the projects you care about. If you can point it at a
  low-privilege Atlassian account rather than your own admin account, do.
  Whatever the account can see, this token can see; whatever the account could
  change, a *different* piece of software holding this token could change.
- **The token never goes anywhere except the Supabase secret store.** Not in
  the repo, not in a `.env` that gets committed, not in chat, not in a
  screenshot, not to anyone on the build. Nobody but you needs it and nobody
  will ask.

The read-only guarantee in this project is enforced by `index.ts` refusing to
make any request other than the four above. It is not a property of the token.

---

## 3. Set the three secrets

In the **Supabase dashboard** → your project → **Edge Functions** → **Secrets**
(they are project-wide, shared by every function):

| Secret | Value | Example |
|---|---|---|
| `JIRA_BASE_URL` | your site address, **nothing after it** | `https://your-site.atlassian.net` |
| `JIRA_EMAIL` | the Atlassian **account email** | `you@example.com` |
| `JIRA_API_TOKEN` | the token from §2 | `ATATT…` |

Or from a terminal:

```sh
npx supabase@latest secrets set \
  JIRA_BASE_URL=https://your-site.atlassian.net \
  JIRA_EMAIL=you@example.com \
  JIRA_API_TOKEN='paste-the-token-here' \
  --project-ref lrysgpbkmuqgzsjesfkr
```

Single quotes around the token: it can contain characters your shell would
otherwise eat.

**Three things that look right and are not:**

- `JIRA_BASE_URL` copied out of the address bar while looking at a board —
  `https://your-site.atlassian.net/jira/software/projects/OPS/boards/12`. It
  must be **just the site**. The function refuses this and tells you the exact
  value to use instead.
- `http://` instead of `https://`. Refused — that is your token crossing the
  internet in the clear.
- `JIRA_EMAIL` set to a *username* rather than an email address. Jira Cloud
  Basic auth is email + API token; a username produces a `401` that reads like
  a bad token and sends you off to mint a second one that fails identically.
  The function checks the shape and says so instead.
- `JIRA_EMAIL` carrying an **invisible passenger** — a non-breaking space, a
  smart quote, a Cyrillic `а` that looks exactly like a Latin one. An Atlassian
  account email is plain ASCII, so the function refuses anything else and tells
  you *the position of the first offending character* — "at position 7" — which
  is the one sentence that ends that search. It does not print the character,
  and it does not print your address.

**A refusal never repeats your value back to you.** Every message above names
the *shape* the value should have (`Expected https://your-site.atlassian.net`),
never the shape it had. That is deliberate: the most likely single mistake with
these three boxes is pasting the **token** into the wrong one, and an error
message that helpfully quoted what it rejected would hand your whole Atlassian
account to everyone who can call this function. The one exception is a site
address that has already passed every check but has a path on it — then it
quotes back `https://your-site.atlassian.net`, because that quote *is* the fix.

**A secret you have not set is never a 500.** It comes back naming the exact
variable — *"JIRA_API_TOKEN is not set on this project"* — and if all three are
missing it names all three at once, so you make one trip to the dashboard
rather than three.

**That answer is only given to someone signed in and holding `structure.edit`.**
The function authenticates the caller and checks the permission *before* it so
much as reads the environment, so a stranger who has the public anon key (it
ships in the browser bundle) is told "not signed in" and learns nothing about
which Jira variables exist on this project or what they contain.

---

## 4. Deploy

```sh
npx supabase@latest functions deploy jira-read --project-ref lrysgpbkmuqgzsjesfkr --use-api
```

`--use-api` bundles server-side, so **Docker is not required** — same as the
other functions in this project (see `docs/RUNBOOK.md` §"Edge functions").

Check it landed:

```sh
npx supabase@latest functions list --project-ref lrysgpbkmuqgzsjesfkr
```

Secrets are read at request time, not at deploy time, so **changing a secret
does not require redeploying.** Set it and press *Test connection* again.

---

## 5. Test it

The intended path is the app: **Settings → Jira**, then **Test connection**.

From a terminal, with a signed-in user's access token:

```sh
curl -s -X POST \
  'https://lrysgpbkmuqgzsjesfkr.supabase.co/functions/v1/jira-read' \
  -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"op":"ping"}'
```

A good `ping` gives you back the site it reached and the account it
authenticated as — check that the `displayName` is the account you meant.

```jsonc
{
  "ok": true,
  "op": "ping",
  "site": { "baseUrl": "https://your-site.atlassian.net", "atlassianCloud": true },
  "account": { "accountId": "5b…", "displayName": "Aziz", "active": true }
}
```

Then the one that matters:

```sh
-d '{"op":"fields","customOnly":true}'
-d '{"op":"projects"}'
-d '{"op":"search","jql":"project = OPS ORDER BY updated DESC","maxResults":25}'
```

---

## 6. The field ids are the point

NphiesCore's shape is **one Jira issue per Organization × use case** — your
words, and migration `0024` records it as the design. To match a Jira issue to
the right row, we need to know **which field in your Jira carries "which
Organization"** and **which carries "which use case"**.

Nobody on the build can know that. It is a fact about your instance. Custom
fields are called `customfield_10042` on the wire and "Organization" on the
screen, and the number is different in every Jira site in the world.

So: run `fields` (custom-first, so yours are at the top), find the two that
carry Organization and use case, and note their **ids**. That single answer is
what turns the mapping from guesswork into configuration.

While you are there, `search` returns each issue's `fields` block **completely
uninterpreted** — deliberately. If we normalised it, we would hide the very
field we are hunting for.

---

## 7. When something goes wrong

Every failure comes back as a sentence plus a stable `code`. The four you are
most likely to meet:

| What you see | What it means | Fix |
|---|---|---|
| `jira_unauthorized` — *"Jira rejected the credential"* | The email/token pair is wrong, or the token was revoked | Re-check `JIRA_EMAIL` is an **email**; re-mint the token (§2) |
| `jira_forbidden` — *"that account cannot see this"* | Credential is fine, permissions are not | Give the account **Browse Projects** on that project |
| `jira_not_found` — *"no such site or endpoint"* | `JIRA_BASE_URL` is wrong | Must be exactly `https://your-site.atlassian.net`, nothing after |
| `jira_rate_limited` | Jira is throttling this account | Wait — the response tells you how many seconds |

> **Why an error about Jira does not sign you out.** If Jira answers `401`, this
> function returns `502` to the browser with `jiraStatus: 401` inside. Passing
> the `401` straight through would make the app think *your NphiesCore session*
> expired and bounce you to the sign-in screen over a bad Jira token — a
> genuinely confusing half hour. Our status describes our outcome; `jiraStatus`
> carries Jira's.

**The token is never printed.** Not in a log line, not in an error body, not in
a response. Server logs carry the operation name and an HTTP status, nothing
more.

**And the rule that keeps that promise honest: no error ever quotes the value it
rejected.** It names the shape the value should have had instead — see the end
of §3. This was a real hole, found by review rather than in the field: the
"that is not a URL" refusal used to print the value it had been given, so the
single most plausible slip (the `ATATT…` token pasted into the `JIRA_BASE_URL`
box) put your whole Atlassian account into a response body readable by everyone
holding `structure.edit`. Scrubbing could not have caught it — in that scenario
the token is not the value of `JIRA_API_TOKEN`, so there is nothing to match
against. Not printing it is the only fix that works, and the test suite now pins
it against the source text so it cannot come back as a helpful tweak.

---

## 8. Limits, and why the count can be short

Every read is bounded, so one exploratory JQL against a real backlog cannot
return a hundred megabytes into a function with a memory limit.

| Limit | Value |
|---|---|
| Issues per page | 100 (Jira clamps to about this anyway) |
| Pages followed per call | 5 |
| Issues per call | 200 |
| Projects per call | 50 |
| Fields returned | 600 |
| JQL length | 2000 characters |
| Time per call | 20 seconds |

When a result is cut short, the response says `"truncated": true` and hands back
`nextPageToken` so the screen can ask for more — rather than quietly showing you
part of your backlog as though it were all of it. Narrow the JQL and you will
usually be inside the limits.

**The cursor is a resume point, and nothing between it and the last issue you
were given has been read.** That sentence is the whole contract, and it was not
true until this wave: the loop used to ask Jira for a full page, keep only the
part that fitted under the 200-issue ceiling, and then hand back a cursor
pointing *past* the page it had only half-read. The issues in the gap came back
from no call, ever — `truncated: true` said "there is more" while the cursor
said "start after the part you skipped". It did not need anything exotic to fire:
`maxResults: 70` against a 200 ceiling misaligns every time. The fix is to spend
the budget *before* asking — each page is requested at exactly the size that can
be kept — so the cursor Jira returns always points one issue past the last one
you were handed. A fixture suite now drives that loop through short pages,
misaligned pages, an exhausted page budget and a server that overshoots.

**The 600-field cap falls on system fields, never on your custom ones.** `fields`
sorts custom-first *before* it caps, which matters only on a very large site —
but on such a site the old order (cap, then sort) could drop every custom field
while the response still looked complete, on the one operation whose whole
purpose is §6.

Jira's newer search endpoint has **no total count** and no `startAt` — paging is
by an opaque `nextPageToken`. So there is no "1–25 of 431" to show you; that
number no longer exists in the API.

---

## 9. Revoking a token

If a token is ever pasted somewhere it should not be — a chat, a screenshot, a
commit — revoke it. It takes a minute and there is no downside.

1. **https://id.atlassian.com/manage-profile/security/api-tokens**
2. **Revoke** next to the token
3. Mint a new one (§2) and update `JIRA_API_TOKEN` (§3)

No redeploy needed. Revocation is immediate: the old token starts failing as
`jira_unauthorized` at once.

To turn the integration off entirely, unset the secrets — the function then
answers `missing_secret` and reads nothing:

```sh
npx supabase@latest secrets unset JIRA_BASE_URL JIRA_EMAIL JIRA_API_TOKEN \
  --project-ref lrysgpbkmuqgzsjesfkr
```

---

## 10. What comes next, and what has to be true first

The end state is a **two-way sync**, and you gated it yourself: *"i can not
connect the app to jira until we verify the tracker very well."* That gate is
still closed and this function does not open it.

The schema is already waiting. Migrations `0023` and `0024` provisioned the sync
columns on both `map_nodes` and `map_node_use_cases` up front, unused:

- `source` — `'local'` or `'jira'`, so a row's origin is never a guess
- `external_ref` — the issue key
- `external_url` — a link back
- `synced_at` — subtracted from the audit diff, so a nightly run that changes
  nothing writes no history noise
- `overrides` — **the per-field editing contract**: a field named here was
  edited in NphiesCore and a sync must not overwrite it

So when the sync is switched on it is a feature, not a migration of live rows.
Until then this window stays read-only, and the honest limit of what has been
proven is in the next section.

---

## 11. What has not been verified

Stated plainly rather than left to be discovered.

**Nobody on the build has ever run this against a live Jira.** By design — the
credential is yours and was never shared. The Atlassian REST contract used here
(`POST /rest/api/3/search/jql`, `nextPageToken` paging, the removal of
`GET /rest/api/3/search`) was checked against Atlassian's current documentation
rather than written from memory, because the old shape fails *only* against a
real site. But documentation is not a live 200.

Specifically unproven until you press the button:

- that the Basic header is accepted by your site
- that the multi-page `search` loop pages correctly **against a real backlog** —
  its arithmetic and cursor bookkeeping are now proven against a *model* of Jira
  (short pages, misaligned pages, an exhausted budget, an overshooting server),
  which is a different and lesser claim than a live 200
- that your Jira's `Retry-After` behaves as assumed under throttling
- the exact shape of your custom fields

**`ping` is the first real test this code has ever had.** If it comes back with
your name on it, the credential path works end to end.
