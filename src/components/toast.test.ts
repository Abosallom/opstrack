// The toast STORE, not the component.
//
// WHY THIS FILE EXISTS. `main.tsx` raises exactly one sticky toast — "a new
// version is available" — and its button is the only reference to `updateSW` in
// the entire app (it is closed over at registration and exported nowhere). The
// stack used to cap itself with `.slice(-MAX_STACK)`, which evicts the oldest
// unconditionally, so three ordinary toasts made a shipped release permanently
// unapplicable for that session. There is no other symptom: no error, no log,
// just an update that never arrives.
//
// That is an availability bug living in four lines of array arithmetic, which
// is exactly the kind that comes back. The eviction policy is asserted here.
//
// THE SECOND HALF OF THE SAME STORY is the duplicate prompt: onNeedRefresh
// fires once per waiting worker, so two deploys against one open tab stacked
// two identical, never-expiring "a new version is available" toasts. The fix is
// `ToastOptions.key` — a second raise of a key REPLACES the toast in that slot.
// Both policies are asserted below, and they pull in opposite directions, so
// both sets of tests have to pass together: a key may displace ITS OWN
// predecessor and nothing else may displace a sticky at all.
//
// Only the store is exercised; <Toaster /> is a component and vitest runs in
// `node`. The store's one environmental dependency is window.setTimeout, shimmed
// in vi.hoisted because the module schedules on import of its first call — the
// same pattern pages/Capture.test.tsx uses for localStorage.

import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.hoisted(() => {
  const g = globalThis as { window?: unknown }
  g.window ??= {
    setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms),
    clearTimeout: (h: number) => {
      clearTimeout(h)
    },
  }
})

import { Toaster, dismissToast, getToasts, toast } from './toast'

describe('toast stack eviction', () => {
  beforeEach(() => {
    for (const it of getToasts()) dismissToast(it.id)
  })

  it('caps ordinary toasts at three, oldest out', () => {
    toast('one')
    toast('two')
    toast('three')
    toast('four')
    expect(getToasts().map((t) => t.message)).toEqual(['two', 'three', 'four'])
  })

  it('never evicts a sticky toast to make room', () => {
    // THE regression. The update prompt is raised first and then buried under
    // ordinary traffic; it has to still be there at the end.
    const update = toast('new version available', { duration: 0, action: { label: 'Reload', onClick: () => {} } })
    toast('captured')
    toast('undone')
    toast('saved')
    toast('saved again')

    // `captured` is evicted by `saved`, then `undone` by `saved again` — the
    // oldest AUTO-DISMISSING toast each time, never the prompt.
    const stack = getToasts()
    expect(stack.some((t) => t.id === update)).toBe(true)
    expect(stack.map((t) => t.message)).toEqual(['new version available', 'saved', 'saved again'])
  })

  it('keeps a sticky toast no matter how much traffic follows', () => {
    const update = toast('new version available', { duration: 0 })
    for (let i = 0; i < 50; i++) toast(`noise ${i}`)
    expect(getToasts().some((t) => t.id === update)).toBe(true)
    expect(getToasts()).toHaveLength(3)
  })

  it('lets an all-sticky stack grow rather than dropping a prompt', () => {
    // Documented trade-off, not an oversight: every sticky toast is somebody's
    // only button. There is one call site today, so this cannot run away.
    for (let i = 0; i < 5; i++) toast(`prompt ${i}`, { duration: 0 })
    expect(getToasts()).toHaveLength(5)
  })

  it('still dismisses a sticky toast on request', () => {
    const id = toast('new version available', { duration: 0 })
    dismissToast(id)
    expect(getToasts()).toHaveLength(0)
  })

  it('does not mint a new array when dismissing an id that is already gone', () => {
    // useSyncExternalStore compares snapshots by reference, so a late timer for
    // an evicted toast would re-render the whole stack for nothing.
    toast('one')
    const before = getToasts()
    dismissToast(99999)
    expect(getToasts()).toBe(before)
  })
})

