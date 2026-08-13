# What the map collapse has and has NOT done

Rewritten by the integrator at the commit that landed the collapse itself, and
**amended by the gate that reconciled the post-collapse audit fixes** (this
commit). The previous version of this file said the collapse had not happened. It
has. This version says which parts are finished and gated, which are shipped but
unverified, and which are still open — so the next run does not mistake any one
for another.

**Gates at this commit**, all four run from this worktree:
`npx tsc -b` clean · `npx oxlint` exit 0, **0 errors** (warnings unchanged in kind
and roughly in count from HEAD) · `npx vitest run` **3,441 tests pass, 120 files,
0 failures** · `npm run build` succeeds.

> **THE AUDIT-FIX PASS LANDED RED AND WAS MADE GREEN HERE.** Three units fixed
> confirmed audit findings in parallel against a shared worktree. Two of them left
> the branch with two failing tests — `labelSections.test.ts > leaves no rule
> prefix matching nothing` and `mindtree/locale.test.ts > carries no string
> nothing asks for` — because the fix required editing three files outside any
> unit's ownership. The gate applied those edits (below) and re-ran everything
> from scratch. **A locale-key deletion in this repo is a THREE-file change**: the
> `en` bundle, the `ar` bundle, and `src/lib/labelSections.ts`'s curated prefix
> map. There are four locale gates, not two.

> **The `tsc` gate every brief named was VACUOUS, and this is the most important
> process note in the file.** The root `tsconfig.json` is solution-style
> (`{"files": [], "references": […]}`), so `npx tsc --noEmit` type-checks ZERO
> files and exits 0 no matter how broken the tree is. Four of the six units
> discovered this independently. **The real check is `npx tsc -b`**, which is what
> `npm run build` runs. At the previous HEAD it reported six pre-existing errors,
> so the "tsc clean" baseline in the contract was false. Those six are fixed in
> this commit (see below). Every future brief must say `tsc -b`.

---

## What IS done, gated and committed

### The collapse

Seven routes are deleted. `/capture`, `/followups`, `/board`, `/tracks`,
`/tracks/:id`, `/dashboard` and `/notifications` no longer exist; `App.tsx`'s
catch-all redirects each of them to `/mindtree`, so every old bookmark, tab and
pasted link still resolves. Their pages, their stylesheets and their test files are
gone from the tree — not orphaned in it.

Navigation is **Map + Settings**. The mobile tab bar and the capture FAB are
deleted outright, along with ~120 lines of `.tabbar*`/`.fab` CSS. The phone's
navigation is the lens chips, `MapModeBar` and the header's gear.

`/entry/:id`, `/digest`, `/meetings*`, `/privacy` and `/settings*` remain real
routes, exactly as the contract requires.

### What replaced each screen

| deleted | replacement | prefix |
|---|---|---|
| `/capture` | `MapCapture`, mounted at the map's block end at every lens | `.mcap-*` |
| `/followups` | `MapList` in the panel, `needs-me` lens (the DEFAULT) | `.mtree-list-*` |
| `/notifications` | `MapChanges` in the panel, `what-changed` lens | `.mchg-*` |
| `/board` | `BoardStage`, `by-status` lens | `.mbd-*` |
| `/dashboard` | `NumbersStage` + `NumbersPanel`, `numbers` lens | `.mnum-*` |
| `/tracks`, `/tracks/:id` | `MapBranch` + `MapBranchHistory` in the panel, `shape` lens | `.mbr-*` |

Nine CSS prefixes are registered in `docs/EXECUTION-PLAN.md` §1.0.7 and five are
retired there (`.cap-` `.fu-` `.bd-` `.tl-`/`.tree-` `.db-`). The `.mcap-*`
RESERVED placeholder is discharged.

### The six pre-existing type errors, fixed

`Member` is now re-exported from `src/store/members.ts` (three map modules asked
`store/members` for a type it only imported); `openEntry`'s `opts.list` widened to
`readonly string[]` to match the state it writes; `useMapToolbarArgs.locale`
narrowed from `string` to `Locale`.

### Verified in a browser — and this is new

Every unit reported "nothing verified in a browser". The integrator ran the dev
server against this worktree and checked, in Chrome, at 1600×900 and at 375×812,
in **both languages**:

- the rail shows exactly **Map** and **Settings**; there is no `.tabbar` and no
  `.fab` in the document;
- the lens bar renders five chips plus the Map⇄Table switch plus the two mode
  entrances, and `MapToolbar` no longer carries a duplicate View pair;
