// View 5 of 8 — "By owner".
//
// The point of this page is a handover: one card per account manager, dense enough that a whole
// book of business fits in a column and can be torn off and handed over. Two decisions drive the
// layout and both are about honesty rather than looks:
//
//  * The 33 unowned organisations are a group like any other, sorted by book size like any other —
//    which puts them first, because they are the biggest book. Hiding them in a footnote would bury
//    the single loudest fact on the page: the largest book, and most of the live capability, is
//    nobody's job.
//  * Every strip is 10 cells wide whether or not anything has been recorded, so an organisation
//    with nothing said about it draws as ten empty outlines instead of vanishing. That is the only
//    way the 634 unrecorded cells stay visible at this density.
//
// Colour is status only (live/testing/planned); the seven rungs are encoded as POSITION on a tick
// rail, never as hue.

const CAP_LIVE = '#1f7a4d';
const CAP_TEST = '#c98a1a';
const CAP_PLAN = '#b9b4c6';

const COLUMNS = 3;

const esc = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const n = (v) => Number(v || 0).toLocaleString('en-GB');

/** Group the organisations by owner; the empty owner is a real group, not a leftover. */
function books(fx) {
  const orgs = fx.tracker.orgs;
  const by = new Map();
  for (const o of orgs) {
    const key = o.owner || '';
    if (!by.has(key)) by.set(key, []);
    by.get(key).push(o);
  }
  const out = [];
  for (const [owner, list] of by) {
    // Organisations with something recorded lead; the ones nobody has said anything about sink to
    // the bottom of the card, where a row of ten empty outlines reads as the owner's to-do list.
    list.sort((a, b) => b.recorded - a.recorded || a.name.localeCompare(b.name));
    const sum = (k) => list.reduce((t, o) => t + (o[k] || 0), 0);
    const cells = list.length * fx.tracker.capabilities.length;
    const recorded = sum('recorded');
    out.push({
      owner,
      orgs: list,
      cells,
      recorded,
      unrecorded: cells - recorded,
      live: sum('live'),
      testing: sum('testing'),
      planned: sum('planned'),
    });
  }
  out.sort((a, b) => b.orgs.length - a.orgs.length || a.owner.localeCompare(b.owner));
  return out;
}

// A book of three or fewer organisations needs no summary bar: the rows already are the summary,
// and the page cannot afford the millimetres.
const isCompact = (b) => b.orgs.length <= 3;

/**
 * Deterministic three-column packing. CSS multi-column balancing is a guess in the print path and
 * this page has no room for a guess — the section is clipped, silently, if a column runs long. So
 * we estimate each card's height in px and drop it into the shortest column ourselves.
 */
function pack(cards) {
  const cols = Array.from({ length: COLUMNS }, () => ({ h: 0, cards: [] }));
  for (const c of cards) {
    // Measured against the printed page, not guessed: full card chrome is ~60px, the compact card
    // (no budget bar) ~36px, and every organisation row is 10.8px.
    const h = (isCompact(c) ? 36 : 60) + c.orgs.length * 11 + 7;
    const target = cols.reduce((a, b) => (b.h < a.h ? b : a));
    target.cards.push(c);
    target.h += h;
  }
  return cols;
}

/** Ten cells, one per capability, in ladder order. null draws as paper with a hairline. */
function strip(byCap, caps) {
  const label = [];
  const cells = byCap
    .map((v, i) => {
      const name = caps[i] ? caps[i].name : `#${i + 1}`;
      label.push(`${name}: ${v || 'not recorded'}`);
      if (v === 'live') return `<i class="vowners-c vowners-c-live"></i>`;
      if (v === 'testing') return `<i class="vowners-c vowners-c-test"></i>`;
      if (v === 'planned') return `<i class="vowners-c vowners-c-plan"></i>`;
      return `<i class="vowners-c vowners-c-none"></i>`;
    })
    .join('');
  return `<span class="vowners-strip" role="img" aria-label="${esc(label.join('; '))}">${cells}</span>`;
}

/** Seven rungs as position. The three that are never occupied stay on the rail, visibly empty. */
function ladder(org, stages) {
  const idx = stages.findIndex((s) => s.name === org.stage);
  const ticks = stages
    .map((s, i) => {
      if (i !== idx) return `<i class="vowners-t"></i>`;
      // A paused organisation sits on a rung but is not moving: outline, not fill. No new hue.
      return `<i class="vowners-t ${s.paused ? 'vowners-t-hold' : 'vowners-t-on'}"></i>`;
    })
    .join('');
  const where = idx < 0 ? 'no stage recorded' : `${org.stage}, rung ${idx + 1} of ${stages.length}`;
  return `<span class="vowners-lad" role="img" aria-label="${esc(where)}">${ticks}</span>`;
}

