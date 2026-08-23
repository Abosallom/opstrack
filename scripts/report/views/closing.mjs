// The last page: what happens after the mark-up. It is deliberately a list of
// decisions rather than a list of work, because every item on it is the owner's
// to make and none of it should start before he has.

export function page(fx) {
  const t = fx.tracker.totals
  const e = fx.export
  return `<section class="page">
  <div class="kicker">After you have marked it</div>
  <h2>What happens next</h2>

  <div class="box acc">
    <h4>1 &middot; The views you circled become screens</h4>
    <p>Each one is a day or so of work against data that already exists. Nothing in Part D needs a
    new table or a migration &mdash; views 1 to 7 draw entirely from the
    <b>${t.recorded} links</b> the app holds today.</p>
  </div>

  <div class="box warn">
    <h4>2 &middot; The re-import, to your specification</h4>
    <p>This is the one that changes the data, and it needs decisions only you can make:</p>
    <p style="margin-top:2mm"><b>Which conventions count?</b> Adding the dash form recovers
    ${e ? e.byConvention.dash : '—'} tickets. Adding <b>Interface Build</b> recovers
    ${e ? e.byConvention.interface : '—'} more &mdash; and brings roughly 240 tickets' worth of
    organizations that are on no map today. Are those part of this programme, or a different one?</p>
    <p style="margin-top:2mm"><b>Which capabilities are real?</b> Your export names 113 distinct
    strings against ${t.capabilities?.length ?? fx.tracker.capabilities.length} configured. Do
    XDRADO, XDLABO and XDDOCS become capabilities of their own? Does FHIR-versus-CDA become an axis,
    or stay collapsed?</p>
    <p style="margin-top:2mm"><b>And the housekeeping</b>: delete <b>Lab order</b> and
    <b>Rad order</b>, which are parse artefacts rather than organizations, and merge
    <b>Alfalah Hospita</b> into <b>Alfalah Hospital</b>.</p>
  </div>

  <div class="box">
    <h4>3 &middot; What a fuller import would switch on</h4>
    <p>Every ticket carries a created date, an assignee, a priority, an SLA clock, an environment
    and its own Jira key. Importing those is what makes <b>view 8</b> possible inside the app,
    gives every one of the ${t.organizations} organizations an owner, and lets a node on the map be
    clicked back to the ticket it came from.</p>
  </div>

  <div class="box ok">
    <h4>Nothing has changed yet</h4>
    <p>This document was produced by reading. The live database was not written to, the export was
    opened read-only, and the map is exactly as you left it. The re-import, when you ask for it,
    runs through the same importer as before &mdash; it is repeatable, and it writes an undo file
    every time it runs.</p>
  </div>

  <div class="grow"></div>
  <div class="foot"><span>Next</span><span>Last page</span></div>
</section>`
}
