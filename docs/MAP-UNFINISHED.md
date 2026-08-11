# What the map collapse has and has NOT done

Rewritten by the integrator at the commit that landed the collapse itself. The
previous version of this file said the collapse had not happened. It has. This
version says which parts are finished and gated, which are shipped but unverified,
and which are still open — so the next run does not mistake any one for another.

**Gates at this commit**, all four run from this worktree:
`npx tsc -b` clean · `npx oxlint` 0 errors (warnings unchanged in kind and roughly
in count from HEAD) · `npx vitest run` **3,413 tests pass, 120 files** ·
`npx vite build` succeeds.

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

---

## What is NOT done, or is done but unverified

### 1. The map's FILTER still does not round-trip through the URL

`useMapUrlFilter` is exported from `src/pages/map/useMapUrl.ts`, is fully
documented, and **is called by nobody**; `useMapModel` still holds
`const [filter, setFilter] = useState(EMPTY_FILTER)`. So `?q=`, `?status=` and the
rest are neither read on arrival nor written; only `?focus=`, `?dim=` and `?lens=`
mirror.

Consequences, both on killer-test rows:
- "Share a view as a link" carries the lens and the drill-in but not the filter.
- "Number → the list that acts on it" is 1 tap as promised, but the resulting URL
  is not pasteable as a drill-in — a colleague who opens it gets the attention list
  unfiltered.

The wiring belongs in `useMapModel.ts`, which no unit owned. Whoever does it must
compose `mapParamsFor` with `mapParamsForLens`, or the first keystroke strips
`?lens=`. **This is the largest single piece of unfinished product work.**

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

`BoardStage.tsx` 1,538/1,000 · `MapCapture.tsx` 1,377/1,200 · `MapList.tsx`
1,091/1,000 · `MapList.test.tsx` 990/700 · `MapCapture.test.tsx` 896/600 ·
`NumbersStage.test.tsx` 833/700 · `map-board.css` 793/600 · `map-capture.css`
711/480 · `useMapUrl.ts` 418/340 (and `useMapUrl.test.ts` 674/520,
`columns.ts` 354/320, `lens.ts` 201/180). Each unit reported its overage with
arithmetic rather than meeting the cap by deleting a test or an argued paragraph.
Reviewed and accepted; recorded here so it is a decision and not a drift.

### 9. Dead locale keys are a pre-existing condition

19 keys went dead with the collapse and were deleted in this commit, along with the
`labelSections.ts` rule prefixes that named them. **121 keys were already dead at
the previous HEAD** (`entry.*` 33, `signin.*` 13, `terminology.*` 10, …) and are
untouched: there is no dead-key gate, `localeReach` only fails on keys the source
ASKS for, and pruning them is its own job with its own risk of tripping
`labelSections`'s "no rule prefix matching nothing" case.

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