/** Owner-level bar: the three recorded states as a share of that owner's own cell budget, with
 *  the unrecorded remainder left as paper. The denominator is named in the line above it. */
function budget(b) {
  const pc = (v) => (b.cells ? (v / b.cells) * 100 : 0);
  const seg = (v, cls) =>
    v ? `<i class="vowners-b ${cls}" style="width:${pc(v).toFixed(2)}%"></i>` : '';
  return (
    `<span class="vowners-bar" role="img" aria-label="${esc(
      `${b.live} live, ${b.testing} testing, ${b.planned} planned, ${b.unrecorded} unrecorded of ${b.cells} cells`,
    )}">` +
    seg(b.live, 'vowners-b-live') +
    seg(b.testing, 'vowners-b-test') +
    seg(b.planned, 'vowners-b-plan') +
    `</span>`
  );
}

function card(b, fx) {
  const caps = fx.tracker.capabilities;
  const stages = fx.tracker.stages;
  const unowned = b.owner === '';
  const rows = b.orgs
    .map(
      (o) =>
        `<li class="vowners-r"><span class="vowners-nm">${esc(o.name)}</span>` +
        ladder(o, stages) +
        strip(o.byCap, caps) +
        `</li>`,
    )
    .join('');
  const who = unowned ? 'No owner' : esc(b.owner);
  const count = `${b.orgs.length} ${b.orgs.length === 1 ? 'organisation' : 'organisations'}`;
  const compact = isCompact(b);
  const meta = compact
    ? `${n(b.recorded)} of ${n(b.cells)} cells recorded, ${n(b.unrecorded)} never`
    : `${n(b.recorded)} of ${n(b.cells)} cells recorded — ${n(b.live)} live, ${n(b.testing)} testing, ` +
      `${n(b.planned)} planned; ${n(b.unrecorded)} never recorded`;
  return (
    `<article class="vowners-card${unowned ? ' vowners-card-none' : ''}${
      compact ? ' vowners-card-sm' : ''
    }">` +
    `<div class="vowners-who"><b>${who}</b><span>${count}</span></div>` +
    `<div class="vowners-meta">${meta}</div>` +
    (compact ? '' : budget(b)) +
    `<ul class="vowners-rows">${rows}</ul>` +
    `</article>`
  );
}

export function page(fx) {
  const t = fx.tracker.totals;
  const caps = fx.tracker.capabilities;
  const stages = fx.tracker.stages;
  const cards = books(fx);
  const none = cards.find((c) => c.owner === '');
  const named = cards.filter((c) => c.owner !== '');
  const emptyRungs = stages
    .filter((s) => !fx.tracker.orgs.some((o) => o.stage === s.name))
    .map((s) => s.name);

  const key = caps.map((c, i) => `<b>${i + 1}</b> ${esc(c.name)}`).join(' · ');

  const columns = pack(cards)
    .map((col) => `<div class="vowners-col">${col.cards.map((c) => card(c, fx)).join('')}</div>`)
    .join('');

  return `<section class="page">
  <div class="kicker">View 5 of 8</div>
  <h2>By owner</h2>
  <p class="lede">Every organisation filed under the person accountable for it — and the ${n(
    none ? none.orgs.length : 0,
  )} filed under nobody, which is the largest book on the page and holds ${n(
    none ? none.live : 0,
  )} of the programme's ${n(t.live)} live capabilities.</p>

  <div class="vowners-strap">
    <span><b>${n(t.organizations)}</b> organisations</span>
    <span><b>${n(t.withOwner)}</b> with an owner, across <b>${named.length}</b> people</span>
    <span><b>${n(none ? none.orgs.length : 0)}</b> with none</span>
    <span class="vowners-keyline"><i class="vowners-c vowners-c-live"></i> live <i class="vowners-c vowners-c-test"></i> testing <i class="vowners-c vowners-c-plan"></i> planned <i class="vowners-c vowners-c-none"></i> not recorded</span>
    <span class="vowners-keyline"><i class="vowners-t vowners-t-on"></i> stage <i class="vowners-t vowners-t-hold"></i> paused</span>
  </div>

  <div class="vowners-cols">${columns}</div>

  <p class="vowners-key"><small>Strip positions, left to right: ${key}. Rail: the ${
    stages.length
  } rungs in order — ${esc(stages.map((s) => s.name).join(' → '))}.</small></p>

  <div class="two">
    <div class="mini"><h4>What it answers</h4><p>Who carries how much, and how far along each of their organisations actually is. A card is one person's whole book: hand it over, and every strip on it is a conversation.</p></div>
    <div class="mini"><h4>What it hides</h4><p>Owner is the only grouping: an unowned organisation may well be actively managed, the tracker simply does not say by whom. Long names are clipped to fit the column.</p></div>
  </div>

  <div class="grow"></div>
  <div class="foot"><span>Recorded cells only: ${n(t.recorded)} of ${n(
    t.cells,
  )} possible; the other ${n(t.unrecorded)} are drawn as empty outlines, never as planned.</span><span>View 5</span></div>
</section>`;
}

