// The HTML-email renderer.
//
// PURE, and it may not call t(), Intl, or any store (plan §2.16).
//
// ── the four constraints an email body has that a web page does not ───────
//
// 1. NO <style> BLOCK. Gmail strips `<style>` from a forwarded message and
//    Outlook.com strips it outright, so every rule here is an inline `style`
//    attribute. That is why this file is verbose and why it must stay that way:
//    the moment one rule moves into a stylesheet, it works in the preview and
//    silently does nothing in the client the report is actually read in.
//
// 2. NO STYLESHEET TO INHERIT FROM, so colours are literal hexes, not the app's
//    custom properties. They are a light-surface palette on purpose — an email
//    client's dark mode inverts what it likes and cannot be negotiated with, and
//    a document that assumes dark is unreadable in the majority that assume
//    light. Every pair below clears 4.5:1 on #ffffff.
//
// 3. DIRECTION IS A DOCUMENT PROPERTY. `dir` and `lang` go on <html>, and every
//    cell uses `text-align: start` rather than left/right so one table serves
//    both languages. This is the same logical-properties rule the app's CSS
//    follows, and it is the only one of these four that email clients honour
//    without argument.
//
// 4. EVERY USER STRING IS ESCAPED. Entry titles, owner names, track names, tags
//    and quoted update bodies are user input and go straight into a string that
//    will be parsed as HTML. `escapeHtml()` is applied at each interpolation
//    site, not once at the end — an escape applied to the assembled document
//    would escape this file's own markup.
//
// The bidi ISOLATES the model carries are characters, not markup, so they
// survive escaping untouched and do the same job here that they do in the
// plain-text renderer. No <bdi> is emitted: Outlook's rendering engine ignores
// it, and the isolates already work everywhere.

import { escapeHtml } from '../text'
import type { DigestItem, DigestModel, DigestSection, DigestTagRow, DigestTrack } from './types'

const INK = '#111827'
const MUTED = '#4b5563'
const RULE = '#e5e7eb'
const WARN_INK = '#b91c1c'
const PAGE = '#f5f6f8'
const CARD = '#ffffff'

const FONT =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Noto Sans Arabic', 'Geeza Pro', Arial, sans-serif"

export function renderHtml(m: DigestModel): string {
  const body: string[] = [
    `<h1 style="margin:0 0 4px;font-size:22px;line-height:1.3;font-weight:700;color:${INK};text-align:start">${escapeHtml(m.title)}</h1>`,
    `<p style="margin:0;font-size:13px;line-height:1.5;color:${MUTED};text-align:start">${escapeHtml(m.rangeLabel)}<br>${escapeHtml(m.generatedLabel)}</p>`,
    `<p style="margin:16px 0 0;font-size:14px;line-height:1.5;font-weight:600;color:${INK};text-align:start">${escapeHtml(m.summaryLine)}</p>`,
  ]
  if (m.strings.truncatedNote !== '') body.push(callout(m.strings.truncatedNote))

  if (m.empty && m.tracks.length === 0) {
    body.push(
      `<p style="margin:24px 0 0;font-size:14px;color:${MUTED};text-align:start">${escapeHtml(m.strings.empty)}</p>`,
    )
  } else {
    for (const track of m.tracks) body.push(trackHtml(track, m))
  }

  body.push(
    `<p style="margin:28px 0 0;padding-block-start:12px;border-top:1px solid ${RULE};font-size:12px;color:${MUTED};text-align:start">${escapeHtml(m.strings.footer)}</p>`,
  )

  return document(m, body.join('\n'))
}

/**
 * The wrapper.
 *
 * A single centred 680px card rather than a nested-table layout: the audience is
 * a small internal team on modern clients, and a table skeleton would triple the
 * size of this file to support a client nobody here uses. `max-width` with
 * `margin:0 auto` degrades to full-bleed rather than to broken.
 */
