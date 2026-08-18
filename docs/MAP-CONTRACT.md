# MAP-CONTRACT — the collapse into the map

Written by the architect after reading the four rival designs, their four adversarial
critiques, the seven recon reports and the code as it stands at HEAD of
`feat/nphiescore-map`. This is the contract a fleet executes. It supersedes the four
studies; where it disagrees with them it is because a critic was right.

---

## 0. THE FINDING THAT SHAPES EVERYTHING

All four critiques — including the three that came back *salvageable* — converge on one
sentence, and it is the most valuable thing in the whole corpus:

> **He keeps the map as a picture and a capture bar, and he quietly asks for the
> follow-ups list back.**

Critique 0: *"the map is the thing he SHOWS people and the panel is the thing he WORKS
in."* Critique 1: *"he keeps the capture bar and the rail and stops looking at the
canvas — and the design has that backwards."* Critique 2 (fatally-flawed): *"By Wednesday
he is typing /followups into the URL bar out of muscle memory."* Critique 3: *"he keeps it
open as a picture and a capture bar … and quietly asks for the follow-ups list back."*

The mechanism is not opinion, it is structural. **The map draws the OPEN workload,
partitioned by track first.** The question Aziz asks every single day — *what is overdue
across Infra, Network, IT Ops, SRE, Dev & QA and Ayenati PMO, and who do I chase* — is a
question that crosses every track and sorts by date. Answering it on a track-partitioned
canvas means six drill-ins with six independent sorts. That is not a slower version of
today's screen; it is a different, worse screen.

**So this contract does not put the daily job on the canvas. It puts a real-DOM list
BESIDE the canvas, in one shell, at one route.** The directive — "the tracker only shows
the mind map" — is honoured as *one destination, one URL, one shell*: navigation is Map +
Settings and nothing else. It is not honoured as *every pixel is SVG*, because that reading
is the one every critic says makes him stop opening the app.

Three further structural facts, each from recon, each load-bearing:

1. **Closed work has no node.** SLA compliance, throughput, and the board's Done/Cancelled
   columns are questions about `done` entries in a window. `useMapModel` pins
   `scope: 'open'` and `buildMindtree` emits nothing for a closed entry. These can never be
   overlays on the map. They are **stages that replace the canvas**, and that is why
   STAGES exist in this contract as a first-class concept.
2. **Fast typing and a document both fight a canvas.** Meeting live capture is zero
   pointer interactions and must never remount its input; minutes and the digest are
   printed and pasted. These are **modes the map leaves and returns from**, on their own
   routes, because a route is exactly how you leave and return with Back, print and paste
   intact.
3. **The accessible table is not decoration.** `MindtreeTable` is the only sortable ledger
   of the whole ring-2 ranking, the only view with the drag layer off, and the low-motion
   reading mode. Reading "the tracker only shows the mind map" as *delete the table* would
   fail the a11y contract and lose a real job. It survives as `stage: 'table'`.

---

## 1. THE ARCHITECTURE

One route. One shell. `src/pages/Mindtree.tsx` — already decomposed to 506 composing
lines over thirteen modules — **becomes that shell**. It keeps its job of stating the
order things are called in, and gains four regions:

```
┌──────────────────────────────────────────────────────────────────┐
│ HEADER   FilterBar · MapToolbar · MapLensBar · MapModeBar · bell  │
├───────────────────────────────────┬──────────────────────────────┤
│                                   │                              │
│  STAGE                            │  PANEL   (MapPanel host)     │
│  map | board | numbers | table    │  real DOM, scrolls, acts     │
│                                   │  needsMe | branch | changes  │
│                                   │  | numbers | none            │
├───────────────────────────────────┴──────────────────────────────┤
│ COMPOSER   MapCapture — always mounted, full parse.ts grammar     │
└──────────────────────────────────────────────────────────────────┘
```

### LENSES re-shape what the shell shows

A lens is one chip. It sets a **stage** and a **panel subject** together, and it rides the
URL so a view is still pasteable into a chat.

| lens | stage | panel | replaces |
|---|---|---|---|
| `needs-me` **(default)** | `map` | `needsMe` | `/followups` |
| `shape` | `map` | `branch` (or `none`) | today's `/mindtree`, `/tracks`, `/tracks/:id` |
| `by-status` | `board` | `none` | `/board` |
| `what-changed` | `map` | `changes` | `/notifications` |
| `numbers` | `numbers` | `numbers` | `/dashboard` |

`DEFAULT_LENS = 'needs-me'` because today the app **lands on `/followups`**
(`App.tsx:634`, `:728`). Landing anywhere else is a regression on day one. The lens is
persisted, so a reader who prefers `shape` gets `shape` back.

