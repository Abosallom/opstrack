// Part A — where the programme is, read off the tracker.
//
// This page is the document's baseline: every view in Part D draws the same
// 406 links this page counts, so a reader who distrusts a diagram can come back
// here and check the arithmetic.

const F = 'font-family="-apple-system, Helvetica Neue, Arial, sans-serif"'

/** A horizontal proportion bar, in SVG so it prints exactly. */
function bar(x, y, w, h, parts) {
  let cx = x
  const total = parts.reduce((n, p) => n + p.n, 0) || 1
  return parts
    .map((p) => {
      const pw = (p.n / total) * w
      const seg = p.fill === 'none'
        ? `<rect x="${cx.toFixed(2)}" y="${y}" width="${pw.toFixed(2)}" height="${h}" fill="#fff" stroke="#e4e1ec" stroke-width="0.7"/>`
        : `<rect x="${cx.toFixed(2)}" y="${y}" width="${pw.toFixed(2)}" height="${h}" fill="${p.fill}"/>`
      cx += pw
      return seg
    })
    .join('')
}

export function page(fx) {
  const t = fx.tracker.totals
  const caps = fx.tracker.capabilities

  // Per capability, across the 104. Recorded is the denominator that means
  // something; the catalogue total (104) is not, and the page says so.
  const rows = caps.map((c, i) => {
    const col = fx.tracker.orgs.map((o) => o.byCap[i])
    return {
      name: c.name,
      live: col.filter((s) => s === 'live').length,
      testing: col.filter((s) => s === 'testing').length,
      planned: col.filter((s) => s === 'planned').length,
      recorded: col.filter(Boolean).length,
    }
  })
  rows.sort((a, b) => b.live - a.live || b.recorded - a.recorded)

  const W = 660
  const LABEL = 168
  const BARW = W - LABEL - 58
  const rowH = 19
  const capSvg = `<svg viewBox="0 0 ${W} ${rows.length * rowH + 8}" role="img" aria-label="Each capability across the estate, by status" style="width:100%;height:auto">
${rows
  .map((r, i) => {
    const y = i * rowH
    return `<text x="0" y="${y + 12}" font-size="10.5" fill="#3f3b4a" ${F}>${r.name}</text>` +
      bar(LABEL, y + 3, BARW, 11, [
        { n: r.live, fill: '#1f7a4d' },
        { n: r.testing, fill: '#c98a1a' },
        { n: r.planned, fill: '#b9b4c6' },
        { n: 104 - r.recorded, fill: 'none' },
      ]) +
      `<text x="${W - 52}" y="${y + 12}" font-size="9.5" font-weight="700" fill="#1f7a4d" ${F}>${r.live}</text>` +
      `<text x="${W - 34}" y="${y + 12}" font-size="9.5" fill="#6f6a7d" ${F}>of ${r.recorded}</text>`
  })
  .join('\n')}
</svg>`

  // The ladder. ORDERED, so it is drawn as position — no seven hues. The three
  // empty rungs are kept, because their emptiness is the finding.
  const spread = new Map()
  for (const o of fx.tracker.orgs) spread.set(o.stage, (spread.get(o.stage) ?? 0) + 1)
  const maxRung = Math.max(...fx.tracker.stages.map((s) => spread.get(s.name) ?? 0), 1)
  const LW = 660, lw = LW / fx.tracker.stages.length
  const ladder = `<svg viewBox="0 0 ${LW} 96" role="img" aria-label="The 104 organizations across the seven rungs" style="width:100%;height:auto">
${fx.tracker.stages
  .map((s, i) => {
    const n = spread.get(s.name) ?? 0
    // 44, not 56: at 56 the tallest column's own number sat at y=2 and was
    // clipped by the viewBox. Found in the picture, not in the markup.
    const h = n === 0 ? 0 : Math.max(4, (n / maxRung) * 44)
    const x = i * lw
    const empty = n === 0
    return `<rect x="${x + 5}" y="${62 - h}" width="${lw - 10}" height="${h || 1}" rx="2" fill="${empty ? '#fff' : '#5a4aa8'}" ${empty ? 'stroke="#e4e1ec"' : ''}/>` +
      `<text x="${x + lw / 2}" y="${62 - h - 4}" text-anchor="middle" font-size="10" font-weight="700" fill="${empty ? '#9a9aa8' : '#5a4aa8'}" ${F}>${n}</text>` +
      `<text x="${x + lw / 2}" y="${76}" text-anchor="middle" font-size="8.4" fill="#6f6a7d" ${F}>${s.name.replace(' & ', ' &amp; ').split(' ')[0]}</text>` +
      `<text x="${x + lw / 2}" y="${87}" text-anchor="middle" font-size="8.4" fill="#6f6a7d" ${F}>${s.name.split(' ').slice(1).join(' ').replace('&', '&amp;')}</text>`
  })
  .join('\n')}
</svg>`

  return `<section class="page">
  <div class="kicker">Part A &middot; read off your tracker</div>
  <h2>Where the programme is</h2>
  <p class="lede">Everything on this page is what the app shows today, from the ${t.recorded}
  capability links it holds.</p>

  <div class="stat">
    <div><div class="n">${t.organizations}</div><div class="l">organizations<br>on the map</div></div>
    <div class="ok"><div class="n">${t.live}</div><div class="l">capabilities<br>live</div></div>
    <div class="warn"><div class="n">${t.testing}</div><div class="l">in testing</div></div>
    <div><div class="n">${t.recorded}</div><div class="l">links recorded<br>of ${t.cells} possible</div></div>
  </div>

  <div class="key">
    <span><i class="k-live"></i> Live</span>
    <span><i class="k-test"></i> In testing</span>
    <span><i class="k-plan"></i> Planned</span>
    <span><i class="k-none"></i> Nobody has said</span>
  </div>

  <h3>Each capability, across the ${t.organizations}</h3>
  ${capSvg}

  <h3 style="margin-top:5mm">The ladder</h3>
  ${ladder}

  <div class="box warn">
    <h4>The denominator, said out loud</h4>
    <p>Each bar above runs to <b>${t.organizations}</b>, and the pale tail is the organizations for
    which that capability has <b>never been recorded either way</b>. Across the whole grid that is
    <b>${t.unrecorded} of ${t.cells} cells</b> &mdash; so &ldquo;${t.live} live&rdquo; is
    ${t.live} out of <b>${t.recorded} recorded</b>, not out of ${t.cells}. Dividing by ${t.cells}
    would report this programme as permanently 8% done, which would be a fact about the arithmetic
    rather than about the work.</p>
  </div>

  <div class="grow"></div>
  <div class="foot"><span>Part A &middot; the tracker</span><span>Page 2</span></div>
</section>`
}
