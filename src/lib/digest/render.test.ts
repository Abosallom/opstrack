// The three renderers, against a HAND-WRITTEN model literal.
//
// That is the point of the whole arrangement: a renderer that needed a builder
// to produce input would be a renderer with a store somewhere in its test, and
// the "no renderer calls t(), Intl or a store" rule would be unprovable. The
// model below is typed, so it cannot drift from DigestModel; it is written out
// rather than built, so these assertions are about FORMATTING and nothing else.

import { describe, expect, it } from 'vitest'
import { buildDigestModel } from './build'
import {
  digestFilename,
  digestMimeType,
  renderDigest,
  renderHtml,
  renderMarkdown,
  renderPlain,
} from './index'
import { entry, options, rows } from './fixtures'
import type { DigestModel } from './types'

const MODEL: DigestModel = {
  locale: 'en',
  dir: 'ltr',
  from: '2026-07-22',
  to: '2026-07-29',
  title: 'Status digest',
  rangeLabel: 'Covering 22/07/2026 – 29/07/2026',
  generatedLabel: 'Generated 29/07/2026, 12:00',
  summaryLine: '3 closed · 1 blocked',
  sections: ['closed', 'blocked'],
  tracks: [
    {
      id: 'trk-net',
      name: 'Network',
      count: 2,
      sections: [
        {
          kind: 'closed',
          heading: 'Closed',
          count: 1,
          items: [
            {
              id: 'e1',
              title: 'Firewall rule DC2',
              owner: 'Ahmed',
              detail: 'closed Tue',
              note: null,
              flag: false,
            },
          ],
        },
        {
          kind: 'blocked',
          heading: 'Blocked',
          count: 1,
          items: [
            {
              id: 'e2',
              title: 'MPLS circuit order',
              owner: 'vendor',
              detail: 'Waiting on · 12 days',
              note: 'Vendor promised a date on Sunday',
              flag: true,
            },
          ],
        },
      ],
      tagBreakdown: [
        { kind: 'tag', tag: 'portal', label: 'portal', open: 2, closed: 1, total: 3 },
        { kind: 'other', tag: '', label: 'Other', open: 1, closed: 0, total: 1 },
      ],
    },
  ],
  totals: {
    bySection: { closed: 1, inProgress: 0, blocked: 1, overdue: 0, slaBreached: 0 },
    entries: 2,
    tracks: 1,
  },
  strings: {
    tagHeading: 'Tag breakdown',
    tagColumn: 'Tag',
    openColumn: 'Open',
    closedColumn: 'Closed',
    totalColumn: 'Total',
    trackAllClear: 'Nothing to report.',
    empty: 'No items fell inside this window.',
    notePrefix: 'Note:',
    truncatedNote: '',
    footer: 'Sent from OpsTrack',
  },
  empty: false,
}

const EMPTY: DigestModel = {
  ...MODEL,
  summaryLine: 'Nothing to report in this window.',
  tracks: [],
  totals: { ...MODEL.totals, entries: 0, tracks: 0 },
  empty: true,
}

describe('markdown', () => {
  const out = renderMarkdown(MODEL)

  it('follows spec §4.7: ## track, **section (n)**, - title — owner — detail', () => {
    expect(out).toContain('## Network')
    expect(out).toContain('**Closed (1)**')
    expect(out).toContain('- Firewall rule DC2 — Ahmed — closed Tue')
  })

  it('prefixes a flagged row with the warning glyph and nothing else', () => {
    expect(out).toContain('- ⚠ MPLS circuit order — vendor — Waiting on · 12 days')
  })

  it('indents the quoted note so it stays inside its list item', () => {
    expect(out).toContain('  > Note: Vendor promised a date on Sunday')
  })

  it('renders the tag breakdown as a table with numeric columns aligned to the end', () => {
    expect(out).toContain('| Tag | Open | Closed | Total |')
    expect(out).toContain('| --- | ---: | ---: | ---: |')
    expect(out).toContain('| portal | 2 | 1 | 3 |')
    expect(out).toContain('| Other | 1 | 0 | 1 |')
  })

  it('opens with the title and closes with the footer, and ends in one newline', () => {
    expect(out.startsWith('# Status digest\n')).toBe(true)
    expect(out.endsWith('_Sent from OpsTrack_\n')).toBe(true)
    expect(out.endsWith('\n\n')).toBe(false)
  })

  it('has no trailing whitespace on any line', () => {
    // Two-space Markdown line breaks are used deliberately in the header block,
    // so the check is for whitespace before a newline on lines that do not end
    // in the intentional double space.
    const offenders = out.split('\n').filter((l) => / $/.test(l) && !/ {2}$/.test(l))
    expect(offenders).toEqual([])
  })

  it('says so, once, when there is nothing to report', () => {
    const empty = renderMarkdown(EMPTY)
    expect(empty).toContain('_No items fell inside this window._')
    expect(empty).not.toContain('## ')
  })
})

