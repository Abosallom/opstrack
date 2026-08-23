// VIEW 3 OF 8 — "Capability cards".
//
// The other views in this catalogue answer questions about the programme. This one answers a
// question about a single organisation: pick any hospital off the tracker and what, exactly,
// does the database know about it? So the unit of the drawing is one card, and the card has to
// survive being read on its own — no cross-referencing a legend three pages back, no reading a
// value off a shared axis. Everything a card needs is printed on the card.
//
// Pure module: it derives every figure from `fx` at render time. No fs, no clock, no network.

const FONT = '-apple-system, Helvetica Neue, Arial, sans-serif';

// Status is the ONLY thing that carries colour in this document (see the shared brief, rule 2).
const LIVE = '#1f7a4d';
const TESTING = '#c98a1a';
const PLANNED = '#b9b4c6';
const HAIRLINE = '#e4e1ec'; // unrecorded: paper, ringed — never a fill
const INK = '#14131a';
const INK2 = '#3f3b4a';
const INK3 = '#6f6a7d';
const ACCENT = '#5a4aa8';

// How many cards fit before a card stops being legible. Five columns leaves ~29mm of clear width
// inside each card: enough for a two-line name at 7pt and a ten-dot strip at 2.1mm without the
// dots touching. Five rows is what the page has left once the specimen band and the two
// mini-boxes have taken their share — six rows overran, and `.page` clips in silence.
const COLS = 5;
const ROWS = 5;
const SHOWN = COLS * ROWS;

const esc = (s) =>
  String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Linear blend between two #rrggbb strings. */
function mix(a, b, t) {
  const p = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const [ar, ag, ab] = p(a);
  const [br, bg, bb] = p(b);
  const c = (x, y) => Math.round(x + (y - x) * t).toString(16).padStart(2, '0');
  return `#${c(ar, br)}${c(ag, bg)}${c(ab, bb)}`;
}

/**
 * The rung tint. One accent ramp, #f1eefb → #5a4aa8, because an ordered ladder encodes as
 * position and depth, not as seven unrelated hues.
 *
 * Paused is deliberately left OUT of the ramp. It sits last in the stage list, so ramping across
 * the raw index would paint Paused the darkest — reading as "furthest along" when it means
 * "stopped". Paused gets a striped edge instead: clearly off the ladder rather than at the end
 * of it.
 */
function rungTint(stages, name) {
  const ladder = stages.filter((s) => !s.paused);
  const i = ladder.findIndex((s) => s.name === name);
  if (i < 0) return null; // paused, or a rung the ladder does not carry
  return mix('#f1eefb', ACCENT, ladder.length > 1 ? i / (ladder.length - 1) : 1);
}

/**
 * Pick the cards. Showing the first 24 alphabetically would quietly turn a page about the
 * programme into a page about the letter A, so the sample is stratified: each rung keeps its
 * real share of the deck (largest-remainder rounding), and within a rung the picks are spread
 * evenly down the alphabetical list rather than taken off the top.
 */
function sample(orgs, stages, n) {
  const order = stages.map((s) => s.name);
  const groups = order
    .map((name) => ({
      name,
      members: orgs.filter((o) => o.stage === name).sort((a, b) => a.name.localeCompare(b.name)),
    }))
    .filter((g) => g.members.length > 0);

  const total = groups.reduce((a, g) => a + g.members.length, 0);
  const exact = groups.map((g) => (g.members.length * n) / total);
  const quota = exact.map(Math.floor);
  let left = n - quota.reduce((a, b) => a + b, 0);
  const byRemainder = exact
    .map((e, i) => ({ i, r: e - Math.floor(e) }))
    .sort((a, b) => b.r - a.r || a.i - b.i);
  for (let k = 0; left > 0; k = (k + 1) % byRemainder.length, left--) {
    quota[byRemainder[k].i] += 1;
  }

  const picked = [];
  groups.forEach((g, gi) => {
    const take = Math.min(quota[gi], g.members.length);
    for (let k = 0; k < take; k++) {
      picked.push(g.members[Math.floor(((k + 0.5) * g.members.length) / take)]);
    }
  });
  return { picked, quota, groups };
}