- **the phone killer test**: on a 375×812 viewport the `needs-me` panel opens at
  the `full` detent and the composer is docked below it, fully on screen, with
  nothing underneath it — `--map-composer-block-size` measured **99px** at runtime
  (the `ResizeObserver` publication works) and the sheet's block-end lands within
  0.4px of the composer's block-start;
- **RTL mirrors**: the whole sheet, the detent controls, the Everyone/Mine pair and
  the composer's Capture button all flip;
- `ModeFrame` renders on `/digest` — the "← Map › Digest" trail is on screen and is
  the way back;
- the `by-status` stage with no panel occupies the **full** 992px, so the `:has()`
  fix landed and no empty rail is reserved;
- console is clean apart from Supabase 401s, which are the fake `?shell` session.

### Two real defects found by that browser pass, and fixed

1. **The phone sheet overshot the viewport.** Each detent is a fraction of the
   viewport (`92dvh` at `full`) but the sheet is also inset from the block end by
   the composer's measured height, so at 375×812 with a 99px composer the sheet's
   block-start sat **34px above the top of the screen**, taking its rounded corner
   and part of its heading with it. `map-panel.css` now caps it:
   `max-block-size: calc(100dvh - var(--map-composer-block-size, 0px))`.
2. **`global.css`'s `--vocab-ink` recipe still named `.bd-col-title`, `.bd-rail`
   and `.bd-overflow-label`** — `pages/board.css`'s class names. Left alone it
   would have silently stopped applying and every board column title, collapsed
   rail and overflow label would have fallen back to `--text-dim`. Repointed at
   `.mbd-*`. No gate could have seen this.

### Numbers that were measured against a deleted structure, and re-measured

- `.mcap`'s `--mcap-dock-inset`: `calc(53px + safe-area)` → `env(safe-area-inset-bottom)`.
  53px was the tab bar's row plus its border. The phone gets 53px of canvas back.
- `.main-content` mobile `padding-block-end`: `84px` → `calc(20px + safe-area)`.
- `.mt-commit-bar` (`meetings.css`, contract risk 7): `calc(72px + safe-area)` →
  `calc(12px + safe-area)`. **Reasoned and applied, NOT measured on a 375px
  viewport with a 20-row triage table** — see below.
- `.toast-host` mobile offset **kept** at 138px, with its comment rewritten: it was
  measured against the tab bar + FAB and now clears the composer's tallest
  documented state instead. Deliberately unchanged.

### The post-collapse audit fixes, reconciled and gated

Landed in this commit on top of the collapse. Grouped by what the audit confirmed.

**The filter in the URL** — section 1 above. The largest item; now closed.

**The `c` hotkey stopped navigating off the map.** The collapse shipped
`focusMapCapture()` without the fallback MAP-CONTRACT §1040 asked for, so on every
mode route (`/meetings*`, `/digest`) and everything under `/settings` the key was a
silent no-op: `focusMapCapture()` answers `false` when the bar is not mounted and
the answer was discarded. Now `if (!focusMapCapture()) navigate(MAP_PATH)`. oxlint
had been saying so out loud at HEAD — `useCallback has unnecessary dependency:
navigate` — and that warning is gone with the fix. It navigates to `/mindtree`
BARE: a URL with no lens means "keep the persisted one", and somebody who pressed
`c` asked for the box, not for a different view of their workspace.

**The palette silently withheld the entire admin block.** `GROUP_CAP.screens`
counted two of the three tables `screenCandidates` returns, so on a blank query an
admin's 19 rows were sliced to 14 and the 5 that fell off the end were Groups,
Tracks, Vocabulary, Terminology and Members. The existing test asserted the broken
number under the title "the cap must not bite a fixed set". Fixed, and the test
rewritten to count off the builder. **This was unassigned scope** — found while
fixing something else, correct and proven by a negative control, but nobody
commissioned it. Treat it as its own change when reviewing.

**44px touch targets on the lens and detent chips, with arithmetic instead of
assertion.** `.tap-44`'s overlay is positioned against the PADDING box, so a 1px
border eats 2px of it: the 30px chips were 42px targets, and inside
`.mlens-scroller` — an `overflow-x: auto` container, which clips at its padding
edge, and clipped area is not hit-tested — 4px of block padding cut them to 38px.
Chips are now 32px (30px padding box + 14 = 44 exactly, the number `.btn-sm` and
`.chip` already carry) and the scroller pads 8px. `.mpan-grab` stays 30px and is
NOT an inconsistency: it has `border: none`, so its border box IS its padding box.

