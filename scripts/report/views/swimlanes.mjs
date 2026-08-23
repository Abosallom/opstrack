// View 4 — Ladder swimlanes.
//
// The tracker's seven stages are a LADDER: they have an order, and the order is the whole point.
// So the rungs are encoded by POSITION (top to bottom) and by an ordinal chip drawn from the single
// accent ramp #f1eefb→#5a4aa8. They are deliberately NOT given seven hues — hue in this document is
// reserved for status (live / testing / planned / unrecorded) and nothing else.
//
// The other decision worth writing down: three rungs hold nobody. It would be easy to drop them and
// get a tidier drawing, and that tidier drawing would be a lie. The empty lanes are the finding —
// they are what shows the ladder has rungs the source data cannot report on — so they are drawn at
// full width, labelled, and given the reason they are empty.

const PAPER = '#ffffff';
const HAIR = '#e4e1ec'; // unrecorded: paper inside a hairline, never a fill
const LIVE = '#1f7a4d';
const TESTING = '#c98a1a';
const PLANNED = '#b9b4c6';
const INK = '#2c2739';
const MUTED = '#6b6480';
const RULE = '#d8d4e4';
const FONT = '-apple-system, Helvetica Neue, Arial, sans-serif';

// Geometry, in viewBox units. 700 units are laid across ~178mm of usable page width,
// so one unit is roughly a quarter of a millimetre.
const W = 700;
const RAIL_X = 8;
const LABEL_X = 30;
const BLOCKS_X = 186;
const PER_ROW = 13; // 65 organisations in the fattest lane divide into exactly five rows
const GAP = 4;
const BW =(W - BLOCKS_X - (PER_ROW - 1) * GAP) / PER_ROW;
const PITCH = BW + GAP;
const BH = 21;
const ROW_PITCH = 26;
const LANE_PAD = 9;
const LANE_GAP = 7;
const LABEL_MIN = 28; // two lines of lane label must always fit, even in a one-row lane
const EMPTY_MIN = 30;

