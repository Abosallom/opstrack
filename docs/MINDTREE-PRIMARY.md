# The Mindtree becomes the main view (owner directive, 2026-08-01)

> "make it the main thing"

Said while the interactive build was starting. It is a NAVIGATION decision, separate from the
interactivity work, and it is applied to this branch AFTER the interactive fleet seals — not
concurrently — because both changes touch `src/App.tsx` and a collision there is a merge conflict
in the one file every wave already fights over.

## What changes

1. **The Tracks tab opens the MAP, not the list.** `/tracks` currently renders `TracksIndex` (the
   distribution list) with a `List | Map` switcher. The tab's destination becomes `/mindtree`, and
   the switcher keeps both reachable in one press. The nav label and icon change to match: the tab
   is about the shape of the work, and the list is one way to read it.
2. **The app lands on the map.** The index redirect goes from `/followups` to `/mindtree`.
3. **Follow-ups keeps its own tab and loses nothing.** It answers a different question — *what
   needs ME today* — and remains the right first screen for an intern who owns items rather than
   distributing them.

## Why this shape, and not simply "add a sixth tab"

The tab bar is capped at five (`App.tsx` NAV, `inTabBar`), and that cap is deliberate: a sixth
destination makes every one of them smaller and harder to hit on a phone. Tracks and Mindtree are
already **one job in two views** — the switcher exists precisely because they are not separate
destinations. Promoting the map means changing which view that single tab opens, not adding a tab.

## The judgement to make when applying it

**Landing on the map is right for Aziz and may be wrong for his interns.** He runs five domains and
his first question each morning is *where is everything and who has what* — the map answers it. An
intern owns a handful of items and their first question is *what do I do now* — Follow-ups answers
that, and the map would be noise.

So the landing route should follow the person, not the product: **admins land on the map, members
land on Follow-ups**, with the preference overridable per user and remembered. If that proves more
machinery than it is worth, the honest fallback is landing everyone on the map and making sure
Follow-ups is one press away — but the per-role default is the better answer and should be tried
first.

## Verification

Every route that previously reached the list must still reach it in one press; a deep link to
`/tracks` must not break; the switcher must show which view is active; and the change must be
proven at 375px, where the tab bar is the whole navigation.
