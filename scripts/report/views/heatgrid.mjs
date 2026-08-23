// VIEW 1 OF 8 — the heat grid. Every one of the 1,040 cells, drawn once.
//
// WHY THIS VIEW IS THE REFERENCE. It is the only drawing in the catalogue that
// puts the whole matrix on the paper at full resolution: no roll-up, no top-N,
// no "other". The seven that follow are all compressions of this picture, and
// the owner should judge each of them by what it loses against this one.
//
// WHY 52 + 52 AND NOT ONE COLUMN OF 104. A single stack of 104 rows inside the
// ~250mm of usable page forces a 1.8mm row pitch, which forces sub-5pt names —
// legible on screen at 400%, not on paper. Split in two, the same 1,040 cells
// get a 3.4mm pitch and a 6.5pt name column, and nothing is dropped: the sort
// order simply runs down the left stack and continues down the right. The
// gradient is unbroken; only the fold is new.
//
// Pure module: no fs, no clock, no network. Everything comes from `fx`.

/* Status colours are the document's ONLY colours. The rungs get position, not
   hue — see the note the database carries on map_node_stages. */
const LIVE = '#1f7a4d'
const TESTING = '#c98a1a'
const PLANNED = '#b9b4c6'
const ABSENT = '#e4e1ec' // hairline only; the fill stays paper
const INK = '#1d1a29'
const MUTED = '#6b6580'

const FONT = '-apple-system, Helvetica Neue, Arial, sans-serif'

/* Geometry, in millimetres — the viewBox is 1 unit = 1mm so every number below
   is the real printed size. 46 + 2 + (10 x 3.3) = 81 per panel; 81 x 2 + 16
   gutter = 178, which is exactly the .page content box. */
const LABEL_W = 46
const GAP = 2
const COL_PITCH = 3.3
const CELL_W = 2.8
const ROW_PITCH = 3.4
const CELL_H = 2.8
const BAND = 25 // headroom for the rotated capability names and the key
const PANEL_W = LABEL_W + GAP + COL_PITCH * 10
const GUTTER = 16
const ROWS_PER_PANEL = 52
const W = PANEL_W * 2 + GUTTER
const H = BAND + ROWS_PER_PANEL * ROW_PITCH + 2

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const num = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
const t = (x, y, s, o = {}) =>
  `<text x="${x}" y="${y}" font-family="${FONT}" font-size="${o.size ?? 2}"` +
  ` fill="${o.fill ?? INK}"${o.weight ? ` font-weight="${o.weight}"` : ''}` +
  `${o.anchor ? ` text-anchor="${o.anchor}"` : ''}${o.ls ? ` letter-spacing="${o.ls}"` : ''}` +
  `${o.transform ? ` transform="${o.transform}"` : ''}` +
  ` dominant-baseline="${o.baseline ?? 'auto'}">${esc(s)}</text>`

/* 36 characters is what 46mm holds at 6.5pt; four of the 104 names need it. */
const clip = (s) => (s.length > 36 ? `${s.slice(0, 35)}…` : s)

