// VIEW 8 — the timeline.
//
// ⚠ THE ONLY VIEW THAT DOES NOT READ fx.tracker. The tracker stores no dates at
//   all: a cell is 'live' or 'testing' or 'planned' or nothing, and none of the
//   four carries a when. So the whole question "how did this programme move?"
//   is unanswerable from the tracker, and answerable — partially, and about a
//   different subject — from the Jira export. That gap IS this page's argument.
//
// WHY THE RAMP AND NOT THE STATUS HUES. The document reserves #1f7a4d/#c98a1a/
// #b9b4c6 for live/testing/planned. Nothing on this page is a tracker status —
// a resolved ticket is not a live interface — so painting a bar #1f7a4d would
// be a lie told in colour. This page uses the accent ramp only, throughout.
//
// Pure module: no fs, no clock, no network. Every figure is derived from fx.

const FONT = '-apple-system, Helvetica Neue, Arial, sans-serif'

// The ramp, darkest to lightest. #5a4aa8 and #f1eefb are the document's ends.
const DEEP = '#5a4aa8'
const MID = '#8b7cc4'
const SOFT = '#b3a9d9'
const PALE = '#cdc5e6'
const RULE = '#e4e1ec'
const INK = '#17151f'
const MUTED = '#6b6577'

const n = (v) => v.toLocaleString('en-GB')
const pct = (part, whole) => `${Math.round((part / whole) * 100)}%`

/** "2026-07" → "July 2026". Month names are literal, not locale-derived, so a
 *  print run on a differently-configured machine cannot change the page. */
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December']
const longMonth = (key) => `${MONTHS[Number(key.slice(5, 7)) - 1]} ${key.slice(0, 4)}`

/* ───────────────────────────── the columns ─────────────────────────────── */

