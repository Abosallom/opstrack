# What the map-only work has NOT done yet

Written at the commit that landed the decomposition, the NphiesCore rename and the
App Store readiness pass. It exists because that run was **cut off partway** — the
Anthropic account hit its monthly spend limit and twelve of eighteen agents died
mid-flight, including the integrator and every auditor. Six units had already
written code. This file is the honest boundary between what is finished and what
merely exists on disk, so the next run does not mistake the second for the first.

## What IS done, gated and committed

- **`Mindtree.tsx`: 2,946 → 506 lines.** Thirteen modules under `src/pages/map/`
  (`useMapModel`, `useMapGeometry`, `useMapFocus`, `useMapCursor`, `useMapKeyboard`,
  `useMapDrag`, `useMapOverlays`, `useMapToolbar`, `useMapUrl`, `useMapViewport`,
  `useMapWrites`, `mapMotion`) and three components under `src/components/map/`
  (`MapCanvas`, `MapSummary`, `MapToolbar`). All wired, all reachable.
- **The NphiesCore rename**, including the `localStorage` namespace migration.
- **App Store readiness**: bundle id, `PrivacyInfo.xcprivacy`, launch screen, the
  generated icon set, and the privacy policy — wired on both sides of the auth gate.
- Gates at this commit: `tsc` clean · `oxlint` 0 errors · **3,281 tests pass** ·
  `vite build` succeeds.

## What is NOT done

### 1. The map is still the map. The lenses and modes were never built.

The directive was that every non-settings screen collapses into the map. **That has
not happened.** Follow-ups, Board, Tracks index, Track timeline, Entry, Capture,
Dashboard, Digest, Notifications and Meetings all still exist as their own screens,
and the nav still lists them. What this run delivered is the *decomposition that
makes the collapse possible* — the map is now a composable canvas instead of one
2,946-line file — plus two of the additive pieces below. The collapse itself is the
next run's work, and it is the larger half.

### 2. Two components are built but UNREFERENCED

`src/components/map/MapCapture.tsx` and `src/components/map/MapList.tsx` are
complete-looking and imported by nothing. They are committed rather than deleted
because they are real work, but **they are not part of the running app** and no gate
covers them.

**`MapCapture.tsx` has a broken import**: line 111 imports `./map-capture.css`,
**which does not exist**. Nothing catches this — the file is unreferenced, so the
bundler never resolves the import and `vite build` stays green. The moment anyone
wires this component in, the build breaks. Whoever does that writes the sheet first;
the ~30 `.mcap-*` classes it renders are enumerated by
`grep -ohE "mcap-[a-z-]+" src/components/map/MapCapture.tsx | sort -u`, and
`.mcap-*` is recorded as RESERVED in the prefix registry (EXECUTION-PLAN §1.0.7).

### 3. No audit ran

All five audit lenses died with the spend limit, so **nothing has been reviewed** —
not the killer test (is any job now slower?), not the phone pass, not accessibility
or Arabic, not correctness, not dead code. The gates being green means the code
compiles and its own tests pass. It does not mean the decomposition preserved
behaviour, and the seams the anatomy called out as entangled — the roving cursor,
the focus reconciler, the drag controller's shared refs — are exactly where a
behaviour-preserving split is hardest and least likely to be caught by a unit test.

Treat the decomposition as **unreviewed** until an audit has run against it.

## Defects found and fixed while stabilising this state

Recorded because each was left by an agent that died before reporting, and each was
found by a test rather than by reading:

1. **The storage rename would have destroyed the offline outbox.** The migration
   copies every `opstrack_*` key forward *and deletes the original*, but nine source
   files still hardcoded the old literal — including `store/outbox.ts`, which holds
   unsent writes. On first load after upgrade every cached store would have read
   empty and any queued offline work would have been gone. Twenty literals across
   sixteen files now use the new prefix.
2. **`mapMotion.ts`'s easing clamped `+Infinity` to 0** (`!Number.isFinite`), so
   progress meaning "already there" played the whole tween backwards.
3. **`mapMotion.test.ts` read the stylesheet through `import.meta.glob('?raw')`**,
   which returns an EMPTY STRING under vitest — every assertion in that block was
   passing vacuously against `''`. Now reads from disk, like `contrast.test.ts`.
4. **`useMapUrl.test.ts` could not test the case it claimed to.** Its harness wrote
   the URL's id straight into the store, so the store always agreed and the
   settles-differently scenario never occurred; it then re-drove from scratch, which
   models a remount rather than a store settling. The hook itself was correct.
5. An unescaped apostrophe in a test name (`'takes a caller's epsilon'`) made
   `mapMotion.test.ts` fail to parse, silently costing 56 tests.
