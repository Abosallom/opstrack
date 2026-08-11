// "Copy for a deck" — the Mindtree as a file somebody can paste into a slide.
//
// MINDTREE-SPEC calls this the feature an ops lead will use most, and it is the
// one place in this feature where the picture has to survive leaving the app.
// That is a harder problem than it looks, and every decision below comes from
// one of its three traps.
//
// TRAP 1 — A CUSTOM PROPERTY IS NOT A COLOUR. Everything the Mindtree paints is
// `var(--track-color)`, `var(--text)`, `var(--bg-elev)`; those tokens are
// declared on `:root` in global.css and re-cascade when lib/theme.ts flips
// `data-theme`. Serialising the live <svg> as-is produces a file whose every
// fill is an unresolvable `var()` — which renders as BLACK ON BLACK in
// PowerPoint, Preview and every other consumer that has no `:root` to resolve
// against. So `serializeMindtreeSvg()` walks the clone in lockstep with the
// live tree and writes the COMPUTED value of a fixed property list onto each
// node inline. Note what that is and is not: it is not JavaScript CHOOSING a
// colour (lib/trackStyle.ts's forbidden move — a choice made once, at render,
// that goes stale when the theme flips). It is JavaScript READING the colour
// CSS already resolved, at the instant the user asked for a snapshot. An export
// is a photograph; a photograph of the dark theme in the dark theme is correct.
//
// TRAP 2 — A <use>, A <symbol> OR A STYLESHEET IS NOT SELF-CONTAINED. The file
// has to open standalone, so it carries no class attributes, no <style> block
// and no external reference of any kind. Inline presentation only. It also
// carries an opaque background rectangle: an SVG with a transparent ground
// dropped onto a white slide renders the dark theme's near-white label ink on
// white, and the user discovers that in front of a steering committee.
//
// TRAP 3 — PNG RASTERISATION IS ASYNCHRONOUS AND FAILS. `canvas.drawImage` of
// an SVG goes through an <img>, which loads asynchronously, can fail outright
// (a malformed serialisation), and — in every browser — TAINTS NOTHING here
// only because the SVG is a same-origin blob carrying no external references,
// which is trap 2 restated as a security property. `svgToPngBlob()` therefore
// rejects rather than hanging, revokes its object URL on every path including
// the failure ones, and has a timeout: an <img> that never fires either event
// is a promise nobody settles and a spinner nobody can dismiss.
//
// THE SPLIT IN THIS FILE. Everything above the `── the DOM half ──` divider is
// pure and is what export.test.ts exercises under vitest's `node` environment;
// everything below touches `document`, `Image`, `HTMLCanvasElement` or
// `navigator` and is called only from a click handler in a browser. Nothing at
// module scope reads a DOM global, so importing this module in node is safe —
// which is the property that lets the filename live here, next to the brand
// rule it has to satisfy, rather than in the page.

/** SVG or PNG — the two shapes a deck accepts. */
export type MindtreeExportKind = 'svg' | 'png'

export const MINDTREE_MIME: Readonly<Record<MindtreeExportKind, string>> = Object.freeze({
  svg: 'image/svg+xml;charset=utf-8',
  png: 'image/png',
})

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

/**
 * `nphiescore-mindtree-2026-07-31-1408.svg`.
 *
 * THE PREFIX IS THE BRAND, and `lib/brand.test.ts` is where that is enforced —
 * see its header for the rename that shipped in two halves and the reason a
 * filename counts as a user-visible string (it is read by more people than most
 * strings in the tree, long after it has left the app as an attachment).
 * lib/export.exportFilename is the same shape for the same reasons, and the two
 * deliberately share a stamp format so a Downloads folder sorts one product's
 * files together.
 *
 * LOCAL time, no colons, no spaces: "when did I take this" is a question the
 * user answers in their own clock, and both colons and spaces are legal on
 * macOS and lost on the trip to a Windows share.
 */
export function mindtreeFilename(kind: MindtreeExportKind, at: Date): string {
  const stamp =
    `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}` +
    `-${pad(at.getHours())}${pad(at.getMinutes())}`
  return `nphiescore-mindtree-${stamp}.${kind}`
}

