// Where "the app" lives, as an absolute URL.
//
// Pure and DOM-free so it can be tested under vitest's `environment: 'node'`;
// store/auth.ts supplies window.location.href at the call site.

/**
 * The directory the app is served from, derived from the current document URL.
 *
 * WHY NOT `import.meta.env.BASE_URL`. vite.config sets `base: './'` so the build
 * is path-portable, which makes BASE_URL the literal string `'./'`. Resolving
 * that against an ORIGIN — `new URL('./', location.origin)` — yields
 * `https://host/`, which on this deployment is the account's GitHub Pages root:
 * a 404 with no site behind it. That was shipped once as the fix for emailed
 * sign-in links landing on a 404, and it reproduced the bug exactly, leaving the
 * user's session tokens in the hash of a GitHub error page.
 *
 * Resolving `'.'` against the DOCUMENT gives its directory instead, which is the
 * app root by construction: the hash route and any query are dropped,
 * `/opstrack/index.html` collapses to `/opstrack/`, the dev server's subpath
 * works unchanged, and nothing here knows what the subpath is called — so it
 * survives the NphiesCore rename without an edit.
 */
export function baseUrlFrom(href: string): string {
  return new URL('.', href).href
}
