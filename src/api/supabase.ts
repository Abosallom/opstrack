// Supabase client — Postgres, Auth, Realtime and RLS for the whole app.
//
// The client is NULLABLE on purpose. A build without VITE_SUPABASE_URL /
// VITE_SUPABASE_ANON_KEY (a fresh clone, a preview deploy, CI) must still boot
// and render the shell instead of throwing at import time and showing a white
// screen. Every call site guards on it and returns a friendly "not configured"
// message rather than assuming a live connection.
//
// ── R2-SEC-1 · THE SESSION LIVES IN AN ORIGIN THIS APP DOES NOT OWN ────────
//
// Read this before "hardening" the call below — the answer is not here.
//
// `createClient(url, anonKey)` takes supabase-js's defaults: `persistSession:
// true`, `storage: window.localStorage`, `storageKey: 'sb-<project-ref>-auth-
// token'`. That store holds the REFRESH token, not just a short-lived access
// token (store/auth.ts's storedSessionAfterFailedRefresh() reads exactly those
// fields back out of it), and localStorage is scoped to the ORIGIN, never to
// the path.
//
// The deployed origin is shared. Measured 2026-07-31: `/opstrack/`,
// `/raed-tracker/`, `/misbar-report/` and `/portfolio-sim/` all answer 200 on
// https://abosallom.github.io (a fifth Pages repo, Aldewaniah-App, 301s away to
// its own custom domain and so is NOT on this origin). Three unrelated hobby
// apps therefore run in the same localStorage as the department's tracker, and
// one of them — portfolio-sim — loads
// `https://cdn.jsdelivr.net/npm/chart.js@4.5.0/dist/chart.umd.js` with no
// `integrity` attribute. GitHub Pages sends no CSP, and index.html declares
// none. A poisoned CDN asset, or an XSS in any sibling, reads the key and
// replays the token against the project — and if the holder is the owner it
// also authorizes supabase/functions/admin-members, which gates on the caller's
// JWT alone.
//
// WHY NOTHING CHANGES AT THE `createClient` CALL. sessionStorage is
// origin-scoped too; cookies are domain-scoped, which is strictly worse;
// in-memory storage signs the user out on every reload and breaks the installed
// PWA. Renaming `storageKey` hides nothing — the reader is inside the origin —
// and would sign out every tester's live session for zero gain. The client
// setup here is idiomatic and correct; the defect is the DEPLOYMENT TARGET.
//
// THE FIX, and it belongs to the NphiesCore launch cut that docs/WAVE5-NOTES.md
// §1 already schedules for "repo+URL+bundle id+storage migration": give the app
// an origin of its own — `public/CNAME` plus a matching Vite `base`, on a
// subdomain of a domain the owner controls (he already runs this pattern on
// Aldewaniah-App) — and add that origin to the Supabase Auth redirect URLs.
// Two owner-side mitigations shrink the blast radius until then, neither of
// them in this repo: pin or vendor that chart.js tag in portfolio-sim, and turn
// on refresh-token rotation with reuse detection plus a shorter access-token
// TTL in Supabase Auth.
//
// UNTIL THAT LANDS, every repo published under abosallom.github.io is
// security-critical to this tracker and is in scope for review.

import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const url = (import.meta.env.VITE_SUPABASE_URL as string | undefined) ?? ''
const anonKey = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined) ?? ''

export const supabase: SupabaseClient | null =
  url && anonKey ? createClient(url, anonKey) : null

/** True when this build shipped Supabase credentials (backend available). */
export function isConfigured(): boolean {
  return supabase !== null
}
