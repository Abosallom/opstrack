// The bounded-concurrency helper, and the two properties every caller rests on:
// results come back in INPUT order, and no more than `limit` calls are ever in
// flight at once.
//
// The concurrency assertion is the one that matters. A regression that turns
// this back into a sequential loop keeps every other test in the repo green —
// the writes still land, in order, with the same results — and only shows up as
// a screen that sits disabled for seven seconds. Counting peak in-flight calls
// is the only way that failure becomes a test failure.

import { describe, expect, it } from 'vitest'
import { WRITE_CONCURRENCY, chunk, pooled } from './pooled'

/** A `fn` that records how many of its calls overlap, and resolves after `ms`. */
function tracker(delay = 0): {
  fn: (n: number) => Promise<number>
  peak: () => number
  order: number[]
} {
  let live = 0
  let peak = 0
  const order: number[] = []
  return {
    peak: () => peak,
    order,
    fn: async (n: number) => {
      live += 1
      peak = Math.max(peak, live)
      order.push(n)
      await new Promise((r) => setTimeout(r, delay))
      live -= 1
      return n * 2
    },
  }
}

describe('chunk', () => {
  it('preserves order and keeps the short tail', () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]])
  })

  it('answers an empty list for an empty input', () => {
    expect(chunk([], 6)).toEqual([])
  })
})

describe('pooled', () => {
  it('returns results in the order of the INPUT, not of completion', async () => {
    // Reverse delays: the last item finishes first. A caller that indexes back
    // into its own id array to report failures would blame the wrong rows if
    // this ever became completion order.
    const items = [0, 1, 2, 3, 4, 5]
    const out = await pooled(items, async (n) => {
      await new Promise((r) => setTimeout(r, (items.length - n) * 2))
      return n
    })
    expect(out).toEqual(items)
  })

  it('never runs more than the limit at once', async () => {
    const t = tracker(4)
    await pooled([...Array(20).keys()], t.fn, 6)
    expect(t.peak()).toBe(6)
  })

  it('actually runs them concurrently — this is the whole point', async () => {
    // The guard against a silent regression to `for (…) await`. Twenty items at
    // 10 ms each is 200 ms sequentially and ~40 ms in pools of six; the bound is
    // deliberately loose (120 ms) so a slow CI box cannot make it flaky, and
    // still far below the sequential figure.
    const started = Date.now()
    await pooled([...Array(20).keys()], async () => {
      await new Promise((r) => setTimeout(r, 10))
    })
    expect(Date.now() - started).toBeLessThan(120)
  })

  it('runs every item exactly once', async () => {
    const t = tracker()
    const out = await pooled([1, 2, 3, 4, 5, 6, 7], t.fn)
    expect(t.order.slice().sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7])
    expect(out).toEqual([2, 4, 6, 8, 10, 12, 14])
  })

  it('is a no-op on an empty list, with no await of an empty group', async () => {
    const t = tracker()
    expect(await pooled([], t.fn)).toEqual([])
    expect(t.peak()).toBe(0)
  })

  it('cannot be talked into a loop that never advances', async () => {
    // A caller deriving a limit from a preference or a roster length must not be
    // able to hand us 0 or -1 and hang the screen forever.
    expect(await pooled([1, 2, 3], async (n) => n, 0)).toEqual([1, 2, 3])
    expect(await pooled([1, 2, 3], async (n) => n, -4)).toEqual([1, 2, 3])
  })

  it('defaults to the shared write budget', () => {
    // Named rather than inlined at every call site so "how much of the project's
    // request budget may one click spend" has exactly one answer.
    expect(WRITE_CONCURRENCY).toBe(6)
  })
})
