// View 2 of 8 — "Ranked bars".
//
// One row per organisation, 104 of them, each row ten segments wide in the fixed ladder order.
// The whole point of this view is that segment 4 is Medication Dispense V1 on EVERY row, so the
// reader can run their eye down a column and see a capability the cohort cleared together. That
// means no per-row sorting of segments and no variable-width bars, however tempting.
//
// Why two columns of 52 rather than a top-34/bottom-34 sandwich: the sandwich hides the 36 rows
// in the middle, and the middle is where this programme actually lives (65 of 104 orgs sit in
// Integrating & Testing). Two columns costs us nothing but a narrower name gutter and shows all
// 104. Nothing is omitted; the page says so out loud.

const PAPER_HAIRLINE = '#e4e1ec';
const FILL = { live: '#1f7a4d', testing: '#c98a1a', planned: '#b9b4c6' };
const INK = '#2b2733';
const MUTED = '#6f6980';
const FONT = '-apple-system, Helvetica Neue, Arial, sans-serif';

// Abbreviations for the column header. Index-aligned to fx.tracker.capabilities; the page prints
// the expansion underneath so the shorthand is never load-bearing on its own.
const ABBR = ['ADT', 'MP1', 'MP2', 'MD1', 'MD2', 'RO', 'RR', 'LO', 'LR', 'CN'];

// Geometry, in millimetres — the SVG viewBox is millimetres so the print path needs no scaling
// arithmetic and a 0.15 hairline stays a hairline at 300dpi.
const W = 178;
const COL_W = 86;
const COL_GAP = 6;
const HEAD_H = 6.2;
// 2.95mm of row pitch is the tightest that still leaves the 5.5pt name a clear baseline; it is
// also what keeps 52 rows plus the legend and the two mini-columns inside the A4 clip.
const ROW_H = 2.95;
const ROWS_PER_COL = 52;
const BAR_X = 39;
const SEG_W = 4.3;
const SEG_GAP = 0.3;
const BAR_H = 2.0;
// Extra breathing room after ADT and after the four medication rungs. Purely an eye-anchor so a
// reader 40 rows down still knows which segment they are looking at.
const GROUP_BREAK = { 0: 0.5, 4: 0.5 };
const H = HEAD_H + ROWS_PER_COL * ROW_H + 2;

const NAME_MAX = 30;

const esc = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const clip = (s) => (s.length > NAME_MAX ? s.slice(0, NAME_MAX - 1).trimEnd() + '…' : s);

// Millimetre coordinates accumulate binary-float dust (57.900000000000006). Two decimals is a
// hundredth of a millimetre — well past what any printer resolves — and it keeps the markup small.
const n = (v) => String(Math.round(v * 100) / 100);

// 1,040 reads as a quantity; 1040 reads as a part number.
const num = (v) => v.toLocaleString('en-GB');

function segX(i) {
  let x = BAR_X;
  for (let k = 0; k < i; k++) x += SEG_W + SEG_GAP + (GROUP_BREAK[k] || 0);
  return x;
}
const BAR_END = segX(9) + SEG_W;

function txt(x, y, s, { size = 1.95, fill = INK, anchor = 'start', weight = 400 } = {}) {
  return (
    `<text x="${n(x)}" y="${n(y)}" font-family="${FONT}" font-size="${size}" fill="${fill}"` +
    (anchor === 'start' ? '' : ` text-anchor="${anchor}"`) +
    (weight === 400 ? '' : ` font-weight="${weight}"`) +
    `>${s}</text>`
  );
}

