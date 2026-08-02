# The Mindtree becomes interactive — what shipped, what did not, and what merging it will touch

Branch `feat/mindtree-interactive`, one commit. **Not pushed, not merged.**

The brief asked for one screen read three ways — **work in it**, **explore it**, **watch it** — and
set one test for every decision: *can a week of work be redistributed from this screen, faster than
from the list?* On a desktop, yes. On a phone, partly, and §6 says exactly how far.

---

## 1. What shipped

### WORK IN IT

| Gesture | What it does |
|---|---|
| Drag a leaf onto a branch | Moves it. Mouse lifts on distance, finger lifts on a 420 ms hold. |
| Drag with several ticked | The whole selection travels, filtered to rows you may write. |
| Ctrl/Cmd + click a leaf | Ticks it. Ctrl/Cmd + Space does the same from the keyboard. |
| Right-click / Shift+F10 / ContextMenu on a node | The node's verbs: open, assign, status, priority, mark as done, ask for an update; on a branch, "add an item here", "apply the selection here", focus, collapse. |
| Long-press a leaf **where there is nowhere to drop** | Opens the same menu. This is the phone's path — see §6. |
| Space, arrows, Enter, Escape | The keyboard move. §4 is the grammar in full. |

Every drop and every menu verb goes through `store/entries.patchEntry` — the same
optimistic-write-plus-rollback path the board and the tree already use. There is no second write
path on this screen, and therefore no second rollback path. A failed write puts the row back and
the store's own `pgErrorKey` sentence says why. Closing an item, and any batch of ten or more, is
confirmed first.

### EXPLORE IT

Focus/drill-in with a breadcrumb back out, hover and focus detail cards, live filtering, group-by
across status / owner / priority / health / group, pan, pinch, zoom, fit, an accessible table view
of the same data, and SVG + PNG export. A drill-in is in the URL (`?focus=`, `?dim=`) so it can be
shared; the recipient's own preferences are not overwritten by a link that says nothing.

### WATCH IT

Realtime patches land on the map: nodes pulse on update, branches carry the count of what changed
underneath them, and staleness shifts the colours. The rule "never flash my own work back at me"
is the store's (`applyRealtimeBatch`), read rather than re-derived.

---

## 2. What this pass (SEAL) fixed, and how each is held

Every item below was reported, **verified against the code**, fixed at the root, and given a
regression test. Nothing was accepted on the report alone.

