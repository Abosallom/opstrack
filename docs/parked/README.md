# Parked code

Modules that were written but are not wired into the app. They are here rather
than in `src/` for one reason: an unreferenced module under `src/` reads to the
next reviewer as a description of live behaviour, and its header is then a lie
about what the app does. Nothing in this directory is compiled, linted or
tested.

## `virtual.ts` — list windowing

Written during Wave 4 as the mitigation for long-list render cost on
`/tracks` (the distribution tree) and `/followups`. It has **no importer and no
test**, so none of it has ever run.

The arithmetic is sound on inspection — for a uniform stride `S = rowHeight +
gap`, a windowed list plus its two spacers totals `N*S - gap`, identical to the
unwindowed list, so `padFor()` preserves scroll height and the scrollbar, Back
restoration and `scrollIntoView` all keep working. The segment plan (rather than
a single range) is what keeps a focused row mounted so tab order is not thrown
back to the document top.

**What adoption still owes**, and why it was not done in a fix pass: the two
screens named above both carry interaction state that windowing changes the
meaning of — keyboard roving focus, shift-range selection across rows that are
no longer mounted, and scroll restoration on navigating back from an entry
sheet. Those are page-level behaviours, and none of them is exercised by a test
today. Adopting this module is a sitting of its own, in `src/pages/TracksIndex.tsx`
and `src/pages/FollowUps.tsx`, with tests for each of the three.

To bring it back: move the file to `src/lib/virtual.ts`, add `src/lib/virtual.test.ts`
covering `planWindow`, `padFor` and `pitchOf`, then wire `useVirtualRows` into one
screen at a time.