**Dead locale keys and their curated prefixes.** `chooseView` was the one genuinely
dead export in `useMapToolbar.ts` (the audit said four; the other three are all
called from `MapToolbar.tsx`). Deleting it orphaned `mindtree.viewChanged`, and the
collapse's 8 dead `tree.*` keys orphaned 5 prefixes in `labelSections.ts`. All
three files are updated here. The audit's "14 keys / 28 strings" was a
substring-matching artefact — `tree.expandAll` is a substring of
`mindtree.expandAll` — and a quote-anchored match gives 8.

**Unstyled class names.** 8 of the 9 authored `.mbr-*`/`.mbd-*` names with no
matching rule are removed. The 9th and its twin are KEPT ON PURPOSE and both are
now commented as such: `.mbr-history` and `.mbr-work` are IDENTITIES, not styles —
`MapBranch.test.tsx` slices the rendered document at the literal `mbr-band
mbr-history` to test the history band apart from the work band. A naive "delete
every class with no rule" sweep would break a passing test, which is why the
comment exists. A repo-wide sweep at this commit finds exactly those two and
nothing else.

**The Arabic day-heading exemption survived the page it came from.** The deleted
`/notifications` page carried `[lang='ar'] .notif-group-head { letter-spacing: 0;
text-transform: none }` — Arabic letters JOIN, and 0.02em tracking prises those
joins into broken type, while `uppercase` is a no-op there anyway. The rule is
transplanted onto `.mchg-group-head` in `map-changes.css`, its own prefix, and
`MapChanges.test.tsx` pins the class.

---

## What is NOT done, or is done but unverified

### 1. ~~The map's FILTER still does not round-trip through the URL~~ — **DONE**

**Fixed and gated in this commit.** `pages/Mindtree.tsx` calls `useMapUrlFilter()`
(before `useMapModel`, which has no effect of its own, so it reorders no hooks),
and `useMapModel(compact, locale, filter)` now takes the filter **as a parameter**.
Its `useState(EMPTY_FILTER)` is deleted, as are the `filter`/`setFilter` it used to
return.

**There is exactly one source of filter truth, and it is the address bar.**
Verified by reading, not by report: `filter` is two pure memos over
`useSearchParams`' params (`mapFilterKey` → `mapFilterFromParams`) and `setFilter`
writes params with `{ replace: true }`. No `useState` anywhere in the map path
holds a `FilterState`. Every other `FilterState` in `src/components/map/*` is a
DERIVED memo off that one value (`applied`, `scoped`, `bandFilter`), not a second
store. Both killer-test rows now hold: a filtered map is pasteable, and the
number → list jump survives its own URL write.

Two things worth knowing about the shape of the fix:

- **The intermediate "bridge" is gone.** While `useMapModel` was owned by another
  unit, the shell kept its `useState` copy in step with a render-phase adjustment
  (`if (model.filter !== filter) model.setFilter(filter)`). That was correct but
  was a second copy of one value. Both halves are deleted.
- **The filter memo is keyed on FACETS, not on `params`.** `mapFilterKey` is what
  makes that safe. Keying on `params` would mint a new `FilterState` on every
  `?focus=`, `?dim=`, `?lens=` and `?stage=` write and re-run `buildMindtree` over
  the whole working set for a byte-identical tree.
- **The inbound effect now runs on every keystroke**, and everything it does to
  the store is idempotent — `updatePrefs` returns the same object when nothing
  moved, `focusBranch` is two no-ops when already true. The one non-idempotent
  thing it can do is open the panel, which the `arrived` ref guards. **Anyone
  adding a fourth inbound write to that effect must re-check this property.**

### 1a. RESIDUAL: a lens link to the URL you are already on does nothing

**Open, and it is the one behavioural gap this pass leaves.** `NotificationBell`'s
"See all" (`/mindtree?lens=what-changed`) and `CommandPalette`'s five lens rows
navigate to a URL that, when the reader is ALREADY on that lens with no other
params, is byte-identical to the current one. `location.search` therefore does not
change, `useSearchParams` returns the same memoised object, and the inbound effect
— correctly keyed on `[params]` — does not re-run. **The panel stays shut and the
tap looks broken.**