| # | Defect | Root fix | Held by |
|---|---|---|---|
| 1 | **Focus fell to `<body>` after every successful move.** A node id embeds its bucket path, so any drop rewrites the id of the row it moved; the focused `<g role="treeitem">` unmounts, and `patchEntry` commits the optimistic row *before* it awaits, so this is synchronous with the gesture. Only the roving tabindex was repaired. | `focus.refocusTarget()` — follow the row, else the nearest surviving ancestor of where it was, else the top. Requested before the write from both write paths, performed in a layout effect on the new layout. Gated so a background rebuild never steals focus. | `focus.test.ts` (5 cases on the ordering rule), `pages/Mindtree.test.ts` (call sites and ordering) |
| 2 | **Every drag outcome was announced twice** — once into the drag layer's region, once by the toast host, which is itself `aria-live="polite"`. | `ToastOptions.silent` renders the item `aria-hidden`: still drawn, still dismissible, not announced. Applied to the four `announce()`+`toast()` pairs in `commitDrop`. | `toast.test.ts` (silent hidden, ordinary toast still announceable) |
| 3 | **The keyboard drag armed its target by array index.** `candidates` is rebuilt on every tree rebuild, and a realtime patch between the arm and the Enter re-aimed the write at a different branch than the one highlighted and announced — silently dropping a status, or landing on another track entirely. | `keyRef` pins the target's **node id**; the index is resolved at use time (`armedIndexIn`). Gone from the tree ⇒ refuse with `dropRefusedTarget` rather than write to whatever moved into the slot. | `DragLayer.test.tsx` — the shift is reproduced on real `buildMindtree` + `layoutMindtree` output, then the id is shown to survive it |
| 4 | **A bulk apply could close ticked items with no dialog** below the ten-row threshold, while dragging the same rows onto the same branch asked first. `menuRunFor`'s generic arm hands the surface `outcome: null`, so `needsConfirm` could never see `closesEntry`. | `MindAction.closes`, filled by `selectionAction` from the first accepted outcome and by `write()` for the `done` verb; `needsConfirm` ORs it. `DragLayer.commitDrop`'s `plan.closes` gate and the menu's now split identically. | `actions.test.ts` (closes on a bulk onto Done, and not on an open→open move; done vs the axis verbs), `NodeMenu.test.tsx` |
| 5 | **Both of the node menu's confirmation dialogs rendered raw i18n placeholders.** `confirmFor` called `t('mindtree.confirmCloseTitle')` with no vars and `t('mindtree.confirmBulkBody', { count })` where the string's only token is `{label}` — so "Mark ⁨{title}⁩ as ⁨{label}⁩?" reached the DOM on every Mark-as-done, and the one sentence that says *where* ten-plus items are about to land did not say where. | `confirmFor(run, title, label)`, with the destination resolved by shape (the picked value, the Done option's own label, or the branch). Mirrors `DragLayer.tsx:583-591`. | `NodeMenu.test.tsx` — no `{` or `}` in either dialog, in **en and ar**, with a guard proving both bundles were really exercised |
| 6 | **No pointer gesture ticked an item at all.** `toggleMindSelected` had one call site in the whole app and it was behind Ctrl+Space, so the selection bar, the drag-many and every "…the selected items here" verb were unreachable with a mouse. | `MindNode` passes the click event; Ctrl/Cmd+click ticks a leaf. `selectHint` names the gesture in both languages. | `pages/Mindtree.test.ts`, plus the prop-type change tsc now enforces |
| 7 | **A regroup threw the reader to the top of the map.** `chooseDimension` cleared the focus to `null`; null and the surviving track prefix differ by exactly one ring, and `focus.ts`'s own header calls the wrong one out by name. | `focus.dimensionStableId()` trims to `root/track:X`. Also keeps the change silent — the fallback would have announced "that branch is no longer here" about a change the reader just asked for. | `focus.test.ts`, including a round trip through two real `buildMindtree` passes |
| 8 | **A focused view did not survive a reload.** On a cold load the store is empty for a frame, so every focus id resolved to nothing, the reconciler "repaired" it to null, and the URL effect stripped `?focus=` out of the link that had just been opened. | `store/entries.useEntriesLoadedOnce()` gates the reconciler. "None" is not "not yet", and `!loading` cannot tell them apart. | `pages/Mindtree.test.ts` |
| 9 | **Every drag on a phone was a no-op, and the gesture armed anyway.** The "nowhere to drop" guard counted the DRAWN ROOT as a zone, so on the one-ring drill-in `zones.length` was 1 rather than 0: every hold lifted a ghost, stole the pan, and announced "it is already there". | The drawn root is excluded from `zones` and from the keyboard candidates (`depth > 0`) — everything drawn is inside it by construction, so a drop on it can only ever be a no-op. The guard now fires honestly, **and the hold opens the node menu instead**. | `DragLayer.test.tsx` — a desktop drill-in still offers its groups but not its root; the compact entry ring offers nothing at all |
| 10 | **The page's live region never repeated itself.** A plain string is a React bail-out, so "you cannot move this one" said twice was said once. | `{ text, seq }`, with the rendered child keyed on `seq` — the pattern the drag layer's own region already used. | `pages/Mindtree.test.ts` |
| 11 | **Shift+F10 and Ctrl+Space stayed live under a keyboard lift**, opening the menu (and moving focus) with an unreachable drag on screen, or ticking a row the frozen carry would not carry. | `MindDragController.isLifted()` — refs, not render state, so the Tab that ends a lift still leaves. One guard in the page's `onKeyDown`. | `pages/Mindtree.test.ts` |

**One finding was answered differently from the report** — see §7.

---

## 3. Honest verdict on the phone

**Read and explore: good. Work in it: partial, and the boundary is now visible rather than fake.**

The compact map draws **one ring at a time** — a measured choice, not a shortcut. Laid out for a
375-wide canvas, three rings render the 12.5px label at 8.2px; one ring renders it at 12.0px, full
size. So the phone shows a ring, and every tap drills one deeper with the breadcrumb as the way
back. That is a genuinely good small-screen map.

It also means **the ring that shows items shows no branch beside them.** There is nothing to drop
onto, so there is no drag — and before this pass the app pretended otherwise: a 420 ms hold lifted a
ghost, took over the pan that is how that screen is read, and told the reader the item was already
where it was. That is fixed in both directions:

- the gesture no longer arms when it cannot succeed, and
- **the hold now opens the node's menu**, which is where the verbs are: assign, change status,
  change priority, mark as done, ask for an update. Same permission checks, same `patchEntry`, same
  confirmation on a close.

**What a phone still cannot do:** move an item to a different **track** (the leaf menu has no
"move to track" verb — only branch menus carry the bulk move), and **tick** items, because the
selection has no touch gesture (Ctrl+click and Ctrl+Space are both keyboard-modified). So bulk
redistribution stays a desktop act. That is the honest line, and §8 records both as deliberate.

---

## 4. The keyboard grammar, as a user needs it

**Moving around the map** (focus is on a node; Tab reaches the map, and the roving tab stop keeps
your place):

| Key | Effect |
|---|---|
| ↑ / ↓ | Previous / next node in reading order |
| → | Open a branch, or step into it. On a phone, drill into it |
| ← | Close a branch, or step out to its parent |
| Home / End | First / last node |
| Enter | Open an item; open-and-close a branch |
| Escape | Dismiss the detail card; then step out of a drill-in |
| Ctrl/Cmd + Space | Tick this item, so several travel together |
| Shift+F10 or the Menu key | Open this node's actions |

*(→ and ← mirror in Arabic: the arrow that opens a branch is always the one pointing at its
children.)*

**Moving an item** — this is a separate mode, and while it is on, the map's own keys are off:

| Key | Effect |
|---|---|
| **Space** on an item | Pick it up. If several are ticked and this is one of them, all of them travel. You start armed on the branch it is already under |
| ↑ / ↓ | Step through candidate branches in reading order |
| → / ← | Step into / out of a ring |
| Home / End | First / last candidate |
| **Enter** | Drop it there |
| **Escape** | Put it back |
| Tab | Also puts it back — focus is leaving, and a lift that outlived its element could not be finished |

Every step says the branch's name and what dropping there would do — *"Blocked, moves 3 items"*,
*"Done, closes it"*, *"it is already there"*. A refusal is spoken and shown. A drop announces once,
before the round trip settles, because the row has already moved by then.

If Space does nothing on an item, the region says why: it is not yours to move, it is already gone,
or there is nowhere to move it to from here (go back a ring first).

---

## 5. What the merge will touch

**11 files modified, 32 added.** Conflicts with `main` are predictable, and only three files are
shared with anything else.

### Modified — the conflict surface

| File | What changed | Conflict risk |
|---|---|---|
| `src/pages/Mindtree.tsx` | +1677/−280. The whole interactive surface | **High**, but only against another Mindtree change. Nothing else on `main` touches it |
| `src/pages/mindtree.css` | +216. Frame, selection bar, drill-in | Low |
| `src/components/mindtree/MindNode.tsx` | +121. Press, hover, menu, tick, and the click event | Low |
| `src/locales/{en,ar}/mindtree.json` | +82 keys (en) / same set (ar) | **Medium** — the Builder re-serialised both bundles alphabetically, so the diff looks total. No pre-existing key was lost or changed (verified key-by-key against `HEAD`). Resolve by taking this side and re-applying any key `main` added |
| `src/App.tsx` | +6: `resetMindtree()` in the sign-out chain | **Medium** — every wave edits this file. Six lines, one import, trivially re-appliable |
| `src/store/entries.ts` | +43: two narrow selectors (`useEntriesLoadedOnce`, `useEntryFlashes`). No behaviour change | Low — additive, at the end of the selector block |
| `src/components/toast.tsx` | +26: `ToastOptions.silent`, and `aria-hidden` on the item | Low — additive and opt-in; every existing caller is unchanged |
| `src/components/toast.test.ts` | +26: two cases for the above | Low |
| `docs/EXECUTION-PLAN.md` | +2: the six co-located `.mtree-` sheets registered per §1.0.4 | Low |
| `.claude/launch.json` | +13: the `mindtree-dev` entry (port 5200) | Low |

### Added — no conflict surface at all

`src/lib/mindtree/{actions,drag,dropRules,focus,pulse}.ts` + tests ·
`src/components/mindtree/{DragLayer,NodeMenu,NodeCard,QuickAdd,Breadcrumb,PulseLayer}.tsx` +
tests + six co-located sheets · `src/store/mindtree.ts` + test · `src/pages/Mindtree.test.ts` ·
`docs/MINDTREE-PRIMARY.md` · this file.

**Runtime dependencies added: none.** `git diff package.json` is empty. The SVG is hand-rolled; d3
and react-flow stay out; the layout is the existing pure deterministic tidy-tree, with no force
simulation and no `Math.random`.

### Nothing the integrator must do by hand

`src/locales/index.ts` already registers the `mindtree` namespace on both bundles, so no wiring
line is outstanding. Two test files still `Object.assign` the namespace onto the bundles
themselves; `DragLayer.test.tsx`'s comment was corrected to say that this is now belt-and-braces
rather than a missing registration. `MindtreeTable.test.tsx` carries the same stale sentence and
was left alone — it is not a file this branch owns.

---

## 6. Gate output

```
npx tsc -b        clean
npx oxlint        0 errors; warnings only react(only-export-components), which is
                  pre-existing across the repo (Board, FollowUps, Claim, glyphs,
                  TracksIndex …), plus one pre-existing exhaustive-deps in Capture.tsx
npx vitest run    114 files, 3165 tests, all passing
npx vite build    clean; Mindtree chunk 91.82 kB / 29.02 kB gzip
```

**Locale gates:** parity, reach, counted/plural and bidi suites all green. No key lost or altered
relative to `HEAD` (checked value-by-value); 82 en / 105 ar leaf keys added (the asymmetry is CLDR
plural categories — Arabic carries five where English carries two).

**The four standing greps:** physical CSS properties — none in any sheet this branch touches;
`src/lib/**` importing `store`/`api` — zero; `any` / `@ts-expect-error` as types — zero (matches
are the word "any" in prose and `OwnerFilter`'s `kind: 'any'`); hardcoded user-facing strings in
JSX — none.

**Driven live** at `http://localhost:5200/opstrack/?shell#/mindtree`, desktop and 375×812: the map
renders, no error boundary, the keyed live-region span is present, the new `selectHint` is in the
tree's `aria-describedby`, and no horizontal page scroll at 375. *(The `?shell` harness fakes a
session as a local variable and never populates the auth store's `profile`, so `meId` is null and
every drag is inert by design — `canEditEntry(entry, null, role)` is false. Driving a real drop
needs an injected profile. That limitation is the harness's, not the feature's, and it is the same
one both verifier passes recorded.)*

---

## 7. One finding answered differently

**`NodeCard` and WCAG 2.1 SC 1.4.13.** The report is right that the card fails the **Hoverable**
clause: it is `pointer-events: none` and sits 8px clear of the node, so moving the pointer toward it
fires `pointerleave` and it goes.

It was **not** made hoverable, and the header now says so instead of claiming conformance it does
not earn. The card lives on a `touch-action: none` pan-and-pinch canvas. A hoverable card either
eats the pointerdown that starts a pan, or — if it does not — covers the node, unmounts itself,
uncovers the node and re-enters it at frame rate. `node-card.css` documents that loop at the
`pointer-events` line, and it is the reason the rule is unconditional.

What makes the trade defensible: **nothing is only on the card.** Every fact in it is in the node's
own `aria-label`/`aria-describedby` sentence, in the table view, and in the entry sheet that Enter
or a tap opens. The **focus** path fully conforms — a focused card persists until focus moves and
needs no hover tunnel — so the gap is one clause, on one input, with a complete alternative one
keypress away. Dismissable and Persistent are both met.

**If this is not acceptable**, the fix is a design change, not a patch: give the card
`pointer-events: auto`, bridge the gap with a transparent hover corridor, and give the canvas a way
to reclaim a pointerdown that started over the card. That is a piece of work with its own hazards
and it should be decided, not smuggled in at a seal.

---

## 8. Deliberately not done

1. **Touch multi-select.** There is no gesture that ticks an item with a finger. Adding a "select"
   verb to the leaf menu would close the loop (long-press → Select, then long-press a branch →
   "apply the selected items here") and is one action kind, two locale strings and a `runMenu`
   case. It was left out because bulk redistribution is a desktop act and a seal is the wrong place
   to add a verb.
2. **"Move to track" from a leaf menu.** Branch menus carry the bulk move; a leaf's menu does not.
   On a desktop you drag; on a phone you cannot re-track from the map at all. Same reasoning.
3. **A rendered test for the page itself.** `vitest.config.ts` is `environment: 'node'` and jsdom is
   not in the dependency budget — every page test in this repo opens by saying so. Each page-level
   rule was extracted into a pure module and asserted there against real trees; `pages/Mindtree.test.ts`
   asserts the **call sites** by reading source, the same bargain `toast.test.ts` strikes for
   `main.tsx`. It is a weak assertion and it is stronger than the nothing that was there when the
   wiring was wrong.
4. **The confirmed-close focus hand-off is best-effort.** `components/Confirm.tsx` resolves its
   promise *before* the effect that restores focus, so the repair widens its check to the overlays
   this screen raises itself. Which of the two lands last is not deterministic; the worst case is
   Confirm's own documented fallback (`<main>`), not `<body>`.
5. **`docs/MINDTREE-PRIMARY.md` is not applied.** Making the map the app's landing view is a
   navigation decision that touches `src/App.tsx`, which this branch already edits. It is written
   up and deliberately deferred so the two changes do not collide in the one file every wave fights
   over.
6. **Nothing pushed, nothing merged, no branch switched.** One commit on `feat/mindtree-interactive`.
