// Keyboard behaviour for a `role="radiogroup"` built out of buttons.
//
// Declaring role="radio" is a PROMISE about the keyboard: a screen reader hears
// "radio button, 3 of 12", switches to forms mode, and forwards the arrow keys
// to the page expecting them to move the selection. It also stops announcing
// each option as an independent tab stop. A group that takes the role and
// implements neither is worse than plain buttons — the icon grid in the track
// editor is twelve tab stops in the middle of a form, and the keys the role
// advertised do nothing.
//
// So this module supplies the two halves of the APG radiogroup pattern that
// cannot be expressed in markup:
//
//   * roving tabindex — `rovingTabIndex()` per option, so the whole group is
//     ONE tab stop and Tab moves past it rather than through it;
//   * arrow navigation — `useRadioGroupKeys()` on the group, moving focus and
//     selection together (they are the same thing for radios), plus Home/End.
//
// Left/Right are mapped through the group's COMPUTED direction rather than
// assumed: in the Arabic UI the visual "next" option is to the left, and an
// unmapped ArrowRight would walk backwards through a grid the user is reading
// right-to-left. Up/Down are axis-neutral and never mapped.

import { useCallback, type KeyboardEvent } from 'react'

/**
 * `tabIndex` for the option at `index`.
 *
 * The checked option is the group's single tab stop. When NOTHING is checked —
 * a track carrying a hand-typed hex that matches no swatch, or an icon name
 * from an older release — the first option takes it instead, because a group
 * where every option is -1 cannot be reached by keyboard at all.
 */
export function rovingTabIndex(index: number, checkedIndex: number): 0 | -1 {
  if (checkedIndex < 0) return index === 0 ? 0 : -1
  return index === checkedIndex ? 0 : -1
}

/**
 * Arrow/Home/End handling for the group element.
 *
 * `onSelect` receives the index to move to; the caller both selects it and (as
 * a radiogroup must) lets focus follow, which this handler does for it.
 */
export function useRadioGroupKeys<T extends HTMLElement = HTMLElement>(
  onSelect: (index: number) => void,
): (event: KeyboardEvent<T>) => void {
  return useCallback(
    (event: KeyboardEvent<T>) => {
      const group = event.currentTarget
      const options = Array.from(group.querySelectorAll<HTMLElement>('[role="radio"]'))
      if (options.length === 0) return
      const current = options.indexOf(document.activeElement as HTMLElement)
      // Focus is somewhere else entirely (the group itself, or a click landed
      // on padding). Leave the keys to the page.
      if (current < 0) return

      // Computed, not the `dir` attribute: direction is set once on <html> and
      // inherited, so no ancestor of this group carries the attribute.
      const rtl = window.getComputedStyle(group).direction === 'rtl'
      const forward = rtl ? -1 : 1
      let next: number
      switch (event.key) {
        case 'ArrowDown':
          next = current + 1
          break
        case 'ArrowUp':
          next = current - 1
          break
        case 'ArrowRight':
          next = current + forward
          break
        case 'ArrowLeft':
          next = current - forward
          break
        case 'Home':
          next = 0
          break
        case 'End':
          next = options.length - 1
          break
        default:
          return
      }

      // preventDefault so ArrowDown scrolls the selection, not the page — the
      // group is inside a scrolling form and both happening at once is
      // disorienting.
      event.preventDefault()
      // Wrapping, per the APG pattern: a radiogroup is a closed set, so there
      // is no "past the end" to fall out of.
      next = (next + options.length) % options.length
      options[next].focus()
      onSelect(next)
    },
    [onSelect],
  )
}
