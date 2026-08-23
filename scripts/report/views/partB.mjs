// Part B — what the export holds that the tracker cannot show.
//
// Everything here is drawn from the Jira export alone. None of it exists in the
// app: the tracker stores no dates, no priorities and no ticket types, so this
// page is both a picture and an argument for a fuller import.

const F = 'font-family="-apple-system, Helvetica Neue, Arial, sans-serif"'

export function page(fx) {
  const e = fx.export
  if (!e) return ''

  const months = e.months
  const max = Math.max(...months.map((m) => Math.max(m.created, m.resolved)), 1)
  const W = 660, H = 190, PAD_L = 26, PAD_B = 34
  const innerW = W - PAD_L - 8
  const step = innerW / months.length
  const bw = Math.max(1.6, step / 2 - 0.6)
  const y = (v) => PAD_B + (H - PAD_B - 14) * (1 - v / max)

  // The July 2026 spike is the loudest fact in the dataset; it gets a label
  // rather than being left for the reader to find.
  const peak = months.reduce((a, m) => (m.resolved > a.resolved ? m : a), months[0])
  const peakI = months.indexOf(peak)

  const cols = months
    .map((m, i) => {
      const x = PAD_L + i * step
      return `<rect x="${(x).toFixed(1)}" y="${y(m.created).toFixed(1)}" width="${bw.toFixed(1)}" height="${(H - PAD_B - 14 - (y(m.created) - PAD_B)).toFixed(1)}" fill="#5a4aa8"/>` +
        `<rect x="${(x + bw + 0.6).toFixed(1)}" y="${y(m.resolved).toFixed(1)}" width="${bw.toFixed(1)}" height="${(H - PAD_B - 14 - (y(m.resolved) - PAD_B)).toFixed(1)}" fill="#1f7a4d"/>`
    })
    .join('')

  const ticks = months
    .map((m, i) => (m.month.endsWith('-01') || i === 0 ? { m, i } : null))
    .filter(Boolean)
    .map(({ m, i }) => `<text x="${(PAD_L + i * step + step / 2).toFixed(1)}" y="${H - 16}" text-anchor="middle" font-size="8.6" fill="#6f6a7d" ${F}>${m.month.slice(0, 4)}</text>`)
    .join('')

  const peakX = PAD_L + peakI * step + step / 2
  const flow = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Tickets created and resolved each month since October 2023" style="width:100%;height:auto">
  <line x1="${PAD_L}" y1="${H - PAD_B + 14}" x2="${W - 8}" y2="${H - PAD_B + 14}" stroke="#e4e1ec"/>
  ${cols}
  ${ticks}
  <line x1="${peakX.toFixed(1)}" y1="${(y(peak.resolved) - 6).toFixed(1)}" x2="${(peakX - 96).toFixed(1)}" y2="14" stroke="#6f6a7d" stroke-width="0.8"/>
  <text x="${(peakX - 100).toFixed(1)}" y="12" text-anchor="end" font-size="9.6" font-weight="700" fill="#1f7a4d" ${F}>${peak.resolved} resolved in ${peak.month}</text>
  <text x="${(peakX - 100).toFixed(1)}" y="24" text-anchor="end" font-size="8.8" fill="#6f6a7d" ${F}>against ${peak.created} raised that month</text>
</svg>`

  const typeRow = e.type
    .map((t) => `<span style="display:inline-block;margin-right:6mm;font-size:9.4pt;color:#3f3b4a"><b style="color:#14131a">${t.n.toLocaleString('en-GB')}</b> ${t.name}</span>`)
    .join('')

  const top = e.assignees.slice(0, 8)
  const maxA = Math.max(...top.map((a) => a.n), 1)
  const people = top
    .map(
      (a) => `<div class="gap-row gap-out" style="grid-template-columns:44mm 1fr 16mm">
      <span class="lbl">${a.name || 'Unassigned'}</span>
      <span class="tr"><span class="fl" style="width:${(a.n / maxA) * 100}%;background:#5a4aa8"></span></span>
      <span class="v">${a.n}</span></div>`,
    )
    .join('')

  return `<section class="page">
  <div class="kicker">Part B &middot; from the export only</div>
  <h2>What Jira knows and the app does not</h2>
  <p class="lede">None of this page can be drawn from the tracker: it stores no dates, no
  priorities, no ticket types and no assignees. This is three years of programme history that is
  currently invisible.</p>

  <h3>Raised and resolved, each month</h3>
  <div class="key">
    <span><i style="background:#5a4aa8"></i> Raised</span>
    <span><i class="k-live"></i> Resolved</span>
  </div>
  ${flow}
  <p style="font-size:9.2pt;margin-top:2mm">${months.length} months, ${months[0].month} to
  ${months.at(-1).month}. <b>${e.issues.toLocaleString('en-GB')} tickets</b> in total.</p>

  <h3 style="margin-top:4mm">What kind of work it is</h3>
  <p style="margin-bottom:3mm">${typeRow}</p>
  <div class="box warn">
    <h4>337 of these are not requests at all</h4>
    <p>The <b>Problems</b> and <b>Incidents</b> are live faults against organizations that are on
    your map &mdash; &ldquo;United Doc &mdash; STG ADT error&rdquo; is one. The tracker has no
    concept of a fault, so an organization can be shown as testing while a problem sits open
    against it.</p>
  </div>

  <h3 style="margin-top:4mm">Who is carrying it</h3>
  ${people}
  <p style="font-size:9pt;margin-top:2mm">Assignee is on every ticket. On the map,
  <b>${fx.tracker.totals.organizations - fx.tracker.totals.withOwner} of
  ${fx.tracker.totals.organizations}</b> organizations have no owner at all.</p>

  <div class="grow"></div>
  <div class="foot"><span>Part B &middot; the export</span><span>Page 3</span></div>
</section>`
}
