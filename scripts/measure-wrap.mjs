// Measures the claim wrapping was built for, rather than asserting it: the real
// NPHIES shape — 2 directorates x 3 books x 6 types x 11 organizations = 396
// organizations — laid out both ways, with the resulting canvas printed.
import { layoutMindtree } from '../src/lib/mindtree/layout.ts'

let n = 0
const org = () => ({ id: `org-${n++}` })
const build = (depth, fanouts) =>
  depth === fanouts.length
    ? org()
    : { id: `lvl${depth}-${n++}`, children: Array.from({ length: fanouts[depth] }, () => build(depth + 1, fanouts)) }

const tree = build(0, [2, 3, 6, 11])
const orgs = (t) => (t.children ? t.children.reduce((a, c) => a + orgs(c), 0) : 1)

const row = (label, opts) => {
  const l = layoutMindtree(tree, opts)
  const screens = (v, px) => (v / px).toFixed(1)
  console.log(
    `${label.padEnd(24)} ${String(Math.round(l.bounds.width)).padStart(7)} x ${String(Math.round(l.bounds.height)).padStart(6)} units` +
      `   = ${screens(l.bounds.width, 1728).padStart(5)} x ${screens(l.bounds.height, 1080).padStart(5)} screens (1728x1080)` +
      `   aspect ${(l.bounds.width / l.bounds.height).toFixed(2)}`,
  )
  return l
}

console.log(`nodes: ${layoutMindtree(tree).nodes.length}, organizations: ${orgs(tree)}\n`)
const a = row('vertical, unwrapped', { orientation: 'vertical' })
const b = row('vertical, wrapped', { orientation: 'vertical', wrap: true })
row('horizontal, unwrapped', {})
row('horizontal, wrapped', { wrap: true })
console.log(`\nwrapped width is ${(b.bounds.width / a.bounds.width * 100).toFixed(1)}% of unwrapped`)