/**
 * XML text-node and attribute escaping.
 *
 * Five entities, not three. `>` is only ambiguous inside `]]>` but costs
 * nothing to escape, and BOTH quote characters have to go because this escapes
 * attribute values as well as text — a track named `IT "Ops"` would otherwise
 * close the `title=` attribute and turn the rest of the document into markup.
 * Entry titles and track names are arbitrary user text; this is the boundary
 * where that stops being someone else's problem.
 */
export function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

/**
 * The band printed ABOVE the drawing.
 *
 * `<title>` and `<desc>` are metadata: a screen reader hears them, and a slide
 * does not. The artifact this feature exists to produce is a picture on a
 * steering deck, where an unlabelled, undated, silently-filtered diagram is
 * worse than no diagram — the audience has no way to know it is looking at one
 * person's filtered view of last Tuesday. So the same four facts are also
 * PAINTED, in the file, where the audience is.
 *
 * The app tells the user this too (`mindtree.exportHint`); the difference is
 * that the hint is read by the person exporting and the band is read by
 * everyone after them.
 */
export interface SvgCaption {
  /** One line, larger: the product and the screen. */
  heading: string
  /** In order: the timestamp, the shape summary, and a filter warning if any. */
  lines: readonly string[]
  /** Ink, ALREADY RESOLVED off the live document — never chosen here (trap 1). */
  ink: string
  /** The resolved font stack, likewise read rather than picked. */
  font: string
}

export interface SvgDocumentOptions {
  /** CSS pixels the file declares itself to be. */
  width: number
  height: number
  /** The user coordinate window — normally the on-screen viewBox, verbatim. */
  viewBox: string
  /** An opaque ground. See trap 2 in the header. */
  background: string
  /** `<title>` — the file's accessible name, and its tooltip in most viewers. */
  title: string
  /** `<desc>` — the shape summary, the same sentence the on-screen tree gives. */
  desc: string
  /** Mirrors `dir` so a viewer lays Arabic labels out the way the app did. */
  direction: 'ltr' | 'rtl'
  /** Already-serialised markup: the edges and nodes, with styles inlined. */
  body: string
  /** Omitted, the document is exactly the drawing. */
  caption?: SvgCaption
}

