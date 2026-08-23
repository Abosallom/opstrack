// View 7 of 8 — a waffle block per capability.
//
// Why this view exists at all: every other page in the catalogue reads ACROSS an organization
// ("how is this hospital doing"). The owner's other question is the transposed one — "how far has
// ADT got across the whole estate" — and nothing else in the deck answers it. This page reads DOWN
// the capability axis.
//
// Why 104 squares and not a bar: a bar answers with a length he has to take on trust. 104 squares
// IS the estate, one square per organization, so he can count them. The blanks are the point — the
// squares nobody has recorded that capability for are left as paper with a hairline, never filled.
//
// Why each block sorts its own squares: this is a magnitude question, so statuses stack. The price
// is that square (row 3, col 7) is a different hospital in every block. That cost is declared in
// "what it hides" rather than left for a reader to trip over.

const CAP_COLS = 13; // 13 x 8 = 104 = one square per organization, exactly. No remainder to fudge.
const CAP_ROWS = 8;

// The svg is drawn at 178mm wide (A4 210mm less the page's 2 x 16mm padding), so one viewBox unit
// is one millimetre. Every number below can be read straight off a ruler.
const PITCH = 3.2;
const SQ = 2.72;
const COL_PITCH = 44.5; // 178 / 4 blocks per row
const BLOCK_H = 50;
const VB_W = 178;
const VB_H = 144;

// Rule 2: colour means STATUS only. There is no hue for the seven rungs anywhere on this page.
const LIVE = '#1f7a4d';
const TESTING = '#c98a1a';
const PLANNED = '#b9b4c6';
const HAIR = '#e4e1ec';
const PAPER = '#ffffff';
const INK = '#241f31';
const MUTED = '#6b6577';
const FAINT = '#9a94a8';

// Chrome's print path does not let svg <text> inherit the body stack, so this is repeated on every
// single text node below. The repo has paid for forgetting this before.
const FF = '-apple-system, Helvetica Neue, Arial, sans-serif';

const RANK = { live: 0, testing: 1, planned: 2 };
const FILL = { live: LIVE, testing: TESTING, planned: PLANNED };

const esc = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// Pure formatter — no Intl, no locale, so the printed page is the same on any machine.
const n = (v) => String(v).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

function text(x, y, body, opts = {}) {
  const { size = 2.4, fill = INK, weight = 400, anchor = 'start' } = opts;
  const w = weight !== 400 ? ` font-weight="${weight}"` : '';
  const a = anchor !== 'start' ? ` text-anchor="${anchor}"` : '';
  return `<text x="${x}" y="${y}" font-family="${FF}" font-size="${size}" fill="${fill}"${w}${a}>${body}</text>`;
}

// One square. Unrecorded is deliberately NOT a fill: it is the paper with a hairline round it, so a
// blank cannot be mistaken for the grey of 'planned' at arm's length or in photocopy.
function square(x, y, status) {
  if (!status) {
    return `<rect x="${x}" y="${y}" width="${SQ}" height="${SQ}" rx="0.35" fill="${PAPER}" stroke="${HAIR}" stroke-width="0.22"/>`;
  }
  return `<rect x="${x}" y="${y}" width="${SQ}" height="${SQ}" rx="0.35" fill="${FILL[status]}"/>`;
}

function block(stat, x, y) {
  const parts = [];
  parts.push(text(x, y + 6.4, esc(stat.name), { size: 2.8, weight: 600 }));

  const top = y + 8.6;
  // Row-major fill of the sorted statuses: live first, then testing, planned, and the blanks last,
  // so the solid mass sits at the top of the block and the paper falls out of the bottom.
  for (let i = 0; i < stat.cells.length; i++) {
    const r = Math.floor(i / CAP_COLS);
    const c = i % CAP_COLS;
    parts.push(square(x + c * PITCH, top + r * PITCH, stat.cells[i]));
  }

  const below = top + CAP_ROWS * PITCH;
  parts.push(
    text(x, below + 4.2, `${n(stat.recorded)} recorded, ${n(stat.live)} live`, {
      size: 2.5,
      fill: MUTED,
    })
  );
  const blankLine = stat.blank === 0
    ? 'recorded for every organization'
    : `${n(stat.blank)} never recorded`;
  parts.push(text(x, below + 7.7, blankLine, { size: 2.3, fill: FAINT }));
  return parts.join('');
}

