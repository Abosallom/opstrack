// The Markdown renderer.
//
// PURE, and it may not call t(), Intl, or any store — plan §2.16 freezes that,
// and the whole model was built to make it easy: every string below is either a
// punctuation character this file chose or a finished sentence off the model.
// If this file ever needs to ASK something, the answer belongs in build.ts.
//
// SHAPE IS SPEC §4.7, exactly: `## Track` / `**Section (n)**` /
// `- Title — Owner — detail`. The tag breakdown is a Markdown table because that
// is the one construct every Markdown target (GitHub, Notion, Obsidian, Teams'
// Markdown paste) renders the same way.
//
// TRAILING WHITESPACE IS NEVER EMITTED and blocks are joined by exactly one
// blank line, because the output is pasted, diffed and committed, and a document
// whose blank lines drift is a document nobody diffs twice.

import type { DigestItem, DigestModel, DigestSection, DigestTagRow, DigestTrack } from './types'

const WARN = '⚠'

export function renderMarkdown(m: DigestModel): string {
  const blocks: string[] = [
    `# ${m.title}`,
    [m.rangeLabel, m.generatedLabel].join('  \n'),
    m.summaryLine,
  ]
  if (m.strings.truncatedNote !== '') blocks.push(`> ${m.strings.truncatedNote}`)

  if (m.empty && m.tracks.length === 0) {
    blocks.push(`_${m.strings.empty}_`)
  } else {
    for (const track of m.tracks) blocks.push(...trackBlocks(track, m))
  }

  blocks.push('---', `_${m.strings.footer}_`)
  return blocks.join('\n\n') + '\n'
}

function trackBlocks(track: DigestTrack, m: DigestModel): string[] {
  const out: string[] = [`## ${track.name}`]
  if (track.sections.length === 0) out.push(`_${m.strings.trackAllClear}_`)
  for (const section of track.sections) out.push(sectionBlock(section, m.strings.notePrefix))
  if (track.tagBreakdown.length > 0) out.push(tagTable(track.tagBreakdown, m))
  return out
}

function sectionBlock(section: DigestSection, notePrefix: string): string {
  const lines = [`**${section.heading} (${section.count})**`]
  for (const item of section.items) lines.push(...itemLines(item, notePrefix))
  return lines.join('\n')
}

/**
 * `- ⚠ Title — Owner — detail`, with the note as a nested block quote.
 *
 * The quote is indented two spaces so it stays inside the list item in every
 * renderer; an unindented `>` after a `-` terminates the list in CommonMark and
 * silently re-flows the rest of the section.
 */
function itemLines(item: DigestItem, notePrefix: string): string[] {
  const flag = item.flag ? `${WARN} ` : ''
  const lines = [`- ${flag}${item.title} — ${item.owner} — ${item.detail}`]
  if (item.note !== null) lines.push(`  > ${notePrefix} ${item.note}`)
  return lines
}

function tagTable(rows: DigestTagRow[], m: DigestModel): string {
  const s = m.strings
  const lines = [
    `**${s.tagHeading}**`,
    '',
    `| ${s.tagColumn} | ${s.openColumn} | ${s.closedColumn} | ${s.totalColumn} |`,
    // Numeric columns are right-aligned so a reader can compare them down the
    // column; the tag column takes the paragraph's own side, which is what
    // `---` (no colon) means and is therefore correct in both directions.
    '| --- | ---: | ---: | ---: |',
  ]
  for (const row of rows) {
    lines.push(`| ${row.label} | ${row.open} | ${row.closed} | ${row.total} |`)
  }
  return lines.join('\n')
}
