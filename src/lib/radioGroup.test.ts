// The movement rules behind every radiogroup in the app.
//
// `nextRadioIndex` is exported for this file, and the extraction is not
// ceremony: the two rules it holds are the two that are easy to get quietly
// backwards, and neither is visible in a screenshot.
//
//   · RTL. Direction is set once on <html>, so the handler reads the group's
//     COMPUTED direction and maps Left/Right through it. Get the sign wrong and
//     the Arabic user's ArrowRight walks backwards through a row they are
//     reading right-to-left — which looks like nothing at all in an LTR review.
//   · Wrapping. A radiogroup is a closed set, so there is no "past the end" to
//     fall out of. The modulo has to survive a negative, which is the classic
//     JS trap: -1 % 6 is -1, not 5.
//
// Up/Down are axis-neutral in both languages and must NOT be mapped — the
// assertions below pin that too, because "map them all" is the tidy-looking
// change somebody eventually makes.

import { describe, expect, it } from 'vitest'
import { nextRadioIndex, rovingTabIndex } from './radioGroup'

describe('nextRadioIndex — ltr', () => {
  const at = (key: string, current: number): number | null =>
    nextRadioIndex(key, current, 6, false)

  it('steps forward on ArrowDown and ArrowRight', () => {
    expect(at('ArrowDown', 2)).toBe(3)
    expect(at('ArrowRight', 2)).toBe(3)
  })

  it('steps back on ArrowUp and ArrowLeft', () => {
    expect(at('ArrowUp', 2)).toBe(1)
    expect(at('ArrowLeft', 2)).toBe(1)
  })

  it('wraps at both ends, including past zero', () => {
    expect(at('ArrowDown', 5)).toBe(0)
    // -1 % 6 is -1 in JavaScript. This is the assertion that catches it.
    expect(at('ArrowUp', 0)).toBe(5)
    expect(at('ArrowLeft', 0)).toBe(5)
  })

  it('jumps to the ends on Home and End', () => {
    expect(at('Home', 3)).toBe(0)
    expect(at('End', 3)).toBe(5)
  })

  it('answers null for a key that is not ours', () => {
    // The handler leaves these to the page: Tab must still leave the group,
    // and Space/Enter must reach the <button> underneath, because a click is
    // how an OptionGroup commits.
    for (const key of ['Tab', ' ', 'Enter', 'Escape', 'a', 'PageDown']) {
      expect(nextRadioIndex(key, 2, 6, false)).toBeNull()
    }
  })
})

describe('nextRadioIndex — rtl', () => {
  const at = (key: string, current: number): number | null =>
    nextRadioIndex(key, current, 6, true)

  it('mirrors Left and Right, so the visual "next" is still next', () => {
    expect(at('ArrowLeft', 2)).toBe(3)
    expect(at('ArrowRight', 2)).toBe(1)
  })

  it('leaves Up and Down alone: the block axis does not mirror', () => {
    expect(at('ArrowDown', 2)).toBe(3)
    expect(at('ArrowUp', 2)).toBe(1)
  })

  it('keeps Home and End as first and last of the SET, not of the screen', () => {
    // Home is the first option in reading order either way; the group's own
    // layout puts it on the right under dir=rtl.
    expect(at('Home', 3)).toBe(0)
    expect(at('End', 3)).toBe(5)
  })
})

describe('nextRadioIndex — degenerate groups', () => {
  it('answers null when there is nothing to move through', () => {
    expect(nextRadioIndex('ArrowDown', 0, 0, false)).toBeNull()
  })

  it('answers null when focus is not on an option', () => {
    // -1 is querySelectorAll().indexOf(activeElement) missing — a click that
    // landed on the group's padding. The keys belong to the page then.
    expect(nextRadioIndex('ArrowDown', -1, 6, false)).toBeNull()
  })

  it('stays on the only option in a group of one', () => {
    expect(nextRadioIndex('ArrowDown', 0, 1, false)).toBe(0)
    expect(nextRadioIndex('ArrowUp', 0, 1, false)).toBe(0)
  })
})

describe('rovingTabIndex', () => {
  it('gives the tab stop to the active option and to nothing else', () => {
    expect(rovingTabIndex(2, 2)).toBe(0)
    expect(rovingTabIndex(0, 2)).toBe(-1)
    expect(rovingTabIndex(5, 2)).toBe(-1)
  })

  it('falls back to the first option when nothing is active', () => {
    // A track carrying a hand-typed hex that matches no swatch. Without this
    // the whole group is -1, which is a group the keyboard cannot enter.
    expect(rovingTabIndex(0, -1)).toBe(0)
    expect(rovingTabIndex(1, -1)).toBe(-1)
  })
})
