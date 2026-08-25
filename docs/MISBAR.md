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

## 2 · The two facts that decide the design

**Misbar has no server.** `store.js` is 61KB and persists entirely to `localStorage` — ten
references, and not one `fetch`, `indexedDB` or database call. It carries **its own password lock**
with crypto hashing, also in `localStorage`. So the weekly report, its settings, its baselines and
its snapshots live in one browser on one laptop, and nothing is shared, backed up or auditable.

**That is the case for moving it, and it is a strong one.** What it gains here is precisely what it
lacks: a server, real accounts, roles, durability, and a second person able to run the report.

**Its atom is a lab order line**, from `contracts.js`:

> `orderDate · facility · orderId · lineNo · loinc · testName · collected · dispatched · received ·
> resulted · rawStatus` — plus `specimenNo`, `shipmentId`, `orderingFacilityId`, which its own
> author annotates *"Operational id, not PHI"*.

Turnaround time is the arithmetic between four of those timestamps. The report needs the
**aggregate**; the rows are only how you get there.

## 3 · The logical way to have it here

### 3.1 The rows are processed in the browser and never stored

The CSV or Grafana extract is parsed and the TAT computed **client-side, exactly as today**, and
**only the per-facility, per-period summary is written to the server.** Order lines, specimen
numbers and shipment ids never reach the database.

This is not caution for its own sake — it follows the posture this workspace already has, and it is
cheaper as well as safer. It keeps a per-order clinical dataset out of a system whose privacy page
says it holds none; it keeps the row volume off a free-tier database; and it means BRD-001's
quarantine does not acquire a second front. **The thing the report needs is the aggregate, and the
aggregate is small.**

### 3.2 A Misbar facility is NOT a UHR organization, and must not be forced into one

Misbar's `facility` is a **performing laboratory**. A `map_node` of kind Organization is a
**hospital being onboarded**. The two sets overlap and are not the same, and `map_nodes.track_id`
is derived from the parent by a trigger — so an organization belongs to exactly one track, by
construction, because *"two filing axes"* is the thing that schema refuses to represent.

⚠ **So "Misbar as a track containing labs" would duplicate every hospital that is also a lab**, and
  create a second answer to "which organizations are we dealing with" — the exact defect
  `Pmo.tsx` names when it refuses a `projects` table: *"a second table would be a second answer."*

Instead: **`misbar_facilities`, with an optional `node_id`** pointing at the map node where a lab
is also an onboarded hospital. The link is where the payoff of one tool actually lands — a
hospital's own page able to say *"and its lab turnaround is X"*, which neither system can say
today.

### 3.3 "Its own track" is honoured where it means something

The owner's answer was a track like Ayenati and Raqeeb, and that is right about **navigation and
reporting** — Misbar gets its own space, its own reports, its own audience — and wrong about
**storage**, for §3.2's reason. A weekly turnaround time is not a use-case status, and writing it
into `map_node_use_cases` would be a lie about what that table means.

So: a track for where it appears, its own tables for what it holds.

### 3.4 What crosses, and what is left behind

| Comes across | Stays behind, and why |
|---|---|
| the ingest parsers (CSV, XLSX, Grafana) | **PapaParse** — the repo parses CSV in `scripts/report/extract.mjs` and writes it in `src/lib/export.ts`; a tested parser moves into `src/lib/` and the dependency count stays at eleven |
| the TAT computation and scorecard rules | **the password lock** — the workspace has real authentication, roles and a member directory; a second one is a second thing to get wrong |
| the late-labs exception list | **the theme switcher** — this app already has one, tested in both themes |
| the slide renderer, as a print stylesheet | **its i18n layer** — every string goes through `t()` with en/ar parity, enforced by a test that fails the build |
| the Arabic, which is good and idiomatic | **`localStorage` as the store** — that is the limitation being fixed |

### 3.5 What it must satisfy on arrival

Not negotiable, because each is a tested invariant and the build fails without it: every
user-visible string through `t()` with en/ar parity · one CSS prefix per sheet, registered in
`global.css` · `lib/**` may not import `store/**` · hand-rolled SVG, no chart library · no new
runtime dependency.

## 4 · The decisions taken

**Each report carries its own mailing list** — not the workspace roster, and that is what keeps the
account model intact. `profiles` holds no email address by design; usernames are
`<name>@opstrack.internal`, which can never resolve. A per-report list is a property of the report,
so the rule protecting the tracker stays exactly as it was.

**The tool sends the email.** ⚠ This would be **the first thing this product has ever sent outside
the building**. It needs a provider, a sending identity, a rule about who may trigger it, and a
record of what was sent to whom — none of which exists today.

## 5 · The open problem: Grafana

**A script on the owner's Mac fetches it.** That is the honest description, and it is what does not
survive the move: NphiesCore runs on GitHub Pages and Supabase, and neither can reach a laptop.

1. **The upload step stays** — export from Grafana, drop the file in. No credentials anywhere, and
   it is what the app already does.
2. **The local script keeps running** and writes somewhere both can reach. The dependency on one
   laptop remains, and it is invisible until the laptop is closed.
3. **A server-side pull**, with a read-only Grafana credential as an edge-function secret — the
   same shape as the Jira integration, and blocked by the same question of who administers it.

⚠ Until this is settled the automation pipeline cannot come across whole. Upload → generate →
  review can, and that is the path that works today anyway.

## 6 · Sequencing

**After the onboarding model, not before it.** Misbar works today; the onboarding process does not
exist yet. Moving a working tool ahead of building a missing one is the wrong order — and the
owner's own gate, that nothing ships until the BRD is approved, applies here too.
