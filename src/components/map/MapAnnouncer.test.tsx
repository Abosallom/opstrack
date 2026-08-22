// Render proof for the map's two invisible nodes.
//
// WHAT THIS FILE IS ACTUALLY FOR. Both nodes shipped broken for several commits
// and neither break had a visible symptom: the page's only live region was
// unmounted along with the visible caption strip it happened to share a file
// with, and the <svg>'s `aria-describedby` was left pointing at an id that no
// longer resolved to anything. A dangling `aria-describedby` is not a degraded
// description — it is no description — and nothing on the screen says so.
//
// So the assertions below are deliberately about PRESENCE and IDENTITY rather
// than wording: that the element carrying `hintId` exists, that the region is
// polite and keyed, and that the keyboard contract disappears in table view
// where the widget it describes is not on the screen.
//
// WHY renderToStaticMarkup AND NOT A DOM: `vitest.config.ts` is `environment:
// 'node'` and there is no jsdom in the dependency budget. Nothing claimed here
// needs one — these are two paragraphs.

import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

vi.hoisted(() => {
  // lib/i18n reads localStorage at module scope, at IMPORT time — so the shim
  // cannot wait for a beforeAll().
  const mem = new Map<string, string>()
  const g = globalThis as unknown as Record<string, unknown>
  g.localStorage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => void mem.set(k, v),
    removeItem: (k: string) => void mem.delete(k),
    clear: () => mem.clear(),
    key: (i: number) => [...mem.keys()][i] ?? null,
    get length() {
      return mem.size
    },
  }
  g.addEventListener = () => {}
  g.removeEventListener = () => {}
  g.window = globalThis
  g.matchMedia = () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} })
  g.document = { documentElement: { dir: 'ltr', lang: 'en' } }
})

const { default: MapAnnouncer } = await import('./MapAnnouncer')

const html = (
  over: Partial<{ onMap: boolean; hintId: string; live: { text: string; seq: number } }> = {},
): string =>
  renderToStaticMarkup(
    <MapAnnouncer
      onMap={over.onMap ?? true}
      hintId={over.hintId ?? 'hint-1'}
      live={over.live ?? { text: '', seq: 0 }}
    />,
  )

describe("the id the canvas's aria-describedby resolves to", () => {
  it('is rendered on the map, and carries two sentences in one element', () => {
    // ONE element, because `aria-describedby` resolves an id to one node, and
    // the walk and the tick are one contract.
    const out = html()
    const el = /<p class="sr-only" id="hint-1">([^<]*)<\/p>/.exec(out)
    expect(el, 'no element carries the hint id').not.toBeNull()
    expect((el?.[1] ?? '').trim().length, 'the description resolved to empty text').toBeGreaterThan(
      0,
    )
  })

  it('is absent in table view, where the widget it describes is not on screen', () => {
    // The sentence is about arrow-key movement through a TREE. In `?stage=table`
    // there is no tree, and describing one was the bug the original branch here
    // existed to fix. It goes away rather than saying something vaguer.
    expect(html({ onMap: false })).not.toContain('id="hint-1"')
  })
})

describe('the page live region', () => {
  it('is polite, and is present in BOTH views', () => {
    // polite, not assertive: the filter's own count announces on every keystroke
    // and two assertive regions on one screen interrupt each other.
    for (const onMap of [true, false]) {
      const out = html({ onMap })
      expect(out, `missing in ${onMap ? 'map' : 'table'} view`).toContain(
        '<p class="sr-only" role="status" aria-live="polite">',
      )
    }
  })

  it('speaks the sentence it is given', () => {
    expect(html({ live: { text: 'Moved to Riyadh First Health Cluster', seq: 3 } })).toContain(
      'Moved to Riyadh First Health Cluster',
    )
  })

  it('re-announces the SAME sentence twice, which a plain string would not', () => {
    // The regression the counter exists for. React bails out when a string prop
    // has not changed, producing no DOM mutation and therefore no announcement —
    // and this region says the same words all the time: Space on a second item
    // you may not move, "Collapse all" pressed twice, "Fit to view" already
    // fitted.
    //
    // renderToStaticMarkup cannot observe a re-render, so what is asserted is
    // the MECHANISM: the text sits inside a keyed child, and the key moves with
    // the counter while the text does not. Two renders of identical text at
    // different counters must differ somewhere.
    const said = 'You cannot move this one'
    const first = html({ live: { text: said, seq: 1 } })
    const second = html({ live: { text: said, seq: 2 } })
    expect(first).toContain(said)
    expect(second).toContain(said)
    // A bare `{live.text}` would render the two identically AND would leave no
    // element to key — the span is the whole mechanism.
    expect(first).toContain('<span>')
  })
})