function row(org, rank, ox, oy) {
  let out = txt(ox + 4.6, oy + 2.2, String(rank), { size: 1.7, fill: MUTED, anchor: 'end' });
  out += txt(ox + 6, oy + 2.2, esc(clip(org.name)), { size: 1.95 });
  for (let i = 0; i < 10; i++) {
    const state = org.byCap[i];
    const x = ox + segX(i);
    const y = oy + 0.5;
    if (state) {
      out += `<rect x="${n(x)}" y="${n(y)}" width="${SEG_W}" height="${BAR_H}" fill="${FILL[state]}"/>`;
    } else {
      // RULE 1. null is not "planned" — nobody has said anything. It gets the paper and a
      // hairline, never a fill, so an empty run reads as silence rather than as intent.
      out += `<rect x="${n(x)}" y="${n(y)}" width="${SEG_W}" height="${BAR_H}" fill="none" stroke="${PAPER_HAIRLINE}" stroke-width="0.15"/>`;
    }
  }
  return out;
}

function columnHead(ox, label) {
  let out = txt(ox + 6, 2.4, label, { size: 1.85, fill: MUTED, weight: 600 });
  for (let i = 0; i < 10; i++) {
    out += txt(ox + segX(i) + SEG_W / 2, 2.4, ABBR[i], {
      size: 1.6,
      fill: MUTED,
      anchor: 'middle',
    });
  }
  out += `<line x1="${n(ox + 6)}" y1="${n(HEAD_H - 2.4)}" x2="${n(ox + BAR_END)}" y2="${n(HEAD_H - 2.4)}" stroke="${PAPER_HAIRLINE}" stroke-width="0.25"/>`;
  return out;
}

