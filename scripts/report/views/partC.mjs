// Part C — the gap, drawn.
//
// The single most important page in the document: it is the answer to "the mind
// map still does not reflect what is in the export". Everything on it is
// measured from the owner's own export file, not from the repo's prose.

const F = 'font-family="-apple-system, Helvetica Neue, Arial, sans-serif"'

export const css = `
.gap-fun { margin: 3mm 0 4mm; }
.gap-row { display: grid; grid-template-columns: 52mm 1fr 26mm; gap: 3mm; align-items: center; margin-bottom: 2.2mm; }
.gap-row .lbl { font-size: 9.6pt; color: var(--ink-2); }
.gap-row .lbl b { color: var(--ink); }
.gap-row .tr { height: 7mm; background: #fff; border-radius: 1.2mm; overflow: hidden; border: 1px solid var(--rule); }
.gap-row .fl { height: 100%; }
.gap-row .v { font-size: 9.4pt; font-weight: 700; text-align: right; color: var(--ink-3); }
.gap-in .fl { background: #1f7a4d; } .gap-out .fl { background: #b9b4c6; }
.gap-row.gap-in .v { color: #1f7a4d; }
.miss { display: grid; grid-template-columns: 1fr 1fr; gap: 4mm; margin-top: 3mm; }
.miss ul { margin: 1.5mm 0 0; padding-left: 4.5mm; }
.miss li { font-size: 9.2pt; color: var(--ink-2); line-height: 1.55; }
`

export function page(fx) {
  const e = fx.export
  if (!e) return ''
  const c = e.byConvention
  const total = e.issues
  const pct = (n) => ((n / total) * 100).toFixed(1)
  const row = (label, n, sub, inTracker) =>
    `<div class="gap-row ${inTracker ? 'gap-in' : 'gap-out'}">
      <span class="lbl"><b>${label}</b><br><small style="display:block;font-size:8.4pt">${sub}</small></span>
      <span class="tr"><span class="fl" style="width:${(n / total) * 100}%"></span></span>
      <span class="v">${n.toLocaleString('en-GB')}</span>
    </div>`

  return `<section class="page">
  <div class="kicker">Part C &middot; measured from ${e.file}</div>
  <h2>The gap</h2>
  <p class="lede">Your export holds <b>${total.toLocaleString('en-GB')} tickets</b>. The tracker was
  built from <b>${c.pipe}</b> of them &mdash; the ones written exactly as
  <code>Onboarding | Org | Use case</code>.</p>

  <div class="gap-fun">
    ${row('On the map', c.pipe, `${pct(c.pipe)}% &mdash; the pipe convention, read as ${fx.tracker.totals.recorded} links`, true)}
    ${row('Interface Build', c.interface, 'a second convention nobody taught the reader', false)}
    ${row('Onboarding, written with a dash', c.dash, 'dropped on punctuation alone', false)}
    ${row('Everything else', c.other, 'whitelisting, SSO, errors, config, deployments', false)}
  </div>

  <div class="box bad">
    <h4>It is not a drawing fault</h4>
    <p>The map draws everything it was given. The <b>importer only ever understood one sentence
    pattern</b>, so ${(total - c.pipe).toLocaleString('en-GB')} tickets &mdash;
    <b>${pct(total - c.pipe)}%</b> of your export &mdash; never reached it. That includes
    <b>${c.interface} Interface Build tickets</b>, of which many are still open.</p>
  </div>

  <div class="miss">
    <div>
      <h3>Organizations that are missing</h3>
      <ul>
        <li>Jazan Cluster (MCC)</li>
        <li>Makkah 2 (MCC)</li>
        <li>Shefa Specialized Hospital</li>
        <li><b>~240 Interface Build tickets</b> name organizations that are on no map at all &mdash;
        Samer Abbas, Dar Al Afia, Clinicy, Aljadaani (SAFA), Aster Sanad, Rabia</li>
      </ul>
      <h3 style="margin-top:4mm">And three that are not organizations</h3>
      <ul>
        <li><b>Encounter History ADT</b>, <b>Lab result</b> and <b>Rad report</b> &mdash;
        capability names that a malformed pipe turned into rows of their own. They sit in your 104
        today, each with its own cells.</li>
        <li><b>Alfalah Hospita</b> and <b>Alfalah Hospital</b> are both there &mdash; one hospital,
        counted twice.</li>
      </ul>
      <p style="margin-top:2mm;font-size:9pt">So the map's ${'104'} is really
      <b>100 organizations</b>, three fragments and one duplicate.</p>
    </div>
    <div>
      <h3>Capabilities with nowhere to go</h3>
      <ul>
        <li>The whole <b>CDA / XD family</b> &mdash; XDRADO, XDLABO, XDDOCS</li>
        <li><b>Vital Signs</b>, <b>Encounter History</b></li>
        <li>The <b>FHIR vs CDA</b> distinction is erased: Jira says
        <i>Lab Result FHIR</i> and <i>Lab result CDA</i>, the tracker has one Lab Results</li>
        <li>The Raqeeb variants fold into V1/V2 and lose Raqeeb</li>
      </ul>
      <p style="margin-top:2mm;font-size:9pt">Your export carries <b>113 distinct capability
      strings</b>. The tracker is configured for <b>${fx.tracker.capabilities.length}</b>.</p>
    </div>
  </div>

  <div class="box warn">
    <h4>And every ticket carries things stored nowhere</h4>
    <p>Dates across ${e.months.length} months &middot; assignee &middot; priority &middot; the SLA
    clock &middot; environment &middot; owning team &middot; labels &middot; and the <b>Jira key
    itself</b>, so no node can be clicked back to its ticket.</p>
  </div>

  <div class="grow"></div>
  <div class="foot"><span>Part C &middot; the gap</span><span>Page 4</span></div>
</section>`
}
