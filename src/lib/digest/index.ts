// The digest barrel — one import path per concept (contracts rule 1).
//
// Every consumer imports from `lib/digest`, never from `lib/digest/markdown`.
// That is what lets the three renderers be reorganised without touching a
// screen, and it is where `renderDigest()` lives: a format is a runtime value on
// this screen (three tabs), so dispatching it at every call site would mean
// three switch statements that can drift.
//
// Types are re-exported with `export type { … }` because verbatimModuleSyntax is
// on and a value re-export of a type is a build error.
//
// THE BARREL RE-EXPORTS ONLY WHAT A CONSUMER USES. The W5 audit found it also
// forwarded `isolate/needsIsolate/stripIsolates/FSI/PDI` (bidi.ts), `ds`
// (strings.ts), `CLASSIFY_ORDER` and seven model types that nothing outside
// this folder imports. Those are the renderers' own internals: forwarding them
// widened the public surface to include the exact modules the barrel exists to
// hide, and made "reorganise the renderers without touching a screen" a promise
// the file was quietly undermining. They are still exported from their own
// modules — the three renderers and the tests import them directly.

import { renderHtml } from './html'
import { renderMarkdown } from './markdown'
import { renderPlain } from './plain'
import type { DigestFormat, DigestModel } from './types'

export { buildDigestModel } from './build'
export { renderHtml } from './html'
export { renderMarkdown } from './markdown'
export { renderPlain } from './plain'
export { SECTION_ORDER, DIGEST_FORMATS } from './types'
export type {
  DigestFormat,
  DigestModel,
  DigestQuery,
  DigestRows,
  DigestSectionKind,
} from './types'

const RENDERERS: Readonly<Record<DigestFormat, (m: DigestModel) => string>> = {
  markdown: renderMarkdown,
  plain: renderPlain,
  html: renderHtml,
}

export function renderDigest(m: DigestModel, f: DigestFormat): string {
  return RENDERERS[f](m)
}

const EXTENSIONS: Readonly<Record<DigestFormat, string>> = {
  markdown: 'md',
  plain: 'txt',
  html: 'html',
}

/**
 * The MIME type a download and a clipboard write both need.
 *
 * `charset=utf-8` is not decoration: the Arabic digest is the common case here,
 * and a browser that guesses latin-1 on a downloaded `.txt` renders the whole
 * file as mojibake with no error anywhere.
 */
const MIME: Readonly<Record<DigestFormat, string>> = {
  markdown: 'text/markdown;charset=utf-8',
  plain: 'text/plain;charset=utf-8',
  html: 'text/html;charset=utf-8',
}

export function digestMimeType(f: DigestFormat): string {
  return MIME[f]
}

/**
 * `opstrack-2026-07-22_2026-07-29.md`.
 *
 * ISO dates and nothing else: the filename sorts correctly in a folder listing,
 * and it carries no localised text, because a filename travels to people who do
 * not read the language the report was written in — and because an Arabic
 * filename with an RTL run in the middle is mangled by half the tools that will
 * touch it.
 */
export function digestFilename(m: DigestModel, f: DigestFormat): string {
  return `opstrack-${m.from}_${m.to}.${EXTENSIONS[f]}`
}