describe('toast dedupe by key', () => {
  beforeEach(() => {
    for (const it of getToasts()) dismissToast(it.id)
  })

  it('replaces rather than stacks when the same key is raised again', () => {
    // THE G5 regression, at its smallest. Two identical prompts were observed on
    // one screen; the second raise must land in the first one's slot.
    toast('a new version is available', { key: 'sw-update', duration: 0 })
    toast('a new version is available', { key: 'sw-update', duration: 0 })

    expect(getToasts()).toHaveLength(1)
    expect(getToasts()[0].message).toBe('a new version is available')
  })

  it('survives a deploy storm with exactly one prompt', () => {
    // A tab left open for a week of deploys. onNeedRefresh fires per waiting
    // worker, and every raise carries a fresh updateSW closure.
    for (let i = 0; i < 40; i++) toast(`version ${i} available`, { key: 'sw-update', duration: 0 })

    expect(getToasts()).toHaveLength(1)
    expect(getToasts()[0].message).toBe('version 39 available')
  })

  it('keeps the slot: same id, same position, updated content', () => {
    // In place, not append: the id is stable so React does not remount the node
    // (no second announcement from the live region), and the position is stable
    // so the prompt does not slide out from under a pointer heading for its
    // button. The action is taken from the LATEST raise.
    const first = toast('one', { key: 'slot', duration: 0, action: { label: 'A', onClick: () => {} } })
    toast('trailing')
    const second = toast('two', { key: 'slot', duration: 0, action: { label: 'B', onClick: () => {} } })

    expect(second).toBe(first)
    expect(getToasts().map((t) => t.message)).toEqual(['two', 'trailing'])
    expect(getToasts()[0].id).toBe(first)
    expect(getToasts()[0].action?.label).toBe('B')
  })

  it('drops the options the newer raise omits instead of merging them', () => {
    // Replace, not patch. A merge would leave a stale action button — someone
    // else's onClick — attached to a message that no longer describes it.
    toast('working', { key: 'slot', duration: 0, tone: 'error', action: { label: 'Retry', onClick: () => {} } })
    toast('done', { key: 'slot', duration: 0, tone: 'success' })

    expect(getToasts()[0].action).toBeUndefined()
    expect(getToasts()[0].tone).toBe('success')
  })

  it('treats distinct keys as distinct toasts', () => {
    toast('update', { key: 'sw-update', duration: 0 })
    toast('sync failed', { key: 'outbox', duration: 0 })
    toast('update', { key: 'sw-update', duration: 0 })

    expect(getToasts().map((t) => t.message)).toEqual(['update', 'sync failed'])
  })

  it('never dedupes unkeyed toasts, however identical', () => {
    // Two captures deserve two toasts. Dedupe is opt-in by slot, never by text.
    toast('Entry captured')
    toast('Entry captured')

    expect(getToasts()).toHaveLength(2)
  })

  it('dismisses cleanly by the id a repeat raise returned', () => {
    toast('first', { key: 'slot', duration: 0 })
    const id = toast('second', { key: 'slot', duration: 0 })
    dismissToast(id)

    expect(getToasts()).toHaveLength(0)
    // And the slot is free: the next raise opens a new toast rather than
    // silently writing into a slot that is no longer on screen.
    toast('third', { key: 'slot', duration: 0 })
    expect(getToasts().map((t) => t.message)).toEqual(['third'])
  })

  it('does not evict a DIFFERENT sticky to make room for a keyed one', () => {
    // The C6 invariant, restated against the new mechanism: a key displaces its
    // own predecessor and nothing else. Both prompts are somebody's only button.
    const other = toast('offline changes pending', { duration: 0 })
    toast('update', { key: 'sw-update', duration: 0 })
    toast('update', { key: 'sw-update', duration: 0 })

    expect(getToasts().some((t) => t.id === other)).toBe(true)
    expect(getToasts().map((t) => t.message)).toEqual(['offline changes pending', 'update'])
  })

  it('does not evict transient toasts either — replacing costs no room', () => {
    // A keyed repeat leaves stack length unchanged, so trimStack has nothing to
    // do and the three ordinary toasts beside the prompt all survive it.
    toast('update', { key: 'sw-update', duration: 0 })
    toast('one')
    toast('two')
    toast('update', { key: 'sw-update', duration: 0 })

    expect(getToasts().map((t) => t.message)).toEqual(['update', 'one', 'two'])
  })
})

describe('toast key re-arms the countdown', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    for (const it of getToasts()) dismissToast(it.id)
  })
  afterEach(() => {
    for (const it of getToasts()) dismissToast(it.id)
    vi.useRealTimers()
  })

  it('makes the slot sticky when the newer raise is sticky', () => {
    toast('checking', { key: 'slot', duration: 1000 })
    toast('a new version is available', { key: 'slot', duration: 0 })

    vi.advanceTimersByTime(60_000)
    expect(getToasts()).toHaveLength(1)
  })

  it('lets the newer raise put a countdown back on a sticky slot', () => {
    // The other direction, and the reason the replace re-arms from scratch
    // rather than leaving the old timer alone: a slot that went sticky once must
    // not stay sticky forever.
    toast('a new version is available', { key: 'slot', duration: 0 })
    toast('updated', { key: 'slot', duration: 1000 })

    vi.advanceTimersByTime(1500)
    expect(getToasts()).toHaveLength(0)
  })
})