function legend(totals, x, y) {
  // The fourth swatch passes null on purpose: the key is drawn by the same square() as the blocks,
  // so the blank in the key cannot drift away from the blank on the page.
  const rows = [
    ['live', `live — ${n(totals.live)} cells across the estate`],
    ['testing', `testing — ${n(totals.testing)}`],
    ['planned', `planned — ${n(totals.planned)}`],
    [null, `unrecorded — ${n(totals.unrecorded)} squares left as paper`],
  ];
  const parts = [text(x, y + 6.4, 'How to read a block', { size: 2.8, weight: 600 })];
  rows.forEach(([status, label], i) => {
    const ry = y + 11.6 + i * 6;
    parts.push(square(x, ry, status));
    parts.push(text(x + 5, ry + 2.2, esc(label), { size: 2.4, fill: MUTED }));
  });
  parts.push(
    text(
      x,
      y + 39.2,
      `Every block holds all ${n(totals.organizations)} organizations; blocks run most-live first.`,
      { size: 2.2, fill: FAINT }
    )
  );
  parts.push(
    text(
      x,
      y + 42.4,
      `Counts are of the ${n(totals.recorded)} recorded cells, never of ${n(totals.cells)}.`,
      { size: 2.2, fill: FAINT }
    )
  );
  return parts.join('');
}

export function page(fx) {
  const caps = fx.tracker.capabilities;
  const orgs = fx.tracker.orgs;
  const totals = fx.tracker.totals;

  const stats = caps.map((cap, i) => {
    const cells = orgs.map((o) => o.byCap[i]);
    const live = cells.filter((v) => v === 'live').length;
    const testing = cells.filter((v) => v === 'testing').length;
    const planned = cells.filter((v) => v === 'planned').length;
    // Sort by status severity so the block stacks; null sorts last and stays null, never coerced.
    const sorted = cells
      .slice()
      .sort((a, b) => (a === null ? 3 : RANK[a]) - (b === null ? 3 : RANK[b]));
    return {
      name: cap.name,
      ladder: i,
      cells: sorted,
      live,
      testing,
      planned,
      recorded: live + testing + planned,
      blank: cells.length - (live + testing + planned),
    };
  });

  // Adoption order: most live first. Ties break on recorded scope, then on the original ladder
  // order, so the sort is stable and reproducible run to run.
  const ordered = stats
    .slice()
    .sort((a, b) => b.live - a.live || b.recorded - a.recorded || a.ladder - b.ladder);

  const body = ordered
    .map((s, i) => block(s, (i % 4) * COL_PITCH, Math.floor(i / 4) * BLOCK_H))
    .join('');

  // Ten blocks in a four-wide grid leave the last two slots of the bottom row free; the key goes
  // there rather than stealing a strip of its own.
  const key = legend(totals, 2 * COL_PITCH, 2 * BLOCK_H);

  const leader = ordered[0];
  const laggard = ordered[ordered.length - 1];

  const aria =
    `Ten waffle blocks, one per capability. Each block is ${n(totals.organizations)} squares, ` +
    `one per organization, coloured green for live, amber for testing, grey for planned, and left ` +
    `blank where nobody has recorded that capability. Blocks run most-live first, from ` +
    `${leader.name} with ${leader.live} live to ${laggard.name} with ${laggard.live}.`;

  return `<section class="page">
  <div class="kicker">View 7 of 8</div>
  <h2>Waffle per capability</h2>
  <p class="lede">Ten blocks of ${n(totals.organizations)} squares — one square per organization — showing how far each capability has travelled across the whole estate, and how much of the estate has never been asked.</p>
  <div class="vwaffle-wrap">
    <svg viewBox="0 0 ${VB_W} ${VB_H}" role="img" aria-label="${esc(aria)}">
      ${body}
      ${key}
    </svg>
  </div>
  <div class="two">
    <div class="mini"><h4>What it answers</h4><p>How far up the estate each rung of the capability ladder has actually got. ${esc(leader.name)} leads with <b>${n(leader.live)} live of ${n(leader.recorded)} recorded</b>; ${esc(laggard.name)} has <b>${n(laggard.live)}</b>. The paper in each block is the honest answer to “how many organizations have we simply never asked about this?” — ${n(totals.unrecorded)} squares across the ten blocks.</p></div>
    <div class="mini"><h4>What it hides</h4><p>Organization identity: because each block sorts its own squares, a given square is a <b>different</b> hospital in every block — positions are not comparable across blocks, only totals are. It also hides the seven-rung journey and the ${n(totals.organizations - totals.withOwner)} organizations with no owner; a capability can read “live” here while its organization sits on Paused.</p></div>
  </div>
  <div class="grow"></div>
  <div class="foot"><span>${n(totals.recorded)} recorded cells of ${n(totals.cells)} · ${n(totals.unrecorded)} left blank · counts are of recorded scope</span><span>View 7</span></div>
</section>`;
}

export const css = `
.vwaffle-wrap { margin: 5mm 0 4mm; }
.vwaffle-wrap svg { display: block; width: 100%; height: auto; }
`;
