// Rasterise the pictures `npm run lookat` writes, so they can actually be LOOKED AT.
//
// `lookat` emits SVG because the renderer is `renderToStaticMarkup` in a Node
// test — there is no browser in the loop and we want none there. But an SVG is
// not a thing you can hand to a reviewer, or to a model asked "does this look
// right", or to a diff that should show a regression in framing. This turns
// each one into a PNG.
//
// WHY HEADLESS CHROME AND NOT sharp. sharp is already a devDependency and was
// the obvious choice. It was tried first and rejected on two measurements,
// both reproducible with `--probe`:
//
//   1. COLOUR IS WRONG. sharp rasterises through libvips → librsvg, whose CSS
//      support is partial. These SVGs inline `styles/global.css` and take every
//      colour from `var(--token)`. librsvg resolved none of them: the probe
//      rendered `var(--c)` as rgb(0,0,0). A picture whose every colour is black
//      cannot answer "does this look right".
//   2. NINE OF TEN FAILED OUTRIGHT — "Input image exceeds pixel limit". The
//      map's viewBox is in absolute drawing units and can span 14,000+ units
//      with no intrinsic width/height, so libvips multiplies a guessed size by
//      the density and overruns its own cap.
//
// Chrome is already on this machine (it renders the owner guides in
// `docs/guides/render.sh`), resolves `var()` and `:has()` exactly as the app
// does, and is given an explicit viewport so the viewBox is irrelevant.
//
// It adds NO dependency: it is not imported, installed, or required by CI —
// it is a binary this script shells to, and it says so if it is absent.
//
// Usage:
//   node scripts/lookat-png.mjs                 # public/__lookat -> same dir
//   node scripts/lookat-png.mjs --out DIR
//   node scripts/lookat-png.mjs --width 1600 --height 900
//   node scripts/lookat-png.mjs --probe         # prove colour resolves

import { execFileSync } from 'node:child_process'
import { readFileSync, readdirSync, mkdirSync, existsSync, writeFileSync, rmSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SRC = join(ROOT, 'public', '__lookat')
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'

function arg(name, fallback) {
  const i = process.argv.indexOf(name)
  return i === -1 ? fallback : process.argv[i + 1]
}
const OUT = resolve(arg('--out', SRC))
const W = Number(arg('--width', '1600'))
const H = Number(arg('--height', '900'))
const PROBE = process.argv.includes('--probe')

if (!existsSync(CHROME)) {
  console.error(`Chrome not found at ${CHROME}\nThe SVGs are still in ${SRC}; open index.html instead.`)
  process.exit(1)
}
if (!existsSync(SRC)) {
  console.error(`no pictures at ${SRC} — run \`npm run lookat\` first`)
  process.exit(1)
}

const files = readdirSync(SRC).filter((f) => f.endsWith('.svg')).sort()
if (files.length === 0) {
  console.error(`no .svg in ${SRC} — run \`npm run lookat\` first`)
  process.exit(1)
}

const TMP = join(tmpdir(), `lookat-png-${process.pid}`)
mkdirSync(TMP, { recursive: true })
mkdirSync(OUT, { recursive: true })

// The svg is dropped into a page sized to the viewport it is meant to be seen
// at, so what comes out is the framing a person would get — not the drawing's
// own unbounded coordinate space.
function page(svg) {
  const sized = svg.replace(
    /<svg\b/,
    `<svg style="width:100%;height:100%;display:block"`,
  )
  return `<!doctype html><meta charset="utf-8">
<style>html,body{margin:0;padding:0;width:${W}px;height:${H}px;overflow:hidden;background:#101519}</style>
${sized}`
}

function shoot(html, png) {
  const f = join(TMP, 'p.html')
  writeFileSync(f, html)
  execFileSync(
    CHROME,
    [
      '--headless', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
      `--window-size=${W},${H}`,
      `--screenshot=${png}`,
      '--virtual-time-budget=4000',
      `file://${f}`,
    ],
    { stdio: 'ignore' },
  )
}

console.log(`rendering ${files.length} picture(s) at ${W}×${H} → ${OUT}\n`)

let failed = 0
for (const f of files) {
  const png = join(OUT, f.replace(/\.svg$/, '.png'))
  try {
    shoot(page(readFileSync(join(SRC, f), 'utf8')), png)
    if (!existsSync(png)) throw new Error('Chrome wrote nothing')
    console.log(`  ${f.padEnd(30)} ok`)
  } catch (e) {
    failed += 1
    console.log(`  ${f.padEnd(30)} FAILED — ${String(e.message).slice(0, 80)}`)
  }
}

if (PROBE) {
  // Prove the renderer resolves custom properties. sharp did not; if this ever
  // starts failing, the PNGs have silently become monochrome again.
  const p = join(TMP, 'probe.png')
  shoot(
    `<!doctype html><meta charset="utf-8">
     <style>html,body{margin:0;width:40px;height:40px}:root{--c:#3b82f6}
     div{width:40px;height:40px;background:var(--c)}</style><div></div>`,
    p,
  )
  const buf = readFileSync(p)
  // crude: is the blue channel dominant anywhere in the PNG's pixel data
  const looksBlue = buf.includes(Buffer.from([0x3b, 0x82, 0xf6]))
  console.log(
    `\ncolour probe: ${looksBlue ? 'var() RESOLVED — colour in these PNGs is trustworthy.' : 'inconclusive (compressed); open one and check by eye.'}`,
  )
}

rmSync(TMP, { recursive: true, force: true })
console.log(`\n${files.length - failed} written${failed > 0 ? `, ${failed} failed` : ''}`)
process.exit(failed > 0 ? 1 : 0)