It cannot be closed from inside `useMapUrl` without re-running that effect on every
replace, which would undo the idempotence property above. The fix belongs at the
CALLER: `setMindPanelOpen(true)` beside the `navigate`, guarded by the same
condition the effect uses — `mapLensOpensPanel(lens, focusId)`, which is already
exported — so a lens with nothing to show does not open an empty panel.

**Deliberately not written by this gate.** It needs store reads added to two shared
components (`NotificationBell.tsx`, `CommandPalette.tsx`) that no unit owned, which
is new design rather than reconciliation, and the failure mode of getting the guard
wrong is user-visible with no browser here to check it against. Small, well
understood, and should be its own change.

### 1b. The phone sheet no longer covers the shell — but the lens chips are reachable only BY SCROLLING

**Improved, not closed. Read this before believing the chips are reachable at
every detent.**

The defect was real: `.mpan[data-sheet]` is `position: fixed` at z-index 70 and the
sticky app header is 60, so a `full` detent painted straight over the header, the
five lens chips, the stage switch and the two mode entrances. A non-modal sheet
that leaves no live pixel is a modal sheet with extra steps — opening the attention
list took away every way to change what you were looking at except the sheet's own
three detent buttons.

The fix subtracts a second term from the sheet's cap:
`max-block-size: calc(100dvh - var(--map-composer-block-size) - var(--map-shell-chrome-block-size))`,
where the new variable is published by `pages/mindtree.css` as the measured header
plus 64px (8px clearance + a 48px lens row + 8px clearance). `--app-header-block-size`
is a real token from `app-shell.css`, so this grows on a notched phone.

**What it guarantees:** the header is never covered, and a live, scrollable,
tappable strip of the page survives at every detent.

**What it does NOT guarantee, and this is the honest limit:** the lens chips are
not necessarily IN that strip. `.mtree-shellbar` is the THIRD block in the page's
flow — the title and the FilterBar come first — so the chips are in the window only
at the scroll positions where they happen to be. A reader with the page scrolled to
the top sees title/filter in the strip, not chips, and must scroll the page under
the sheet to reach them. Pinning the shellbar sticky under the header would close
this and was rejected with a stated reason: `.offline-region` is already sticky at
exactly that offset at z-index 65, so a sticky shellbar hides behind the offline
banner, and it would cost ~110px of every phone map screen when no sheet is open at
all.

**Unverified in a browser.** All of the above is read off the stylesheets and the
computed arithmetic. The numbers (65px header, 375×812) are the ones the unit
measured before the collapse; no screenshot was taken at this commit.

### 2. The mobile-web software keyboard is applied but UNVERIFIED

`index.html` now carries `interactive-widget=resizes-content`. Without it, Chrome
Android leaves a `position: fixed` block-end bar behind the software keyboard and
the whole phone-capture story fails on the web build. **This was not tested on a
device or in a mobile browser** — the browser pass above was a desktop Chrome with
an emulated viewport, which does not raise a software keyboard. The Capacitor iOS
app is unaffected either way (`capacitor.config.json` sets
`Keyboard.resize: "native"`).

### 3. Nothing was checked against real data, or a real session

The browser pass ran on the `?shell` dev harness: a faked session, zero tracks,
zero entries. Every surface was verified as CHROME and LAYOUT, not as behaviour
over rows. Specifically still unproven:

- `BoardStage`'s `loadClosedSince(today − 14)` mount effect (U5's hardest
  requirement, verified by code reading only), and the four drag move paths;
- the drag Escape change from `window` bubble to `document` capture;
- that a tap on a numbers tile re-lenses the shell AND applies the filter;
- `MapChanges`'s mark-done / undo / snooze / take / assign / quick-post handlers —
  all asserted through exported pure functions or against source text, never
  through a real click;
- `@container` behaviour on `.mnum-grid` as the panel opens and closes;
- print preview on `/digest` and `/meetings/:id/minutes`, in both languages.

### 4. `.mt-commit-bar`'s new offset is reasoned, not measured

Contract risk 7 names the exact scenario — a 20-row triage table on a 375px
viewport — and that scenario was not run. The number is defensible (nothing is
docked at the block end on a mode route any more) but it is not evidence.

### 5. vitest still cannot read a stylesheet, so no sheet asserts its own text

`vitest.config.ts` leaves `test.css` at its default of `false`, which replaces every
`.css` import with an empty module — and `?raw` does NOT escape it, because the
interception matches the extension before the query. Three units hit this
independently, and one of them nearly shipped an assertion that passed vacuously
against `''`. `test: { css: true }` would close it; the integrator did **not** turn
it on, because it changes what every existing suite loads and that is a change
worth making on its own with its own gate run. Until then the sheets are covered by
the §T2 grep, by review, and by the browser pass above — and by nothing else.