/** One dot per capability, in the fixed ladder order the tracker stores them in. */
function dots(byCap) {
  return byCap
    .map((v) => {
      const cls =
        v === 'live' ? 'vcards-dl' : v === 'testing' ? 'vcards-dt' : v === 'planned' ? 'vcards-dp' : 'vcards-dn';
      return `<i class="vcards-d ${cls}"></i>`;
    })
    .join('');
}

function card(org, stages, isSpecimen) {
  const tint = rungTint(stages, org.stage);
  const edge = tint
    ? `background:${tint}`
    : // Paused: striped, not deep.
      'background:repeating-linear-gradient(135deg,#cfc6ee 0,#cfc6ee 0.5mm,#ffffff 0.5mm,#ffffff 1.1mm)';
  const owner = org.owner
    ? `<span class="vcards-own">${esc(org.owner)}</span>`
    : `<span class="vcards-own vcards-none">unassigned</span>`;
  return (
    `<article class="vcards-card${isSpecimen ? ' vcards-spec' : ''}">` +
    `<span class="vcards-edge" style="${edge}"></span>` +
    `<div class="vcards-nm">${esc(org.name)}</div>` +
    `<div class="vcards-meta">${owner}<span class="vcards-rung">${esc(org.stage)}</span></div>` +
    `<div class="vcards-dots">${dots(org.byCap)}</div>` +
    `</article>`
  );
}

/**
 * The enlarged specimen. Chosen, not hard-coded: the first organisation that happens to carry
 * all four states at once, so every leader line on the key has something real to point at, and
 * that has an owner and a name short enough to sit on one line at specimen size.
 */
function pickSpecimen(orgs) {
  return (
    orgs.find(
      (o) =>
        o.owner &&
        o.name.length <= 28 &&
        o.live > 0 &&
        o.testing > 0 &&
        o.planned > 0 &&
        o.recorded < o.byCap.length,
    ) || orgs[0]
  );
}

function specimenSvg(fx, spec) {
  const caps = fx.tracker.capabilities;
  const tint = rungTint(fx.tracker.stages, spec.stage) || '#cfc6ee';
  // Every <text> repeats the font stack: SVG text does not inherit the body stack through
  // Chrome's print path, and a fallback serif here would wreck the specimen.
  const t = (x, y, s, fill, txt, weight, anchor) =>
    `<text x="${x}" y="${y}" font-family="${FONT}" font-size="${s}" fill="${fill}"` +
    (weight ? ` font-weight="${weight}"` : '') +
    (anchor ? ` text-anchor="${anchor}"` : '') +
    `>${esc(txt)}</text>`;

  // Card geometry, in millimetres — the viewBox is 1 unit = 1mm so the drawing and the CSS grid
  // below it are speaking the same measure.
  const CX = 1, CY = 4, CW = 66, CH = 32;
  const dotY = CY + 23;
  const dotR = 2.1;
  const gap = 6.2;
  const dot0 = CX + 6;

  const fill = (v) => (v === 'live' ? LIVE : v === 'testing' ? TESTING : v === 'planned' ? PLANNED : '#ffffff');

  const strip = spec.byCap
    .map((v, i) => {
      const cx = dot0 + i * gap;
      return (
        `<circle cx="${cx}" cy="${dotY}" r="${dotR}" fill="${fill(v)}"` +
        (v ? '' : ` stroke="${HAIRLINE}" stroke-width="0.45"`) +
        `/>` +
        t(cx, dotY + 4.6, 2, INK3, String(i + 1), null, 'middle')
      );
    })
    .join('');

  // The key: numbered callouts on the card, explained in the right-hand column.
  const bullet = (n, x, y) =>
    `<circle cx="${x}" cy="${y}" r="1.8" fill="${ACCENT}"/>` +
    `<text x="${x}" y="${y + 0.72}" font-family="${FONT}" font-size="2.2" fill="#ffffff" text-anchor="middle" font-weight="700">${n}</text>`;

  const KX = 76; // left edge of the key column
  const row = (n, y, txt) => bullet(n, KX, y - 0.8) + t(KX + 3.6, y, 2.5, INK2, txt);

  // The dot order is the whole contract of the strip, so the ten names are printed beside it —
  // two columns of five, numbered to match the numerals under the specimen's dots.
  const half = Math.ceil(caps.length / 2);
  const capList = caps
    .map((c, i) => {
      const col = i < half ? 0 : 1;
      const r = i % half;
      const x = KX + 3.6 + col * 48;
      const y = 27.5 + r * 3.2;
      return t(x, y, 2.2, INK3, `${i + 1}`) + t(x + 4, y, 2.2, INK2, c.name);
    })
    .join('');

  return (
    `<svg class="vcards-svg" width="176mm" height="42mm" viewBox="0 0 176 42" role="img" ` +
    `aria-label="An enlarged specimen card for ${esc(spec.name)}, with a numbered key naming its four parts and listing the ten capabilities in their fixed dot order.">` +
    `<rect x="${CX}" y="${CY}" width="${CW}" height="${CH}" rx="1.6" fill="#ffffff" stroke="${HAIRLINE}" stroke-width="0.3"/>` +
    `<rect x="${CX}" y="${CY}" width="1.6" height="${CH}" fill="${tint}"/>` +
    t(CX + 6, CY + 6.8, 3.4, INK, spec.name, 700) +
    t(CX + 6, CY + 11.4, 2.5, INK3, spec.owner) +
    t(CX + 6, CY + 15.6, 2.4, ACCENT, spec.stage, 650) +
    strip +
    t(CX + 6, CY + 31, 2.2, INK3, `${spec.recorded} of its ${spec.byCap.length} cells carry a status`) +
    // Leader lines: card feature (left) elbowed across to its numbered bullet (right). They rise
    // monotonically, so none of them crosses another.
    `<g stroke="${HAIRLINE}" stroke-width="0.3" fill="none">` +
    [
      [CY + 5.8, 5.7],
      [CY + 10.6, 11.2],
      [CY + 14.8, 16.7],
      [dotY, 22.2],
    ]
      .map(([from, to]) => `<path d="M${CX + CW} ${from} H${70.5} V${to} H${KX - 2.4}"/>`)
      .join('') +
    `</g>` +
    row(1, 6.5, 'The name, in full — two lines on the small cards.') +
    row(2, 12, 'The owner, or the word unassigned.') +
    row(3, 17.5, 'The rung. The left edge deepens along the ladder.') +
    row(4, 23, 'Ten dots, one per capability, always this order:') +
    capList +
    `</svg>`
  );
}