describe('plain text', () => {
  const out = renderPlain(MODEL)

  it('emits no Markdown control character — this is what gets pasted into WhatsApp', () => {
    expect(out).not.toMatch(/[#*_]/)
  })

  it('bullets with • and underlines each track', () => {
    expect(out).toContain('• Firewall rule DC2 — Ahmed — closed Tue')
    expect(out).toContain('Network\n───────')
  })

  it('keeps the warning glyph and indents the note by two spaces', () => {
    expect(out).toContain('• ⚠ MPLS circuit order — vendor — Waiting on · 12 days')
    expect(out).toContain('\n  Note: Vendor promised a date on Sunday')
  })

  it('lists the tag breakdown instead of tabulating it — no monospace in chat', () => {
    expect(out).toContain('• portal — Open 2 · Closed 1 · Total 3')
  })

  it('stays short enough to paste: the sample fits in a single chat message', () => {
    expect(out.length).toBeLessThan(1200)
  })
})

describe('html', () => {
  const out = renderHtml(MODEL)

  it('is a self-contained document carrying dir and lang', () => {
    expect(out.startsWith('<!doctype html>')).toBe(true)
    expect(out).toContain('<html lang="en" dir="ltr">')
    expect(out.trimEnd().endsWith('</html>')).toBe(true)
  })

  it('has no <style> block — Gmail strips it', () => {
    expect(out).not.toMatch(/<style[\s>]/i)
    expect(out).not.toMatch(/<link[\s>]/i)
  })

  it('aligns to start, never to left or right', () => {
    expect(out).toContain('text-align:start')
    expect(out).not.toMatch(/text-align:\s*(left|right)/)
    expect(out).not.toMatch(/padding-left|padding-right|margin-left|margin-right/)
  })

  it('escapes every user string', () => {
    const nasty: DigestModel = {
      ...MODEL,
      tracks: [
        {
          ...MODEL.tracks[0],
          name: '<script>alert(1)</script>',
          sections: [
            {
              kind: 'closed',
              heading: 'Closed',
              count: 1,
              items: [
                {
                  id: 'x',
                  title: 'Fix "quotes" & <tags>',
                  owner: "O'Brien",
                  detail: 'closed Tue',
                  note: '<img src=x onerror=1>',
                  flag: false,
                },
              ],
            },
          ],
          tagBreakdown: [
            { kind: 'tag', tag: '<b>', label: '<b>', open: 1, closed: 0, total: 1 },
          ],
        },
      ],
    }
    const html = renderHtml(nasty)
    expect(html).not.toContain('<script>')
    expect(html).not.toContain('<img src=x')
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
    expect(html).toContain('Fix &quot;quotes&quot; &amp; &lt;tags&gt;')
    expect(html).toContain('O&#39;Brien')
  })

  it('mirrors for Arabic on the wrapper alone', () => {
    const ar = renderHtml({ ...MODEL, locale: 'ar', dir: 'rtl' })
    expect(ar).toContain('<html lang="ar" dir="rtl">')
  })
})

describe('the barrel', () => {
  it('dispatches each format to its own renderer', () => {
    expect(renderDigest(MODEL, 'markdown')).toBe(renderMarkdown(MODEL))
    expect(renderDigest(MODEL, 'plain')).toBe(renderPlain(MODEL))
    expect(renderDigest(MODEL, 'html')).toBe(renderHtml(MODEL))
  })

  it('names a file by its ISO range, never by a localised string', () => {
    expect(digestFilename(MODEL, 'markdown')).toBe('nphiescore-2026-07-22_2026-07-29.md')
    expect(digestFilename(MODEL, 'plain')).toBe('nphiescore-2026-07-22_2026-07-29.txt')
    expect(digestFilename(MODEL, 'html')).toBe('nphiescore-2026-07-22_2026-07-29.html')
    expect(digestFilename({ ...MODEL, locale: 'ar', dir: 'rtl' }, 'plain')).toBe(
      'nphiescore-2026-07-22_2026-07-29.txt',
    )
  })

  it('declares utf-8 on every MIME type — the Arabic digest is the common case', () => {
    for (const f of ['markdown', 'plain', 'html'] as const) {
      expect(digestMimeType(f)).toContain('charset=utf-8')
    }
  })
})

describe('the Arabic digest end to end', () => {
  // The Wave-3 gate in one test: rows in, Arabic out, no store touched and no
  // ambient locale consulted anywhere in the chain.
  const model = buildDigestModel(
    rows({
      entries: [
        entry({
          id: 'a',
          title: 'Core switch firmware upgrade',
          owner_id: 'usr-ahmed',
          due_date: '2026-08-14',
        }),
      ],
    }),
    options({ locale: 'ar' }),
  )

  it('reads as Arabic in all three formats', () => {
    for (const f of ['markdown', 'plain', 'html'] as const) {
      const out = renderDigest(model, f)
      expect(out).toContain('ملخّص الحالة')
      expect(out).toContain('الشبكات')
      expect(out).toContain('قيد التنفيذ')
    }
  })

  it('isolates the Latin title and owner so the dashes do not migrate', () => {
    const out = renderPlain(model)
    expect(out).toContain('⁨Core switch firmware upgrade⁩')
    expect(out).toContain('⁨Ahmed⁩')
    // U+200F inside the date is Intl's, not ours; the assertion is that OUR
    // isolate brackets the whole date rather than that Intl left it bare.
    expect(out.replace(/[\u200E\u200F]/g, '')).toContain('⁨14/08/2026⁩')
  })

  it('uses Latin numerals throughout', () => {
    expect(renderMarkdown(model)).not.toMatch(/[\u0660-\u0669\u06F0-\u06F9]/)
  })
})
