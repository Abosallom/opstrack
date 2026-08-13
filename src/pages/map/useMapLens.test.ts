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
import { panelOpenFor, panelSubjectFor } from './useMapLens'
import { subjectForLens, type MapLens } from '../../lib/mindtree/lens'

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
