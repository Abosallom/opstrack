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
// Only the store is exercised; <Toaster /> is a component and vitest runs in
// `node`. The store's one environmental dependency is window.setTimeout, shimmed
// in vi.hoisted because the module schedules on import of its first call — the
// same pattern pages/Capture.test.tsx uses for localStorage.

import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.hoisted(() => {
  const g = globalThis as { window?: unknown }
  g.window ??= {
    setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms),
    clearTimeout: (h: number) => {
      clearTimeout(h)
    },
  }
})

import { dismissToast, getToasts, toast } from './toast'

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
