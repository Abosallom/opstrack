// The Escape arbiter, under the two orderings that were broken.
//
// WHY A FAKE `document`. vitest.config.ts is `environment: 'node'` and the repo
// has no jsdom — deliberately. This module needs exactly one DOM affordance,
// `addEventListener('keydown', …)`, so the test supplies that one and drives the
// handler directly. What is being asserted is arbitration order, not event
// propagation: the propagation half is a property of where the listener is bound
// (bubble phase, on document), which no test in a fake DOM could prove anyway
// and which the module's header states as the reasoning it is built on.
//
// A dynamic import, because the shim has to exist before module init reads
// `typeof document`.

import { beforeAll, beforeEach, describe, expect, it } from 'vitest'

type Handler = (event: KeyboardEvent) => void

let stack: typeof import('./overlayStack')
const handlers: Handler[] = []

/** A keydown, minimal but honest about preventDefault/defaultPrevented. */
function press(key: string, alreadyHandled = false): { defaultPrevented: boolean } {
  const event = {
    key,
    defaultPrevented: alreadyHandled,
    preventDefault(): void {
      event.defaultPrevented = true
    },
  }
  for (const handler of handlers) handler(event as unknown as KeyboardEvent)
  return event
}

beforeAll(async () => {
  ;(globalThis as { document?: unknown }).document = {
    addEventListener: (_type: string, fn: Handler): void => void handlers.push(fn),
    removeEventListener: (): void => {},
  }
  stack = await import('./overlayStack')
})

// Every test drains the stack it built: the module is a singleton by design and
// a leaked overlay would swallow the next test's keypress.
beforeEach(() => {
  expect(stack.overlayDepth()).toBe(0)
})

describe('pushOverlay — one Escape dismisses one layer', () => {
  it('dismisses the only open overlay and marks the event handled', () => {
    const seen: string[] = []
    const off = stack.pushOverlay(() => seen.push('sheet'))

    const event = press('Escape')

    expect(seen).toEqual(['sheet'])
    expect(event.defaultPrevented).toBe(true)
    off()
  })

  it('dismisses ONLY the top layer — a Confirm over a Sheet closes the confirm', () => {
    // The exact bug: both bound their own capture-phase listener, both fired,
    // and one keypress cancelled the confirm AND closed the sheet behind it.
    const seen: string[] = []
    const offSheet = stack.pushOverlay(() => seen.push('sheet'))
    const offConfirm = stack.pushOverlay(() => seen.push('confirm'))

    press('Escape')
    expect(seen).toEqual(['confirm'])

    // The confirm is now closed; the next Escape reaches the sheet under it.
    offConfirm()
    press('Escape')
    expect(seen).toEqual(['confirm', 'sheet'])

    offSheet()
  })

  it('does nothing when a control inside already handled the key', () => {
    // THE BLOCKER. InlineText's Escape-cancels-the-edit calls preventDefault()
    // during React's bubble dispatch, which runs before this listener because
    // React binds below document. An overlay that ignored that flag destroyed
    // every in-progress title, description and requester edit.
    const seen: string[] = []
    const off = stack.pushOverlay(() => seen.push('sheet'))

    press('Escape', true)

    expect(seen).toEqual([])
    off()
  })

  it('ignores every other key', () => {
    const seen: string[] = []
    const off = stack.pushOverlay(() => seen.push('sheet'))

    const event = press('Enter')

    expect(seen).toEqual([])
    expect(event.defaultPrevented).toBe(false)
    off()
  })

  it('is inert with nothing open, and does not claim the key', () => {
    const event = press('Escape')
    expect(event.defaultPrevented).toBe(false)
  })

  it('removes the right layer when overlays close out of order', () => {
    const seen: string[] = []
    const offA = stack.pushOverlay(() => seen.push('a'))
    const offB = stack.pushOverlay(() => seen.push('b'))
    const offC = stack.pushOverlay(() => seen.push('c'))

    // The middle one goes away on its own — a picker whose parent re-rendered.
    offB()
    press('Escape')
    expect(seen).toEqual(['c'])

    offC()
    press('Escape')
    expect(seen).toEqual(['c', 'a'])

    offA()
    expect(stack.overlayDepth()).toBe(0)
  })

  it('tolerates a double removal', () => {
    const off = stack.pushOverlay(() => {})
    off()
    off()
    expect(stack.overlayDepth()).toBe(0)
  })
})
