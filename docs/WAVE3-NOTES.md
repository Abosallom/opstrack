# Wave 3 spec deltas (owner directives, 2026-07-29 evening)

Binding for the Wave-3 fleet, on top of EXECUTION-PLAN Wave 3 and the WAVE2-NOTES conventions
(polish mandate applies).

## 1. Dynamic board (upgrade of pages/Board.tsx — coordinate with the Wave-2 final state)

Aziz: "make the board more dynamic." Concretely:

- **Group-by switcher** in the board header: **Status** (default) · **Track** · **Owner** ·
  **Priority**. Same card machinery; columns derive from `useVocab('status')`, active tracks,
  members (+ "Unassigned"), or priorities. Persist the choice per user (localStorage).
- **Inline quick-add** at the top of every column: a one-line title input that creates an entry
  pre-filled with the column's dimension value (status/track/owner/priority) via
  `createEntryOptimistic`. Esc cancels, Enter adds and keeps focus for the next one.
- **Column intelligence**: header shows count + an SLA-breach badge when any card in the column
  is breached; columns collapse to a slim rail (persisted); empty columns show a drop hint.
- **Livelier drag**: drop-position preview, auto-scroll when dragging near the container edges,
  and a subtle spring on drop (150-200ms, `prefers-reduced-motion` honoured). Keyboard path stays
  first-class and announces moves via the existing aria-live region.
- **Realtime motion**: a card moved by someone else animates from its old column and carries the
  existing updated-by highlight; new cards fade-slide in.
- **Density toggle** (comfortable/compact) persisted per user.
- Group-by Track/Owner + drag = re-file or re-assign (the store call differs per dimension —
  reuse the same optimistic update + rollback paths; a reassign drag fires the existing
  assignment-notification trigger server-side, zero new plumbing).

## 2. Distribution tree — "all tracks with their tasks, so I can distribute among the team"

New primary view for the **Tracks tab index** (`/tracks`), replacing the placeholder listing.
The per-track timeline stays at `/tracks/:id` (unchanged Wave-3 scope).

- **Tree**: one node per active track (color chip, icon, localized name) with counts —
  open · unassigned · SLA-breached. Expand/collapse (persisted); "expand all / collapse all".
  Under each track: its OPEN entries as rows (title, status pill, priority dot, age pill,
  owner badge or a prominent **Unassigned** chip). Row click = `openEntry()`.
- **Distribution is the point**: every row has an inline **owner picker** (members list from
  `store/members`); changing it is optimistic and fires the existing assigned-notification
  trigger — the teammate gets notified automatically.
- **Multi-select** (checkboxes on hover/focus + shift-range): a floating bulk bar appears —
  "N selected → Assign to [member] · Set priority · Move to track · Clear". Bulk ops run through
  the store batch path with one toast summarizing results (and per-row rollback on failures).
- **Filters** above the tree: Unassigned-only toggle (the distribution workflow's home base),
  status multi-chip, priority, text search. Deep-linkable (`/tracks?unassigned=1`).
- **Mobile**: tracks render as cards, rows full-width, bulk bar docks above the tab bar;
  one-handed reachable. RTL mirror equal to LTR.
- Empty states: a track with zero open entries shows a low-key "all clear"; zero tracks cannot
  happen (DB guard).

Ownership note: `pages/Tracks.tsx` currently = the timeline placeholder. Wave 3 splits it:
`pages/tracks/TracksIndex.tsx` (the tree) + `pages/tracks/TrackTimeline.tsx` (`/tracks/:id`),
`tracks.css` prefix `.tl-` stays with the timeline; the tree takes `.tree-` (registry addition).