export interface ViewBox {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

/**
 * `"x y w h"` back into four numbers, or null.
 *
 * Written here rather than trusted, because the caption has to GROW the window
 * upward and cannot do that to a string. Accepts the comma-or-space separators
 * the SVG grammar allows even though this app only ever writes spaces: the
 * value can arrive off an element somebody else rendered.
 */
export function parseViewBox(value: string | null | undefined): ViewBox | null {
  if (typeof value !== 'string') return null
  const parts = value.trim().split(/[\s,]+/)
  if (parts.length !== 4) return null
  const [x, y, width, height] = parts.map(Number)
  if (![x, y, width, height].every((n) => Number.isFinite(n))) return null
  if (width <= 0 || height <= 0) return null
  return { x, y, width, height }
}

/**
 * The standalone document, as a string.
 *
 * PURE, and the reason this half of the module exists separately: the XML
 * declaration, the two namespaces, the escaping and the background rectangle
 * are the parts that are easy to get silently wrong and trivial to test, and
 * none of them needs a DOM to be right.
 *
 * `xmlns:xlink` is deliberately absent — nothing here emits a link, a `<use>`
 * or an external reference (trap 2), and declaring an unused namespace invites
 * a future edit to start using it.
 *
 * `width`/`height` are written as attributes AND the viewBox is kept, because
 * the two answer different questions: the attributes are what a consumer with
 * no layout engine (PowerPoint's importer, `<img src>`) uses to size the
 * picture, and the viewBox is what keeps it from stretching when something
 * resizes it anyway.
 */
export function svgDocument(options: SvgDocumentOptions): string {
  let width = Math.max(1, Math.round(finite(options.width, 1)))
  let height = Math.max(1, Math.round(finite(options.height, 1)))
  let viewBox = options.viewBox
  let band = ''

  const view = parseViewBox(options.viewBox)
  const caption = options.caption
  if (caption !== undefined && view !== null) {
    // USER UNITS PER DECLARED PIXEL. The caption has to render at a constant
    // point size whatever the map's own scale is, and the map's scale varies by
    // two orders of magnitude between a three-track workspace and a filtered
    // one thousand. Sizing the band in user units directly would print a 4px
    // heading on the big map and a 40px one on the small.
    const unit = view.width / width
    const pad = CAPTION_PAD_PX * unit
    const head = CAPTION_HEAD_PX * unit
    const line = CAPTION_BODY_PX * unit
    const step = line + CAPTION_GAP_PX * unit
    const bandHeight = captionBandHeight(view, width, caption.lines.length)

    const rtl = options.direction === 'rtl'
    // Anchored at the INLINE start, which the document's own `direction`
    // resolves — the same rule MindNode.tsx follows for its two text runs, and
    // the reason the anchor keyword below is constant in both languages.
    const textX = rtl ? view.x + view.width - pad : view.x + pad
    const top = view.y - bandHeight

    const rows: string[] = [
      textRow(caption.heading, textX, top + pad + head * 0.8, CAPTION_HEAD_PX * unit, 700, caption),
    ]
    caption.lines.forEach((text, i) => {
      rows.push(textRow(text, textX, top + pad + head + step * i + line * 0.8, line, 500, caption))
    })
    band = `${rows.join('\n')}\n`

    viewBox = `${round(view.x)} ${round(top)} ${round(view.width)} ${round(view.height + bandHeight)}`
    height = Math.max(1, Math.round((width * (view.height + bandHeight)) / view.width))
  }

  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="no"?>\n` +
    `<svg xmlns="http://www.w3.org/2000/svg" version="1.1"` +
    ` width="${width}" height="${height}"` +
    ` viewBox="${escapeXml(viewBox)}"` +
    ` direction="${options.direction === 'rtl' ? 'rtl' : 'ltr'}"` +
    ` role="img" aria-label="${escapeXml(options.title)}">\n` +
    `<title>${escapeXml(options.title)}</title>\n` +
    `<desc>${escapeXml(options.desc)}</desc>\n` +
    // Painted in USER units via the viewBox, not in CSS pixels: a `width="100%"`
    // rect resolves against the viewport, and a viewer that ignores the width
    // attribute would leave a corner of the picture on a transparent ground.
    `<rect x="-100000" y="-100000" width="200000" height="200000"` +
    ` fill="${escapeXml(options.background)}"/>\n` +
    band +
    `${options.body}\n</svg>\n`
  )
}

/** Caption metrics, in CSS pixels of the DECLARED size. See svgDocument(). */
const CAPTION_HEAD_PX = 17
const CAPTION_BODY_PX = 12.5
const CAPTION_GAP_PX = 5
const CAPTION_PAD_PX = 16

/**
 * How far the caption grows the drawing, in USER units.
 *
 * Exported because two callers need the same number and computing it twice is
 * how a PNG comes back with the band cropped off the top: `svgDocument()` moves
 * the viewBox by it, and `serializeMindtreeSvg()` sizes the raster by it.
 */
export function captionBandHeight(view: ViewBox, widthPx: number, lineCount: number): number {
  const unit = view.width / Math.max(1, widthPx)
  return (
    (CAPTION_PAD_PX * 2 + CAPTION_HEAD_PX + Math.max(0, lineCount) * (CAPTION_BODY_PX + CAPTION_GAP_PX)) *
    unit
  )
}

function textRow(
  text: string,
  x: number,
  y: number,
  size: number,
  weight: number,
  caption: SvgCaption,
): string {
  // Presentation inline, never a class: the file carries no stylesheet (trap 2).
  return (
    `<text x="${round(x)}" y="${round(y)}" text-anchor="start"` +
    ` style="fill:${escapeXml(caption.ink)};font-family:${escapeXml(caption.font)};` +
    `font-size:${round(size)}px;font-weight:${weight};">${escapeXml(text)}</text>`
  )
}

/** Three decimals, matching lib/mindtree/layout's own rounding. */
function round(value: number): number {
  return Math.round(finite(value, 0) * 1000) / 1000
}

function finite(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback
}

// ── the DOM half ───────────────────────────────────────────────────────────
//
// Everything below needs a browser. None of it runs at module scope, so this
// file still imports cleanly into a node test.

