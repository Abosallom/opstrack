// R3-A11Y-2. The focus-restore rule for the confirmation sheet.
//
// WHAT WENT WRONG. ConfirmHost stored the element that raised the dialog and put
// focus back on it when the dialog closed, guarded by `if (el?.isConnected)`.
// The guard is correct and insufficient, and its own comment said why: on the
// destructive path — the path the component exists for — the confirmed delete
// unmounts the row the trigger button was in, so `isConnected` is false, the
// branch is skipped, and NOTHING is focused. `document.activeElement` is then
// `<body>`, because the dialog's own confirm button unmounted a moment earlier.
// Every delete in the app therefore cost the user a full re-tab from the top of
// the document, and announced nothing to a screen reader.
//
// So the rule under test is not "don't focus a detached node". It is "focus
// something", and the whole of the fix is having a second answer.
//
// WHY THE RULE IS A PURE FUNCTION. vitest.config.ts is `environment: 'node'` and
// jsdom is not in the dependency budget (OutboxSheet.test.tsx's header explains
// the standing decision). A React effect that reads document.activeElement is
// not reachable from here — but the DECISION it makes is the whole defect, and
// lifting it out of the effect makes it assertable without a DOM. What this file
// consequently cannot see, and claims nothing about: that the effect calls it,
// that `restoreDue` suppresses the mount-time run, and that `.focus()` on the
// returned element does what the browser says it does.
//
// The second block is the other half of the fix, and it is the half that rots
// silently: the fallback is looked up by id, so if App.tsx renames or drops
// `<main id="main" tabIndex={-1}>`, getElementById returns null, the fallback
// quietly does nothing, and the app is back on <body> with every test green.

import { describe, expect, it } from 'vitest'
import { focusRestoreTarget } from './Confirm'

/** A stand-in for the two fields the decision reads. */
const node = (isConnected: boolean, tagName = 'BUTTON'): { isConnected: boolean; tagName: string } =>
  ({ isConnected, tagName })

const MAIN = node(true, 'MAIN')

describe('focusRestoreTarget', () => {
  it('returns the trigger when the action left it standing', () => {
    // Archive, rename, discard-changes: the row is still there afterwards and
    // the user's place is exactly where they left it.
    const trigger = node(true)
    expect(focusRestoreTarget(trigger, MAIN)).toBe(trigger)
  })

  it('falls back when the confirmed action unmounted the trigger', () => {
    // THE REGRESSION. This is the delete path, and it is the common case rather
    // than the edge one. Before the fix this returned nothing and focus stayed
    // on <body>.
    const trigger = node(false)
    expect(focusRestoreTarget(trigger, MAIN)).toBe(MAIN)
  })

  it('falls back when the trigger was <body>, which is not a place', () => {
    // What a confirm() raised from a hotkey or from an API error path captures:
    // activeElement is <body> because nothing held focus. It is connected, so an
    // isConnected-only test would "restore" focus to it and change nothing.
    expect(focusRestoreTarget(node(true, 'BODY'), MAIN)).toBe(MAIN)
  })

  it('falls back when there was no trigger at all', () => {
    expect(focusRestoreTarget(null, MAIN)).toBe(MAIN)
  })

  it('never hands back a fallback that is itself detached', () => {
    // Mid-route-transition: the old <main> is gone. Better to leave focus alone
    // than to call focus() on a node the browser has already dropped.
    expect(focusRestoreTarget(node(false), node(false, 'MAIN'))).toBeNull()
  })

  it('returns null rather than throwing when neither is usable', () => {
    // The call site is `focusRestoreTarget(…)?.focus()`, so null is a supported
    // answer and must not be an exception.
    expect(focusRestoreTarget(null, null)).toBeNull()
  })
})

/* ───────────────────────── the fallback anchor ───────────────────────── */

// Read through import.meta.glob('?raw') rather than node:fs: tsconfig.app.json
// pins `types: ["vite/client"]`, and widening it to include "node" would leak
// node globals into the type space of every app file. localeReach.test.ts reads
// the source tree the same way, for the same reason.
const APP: Record<string, string> = import.meta.glob('../App.tsx', {
  query: '?raw',
  import: 'default',
  eager: true,
})

describe('the fallback anchor', () => {
  it('is an element App.tsx actually renders, and is focusable', () => {
    const source = Object.values(APP)[0]
    expect(source, 'App.tsx not found by the glob').toBeTypeOf('string')

    // Comments first: App.tsx's prose talks about `<main>` by name, and a
    // sentence about the element is not the element.
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
    const tags = [...code.matchAll(/<main\b[^>]*>/g)].map((m) => m[0])

    // The id Confirm.tsx looks the fallback up by.
    const tag = tags.find((t) => t.includes('id="main"'))
    expect(tag, `App.tsx renders no <main id="main">. Found: ${JSON.stringify(tags)}`).toBeDefined()
    // …and tabIndex -1, without which focus() on a <main> is a silent no-op and
    // the fix is exactly as broken as the bug it replaced.
    expect(tag).toContain('tabIndex={-1}')
  })
})
