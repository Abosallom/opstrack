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
  it('opens on the MAP for a reader who has never chosen, on a wide screen', () => {
    // ⚠ THIS ASSERTED THE OPPOSITE FOR TWO DAYS AND THE OPPOSITE WAS A
    //   MISREADING. "Make it easier" was about a first paint of 161
    //   organizations fitted to 0.44 — a 12.5px label rendered at 5.5px — and it
    //   was answered by deleting the width from `stageForReader` altogether, so
    //   the desktop opened on the ledger and the drawing the owner wanted fixed
    //   was one press away everywhere. The owner has since asked for the map
    //   back; the legibility half is `openDepthFor`'s (useMapModel.ts), which
    //   now opens one rung shallower.
    //
    //   The width IS a parameter again, and this pair of assertions is the
    //   guard: a build that drops it can satisfy at most one of them.
    expect(stageForReader('shape', 'map', false, false)).toBe('map')
    expect(stageForReader('needs-me', 'map', false, false)).toBe('map')
    expect(stageForReader('what-changed', 'map', false, false)).toBe('map')
  })

  it('opens on the LEDGER for that same reader on a phone', () => {
    // 161 cards across 375px is roughly fourteen CSS pixels each, and no
    // open-depth rescues that: the specks ARE the leaves. The ledger is the same
    // tree as a scrollable list and it was never what the owner complained
    // about, so this half of the old rule is kept exactly as it was.
    expect(stageForReader('shape', 'map', false, true)).toBe('table')
    expect(stageForReader('needs-me', 'map', false, true)).toBe('table')
    expect(stageForReader('what-changed', 'map', false, true)).toBe('table')
  })

  it('lets a pinned choice win — at BOTH widths, in both directions', () => {
    // The half that must never move: the moment the reader presses MapToolbar's
    // map⇄ledger switch, `setMindView` pins it and THEIR answer wins for good.
    // A default that quietly overrode an explicit press would be a worse defect
    // than either default — so the phone's ledger yields to a pinned `map` and
    // the desktop's map yields to a pinned `table`.
    expect(stageForReader('shape', 'map', true, true)).toBe('map')
    expect(stageForReader('needs-me', 'map', true, true)).toBe('map')
    expect(stageForReader('shape', 'table', true, false)).toBe('table')
    expect(stageForReader('shape', 'table', true, true)).toBe('table')
  })

  it('leaves every lens whose stage is not the open tree exactly where it was', () => {
    // `board`, `numbers` and `portfolio` are drawn by their lens, not by this
    // preference, so no reader of any pinning at any width can move them.
    // Asserted over the closed union so a seventh lens cannot arrive and quietly
    // become a ledger.
    for (const lens of MAP_LENSES) {
      const implied = stageForLens(lens)
      if (implied === 'map') continue
      for (const pinned of [true, false]) {
        for (const compact of [true, false]) {
          expect(stageForReader(lens, 'table', pinned, compact), lens).toBe(implied)
          expect(stageForReader(lens, 'map', pinned, compact), lens).toBe(implied)
        }
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
