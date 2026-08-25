// The two pure halves of the lens hook — the precedence between the picked leaf
// and the dived-into world, and the flag that says whether a panel is open.
//
// WHY THE PURE HALVES AND NOT THE HOOK. vitest.config.ts is `environment:
// 'node'`: there is no renderer to run a hook in, and `renderToStaticMarkup`'s
// single pass never sees a setter's effect. That is not a footnote here — it is
// the exact reason the phantom shipped. `panelOpen === true` with a `none`
// subject was a combination nothing ever rendered, every file looked locally
// correct, and the ladder test for Escape stubbed `closePanel` and so asserted
// the stub rather than the guard.
//
// So the decision is EXPORTED as a function of plain values, and the function is
// what is checked. `panelSubjectFor` was already exported for this reason;
// `panelOpenFor` joins it.

import { describe, expect, it } from 'vitest'
import { panelOpenFor, panelSubjectFor, stageForReader } from './useMapLens'
import { MAP_LENSES, stageForLens, subjectForLens, type MapLens } from '../../lib/mindtree/lens'

const BRANCH = 'root/track:t1/entity:org-1'

describe('panelSubjectFor', () => {
  it('lets the picked leaf outrank the world the camera is inside', () => {
    // Picking an Organization moves nothing on the canvas, so the drill-in
    // cannot answer for it.
    expect(panelSubjectFor('shape', BRANCH, 'root/track:t1')).toEqual({
      kind: 'branch',
      nodeId: BRANCH,
    })
  })

  it('falls back to the drill-in when nothing is picked', () => {
    expect(panelSubjectFor('shape', null, 'root/track:t1')).toEqual({
      kind: 'branch',
      nodeId: 'root/track:t1',
    })
  })

  it('answers `none` for the workspace nobody has dived into', () => {
    // THE STATE THE PHANTOM LIVED IN. A map with no drill-in and no pick is the
    // opening state of every fresh workspace.
    expect(panelSubjectFor('shape', null, null)).toEqual({ kind: 'none' })
  })
})

describe('stageForReader', () => {
  it('opens on the LEDGER for a reader who has never chosen — at every width', () => {
    // THE OWNER SAID IT TWICE: the picture is in the way and the list is the
    // readable one. The width used to be the tiebreak (`pinned ? … : compact`),
    // so the ledger was the opening on a 375px phone and the picture was the
    // opening on the desktop the owner actually works on. It is not any more,
    // and the WIDTH IS NOT A PARAMETER OF THIS FUNCTION — that absence is the
    // assertion. There is no argument left to pass that could bring the picture
    // back for somebody who never asked for it.
    expect(stageForReader('shape', 'map', false)).toBe('table')
    expect(stageForReader('needs-me', 'map', false)).toBe('table')
    expect(stageForReader('what-changed', 'map', false)).toBe('table')
  })

  it('lets a pinned choice win — including the picture, on a wide screen', () => {
    // The other half of the contract, and the half that must never move: the
    // moment the reader presses MapToolbar's map⇄ledger switch, `setMindView`
    // pins it and THEIR answer wins for good. A default that quietly overrode
    // an explicit press would be a worse defect than the one above.
    expect(stageForReader('shape', 'map', true)).toBe('map')
    expect(stageForReader('needs-me', 'map', true)).toBe('map')
    expect(stageForReader('shape', 'table', true)).toBe('table')
  })

  it('leaves every lens whose stage is not the open tree exactly where it was', () => {
    // `board`, `numbers` and `portfolio` are drawn by their lens, not by this
    // preference, so no reader of any pinning can move them. Asserted over the
    // closed union so a seventh lens cannot arrive and quietly become a ledger.
    for (const lens of MAP_LENSES) {
      const implied = stageForLens(lens)
      if (implied === 'map') continue
      for (const pinned of [true, false]) {
        expect(stageForReader(lens, 'table', pinned), lens).toBe(implied)
        expect(stageForReader(lens, 'map', pinned), lens).toBe(implied)
      }
    }
  })
})

describe('panelOpenFor', () => {
  it('is FALSE on the default workspace, where the stored preference says true', () => {
    // `DEFAULT_PREFS.panelOpen` is `true` and `shape` with no drill-in resolves
    // to `none`, so the raw flag claimed a panel on a screen showing none:
    // Escape was swallowed by it and the live region announced "The panel is
    // hidden" about a panel that was never showing.
    expect(panelOpenFor(true, panelSubjectFor('shape', null, null))).toBe(false)
  })

  it('is true exactly when the flag is set AND the subject can fill a panel', () => {
    expect(panelOpenFor(true, panelSubjectFor('shape', BRANCH, null))).toBe(true)
    expect(panelOpenFor(false, panelSubjectFor('shape', BRANCH, null))).toBe(false)
  })

  it('holds for every lens: no subject, no open panel', () => {
    const lenses: readonly MapLens[] = [
      'shape',
      'needs-me',
      'what-changed',
      'numbers',
      'by-status',
      'portfolio',
    ]
    for (const lens of lenses) {
      const subject = subjectForLens(lens, null)
      // The claim is the equivalence, in both directions and for the closed
      // union — so a seventh lens cannot arrive with a third answer.
      expect(panelOpenFor(true, subject), lens).toBe(subject.kind !== 'none')
    }
  })
})
