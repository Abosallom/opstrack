// The cover. It has one job: tell the reader this document asks him a question
// rather than answering one.

export function page(fx) {
  const t = fx.tracker.totals
  const e = fx.export
  const day = new Date(fx.generatedAt).toLocaleDateString('en-GB', {
    day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Riyadh',
  })
  return `<section class="page">
  <div class="kicker">Read from your live project and your Jira export &middot; ${day}</div>
  <h1>Ways to see<br>the programme</h1>
  <p class="lede">Eight ways to draw the same thing, so you can point at the one you want.
  <b>Mark the pages you like.</b> What you mark becomes the screen, and the same mark-up becomes
  the specification for a correct re-import.</p>

  <div class="stat">
    <div><div class="n">${t.organizations}</div><div class="l">organizations<br>on the map</div></div>
    <div class="ok"><div class="n">${t.live}</div><div class="l">capabilities live,<br>of ${t.recorded} recorded</div></div>
    <div class="warn"><div class="n">${t.unrecorded}</div><div class="l">cells nobody<br>has recorded</div></div>
    <div class="warn"><div class="n">${e ? Math.round((1 - e.byConvention.pipe / e.issues) * 100) + '%' : '—'}</div><div class="l">of your export<br>is not on the map</div></div>
  </div>

  <div class="box bad">
    <h4>Start here, because it changes what you are looking at</h4>
    <p>Your export holds <b>${e ? e.issues.toLocaleString('en-GB') : '—'} tickets</b>. The tracker
    was built from <b>${e ? e.byConvention.pipe : '—'}</b> of them. It is not a drawing fault
    &mdash; the importer only ever understood one sentence pattern, so everything written any
    other way never arrived. <b>Part C draws that gap.</b></p>
  </div>

  <div class="box acc">
    <h4>What is in here</h4>
    <p><b>Part A</b> &mdash; where the programme is, from the tracker.<br>
    <b>Part B</b> &mdash; three years of history the app cannot show at all.<br>
    <b>Part C</b> &mdash; the gap between your export and your map.<br>
    <b>Part D</b> &mdash; <b>eight candidate views.</b> This is the part to mark up.</p>
  </div>

  <div class="box">
    <h4>One convention, used on every page</h4>
    <p>Colour means <b>status</b> and nothing else &mdash; green live, amber testing, grey planned.
    A cell left as <b>paper</b> means nobody has said anything about it, which is a different fact
    from &ldquo;planned&rdquo; and is never drawn as one. The seven rungs of the ladder carry
    <b>no colour</b>: an ordered ladder reads as position, and giving it seven hues would ask you
    to decode two things at once.</p>
  </div>

  <div class="grow"></div>
  <div class="foot"><span>NphiesCore &middot; interfaces</span><span>Page 1</span></div>
</section>`
}
