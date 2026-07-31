# nphies brand palette (owner request, 2026-07-31)

The app takes its colours from the nphies identity: the deep navy wordmark and the
eight-segment spectrum ring that runs cyan → sky → blue → violet → purple → magenta → rose → pink.

## The constraint that shaped every value

The raw brand colours cannot be used directly, and the arithmetic says why:

| brand | on dark bg | on light bg |
|---|---|---|
| navy `#1E2A63` | **1.37** | 12.37 |
| cyan `#45B0D8` | 7.39 | **2.29** |
| mid-spectrum | ~4.4 (but **3.7–3.9 on elevated surfaces**) | **3.3–3.8** |

The app enforces WCAG AA computed on *every* elevation in *both* themes, so a single hex per
colour is impossible. Each brand colour therefore ships as a **pair**: hue and saturation held
constant, lightness moved until it clears 4.5:1 against the worst surface of its own theme.

## What changed

- **`--accent`** is the brand navy. The LIGHT theme carries it verbatim (`#1d2961`, 11.36:1).
  The DARK theme carries a lightened tint of the same hue (`#7586d5`, 4.52:1) — at 1.37:1 the
  navy itself would be invisible there.
- **`--accent-ink`** re-verified against both: 5.61:1 (dark) and 13.62:1 (light).
- **`--track-*`** presets now draw from the ring.
- **`--swatch-*`** — nine of the twelve presets are now ring colours, so a colour the admin picks
  is a brand colour by default. Teal, green, lime, amber and orange are kept: they are outside the
  brand spectrum but remain legal picks, and removing them would silently re-colour any track
  already using one.

## What this does NOT change, and why

**Existing track colours are DATA, not tokens.** `tracks.color` / `tracks.color_light` hold a hex
per row, chosen when the track was created. Changing the CSS presets does not repaint them — the
six live tracks keep the colours they already have until someone edits them in
`Settings › Tracks`, where the new ring swatches are now the offered palette.

That is deliberate: silently rewriting rows the admin chose would be a data edit disguised as a
theme change. The migration to repaint them is one `update` per track and is the owner's call.