/**
 * THE CALL SITE, NOT THE MECHANISM.
 *
 * Every test above passes just as well with `key` supported and nobody using
 * it, which is precisely the state the duplicate prompt was observed in. The
 * one thing the store cannot see is whether main.tsx asks for the slot — so
 * this reads the source, the way store/outbox.test.ts reads its wiring.
 *
 * Source comes through import.meta.glob('?raw') rather than node:fs for the
 * reason lib/localeReach.test.ts spells out: tsconfig.app.json pins
 * `types: ["vite/client"]`, and adding "node" would leak node globals into the
 * type space of every app file.
 */
const MAIN_FILE: Record<string, string> = import.meta.glob('../main.tsx', {
  query: '?raw',
  import: 'default',
  eager: true,
})

function mainSource(): string {
  const text = Object.values(MAIN_FILE)[0]
  if (text === undefined) throw new Error('src/main.tsx not found by import.meta.glob')
  return text
}

/**
 * WHAT THE USER ACTUALLY SEES.
 *
 * Every assertion above is about the store's array. The bug that was REPORTED is
 * about pixels: "two identical 'A new version is available' toasts". The step
 * between them is <Toaster />, so this renders it — to a string, via
 * react-dom/server, which needs no DOM and so does not disturb the `node`
 * environment this file's header defends. (useSyncExternalStore is called with a
 * server snapshot, which is why it renders at all.)
 *
 * The unkeyed case is kept beside it as the negative control: it reproduces the
 * reported markup exactly, which is the only way to know the keyed assertion is
 * measuring something.
 */
describe('what <Toaster /> renders', () => {
  beforeEach(() => {
    for (const it of getToasts()) dismissToast(it.id)
  })

  const nodes = (html: string): number => html.split('class="toast"').length - 1
  const prompts = (html: string): number => html.split('A new version is available').length - 1

  it('renders ONE prompt when the update toast is raised twice with its key', () => {
    for (let i = 0; i < 2; i++) {
      toast('A new version is available', {
        key: 'sw-update',
        duration: 0,
        action: { label: 'Reload', onClick: () => {} },
      })
    }
    const html = renderToStaticMarkup(createElement(Toaster))

    expect(nodes(html)).toBe(1)
    expect(prompts(html)).toBe(1)
    expect(html.split('toast-action').length - 1).toBe(1)
  })

  it('renders TWO — the reported bug — without the key', () => {
    for (let i = 0; i < 2; i++) {
      toast('A new version is available', {
        duration: 0,
        action: { label: 'Reload', onClick: () => {} },
      })
    }
    const html = renderToStaticMarkup(createElement(Toaster))

    expect(nodes(html)).toBe(2)
    expect(prompts(html)).toBe(2)
  })

  it('keeps the live region mounted with nothing in it', () => {
    // Unchanged by any of this, and asserted here because the keyed path is a
    // new way to empty the stack: assistive tech only announces content added to
    // an already-present live region.
    const html = renderToStaticMarkup(createElement(Toaster))
    expect(html).toContain('aria-live="polite"')
    expect(nodes(html)).toBe(0)
  })
})

describe('main.tsx update prompt wiring', () => {
  it('raises the update prompt as a keyed sticky', () => {
    const src = mainSource()
    // One prompt call site, so a bare grep is unambiguous: if the key is ever
    // dropped from it, this fails and the duplicate is back.
    expect(src.split('pwa.updateReady')).toHaveLength(2)
    expect(src).toContain("key: 'sw-update'")
    expect(src).toContain('duration: 0')
  })

  it('re-checks for a new worker on visibility and on an interval', () => {
    // M6. Without these the keyed, unloseable prompt is also an unreachable one:
    // a HashRouter PWA never navigates, so the browser never re-checks and an
    // installed app learns about a deploy only when it is force-quit.
    const src = mainSource()
    expect(src).toContain('onRegisteredSW')
    expect(src).toContain('registration.update()')
    expect(src).toContain('visibilitychange')
    expect(src).toContain('SW_CHECK_EVERY_MS')
  })
})
