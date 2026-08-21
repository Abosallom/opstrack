# nphies brand palette (owner request, 2026-07-31; accent moved 2026-08-12)

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

## 2026-08-12 — the accent moves to the middle of the ring

**The complaint was measured, not aesthetic.** The owner said the app reads as blue when the
mark is mostly violet through magenta. He was right, and the palette said so: `--accent` was
`#7a8ad6` in dark (an indigo tint of the brand navy) and `#1d2961` in light (the navy itself).
Both sit at the ring's *cold end*, and `--accent` has **123 uses across 27 sheets** — so the
single most-repeated colour in the product was the one hue the ring spends least time being.

**Where it went.** Hue **255°** — the arithmetic midpoint of the ring's two middle stops,
violet `#7b72c4` (247°) and purple `#8e6fbf` (263°). The accent is now literally the centre of
the mark it is drawn from.

**Neither ring stop can be used verbatim.** This is the same constraint the table above
describes, re-measured for these two hues:

| ring stop | on `--bg-elev-2` dark | on `--bg-elev-2` light | verdict |
|---|---|---|---|
| violet `#7b72c4` | **3.53** | **3.54** | fails 4.5 in both |
| purple `#8e6fbf` | **3.63** | **3.45** | fails 4.5 in both |

The ring is drawn on a white plate at logo scale; a token has to survive three surfaces in two
themes. So the accent is a **rendering** of that hue — the pair strategy again.

### The values

| token | dark | light |
|---|---|---|
| `--accent` | `#9884d6` | `#322067` |
| `--accent-hover` | `#a894de` | `#4b2f96` |
| `--accent-ink` | `#0d0819` | `#ffffff` |
| `--accent-soft` | `rgba(152, 132, 214, 0.16)` | `rgba(90, 52, 192, 0.12)` |

Measured, on `--bg` / `--bg-elev` / `--bg-elev-2`:

| claim | dark | light |
|---|---|---|
| `--accent` on the three surfaces | 5.78 / 5.34 / **4.63** | 12.60 / 13.65 / **11.60** |
| `--accent-ink` on `--accent` | **6.20** | **13.65** |
| `--accent-ink` on `--accent-hover` | **7.46** | **9.78** |
| `--accent-hover` on the three surfaces | 6.96 / 6.43 / **5.57** | 9.03 / 9.78 / **8.32** |

All clear the 4.5:1 the gate demands. `src/styles/contrast.test.ts` computes this sweep on every
run; the figures above are its arithmetic, not an estimate.

### Why the luminance was held, and not just the hue

This is the part worth keeping. Five other stylesheets — `charts.css` (a four-step `color-mix`
ladder), `mindtree.css`, `drag-layer.css`, `mind-ring.css` and `map-altitude.css` — quote
**derived** accent ratios in their prose, computed against the old value. Choosing a violet
freely would have silently invalidated every one of them.

So the new accent was solved for the *old relative luminance*, hue rotated underneath it:

| | old | new | drift |
|---|---|---|---|
| dark on `--bg-elev-2` | 4.51 | 4.63 | +0.12 |
| light on `--bg-elev-2` | 11.57 | 11.60 | +0.03 |

Every figure derived **from the accent's luminance on a bare surface** therefore stays true to
within ~0.15, and the two rows above are the whole of what was re-verified at the time. The light
theme in particular keeps *exactly* the weight and authority the navy gave it — only the hue
changed.

