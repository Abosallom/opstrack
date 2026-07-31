// Run N async writes with a bounded number in flight.
//
// WHY THIS IS NOT `Promise.all` AND NOT A `for … await` LOOP. Both extremes are
// wrong for a bulk action in this app, and the middle is not a compromise — it
// is the only shape that satisfies both constraints:
//
//   · `Promise.all` over a selection fires one request per row at once. Forty
//     rows ticked from a track heading is forty simultaneous PostgREST requests
//     from a single click — one browser presenting as forty sessions, against a
//     free-tier project, with no backpressure of any kind.
//   · A sequential loop pays the full round trip per row. Measured against the
//     live project (`lrysgpbkmuqgzsjesfkr`, connection reused): 253 ms median
//     warm, so thirty rows is ~7.6 s and a hundred is ~25 s, with the screen
//     disabled throughout. That is not "load-friendly", it is a frozen screen.
//
// Six at a time is the number `api/meetings.ts` already committed to for its
// commit fallback, arrived at the same way, and duplicating a *different*
// number here would be worse than duplicating the mechanism. Twelve sequential
// GETs measured 3.29 s; the same twelve in pools of six measured 0.75 s.
//
// ORDER OF RESULTS IS THE ORDER OF INPUTS, always — callers index back into
// their own id array to say which rows failed. Order of EXECUTION is by group,
// which is not the same guarantee and is not one anybody should rely on.
//
// NOTHING HERE REJECTS ON YOUR BEHALF. `Promise.all` inside a group means one
// throwing `fn` abandons the results of everything already resolved in that
// group, so callers whose per-item failures are DATA rather than exceptions
// (every `ApiResult` caller in this app) must keep returning a value instead of
// throwing — which is what `store/entries` already does.

/**
 * How many writes are in flight at once.
 *
 * Shared with `api/meetings.ts`'s commit fallback so the app has one answer to
 * "how much of this project's request budget may a single click spend".
 */
export const WRITE_CONCURRENCY = 6

/** Split an array into fixed-size groups, preserving order. */
export function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

/**
 * Run `fn` over every item, `limit` at a time, and return the results in the
 * order of `items`.
 */
export async function pooled<T, R>(
  items: readonly T[],
  fn: (item: T) => Promise<R>,
  limit: number = WRITE_CONCURRENCY,
): Promise<R[]> {
  // A caller computing its limit from a preference or a roster length must not
  // be able to produce a loop that never advances.
  const size = Math.max(1, Math.floor(limit))
  const out: R[] = []
  for (const group of chunk(items, size)) {
    out.push(...(await Promise.all(group.map(fn))))
  }
  return out
}
