// Assemble the interfaces catalogue and hand it to the guides renderer.
//
// The document is a pure function of scripts/report/fixture.json. Nothing here
// reads the clock, the network or the database — `extract.mjs` did that once, so
// two pages of one document can never disagree about the programme.

import { readFileSync, writeFileSync, existsSync } from 'node:fs'

const fx = JSON.parse(readFileSync('scripts/report/fixture.json', 'utf8'))

/** The status colours, tuned for white paper. Spelled ONCE, here. */
export const INK = {
  live: '#1f7a4d',
  testing: '#c98a1a',
  planned: '#b9b4c6',
  // ⚠ NOT A FILL. `null` in `byCap` means nobody has said anything, and the
  //   honest way to draw a measurement nobody took is to leave the paper alone.
  unrecorded: 'none',
  unrecordedLine: '#e4e1ec',
}

/** Shared page furniture the view modules are told they may use. */
const SHARED_CSS = `
.two { display: grid; grid-template-columns: 1fr 1fr; gap: 4mm; margin-top: 4mm; }
.mini { border-radius: 2mm; padding: 4mm; border: 1px solid var(--rule); background: #fff; }
.mini h4 { margin: 0 0 2mm; font-size: 9.8pt; }
.mini p { font-size: 9.2pt; margin: 0; line-height: 1.5; }
.key { display: flex; gap: 5mm; flex-wrap: wrap; margin: 3mm 0 4mm; align-items: center; }
.key span { display: flex; align-items: center; gap: 1.8mm; font-size: 8.8pt; font-weight: 600; color: var(--ink-2); }
.key i { width: 3.6mm; height: 3.6mm; border-radius: 0.8mm; display: block; border: 1px solid transparent; }
.k-live { background: ${INK.live}; } .k-test { background: ${INK.testing}; }
.k-plan { background: ${INK.planned}; }
/* A hairline that reads at 3.6mm. The bars can use the lighter
   ${INK.unrecordedLine} because they are 40x wider; this swatch cannot. */
.k-none { background: #fff; border-color: #9a9aa8; }
.stat { display: grid; grid-template-columns: repeat(4, 1fr); gap: 3mm; margin: 4mm 0; }
.stat > div { border-radius: 2mm; padding: 4mm 3mm; text-align: center; border: 1px solid var(--rule); background: #fff; }
.stat .n { font-size: 20pt; font-weight: 700; line-height: 1; color: var(--accent); }
.stat .l { font-size: 8.4pt; color: var(--ink-3); margin-top: 1.8mm; line-height: 1.35; }
.stat .ok .n { color: ${INK.live}; } .stat .warn .n { color: ${INK.testing}; }
`

const ORDER = [
  'cover', 'partA', 'partB', 'partC', 'divider',
  'heatgrid', 'ranked', 'cards', 'swimlanes', 'owners', 'treemap', 'waffle', 'timeline',
  'closing',
]

const pages = []
const styles = [SHARED_CSS]
const missing = []

for (const slug of ORDER) {
  if (!existsSync(`scripts/report/views/${slug}.mjs`)) { missing.push(slug); continue }
  const mod = await import(`./views/${slug}.mjs`)
  if (typeof mod.css === 'string') styles.push(mod.css)
  pages.push(mod.page(fx))
}

const html = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<title>Interfaces — ways to see the programme</title>
<!--BASECSS-->
<style>${styles.join('\n')}</style></head><body>
${pages.join('\n\n')}
</body></html>
`
// Written into docs/guides/ rather than a folder of its own: render.sh copies
// the file into a temp dir and reads `_base.css` relative to ITS OWN location,
// so a path with `../` in it breaks the copy. The document is guide-shaped and
// the README that indexes that folder is where a reader will look for it.
writeFileSync('docs/guides/interfaces.html', html)
console.log(`assembled ${pages.length} pages -> docs/guides/interfaces.html`)
if (missing.length) console.log(`  not yet written: ${missing.join(', ')}`)