function flowChart(months) {
  const W = 680, H = 240
  const L = 30, R = 676, T = 20, B = 372
  const slot = (R - L) / months.length
  // ⚠ SCALED TO 600, NOT TO THE MAXIMUM. The peak is 582; a max-fitted axis
  //   would put the gridlines at arbitrary numbers and make the spike look
  //   ordinary. A round ceiling keeps the 582 column visibly off the scale of
  //   everything around it, which is the honest reading.
  const TOP = 600
  const y = (v) => B - (v / TOP) * (B - T)

  const barW = 7.5, gap = 1.2
  const pad = (slot - (barW * 2 + gap)) / 2

  const grid = [0, 100, 200, 300, 400, 500, 600].map((v) => `
    <line x1="${L}" y1="${y(v).toFixed(1)}" x2="${R}" y2="${y(v).toFixed(1)}"
          stroke="${v === 0 ? '#c9c4d4' : RULE}" stroke-width="${v === 0 ? 1 : 0.7}"/>
    <text x="${L - 5}" y="${(y(v) + 3.2).toFixed(1)}" text-anchor="end" font-size="8.5"
          fill="${MUTED}" font-family="${FONT}">${v}</text>`).join('')

  const bars = months.map((m, i) => {
    const x = L + i * slot + pad
    const spike = m.month === '2026-07'
    return `
    <rect x="${x.toFixed(1)}" y="${y(m.created).toFixed(1)}" width="${barW}"
          height="${(B - y(m.created)).toFixed(1)}" fill="${PALE}"/>
    <rect x="${(x + barW + gap).toFixed(1)}" y="${y(m.resolved).toFixed(1)}" width="${barW}"
          height="${(B - y(m.resolved)).toFixed(1)}" fill="${spike ? DEEP : MID}"/>`
  }).join('')

  // Year rules where the year changes; month numbers every quarter. 35 labels
  // side by side would be a grey smear, so only 01/04/07/10 are printed.
  const ticks = months.map((m, i) => {
    const mm = m.month.slice(5, 7)
    const cx = L + i * slot + slot / 2
    let out = ''
    if (mm === '01') {
      out += `<line x1="${(L + i * slot).toFixed(1)}" y1="${T}" x2="${(L + i * slot).toFixed(1)}" y2="${B + 18}" stroke="${RULE}" stroke-width="0.8"/>`
    }
    if (i === 0 || mm === '01') {
      out += `<text x="${(L + i * slot + 2).toFixed(1)}" y="${B + 30}" font-size="10" font-weight="600"
                    fill="${INK}" font-family="${FONT}">${m.month.slice(0, 4)}</text>`
    }
    if (['01', '04', '07', '10'].includes(mm)) {
      out += `<text x="${cx.toFixed(1)}" y="${B + 13}" text-anchor="middle" font-size="7.5"
                    fill="${MUTED}" font-family="${FONT}">${mm}</text>`
    }
    return out
  }).join('')

  // The callout sits to the LEFT of the spike, over months whose tallest bar is
  // well under 200 — the only empty quarter of the plot big enough to hold it.
  const spikeIndex = months.findIndex((m) => m.month === '2026-07')
  const spikeX = L + spikeIndex * slot + pad + barW + gap + barW / 2
  const spikeTop = y(582)
  const callout = `
    <text x="${(spikeX - 24).toFixed(1)}" y="48" text-anchor="end" font-size="11.5" font-weight="700"
          fill="${INK}" font-family="${FONT}">July 2026: 582 resolved, 125 created</text>
    <text x="${(spikeX - 24).toFixed(1)}" y="63" text-anchor="end" font-size="9.5"
          fill="${MUTED}" font-family="${FONT}">One month holds more resolutions than the whole of 2024.</text>
    <path d="M ${(spikeX - 21).toFixed(1)} 44 L ${(spikeX - 6).toFixed(1)} 44 L ${(spikeX - 6).toFixed(1)} ${(spikeTop + 6).toFixed(1)}"
          fill="none" stroke="${INK}" stroke-width="0.9"/>
    <circle cx="${(spikeX - 6).toFixed(1)}" cy="${(spikeTop + 6).toFixed(1)}" r="1.8" fill="${INK}"/>`

  const legend = `
    <rect x="${L}" y="${H - 14}" width="10" height="10" fill="${PALE}"/>
    <text x="${L + 15}" y="${H - 5.5}" font-size="10" fill="${INK}" font-family="${FONT}">created</text>
    <rect x="${L + 74}" y="${H - 14}" width="10" height="10" fill="${MID}"/>
    <text x="${L + 89}" y="${H - 5.5}" font-size="10" fill="${INK}" font-family="${FONT}">resolved</text>
    <text x="${R}" y="${H - 5.5}" text-anchor="end" font-size="10" fill="${MUTED}"
          font-family="${FONT}">issues per month · October 2023 to August 2026</text>`

  return `<svg viewBox="0 0 ${W} ${H}" role="img"
    aria-label="Paired columns of issues created and resolved for each of the 35 months from October 2023 to August 2026. Resolutions spike to 582 in July 2026 against 125 created; every other month is under 300."
    xmlns="http://www.w3.org/2000/svg">${grid}${ticks}${bars}${callout}${legend}</svg>`
}

/* ─────────────────────────── the type band ─────────────────────────────── */

function typeBand(types, issues) {
  const W = 680, H = 88
  const L = 30, R = 676
  const inner = R - L
  const fills = [DEEP, MID, SOFT, '#efecf9']
  let x = L
  const segs = types.map((t, i) => {
    const w = (t.n / issues) * inner
    const seg = `<rect x="${x.toFixed(2)}" y="6" width="${w.toFixed(2)}" height="26"
      fill="${fills[i] || SOFT}"${i === types.length - 1 ? ` stroke="${DEEP}" stroke-width="0.6"` : ''}/>`
    x += w
    return seg
  }).join('')

  const sr = types[0]
  // Everything that is not a service request. Named as a subtraction so the
  // number cannot drift from the four rows above it.
  const tail = issues - sr.n
  const tailX = L + (sr.n / issues) * inner

  return `<svg viewBox="0 0 ${W} ${H}" role="img"
    aria-label="A single bar of 2,971 issues split by type: Service request 2,634, Problem 180, Incident 152, Test 5. The 337 that are not service requests occupy the right eleventh of the bar."
    xmlns="http://www.w3.org/2000/svg">
    ${segs}
    <text x="${L + 8}" y="24" font-size="11" font-weight="600" fill="#ffffff"
          font-family="${FONT}">Service request ${n(sr.n)} · ${pct(sr.n, issues)}</text>
    <path d="M ${tailX.toFixed(1)} 44 L ${tailX.toFixed(1)} 38 L ${R} 38 L ${R} 44"
          fill="none" stroke="${MUTED}" stroke-width="0.8"/>
    <text x="${R}" y="58" text-anchor="end" font-size="11" font-weight="700" fill="${INK}"
          font-family="${FONT}">${n(tail)} are not service requests</text>
    <text x="${R}" y="72" text-anchor="end" font-size="9.5" fill="${MUTED}"
          font-family="${FONT}">${types.slice(1).map((t) => `${n(t.n)} ${t.name}`).join(' · ')} — the tracker models none of them.</text>
    <text x="${L}" y="58" font-size="9.5" fill="${MUTED}"
          font-family="${FONT}">Every one of ${n(issues)} rows, at true width.</text>
    <text x="${L}" y="72" font-size="9.5" fill="${MUTED}"
          font-family="${FONT}">The outlined sliver at the far right is ${n(types[types.length - 1].n)} Test tickets.</text>
  </svg>`
}