The one exception: `src/styles/contrast.test.ts` reads CSS through `node:fs`
(deliberately, with its reasoning in its header) and now measures
`components/map/map-list.css`'s row actions plus `.btn-ghost`'s resting and hover
inks, which is where the collapse moved that guarantee.

### 6. Escape ordering has one known wrong case

With focus inside the map's `<svg>` AND a drill-in active, `useMapKeyboard`'s React
handler clears the drill-in before `overlayStack` can close the phone sheet — level
5 before level 4 of the order written into `MapPanel.tsx`'s header. Practical
exposure is nil (the sheet is a sub-768px surface; a treeitem only holds focus
there with a hardware keyboard). The fix is in `pages/map/useMapKeyboard.ts`.

Separately, `MapCapture`'s Escape consumes the key even when the box is empty
(it blurs the field rather than falling through to the sheet). That is deliberate,
argued in the component header, and pinned by a test.

### 7. The panel's non-modality is not enforced, and must not be

Nothing marks the shell `inert` while the phone sheet is open — the map behind it
has to stay readable. A keyboard user on a phone can therefore Tab from the sheet
into the map behind it. Deliberate, and untested.

### 8. Line-count caps in the contract are exceeded in nine files

Measured at THIS commit, so the numbers are current rather than inherited:
`BoardStage.tsx` 1,538/1,000 · `MapCapture.tsx` 1,385/1,200 · `MapList.tsx`
1,091/1,000 · `CommandPalette.tsx` 1,093 · `useMapUrl.test.ts` **1,056/520** ·
`CommandPalette.test.tsx` 966 · `MapList.test.tsx` 990/700 · `MapCapture.test.tsx`
896/600 · `NumbersStage.test.tsx` 833/700 · `map-board.css` 793/600 ·
`pages/Mindtree.tsx` **783/760** · `map-capture.css` 711/480 · `useMapUrl.ts`
**608/340** (and `columns.ts` 354/320, `lens.ts` 201/180).

**Three of these got worse in the audit-fix pass and none were shrunk**:
`useMapUrl.ts` 418 → 608, `useMapUrl.test.ts` 674 → 1,056, `Mindtree.tsx` 805 → 783
(this one improved, by deleting the bridge). Each unit reported its overage with
arithmetic rather than meeting the cap by deleting a test or an argued paragraph.
Reviewed and accepted; recorded here so it is a decision and not a drift.
`useMapUrl.ts` at 1.8× its cap is the first candidate if a split pass is
commissioned.

### 8a. `mapLensMirror`'s signature was WIDENED, which the contract did not allow

The contract says `useMapUrl`'s exports are "ADDITIVE only, existing signatures
unchanged". `mapLensMirror`'s third parameter went from `MapUrlLens | null` to
`MapLensClaim | null` (stage nullable). Every existing caller still typechecks —
this is a widening, and HEAD's original test file compiles and passes against the
new source — but it IS a signature edit and it happened. Recorded so it is not
discovered later as a surprise.

### 9. Dead locale keys are a pre-existing condition

19 keys went dead with the collapse and were deleted in this commit, along with the
`labelSections.ts` rule prefixes that named them. **121 keys were already dead at
the previous HEAD** (`entry.*` 33, `signin.*` 13, `terminology.*` 10, …) and are
untouched: `localeReach` only fails on keys the source ASKS for, and pruning them is
its own job with its own risk of tripping `labelSections`'s "no rule prefix matching
nothing" case.

**Correction to the sentence above, which said "there is no dead-key gate": THERE
ARE FOUR LOCALE GATES, NOT TWO, and two of them are dead-key gates.** This is what
made the audit-fix pass land red.

| gate | fails on |
|---|---|
| `src/lib/localeParity.test.ts` | `en` and `ar` key sets diverging |
| `src/lib/localeReach.test.ts` | a key the source asks for that does not ship |
| `src/lib/mindtree/locale.test.ts` — "carries no string nothing asks for" | a `mindtree.*` key **nothing asks for** (the inverse of reach) |
| `src/lib/labelSections.test.ts` — "leaves no rule prefix matching nothing" | a `NAMESPACE_PLACEMENT` prefix no surviving key starts with |

