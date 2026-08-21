import { describe, it, expect } from 'vitest'
import { baseUrlFrom } from './appBase'

// REGRESSION, and a sharp one. The first fix for "the emailed sign-in link lands
// on a 404" was `new URL(import.meta.env.BASE_URL, location.origin)`. It reads as
// obviously correct and shipped the identical bug: vite.config sets `base: './'`
// for path portability, so BASE_URL is the literal './', and resolving that
// against an ORIGIN gives `https://host/` — the account's Pages root, where no
// site exists. The user's tokens landed in the hash of a GitHub 404 page.
//
// The last case is the one that would have caught it.
describe('baseUrlFrom resolves the app root, not the origin', () => {
  it('keeps the subpath', () => {
    expect(baseUrlFrom('https://abosallom.github.io/opstrack/')).toBe(
      'https://abosallom.github.io/opstrack/',
    )
  })

  it('strips the hash route', () => {
    expect(baseUrlFrom('https://abosallom.github.io/opstrack/#/followups')).toBe(
      'https://abosallom.github.io/opstrack/',
    )
  })

  it('strips a query and a hash together', () => {
    expect(baseUrlFrom('http://localhost:5197/opstrack/?shell#/board')).toBe(
      'http://localhost:5197/opstrack/',
    )
  })

  it('collapses index.html to its directory', () => {
    expect(baseUrlFrom('https://abosallom.github.io/opstrack/index.html')).toBe(
      'https://abosallom.github.io/opstrack/',
    )
  })

  it('still works when the app is served from the root', () => {
    expect(baseUrlFrom('https://example.com/')).toBe('https://example.com/')
  })

  // The custom domain, and the reason it needs no code change. A GitHub Pages
  // PROJECT site with a CNAME serves at the apex of that domain — `/`, not
  // `/opstrack/` — so the subpath the four cases above protect simply stops
  // existing. These assert that the same function, unedited, is still right on
  // the other side of the cut-over: the hash route goes, index.html collapses,
  // and what comes back is the origin because here the origin IS the app root.
  // That is the one situation where returning the bare origin is correct, which
  // is why the guard case below is scoped to "while the app sits in a subpath".
  it('serves from the apex once nphiescore.com is the origin', () => {
    for (const href of [
      'https://nphiescore.com/',
      'https://nphiescore.com/#/signin',
      'https://nphiescore.com/index.html',
      'https://nphiescore.com/?a=1#/board',
    ]) {
      expect(baseUrlFrom(href)).toBe('https://nphiescore.com/')
    }
  })

  it('survives a rename of the subpath without an edit here', () => {
    expect(baseUrlFrom('https://abosallom.github.io/nphiescore/#/x')).toBe(
      'https://abosallom.github.io/nphiescore/',
    )
  })

  it('NEVER returns the bare origin while the app sits in a subpath', () => {
    for (const href of [
      'https://abosallom.github.io/opstrack/',
      'https://abosallom.github.io/opstrack/#/signin',
      'https://abosallom.github.io/opstrack/index.html',
      'https://abosallom.github.io/opstrack/?a=1#/board',
    ]) {
      expect(baseUrlFrom(href)).not.toBe('https://abosallom.github.io/')
    }
  })
})