/**
 * The properties copied onto every element of the clone.
 *
 * A FIXED LIST, not "every computed property". `getComputedStyle` returns ~340
 * longhands; writing all of them onto every node of a 400-node tree produces a
 * multi-megabyte file that Illustrator chokes on and that carries irrelevancies
 * like `animation-timeline` into a static picture. These fifteen are what an
 * SVG actually paints with, plus the four text properties, and they are listed
 * rather than derived so that adding a visual channel to the map is a
 * deliberate edit here.
 *
 * `visibility` and `display` ride along because the map hides marks with them —
 * a mark the reader cannot see must not appear in the file they hand over.
 */
export const INLINE_PROPERTIES: readonly string[] = Object.freeze([
  'fill',
  'fill-opacity',
  'fill-rule',
  'stroke',
  'stroke-width',
  'stroke-opacity',
  'stroke-linecap',
  'stroke-linejoin',
  'stroke-dasharray',
  'opacity',
  'color',
  'display',
  'visibility',
  'font-family',
  'font-size',
  'font-weight',
  'font-style',
  'letter-spacing',
  'text-anchor',
  'dominant-baseline',
  'paint-order',
])

/**
 * Attributes stripped from the clone.
 *
 * The file is a picture, not a control surface. `tabindex` in a standalone SVG
 * opened in a browser produces a document full of tab stops that go nowhere;
 * `class` refers to a stylesheet the file does not carry (trap 2); the roving
 * `role="treeitem"`/`aria-expanded` pair describes an interaction the file
 * cannot honour, and a tree whose items never expand is worse than a flat
 * picture. The `<svg>`'s own `role="img"` and `<title>`/`<desc>` are what
 * survive, and they are written by `svgDocument()`.
 */
const STRIPPED_ATTRIBUTES: readonly string[] = [
  'class',
  'tabindex',
  'role',
  'aria-expanded',
  'aria-level',
  'aria-posinset',
  'aria-setsize',
  'aria-selected',
  'aria-hidden',
  'aria-labelledby',
  'aria-describedby',
  'id',
]

export interface SerializeOptions {
  /** Overrides the ground colour read off the source element. */
  background?: string
  title: string
  desc: string
  direction: 'ltr' | 'rtl'
  /**
   * The window to export, overriding whatever the element is currently showing.
   *
   * THE CALLER SHOULD ALWAYS PASS THE WHOLE-MAP FIT, and the reason is the
   * previous behaviour: the live viewBox is the reader's current zoom and pan,
   * so an export taken after zooming in — which is how anyone reads a large map
   * — silently shipped a crop. A quarter of a diagram is not a smaller diagram;
   * it is a different and wrong claim about the workload.
   */
  viewBox?: string
  /** The band painted above the drawing. Omitted, the file is bare. */
  caption?: { heading: string; lines: readonly string[] }
}

export interface MindtreeSvgFile {
  /** The standalone document. */
  document: string
  /** The pixel size it declares — what the PNG raster must be sized from. */
  width: number
  height: number
}

/**
 * The longest side an export declares itself to be, in CSS pixels.
 *
 * The file is written at 1:1 — one drawing unit per pixel — so a 12.5-unit
 * label is a 12.5px label in the file rather than the 4px it may be on screen
 * (the canvas is ~520px tall and a real map is several thousand units). The cap
 * is a memory guard on the 2× PNG raster that follows: 4000 × 2 is a 8000px
 * canvas, which is inside every browser's limit, and 8000 × 2 is not.
 */
const EXPORT_MAX_PX = 4000

/**
 * The live <svg> as a standalone document.
 *
 * The clone is walked in LOCKSTEP with the source rather than being re-queried
 * by selector: `querySelectorAll('*')` returns document order, both trees are
 * structurally identical because one is a clone of the other, so index `i` in
 * each is the same element. A selector-based match would need ids, and ids are
 * exactly what gets stripped.
 *
 * Elements marked `data-export="off"` are removed WITH THEIR SUBTREE before the
 * walk — the focus ring, the pan hit-plate, anything that exists only because
 * the picture is interactive. Removing them first also keeps them out of the
 * index alignment, which is why it happens on the clone before either list is
 * taken.
 */