export function page(fx) {
  const caps = fx.tracker.capabilities
  const T = fx.tracker.totals

  /* Sort by how far along the organization is, not by name. Alphabetical order
     scatters the 82 live cells over the whole page and the picture says nothing;
     ordered by live then testing, the same cells stack into a gradient and the
     634 absences fall out as one continuous field at the bottom. */
  const orgs = fx.tracker.orgs.slice().sort((a, b) =>
    b.live - a.live || b.testing - a.testing || b.planned - a.planned || a.name.localeCompare(b.name))

  const fillFor = { live: LIVE, testing: TESTING, planned: PLANNED }

  const cell = (x, y, status) => {
    // THE FOURTH STATE. `null` is not a light grey planned — it is paper with a
    // hairline round it, so the unrecorded region reads as absence rather than
    // as a quieter kind of commitment.
    if (!status) return `<rect x="${x}" y="${y}" width="${CELL_W}" height="${CELL_H}" fill="none" stroke="${ABSENT}" stroke-width="0.18"/>`
    return `<rect x="${x}" y="${y}" width="${CELL_W}" height="${CELL_H}" fill="${fillFor[status]}"/>`
  }

  const panel = (pi) => {
    const ox = pi * (PANEL_W + GUTTER)
    const slice = orgs.slice(pi * ROWS_PER_PANEL, (pi + 1) * ROWS_PER_PANEL)
    const parts = []

    // rotated capability names — the ladder, left to right, in ladder order
    caps.forEach((c, ci) => {
      const cx = ox + LABEL_W + GAP + ci * COL_PITCH + CELL_W / 2
      const cy = BAND - 1.4
      parts.push(t(cx, cy, c.name, {
        size: 1.95, fill: INK, transform: `rotate(-90 ${cx} ${cy})`, baseline: 'middle',
      }))
    })

    parts.push(t(ox, BAND - 1.4, `ORGANIZATIONS ${pi * ROWS_PER_PANEL + 1}–${pi * ROWS_PER_PANEL + slice.length} OF ${orgs.length}`,
      { size: 1.7, fill: MUTED, ls: 0.25 }))

    slice.forEach((o, i) => {
      const y = BAND + i * ROW_PITCH
      // Zebra sits behind the NAME only, never behind the grid — a tint inside
      // the matrix would be read as a fifth state.
      if (i % 2 === 1) parts.push(`<rect x="${ox}" y="${y}" width="${LABEL_W}" height="${ROW_PITCH}" fill="#f7f6fb"/>`)
      parts.push(t(ox + LABEL_W - 1, y + ROW_PITCH / 2, clip(o.name), { size: 2.3, anchor: 'end', baseline: 'middle' }))
      o.byCap.forEach((s, ci) => {
        parts.push(cell(ox + LABEL_W + GAP + ci * COL_PITCH, y + (ROW_PITCH - CELL_H) / 2, s))
      })
    })
    return parts.join('')
  }

  // The key doubles as the denominator statement: 406 is the scope, 1,040 is the
  // shape of the table. Nothing on this page is ever divided by 1,040.
  const keyRow = (i, colour, label, hairline) => {
    const y = 7.6 + i * 4.2
    const sw = hairline
      ? `<rect x="0.1" y="${y - 2.2}" width="2.4" height="2.4" fill="none" stroke="${ABSENT}" stroke-width="0.3"/>`
      : `<rect x="0" y="${y - 2.3}" width="2.6" height="2.6" fill="${colour}"/>`
    return sw + t(3.8, y, label, { size: 2, fill: INK })
  }

  const key = [
    t(0, 3.4, `${num(T.recorded)} of ${num(T.cells)} cells carry a status`, { size: 2.1, weight: 600 }),
    keyRow(0, LIVE, `live · ${num(T.live)} cells`, false),
    keyRow(1, TESTING, `testing · ${num(T.testing)} cells`, false),
    keyRow(2, PLANNED, `planned · ${num(T.planned)} cells`, false),
    keyRow(3, ABSENT, `unrecorded · ${num(T.unrecorded)} cells — nobody has said`, true),
  ].join('')

  const notes = [
    'Rows run by how far along the organization is:',
    'cells live, then cells testing. The left stack',
    'continues into the right — one order, one fold.',
    `Columns are the capability ladder, ADT first. ${num(T.withOwner)} of`,
    `${orgs.length} organizations have a named owner.`,
  ].map((s, i) => t(PANEL_W + GUTTER, 3.4 + i * 4, s, { size: 2, fill: i < 3 ? INK : MUTED })).join('')

  const svg =
    `<svg class="vheatgrid-svg" viewBox="0 0 ${W} ${H}" role="img" ` +
    `aria-label="Heat grid of ${orgs.length} organizations by ${caps.length} capabilities. ` +
    `${num(T.live)} cells live, ${num(T.testing)} testing, ${num(T.planned)} planned, and ` +
    `${num(T.unrecorded)} of ${num(T.cells)} unrecorded, drawn as empty hairline squares.">` +
    `<g shape-rendering="crispEdges">` + panel(0) + panel(1) + `</g>` +
    key + notes +
    `</svg>`

  return `<section class="page">
  <div class="kicker">View 1 of 8</div>
  <h2>The heat grid</h2>
  <p class="lede">Every organization against every capability &mdash; all ${num(T.cells)} cells at once, so the ${num(T.unrecorded)} nobody has spoken for are as visible as the ${num(T.recorded)} that carry a status.</p>
  ${svg}
  <div class="two">
    <div class="mini"><h4>What it answers</h4><p>Where is the programme actually thick, and where is it hollow? The gradient down the stacks is real progress, not the alphabet: ${num(T.live)} live cells sit at the top and thin out into a field of hairline squares &mdash; ${num(T.unrecorded)} cells, more than half the table, that nobody has recorded either way. It also shows which capabilities are wide (a full column) and which are barely touched.</p></div>
    <div class="mini"><h4>What it hides</h4><p>It says nothing about the seven rungs &mdash; an organization on Kickoff and one that is Live look identical here if their cells match. It cannot show time, owner, or the three rungs that stand empty (Not started, UAT, Go-live readiness). At 2.8mm a cell is a colour, not a number, so read counts from the key rather than by eye.</p></div>
  </div>
  <div class="grow"></div>
  <div class="foot"><span>${orgs.length} organizations &times; ${caps.length} capabilities &middot; ${num(T.recorded)} recorded, ${num(T.unrecorded)} unrecorded</span><span>View 1</span></div>
</section>`
}

export const css = `
.vheatgrid-svg{display:block;width:100%;height:auto;margin:3mm 0 2mm}
`
