// The PMO portfolio, held once for the page that reads it.
//
// ── WHY A STORE AND NOT AN EFFECT IN THE PAGE ─────────────────────────────
//
// `Pmo.test.tsx` renders with `renderToStaticMarkup`, where effects never run.
// A page that fetched in its own `useEffect` could only ever be tested in its
// loading state — the reason `store/goals.ts` exists and states the same thing.
// A store is the seam a test can fill.
//
// ── ONE READ, NOT NINE ────────────────────────────────────────────────────
//
// `listPortfolio()` fires nine reads in parallel and fails as a unit. This store
// holds the result as a unit too: there is no per-table loading flag, because a
// page that rendered its projects while its revenue was still in flight would
// show a portfolio with no money in it and nothing saying why.
//
// ── NULL IS "NOBODY HAS LOOKED", AND IT IS NOT AN EMPTY PORTFOLIO ─────────
//
// The distinction the whole PMO page turns on. `data === null` means no read has
// resolved; a `PmoPortfolio` with empty arrays means the read succeeded and the
// workspace genuinely holds no projects. The first must render as "loading" and
// the second as "nothing yet, here is how to add one" — and printing the second
// during the first tells a director his programme is empty for as long as the
// network takes.

import { create } from 'zustand'
import { listPortfolio, type PmoPortfolio } from '../api/pmo'
import { hasSession } from './auth'

interface PmoState {
  /** Null until a read resolves. Never coerced to an empty portfolio. */
  data: PmoPortfolio | null
  loading: boolean
  /** An i18n KEY from `pgErrorKey`, or null. */
  error: string | null
  loadedAt: number | null
}

const usePmoStore = create<PmoState>(() => ({
  data: null,
  loading: false,
  error: null,
  loadedAt: null,
}))

export function usePmo(): PmoPortfolio | null {
  return usePmoStore((s) => s.data)
}

export function usePmoLoading(): boolean {
  return usePmoStore((s) => s.loading)
}

export function usePmoError(): string | null {
  return usePmoStore((s) => s.error)
}

/**
 * ⚠ THE MIGRATION HAS NOT BEEN APPLIED, said as its own state.
 *
 * Until 0031 is run every read answers `PGRST205` — "table not found" — and the
 * page must say "this needs a setup step" rather than "there are no projects".
 * They look identical on screen and they are opposite facts: one is a five
 * minute job for the owner, the other is a programme with nothing in it.
 *
 * `pgErrorKey` maps PostgREST's `PGRST205` to `common.errMissingTable` — the
 * code's own comment calls this "a SUPPORTED state rather than a fault … the
 * one failure a screen can explain precisely". This is the one caller that
 * needs to branch on it, so the test lives here rather than in every section.
 */
export function usePmoNeedsMigration(): boolean {
  return usePmoStore((s) => s.error === MISSING_TABLE)
}

/** `lib/pgError.ts`'s key for PostgREST's PGRST205. Spelled once. */
const MISSING_TABLE = 'common.errMissingTable'

let inFlight: Promise<void> | null = null
/**
 * Bumped by `resetPmo`. A read that resolves after a sign-out belongs to the
 * account that has left — `store/portfolio.ts`'s `epoch`, for its reason.
 */
let epoch = 0

/**
 * Read the whole portfolio.
 *
 * Deduped while in flight and skipped once loaded unless forced, so the four
 * sections of the page can each call it on mount without four round trips —
 * the idiom `loadConfig` and `loadPortfolio` both use.
 */
export function loadPmo(force = false): Promise<void> {
  if (inFlight) return inFlight
  // No session, no read. A signed-out caller would get an RLS refusal that
  // `pgErrorKey` cannot distinguish from a real failure, and the page would
  // report a problem where there is only a missing sign-in.
  if (!hasSession()) return Promise.resolve()
  if (!force && usePmoStore.getState().loadedAt !== null) return Promise.resolve()

  // Only spin when there is nothing to show. A refetch must not blank the
  // numbers the reader is looking at.
  if (usePmoStore.getState().data === null) usePmoStore.setState({ loading: true })

  const mine = epoch
  inFlight = listPortfolio()
    .then((result) => {
      if (mine !== epoch) return
      if (!result.ok) {
        usePmoStore.setState({ loading: false, error: result.error })
        return
      }
      usePmoStore.setState({
        data: result.data,
        loading: false,
        error: null,
        loadedAt: Date.now(),
      })
    })
    .finally(() => {
      inFlight = null
    })
  return inFlight
}

/** After any write, so the next read is the server's answer rather than ours. */
export function invalidatePmo(): Promise<void> {
  usePmoStore.setState({ loadedAt: null })
  return loadPmo(true)
}

export function resetPmo(): void {
  epoch += 1
  inFlight = null
  usePmoStore.setState({ data: null, loading: false, error: null, loadedAt: null })
}