export function serializeMindtreeSvg(
  source: SVGSVGElement,
  options: SerializeOptions,
): MindtreeSvgFile {
  const clone = source.cloneNode(true) as SVGSVGElement
  for (const el of Array.from(clone.querySelectorAll('[data-export="off"]'))) el.remove()

  const sourceEls = Array.from(source.querySelectorAll('*')).filter(
    (el) => el.closest('[data-export="off"]') === null,
  )
  const cloneEls = Array.from(clone.querySelectorAll('*'))

  const count = Math.min(sourceEls.length, cloneEls.length)
  for (let i = 0; i < count; i += 1) {
    inlineOne(sourceEls[i] as Element, cloneEls[i] as Element)
  }

  const rect = source.getBoundingClientRect()
  const rootStyle = window.getComputedStyle(source)
  const background = options.background ?? readBackground(source) ?? rootStyle.backgroundColor

  const viewBox = options.viewBox ?? source.getAttribute('viewBox') ?? `0 0 ${rect.width} ${rect.height}`
  const view = parseViewBox(viewBox)
  // 1:1, capped. Falls back to the element's own box only when the viewBox is
  // unparseable, which is the case a caller cannot cause but a future one might.
  const width = Math.max(1, Math.round(view === null ? rect.width : Math.min(view.width, EXPORT_MAX_PX)))
  const drawnHeight = view === null ? rect.height : (width * view.height) / view.width
  // The caption grows the block axis; the raster must be sized from the grown
  // number or the band it was added to carry is cropped off the top.
  const band =
    view === null || options.caption === undefined
      ? 0
      : (width * captionBandHeight(view, width, options.caption.lines.length)) / view.width
  const height = Math.max(1, Math.round(drawnHeight + band))

  const document_ = svgDocument({
    width,
    height: drawnHeight,
    viewBox,
    background: background === '' || background === 'rgba(0, 0, 0, 0)' ? '#ffffff' : background,
    title: options.title,
    desc: options.desc,
    direction: options.direction,
    body: clone.innerHTML,
    caption:
      options.caption === undefined
        ? undefined
        : {
            heading: options.caption.heading,
            lines: options.caption.lines,
            // READ, never chosen — trap 1. `color` and `font-family` are what
            // the app resolved for this element under the live theme.
            ink: rootStyle.color === '' ? '#000000' : rootStyle.color,
            font: rootStyle.fontFamily === '' ? 'system-ui, sans-serif' : rootStyle.fontFamily,
          },
  })

  return { document: document_, width, height }
}

function inlineOne(from: Element, to: Element): void {
  const computed = window.getComputedStyle(from)
  let style = ''
  for (const property of INLINE_PROPERTIES) {
    const value = computed.getPropertyValue(property)
    // An empty value means the property does not apply to this element (a
    // <path> has no font-family); writing it anyway is bytes for nothing.
    // A `var(` that survived computation is an UNRESOLVED custom property —
    // trap 1 arriving through the fix — and it must not reach the file.
    if (value === '' || value.includes('var(')) continue
    style += `${property}:${value};`
  }
  if (style !== '') to.setAttribute('style', style)
  for (const attribute of STRIPPED_ATTRIBUTES) to.removeAttribute(attribute)
}

/**
 * The nearest painted background behind the map.
 *
 * Walks up from the <svg> because the canvas itself is transparent — it sits on
 * a `.mtree-canvas` that carries the card colour. Stops at the first element
 * whose background is not fully transparent, and returns null if it reaches the
 * top without finding one, which is the caller's cue to fall back to white.
 */
function readBackground(from: Element): string | null {
  let el: Element | null = from
  while (el !== null) {
    const value = window.getComputedStyle(el).backgroundColor
    if (value !== '' && value !== 'transparent' && !value.startsWith('rgba(0, 0, 0, 0')) return value
    el = el.parentElement
  }
  return null
}

export interface PngOptions {
  width: number
  height: number
  /**
   * Device-pixel multiplier. 2 by default: a deck is projected, and a 1× raster
   * of 12px labels is unreadable on the third row of a meeting room.
   */
  scale?: number
  /** Milliseconds before a never-settling <img> is treated as a failure. */
  timeoutMs?: number
}