So **deleting a call site in the `mindtree` namespace is a three-file change**: the
`en` bundle, the `ar` bundle, and `labelSections.ts`. The 121 pre-existing dead keys
are outside `mindtree.*`, which is the only namespace the third gate covers — that
is why they have never failed anything.

Likewise nine class rules in `global.css`/`app-shell.css` are referenced by nothing
(`admin-row-*`, `is-archived`, `skeleton-line`, `skeleton-row`, `update-body`,
`nav-badge`, `nav-section`). All nine were already orphaned at the previous HEAD;
this commit introduced no new ones and removed one (`tab-badge`).

### 10. The decomposition underneath is still UNREVIEWED

Contract risk 2 stands unchanged: no audit has ever run against the thirteen
`src/pages/map/*` modules. The seams recon called entangled — the roving cursor,
the focus reconciler, the drag controller's shared refs, `drawnEntryIds` feeding
`openEntry`'s sibling list, `pruneMindSelection` — are exactly where a
behaviour-preserving split is hardest and least likely to be caught by a unit test,
and the whole shell now sits on top of them. Budget an audit pass.

---

### 11. NOTHING IN THE AUDIT-FIX PASS WAS SEEN IN A BROWSER

vitest runs `environment: 'node'` and there is no jsdom in the dependency budget, so
every claim in this commit is a pure-function assertion, a `drive()` replay of the
effect schedule, or a `renderToStaticMarkup` convergence check. **Specifically
unverified by eye:**

1. That the panel visibly opens on `/mindtree?lens=what-changed`.
2. That the ledger visibly survives `/mindtree?lens=needs-me`.
3. That a filter keystroke leaves a pasteable address bar.
4. That `/mindtree?lens=shape&focus=root/track:<uuid>` draws the focused branch with
   its panel open. Asserted piecewise — the id matches `buildMindtree`'s node,
   `viewFromParams` accepts it, `subjectForLens` returns a branch subject — but never
   once as a whole.
5. The Arabic day headings in the `what-changed` panel with the transplanted
   exemption.
6. `role="group"` on `.mcap-read` announcing the composer's chip strip to a screen
   reader. The ARIA rule is unambiguous; the fix is unobserved.
7. Every 44px and sheet-cap number above.

All are asserted at the decision level and driven end to end in `drive()`, which is
the strongest proof this repo can give without adding a dependency. **A browser pass
over these seven is the highest-value next thing after the `1a` residual.**

### 12. The attention chip and the narrowed list can disagree, and nothing reconciles them

Not a regression and not introduced here, but the `1` fix makes the path more
reachable, so it is worth a decision. A persisted drill-in narrowing the `needs-me`
panel **is** handled — `MapList.tsx` renders an unconditional `.mtree-list-scope`
block with `role="status"` reading "Only ⁨Network⁩" when scoped, plus a one-tap
"Show every track" clear, and both are tested. But `useAttentionCount` is global and
never scoped (deliberately, with its reasoning in place), so the chip can read "12"
while the narrowed list under it shows 3. Each number is honest on its own; nothing
on screen tells the reader why they differ. Worth an owner decision rather than a
silent fix.

### 13. Suggested: extend MapCapture's class-registry gate to its neighbours

`MapCapture.test.tsx` asserts "renders no `.mcap-` name the sheet was not written
against" — it diffs the component's authored class names against the stylesheet's
selectors. **That gate is the entire reason MapCapture had zero orphaned classes
while MapBranch/MapBranchHistory/BoardStage had nine.** Extending the same cheap
check to the `.mbr-*` and `.mbd-*` prefixes would make this class of drift
impossible to reintroduce. It would need an allow-list of the two deliberate
identities (`.mbr-work`, `.mbr-history`).

Also still orphaned and deliberately untouched, as pre-existing and outside the
collapse: `cht-axis`, `cht-cats`, `cht-legend-label` (`charts/`) and `ops-spinner`,
`ops-spinner-dot` (`shared.tsx`). Nobody has checked whether these are genuine
orphans or SVG/JS hooks.

---

## A process note for the next parallel run

Three units ran in parallel against **one shared worktree**. Two things went wrong
and both are cheap to avoid:

1. **A unit ran `git stash` / `git stash pop` on the shared tree** (~2s) to check
   whether two failing tests pre-dated its change. That reverted and restored ALL
   units' work. The pop reported no conflict and this gate has verified by reading
   that every unit's claimed change is present and coherent — the palette's
   `GROUP_CAP` fix, the `c` fallback, the `useMapUrl` filter wiring, the locale
   deletions — and the suite is green. Nothing was lost. **But `git stash` on a
   shared worktree is never safe.** Use a detached `git worktree` for isolation
   checks, which is what that unit switched to.