const esc = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// The accent ramp, sampled at seven points. Position is the encoding; the ramp only reinforces it.
function rung(i, n) {
  const a = [241, 238, 251];
  const b = [90, 74, 168];
  const t = n > 1 ? i / (n - 1) : 0;
  const c = a.map((v, k) => Math.round(v + (b[k] - v) * t));
  return `#${c.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

export function page(fx) {
  const stages = fx.tracker.stages;
  const orgs = fx.tracker.orgs;
  const totals = fx.tracker.totals;
  const capCount = fx.tracker.capabilities.length;

  const lanes = stages.map((s, i) => {
    const members = orgs
      .filter((o) => o.stage === s.name)
      // Sorted by how much of its OWN recorded scope is live, so each lane reads as a fill gradient
      // and the leading edge of a lane is visible at a glance.
      .sort(
        (a, b) =>
          b.live / (b.recorded || 1) - a.live / (a.recorded || 1) ||
          b.recorded - a.recorded ||
          a.name.localeCompare(b.name),
      );
    const recorded = members.reduce((t, o) => t + o.recorded, 0);
    const live = members.reduce((t, o) => t + o.live, 0);
    const testing = members.reduce((t, o) => t + o.testing, 0);
    const rows = Math.max(1, Math.ceil(members.length / PER_ROW));
    const body = members.length ? Math.max(rows * ROW_PITCH - (ROW_PITCH - BH), LABEL_MIN) : EMPTY_MIN;
    return { stage: s, index: i, members, recorded, live, testing, rows, body, height: body + LANE_PAD * 2 };
  });

  const H = lanes.reduce((t, l) => t + l.height, 0) + LANE_GAP * (lanes.length - 1) + 4;

  // Why each empty rung is empty. Two different reasons, and neither is "the work stopped".
  const emptyWhy = {
    'Not started': 'No organisation is recorded as untouched — all 104 have already been kicked off.',
    UAT: 'Nothing can stand here: no tracker status means "in UAT", so the rung is unreportable.',
    'Go-live readiness': 'Nothing can stand here either — no status means "ready to go live".',
  };

  let y = 2;
  const parts = [];

  // The rail: a literal ladder upright, with the rungs hanging off it in order.
  parts.push(`<line x1="${RAIL_X}" y1="2" x2="${RAIL_X}" y2="${H - 2}" stroke="${RULE}" stroke-width="1.6"/>`);

  for (const lane of lanes) {
    const top = y;
    const chipY = top + LANE_PAD;
    const fill = rung(lane.index, lanes.length);
    const chipInk = lane.index >= 3 ? '#ffffff' : '#3a3450';
    const empty = lane.members.length === 0;

    parts.push(
      `<rect x="${RAIL_X - 8}" y="${chipY}" width="17" height="15" rx="3" fill="${fill}" stroke="${RULE}" stroke-width="0.6"/>` +
        `<text x="${RAIL_X + 0.5}" y="${chipY + 11}" text-anchor="middle" font-size="9.5" font-weight="700" fill="${chipInk}" font-family="${FONT}">${lane.index + 1}</text>`,
    );

    parts.push(
      `<text x="${LABEL_X}" y="${chipY + 11}" font-size="12" font-weight="700" fill="${empty ? MUTED : INK}" font-family="${FONT}">${esc(lane.stage.name)}</text>`,
    );

    // Every lane names its own denominator out loud: cells RECORDED in this lane, never all 1,040.
    const stat = empty
      ? 'no organisations'
      : `${lane.members.length} org${lane.members.length === 1 ? '' : 's'} · ${lane.recorded} recorded cells · ${lane.live} live`;
    parts.push(
      `<text x="${LABEL_X}" y="${chipY + 24}" font-size="8.6" fill="${MUTED}" font-family="${FONT}">${esc(stat)}</text>`,
    );

    if (empty) {
      parts.push(
        `<line x1="${BLOCKS_X}" y1="${chipY + 14}" x2="${W}" y2="${chipY + 14}" stroke="${HAIR}" stroke-width="1" stroke-dasharray="3 3"/>` +
          `<text x="${BLOCKS_X}" y="${chipY + 10}" font-size="9" fill="${MUTED}" font-style="italic" font-family="${FONT}">${esc(emptyWhy[lane.stage.name] || 'No organisation stands on this rung.')}</text>`,
      );
    } else {
      lane.members.forEach((o, k) => {
        const bx = BLOCKS_X + (k % PER_ROW) * PITCH;
        const by = top + LANE_PAD + Math.floor(k / PER_ROW) * ROW_PITCH;
        const unit = BW / capCount;
        // FOUR states across one block: the block is all ten capability cells. Live, then testing,
        // then planned are FILLED; whatever remains is unrecorded and stays as bare paper inside the
        // hairline — silence drawn as silence, not as grey.
        let cx = bx;
        const seg = [];
        for (const [n, c] of [
          [o.live, LIVE],
          [o.testing, TESTING],
          [o.planned, PLANNED],
        ]) {
          if (n > 0) {
            seg.push(`<rect x="${cx.toFixed(2)}" y="${by}" width="${(n * unit).toFixed(2)}" height="${BH}" fill="${c}"/>`);
            cx += n * unit;
          }
        }
        const unrec = capCount - o.recorded;
        parts.push(
          `<rect x="${bx.toFixed(2)}" y="${by}" width="${BW.toFixed(2)}" height="${BH}" fill="${PAPER}"/>` +
            seg.join('') +
            `<rect x="${bx.toFixed(2)}" y="${by}" width="${BW.toFixed(2)}" height="${BH}" fill="none" stroke="${HAIR}" stroke-width="0.9"/>` +
            `<title>${esc(o.name)} — ${o.recorded} of ${capCount} cells recorded, ${o.live} live, ${o.testing} in testing, ${o.planned} planned, ${unrec} unrecorded</title>`,
        );
      });
    }

    y = top + lane.height;
    if (lane.index < lanes.length - 1) {
      parts.push(`<line x1="0" y1="${(y + LANE_GAP / 2).toFixed(1)}" x2="${W}" y2="${(y + LANE_GAP / 2).toFixed(1)}" stroke="${HAIR}" stroke-width="0.8"/>`);
      y += LANE_GAP;
    }
  }

  const emptyNames = lanes.filter((l) => !l.members.length).map((l) => l.stage.name);
  const svg =
    `<svg class="vswimlanes-svg" viewBox="0 0 ${W} ${H.toFixed(0)}" width="${W}" height="${H.toFixed(0)}" role="img" ` +
    `aria-label="Seven ladder rungs as horizontal lanes, in order from Not started to Paused. Each organisation is one block of ten capability cells, filled green for live, amber for testing, grey for planned, bare paper for unrecorded. Kickoff holds 27 organisations, Integrating and Testing 65, Live 6, Paused 6; Not started, UAT and Go-live readiness hold none.">` +
    parts.join('') +
    `</svg>`;

  return `<section class="page">
  <div class="kicker">View 4 of 8</div>
  <h2>Ladder swimlanes</h2>
  <p class="lede">Every organisation stands on one rung. The rungs run top to bottom in ladder order, and each block is one organisation's ten capability cells — so you can see both where the programme's weight sits and how much of each organisation's own recorded work has actually gone live.</p>

  <div class="vswimlanes-key">
    <span class="vswimlanes-k"><i style="background:${LIVE}"></i>live</span>
    <span class="vswimlanes-k"><i style="background:${TESTING}"></i>in testing</span>
    <span class="vswimlanes-k"><i style="background:${PLANNED}"></i>planned</span>
    <span class="vswimlanes-k"><i class="vswimlanes-none"></i>unrecorded — nobody has said anything</span>
    <span class="vswimlanes-k vswimlanes-rd">block = 10 capability cells, filled from the left</span>
  </div>

  ${svg}

  <div class="box warn"><h4>Three rungs are empty, and that is the finding</h4><p>${esc(emptyNames.join(', '))} hold no organisation at all. ${emptyNames.length} of the seven rungs the ladder defines cannot be reported on, because the tracker has no status that puts an organisation there. In practice work steps from <b>Integrating &amp; Testing</b> straight to <b>Live</b>, and the two rungs meant to catch it in between — user acceptance and go-live readiness — never see it. Drawn, not deleted.</p></div>

  <div class="two">
    <div class="mini"><h4>What it answers</h4><p>Where the weight sits: ${totals.organizations} organisations, ${lanes[2].members.length} of them stuck in Integrating &amp; Testing against ${lanes[5].members.length} live and ${lanes[6].members.length} paused. And per organisation, how full the block is — ${totals.live} of the ${totals.recorded} <b>recorded</b> cells are live across the whole programme, but a Kickoff block is nearly all grey while a Live block is solid green.</p></div>
    <div class="mini"><h4>What it hides</h4><p>Names, owners and dates. A block does not say which organisation it is, which of the ${capCount} capabilities are live within it, who owns it (${totals.organizations - totals.withOwner} have nobody), or how long it has stood on its rung — so a lane cannot tell a fresh arrival from one that has not moved in months.</p></div>
  </div>

  <div class="grow"></div>
  <div class="foot"><span>Rungs ordered by position, not by colour · ${totals.unrecorded} of ${totals.cells} cells are unrecorded and drawn as paper</span><span>View 4</span></div>
</section>`;
}

export const css = `
.vswimlanes-key{display:flex;flex-wrap:wrap;gap:4mm;align-items:center;margin:2mm 0 3mm;font-size:7.6pt;color:#4a4459}
.vswimlanes-k{display:inline-flex;align-items:center;gap:1.4mm}
.vswimlanes-k i{display:inline-block;width:4.4mm;height:2.6mm;border-radius:0.5mm}
.vswimlanes-none{background:#fff;box-shadow:inset 0 0 0 0.28mm #e4e1ec}
.vswimlanes-rd{margin-left:auto;color:#6b6480;font-style:italic}
.vswimlanes-svg{display:block;width:100%;height:auto;margin:0 0 3mm}
`;
