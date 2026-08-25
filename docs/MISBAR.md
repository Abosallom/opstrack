# MISBAR — the weekly lab report generator, coming into NphiesCore

Decided with the owner on 26 August 2026. **Separate work from UHR onboarding**, sharing the same
people, the same login and the same workspace — and nothing else.

## 1 · What it is today, measured from the live app

`https://abosallom.github.io/misbar-report/` — *مولد تقرير مسبار الأسبوعي*, the Misbar weekly
report generator. Arabic, RTL, PWA, Cairo font, dark and light. Last versioned `v2026-08-25.1`,
which is **yesterday** — this is a tool in active weekly use, not an experiment.

Read from its own source:

| | |
|---|---|
| **Ingest** | Grafana · XLSX · CSV (PapaParse) |
| **Computes** | scorecards · turnaround times (`tat-lookup`) · a late-labs section |
| **Produces** | reports · lab files · **email drafts** — its own text says *"no email is sent"* |
| **Shape** | three steps: رفع (upload) → توليد (generate) → مراجعة (review), plus a full automation pipeline |
| **Access** | its own gate and lock, per device |
| **Dependencies** | PapaParse only, **self-hosted**, and **no external host is referenced anywhere** |

⚠ **It is not the CDN-loading sibling.** `docs/DOMAIN-CUTOVER.md` §0 records that one of the apps
sharing `abosallom.github.io` *"loads chart.js from a CDN with no integrity attribute"*, which is
a live finding about token theft across a shared origin. It is **not this one** — Misbar
references no external host at all. The finding stands against `raed-tracker` or `portfolio-sim`.

⚠ **And bringing Misbar here shrinks that problem rather than moving it.** One fewer app on the
shared origin is one fewer place an XSS can read the tracker's refresh token.

## 2 · The decisions

**It becomes its own TRACK**, like Ayenati and Raqeeb — not a bespoke section and not a fourth
destination. It uses the workspace's existing machinery rather than arriving with its own. The
schema already makes this a first-class thing: `map_nodes.track_id` is derived from the parent by
a trigger, so two filing axes are unrepresentable and a second track cannot be a workaround.

**The code moves across** rather than being rebuilt from scratch — the owner's call, made knowing
it brings a second set of conventions into a codebase with strict ones. What it must satisfy on
arrival is not negotiable, because these are tested invariants and the build fails without them:
every user-visible string through `t()` with en/ar parity · one CSS prefix per sheet, registered ·
`lib/**` may not import `store/**` · hand-rolled SVG, no chart library.

**Each report carries its own mailing list.** Not the workspace roster — and that is what keeps the
account model intact. `profiles` holds no email address by design; usernames are
`<name>@opstrack.internal`, which can never resolve. A per-report list is a property of the report,
so the rule that protects the tracker stays exactly as it was.

**The tool sends the email.** ⚠ This would be **the first thing this product has ever sent outside
the building**, and it needs its own decisions before it ships: a provider, a sending identity, a
rule about who may trigger it, and a record of what was sent to whom. None of that exists today.

**PapaParse does not come with it.** The owner left the choice open and this is the reading: the
repo already parses CSV in `scripts/report/extract.mjs` and writes it in `src/lib/export.ts`, so a
tested parser moves into `src/lib/` and the dependency count stays at eleven. The rule against new
runtime dependencies has held through a mapping library, a charting library and a PDF library
being turned down; it should not fall to a CSV parser the repo has already written twice.

## 3 · The open problem: Grafana

**A script on the owner's Mac fetches it.** That is the honest description and it is the thing that
does not survive the move: NphiesCore runs on GitHub Pages and Supabase, and neither can reach a
laptop.

Three ways out, none of them chosen yet:

1. **The upload step stays.** Whoever runs the report exports from Grafana and drops the file in.
   No credentials anywhere, nothing to administer, and it is what the app already does.
2. **The local script keeps running** and writes somewhere both can reach. The dependency on one
   laptop stays, and it is invisible until the laptop is closed.
3. **A server-side pull**, with a read-only Grafana credential held as an edge-function secret —
   the same shape as the Jira integration, and blocked by the same question of who administers it.

⚠ Until this is settled, the automation pipeline cannot come across whole. The upload → generate →
  review path can.

## 4 · Sequencing

**After the onboarding model, not before it.** Misbar works today; the onboarding process does not
exist yet. Moving a working tool ahead of building a missing one would be the wrong order, and the
owner's own gate — nothing ships until the BRD is approved — applies to this too.