2. **Two units left the branch RED** because the fix crossed an ownership boundary.
   That is the ownership rule working as designed, but it means **the gate must
   always be the one to run the suite from scratch** — a unit reporting "green
   except for two failures that are not mine" is reporting an unshippable branch.

---

## Open items carried forward, unchanged by this run

- **`/opstrack/` Pages base path.** The move to `/nphiescore/` is queued as separate
  work and was deliberately not attempted here.
- **`src/lib/capture/confirm.ts`.** The contract asked for `confirmationFor()` to be
  promoted out of the two copies in `pages/Capture.tsx` and `MapCapture.tsx`.
  Deleting `/capture` removed the duplication on its own, so the promotion became
  optional and was not done. `confirmationFor` and `CaptureConfirmation` are
  exported from `MapCapture.tsx`, where their ten R2-PRODUCT-2 assertions live.
- **Open task #67 (the FAB must focus the capture field inside the tap)** is closed
  by deletion rather than by wiring: the FAB is gone and the composer's input is
  itself the one-tap target, mounted on the landing route. The `c` hotkey and the
  palette now call `focusMapCapture()` with no navigation at all.

---

# Wave 8 — seam fixes, the importer's three columns, and one dead unit

Appended by the wave-8 gate. Wave 8 shipped as **two** units where the plan
scheduled three; the third never delivered, and the paragraph below is its
journal rather than a footnote, because two other units' work assumed it.

**Gates at this commit**, all run from this worktree:
`npx tsc -b` clean · `npx oxlint` exit 0, **0 errors** (101 warnings, all
`react(only-export-components)` and one pre-existing `exhaustive-deps` in
`MapCapture.tsx` — unchanged in kind from HEAD) · `npx vitest run`
**5,093 pass, 1 todo, 153 files, 0 failures** · `npm run build` succeeds ·
the render gate **22 pass across 5 fixtures, floors untouched** ·
`node scripts/lookat.mjs` regenerated (see below).

## THE DEAD UNIT: `w8-demo` — the 400-organization demo CSV was never generated

The plan's wave 8 says "400-org demo CSV generated, dry-run, applied (Aziz
watching), old 22-node demo undone via its manifest". **None of that happened.**
No handoff came back for that unit and `docs/templates/structure.demo.csv` was
untouched in the working tree. What the file holds today is still the ORIGINAL
demo: 21 data rows — 1 Programme, 4 Phases, **16 Organizations** — across 2
account managers and 4 vendors, with every `stage`, `target_date` and `target`
cell blank. It is not the ~400-organization portfolio with the brief's
distributions, and nothing in this commit pretends it is.

Two consequences, both real:

1. **`w8-importer` shipped 23 red tests that were not its fault.** Its suite
   asserts that all three templates carry a byte-identical header, and the demo
   file was three columns short. The gate applied that unit's integrator diff
   itself — `stage,target_date,target` spliced in at positions **8/9/10**, empty
   on every data row, BOM and LF preserved — and the suite went green. That is
   the only edit made to the demo file. The importer's tests assert nothing
   about demo stage/goal CONTENT, so blank cells are sufficient and, with 0026
   unapplied, are also the only safe cells (see below).
2. **The wave's live half is still owed.** The re-import, the undo of the 22-node
   run through its v1 manifest, and Aziz's watching sitting are all still ahead.

## The live workspace has NOT had 0026/0027/0028 run against it

Confirmed by a read-only dry run at this commit, and the importer says so by
name rather than by a Postgres error code:

```
stages: 0026 HAS NOT BEEN RUN HERE — the `stage` column can do nothing yet
        (docs/RUN-0026-0027-0028.md)
```

A file that actually NAMES a stage is refused wholesale, before a single row is
read, with `[stage_tables_missing]` — verified against the live project by
dry-running a copy of the demo with one `Integrating` cell in it. No `42P01`
reaches an owner. **So the demo re-import must either use a stage-free file or
wait for the sitting**; a stage-bearing demo applied first would be refused, not
half-applied.

## Residual defects found by the gate, not by a unit