export function page(fx) {
  const { capabilities, stages, orgs, totals } = fx.tracker;
  const spec = pickSpecimen(orgs);

  const { picked, quota, groups } = sample(orgs, stages, SHOWN);
  // Make sure the enlarged specimen is one of the cards on the grid, so the reader can see the
  // big drawing shrink to the small one rather than take it on trust.
  const cards = picked.slice();
  if (!cards.some((o) => o.id === spec.id)) {
    const swap = cards.findIndex((o) => o.stage === spec.stage);
    cards[swap < 0 ? 0 : swap] = spec;
  }
  cards.sort((a, b) => {
    const si = stages.findIndex((s) => s.name === a.stage) - stages.findIndex((s) => s.name === b.stage);
    return si || a.name.localeCompare(b.name);
  });

  const spread = groups.map((g, i) => `${g.name} ${quota[i]}`).join(', ');
  const empty = stages.filter((s) => !groups.some((g) => g.name === s.name)).map((s) => s.name);
  const pages = Math.ceil(orgs.length / SHOWN);

  // Rule 3: the denominator is the recorded scope, and it is named out loud.
  const legend = [
    [`vcards-dl`, 'live', `${totals.live}`],
    [`vcards-dt`, 'testing', `${totals.testing}`],
    [`vcards-dp`, 'planned', `${totals.planned}`],
  ]
    .map(
      ([cls, label, n]) =>
        `<span class="vcards-key"><i class="vcards-d ${cls}"></i><b>${label}</b> ${n}</span>`,
    )
    .join('');

  return `<section class="page">
  <div class="kicker">View 3 of 8</div>
  <h2>Capability cards</h2>
  <p class="lede">One card per organisation: its name, who owns it, which rung it stands on, and a ten-dot strip reading left to right through the ten capabilities in ladder order.</p>

  ${specimenSvg(fx, spec)}

  <div class="vcards-legendbar">
    ${legend}
    <span class="vcards-key"><i class="vcards-d vcards-dn"></i><b>unrecorded</b> ${totals.unrecorded} — an empty ring, never a grey fill</span>
    <span class="vcards-key vcards-den">The three coloured counts are of ${totals.recorded} recorded cells.</span>
  </div>

  <div class="vcards-grid">${cards.map((o) => card(o, stages, o.id === spec.id)).join('')}</div>

  <small class="vcards-cap"><b>${cards.length} of the ${orgs.length} organisations</b>, sampled to hold the real rung spread (${esc(spread)}); the deck runs to ${pages} pages of this grid. ${empty.length ? `${empty.map(esc).join(', ')} hold nobody, so no card here can show them.` : ''}</small>

  <div class="two">
    <div class="mini"><h4>What it answers</h4><p>What one organisation looks like, whole: owner, rung and all ${capabilities.length} capabilities on a single object you can point at in a meeting. It is the only view where an empty ring — nobody has said anything — sits beside a grey planned dot at readable size.</p></div>
    <div class="mini"><h4>What it hides</h4><p>${orgs.length - cards.length} organisations are not on the page; the sample stands in for them. Nothing here adds up a column, so you cannot read which capability is furthest ahead, and a card cannot say when a cell was last touched or how long its rung has held.</p></div>
  </div>

  <div class="grow"></div>
  <div class="foot"><span>Capability cards — one organisation, whole</span><span>View 3</span></div>
</section>`;
}