/**
 * Rasterise a serialised SVG document.
 *
 * REJECTS, NEVER HANGS, AND ALWAYS REVOKES — trap 3. Every exit path goes
 * through `settle()`, which clears the timer, revokes the object URL and
 * detaches both handlers; without that, a failed export leaks a blob for the
 * life of the tab and leaves the caller's `exporting` flag stuck on.
 *
 * `canvas.toBlob` is used rather than `toDataURL` because a 2× raster of a wide
 * map is several megabytes and a data URL is a string that has to be built,
 * base64'd and held in memory in one piece.
 */
export function svgToPngBlob(document_: string, options: PngOptions): Promise<Blob> {
  const scale = options.scale !== undefined && options.scale > 0 ? options.scale : 2
  const width = Math.max(1, Math.round(options.width * scale))
  const height = Math.max(1, Math.round(options.height * scale))
  const timeoutMs = options.timeoutMs ?? 15_000

  return new Promise<Blob>((resolve, reject) => {
    const url = URL.createObjectURL(new Blob([document_], { type: MINDTREE_MIME.svg }))
    const image = new Image()
    let done = false

    const settle = (): void => {
      done = true
      window.clearTimeout(timer)
      image.onload = null
      image.onerror = null
      URL.revokeObjectURL(url)
    }

    const fail = (message: string): void => {
      if (done) return
      settle()
      reject(new Error(message))
    }

    const timer = window.setTimeout(() => fail('mindtree-export-timeout'), timeoutMs)

    image.onload = (): void => {
      if (done) return
      try {
        const canvas = document.createElement('canvas')
        canvas.width = width
        canvas.height = height
        const ctx = canvas.getContext('2d')
        if (ctx === null) {
          fail('mindtree-export-no-2d-context')
          return
        }
        // The document already paints its own opaque ground (trap 2), so the
        // canvas needs no fill of its own — and adding one would be a second
        // place that has to agree with the theme.
        ctx.drawImage(image, 0, 0, width, height)
        settle()
        canvas.toBlob((blob) => {
          if (blob === null) reject(new Error('mindtree-export-encode-failed'))
          else resolve(blob)
        }, MINDTREE_MIME.png)
      } catch (error) {
        fail(error instanceof Error ? error.message : 'mindtree-export-draw-failed')
      }
    }

    image.onerror = (): void => fail('mindtree-export-image-failed')
    image.src = url
  })
}

/**
 * Hand the browser a file.
 *
 * `appendChild` before the click is not superstition — Firefox ignores a
 * synthetic click on an anchor that is not in the document. The revoke is
 * deferred a tick because Safari has aborted downloads whose object URL was
 * revoked synchronously with the click. Both notes are lifted verbatim from
 * pages/settings/Export.tsx's `download()`, which learned them first; they are
 * restated rather than imported because that one is a private function of a
 * page and reaching into a page from lib/ would invert the layering.
 */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.rel = 'noopener'
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 0)
}

/**
 * Put the PNG on the clipboard.
 *
 * REJECTS ON EVERY UNSUPPORTED PATH rather than silently doing nothing, so the
 * caller can offer the download instead (`mindtree.errCopy`). The three ways
 * this legitimately fails are all common and none is a bug: Firefox has no
 * `ClipboardItem` for images, the API is unavailable outside a secure context,
 * and Safari rejects a write that did not originate in a user gesture — which
 * is why the caller must call this from the click handler itself and not from a
 * `.then()` after the raster finishes.
 */
export async function copyPngToClipboard(blob: Blob): Promise<void> {
  const anyWindow = window as unknown as { ClipboardItem?: new (items: Record<string, Blob>) => unknown }
  const Item = anyWindow.ClipboardItem
  if (Item === undefined || navigator.clipboard === undefined) {
    throw new Error('mindtree-clipboard-unsupported')
  }
  const write = (navigator.clipboard as unknown as { write?: (items: unknown[]) => Promise<void> })
    .write
  if (write === undefined) throw new Error('mindtree-clipboard-unsupported')
  await write.call(navigator.clipboard, [new Item({ [blob.type]: blob })])
}
