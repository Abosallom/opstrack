# Mindtree — spec (owner request, 2026-07-31)

> "Implement a mindtree feature to present the tasks in their tracks in a better way."

## The job it does

The existing `/tracks` list-tree answers *"what is open, and who has it?"* — a working list.
The **Mindtree** answers a different question, the one an ops lead actually asks before a steering
meeting: **"what is the SHAPE of my workload right now?"** Where is the mass, which track is
bloated, who is overloaded, what is going red — seen in one glance, without reading rows.

It is a visual sibling of `/tracks`, not a replacement. Route: **`/mindtree`**.

## Layout: horizontal mind map (deterministic, not force-directed)

```
                        ┌ New (3) ──── • Firewall rule DC2
        ┌ Network (12) ─┼ Blocked (2) ─ • MPLS circuit order
        │               └ Done (7)
CoreTrack ─ PMO (8) ────┼ …
        │
        └ Onboarding (5) ┼ …
```

- Root (workspace) at the **inline-start**, branches flowing to the **inline-end** — so RTL
  mirrors for free with logical properties and a single `dir`-aware x-transform.
- **Ring 1 = tracks** (active, in `sort_order`), each carrying its track colour via the existing
  `trackVars()` CSS-custom-property pair — never a JS colour pick.
- **Ring 2 = the group dimension**, switchable and persisted: **status** (default) · **owner** ·
  **priority** · **health**. Reuse the board's dimension vocabulary and `useVocab()` ordering and
  visibility so a hidden status stays hidden here too.
- **Ring 3 = entries** (leaves), collapsed by default beyond a threshold with a
  "+N more" node that expands.
- Node size encodes count (area, clamped); a node with any SLA-breached descendant carries the
  breach mark. No other encodings — two visual variables is the budget.
- **Deterministic layout only.** A force simulation is banned: it is untestable, non-reproducible
  between renders, and hostile to a screen reader. Tidy-tree (Reingold–Tilford style) row packing.

## Non-negotiables (house rules, restated because they bite hardest here)

- **Hand-rolled SVG. No new dependencies** — no d3, no react-flow, no charting lib.
- **Accessibility is a first-class deliverable, not a fallback.** The graph is `role="tree"` with
  `treeitem` nodes, `aria-expanded`, `aria-level`, roving tabindex; arrow keys walk it (Up/Down
  siblings, Right/Left expand/collapse — **mirrored in RTL**), Enter opens the entry, Home/End
  jump. Plus a genuine `<table>` equivalent behind a "View as table" toggle carrying the same
  numbers. A blind user must be able to answer the same question the picture answers.
- **Both themes, computed contrast.** Node fills are track colour at low alpha; label ink must
  clear 4.5:1 on the resulting composite in BOTH themes — the exact trap Wave 5 caught on `.pill`.
- **RTL equal to LTR**: the tree grows toward the inline-end, arrow-key semantics mirror, labels
  align to `start`, and Arabic labels get bidi isolates.
- Every string through `t()` in a new `mindtree` namespace, en/ar at parity with valid plural nodes.
- CSS prefix registry: **`mindtree.css → .mt-*`** (add to EXECUTION-PLAN §1.0.7 — note `meetings`
  already owns `.mt-`, so use **`.mtree-`** instead and register that).
- Respect the 1000-row clamp: the Mindtree reads the entries store, never its own unbounded query.
- `prefers-reduced-motion`: expand/collapse becomes instant, no transitions.

## Interactions

- Click/Enter a branch → expand/collapse (persisted per dimension in `localStorage`).
- Click/Enter a leaf → `openEntry(id)` — the same overlay every other screen uses.
- Shared `FilterBar` (track, owner, priority, tag, search) so a filtered mindtree is a real answer.
- **Fit / zoom**: fit-to-view, zoom in/out buttons and pinch on touch; pan by drag. Zoom is a
  viewBox transform, never a CSS scale on text (which blurs and breaks hit-testing).
- **"Copy for a deck"** — export the current view as a self-contained **SVG file** and as **PNG**
  via canvas. This is the feature an ops lead will use most: the mindtree lands in a steering deck.
  Filenames follow the brand rule: `coretrack-mindtree-<stamp>.svg|png`, gated by `brand.test.ts`.
- Empty states: a workspace with no open work says so warmly; a filtered-to-nothing view offers to
  clear the filter.

## Mobile (375px) — the hard case

A full map does not fit. At `< 768px` the Mindtree renders **depth-limited**: root + tracks + the
group ring, with counts, and tapping a group drills into a focused subtree (breadcrumb back).
Pinch-zoom and pan still work. Leaves are reachable but never rendered all at once. If this cannot
be made genuinely good one-handed, say so in the handoff — a bad mobile map is worse than a
"open this on a bigger screen" message, and that message is an acceptable outcome if it is honest.

## Files (ALL NEW — nothing existing may be edited)

```
src/pages/Mindtree.tsx
src/pages/mindtree.css                  (.mtree-*)
src/lib/mindtree/layout.ts              pure tidy-tree layout  + layout.test.ts
src/lib/mindtree/model.ts               entries+tracks+vocab -> MindNode tree + model.test.ts
src/lib/mindtree/export.ts              svg/png serialisation + export.test.ts
src/components/mindtree/MindNode.tsx    one node (branch or leaf)
src/components/mindtree/MindEdge.tsx    the connector path
src/components/mindtree/MindtreeTable.tsx  the accessible table equivalent
src/locales/en/mindtree.json · src/locales/ar/mindtree.json
docs/MINDTREE-SPEC.md                   (this file)
```

**Wiring is NOT done by this work** (a concurrent revision fleet owns those files). The final
handoff must contain an exact, minimal diff for: `src/App.tsx` (lazy import + `/mindtree` route +
`titleKeyFor` entry + a nav entry decision), `src/locales/index.ts` (register the namespace), and
`src/pages/Tracks*`/Settings for the entry point. The orchestrator applies it once the revision
loop is quiet.

## Where it lives in the product

`/tracks` (list) and `/mindtree` (map) are two views of one job. Preferred: a **view switcher** on
the Tracks screen (List | Map) rather than a sixth nav destination — the tab bar is full at five
and a second tracks-shaped nav item would dilute both. The handoff should propose the switcher
diff; the owner decides.