Lenses are **orthogonal to the map's four dimensions** (`status | owner | priority |
health | group`). Critique 0 is explicit that folding "attention" into a ring-2 axis
destroys the total-partition property that makes the map's numbers trustworthy and takes
the drag away from the default view. The dimension chips stay exactly as they are.

### MODES are surfaces the map enters and leaves

`/meetings`, `/meetings/:id`, `/meetings/:id/triage`, `/meetings/:id/minutes`, `/digest`
stay **real routes**, wrapped in a `ModeFrame` that gives them a single "back to the map"
target. They are reached in **one tap** from a fixed affordance in the shell header
(`MapModeBar`) — the same cost as today's tab-bar slot. `/entry/:id` also stays a real
route: it is the target of every push notification, chat link and share sheet.

### The phone

Same map, one ring at a time (`useMapModel`'s `OPEN_DEPTH = 1` already does this),
tap-to-drill (already 1 tap on a phone), and the panel becomes a **thumb-first bottom
sheet** with three detents. For `needs-me` and `what-changed` the phone's default detent
is **`full`** — a phone reader who taps the attention lens gets the list they get today,
full width, not three rows peeking over a canvas. Anything less is a regression and the
whole reason the detent is specified rather than left to taste.

---

## 2. THE KILLER TEST — every job, today's cost vs. tomorrow's

Ranked by how often Aziz does it. **Nothing here may get slower.**

| job | today | after | verdict |
|---|---|---|---|
| Land on "what needs me" | 1 tab tap | **0** (default lens) | faster |
| Capture, desktop, 2nd+ line | `c` + type + Enter, route change | `c` + type + Enter, **no route change** | faster |
| Capture, phone, 1st line | FAB tap **+ a 2nd tap on the input** (task #67) | **1 tap** — composer is pre-mounted, `focusMapCapture()` runs inside the tap | faster |
| Mark done from the list | 1 tap | 1 tap | equal |
| Snooze / update / take it / assign | 1–2 taps | 1–2 taps | equal |
| Everyone ⇄ Mine | 1 tap (never behind a disclosure) | 1 tap (never behind a disclosure) | equal |
| Board | 1 tab tap | 1 lens chip | equal |
| Dashboard six numbers | 1 tab tap, no selection | 1 lens chip, no selection | equal |
| Number → the list that acts on it | 1 tap (tile is a `<Link>`) | 1 tap (tile sets lens + filter in the URL) | equal |
| Digest, from anywhere | 2 (dashboard, then digest) | 2 (numbers lens, then digest) | equal |
| Meetings | 1 tab tap | 1 tap on `MapModeBar` | equal |
| Meeting live capture | type + Enter, **zero pointer** | unchanged — own route, own input | equal |
| Notifications record | 2 taps (bell → See all) | 2 taps (bell → See all → lens) | equal |
| Track timeline | **Cmd+K + type the name + Enter; no link anywhere** | 1 tap on the node, range control in the panel | **much** faster |
| Track's open work, bulk assign 30 | 1 tick + 2 selects (+1 confirm) | same, in the branch panel | equal — **the highest regression risk, see U4** |
| Map: where is the mass | 0 clicks | 0 clicks (`shape` lens, persisted) | equal |
| Map: drag to re-file | 1 drag | 1 drag, same dimension, same default view | equal |
| Export the picture to a deck | 2 clicks | 2 clicks | equal |
| Share a view as a link | 0 extra (URL) | 0 extra (URL, now carrying `lens`) | equal |
| Delete a member (App Review) | Settings → Members → 3 taps | unchanged — Settings is only enhanced | equal |

**Two honest costs, stated rather than hidden:**

- On a **phone**, the `by-status` and `numbers` stages replace the canvas rather than
  sitting beside it. That is not slower, but it means the picture and the board can never
  be on screen together on a 375px viewport. This is a property of 375px, not of the design.
- The `shape` lens's panel opens on `branch` only once a node is focused. With nothing
  focused, the panel is `none` and the map is the whole width — which is today's screen
  exactly.

---

## 3. HOUSE RULES FOR EVERY UNIT

Non-negotiable, repeated in every brief because the builders never talk to each other.

1. **TypeScript strict. No new runtime dependencies.** Plain co-located CSS.
2. **CSS: logical properties only.** `margin-inline-start`, never `margin-left`;
   `inset-block-start`, never `top`. A standing grep for physical layout properties must
   return zero. Your sheet owns exactly one prefix (listed in your brief), styles no
   other's, and states its prefix in its own header comment. **You may not edit
   `docs/EXECUTION-PLAN.md` §1.0.7** — it is an integrator file. Instead, put the exact
   one-line registry entry at the top of your report and the integrator pastes it.
3. **i18n.** Every user-visible string through `t()`. `en` and `ar` at exact key parity.
   Plural keys are CLDR plural objects (Arabic has six categories — `src/lib/plural.ts`).
   Arabic strings embedding a Latin word or a number need bidi isolates
   (`src/lib/bidi.ts`). Keys must appear as **literals** somewhere `localeReach.test.ts`
   can see — a `t(\`x.\${kind}\`)` template ships missing in one language. Use a
   `const KEY_TABLE = { … }` of literals, as `Digest.tsx` and `Notifications.tsx` do.
4. **44px minimum touch targets**, visible focus rings, `aria-live` for async results,
   `prefers-reduced-motion` honoured, RTL equal to LTR. If you compact a control below
   44px, scope it to `@media (hover: hover) and (pointer: fine)` — the unconditional
   version shipped the smallest targets to the smallest screens once already.
5. **Do not touch**: `src/lib/capture/parse.ts` (FROZEN) · `src/lib/export.ts`
   `format: 'opstrack-export'` · `src/lib/labelIO.ts` `LABEL_FILE_FORMAT =
   'coretrack-terminology'` · `@opstrack.internal` · `supabase/migrations/*.sql` · the
   repo name `opstrack` · any `opstrack_*` localStorage key. (The `/opstrack/` Pages base
   path is no longer on this list: `public/CNAME` moves the app to the apex of
   `nphiescore.com` with no source change — DOMAIN-CUTOVER.md. Everything else here still
   holds, and a new domain is exactly when a sweep tries to "tidy" it.)
6. **Gates**: `npx tsc --noEmit` · `npx oxlint` · `npx vitest run` · `npx vite build`.
   Baseline: tsc clean, oxlint 0 errors, 3,281 tests pass, build succeeds. **A test that
   passed before your change must pass after it.** If you delete a page you delete its
   test file — but if that test asserted a guarantee the new surface still owes, you
   **rewrite the test against the new structure**, restating the same guarantee. You never
   drop a guarantee silently. If you believe a test is wrong, say so with reasoning in
   your report; do not weaken it.
7. **`src/lib/**` may not import `src/store/**` or `src/api/**`** (grep-enforced). Pure
   modules take their numbers as arguments. Do not import `lib/labels.ts` from a new pure
   module — it pulls `i18n.ts`, which reads `localStorage` at module scope and kills every
   test under vitest's node environment.
8. **You own only the files listed in your unit.** If you need a change in a file you do
   not own, put the exact diff in your report for the integrator. Editing another unit's
   file loses their work.

---

## 4. WORK UNITS

Seven units. Every file below belongs to exactly one of them. Signatures are exact
because other units compile against them before they exist.

---

### U1 — MAP SHELL: lenses, stages, panel host, URL, phone sheet

**This is the spine. Land it first.** Every other unit's component is mounted by U1.

**Owns**

| file | purpose | max lines |
|---|---|---|
| `src/lib/mindtree/lens.ts` | NEW. Pure. The closed lens/stage/subject unions and the total functions over them. | 180 |
| `src/lib/mindtree/lens.test.ts` | NEW. Exhaustiveness + round-trip of the URL codec. | 200 |
| `src/pages/map/useMapLens.ts` | NEW. The lens hook: store + URL + announcement. | 220 |
| `src/pages/map/useMapUrl.ts` | EDIT. Carry `?lens=` and `?stage=` through the existing codec. | 340 |
| `src/pages/map/useMapUrl.test.ts` | EDIT. Extend, do not rewrite. | 520 |
| `src/components/map/MapLensBar.tsx` | NEW. The lens chips + the stage switch. | 260 |
| `src/components/map/map-lens.css` | NEW. Prefix `.mlens-*`. | 220 |
| `src/components/map/MapPanel.tsx` | NEW. The dock: inline-end rail ≥768px, bottom sheet with detents below. | 300 |
| `src/components/map/map-panel.css` | NEW. Prefix `.mpan-*`. | 300 |
| `src/pages/Mindtree.tsx` | EDIT. The shell composition. | 760 |
| `src/pages/mindtree.css` | EDIT. The shell grid only; do not restyle the canvas. | (existing +200) |
| `src/store/mindtree.ts` | EDIT. Persist `lens`, `stage`, `panelOpen`, `detent`. | (existing +120) |
| `src/locales/{en,ar}/mindtree.json` | EDIT. Lens/stage/panel strings. | — |
| `src/locales/{en,ar}/nav.json` | EDIT. Nav collapses to Map + Settings. | — |

**Exports — exact**

```ts
// src/lib/mindtree/lens.ts
export type MapLens = 'needs-me' | 'shape' | 'by-status' | 'what-changed' | 'numbers'
export type MapStage = 'map' | 'board' | 'numbers' | 'table'
export type PanelSubject =
  | { readonly kind: 'none' }
  | { readonly kind: 'needsMe' }
  | { readonly kind: 'branch'; readonly nodeId: string }
  | { readonly kind: 'changes' }
  | { readonly kind: 'numbers' }
export const MAP_LENSES: readonly MapLens[]
export const MAP_STAGES: readonly MapStage[]
export const DEFAULT_LENS: MapLens
export function isMapLens(v: unknown): v is MapLens
export function isMapStage(v: unknown): v is MapStage
export function stageForLens(lens: MapLens): MapStage
export function subjectForLens(lens: MapLens, focusNodeId: string | null): PanelSubject
export function lensNeedsClosedWork(lens: MapLens): boolean
/** Literal key table — localeReach must be able to see every key as a string. */
export const LENS_KEY: Readonly<Record<MapLens, string>>
export const STAGE_KEY: Readonly<Record<MapStage, string>>

// src/pages/map/useMapLens.ts
export type PanelDetent = 'peek' | 'half' | 'full'
export interface MapLensState {
  readonly lens: MapLens
  readonly stage: MapStage
  readonly subject: PanelSubject
  readonly panelOpen: boolean
  readonly detent: PanelDetent
  setLens: (next: MapLens) => void
  setStage: (next: MapStage) => void
  setSubject: (next: PanelSubject) => void
  setPanelOpen: (open: boolean) => void
  setDetent: (next: PanelDetent) => void
}
export function useMapLens(options: {
  focusNodeId: string | null
  compact: boolean
  announce: (text: string) => void
}): MapLensState

// src/components/map/MapPanel.tsx
export interface MapPanelProps {
  open: boolean
  compact: boolean
  detent: PanelDetent
  onDetent: (next: PanelDetent) => void
  onClose: () => void
  title: string
  children: ReactNode
}
export default function MapPanel(props: MapPanelProps): ReactElement

// src/components/map/MapLensBar.tsx
export interface MapLensBarProps {
  lens: MapLens
  onLens: (next: MapLens) => void
  stage: MapStage
  onStage: (next: MapStage) => void
  compact: boolean
  /** null = not computed for that lens. Rendered as a badge on the chip. */
  counts: Readonly<Partial<Record<MapLens, number>>>
}
export default function MapLensBar(props: MapLensBarProps): ReactElement

// src/pages/map/useMapUrl.ts — ADDITIVE only, existing signatures unchanged
export interface MapUrlLens { lens: MapLens; stage: MapStage }
export function mapLensFromParams(p: URLSearchParams): MapUrlLens | null
export function mapParamsForLens(p: URLSearchParams, v: MapUrlLens): URLSearchParams
```

**Brief.**

You are building the shell that every other unit plugs into. Read
`src/pages/Mindtree.tsx` end to end first — its header states the ORDER the eleven hooks
must be called in, and that order is a hard requirement of the hooks themselves, not a
style. **Do not reorder it.** You are adding regions around that composition, not
rewriting it.

*The lens module.* `lens.ts` is pure and total. `PanelSubject` is a **closed union with an
exhaustive `switch`** in exactly one place (the shell's panel renderer) — this was the
single idea Critique 3 named as unambiguously right, and it is what stops a sixth panel
kind ever shipping half-wired. Every function is total; no `default:` that swallows.
`LENS_KEY`/`STAGE_KEY` are literal tables so `localeReach.test.ts` can see the keys.

*The URL.* `?focus=` and `?group=` already round-trip through `useMapUrl.ts`, and the two
effects there converge only because the inbound one depends on `[params]` alone (with a
deliberate oxlint suppression) and the outbound one string-compares before writing.
**Do not merge them, do not add the store to the inbound deps** — either change loops or
hands the URL's stale opinion back to the store. Add `lens` and `stage` as two more
mirrored params, following the exact shape of the existing `dimension` handling. `replace:
true` always: FilterBar's search is not debounced and a history entry per keystroke makes
Back unusable. A URL with no `?lens=` means the persisted lens, not the default — the
default only applies when nothing is persisted either.

*The panel host.* `MapPanel` is a **sibling of the canvas, never a child.**
`pages/mindtree.css` sets `.mtree-canvas { overflow: hidden; touch-action: none }` and
`touch-action` intersects DOWN the ancestor chain — a descendant cannot re-enable `pan-y`,
so a scrolling list inside the canvas is unscrollable on a phone. `map-list.css` already
ships a `.mtree-list-split` wrapper for exactly this; either reuse it or supersede it
with `.mpan-split` and tell U3 in your report which. At ≥768px the panel is an inline-end
rail; below, it is a bottom sheet with three detents (`peek` ≈ 25vh, `half` ≈ 55vh, `full`
≈ 92vh). Reuse `src/components/sheet/Sheet.tsx` if it fits; if it does not (it is modal
and this is not), say so and build the detent behaviour in `MapPanel`. **The sheet is
non-modal** — the map behind it stays readable and the composer stays reachable. Honour
`prefers-reduced-motion` on every detent transition. Drag-to-detent is an accelerator, never
the only path: a visible detent button and keyboard access are required.

*Phone default detents, and this is a killer-test requirement, not a preference:*
`needs-me` → `full`. `what-changed` → `full`. `shape` with a branch subject → `half`.
`numbers` → `full`. Anything less on `needs-me` shows a phone reader fewer rows than
`/followups` does today, which is the regression this whole contract exists to avoid.

*Escape ordering.* `lib/overlayStack` owns Escape globally; `Mindtree` adds its own
document-level Escape for the export panel; the map's keyboard grammar uses Escape as a
three-level stack (clear selection → abort lift → clear drill-in). The panel adds a
fourth claim. **Decide and document the order in `MapPanel`'s header before writing a
line of it.** Required order, from innermost: (1) a lifted drag aborts, (2) an open
overlay (menu / quick-add / entry sheet) closes, (3) the composer clears if it has text
and the caret is in it, (4) the panel closes if it is a phone sheet, (5) the drill-in
clears. The panel must register through `lib/overlayStack`, never bind `document` itself.

*The composer's keyboard claim.* The map's `onKeyDown` (`useMapKeyboard.ts`) is a React
handler on the `<svg>`; React events bubble through the SVG subtree. The composer is
rendered **outside** that subtree, as a sibling — verify this in your final DOM and say so
in your report. `lib/hotkeys.isTypingTarget()` is a structural test, so a real `<input>`
outside the SVG is inert to the map and inert to the global hotkeys while focused.

*What you mount.* Import and render, from the other units:
`MapCapture` (U2, no props), `MapList` + `useAttentionCount` (U3), `MapChanges` +
`useChangesCount` (U3), `MapBranch` (U4), `BoardStage` (U5), `NumbersStage` +
`NumbersPanel` (U6), `MapModeBar` (U7). **Write against the signatures in this document.**
They will not exist when you start; stub them locally only if you must, and delete the
stubs before you report.

*Jobs you must not make slower:* landing on the attention list (must be 0 taps), the map's
0-click glance (`shape` restores the persisted drill-in and density before any data load —
do not defer it behind a fetch), re-grouping on a dimension (1 chip — `chooseDimension`'s
trim-not-clear rule stays exactly as it is), the pasteable link.

*Tests you owe:* `lens.test.ts` — exhaustiveness of every total function over both unions,
and `stageForLens`/`subjectForLens` for all five lenses. `useMapUrl.test.ts` — the existing
cases must still pass, plus lens/stage inbound, outbound, and the settles-differently case.
Do not restore the harness bug recorded in `docs/MAP-UNFINISHED.md` §"Defects": the test
must not write the URL's value straight into the store.

---

### U2 — THE COMPOSER: capture on the canvas

**Owns**

| file | purpose | max lines |
|---|---|---|
| `src/components/map/MapCapture.tsx` | EDIT. Already ~1,125 lines and substantially correct. Wire, fix, phone-proof. | 1,200 |
| `src/components/map/map-capture.css` | **NEW — does not exist and the component imports it.** Prefix `.mcap-*`. | 480 |
| `src/components/map/MapCapture.test.tsx` | NEW. | 600 |
| `src/locales/{en,ar}/capture.json` | EDIT (own it; keys move, none are lost). | — |
| **deletes** `src/pages/Capture.tsx`, `src/pages/capture.css`, `src/pages/Capture.test.tsx` | | |

**Exports — exact**

```ts
// src/components/map/MapCapture.tsx  (both already exist — keep them byte-compatible)
export function focusMapCapture(): boolean
export default function MapCapture(): ReactElement
```

**Brief.**

`MapCapture.tsx` already exists, is ~1,125 lines, imports `lib/capture/parse` correctly,
renders the chip strip, the problems panel, the ambiguity picker, the AI row and the
recurring notice, and writes through `store/entries.createEntryOptimistic`. It is imported
by nothing and **it imports `./map-capture.css`, which does not exist**. Nothing catches
this today because the bundler never resolves an unreferenced import; the moment U1 mounts
it, `vite build` breaks. **Write the sheet first, before anything else.** Its classes:

```
mcap-bar mcap-chip mcap-chip-sigil mcap-chip-value mcap-chip-x mcap-clear mcap-error
mcap-field mcap-form mcap-hint mcap-input mcap-kept mcap-kept-fix mcap-kept-line
mcap-notice mcap-notice-link mcap-pick mcap-pick-chip mcap-pick-title mcap-problem
mcap-problem-fix mcap-problem-text mcap-problems mcap-problems-count mcap-problems-title
mcap-read mcap-read-plain mcap-submit mcap-track-color mcap-will
```

Re-derive that list yourself with
`grep -ohE "mcap-[a-z0-9-]+" src/components/map/MapCapture.tsx | sort -u` — if the
component gained a class while you were working, the sheet must have it. `.mcap-*` is
recorded as RESERVED in the prefix registry; report the line that converts it to a real
entry.

Then **read `src/pages/Capture.tsx` (1,283 lines) and diff it against `MapCapture.tsx`
feature by feature.** Anything `/capture` can do that the bar cannot is a regression the
moment you delete the page. Specifically verify all of: the live chip strip on every
keystroke; the debounced 700ms polite announcement of the **ok-token COUNT** (not the
chips — per-keystroke reads the line back one letter at a time); the problems panel with
its per-row "Fix" that **selects the token's span rather than deleting it** (the user typed
`due:someday` because they meant a date); the `×` on a chip to remove a token; the
`#i`-matches-two-tracks candidate picker; the AI suggestion accepted with **Tab at
end-of-line only** so Tab still reaches Clear and Submit; `Esc` dismisses; the `every:`
recurring path writing `recurring_templates` with the notice linking to
`/settings/recurring`; and `confirmationFor()`'s R2-PRODUCT-2 rule — OFFLINE changes
*where* it is, PROBLEMS change *whether it is right*, and the two are independent.
`offline.queued` is a **notice, not an error**.

**Hazards, each verified in recon:**

- `setText('')` **must stay before the `await`** in every submit path. Moving it after the
  network puts a round trip in front of the next thought — the one thing this box sells.
- `makeCtx()` stamps `now: new Date()` and the context is memoised **with `text` in its
  dependency list on purpose**. Memoising on its inputs alone freezes `now` at tab-open and
  resolves `due:tomorrow` against the wrong day for anyone who leaves the app pinned —
  which is everyone. `handleSubmit` re-parses with a fresh context, deliberately, so a
  line typed at 23:59 and saved at 00:01 is correct.
- The **one shared `ParseContext`** goes to `parse()`, to `validate()` and to
  `takeAiTokens()`. Rebuilding an equivalent from the stores at a second call site breaks
  the validator's only guarantee. Build it once.
- Never fork the grammar. `parse.ts` is FROZEN and five files cite it by line number as
  the reason their own design is safe.
- The AI path **proposes token strings only.** It cannot replace the title, clear the box,
  submit, or reach the write.
- Bind **no document or window listener.** Every key is handled in `onKeyDown` on your own
  `<input>`.

**The phone, and this is the single biggest win available in the whole run.**
`pages/Capture.tsx`'s mount-focus cannot raise a software keyboard — WebKit and Chromium
both raise it only for a `focus()` taken inside the user-activation call stack. That is
open task **#67** and it costs a second tap on every first capture of a session. Your
component is **already mounted**, so `focusMapCapture()` called synchronously inside the
FAB's tap handler raises the keyboard on the first try. Keep `focusMapCapture()` a plain
synchronous function — not a promise, not an effect, not a state flag. The integrator wires
the FAB and the `c` hotkey to it; **you do not touch `App.tsx` or `CommandPalette.tsx`** —
put the exact call site diff in your report.

On a phone the bar is **fixed to the block-end of the shell, above the safe-area inset,
and never inside `.mtree-canvas`** (that container is `overflow: hidden; touch-action:
none`). When the keyboard is up, the chip strip and the problems panel must remain visible
— if they are covered, the user submits blind, which is the exact defect R2-PRODUCT-2 was
written to fix. Use `dvh`/`svh` units and test at 375px.

*Jobs you must not make slower:* desktop 2nd-and-later capture is N chars + Enter with
zero navigation. Phone first capture must become **1 tap**. Fixing a misunderstood token
stays 1 click. Disambiguating a `#track` stays 1 click. Accepting the AI stays Tab or 1
click.

*Tests you owe:* `Capture.test.tsx` has 30 cases. **Rewrite them against `MapCapture`** —
same guarantees, new structure. Do not delete a case; if one no longer applies (a route
assertion), replace it with the equivalent assertion about the bar. Add: the sheet resolves
(import it in a test), first-capture focus, keyboard-up layout, and that Enter inside the
box does not reach the map's key handler.

---

### U3 — ATTENTION & ACTIVITY: the `needs-me` and `what-changed` panels

**Owns**

| file | purpose | max lines |
|---|---|---|
| `src/components/map/MapList.tsx` | EDIT. Already ~800 lines and reuses `bucketFollowUps`. Bring to full parity with `/followups`. | 1,000 |
| `src/components/map/map-list.css` | EDIT. Prefix `.mtree-list-*` (already registered). | 600 |
| `src/components/map/MapList.test.tsx` | NEW. | 700 |
| `src/components/map/MapChanges.tsx` | NEW. The day-grouped notification record. | 420 |
| `src/components/map/map-changes.css` | NEW. Prefix `.mchg-*`. | 260 |
| `src/components/map/MapChanges.test.tsx` | NEW. | 300 |
| `src/locales/{en,ar}/map.json` | **NEW namespace.** Only the dock's own chrome. | — |
| `src/locales/{en,ar}/followups.json` | EDIT (own it). | — |
| `src/locales/{en,ar}/notif.json` | EDIT (own it). | — |
| **deletes** `src/pages/FollowUps.tsx`, `src/pages/followups.css`, `src/pages/FollowUps.test.tsx`, `src/pages/Notifications.tsx` | | |

**Exports — exact**

```ts
// src/components/map/MapList.tsx
export interface MapListProps {
  filter: FilterState
  scope: MindNode
  textOf: (label: MindLabel) => string
  onFocus: (nodeId: string | null) => void
  compact: boolean
  announce: (text: string) => void
}
export default function MapList(props: MapListProps): ReactElement
/** The badge on U1's `needs-me` chip. Total across every bucket. */
export function useAttentionCount(filter: FilterState): number

// src/components/map/MapChanges.tsx
export interface MapChangesProps {
  compact: boolean
  announce: (text: string) => void
}
export default function MapChanges(props: MapChangesProps): ReactElement
/** The badge on U1's `what-changed` chip. Unread count. */
export function useChangesCount(): number
```

**Brief.**

**This unit carries the job Aziz does more than any other, and every critic named it as
the place the collapse fails.** Read all four `userVerdict` fields in
`scratchpad/salvage/study-critique-*.json` before you write anything. The failure mode they
all describe is the same: cross-track triage chopped into per-track buckets. **Your list
is FLAT and GLOBAL by default** — it buckets across every track at once, exactly as
`/followups` does. Narrowing to one track is something the reader chooses; it is never
where they land.

`MapList.tsx` already exists (~800 lines), is imported by nothing, and is already correct
about the important things: it imports `bucketFollowUps` from `lib/entrySections` rather
than defining "needs attention" itself, it uses `followups.*` strings so the map and the
morning list can never disagree, its fold budget is `MAX_ROWS = 25` (FollowUps'
landing-screen value), and its section heading count is the bucket's **TRUE total** because
`EntrySection` takes `count` as a prop precisely so a sliced body cannot make the number
lie. **Keep all of that.** Your job is parity and the phone.

**Read `src/pages/FollowUps.tsx` (1,334 lines) and diff it feature by feature.** Every one
of these must be present at the same cost:

- **Everyone ⇄ Mine**: 1 tap, a segmented `aria-pressed` pair in the panel's own header
  row, **not behind the filter disclosure** — the source calls it "the screen's primary
  axis, not a detail behind a disclosure." It round-trips through the URL.
- **Mark done**: 1 tap, undo in the toast, no confirm. This button exists because the sheet
  route was 5+ steps. It must **read the previous status before writing**, or undo restores
  `new` on a formerly-blocked item.
- **Snooze +3d**: 1 tap. `snoozeFollowUp` measures from **today**, not from the existing
  date.
- **Quick update**: 1 tap → textarea autofocuses → type → Cmd/Ctrl+Enter. No navigation.
- **Take it**: 1 tap, Unassigned bucket only. "The single commonest triage outcome."
- **Hand it to a teammate**: a `<select>`, 2 interactions, Unassigned bucket only, a
  **separate control from "Take it"** — different verbs, not one verb twice.
- **Ask for an update (nudge)**: offered only in `overdue`/`slaBreach`/`stale`/`blocked`,
  only on a member-owned row that is not mine, only outside the 24h window; otherwise the
  same slot renders the **record** ("Asked 2 hours ago"). The section half of that rule
  lives only in `FollowUps.tsx` — carry it across or the button offers on due-soon items
  and the feature is muted in week one. Pill before verbs.
- **Open + prev/next**: `openEntry(id, { list })` where the list is **every row of every
  section in display order, including rows behind a fold** — that is FollowUps' sibling
  policy and it must not silently become the map's.
- The swipe accelerators are optional (every action is already an always-visible button),
  but if you keep them, a gesture is **never the only path**.

`MapChanges` replaces `/notifications`. It is the **day-grouped record** — today /
yesterday / earlier, newest-first inside each group — which is a different question from
"what changed just now" and is the one that survives a week of not looking. Required:
mark-read on the **trailing dot as a sibling button, not nested** (this is the entire
interaction for the half of notifications that are "noted, thanks"); mark-all-read
(optimistic, one toast — the store raises its own rollback toast, do not double-report);
unread-only chip. **A notification routinely names an entry this client has never fetched**
— a closed one, another track's. `openEntry()` self-loads it. Your rows must therefore be
readable and openable **as rows**, never as "jump to the node", because there may be no
node.

The bell popover (`src/components/NotificationBell.tsx`) is **not yours** — it stays a peek
and the integrator repoints its "See all" at the lens. Put that diff in your report.

*Layering:* your components are siblings of the canvas, never children — see U1's
`touch-action` note. On a phone U1 opens your panel at detent `full`; do not add your own
sheet.

*Jobs you must not make slower:* the six numbered above, plus "paste a triage view into a
chat as a link" — the filter IS the URL on `/followups` today (`setParams(…, { replace:
true })`) and it must remain so through U1's codec.

*Tests you owe:* `FollowUps.test.tsx` has 890 lines of correct tests of a correct screen.
**Rewrite them against `MapList`**, restating every guarantee. Add: the panel is flat and
global at first paint (assert rows from ≥2 tracks in one bucket), the true-total heading
count with the fold closed, the nudge section rule, and the "failed rows stay selected"
partial-failure behaviour if you carry bulk over.

---

### U4 — THE BRANCH PANEL: a track's work and its history

**Owns**

| file | purpose | max lines |
|---|---|---|
| `src/components/map/MapBranch.tsx` | NEW. The `branch` panel subject. | 900 |
| `src/components/map/map-branch.css` | NEW. Prefix `.mbr-*`. | 420 |
| `src/components/map/MapBranch.test.tsx` | NEW. | 700 |
| `src/locales/{en,ar}/tree.json` | EDIT (own it). | — |
| `src/locales/{en,ar}/track.json` | EDIT (own it). | — |
| **deletes** `src/pages/tracks/TracksIndex.tsx` + `.test.tsx` + `tree.css`, `src/pages/tracks/TrackTimeline.tsx` + `.test.tsx` + `timeline.css` | | |

**Exports — exact**

```ts
// src/components/map/MapBranch.tsx
export interface MapBranchProps {
  /** The focused node. `kind === 'root'` means the whole workspace. */
  node: MindNode
  /** Root-to-node trail, for the "as it stands" heading and the way out. */
  path: readonly MindNode[]
  filter: FilterState
  dimension: MindDimension
  textOf: (label: MindLabel) => string
  onFocus: (nodeId: string | null) => void
  compact: boolean
  announce: (text: string) => void
}
export default function MapBranch(props: MapBranchProps): ReactElement
```

**Brief.**

Two screens collapse into you, and one of them gets **much** better while the other is the
run's biggest regression risk.

**The gain.** `/tracks/:id` (TrackTimeline, 1,073 lines) has **no link from anywhere** —
reaching it costs Cmd+K, typing the track name, Enter, and Cmd+K does not exist on a phone.
As a panel on a focused node it is **1 tap**. Carry across: the 7/30/90/365 presets and the
two native date inputs; the All/Items/Updates filter; search within the window; refresh;
the unfold past 60 items. **Every one of those decisions must stay in the URL**
(`?from=&to=&q=&kind=`, `replace: true`) — "here is what happened in Onboarding last
month" as a pasteable link is most of what that screen is for. Hand the params to U1's
codec (`useSearchParams` directly is fine; just use `replace: true`).

**The trap.** TrackTimeline's header stat band reads the **LIVE store** and is labelled "as
it stands today", while everything below reads the **chosen window**. Merging them into one
number source is the obvious simplification and it produces a header that silently changes
meaning when somebody drags a date. Keep them separate and keep the label. The band also
flags when the working set is truncated by PostgREST's 1000-row clamp — keep that too.

**The risk: the delegation cockpit.** `/tracks` (TracksIndex, 1,271 lines) is where a whole
track's open work gets handed to one person: **1 click on the node checkbox → 2 clicks in
the bulk Assign select (+1 confirm at ≥10 rows)**, writes pooled 6-at-a-time, one summary
toast, and **failed rows stay selected so retry is one more click**. If your panel has no
multi-select and no bulk bar, a 3-click hand-off of 30 items becomes 30 × 2 clicks. That is
the clearest way this run fails. Also required at today's cost: **reassign one item's owner
from the row's `<select>`** (2 clicks — the select IS the display; `EntryRow`'s `OwnerBadge`
is switched off so two controls never tell one fact), **Shift-click a range that ADDS
rather than replaces** (a second stretch keeps the first; the anchor is the last hand-ticked
row), the **Unassigned-only chip**, and the **25-row fold**.

*Coupled mechanism you must reproduce:* selection pruning and the two folds are one thing.
`flatIds` is what the reader can SEE and the pruning effect drops anything not in it, so
**ticking a node has to open BOTH the collapsed node and the 25-row fold** or the selection
empties itself one tick later with no feedback.

*Facet exclusions are load-bearing.* TracksIndex forces `scope: 'open'` and deliberately
withholds the **owner** facet (the unassigned toggle owns it — both write
`FilterState.owner` and would fight) and the **track** facet (the tree IS that axis; a
track facet on a track-axis view empties five of six nodes). A hand-edited or inherited URL
carrying either is normalised in the `filter` memo, **not only in `effective`**, or the
facet-count pill counts a filter the user can neither see nor switch off.

*localStorage:* `opstrack_tree_v1` holds the fold prefs as the **NEGATIVE** (the collapsed
list) so a track created next month arrives expanded rather than invisible. It is a rename
**lookalike**, not a protected magic value — but the map already has its own collapse state
in `store/mindtree`, and **two stores for one concept will disagree**. Read
`store/mindtree`'s collapse state, do not open a second one. Report what you did with
`opstrack_tree_v1`; do not silently reset anyone's folds.

*Announcements:* the live region is keyed on a `seq` counter so assigning two rows to the
same person announces twice. Three lines, easy to drop.

*Jobs you must not make slower:* hand a track's open work to one person (1+2+1); reassign
one item (2); collect two clusters (Shift-range, additive); find the unassigned backlog (1);
read a track's history over a range (was Cmd+K + typing — must become 1 tap); tell "as it
stands now" from "in this range" (0 extra actions).

*Tests you owe:* `TracksIndex.test.tsx` (36 cases) and `TrackTimeline.test.tsx` (44 cases,
720 lines) are correct tests. **Rewrite both against `MapBranch`**, restating every
guarantee — especially the tick-opens-both-folds coupling, the additive Shift-range, the
two number sources, and the URL round-trip.

---

### U5 — THE BOARD STAGE

**Owns**

| file | purpose | max lines |
|---|---|---|
| `src/components/map/BoardStage.tsx` | NEW. The `by-status` stage. | 1,000 |
| `src/components/map/map-board.css` | NEW. Prefix `.mbd-*`. | 600 |
| `src/components/map/BoardStage.test.tsx` | NEW. | 700 |
| `src/lib/board/columns.ts` (+ `.test.ts`) | NEW. Pure column model extracted from `Board.tsx`. | 320 / 400 |
| `src/lib/dnd.ts` | EDIT (own it). | (existing) |
| `src/locales/{en,ar}/board.json` | EDIT (own it). | — |
| **deletes** `src/pages/Board.tsx`, `src/pages/board.css`, `src/pages/Board.test.tsx` | | |

**Exports — exact**

```ts
// src/components/map/BoardStage.tsx
export interface BoardStageProps {
  filter: FilterState
  compact: boolean
  rtl: boolean
  announce: (text: string) => void
}
export default function BoardStage(props: BoardStageProps): ReactElement
```

`src/lib/board/columns.ts` is yours alone — no other unit imports it, so its shape is your
call. It must be pure (`src/lib/**` may not import `src/store/**` or `src/api/**`).

**Brief.**

`Board.tsx` is 1,855 lines and it is the second most-used surface in the product. **This is
a re-host, not a rewrite.** Lift the pure column/axis logic into `src/lib/board/columns.ts`
with tests, then render it as a stage inside the shell. Keep the CSS behaviour; you are
changing where it mounts, not what it is.

**The hard gap this unit closes.** The Mindtree pins `scope: 'open'` and never calls
`loadClosedSince`. The board's **Done and Cancelled columns are populated by
`loadClosedSince(today − 14)` on mount, under every axis** — that is "what did the team
finish in the last fortnight", and a map-only app **deletes that job outright** unless you
make the call. Make it. Do **not** change `useMapModel`'s scope pin to do it — that pin is
invisible, load-bearing, and losing it makes Clear-all reset scope and change what the map
is about. Read the closed rows yourself, exactly as `Board.tsx` does today.

**Four independent move paths, all first-class.** Mouse drag (6px threshold); touch drag
(420ms hold, then drag); **arrow keys with a card focused** (1 keypress = 1 column,
clamped); **digits 1-9** (jump straight to column N). The source is explicit that a board
only a mouse can use is a board half this team cannot use. Plus the card's own status
`<select>`, which is **always status whatever the axis is**.

**The digit negotiation.** Digits 1-9 on a focused card and digits 1-4 on the open entry
(`lib/hotkeys.ts`) coexist today only because the board root calls `preventDefault()` and
`resolveHotkey`'s rule 1 honours `defaultPrevented`. You are now inside the map's document.
Verify the map's key grammar does not claim digits; if it does, resolve it and **document
the resolution in your header**. Report the outcome either way.

Also carry: per-column **collapse to a rail persisted PER DIMENSION** (a track id means
nothing to the status axis — losing this keying produces phantom collapsed nodes after an
axis switch); the **fold** (session-only, 25 comfortable / 40 compact) with the header
count staying the **TRUE total**; the **`.bd-sla` badge** per column with its pluralised
`aria-label`; the **overflow rail** for retired statuses, archived tracks and free-text
owners — retired buckets are **sources only, never drop targets**, and the hit test refuses
them so the pointer glides past ("hiding an option must never hide data"); the **column
composer** (`+` → type → Enter, which **clears and keeps focus**, Esc returns focus to the
`+`, and both the column's value and the filter's single track are pre-seeded); density.

**The aria-live seq trick.** The board's polite region keys its child on a counter so two
identical consecutive sentences BOTH announce. Three lines, and a naive `aria-live` div
swallows the second of two identical moves. Keep it.

`Board.tsx`'s refresh is a bare `refreshEntries()` with no busy state and no toast;
FollowUps' disables the button while in flight and toasts "Up to date". **Pick FollowUps'**
— the better one, not the simpler one.

*Jobs you must not make slower:* reaching the board (1 tap → 1 lens chip); moving an item
along the axis (all four paths); seeing the last fortnight's finished work (0 taps);
reaching the overflow rail (1 tap); collapse/fold/density (1 tap each).

*Tests you owe:* `Board.test.tsx` (579 lines) rewritten against `BoardStage`, plus
`columns.test.ts`. Assert explicitly: the closed columns are populated, retired buckets
refuse a drop, the keyboard and digit paths move a card, the per-dimension collapse keying
survives an axis switch, and the header count is the true total with the fold closed.

---

### U6 — THE NUMBERS STAGE

**Owns**

| file | purpose | max lines |
|---|---|---|
| `src/components/map/NumbersStage.tsx` | NEW. The `numbers` stage: the charts. | 700 |
| `src/components/map/NumbersPanel.tsx` | NEW. The six tiles, in the panel. | 420 |
| `src/components/map/map-numbers.css` | NEW. Prefix `.mnum-*`. | 500 |
| `src/components/map/NumbersStage.test.tsx` | NEW. | 700 |
| `src/locales/{en,ar}/dashboard.json` | EDIT (own it). | — |
| **deletes** `src/pages/Dashboard.tsx`, `src/pages/dashboard.css`, `src/pages/Dashboard.test.tsx` | | |

**Exports — exact**

```ts
// src/components/map/NumbersStage.tsx
export interface NumbersStageProps {
  filter: FilterState
  compact: boolean
  rtl: boolean
  announce: (text: string) => void
}
export default function NumbersStage(props: NumbersStageProps): ReactElement

// src/components/map/NumbersPanel.tsx
export interface NumbersPanelProps {
  filter: FilterState
  compact: boolean
  /** 1-tap jump from a number to the list that acts on it. Sets lens AND filter. */
  onJump: (lens: MapLens, patch: Partial<FilterState>) => void
}
export default function NumbersPanel(props: NumbersPanelProps): ReactElement
```

**Brief.**

Critique 0 is blunt about this one: *"he wants his throughput and aging numbers — he runs
Lean; those ARE his job — and they are behind Cmd-K and a mode, which is the design
deciding what his job is."* The numbers are **1 lens chip**, and the six headline figures
are visible with **no selection and no scroll**.

**They are WORKSPACE totals with no node to hang them on.** "unassigned: 12" is not a
track. If your panel requires a focused node first, this is 1 tap + 1 selection and still
cannot show the total — recon names this "the single most likely place the collapse costs
keystrokes". Do not do it.

`NumbersPanel` renders the six tiles: open / overdue / quiet / blocked / unassigned /
closed-this-window. Today each is a real `<Link>` — the **whole tile** is the target,
keyboard-reachable, destination visible in the status bar. Yours calls `onJump` and the
result must be **one interaction, and a URL you can paste**. Overdue / quiet / blocked /
unassigned jump to `needs-me` with the matching filter; open jumps to `by-status`.
The **Blocked tile prints the title and day count of the oldest blocker** — 0 clicks, cheap
to keep, easy to drop.

`NumbersStage` renders the charts. Reuse `src/lib/aggregate.ts` and
`src/components/charts/*` **as they are** — the aggregation is already pure and already
tested. Carry across:

- **TrackLoadChart** stacked by health, with the **untracked pile still a visible bar** — a
  map with no "No track" node drops it silently.
- **The aging histogram with its AgeBasis chip** (`created` ⇄ `activity`, 1 click). A node
  has ONE size; the map can encode one clock at a time. An overlay that silently picks one
  basis is **actively misleading**, which is exactly why both ship today. The chart renames
  its own description so the clock is never ambiguous.
- **Throughput by week** over 4/8/12 (1 chip). Sixteen numbers; a tree node cannot hold a
  time series.
- **SLA compliance**: headline percentage + denominator + per-priority bars + the
  "unmeasured" aside. **Never read `EntryHealth.sla_breached`** — the view returns no row
  for a closed entry and `computeHealth` collapses one to the calm shape, so a
  "simplification" to read the flag renders permanent 100% compliance.
- **OwnerLoadTable** with unassigned **pinned last as a row, never omitted**. The reader's
  next action is to move an item from one person to another, which needs a table, not a
  shape.

**Non-negotiable a11y contract, asserted by `Dashboard.test.tsx` today.** Every one of
these must survive into your tests: one `<details>` "Show data" **real `<table>` per
chart** with the numbers in it (`:379`) — `ChartFrame`'s header states the table is the
**authoritative** representation, not a screen-reader consolation; one focusable,
fully-labelled mark per category (`:386`); `role="group"`, **not** `role="img"` (`:345`);
`title` + `desc` wired by id (`:353`); the `desc` describes the **shape**, not the title
(`:363`); row headers on the owner table (`:400`); and **RTL mirrors the inline axis rather
than merely re-labelling it** (`:409`, `:425`). There are no logical properties inside
`<svg>` — `geometry.ts` resolves direction once; any hand-written `x` arithmetic will pass
in English and reverse the story in Arabic.

**`useChartSize()` falls back to 340px when there is no `ResizeObserver`.** That is what
lets these tests render through `renderToStaticMarkup` under vitest's node environment. A
replacement that renders nothing until measured turns every assertion into an assertion
about an empty `<svg>`, silently. Do not change it.

**Two pins.** (1) The dashboard pins `scope: 'all'` **outside** filter state — moving it
into `filter` makes `countActiveFacets()` report a phantom active filter and Clear-all
silently empties throughput and SLA of every closed row; `Dashboard.test.tsx:328` asserts
"no active filter on first paint". (2) The dashboard **withholds the status / health /
scope facets** because three panels MEASURE those. The shell's FilterBar offers status.
**Report this collision to the integrator**: while the `numbers` lens is active the status
and health facets must be suppressed, or a reader can filter the answer out of its own
question. Implement the suppression in your own component if you can do it without touching
`FilterBar.tsx` (you may not — it is shared); otherwise hand the integrator the diff.

**Two definitions of "blocked" live one import apart.** `aggregate.oldestBlockers` counts
`blocked` OR `waiting_on` (matching `bucketFollowUps`, so the tile equals the section you
click into); `store/entries.countEntries.blocked` counts only `blocked`. Use the first, and
say which in the tile's `aria-label` source comment.

**The digest's only in-app link is on the dashboard** (`Dashboard.tsx:344`). Your stage
must carry a 1-tap link to `/digest` or U7's mode bar must — coordinate through the
integrator, and **do not both ship one**. U7 owns the mode bar; you own the tile-strip
link. Ship yours; it is the entrance that matches today's cost.

*Jobs you must not make slower:* read six numbers (0 clicks after arrival); jump from a
number to its list (1 tap); the AgeBasis switch (1 chip); the throughput window (1 chip);
read the exact number off a chart (1 disclosure); see who is overloaded (0 clicks);
name the oldest blocker (0 clicks).

*Tests you owe:* `Dashboard.test.tsx` (502 lines) rewritten against `NumbersStage` and
`NumbersPanel`, with all seven a11y assertions above restated verbatim in intent.

---

### U7 — MODES: meeting and digest, and the way back to the map

**Owns**

| file | purpose | max lines |
|---|---|---|
| `src/components/map/ModeFrame.tsx` | NEW. The wrapper every mode route renders inside. | 220 |
| `src/components/map/MapModeBar.tsx` | NEW. The fixed 1-tap entrances in the shell header. | 240 |
| `src/components/map/map-mode.css` | NEW. Prefix `.mmode-*`. | 320 |
| `src/components/map/ModeFrame.test.tsx` | NEW. | 300 |
| `src/pages/meetings/MeetingsIndex.tsx`, `MeetingLive.tsx`, `MeetingTriage.tsx`, `MeetingMinutes.tsx`, `access.ts`, `meetings.css`, `minutes.css`, `meetings.test.tsx`, `MeetingMinutes.test.tsx` | EDIT. Framing only. | (existing) |
| `src/pages/Digest.tsx`, `src/pages/digest.css` | EDIT. Framing + print only. | (existing) |
| `src/locales/{en,ar}/meeting.json`, `digest.json`, `minutes.json` | EDIT (own them). | — |

**Exports — exact**

```ts
// src/components/map/ModeFrame.tsx
export interface ModeFrameProps {
  /** Literal i18n key for the mode's own title. */
  titleKey: string
  /** true = the mode wants the full shell width (live capture, triage, minutes). */
  wide?: boolean
  children: ReactNode
}
export default function ModeFrame(props: ModeFrameProps): ReactElement

