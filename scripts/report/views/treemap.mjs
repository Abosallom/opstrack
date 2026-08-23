// VIEW 6 OF 8 — Treemap. One rectangle per organisation, area = RECORDED cells.
//
// ⚠ THE DENOMINATOR OF AREA IS 406, NOT 1,040. A treemap's whole claim is that
//   area is quantity, so the quantity has to be one nobody can misread. If the
//   rectangles were sized by the ten capabilities every organisation *could*
//   record, all 104 would be identical and the drawing would say nothing. Sized
//   by what is actually recorded, a rectangle is "how much of this organisation
//   somebody has spoken about". That sentence is printed on the page, because a
//   reader who assumes "total" reads every area wrong and has no way to notice.
//
// WHY THE FILL IS A SPLIT AND NOT A RAMP. The brief offered a #b9b4c6→#c98a1a→
// #1f7a4d ramp on live-share, or a live-fill proportion inside each rectangle.
// The ramp was refused: at the grey end it cannot separate an organisation that
// is all-planned from one that is all-testing, and colour in this document means
// STATUS ONLY (rule 2). Splitting each rectangle by its own live/testing/planned
// counts uses the three status colours as themselves, and buys a property the
// ramp cannot: every recorded cell in the programme is drawn at the SAME area, so
// the green ink across the whole map is exactly 82 of 406, measurable with a ruler.
//
// THE FOURTH STATE IS THE PAPER. 634 cells are null — nobody has said anything —
// so they have no area at all. Absence is the honest encoding here, but absence
// is invisible unless it is named, so the key carries a hairline box for it and
// the count of organisations whose area is zero because nothing is recorded.
//
// Pure module: no fs, no clock, no network, no dependency. The squarified layout
// (Bruls, Huizing & van Wijk 2000) is thirty lines below rather than a package.

const FONT = '-apple-system, Helvetica Neue, Arial, sans-serif'

// Status only. Hex literals — inside SVG, var() does not survive Chrome's print path.
const LIVE = '#1f7a4d'
const TESTING = '#c98a1a'
const PLANNED = '#b9b4c6'
const HAIRLINE = '#e4e1ec'
const INK = '#241f30'
const MUTED = '#6b6580'
const PAPER = '#ffffff'

// Millimetres, and the viewBox is millimetres too, so every number here is a
// length the printer will actually produce.
const MAP_W = 178
const MAP_H = 118
const VIEW_H = 136

const esc = (s) => String(s)
  .replace(/&/gu, '&amp;').replace(/</gu, '&lt;').replace(/>/gu, '&gt;')

/** Worst aspect ratio in a candidate row, given the side it is laid along. */
function worstRatio(row, sum, side) {
  if (sum <= 0) return Infinity
  const t2 = (sum * sum) / (side * side) // the row's thickness, squared
  let lo = Infinity
  let hi = 0
  for (const v of row) { if (v < lo) lo = v; if (v > hi) hi = v }
  return Math.max(t2 / lo, hi / t2)
}

/**
 * Squarified treemap. `values` are AREA UNITS already scaled by the caller so
 * their sum is w*h, and each placed row consumes exactly its own area — which is
 * what keeps that invariant true all the way down to the last rectangle.
 * Values must be sorted descending and strictly positive.
 */
function squarify(values, x0, y0, w0, h0) {
  const out = []
  let x = x0; let y = y0; let w = w0; let h = h0; let i = 0
  while (i < values.length && w > 0 && h > 0) {
    const side = Math.min(w, h)
    let row = []; let sum = 0; let best = Infinity
    // Grow the row while it makes the rectangles squarer; stop the moment it stops.
    while (i + row.length < values.length) {
      const next = values[i + row.length]
      const grown = row.concat(next)
      const r = worstRatio(grown, sum + next, side)
      if (row.length && r > best) break
      row = grown; sum += next; best = r
    }
    const thick = sum / side
    let off = 0
    for (const v of row) {
      const len = v / thick
      out.push(w >= h
        ? { x, y: y + off, w: thick, h: len }   // a column down the left edge
        : { x: x + off, y, w: len, h: thick })  // a band across the top
      off += len
    }
    if (w >= h) { x += thick; w -= thick } else { y += thick; h -= thick }
    i += row.length
  }
  return out
}

/** Break a name to at most `maxLines` lines of `maxChars`, marking what was cut. */
function wrapName(name, maxChars, maxLines) {
  const clip = (s) => (s.length > maxChars ? `${s.slice(0, Math.max(1, maxChars - 1))}…` : s)
  const words = String(name).split(/\s+/u).filter(Boolean)
  const lines = ['']
  for (const word of words) {
    const last = lines.length - 1
    const joined = lines[last] ? `${lines[last]} ${word}` : word
    if (joined.length <= maxChars) { lines[last] = joined; continue }
    if (lines.length >= maxLines) { lines[last] = clip(joined); return lines }
    lines.push(word)
  }
  return lines.map(clip)
}

