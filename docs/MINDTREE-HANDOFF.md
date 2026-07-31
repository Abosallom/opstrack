# Mindtree — handoff (2026-07-31)

Everything below is written for the orchestrator who lands this. Nothing in it has been
committed; nothing outside the spec's file list has been edited.

---

## 1. What shipped

The **Mindtree** is a hand-rolled SVG mind map at `/mindtree`, a visual sibling of `/tracks`
that answers "what is the SHAPE of my workload?" rather than "what is open?". Root
(workspace) at the inline start, ring 1 = active tracks in `sort_order` carrying their
`trackVars()` colour pair, ring 2 = a switchable and persisted dimension (status · owner ·
priority · health, reusing `useVocabAll()`'s order and its hidden options), ring 3 = entries
with a "+N more" fold. Two visual variables and no more: node area encodes count
(`sizeForCount`, √count so area is honest), and a red mark says something under this branch
has breached its SLA. Layout is a deterministic Reingold–Tilford tidy tree, mirrored once at
the end for RTL, with no force simulation and no `Math.random` anywhere. The drawing is a
`role="tree"` of `role="treeitem"` nodes with `aria-level`/`posinset`/`setsize`, a roving
tabindex and the full APG walk (Up/Down between visible nodes, Right/Left open and close and
**swap in Arabic**, Home/End, Enter to open an entry, Escape to leave a drill-in), and there
is a genuine `<table>` behind a "View as table" toggle carrying the same numbers plus a
second block the picture cannot draw at all (see §1.2). Zoom and pan are arithmetic on the
viewBox, never a CSS transform. "Copy for a deck" writes a self-contained SVG or PNG with
every custom property resolved inline, an opaque ground, and a printed caption band.

**The map opens at the track ring.** Every branch below depth 1 starts closed on a first
visit (`OPEN_DEPTH`, implemented as `MindtreeInput.openDepth`), and the fit refuses to shrink
below `24px / nodeSize.height` — the WCAG 2.5.8 target minimum — overflowing into the pan
instead. This is the single largest change from the first cut, and it is a correction rather
than a preference: opening through ring 3 fitted a six-track / 31-item workspace at **0.23**,
which put every node on the map at 10 CSS px and every label at 2.9. Measured after: the same
workspace opens at **Zoom 100%**, nodes 44–63.8 px, labels at their full 12.5. "Expand all"
on the same workspace clamps at 55% with the smallest node exactly 24.0 px and the map
panning; the zoom ceiling is an absolute 300%, not a multiple of the fit.

### 1.1 The mobile decision, honestly

**MINDTREE-SPEC's depth-limited rendering (root + tracks + the group ring) was measured and
rejected.** A five-track workspace laid out for the 341×422 canvas a 375 px phone actually
gives you comes to 464×584 drawing units at three rings; `fitToViewBox` returns 0.66, which
renders the 12.5 px label at **8.2 px**. Squeezing the node to its narrowest legible width
(108 px) only reaches 8.5 px, because what binds is three rings across the inline axis, not
the size of the boxes. At **one** ring the same workspace is 298×260, the scale is 0.96 and
the label lands at 12.0 px — full size.

So the phone shows **one ring per screen** and every tap goes one ring deeper: tracks → that
track's groups → that group's items, with a breadcrumb back and pinch/pan throughout. The
spec asked us to choose and to say so; this is the choice. It is genuinely good one-handed —
verified live at 375×812 in both languages — and it is not the design the spec sketched.
`mindtree.mobileHint` has been reworded to describe what actually happens.

One consequence worth naming: **collapse state is not applied on a phone.** With one ring
drawn there is nothing to collapse, but a branch the reader closed on a desktop is still in
the persisted set, and `layoutMindtree` honours `collapsed` as well as `depthLimit` — so
drilling into such a track used to draw the track and nothing under it, with no control on
screen able to un-blank it. `collapsedIds` and `openDepth` are both neutralised under 768 px.

### 1.2 The question the map cannot answer, answered beside it

Ring 2 is nested inside ring 1, so with `Group by = Owner` a person working across four
tracks is four nodes carrying four numbers — and "who is overloaded" is one of the three
questions the spec names. Nesting is right for the picture, so the sum is provided next to it
rather than instead of it: `groupTotals()` (pure, in `model.ts`) feeds one sentence under the
map (`mindtree.summaryGroup`) and a second small table under the big one
(`mindtree.byGroup`). `count` comes off the group nodes, so it is the same number the picture
drew; `unassigned` and `breached` are summed off the rows the big table already renders. One
arithmetic path per number. The better fix — letting the reader swap the ring order so the
dimension is ring 1 — is **not** done; see §4.

---

## 2. Exact diffs the orchestrator must apply

Five files this work was forbidden to touch. All five diffs are minimal and independent.

### 2.1 `src/locales/index.ts` — register the namespace

```diff
@@ import enMinutes from './en/minutes.json'
 import enMeeting from './en/meeting.json'
 import enMembers from './en/members.json'
+import enMindtree from './en/mindtree.json'
 import enMinutes from './en/minutes.json'
@@ import arMeeting from './ar/meeting.json'
 import arMembers from './ar/members.json'
+import arMindtree from './ar/mindtree.json'
 import arMinutes from './ar/minutes.json'
@@ export const EN_NAMESPACES
   members: enMembers,
+  mindtree: enMindtree,
   minutes: enMinutes,
@@ export const AR_NAMESPACES
   members: arMembers,
+  mindtree: arMindtree,
   minutes: arMinutes,
@@ export const en: LocaleTree = {
   ...enMembers,
+  ...enMindtree,
   ...enMinutes,
@@ export const ar: LocaleTree = {
   ...arMembers,
+  ...arMindtree,
   ...arMinutes,
```

Alphabetical between `members` and `minutes` in all six places, matching the file's own order.

> This lands **green**. `src/lib/mindtree/locale.test.ts` runs `localeReach`'s, `localeParity`'s,
> `bidi.test.ts`'s and `brand.test.ts`'s rules directly against the two JSON files, precisely
> because none of the shipped gates can see an unregistered namespace — `localeReach` skips any
> key whose root is not registered, so its assertion was vacuous here. That blindness had already
> cost two real keys (`mindtree.unknownTrack`, `mindtree.unknownGroup`, emitted by `model.ts` and
> present in neither bundle); both are now written, and the local gate keeps running after
> registration, where it is redundant with the shipped four and costs four milliseconds.

### 2.2 `src/App.tsx` — lazy import + route

```diff
@@ const Board = lazy(() => import('./pages/Board'))
 const Board = lazy(() => import('./pages/Board'))
+const Mindtree = lazy(() => import('./pages/Mindtree'))
@@ <Route path="/tracks/:id" element={<TrackTimeline />} />
               <Route path="/tracks" element={<TracksIndex />} />
+              {/* The map half of the tracks job — reached from the List | Map
+                  switcher on /tracks, not from a sixth nav destination. */}
+              <Route path="/mindtree" element={<Mindtree />} />
               <Route path="/tracks/:id" element={<TrackTimeline />} />
```

**Deliberately no `NAV` entry.** The tab bar is capped at five and a second tracks-shaped
destination would dilute both — the spec's own recommendation, and §2.4 is the alternative.

### 2.3 `src/lib/routeTitle.ts` — the header's name for the screen

The `NAV` scan cannot claim `/mindtree` (it is an exact-match lookup over destinations that
do not include it), so without this the header reads "Follow-ups" on the map. Place it with
the other out-of-nav screens that name themselves from their own namespace, **above** the
`/settings` test:

```diff
   if (pathname.startsWith('/digest')) return 'digest.title'
   if (pathname.startsWith('/notifications')) return 'notif.title'
+  // Same rule as digest/notifications: `mindtree.title` already ships in both
+  // languages and a route.mindtree twin would only ever hold the same word.
+  // Above the '/settings' test for the reason the whole file exists.
+  if (pathname.startsWith('/mindtree')) return 'mindtree.title'
   if (pathname === '/settings/tracks/new') return 'admin.tracks.add'
```

`src/lib/routeTitle.test.ts` (integrator-owned) should gain one case:
`expect(titleKeyFor('/mindtree', NAV)).toBe('mindtree.title')`.

### 2.4 `src/pages/tracks/TracksIndex.tsx` — the RECOMMENDED entry point

A **List | Map** switcher on the Tracks screen rather than a sixth nav item. Two navigating
links styled as the existing `.chip` pair, in the `.tree-bar` row that already holds the
unassigned toggle. **`aria-current="page"`, not `aria-pressed`** — these navigate rather than
toggling a state on this screen, and `aria-pressed` on an `<a>` is invalid.

```diff
@@ import { useSearchParams } from 'react-router-dom'
-import { useSearchParams } from 'react-router-dom'
+import { NavLink, useSearchParams } from 'react-router-dom'
@@       <div className="tree-bar">
       <div className="tree-bar">
+        {/* One job, two views. `/tracks` is the working list and `/mindtree`
+            is its shape; they are siblings, not a nav destination each. */}
+        <nav className="chip-row tree-views" aria-label={t('mindtree.viewSwitch')}>
+          <NavLink
+            to="/tracks"
+            end
+            className="chip"
+            aria-current={({ isActive }) => (isActive ? 'page' : undefined)}
+          >
+            {t('mindtree.viewList')}
+          </NavLink>
+          <NavLink to="/mindtree" className="chip">
+            {t('mindtree.viewMap')}
+          </NavLink>
+        </nav>
         <button
           type="button"
           className="chip tree-unassigned"
```

`react-router`'s `NavLink` already sets `aria-current="page"` on the active route by default,
so the explicit prop above is only there to make it visible at the call site; drop it if you
prefer the default. **One CSS line is needed with it**, because `global.css` styles a selected
chip off `[aria-pressed='true']` alone and a link cannot carry that attribute — add to
`src/pages/tracks/tree.css` (which owns `.tree-*`):

```css
/* A chip that NAVIGATES rather than toggling. `.chip`'s selected look is keyed
   on aria-pressed, which is a button-only attribute; a link says the same thing
   with aria-current, so the one rule is re-pointed rather than restyled. */
.tree-views .chip[aria-current='page'] {
  background: var(--accent-soft);
  border-color: var(--accent);
  color: var(--accent-ink);
}
```

(Check those three token names against `global.css`'s `.chip[aria-pressed='true']` block at
line ~836 and copy whatever it actually declares — the point is that the two states look
identical, not that these are the right variables.)

`mindtree.viewSwitch` / `viewList` / `viewMap` ship in both bundles already and are the three
keys `src/lib/mindtree/locale.test.ts` names in its `PENDING` allowlist. **Delete those three
entries from `PENDING` in the same commit** — the list exists so "unused" stays a state with
an owner rather than rot, and the test will not fail if you forget, which is exactly why it
is called out here.

The mirror-image link on the map back to the list is deliberately **not** added: `/mindtree`
already carries the app's back affordance, and a second switcher would need the same three
strings on a screen whose toolbar is already at capacity on a phone.

### 2.5 `src/lib/brand.test.ts` — the export-filename case

The Mindtree puts two more filenames in someone's Downloads folder, and the whole argument of
that file is that a filename is a user-visible string. Built through the real path, like the
others:

```diff
@@ import { buildEnvelope, exportFilename } from './export'
 import { buildEnvelope, exportFilename } from './export'
+import { mindtreeFilename } from './mindtree/export'
 import { isPluralNode } from './plural'
@@ function generatedFilenames(): string[]
-  return [exportFilename('json', at), exportFilename('csv', at), ...digests]
+  return [
+    exportFilename('json', at),
+    exportFilename('csv', at),
+    mindtreeFilename('svg', at),
+    mindtreeFilename('png', at),
+    ...digests,
+  ]
 }
@@ it('produces one name per export kind and per digest format'
-    expect(generatedFilenames()).toHaveLength(2 + 2 * DIGEST_FORMATS.length)
+    // Two data exports, two map exports, and one per digest format per locale.
+    expect(generatedFilenames()).toHaveLength(4 + 2 * DIGEST_FORMATS.length)
```

Both already satisfy the three assertions that follow (`coretrack-` prefix, no forbidden
name, `/^[a-z0-9._-]+$/`) — `src/lib/mindtree/export.test.ts` asserts the same locally so the
gate fails on the worker's machine rather than three files away.

### 2.6 `docs/EXECUTION-PLAN.md` §1.0.7 — the CSS prefix registry

Append to the "Added at the Wave-2 close" paragraph (line 24):

```diff
-…kept out of `admin.css` because it is the one part of that screen writing a second table (`track_slas`).
+…kept out of `admin.css` because it is the one part of that screen writing a second table (`track_slas`).
+
+   **Added with the Mindtree:** `mindtree.css → .mtree-*` — the map, its nodes and edges, and its
+   accessible table. **`.mtree-`, not `.mt-`:** `meetings.css` already owns `.mt-*`, and
+   MINDTREE-SPEC's own file list said `.mt-*` before catching it in the next sentence. One sheet
+   for three files (`pages/Mindtree.tsx`, `components/mindtree/MindNode.tsx` + `MindEdge.tsx`,
+   `components/mindtree/MindtreeTable.tsx`) because they exist only inside this feature and three
+   sheets would have to agree about the same six variables — §1.0.4 is the rule against that.
```

---

## 3. Findings verified, fixed, and dismissed

Every item below was reproduced in a browser before it was touched. Four of the reported
findings were duplicates of two root causes and are folded together.

### Fixed at the root

| # | What | Where | Regression test |
|---|---|---|---|
| 1 | **Default paint was an unreadable smear**, and no fit floor. Opening through ring 3 fitted a 31-item workspace at 0.23 → 10 px nodes, 2.9 px labels. Now `openDepth: 1` + `minScale = 24 / nodeSize.height`; measured 100% at first paint, 24.0 px floor at expand-all. *(Covers the four separate reports about default legibility, the desktop `minScale: 0` and MindNode's 44 px claim.)* | `model.ts` `openDepth`, `Mindtree.tsx` `OPEN_DEPTH` / `MIN_TARGET_PX` | `model.test.ts` "openDepth — the ring the map opens at" (8 cases) |
| 2 | **Zoom ceiling was a multiple of the fit**, so a large map could never be magnified to legibility. Now bounded on the EFFECTIVE scale via `zoomLimits()`, and 1 (the fit) is always reachable. Measured: 300% reached from a 55% fit. | `layout.ts` `zoomLimits`, `Mindtree.tsx` | `layout.test.ts` "zoomLimits — the bound is on what the reader can see" (5 cases) |
| 3 | **`mindtree.unknownTrack` / `unknownGroup` existed in neither bundle** — `t()` echoed the dot path as a track name, isolated, under `dir=rtl`. Written in both, plus a namespace-local gate because no shipped gate can see an unregistered namespace. | both `mindtree.json`, new `lib/mindtree/locale.test.ts` | `locale.test.ts` (17 cases) |
| 4 | **Two "+N more" folds shared one byte-identical accessible name**, which carried neither the visible label nor the count. Now `nodeName(visible label, showMore(ancestry))`. Measured: "⁨+8 more items⁩, show the rest of the work under ⁨⁨Network⁩, ⁨On track⁩⁩" vs "+3 … ⁨PMO⁩, ⁨On track⁩". | `Mindtree.tsx` `views` | live-verified; `locale.test.ts` pins the `{label}` fence on both keys |
| 5 | **9 of 15 table cell buttons collapsed into 4 names**, and the verb ("Focus on") promised the map's drill-in while performing a filter. Now `mindtree.cellFilter` = "Show only ⁨{track}⁩, ⁨{label}⁩". | `MindtreeTable.tsx` | `MindtreeTable.test.tsx` "gives no two cell buttons the same accessible name" |
| 6 | **"Copy for a deck" produced an unlabelled, undated, silently-filtered CROP.** The title/date/filters were `<title>`/`<desc>` metadata, invisible on a slide, and the export used the live (zoomed) viewBox. Now a painted caption band (product, "As of …", the shape summary, an explicit filtered line) and the whole-map fit at 1:1 (capped at 4000 px). Measured: zoomed to 156% showing a 797×356 crop, the file came out 1246×657 covering the whole map with all four caption lines. | `export.ts` `svgDocument`/`serializeMindtreeSvg`/`parseViewBox`/`captionBandHeight`, `Mindtree.tsx` | `export.test.ts` "the caption band" + "captionBandHeight" + "parseViewBox" (13 cases) |
| 7 | **The map could not answer "who is overloaded."** Now `groupTotals()` → one sentence under the map and a second table under the big one. Measured on the demo workspace: Aziz 8, Jonathan 8, Unassigned 7, ريم 7, Acme Telecom 1 — summing to the root's 31, where the map showed four separate numbers for Aziz. | `model.ts` `groupTotals`, `MindtreeTable.tsx` `buildGroupRows` | `model.test.ts` "groupTotals" (5) + `MindtreeTable.test.tsx` "buildGroupRows" (5) |
| 8 | **The filtered-to-nothing empty state was unreachable** — `tree.children.length` is never 0 once a track exists, so a no-match search left a ghost map of empty dashed cards and the "Clear the filters" button was dead code. `nothing = tree.count === 0`. | `Mindtree.tsx` | live-verified: "zzzzqqq" now renders the empty state, 0 nodes |
| 9 | **The `<details>` export panel claimed platform Escape-to-close and had none**, nor light-dismiss, while sitting over the toolbar. Escape (returning focus to the `<summary>`) and outside-`pointerdown` added; the false comment deleted. | `Mindtree.tsx` | live-verified both paths |
| 10 | **Zoom in/out announced nothing** while "Fit to view" did, and the readout is `aria-live="off"`. Announced post-clamp, through a tick counter so pressing + at the ceiling still speaks. | `Mindtree.tsx` | live-verified: role=status reads "Zoom 300%" |
| 11 | **The sr-only keyboard contract was unreferenced and still rendered in table view.** Now inside the map branch with an id, and `aria-describedby` on the `<svg role="tree">`. | `Mindtree.tsx` | live-verified in both views |
| 12 | **Switching map ↔ table announced nothing.** `mindtree.viewChanged`. | `Mindtree.tsx` | live-verified |
| 13 | **`CHAR_PX = 6.4` was calibrated against Inter, a face this app does not ship**, with an inverted claim about Arabic. Re-measured in Cairo (`600 12.5px`): Arabic 4.93–6.18 px/glyph, Latin 5.31–6.05. Now 6.2 — the top of the measured range, rounded up, because a truncation budget must be an upper bound. | `MindNode.tsx` | comment states the measurements |

### Found while fixing, not in the report

**The zoom buttons lost presses under batching.** Replacing the functional `setZoom` updater
with a value computed from the rendered zoom looked equivalent and is not: React batches every
update raised in one task, so fifteen programmatic clicks moved the readout **one** step.
Real clicks land in separate tasks and would have hidden it indefinitely. Reverted to the
functional updater; the announcement goes through a tick counter instead. `Mindtree.tsx`,
`zoomBy`.

### Dismissed, with the reason

- **Group nodes on the map share accessible names across tracks** ("⁨New⁩, 1 open" under two
  tracks — measured, 2 collisions on the demo workspace). This is correct `role="tree"`
  behaviour, not the same defect as #4 or #5: a tree conveys position through
  `aria-level`/`posinset`/`setsize` and the walk itself, exactly as a file tree holds twenty
  `index.ts` nodes. Prefixing every group with its track would add a track name to every
  arrow-key announcement — the primary interaction — to fix a secondary one. The folds and
  the table buttons were different: a fold's name had dropped its own visible label and its
  count, and a table cell is a standalone `<button>` in a list with no tree to sit in.

- **`mindtree.viewSwitch` / `viewList` / `viewMap` are unused.** Deliberate: they are §2.4's
  three strings, shipped now so that diff is one file. Named in `locale.test.ts`'s `PENDING`
  set so the dead-key gate stays honest.

---

## 4. Deliberately not done

1. **Swapping the ring order** (dimension as ring 1, track as ring 2), which is the *better*
   answer to "who is overloaded" than §1.2's table. The layout and the model are already
   generic over which bucket comes first — `groupsFor()` would need a mirror that buckets by
   track within a group, and the persisted `collapsed`/`opened` sets would need a second axis
   in their key. It is a feature, not a fix, and it is the first thing to build on this.

2. **A `noTrack` facet in `FilterState`.** The table's "show only this cell" cannot narrow the
   untracked pile, because `trackIds: []` means "every track" and there is no facet for "no
   track at all". `filterForCell` leaves the track half alone rather than silently filtering to
   nothing — the honest behaviour until the facet exists. It belongs in `lib/entryFilter.ts`,
   which this work may not edit.

3. **Pruning `mindtree.json` further.** Nineteen keys that no call site asked for were
   removed (90 remain) and the rest is now gated by a dead-key assertion. The three
   still-unused ones are §2.4's, and they are named in `PENDING` rather than tolerated.

4. **A DOM test for the export.** `vitest.config.ts` is `environment: 'node'` and jsdom is not
   in the dependency budget, so `serializeMindtreeSvg`, `svgToPngBlob` and `copyPngToClipboard`
   have no automated coverage — only the pure string builders do. The standing manual check is
   in §5.

5. **Touching `src/store/members.ts`**, where a latent crash lives: `memberLabel` does
   `byId.get(ownerId)?.displayName.trim()`, and `displayName` comes out of a `localStorage`
   cache that is parsed without validation. A cache written by an older build (or by anything
   else) with a missing `displayName` throws during render and takes the whole app down — hit
   for real while driving this feature, with `Cannot read properties of undefined (reading
   'trim')` from `store/members.ts:129`. **One-line fix for whoever owns that file:**
   `byId.get(ownerId)?.displayName?.trim()`. It is not Mindtree-specific; every screen that
   renders an owner is exposed.

6. **The map ↔ list return switcher.** See §2.4.

---

## 5. Standing manual check (needs a browser, and a human for the last one)

1. `/mindtree` at 1280 and 375, EN and AR, light and dark. First paint must read **Zoom 100%**
   with track labels at full size, and the map must mirror in Arabic (root at the inline end).
2. Expand all. The smallest node must still measure ≥ 24 CSS px; the map overflows and pans.
3. Zoom in to the ceiling: the readout must reach **300%** whatever the fit was.
4. Export SVG and PNG **while zoomed in**, and open both files outside the app, in both themes.
   The file must show the whole map, on an opaque ground, with a legible caption band; nothing
   may render black-on-black, and no label may be reordered in the Arabic export.
5. Filter to nothing: the empty state with "Clear the filters" must appear, not a ghost map.
6. With a screen reader: walk the tree with the arrows in Arabic and confirm Right/Left are
   mirrored, then toggle to the table and confirm the numbers match the picture.

---

## 6. Files this work owns

```
src/pages/Mindtree.tsx                        src/lib/mindtree/layout.ts   + layout.test.ts
src/pages/mindtree.css                        src/lib/mindtree/model.ts    + model.test.ts
src/components/mindtree/MindNode.tsx          src/lib/mindtree/export.ts   + export.test.ts
src/components/mindtree/MindEdge.tsx          src/lib/mindtree/locale.test.ts   ← added by the polish pass
src/components/mindtree/MindtreeTable.tsx  + MindtreeTable.test.tsx
src/locales/en/mindtree.json · src/locales/ar/mindtree.json
docs/MINDTREE-SPEC.md · docs/MINDTREE-HANDOFF.md
```

Gates run on those paths only, per the concurrency rule: `npx tsc -b` clean, `npx oxlint`
clean apart from five pre-existing `only-export-components` warnings on `MindtreeTable.tsx`
(its pure exports are what the test file asserts against — the file header states why), and
`npx vitest run` on the five test files above: **178 passed**. `localeReach`, `localeParity`,
`bidi` and `brand` were also run and are green, though the first three cannot yet see this
namespace — which is §2.1's whole point.

There are two git-excluded scratch files in the tree from the review pass —
`mtree-review.html` and `src/mtree-review-main.tsx` — which mount `/mindtree` against a
seeded `localStorage` with no Supabase session. They are listed in `.git/info/exclude` and
will not be committed; delete them when the feature lands.