/* ──────────────────────────────── the page ─────────────────────────────── */

export function page(fx) {
  const ex = fx.export
  const months = ex.months
  const totCreated = months.reduce((s, m) => s + m.created, 0)
  const totResolved = months.reduce((s, m) => s + m.resolved, 0)
  const behind = months.filter((m) => m.created > m.resolved).length
  const peak = months.reduce((a, m) => (m.resolved > a.resolved ? m : a), months[0])
  const first = longMonth(months[0].month)
  const last = longMonth(months[months.length - 1].month)
  const tail = ex.issues - ex.type[0].n

  return `<section class="page">
  <div class="kicker">View 8 of 8</div>
  <h2>The timeline</h2>
  <p class="lede">Every one of the ${n(ex.issues)} exported issues, placed in the month it was raised and the
    month it was closed — ${months.length} months from ${first} to ${last}.</p>

  <div class="box acc">
    <h4>This is the only page with dates on it</h4>
    <p>The tracker records a status per organisation and capability and <b>no date whatsoever</b> &mdash;
      not a start, not a change, not a go-live. Everything below comes from the export instead. For a
      timeline the programme can trust, that file has to come in properly rather than sit beside it.</p>
  </div>

  <div class="vtimeline-chart">${flowChart(months)}</div>

  <p class="vtimeline-cap"><b>${n(totCreated)} created, ${n(totResolved)} resolved</b> across the ${months.length} months;
    created outran resolved in <b>${behind} of ${months.length}</b>. ${longMonth(peak.month)} alone accounts for
    <b>${pct(peak.resolved, totResolved)}</b> of every resolution in the file — ${n(peak.resolved)} against
    ${n(peak.created)} raised. The export cannot tell a fortnight of real closures from a queue tidied in an afternoon, so this reports the shape and stops there.</p>

  <h3 class="vtimeline-h">What kind of ticket this is</h3>
  <div class="vtimeline-band">${typeBand(ex.type, ex.issues)}</div>

  <div class="two">
    <div class="mini"><h4>What it answers</h4>
      <p>When work arrived and when it left. It shows the backlog opening through 2024–25 as created
        outpaced resolved in ${behind} months, and it shows the ${n(peak.resolved)} of ${longMonth(peak.month)}
        as the single largest event in the record. It also shows that ${pct(ex.type[0].n, ex.issues)} of the
        traffic is routine service requests, and that ${n(tail)} issues are problems, incidents and tests that
        the capability tracker has no place to put.</p></div>
    <div class="mini"><h4>What it hides</h4>
      <p><b>This is ticket flow, not capability progress</b> — they are different questions and this chart
        answers only the first. A resolved ticket is not a live interface; ${n(totResolved)} resolutions do not
        make ${n(fx.tracker.totals.live)} live cells. And the ${n(fx.tracker.totals.unrecorded)} unrecorded
        cells <b>cannot appear here at all</b>: the export carries no organisation or capability key, so not one
        of its ${n(ex.issues)} rows can be attributed to a cell. On this page the four states are invisible —
        see views 1 to 7 for them.</p></div>
  </div>

  <div class="grow"></div>
  <div class="foot"><span>Source: ${ex.file} · ${n(ex.issues)} issues · the tracker contributes no dates</span><span>View 8</span></div>
</section>`
}

export const css = `
.vtimeline-chart svg, .vtimeline-band svg { display:block; width:100%; height:auto; }
.vtimeline-chart { margin: 3mm 0 1mm; }
.vtimeline-cap { margin: 0 0 4mm; }
.vtimeline-h { margin: 0 0 1mm; }
.vtimeline-band { margin: 0 0 4mm; }
`