**The archive announcement's `stays` clause was still false for a third shape.**
Wave 8 fixed Fable #3 (the copy claimed a populated archived branch leaves the
map, which `model.ts:1910` contradicts) and Fable #10 (`usage` populated and read
by nothing). Both guards choose between `branchArchivedGone` and
`branchArchivedStays` on the DIRECT counts — and `usage.children > 0` does not
imply the branch survives: 0023's cascade archives every descendant and the
model then drops each EMPTY archived one bottom-up, so an Organization with three
departments and no work anywhere under it leaves the map exactly as an empty one
does. `branchArchivedStays` said "until the work beneath it moves or closes",
which is a promise about a branch that is no longer there. Both bundles now carry
the condition instead ("for as long as open work is filed beneath it" / "ما دام
تحته عمل مفتوح"), and `NodeMenu.test.tsx` pins the third shape by running
`buildMindtree` on it. The assertion was proven to fail against the old string
before the fix was kept.

## The four integrator diffs the gate applied

1. **`useMapUrl.ts` — the grouping choice now survives a reload (budget E9).**
   `?by=` is spelled ALWAYS, `?risk=` still is not, and `mapPortfolioChosen`
   reports whether it was spelled. `Mindtree.tsx`'s `canvasBy` reads
   `chosen || groupingChosen`. **The diff as handed over would have shipped a
   regression** and this is worth remembering: `mapParamsForFilterWrite` round-
   trips the portfolio through a TOTAL reader, so always-spelling would have made
   one character typed into the search box write `by=stage` and drop 400
   organizations into stage rings nobody asked for. The keystroke writer now
   carries the raw pair (`carryPortfolioParams`), the setter takes a required
   `chose` boolean so a risk toggle cannot invent a grouping, and both hazards
   have their own named test.
2. **`mind-ring.css`** — match arc over the worst 16% node fill, `3.15 / 9.39` →
   `3.24 / 9.41`, and the paragraph deferring the correction is gone.
3. **`map-altitude.css`** — thumb on its own track `1.38 / 3.73` → `1.42 / 3.74`,
   thumb on the plate `5.20 / 13.62` → `5.34 / 13.65`.
4. **`global.css` + `BRAND-NPHIES.md`** — the `<0.15 drift` claim is narrowed to
   what it actually covers. Holding the accent's luminance protects a ratio
   measured against a FIXED surface; it protects nothing measured against a
   `color-mix` of the accent's own hue with a track colour an admin types in,
   which is why four such rows drifted 0.68–4.30 and one of them certified a
   2.61:1 focus indicator as passing 3:1.

**All four contrast figures were re-derived a third time by the gate**, from
`global.css`'s hexes alone, with an independent implementation of the sweep
(140,608 hues, gamma-encoded channel-wise blend): `1.42 / 3.74`, `5.34 / 13.65`,
`3.24 / 9.41`, `2.61 / 8.07`. Every one reproduces to the digit. The worst hue is
`rgb(255,255,255)` dark and `rgb(0,0,0)` light, which is the near-white track the
sheets' prose names.

## The committed SVG snapshots changed, and the change is CSS only

`public/__lookat/*.svg` gained 120 lines and lost none. Every added line is part
of the new hover-suppression rule (`svg:has(.mtree-drag-overlay) …`) that
`mindtree.css` grew this wave and that the snapshots inline. **No geometry moved**
— the render gate's numbers are identical. Eyeballed: the ungrouped 400-org
opening frames `am:1` (Sara Al-Otaibi's own book) with her six organization-type
rings at 10.7px minimum text, which is the picture the canvas default was changed
to produce; the grouped opening still frames the whole programme with seven stage
chips.

## Still owed after this commit

- **The 400-organization demo file** and everything downstream of it.
- **A browser look at the hover-suppression rule.** `svg:has(.mtree-drag-overlay)`
  is asserted by arithmetic and by DOM structure; the suite is `environment:
  'node'` and evaluates no selector. Tab to a node under the pointer, then start
  a drag: the card's tint must stay at its resting 16% in both.
- **The undo's delete path, live.** `deleteNodeProgress` is proven at the
  request-shape level against a recording fake, both branches. The round trip
  against `map_node_progress` needs 0026 applied and one real tap: set a
  first-ever stage on an organization, press Undo, then confirm in SQL that the
  ROW IS GONE rather than holding a null `stage_id` with a stamped `updated_by`.
- **`src/store/config.ts`'s missing `retractNodeProgress`.** `PortfolioStage`'s
  retraction falls back to `invalidateConfig()` because the store has a publisher
  and no retractor. Documented in that file's header; optional, and not done.
