// The picker group: what it renders, and — R2-A11Y-1 — what an arrow key does
// NOT do.
//
// WHY renderToStaticMarkup AND NOT A DOM. vitest.config.ts is `environment:
// 'node'` and there is no jsdom in the dependency budget; atoms.test.tsx and
// FollowUps.test.tsx open with the same paragraph. That rules out pressing a
// key — so the keyboard claim is asserted at the seam instead: the callback
// this component hands to `useRadioGroupKeys` is captured through a module mock
// and invoked directly, which is exactly what an arrow key does to it.
//
// That seam is the whole fix. Before it, the callback WAS `select`, so calling
// it here would call `onChange` — and in the entry sheet `onChange` is a PATCH,
// a notification and a push. The assertion below fails on that code and passes
// on this.

import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

const captured = vi.hoisted(() => ({ onMove: null as ((index: number) => void) | null }))

vi.mock('../../lib/radioGroup', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/radioGroup')>()
  return {
    ...actual,
    // A pass-through that records. The real hook still runs, so the component
    // under test is the real one wired to the real handler.
    useRadioGroupKeys: (onMove: (index: number) => void) => {
      captured.onMove = onMove
      return actual.useRadioGroupKeys(onMove)
    },
  }
})

const { OptionGroup } = await import('./OptionGroup')

const OPTIONS = [
  { key: 'u1', label: 'Aziz' },
  { key: 'u2', label: 'Layla' },
  { key: 'u3', label: 'Omar' },
  { key: 'u4', label: 'Sara' },
]

describe('OptionGroup — an arrow key moves focus and writes nothing', () => {
  it('hands useRadioGroupKeys a callback that does not change the value', () => {
    const onChange = vi.fn()
    renderToStaticMarkup(
      <OptionGroup label="Owner" options={OPTIONS} value="u1" onChange={onChange} />,
    )
    expect(captured.onMove).toBeTypeOf('function')

    // Four ArrowDowns to reach the fourth teammate. Under the old code this was
    // four assignments, four "assigned to you" notifications (0004:286-288) and
    // four phone pushes (0011:558-561) for work that was never theirs.
    try {
      for (const index of [1, 2, 3]) captured.onMove?.(index)
    } catch {
      // The captured callback is a setState from a server render, which React
      // may refuse outside its render pass. Irrelevant to the claim: `select`
      // called onChange BEFORE it could touch any state, so the assertion below
      // is what separates the two implementations.
    }
    expect(onChange).not.toHaveBeenCalled()
  })

  it('keeps the whole group to one tab stop', () => {
    const html = renderToStaticMarkup(
      <OptionGroup label="Owner" options={OPTIONS} value="u2" onChange={() => {}} />,
    )
    expect((html.match(/tabindex="0"/g) ?? []).length).toBe(1)
    expect((html.match(/tabindex="-1"/g) ?? []).length).toBe(3)
  })

  it('parks that tab stop on the checked option before anything is focused', () => {
    const html = renderToStaticMarkup(
      <OptionGroup label="Owner" options={OPTIONS} value="u3" onChange={() => {}} />,
    )
    // The checked option carries both, and it is the third.
    expect(html).toContain('aria-checked="true" tabindex="0"')
    expect(html.indexOf('aria-checked="true"')).toBe(html.lastIndexOf('aria-checked="true"'))
    expect(html).toContain('Omar')
  })

  it('still reaches the keyboard when the held value matches no option', () => {
    // A member who has left, or a vocab option an admin deleted. With no
    // fallback every option is -1 and the group cannot be entered at all.
    const html = renderToStaticMarkup(
      <OptionGroup label="Owner" options={OPTIONS} value="ghost" onChange={() => {}} />,
    )
    expect((html.match(/tabindex="0"/g) ?? []).length).toBe(1)
    expect(html).not.toContain('aria-checked="true"')
  })

  it('takes the radiogroup role and gives every option the radio role', () => {
    // The role is the promise the arrow handling exists to keep; asserting it
    // here keeps the two from drifting apart.
    const html = renderToStaticMarkup(
      <OptionGroup label="Owner" options={OPTIONS} value="u1" onChange={() => {}} />,
    )
    expect(html).toContain('role="radiogroup"')
    expect(html).toContain('aria-label="Owner"')
    expect((html.match(/role="radio"/g) ?? []).length).toBe(4)
    // Real buttons, because Space and Enter on a <button> ARE the commit path
    // now that arrows no longer commit.
    expect((html.match(/type="button"/g) ?? []).length).toBe(4)
  })

  it('prepends the clear option and counts it as an option', () => {
    const html = renderToStaticMarkup(
      <OptionGroup
        label="Owner"
        options={OPTIONS}
        value={null}
        clearLabel="Nobody"
        onChange={() => {}}
      />,
    )
    expect((html.match(/role="radio"/g) ?? []).length).toBe(5)
    expect(html).toContain('Nobody')
    // null selects the clear sentinel, so the tab stop starts there.
    expect(html.indexOf('tabindex="0"')).toBeLessThan(html.indexOf('Aziz'))
  })

  it('marks a read-only group aria-disabled and leaves it focusable', () => {
    // The VALUE is what a read-only reader came for; the `disabled` attribute
    // would take the whole group out of the tab order.
    const html = renderToStaticMarkup(
      <OptionGroup label="Owner" options={OPTIONS} value="u1" disabled onChange={() => {}} />,
    )
    expect(html).toContain('aria-disabled="true"')
    expect(html).toContain('tabindex="0"')
    expect(html).not.toContain('disabled=""')
  })
})
