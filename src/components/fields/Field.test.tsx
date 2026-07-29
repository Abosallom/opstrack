// One assertion, made three times: the id in `aria-describedby` names an
// element that exists.
//
// It shipped broken. `Field` minted its own useId() for the hint/error
// paragraph while every caller minted a separate `${id}-msg` for the control,
// and two useId() calls never collide — so the reference dangled on every text
// field, textarea and date field in the app. The consequence is worst on error:
// `aria-invalid="true"` announced with no reason attached, which is the exact
// failure TextField.tsx's own header says the wrapper exists to prevent.
//
// renderToStaticMarkup for the same reason atoms.test.tsx uses it: vitest runs
// on `node` and the repo has no jsdom. What is being checked is the emitted
// markup, which is all an assistive technology sees anyway.

import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ReactElement } from 'react'

vi.hoisted(() => {
  // lib/i18n reads the stored locale at module scope, and DateField pulls it in
  // for its quick-set chips.
  const mem = new Map<string, string>()
  ;(globalThis as { localStorage?: Storage }).localStorage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => void mem.set(k, v),
    removeItem: (k: string) => void mem.delete(k),
    clear: () => mem.clear(),
    key: () => null,
    get length() {
      return mem.size
    },
  } as Storage
})

const { TextField, TextAreaField } = await import('./TextField')
const { DateField } = await import('./DateField')

const html = (node: ReactElement): string => renderToStaticMarkup(node)

/** The id the control points at, and the id the message actually carries. */
function wiring(markup: string): { describedBy: string | null; messageId: string | null } {
  return {
    describedBy: /aria-describedby="([^"]+)"/.exec(markup)?.[1] ?? null,
    messageId: /<p class="(?:fld-hint|field-error)" id="([^"]+)"/.exec(markup)?.[1] ?? null,
  }
}

describe('Field — the hint/error is reachable from the control it describes', () => {
  it('wires a TextField hint', () => {
    const { describedBy, messageId } = wiring(
      html(<TextField label="Title" value="" onChange={() => {}} hint="Keep it short" />),
    )
    expect(messageId).not.toBeNull()
    expect(describedBy).toBe(messageId)
  })

  it('wires a TextAreaField error, alongside aria-invalid', () => {
    const markup = html(
      <TextAreaField label="Notes" value="" onChange={() => {}} error="Required" />,
    )
    const { describedBy, messageId } = wiring(markup)
    expect(markup).toContain('aria-invalid="true"')
    expect(markup).toContain('role="alert"')
    expect(describedBy).toBe(messageId)
  })

  it('wires a DateField hint', () => {
    const { describedBy, messageId } = wiring(
      html(<DateField label="Due" value={null} onChange={() => {}} hint="Optional" />),
    )
    expect(describedBy).toBe(messageId)
  })

  it('points at nothing when there is nothing to point at', () => {
    // A field with neither hint nor error renders no paragraph, and a dangling
    // reference to a message that was never emitted is its own bug.
    const markup = html(<TextField label="Title" value="" onChange={() => {}} />)
    expect(markup).not.toContain('aria-describedby')
  })
})