export const css = `
/* .page is a flex column, so anything left shrinkable gets quietly squeezed instead of
   overflowing where you can see it — the specimen band scaled itself down to 40% before this
   line existed. Every block on this page holds its size; the budget is balanced by hand. */
.vcards-svg, .vcards-legendbar, .vcards-grid, .vcards-cap, .vcards-card { flex: none; }
.vcards-svg { display: block; margin: 0.5mm 0 2.5mm; }

/* Status key. Colour appears here and on the dots, nowhere else. */
.vcards-legendbar {
  display: flex; flex-wrap: wrap; align-items: center; gap: 1.6mm 5mm;
  border-top: 1px solid #e4e1ec; border-bottom: 1px solid #e4e1ec;
  padding: 2mm 0; margin-bottom: 3mm;
}
.vcards-key { display: inline-flex; align-items: center; gap: 1.6mm; font-size: 8.6pt; color: #6f6a7d; }
.vcards-key b { color: #14131a; font-weight: 650; }
.vcards-den { color: #6f6a7d; font-style: italic; }

.vcards-grid { display: grid; grid-template-columns: repeat(5, 1fr); gap: 2.2mm; }
.vcards-card {
  position: relative; height: 18mm; overflow: hidden;
  border: 1px solid #e4e1ec; border-radius: 1.6mm; background: #ffffff;
  padding: 1.6mm 1.5mm 1.6mm 3mm;
  display: flex; flex-direction: column;
}
/* The specimen, drawn large above, is also down here at its true size. */
.vcards-card.vcards-spec { border-color: #cfc6ee; background: #faf9fd; }
.vcards-edge { position: absolute; left: 0; top: 0; bottom: 0; width: 1.4mm; }
.vcards-nm {
  font-size: 7pt; line-height: 1.18; font-weight: 650; color: #14131a;
  height: 6.6mm; overflow: hidden; word-break: break-word;
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;
}
.vcards-meta { display: flex; flex-direction: column; gap: 0.2mm; margin-top: 0.4mm; }
.vcards-own { font-size: 6.5pt; line-height: 1.25; color: #3f3b4a; }
.vcards-own.vcards-none { color: #9a95a8; font-style: italic; }
.vcards-rung { font-size: 6.2pt; line-height: 1.25; color: #6f6a7d; letter-spacing: 0.1pt; }
.vcards-dots { display: flex; gap: 0.85mm; margin-top: auto; }

.vcards-d { display: inline-block; width: 2.1mm; height: 2.1mm; border-radius: 50%; flex: none; }
.vcards-dl { background: #1f7a4d; }
.vcards-dt { background: #c98a1a; }
.vcards-dp { background: #b9b4c6; }
/* Four states, not three: unrecorded keeps the paper and takes a hairline ring. */
.vcards-dn { background: #ffffff; box-shadow: inset 0 0 0 0.3mm #e4e1ec; }

.vcards-cap { margin: 2.6mm 0 3mm; font-size: 8.8pt; }
`;
