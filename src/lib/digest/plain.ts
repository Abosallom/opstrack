// The plain-text renderer — WhatsApp, Teams, SMS, a pasted email body.
//
// PURE, and it may not call t(), Intl, or any store (plan §2.16).
//
// WHAT "PLAIN" MEANS HERE, precisely: no `#`, `*` or `_` anywhere in the output.
// Those three are the characters WhatsApp and Teams interpret, so a Markdown
// digest pasted into a chat renders `**Closed (3)**` as bold-with-stray-asterisks
// in one client, as literal asterisks in another, and — worst — turns an entry
// title containing an underscore into italics halfway through a sentence. This
// renderer emits none of them, so the text a person sends is the text they saw.
//
// STRUCTURE IS CARRIED BY LAYOUT, not by markup: a track is its name with a rule
// under it, a section is a heading with a count, an item is a `•` bullet. The
// rule is drawn with U+2500 BOX DRAWINGS LIGHT HORIZONTAL, which is direction-
// neutral and survives every chat client's font stack.
//
// TRACK NAMES ARE NOT UPPERCASED. Uppercasing is a no-op in Arabic and a
// transformation of somebody's data in English, so a mixed-language workspace
// would get a visual hierarchy in one language and not the other.

import type { DigestItem, DigestModel, DigestSection, DigestTagRow, DigestTrack } from './types'

const WARN = '⚠'
const BULLET = '•'
const RULE_CHAR = '─'

/** Wide enough to read as a rule, short enough not to wrap on a phone. */
const RULE_MAX = 24

export function renderPlain(m: DigestModel): string {
  const blocks: string[] = [
    [m.title, m.rangeLabel, m.generatedLabel].join('\n'),
    m.summaryLine,
  ]
  if (m.strings.truncatedNote !== '') blocks.push(m.strings.truncatedNote)

  if (m.empty && m.tracks.length === 0) {
    blocks.push(m.strings.empty)
  } else {
    for (const track of m.tracks) blocks.push(...trackBlocks(track, m))
  }

  blocks.push(m.strings.footer)
  return blocks.join('\n\n') + '\n'
}

function trackBlocks(track: DigestTrack, m: DigestModel): string[] {
  const out: string[] = [`${track.name}\n${rule(track.name)}`]
  if (track.sections.length === 0) out.push(m.strings.trackAllClear)
  for (const section of track.sections) out.push(sectionBlock(section, m.strings.notePrefix))
  if (track.tagBreakdown.length > 0) out.push(tagBlock(track.tagBreakdown, m))
  return out
}

/**
 * A rule as long as the name it underlines, capped.
 *
 * Measured in code points, not UTF-16 units, so an emoji in a track name does
 * not draw a rule twice as long as the word above it.
 */
function rule(name: string): string {
  return RULE_CHAR.repeat(Math.min(Math.max([...name].length, 3), RULE_MAX))
}

function sectionBlock(section: DigestSection, notePrefix: string): string {
  const lines = [`${section.heading} (${section.count})`]
  for (const item of section.items) lines.push(...itemLines(item, notePrefix))
  return lines.join('\n')
}

function itemLines(item: DigestItem, notePrefix: string): string[] {
  const flag = item.flag ? `${WARN} ` : ''
  const lines = [`${BULLET} ${flag}${item.title} — ${item.owner} — ${item.detail}`]
  // Two spaces, not a tab: chat clients collapse tabs unpredictably and the
  // indent is the only thing tying the note to the bullet above it.
  if (item.note !== null) lines.push(`  ${notePrefix} ${item.note}`)
  return lines
}

/**
 * The breakdown as bullets rather than as columns.
 *
 * A four-column text table needs padding to line up, padding needs a monospace
 * font, and no chat client has one. `tag — open 2 · closed 1 · total 3` reads
 * correctly at any width and in both directions.
 */
function tagBlock(rows: DigestTagRow[], m: DigestModel): string {
  const s = m.strings
  const lines = [s.tagHeading]
  for (const row of rows) {
    const counts = [
      `${s.openColumn} ${row.open}`,
      `${s.closedColumn} ${row.closed}`,
      `${s.totalColumn} ${row.total}`,
    ].join(' · ')
    lines.push(`${BULLET} ${row.label} — ${counts}`)
  }
  return lines.join('\n')
}