export function page(fx) {
  const t = fx.tracker.totals;
  const caps = fx.tracker.capabilities;

  // "Sorted by progress" without inventing a weighting: a cascade of counts the page can state in
  // one clause. Capabilities live, then in testing, then merely planned, then name. No score, no
  // made-up coefficients to defend.
  const orgs = [...fx.tracker.orgs].sort(
    (a, b) =>
      b.live - a.live ||
      b.testing - a.testing ||
      b.planned - a.planned ||
      a.name.localeCompare(b.name),
  );

  // RULE 3. The denominator is the recorded scope, 406 — never 1,040.
  const pct = (cells) => Math.round((cells / t.recorded) * 100);

  // Rung occupancy is counted, not asserted — three of the seven rungs are genuinely empty and the
  // page names them rather than quietly dropping them off the ladder.
  const tally = new Map(fx.tracker.stages.map((s) => [s.name, 0]));
  for (const o of fx.tracker.orgs) tally.set(o.stage, (tally.get(o.stage) || 0) + 1);
  const onRung = (name) => tally.get(name.replace('&amp;', '&')) || 0;
  const emptyNames = fx.tracker.stages.filter((s) => !tally.get(s.name)).map((s) => s.name);
  const emptyRungs = emptyNames.length;
  const emptyRungNames = emptyNames.join(', ');

  let body = '';
  body += columnHead(0, `Ranks 1–${ROWS_PER_COL}`);
  body += columnHead(COL_W + COL_GAP, `Ranks 53–${orgs.length}`);
  orgs.forEach((o, idx) => {
    const col = idx < ROWS_PER_COL ? 0 : 1;
    const ox = col * (COL_W + COL_GAP);
    const oy = HEAD_H + (idx - col * ROWS_PER_COL) * ROW_H;
    body += row(o, idx + 1, ox, oy);
  });
  // A rule down the gutter, so the two columns read as two lists and not as one 20-wide bar.
  body += `<line x1="${n(COL_W + COL_GAP / 2)}" y1="${n(HEAD_H - 3)}" x2="${n(COL_W + COL_GAP / 2)}" y2="${n(H - 2)}" stroke="${PAPER_HAIRLINE}" stroke-width="0.25"/>`;

  const svg =
    `<svg class="vranked-svg" role="img" width="${W}mm" height="${H}mm" viewBox="0 0 ${W} ${H}" ` +
    `aria-label="One horizontal bar per organisation, ${orgs.length} rows in two columns of ${ROWS_PER_COL}, ` +
    `ranked by capabilities live then testing then planned. Each bar is ten segments in fixed ladder order; ` +
    `filled segments are live, testing or planned, outlined empty segments are the ${t.unrecorded} cells nobody has recorded.">` +
    body +
    `</svg>`;

  // ADT is its own abbreviation; printing "ADT ADT" would look like a bug in the key.
  const key = caps
    .map((c, i) => (ABBR[i] === c.name ? `<b>${esc(c.name)}</b>` : `<b>${ABBR[i]}</b>&nbsp;${esc(c.name)}`))
    .join(' · ');

  const swatch = (fill, label, outline) =>
    `<span class="vranked-key"><i class="vranked-sw" style="background:${outline ? 'transparent' : fill};` +
    `border:${outline ? `0.4mm solid ${PAPER_HAIRLINE}` : '0'}"></i>${label}</span>`;

  return `<section class="page">
  <div class="kicker">View 2 of 8</div>
  <h2>Ranked bars</h2>
  <p class="lede">Every organisation gets one row, ranked by how far its capabilities have travelled; the ten segments sit in the same ladder order on every row, so a column read downwards is one capability across the whole cohort.</p>

  <div class="vranked-legend">
    ${swatch(FILL.live, `Live — ${t.live} cells (${pct(t.live)}% of the ${t.recorded} recorded)`)}
    ${swatch(FILL.testing, `Testing — ${t.testing} (${pct(t.testing)}%)`)}
    ${swatch(FILL.planned, `Planned — ${t.planned} (${pct(t.planned)}%)`)}
    ${swatch(null, `Not recorded — ${t.unrecorded} cells, drawn as paper with a hairline`, true)}
  </div>

  ${svg}

  <p class="vranked-note"><b>Nothing is omitted.</b> All ${orgs.length} organisations are drawn: ranks 1–${ROWS_PER_COL} run down the left column, ${ROWS_PER_COL + 1}–${orgs.length} down the right. The only thing cut is text — organisation names longer than ${NAME_MAX} characters end in an ellipsis. No bar is shortened and no row is dropped. Order: most capabilities <i>live</i> first, then most in <i>testing</i>, then most <i>planned</i>, then alphabetically.</p>
  <p class="vranked-note vranked-caps">${key}</p>

  <div class="two">
    <div class="mini"><h4>What it answers</h4><p>Who is furthest along, and on which capability they got there. Because the segments never move, an unbroken vertical stripe means the cohort cleared that rung together, and a column of outlines means nobody has been asked about it. The ${t.unrecorded} outlined segments are the loudest thing on the page — the programme has an opinion on ${t.recorded} of ${num(t.cells)} cells and no opinion at all on the rest.</p></div>
    <div class="mini"><h4>What it hides</h4><p>The rung ladder entirely: the ${onRung('Kickoff')} organisations in Kickoff, the ${onRung('Integrating &amp; Testing')} in Integrating &amp; Testing, the ${onRung('Live')} Live, the ${onRung('Paused')} Paused and the ${emptyRungs} rungs nobody occupies (${esc(emptyRungNames)}) are all invisible here, so a paused organisation and a busy one sit side by side when their cells match. Owners too — ${t.organizations - t.withOwner} of the ${t.organizations} have none. And a bar counts cells, not size: a large hospital and a single clinic get the same ten squares.</p></div>
  </div>

  <div class="grow"></div>
  <div class="foot"><span>Ranked bars · ${orgs.length} organisations · ${t.recorded} recorded cells of ${num(t.cells)}</span><span>View 2</span></div>
</section>`;
}

export const css = `
.vranked-legend{display:flex;flex-wrap:wrap;gap:1.5mm 5mm;margin:2mm 0 2.4mm;font-size:7.6pt;line-height:1.3;color:#3a3546}
.vranked-key{display:inline-flex;align-items:center;gap:1.4mm;white-space:nowrap}
.vranked-sw{display:inline-block;width:3.4mm;height:2.1mm;box-sizing:border-box;flex:none}
.vranked-svg{display:block;margin:0 auto}
.vranked-note{font-size:7.2pt;line-height:1.35;color:#4a4457;margin:2.2mm 0 0}
.vranked-caps{font-size:6.8pt;color:#6f6980;margin-top:1.2mm}
.vranked-caps b{color:#3a3546}
`;
