// The divider before Part D. It exists to change the reader's posture: the
// first three parts are reporting, and everything after this page is a question.

export const css = `
.vlist { display: grid; grid-template-columns: 1fr 1fr; gap: 3mm; margin-top: 4mm; }
.vitem { border: 1px solid var(--rule); border-radius: 2mm; padding: 3.4mm 4mm; background: #fff;
  display: grid; grid-template-columns: 7mm 1fr; gap: 3mm; align-items: start; }
.vitem .vn { background: var(--accent); color: #fff; border-radius: 50%; width: 6.4mm; height: 6.4mm;
  display: flex; align-items: center; justify-content: center; font-size: 9pt; font-weight: 700; }
.vitem .vt { font-size: 9.6pt; line-height: 1.45; color: var(--ink-2); }
.vitem .vt b { color: var(--ink); display: block; font-size: 10.2pt; margin-bottom: 0.6mm; }
`

const VIEWS = [
  ['The heat grid', 'All 1,040 cells at once. The reference the others are judged against.'],
  ['Ranked bars', 'One bar per organization, sorted by how far along it is.'],
  ['Capability cards', 'What a single organization looks like on its own.'],
  ['Ladder swimlanes', 'Grouped by rung — and the three empty rungs are the finding.'],
  ['By owner', 'What one account manager is carrying. And the 33 nobody carries.'],
  ['Treemap', 'Size by how much is recorded, colour by how much is live.'],
  ['Waffle per capability', 'Reads down the capability axis: how far has ADT got, estate-wide.'],
  ['The timeline', 'Three years of flow — and it needs the export, not the tracker.'],
]

export function page() {
  return `<section class="page">
  <div class="kicker">Part D &middot; the part to mark up</div>
  <h1>Eight ways<br>to draw it</h1>
  <p class="lede">The same ${'programme'}, eight times. Each page carries the drawing, what it
  answers, and <b>what it hides</b> &mdash; because every one of them hides something, and a view
  that does not admit what it drops is the dangerous kind.</p>

  <div class="vlist">
    ${VIEWS.map(([t, d], i) => `<div class="vitem"><span class="vn">${i + 1}</span><span class="vt"><b>${t}</b>${d}</span></div>`).join('\n    ')}
  </div>

  <div class="box acc" style="margin-top:5mm">
    <h4>How to mark it</h4>
    <p>Circle the ones you would actually use, cross the ones you would not, and write beside them
    what is missing. <b>More than one can win</b> &mdash; the map screen and a printed pack do not
    have to be the same picture, and two of these together often answer more than any one of them
    alone.</p>
  </div>

  <div class="box warn">
    <h4>The thing to judge them on</h4>
    <p>Every view has to deal with the same awkward fact: <b>634 of the 1,040 cells have never been
    recorded either way</b>. Watch how each one handles that. Some show it plainly, some can only
    imply it, and one or two cannot show it at all &mdash; each page says which it is.</p>
  </div>

  <div class="grow"></div>
  <div class="foot"><span>Part D</span><span>Page 5</span></div>
</section>`
}