// src/components/map/MapModeBar.tsx
export interface MapModeBarProps {
  compact: boolean
}
export default function MapModeBar(props: MapModeBarProps): ReactElement
```

**Brief.**

A mode is a surface the map **enters and leaves**, and a route is exactly how you do that
with Back, print, paste and deep links intact. **You are not moving these screens onto a
canvas.** You are giving them one consistent frame, one guaranteed way back to the map, and
a 1-tap entrance that replaces the tab-bar slot they are losing. Almost all of your work is
framing; the screens themselves keep working.

**The entrance must stay a single fixed target.** `/meetings` is one thumb tap today. "A
meeting starts while people are walking into a room" — if it becomes a node you must first
find on the map, it goes from 1 tap to pan/zoom/hunt. `MapModeBar` sits in the shell header
at every viewport, always visible, 44px targets, with a badge when a meeting is live. It
carries **Meetings** and **Digest**.

**What must not regress, in order of how badly it breaks:**

1. **Meeting live capture is ZERO pointer interactions**: type, Enter, box clears
   synchronously, the line appears above, focus never leaves, repeat indefinitely. **This
   cannot regress by even one keystroke.** Do not remount the input across your frame. Do
   not put `appendMeetingLine` behind `startTransition`, `useDeferredValue` or a `rAF` —
   `nextLocalSeq()` reads `max(seq)+1` from the store synchronously right after the
   previous optimistic row lands, and deferring it makes two fast lines mint the same seq.
2. **Shift+Enter files a line as a note** — zero extra taps. On a phone it is Enter then 1
   tap on "Keep as a note". Do not let anything in your frame claim Enter or Shift+Enter.
3. **Escape** currently clears the capture box (`MeetingLive.tsx:292-296`), while
   `lib/overlayStack` owns Escape globally. Your frame must not add a claim. U1's
   documented Escape order governs; read it and conform.
4. **`startMeetingsRealtime()` is ref-counted** and registered by the two screens that
   render lines. If your framing changes where those screens mount, verify the
   registration still runs — forget it and a second attendee's lines never arrive, with no
   error anywhere.
5. **`flushLinePlans()` runs in the triage screen's unmount cleanup**, behind a 600ms
   debounce on every dropdown. If your frame changes the unmount boundary, wire the flush
   to whatever the new "leaving triage" event is, or the last decision is lost.
6. **Permissions are per-control, never per-page.** `canEditMeeting()` gates End, Reopen
   and the notes textarea only; capture, edit, re-state and triage stay open to the whole
   room. The notes field is `readOnly` for an attendee, **not hidden and not disabled** —
   readOnly keeps the text selectable and screen-reader reachable.
7. **Triage's zero-cost row.** Every dropdown opens on the parser's answer, so a correct
   line rides the commit untouched. "Same as above" is 1 tap per cell; **"fill down" is 1
   tap per COLUMN**. A 20-line meeting where every line is one track is 1 tap total.
   `meetings.test.tsx` asserts exact class-count strings (`mt-cell-decision` = 4,
   `mt-same` = 15, `mt-fill` = 5) against server-rendered markup — **if you touch that
   table's structure you rewrite those assertions with the same guarantees restated; you
   never delete them.** Best outcome: do not touch the table.
8. **Commit is a STICKY bar** whose offset clears the mobile tab bar and the safe-area
   inset. The tab bar is going away — **re-measure that offset** and say what you changed
   it to. `commitTriage` **refuses when offline** and must keep refusing; it is
   deliberately not routed through the outbox.
9. **Minutes cannot become a canvas.** It is printed, PDF'd and pasted. It carries its own
   `lang`/`dir` **independent of the UI locale** (Arabic team, English vendor) — a real
   workflow and a Wave-3 acceptance gate.

**The digest is the feature that most directly does the dirty work** — "produce last week's
status report and paste it into WhatsApp" is ~3 interactions today, and *the controls and
the live preview are visible SIMULTANEOUSLY in one column, which is what makes it 3
clicks*. Do not stack them behind a step. Preserve: the doc-language chip (1 click, no
refetch, **UI language unchanged** — `buildDigestModel` takes locale as an argument
precisely so these are independent); Markdown / plain / **HTML with `Copy formatted`**
putting real `text/html` on the clipboard behind its feature-detected silent-failure guard
plus an explicit toast; the per-section chips **with their live row counts** (the count IS
the honesty mechanism for a report going to his boss); include-notes, include-empty-tracks,
tag breakdown; save-to-file and print; and the persisted choices in
`opstrack_digest_v1` — **do not rename that key**; a weekly report is a habit and re-picking
seven toggles every week is why a tool stops getting used. Only the **range** costs a
fetch; nothing else may.

**Print.** `digest.css` and `global.css`'s `@media print` hide the page chrome today. Your
`ModeFrame` adds chrome. **Extend the print rules to hide the frame, the mode bar and the
map**, or Print emits a page of canvas. Verify by rendering, and say in your report that
you did.

**A failed closed read must stay FATAL to the digest** (`api/digestCollect.ts` returns
`fail(coverage.closedError)`), and **truncation must keep travelling into the document**
(`DigestRows.truncated` ORs `coverage.truncated` with `coverage.closedTruncated` into
`strings.truncatedNote`). Both halves matter; a degraded report understates finished work
and looks exactly like a quiet week.

**Digest strings resolve through `ds()`, not `t()`** — a new one lands in
`src/locales/{en,ar}/digest.json` at exact parity and its key must be a **literal**
somewhere `localeReach.test.ts` can see.

*Jobs you must not make slower:* reach meetings (1 tap); start a meeting and type (3 taps +
title, with track and attendees **optional**, and **two separate auto-focus effects** —
on-expand and on-arrival — both of which must survive); capture a line (0 pointer); note a
line (Shift+Enter); fix a typo (1 tap on the words themselves, whole text pre-selected);
discard/restore (1 tap each); end (2 taps); reopen (1 tap); jump to triage (1 tap, count
visible); pick up a half-triaged meeting (2 taps, **the per-meeting pending badge is the
only signal that unfinished work exists**); minutes (1 tap, then 1 per copy/print);
the digest (~3 interactions total).

*Tests you owe:* `ModeFrame.test.tsx`. Keep `meetings.test.tsx` and
`MeetingMinutes.test.tsx` passing unchanged if you can; if your framing forces a change,
restate the guarantee. Add a print-rule assertion if the harness allows one.

---

## 5. INTEGRATOR FILES — no unit may touch these

| file | what the integrator does |
|---|---|
| `src/App.tsx` | Collapse `NAV` to Map + Settings. Delete the routes for `/capture`, `/followups`, `/board`, `/tracks`, `/tracks/:id`, `/dashboard`, `/notifications`. Repoint both `/followups` redirects (`:634`, `:728`) at `/mindtree`. Keep `/entry/:id`, `/digest`, `/meetings*`, `/privacy`, `/settings*`. Wire the mobile FAB to `focusMapCapture()` **inside the tap handler** (closes task #67). |
| `src/components/CommandPalette.tsx` | Delete the rows for deleted routes; add rows for the five lenses and the two modes. Repoint the `c` bare-key at `focusMapCapture()` with the old navigate as the fallback (`:614`). |
| `src/lib/hotkeys.ts` | Only if the digit negotiation (U5) or the `c` re-binding requires it. Apply the diffs the units report; do not invent. |
| `src/lib/routeTitle.ts` (+ test) | Remove the branches for deleted routes. |
| `src/locales/index.ts` | Register the new `map` namespace (U3). |
| `src/locales/{en,ar}/route.json`, `nav.json` | `nav.json` is U1's; `route.json` is the integrator's — remove the deleted routes' titles. |
| `src/components/NotificationBell.tsx` (+ test) | Repoint "See all" at `/mindtree?lens=what-changed`. |
| `src/components/settings/NotificationsSettingsRow` (in `src/pages/Settings.tsx`) | Same repoint. **This row is the only way the inbox history is reachable on a phone** — if it is restyled away, the record is orphaned on the device the whole brief is about. |
| `src/components/FilterBar.tsx` | Facet suppression per lens (U6's status/health collision). Apply the reported diff. |
| `docs/EXECUTION-PLAN.md` §1.0.7 | Paste the nine registry lines the units report: `.mcap-*` (converts the RESERVED line), `.mlens-*`, `.mpan-*`, `.mchg-*`, `.mbr-*`, `.mbd-*`, `.mnum-*`, `.mmode-*`, and the `.mtree-list-*` amendment. Also fix the stale line 23 (`tracks.css → .tl-*`) now that both files are deleted. |
| `docs/MAP-UNFINISHED.md` | Rewrite against the new HEAD, or delete it if nothing remains unfinished. |
| `package.json`, `vite.config.ts`, `main.tsx` | Untouched. No new runtime dependency. |

The integrator also runs the full gate set and the four standing greps, and is the only one
who may resolve a conflict between two units' reported diffs.

---

## 6. RISKS, RANKED

1. **U4's delegation cockpit.** If `MapBranch` ships without multi-select + the bulk bar,
   handing 30 items to an intern goes from 3 clicks to 60. This is the single most likely
   way the run produces a prettier app that costs him keystrokes.
2. **The decomposition is UNREVIEWED.** No audit has ever run against the thirteen
   `src/pages/map/*` modules. The seams recon called entangled — the roving cursor, the
   focus reconciler, the drag controller's shared refs, `drawnEntryIds` feeding
   `openEntry`'s sibling list and `pruneMindSelection` — are exactly where a
   behaviour-preserving split is hardest and least likely to be caught by a unit test. U1
   builds directly on top of them. Budget an audit pass after integration.
3. **Test debt is the largest line item.** ~3,000 lines of correct page tests
   (`FollowUps` 890, `TrackTimeline` 720, `TracksIndex` 617, `Board` 579, `Dashboard` 502,
   `Capture` 563) must be **rewritten, not deleted**. Every critique flagged this as the
   under-estimate that killed the schedule. A unit that deletes a page test without
   restating its guarantees has removed a guarantee, and the gate will not notice.
4. **`vite build` breaks the moment U1 mounts `MapCapture`** unless U2's
   `map-capture.css` exists first. Sequence U2's sheet before U1's mount, or land U1's
   mount behind U2 in the integration order.
5. **Two focus systems on one canvas.** The map is `role="tree"` with a roving tabindex and
   a full APG walk; `ChartMark` puts `tabIndex=0` on every category. They are never on
   screen together under this contract (`numbers` replaces the map), but if that ever
   changes, Tab and Arrow will disagree about what is focused.
6. **The `shape` lens's panel and the map's collapse state.** U4 must read
   `store/mindtree`'s collapse state rather than opening a second store on
   `opstrack_tree_v1`. Two stores for one concept will disagree, visibly, within a day.
7. **The sticky commit bar's offset** (U7) is measured against a mobile tab bar that is
   being deleted. Unmeasured, the commit action on a 20-row triage table scrolls out of
   reach on a phone.
8. **Arabic RTL inside `<svg>`** has no logical properties. Any hand-written `x` arithmetic
   in U6's charts or U1's panel geometry passes in English and reverses the story in
   Arabic. `Dashboard.test.tsx:409` asserts the axis is **mirrored**, not re-labelled.
9. **Scope pins are invisible.** `useMapModel`'s `scope: 'open'`, `TracksIndex`'s
   `scope: 'open'`, and `Dashboard`'s `scope: 'all'` all live outside filter state so that
   Clear-all cannot change what a surface is about. Three units are near them. None may
   move one into `filter`.
10. **`/entry/:id` must stay a real route with `EntryOverlayHost` standing down on it.** It
    is the target of every push notification (`sw.js` `opstrack:navigate`), chat link and
    phone share sheet. `openEntry()` must continue **not** to navigate.
