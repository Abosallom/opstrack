# What the map can and cannot absorb — four adversarial critiques, 2026-08-11

Thirteen agents produced four rival architectures for "every non-settings feature moves into the
mind map", and four independent critics tried to kill each one against the actual source. Three
verdicts came back *salvageable*, one *fatally-flawed*. They disagreed about almost everything
except the five findings below, which every critic reached independently and evidenced with
file:line. These are constraints on any future design, not opinions about one.

## 1. The roll-up invariant forbids "follow-ups as a map axis"

`src/lib/mindtree/model.test.ts:136` walks every node and asserts
`sum(children.count) === node.count`; `:144` asserts the four health levels partition the count.
Every existing dimension is a **total partition** — `vocabGroups` has an unreachable-key fallback,
`ownerGroups` has `NO_VALUE` + `NAME_PREFIX`, `healthGroups` runs `levelOf` which always returns.

`entrySections.bucketFollowUps` is **partial by construction**: `entrySections.ts:84-127` `continue`s
past every closed entry, and an open entry that is on time, fresh, assigned and unblocked falls
through all six `if`s into no bucket at all. As a ring-2 axis the root would read 214 while its six
children sum to 31 — the thing `model.ts` itself calls the worst error a map like this can make.

## 2. Ring 1 is always track, so there is no cross-track "overdue"

`model.ts:59-61` — track "is deliberately absent [as an axis] — it is already ring 1".
`dropRules.ts:16-18` repeats it. `model.ts:719` states the consequence outright: ring 2 sits INSIDE
ring 1, so a person working across four tracks is four nodes carrying four numbers.

This is the finding that matters most for Aziz specifically. His daily question is *what is overdue
across Infra, Network, IT Ops, SRE, Dev & QA and Ayenati PMO* — one ordered list of six sections
today, globally sorted by due date. Nested under a track spine it becomes up to 36 headings with no
cross-track ordering possible. **The one screen he opens the app for gets structurally worse.**

## 3. Booting on a derived dimension kills the map's two signature gestures

`dropRules.ts:490-491` refuses any group drop when the dimension is derived; `actions.ts:330`
returns `WHY_DERIVED` from `draftRefusal`. So on a map that opens on `attention` or `health`, every
ring-2 drop is refused and "+ on any branch" answers "this ring is derived".

The ask was "more dynamic and smoothly interactive". Two designs answered it with a default view
that is the one view the map cannot be worked in.

## 4. The canvas structurally cannot hold a scrolling list

`src/pages/mindtree.css:327-339` — `.mtree-canvas { overflow: hidden; touch-action: none }`.
`src/styles/global.css:279` — "touch-action intersects down the ancestor chain"; a descendant
**cannot** re-enable `pan-y`. So swipe rows (`followups.css:203`) and any vertically scrolling
detail list are dead *inside* the canvas. HTML over SVG works only the way `NodeCard` does it:
`pointer-events: none`, non-interactive.

A list can live **beside** the canvas. It cannot live **in** it.

## 5. Dashboard and Digest need closed work; the map refuses to draw it

`Mindtree.tsx:805` — `const applied = useMemo(() => ({ ...filter, scope: 'open' }), [filter])`.
The map forces `scope: 'open'` structurally. But `aggregate.slaCompliance:437-446` counts only rows
where `status === 'done' && closed_at !== null`, and throughput is the same shape. `Dashboard.tsx`
says so in its own header: scope is forced to `all`, because half the panels are about closed work.

Hang the numbers off the drawn tree and throughput and SLA compliance come back **empty** — the two
figures Aziz reports upward.

## 6. The decomposition is not a free refactor

`src/pages/Mindtree.test.ts` (194 lines) loads `./Mindtree.tsx` through
`import.meta.glob(['./Mindtree.tsx'], { query: '?raw' })` and asserts **call sites by source
string**. Its header says every assertion names the defect it guards, and all four of those defects
(`focus.refocusTarget`, `focus.dimensionStableId`, DragLayer zones, `actions.closes`) **shipped
once already**. Splitting the file relocates every asserted call site, which is precisely the
operation most likely to silently re-open four known regressions.

Decomposition is still right. It is just not free, and the test file must be rewritten
deliberately, defect by defect, rather than re-globbed and hoped over.

## What all four critics said to build instead

Unanimous, and all of it additive:

1. **Dock a real-DOM list beside the canvas**, reusing `EntrySection` / `FollowUpRow` /
   `useSwipeActions` verbatim — before anything is deleted. One critic: the map "has been missing
   exactly one thing since the day it was built: the list." At first paint today the entire
   accessibility tree of the landing screen is a root plus N track nodes and **zero items of work**
   (`Mindtree.tsx:567` `OPEN_DEPTH = 1`, `layout.ts:439` recurses only into uncollapsed branches).
2. **Put the map's filter and focus in the URL.** `Mindtree.tsx:624` holds `FilterState` in
   `useState(EMPTY_FILTER)` with no codec, while FollowUps, Board and TracksIndex all round-trip
   through `filterToParams`. The screen admins land on is the least shareable in the app and does
   not survive a reload. `focus.ts:376` was written expecting a composition that was never built.
3. **Write `viewBox` directly in the pointermove handler.** `Mindtree.tsx:2233` currently calls
   `setPan`, re-rendering every `MindNode` on every pointer move. This is most of what "not smooth"
   actually is.
4. **Motion**: snap animation, detail tween, fly-to-node from a notification — with
   `prefers-reduced-motion` honoured.
5. **Do not delete `/followups`, `/board` or `/dashboard`** until the replacement has been used for
   a week and measured against them.

> "The honest read is that the real ask — *make it more dynamic and smoothly interactive* — is a
> request for polish and motion on a screen he likes."

That is the sentence this document exists to preserve.