export const css = `
.vowners-strap{display:flex;flex-wrap:wrap;gap:3mm 6mm;align-items:center;font-size:8.4px;
  color:#4a4459;border-top:0.6px solid #e4e1ec;border-bottom:0.6px solid #e4e1ec;
  padding:1.6mm 0;margin:1.2mm 0 2.6mm}
.vowners-strap b{font-size:10px;color:#2b2735}
.vowners-keyline{display:inline-flex;align-items:center;gap:1.4mm;color:#6b6577}
.vowners-cols{display:flex;gap:5.5mm;align-items:flex-start}
.vowners-col{flex:1 1 0;min-width:0}
.vowners-card{break-inside:avoid;border:0.6px dashed #cfc9dd;border-radius:1mm;
  padding:1.3mm 1.5mm 1.1mm;margin-bottom:1.8mm;background:#fff}
.vowners-card-sm .vowners-meta{margin-bottom:0.6mm}
.vowners-card-none{border-style:solid;border-color:#5a4aa8;background:#faf9fd}
.vowners-who{display:flex;justify-content:space-between;align-items:baseline;gap:2mm}
.vowners-who b{font-size:9.4px;letter-spacing:0.1px;color:#221f2c;white-space:nowrap;
  overflow:hidden;text-overflow:ellipsis}
.vowners-who span{font-size:7.6px;color:#6b6577;white-space:nowrap}
.vowners-card-none .vowners-who b{color:#5a4aa8}
.vowners-meta{font-size:7px;color:#6b6577;line-height:1.3;margin:0.4mm 0 0.8mm}
.vowners-bar{display:flex;height:1.4mm;border:0.5px solid #e4e1ec;background:#fff;
  border-radius:0.4mm;overflow:hidden;margin-bottom:1mm}
.vowners-b{display:block;height:100%}
.vowners-b-live{background:${CAP_LIVE}}
.vowners-b-test{background:${CAP_TEST}}
.vowners-b-plan{background:${CAP_PLAN}}
.vowners-rows{list-style:none;margin:0;padding:0}
.vowners-r{display:flex;align-items:center;gap:1.2mm;height:10.8px}
.vowners-nm{flex:1 1 auto;min-width:0;font-size:8px;line-height:1.1;color:#2b2735;
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.vowners-lad{flex:0 0 auto;display:inline-flex;gap:0.9px;align-items:center}
.vowners-t{display:block;width:2.2px;height:5.4px;background:#ece9f4;border-radius:0.4px}
.vowners-t-on{background:#5a4aa8;height:7px}
.vowners-t-hold{background:#fff;border:0.7px solid #5a4aa8;height:7px}
.vowners-strip{flex:0 0 auto;display:inline-flex;gap:0.9px;align-items:center}
.vowners-c{display:block;width:4.8px;height:6.4px;border-radius:0.4px;
  border:0.5px solid transparent;box-sizing:border-box}
.vowners-c-live{background:${CAP_LIVE}}
.vowners-c-test{background:${CAP_TEST}}
.vowners-c-plan{background:${CAP_PLAN}}
.vowners-c-none{background:#fff;border-color:#e4e1ec}
.vowners-key{margin:2.5mm 0 0;color:#6b6577;line-height:1.4}
.vowners-key small{font-size:7.2px}
.vowners-key b{color:#5a4aa8}
`;