export function page(fx) {
  const orgs = fx.tracker.orgs
  const totals = fx.tracker.totals

  // Zero-recorded organisations cannot be drawn: their area is nothing. Counted,
  // not quietly dropped — a treemap that silently omits rows is a lying treemap.
  const drawn = orgs.filter((o) => o.recorded > 0)
  const silent = orgs.length - drawn.length
  const recordedSum = drawn.reduce((s, o) => s + o.recorded, 0)

  // Descending by size is what squarification needs; the tie-breaks are only
  // there so the same fixture always prints the same picture.
  const sorted = drawn.slice().sort((a, b) =>
    b.recorded - a.recorded ||
    b.live - a.live ||
    a.name.localeCompare(b.name, 'en'))

  // Rung is not drawn here, but the "what it hides" line has to be able to say
  // how many rungs stand empty without any of us guessing the number.
  const emptyRungs = fx.tracker.stages
    .filter((s) => !orgs.some((o) => o.stage === s.name)).length

  const cellArea = (MAP_W * MAP_H) / recordedSum
  const boxes = squarify(sorted.map((o) => o.recorded * cellArea), 0, 0, MAP_W, MAP_H)

  const rects = []
  const labels = []
  let unlabelled = 0

  sorted.forEach((org, idx) => {
    const b = boxes[idx]
    if (!b) { unlabelled += 1; return }
    // A hair of inset in place of a stroke, so neighbours separate without any
    // rectangle claiming area it was not given.
    const x = b.x + 0.28; const y = b.y + 0.28
    const w = Math.max(0.4, b.w - 0.56); const h = Math.max(0.4, b.h - 0.56)

    // Split along the LONGER axis: on a tall thin rectangle a left-to-right
    // split would be three slivers nobody can compare.
    const bands = [[org.live, LIVE], [org.testing, TESTING], [org.planned, PLANNED]]
      .filter(([n]) => n > 0)
    const along = w >= h ? w : h
    let run = 0
    for (const [n, fill] of bands) {
      const len = along * (n / org.recorded)
      rects.push(w >= h
        ? `<rect x="${(x + run).toFixed(2)}" y="${y.toFixed(2)}" width="${len.toFixed(2)}" height="${h.toFixed(2)}" fill="${fill}"/>`
        : `<rect x="${x.toFixed(2)}" y="${(y + run).toFixed(2)}" width="${w.toFixed(2)}" height="${len.toFixed(2)}" fill="${fill}"/>`)
      run += len
    }

    // Label only where a name can be read at printed size; count the rest.
    // Two sizes, not a continuum: 2.5mm is the floor below which this stack stops
    // being readable on paper, so a rectangle that cannot hold it gets no name.
    const fs = w >= 19 ? 2.8 : 2.5
    const lineH = fs * 1.18
    const charW = fs * 0.53
    const maxChars = Math.floor((w - 2.6) / charW)
    if (w < 13.5 || h < 8 || maxChars < 7) { unlabelled += 1; return }
    const roomLines = Math.max(1, Math.min(3, Math.floor((h - 3.4) / lineH)))
    const lines = wrapName(org.name, maxChars, roomLines)
    const nameH = lines.length * lineH
    const wantCount = h >= nameH + 6.4 && maxChars >= 13
    const widest = Math.max(...lines.map((l) => l.length)) * charW
    const countText = `${org.recorded} recorded · ${org.live} live`
    const plateW = Math.min(w - 1.4, Math.max(widest, wantCount ? countText.length * 2.35 * 0.53 : 0) + 1.8)
    const plateH = nameH + (wantCount ? 3.0 : 0) + 1.2

    labels.push(
      `<rect x="${(x + 0.7).toFixed(2)}" y="${(y + 0.7).toFixed(2)}" width="${plateW.toFixed(2)}" height="${plateH.toFixed(2)}" fill="${PAPER}" fill-opacity="0.86" rx="0.5"/>` +
      lines.map((l, k) =>
        `<text x="${(x + 1.5).toFixed(2)}" y="${(y + 1.4 + fs + k * lineH).toFixed(2)}" font-family="${FONT}" font-size="${fs}" font-weight="600" fill="${INK}">${esc(l)}</text>`).join('') +
      (wantCount
        ? `<text x="${(x + 1.5).toFixed(2)}" y="${(y + 1.3 + fs + nameH).toFixed(2)}" font-family="${FONT}" font-size="2.35" fill="${MUTED}">${esc(countText)}</text>`
        : ''))
  })

  const unit = Math.sqrt(cellArea) // one recorded cell, drawn at the map's own scale
  const labelled = sorted.length - unlabelled
  const legendY = 122.5

  const swatch = (cx, fill, text) =>
    `<rect x="${cx}" y="${(legendY + 1.4).toFixed(2)}" width="3.4" height="3.4" fill="${fill}"/>` +
    `<text x="${(cx + 4.6).toFixed(2)}" y="${(legendY + 4.2).toFixed(2)}" font-family="${FONT}" font-size="2.7" fill="${INK}">${esc(text)}</text>`

  const svg =
`<svg viewBox="0 0 ${MAP_W} ${VIEW_H}" role="img" aria-label="Treemap of ${orgs.length} organisations, each rectangle sized by the number of capabilities recorded for it, ${recordedSum} recorded cells in all, and split into live, testing and planned in proportion to that organisation's own records. The ${totals.unrecorded} unrecorded cells have no area.">
<rect x="0" y="0" width="${MAP_W}" height="${MAP_H}" fill="${PAPER}"/>
${rects.join('\n')}
${labels.join('\n')}
<rect x="0" y="0" width="${MAP_W}" height="${MAP_H}" fill="none" stroke="${HAIRLINE}" stroke-width="0.4"/>
<rect x="0.2" y="${legendY.toFixed(2)}" width="${unit.toFixed(2)}" height="${unit.toFixed(2)}" fill="none" stroke="${MUTED}" stroke-width="0.4"/>
<text x="${(unit + 2.4).toFixed(2)}" y="${(legendY + 4.2).toFixed(2)}" font-family="${FONT}" font-size="2.7" fill="${INK}">one recorded capability, to scale</text>
${swatch(60, LIVE, `live ${totals.live}`)}
${swatch(82, TESTING, `testing ${totals.testing}`)}
${swatch(108, PLANNED, `planned ${totals.planned}`)}
<rect x="132" y="${(legendY + 1.4).toFixed(2)}" width="3.4" height="3.4" fill="${PAPER}" stroke="${HAIRLINE}" stroke-width="0.4"/>
<text x="136.6" y="${(legendY + 4.2).toFixed(2)}" font-family="${FONT}" font-size="2.7" fill="${MUTED}">${totals.unrecorded} unrecorded — no area</text>
<text x="0.2" y="${(legendY + 10.4).toFixed(2)}" font-family="${FONT}" font-size="2.6" fill="${MUTED}">Every recorded cell is drawn at the same area, so the green ink is exactly ${totals.live} of ${recordedSum}.</text>
</svg>`

  return `<section class="page">
  <div class="kicker">View 6 of 8</div>
  <h2>Treemap</h2>
  <p class="lede">One rectangle per organisation, sized by how many capabilities somebody has actually recorded for it, and split by the status of those records.</p>
  <div class="box warn"><h4>Area is recorded work, not possible work</h4><p>Every organisation could record all ten capabilities, so sizing by the <i>possible</i> would draw 104 identical squares. These count only the <b>${recordedSum} recorded</b> cells &mdash; mean ${(recordedSum / totals.organizations).toFixed(1)} per organisation.</p></div>
  <div class="vtreemap-wrap">${svg}</div>
  <p class="vtreemap-note"><small>${labelled} rectangles carry a name; <b>${unlabelled}</b> were too small to label at print size.${silent > 0 ? ` A further <b>${silent}</b> organisation${silent === 1 ? ' has' : 's have'} nothing recorded at all and so ${silent === 1 ? 'has' : 'have'} no area on this map.` : ' Every organisation has at least one recorded cell, so none is missing.'}</small></p>
  <div class="two">
    <div class="mini"><h4>What it answers</h4><p>Where the recorded work is concentrated, and how much of it is finished. A few large rectangles hold a disproportionate share of the ${recordedSum} recorded cells, and because every cell is the same area, the green across the picture is ${totals.live} of ${recordedSum} &mdash; read as area rather than taken on trust.</p></div>
    <div class="mini"><h4>What it hides</h4><p>Which capability is which: a rectangle says how many are recorded, never which of the ten. The ${totals.unrecorded} unrecorded cells have no area at all &mdash; only the hairline box in the key. Rung and ownership are both absent, and ${unlabelled} rectangles are too small to name.</p></div>
  </div>
  <div class="grow"></div>
  <div class="foot"><span>Rectangles sized by recorded capabilities (${recordedSum} of ${totals.cells.toLocaleString('en-GB')} possible cells); colour is status only</span><span>Page 6</span></div>
</section>`
}

export const css = `
.vtreemap-wrap { margin: 3mm 0 0; }
.vtreemap-wrap svg { display: block; width: 100%; height: auto; }
.vtreemap-note { margin: 1.6mm 0 0; color: #6b6580; }
`
