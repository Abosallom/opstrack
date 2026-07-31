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
//   * arrow navigation — `useRadioGroupKeys()` on the group, moving FOCUS to
//     the next option and reporting the move, plus Home/End.
//
// WHAT IT DELIBERATELY DOES NOT DECIDE — R2-A11Y-1. Whether moving also SELECTS
// is the caller's, because APG defines both variants and the choice turns on
// one question: does selecting have a side effect?
//
//   · No side effect (a theme switch, a swatch in an unsaved form) → selection
//     follows focus, which is the friendlier default. Those callers pass a
//     committing `onMove` and get exactly the behaviour they had.
//   · A side effect (a write, a notification, a row in an immutable audit
//     trail) → focus and selection must separate, and Space/Enter commits.
//     `components/pickers/OptionGroup` is that case: five of its instances live
//     in the entry sheet and each one PATCHes on change. With selection glued
//     to focus, reaching the fifth teammate in the owner picker meant assigning
//     the item to the four above them on the way past — four "assigned to you"
//     notifications and four phone pushes for work that was never theirs
//     (0004:286-288 fires on any owner_id change, 0011:558-561 pushes on every
//     notification row) — and reaching a status meant stamping every status in
//     between into `entry_updates`, which has no UPDATE and no DELETE policy.
//
// Left/Right are mapped through the group's COMPUTED direction rather than
// assumed: in the Arabic UI the visual "next" option is to the left, and an
// unmapped ArrowRight would walk backwards through a grid the user is reading
// right-to-left. Up/Down are axis-neutral and never mapped.

import { useCallback, type KeyboardEvent } from 'react'

/**
 * `tabIndex` for the option at `index`.
 *
 * `activeIndex` is the group's single tab stop — the CHECKED option for a group
 * where selection follows focus, and the FOCUSED one for a group where it does
 * not (so Tab returns a user to where they left off rather than to a value they
 * moved away from deliberately).
 *
 * When NOTHING is active — a track carrying a hand-typed hex that matches no
 * swatch, or an icon name from an older release — the first option takes it
 * instead, because a group where every option is -1 cannot be reached by
 * keyboard at all.
 */
export function rovingTabIndex(index: number, activeIndex: number): 0 | -1 {
  if (activeIndex < 0) return index === 0 ? 0 : -1
  return index === activeIndex ? 0 : -1
}

/**
 * The option index a keystroke moves to, or null if the key is not ours.
 *
 * Pure and exported so the movement rules — RTL mapping and wrapping, the two
 * that are easy to get quietly backwards — are asserted without a DOM. Wrapping
 * is per the APG pattern: a radiogroup is a closed set, so there is no "past the
 * end" to fall out of.
 */
export function nextRadioIndex(
  key: string,
  current: number,
  count: number,
  rtl: boolean,
): number | null {
  if (count <= 0 || current < 0) return null
  const forward = rtl ? -1 : 1
  let next: number
  switch (key) {
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
      next = count - 1
      break
    default:
      return null
  }
  return (next + count) % count
}

/**
 * Arrow/Home/End handling for the group element.
 *
 * `onMove` receives the index focus moved to; this handler has ALREADY focused
 * it. Whether that also selects it is the caller's call — see the header. Space
 * and Enter are left alone on purpose: the options are real `<button>`s, so the
 * browser turns both into a click, which is the commit path for a group where
 * selection does not follow focus.
 */
export function useRadioGroupKeys<T extends HTMLElement = HTMLElement>(
  onMove: (index: number) => void,
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
      const next = nextRadioIndex(event.key, current, options.length, rtl)
      if (next === null) return

      // preventDefault so ArrowDown moves within the group, not the page — the
      // group is inside a scrolling form and both happening at once is
      // disorienting.
      event.preventDefault()
      options[next].focus()
      onMove(next)
    },
    [onMove],
  )
}