> **The claim was once broader than that, and it was wrong.** It read "every derived figure in
> those five sheets stays true to within ~0.15", which is a promise about rows nobody re-ran. A
> differential review found four of them drifting 0.68–4.30 — the accent over a 16% node fill
> (3.15 → 3.24 dark, 9.39 → 9.41 light), the same accent over the 22% hover fill (certified as a
> passing 3.29 while actually sitting at **2.61**, under WCAG 1.4.11's 3:1), the dive-rail thumb
> on its own track (1.38 → 1.42), and the thumb on the plate (5.20 → 13.62 → 5.34 / 13.65).
> Holding luminance protects a ratio measured against a FIXED colour; it protects nothing
> measured against a *blend* of the accent's own hue with a track colour an admin types in. All
> four were re-derived in wave 8 and corrected at source. The lesson is the narrow one: a
> derived figure is only as fresh as its last recomputation, and "the hue moved but the
> luminance did not" is an argument about two rows, not about five sheets.

### `--accent-ink` was re-derived, not carried over

The old dark ink `#08111c` is a **blue**-black, tuned to a blue accent. A violet accent does not
take the same ink. The new `#0d0819` is the same near-black at the accent's own hue (258°), so a
filled button reads as one colour family instead of violet-on-navy. Light stays `#ffffff`,
re-verified at 13.65:1.

`--accent-soft` in the light theme is **not** a tint of `--accent`, and never was: the slot held
`rgba(20, 92, 192, …)` — the light `--blue` — because 12% of a near-black is indistinguishable
from grey and the soft fill would read as a smudge. Same intent, rotated to violet.

### The swatch ladder now leads with the purples

It used to open violet → indigo → blue → cyan: one purple, then three consecutive blues, so the
first four options offered were three-quarters blue. The ring's own middle leads now, and the
blue family follows.

`--swatch-purple-*` is **new** — `#9a7fc6` / `#7b56b4`, the ring's purple stop (263°). It had no
representative at all, despite the ring spending an eighth of its circumference being it. It is
also exactly `--track-infra`, so a third seeded track became reproducible from the picker.

Two prose corrections found while recomputing the ladder, recorded because a table that lies is
worse than no table:

- The block claimed a contrast floor of **4.08:1**. No swatch measures 4.08 in either theme; the
  real minimum is **4.14** (amber-light). Corrected.
- It claimed **five of twelve** swatches are `--track-*` values. The real count is **three of
  thirteen** — violet (`--track-pmo`), cyan (`--track-network`) and the new purple
  (`--track-infra`). `--track-itops` and `--track-sre` still have **no ladder entry in either
  theme**, so two of the five seeded tracks carry colours an admin cannot pick. That gap is real
  and is *not* fixed here.

### The hue is now a tested property

Contrast is hue-blind by construction — relative luminance weights R, G and B and then discards
the hue, so a blue, a violet and a magenta of equal luminance are indistinguishable to every
other assertion in the suite. That is precisely how the accent sat at the cold end of the brand
ring for months while passing every measurement.

`contrast.test.ts` therefore asserts `--accent`'s hue falls in **240–280°** in both themes — the
ring's violet stop through its purple stop, deliberately excluding the ring's blue (221°) and
its magenta (309°). Verified to bite: restoring the old `#7a8ad6` fails it at 229.57°.

## What changed in the 2026-07-31 pass (still true)

- **`--track-*`** presets draw from the ring.
- **`--swatch-*`** — most presets are ring colours, so a colour the admin picks is a brand colour
  by default. Teal, green, lime, amber and orange are kept: they are outside the brand spectrum
  but remain legal picks, and removing them would silently re-colour any track already using one.
- The brand navy `#1d2961` did not leave the product when the accent moved off it — it is still
  `--swatch-indigo-light`, so it remains a colour an admin can choose.

## What this does NOT change, and why

**Existing track colours are DATA, not tokens.** `tracks.color` / `tracks.color_light` hold a hex
per row, chosen when the track was created. Changing the CSS presets does not repaint them — the
six live tracks keep the colours they already have until someone edits them in
`Settings › Tracks`, where the new ring swatches are now the offered palette.

That is deliberate: silently rewriting rows the admin chose would be a data edit disguised as a
theme change. The migration to repaint them is one `update` per track and is the owner's call.

## The mark: the ring, generated

The app icon is the nphies **ring**, not the wordmark. An icon is a small square; "nphies نفيس"
is unreadable at 40px and the full lockup would letterbox. The ring is square, distinctive,
already the source of the track palette, and reads at every size. The wordmark keeps the sign-in
header, where it has the width it was drawn for.

The ring is **generated by `scripts/make-icon.mjs`, not traced from the supplied raster** — one
source has to serve 1024px for App Store review and 32px for a browser tab, and no upscale of a
chat-attached PNG survives the first of those. `scripts/make-icons.sh` rasterises every derived
file. **A logo revision is: edit the constants, run `./scripts/make-icons.sh`, look at the
output.** There is no second place to hunt.

### Three variants, because the platforms disagree

| File | Plate | Scale | Feeds |
|---|---|---|---|
| `icon.svg` | none | 1.0 | favicon, `pwa-192/512` (`purpose: any`) |
| `icon-opaque.svg` | white | 1.0 | `apple-touch-icon`, iOS `AppIcon` |
| `icon-maskable.svg` | white | 0.88 | `pwa-maskable-192/512` |

- **iOS rejects an app icon that carries an alpha channel at all** — not merely one that is
  transparent. The pipeline composites onto white and converts to RGB; a transparent
  `apple-touch-icon` would additionally be composited onto *black* by iOS, turning the plate the
  mark was designed on into a hole.
- **A maskable icon is cropped to a shape the app does not choose.** Android guarantees only the
  central 66.7%, so the ring is scaled to an outer radius of 305/1024 — inside that circle with
  9px of margin at 512, verified against a circle crop, the 66.7% crop and the iOS squircle.

### Two geometry traps, recorded so they are not re-entered

1. **`stroke-linecap: round` extends each arc by half the stroke width.** At this radius that is
   ~6.8° *per end*, so the first attempt's 9° gap was swallowed whole and the ring rendered as one
   continuous doughnut with no petals. The visible gap is `GAP_DEG - 2 × capAngle`; `GAP_DEG = 21`
   is chosen for what survives the caps.
2. **The ladder is a sweep, not a colour wheel.** Wrapping the last petal's gradient back to the
   cyan at 12 o'clock made it run rose→cyan and go grey in the middle — a transition that exists
   nowhere in the supplied mark. It terminates instead, one step further in the direction it was
   already travelling, and the break falls inside a gap where the eye asks nothing of it.