function document(m: DigestModel, inner: string): string {
  return `<!doctype html>
<html lang="${m.locale}" dir="${m.dir}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(m.title)}</title>
</head>
<body style="margin:0;padding:24px 12px;background:${PAGE};font-family:${FONT};color:${INK};-webkit-text-size-adjust:100%">
<div style="max-width:680px;margin:0 auto;padding:24px;background:${CARD};border:1px solid ${RULE};border-radius:12px">
${inner}
</div>
</body>
</html>
`
}

function callout(text: string): string {
  return `<p style="margin:16px 0 0;padding:8px 12px;background:#fef3c7;border-radius:8px;font-size:13px;line-height:1.5;color:#78350f;text-align:start">${escapeHtml(text)}</p>`
}

function trackHtml(track: DigestTrack, m: DigestModel): string {
  const parts: string[] = [
    `<h2 style="margin:28px 0 8px;padding-block-end:6px;border-bottom:1px solid ${RULE};font-size:17px;line-height:1.3;font-weight:700;color:${INK};text-align:start">${escapeHtml(track.name)}</h2>`,
  ]
  if (track.sections.length === 0) {
    parts.push(
      `<p style="margin:0;font-size:13px;color:${MUTED};text-align:start">${escapeHtml(m.strings.trackAllClear)}</p>`,
    )
  }
  for (const section of track.sections) parts.push(sectionHtml(section, m.strings.notePrefix))
  if (track.tagBreakdown.length > 0) parts.push(tagTableHtml(track.tagBreakdown, m))
  return parts.join('\n')
}

function sectionHtml(section: DigestSection, notePrefix: string): string {
  const items = section.items.map((item) => itemHtml(item, notePrefix)).join('\n')
  return [
    `<h3 style="margin:16px 0 6px;font-size:14px;line-height:1.4;font-weight:700;color:${INK};text-align:start">${escapeHtml(section.heading)} (${section.count})</h3>`,
    // padding-inline-start, not padding-left: the bullets have to sit on the
    // reading side in Arabic, and this is the one list property clients honour.
    `<ul style="margin:0;padding-inline-start:20px;list-style:disc">`,
    items,
    `</ul>`,
  ].join('\n')
}

function itemHtml(item: DigestItem, notePrefix: string): string {
  const flag = item.flag
    ? `<span style="color:${WARN_INK}" aria-hidden="true">⚠</span> `
    : ''
  const note =
    item.note === null
      ? ''
      : `<br><span style="font-size:12px;color:${MUTED}">${escapeHtml(notePrefix)} ${escapeHtml(item.note)}</span>`
  return `<li style="margin:0 0 6px;font-size:14px;line-height:1.5;color:${INK};text-align:start">${flag}<strong style="font-weight:600">${escapeHtml(item.title)}</strong> — ${escapeHtml(item.owner)} — <span style="color:${MUTED}">${escapeHtml(item.detail)}</span>${note}</li>`
}

function tagTableHtml(rows: DigestTagRow[], m: DigestModel): string {
  const s = m.strings
  const head = [s.tagColumn, s.openColumn, s.closedColumn, s.totalColumn]
    .map(
      (label, i) =>
        `<th style="padding:6px 10px;border-bottom:1px solid ${RULE};font-size:12px;font-weight:700;color:${MUTED};text-align:${i === 0 ? 'start' : 'end'}">${escapeHtml(label)}</th>`,
    )
    .join('')
  const body = rows
    .map((row) => {
      const cells = [row.label, String(row.open), String(row.closed), String(row.total)]
        .map(
          (value, i) =>
            `<td style="padding:6px 10px;border-bottom:1px solid ${RULE};font-size:13px;color:${INK};text-align:${i === 0 ? 'start' : 'end'};font-variant-numeric:tabular-nums">${escapeHtml(value)}</td>`,
        )
        .join('')
      return `<tr>${cells}</tr>`
    })
    .join('\n')
  return [
    `<h3 style="margin:16px 0 6px;font-size:14px;line-height:1.4;font-weight:700;color:${INK};text-align:start">${escapeHtml(s.tagHeading)}</h3>`,
    `<table role="presentation" style="width:100%;border-collapse:collapse">`,
    `<thead><tr>${head}</tr></thead>`,
    `<tbody>`,
    body,
    `</tbody>`,
    `</table>`,
  ].join('\n')
}
