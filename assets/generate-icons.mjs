/**
 * Source images for `npx @capacitor/assets generate --ios`.
 *
 * WHY A SCRIPT AND NOT THREE CHECKED-IN PNGs. The mark lives in
 * `public/icon.svg` and is the same geometry the PWA ships; hand-exporting a
 * 1024 icon and two 2732 splashes every time that file is touched is exactly
 * how a native icon drifts a release behind the web one. This re-derives all
 * three from the same numbers, so `npm run icons` is the only step.
 *
 * WHAT IT WRITES (all into this folder, which is @capacitor/assets' input dir):
 *   icon.png        1024x1024  app icon — FULL BLEED, no rounded corners and no
 *                              transparency. iOS applies its own superellipse
 *                              mask; a pre-rounded source gets rounded twice and
 *                              shows a dark rim, and an alpha channel is an
 *                              outright App Store validation failure.
 *   splash.png      2732x2732  light-appearance launch image
 *   splash-dark.png 2732x2732  dark-appearance launch image
 *
 * The splashes are square at the largest edge any device needs because
 * Capacitor's universal launch image is centre-cropped to the screen: anything
 * outside the middle square is what gets cut, so the mark must sit in the
 * centre and nothing else may carry meaning.
 *
 * Run: node assets/generate-icons.mjs   (or `npm run icons`)
 */
import { mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const HERE = dirname(fileURLToPath(import.meta.url))

/* Colours. --bg from src/styles/global.css is the source of truth for the two
   splash backgrounds so the launch image hands over to the app shell with no
   flash of a different grey. INK is the icon's own plate colour and matches
   public/icon.svg; it is deliberately NOT --bg, because the icon reads as a
   product mark on the home screen rather than as a piece of the app surface. */
const INK = '#101215' // icon plate + the punched-out node centres
const BG_DARK = '#101519' // global.css :root --bg
const BG_LIGHT = '#f4f6f8' // global.css [data-theme='light'] --bg

/**
 * The OpsTrack mark: a vertical rail with three nodes, each carrying a progress
 * bar of a different length — several tracks, each at a different point.
 *
 * Drawn in a 1024-unit box so it can be scaled into any canvas by the caller.
 * `hole` is the colour punched out of each node centre: on the icon that is the
 * plate colour, on a splash it is the splash background, otherwise the light
 * splash shows three near-black dots.
 */
function mark(hole) {
  return `
  <rect x="237" y="300" width="22" height="424" rx="11" fill="#2e3747"/>
  <rect x="368" y="263" width="380" height="74" rx="37" fill="#4d8dff"/>
  <circle cx="248" cy="300" r="62" fill="#4d8dff"/>
  <circle cx="248" cy="300" r="26" fill="${hole}"/>
  <rect x="368" y="475" width="280" height="74" rx="37" fill="#3a69c2"/>
  <circle cx="248" cy="512" r="62" fill="#3a69c2"/>
  <circle cx="248" cy="512" r="26" fill="${hole}"/>
  <rect x="368" y="687" width="470" height="74" rx="37" fill="#2a4a8c"/>
  <circle cx="248" cy="724" r="62" fill="#2a4a8c"/>
  <circle cx="248" cy="724" r="26" fill="${hole}"/>`
}

/* The mark's ink spans x 237..838 and y 263..761 inside its 1024 box, i.e. it
   is not centred in that box. Both canvases below therefore centre the INK,
   not the box — otherwise the icon sits visibly left-of-centre under iOS's
   circular mask on the Home Screen and in Spotlight. */
const INK_CX = (237 + 838) / 2
const INK_CY = (263 + 761) / 2

/** Full-bleed 1024 icon. 0.80 scale leaves the ~10% margin iOS masks into. */
function iconSvg() {
  const s = 0.8
  const tx = 512 - INK_CX * s
  const ty = 512 - INK_CY * s
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  <rect width="1024" height="1024" fill="${INK}"/>
  <g transform="translate(${tx} ${ty}) scale(${s})">${mark(INK)}</g>
</svg>`
}

/** 2732 square launch image; the mark occupies ~26% of the edge. */
function splashSvg(bg) {
  const size = 2732
  const s = (size * 0.26) / 1024
  const tx = size / 2 - INK_CX * s
  const ty = size / 2 - INK_CY * s
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" fill="${bg}"/>
  <g transform="translate(${tx} ${ty}) scale(${s})">${mark(bg)}</g>
</svg>`
}

/** Renders SVG → PNG, flattened onto `bg` so the output has no alpha channel. */
async function png(svg, out, bg) {
  await sharp(Buffer.from(svg)).flatten({ background: bg }).png().toFile(join(HERE, out))
  process.stdout.write(`  assets/${out}\n`)
}

await mkdir(HERE, { recursive: true })
process.stdout.write('Generating Capacitor asset sources from the OpsTrack mark:\n')
await png(iconSvg(), 'icon.png', INK)
await png(splashSvg(BG_LIGHT), 'splash.png', BG_LIGHT)
await png(splashSvg(BG_DARK), 'splash-dark.png', BG_DARK)
process.stdout.write('Next: npx @capacitor/assets generate --ios\n')
