// Proof for the drill-in trail.
//
// WHY renderToStaticMarkup AND NOT A DOM. vitest.config.ts is `environment:
// 'node'` and jsdom is not in the dependency budget — MindtreeTable.test.tsx and
// every page test in this repo open with that paragraph. It costs nothing here:
// the breadcrumb has no effects, no timers and no measurement, so the server
// render IS the component.
//
// WHAT IS ACTUALLY BEING DEFENDED. Three promises, and each one is a bug that
// only shows up in a language or at a depth nobody was looking at:
//
//   1. THE ROOT IS ONE PRESS AWAY FROM ANY DEPTH. The whole point of a trail
//      over a "back" button, and the thing an ellipsis fold would quietly break.
//   2. THE LABELS ARE RESOLVED THE RIGHT WAY. A `key` label goes through t(); a
//      `text` label — a track name out of the database — must not, because t()
//      ECHOES an unknown key, so the bug renders as itself in English and as an
//      English dot path in Arabic.
//   3. THE CURRENT LOCATION IS NOT A LINK. A control that does nothing when
//      pressed is worse than a heading, and it would be the one crumb a keyboard
//      user tabs to for no reason.

import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { MindLabel, MindNode } from '../../lib/mindtree/model'

vi.hoisted(() => {
  // lib/i18n reads localStorage at module scope; the import below runs first.
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
})

const BreadcrumbModule = await import('./Breadcrumb')
const Breadcrumb = BreadcrumbModule.default
const { crumbTarget } = BreadcrumbModule

// Register the namespace, exactly as MindtreeTable.test.tsx does: `t()` resolves
// against the bundle OBJECTS at call time, so this is precisely what
// locales/index.ts's spread will do. Without it every key echoes and an
// assertion comparing two echoes passes whatever the component rendered.
const locales = await import('../../locales')
Object.assign(locales.en, (await import('../../locales/en/mindtree.json')).default)
Object.assign(locales.ar, (await import('../../locales/ar/mindtree.json')).default)

function node(id: string, label: MindLabel, kind: MindNode['kind'] = 'track'): MindNode {
  return {
    id,
    kind,
    label,
    count: 1,
    colourVars: {},
    health: { levels: { ok: 1, stale: 0, overdue: 0, critical: 0 }, slaBreached: false },
    children: [],
    collapsed: false,
    depth: 0,
    entryId: null,
    bucketKey: null,
    retired: false,
  }
}

const ROOT = node('root', { kind: 'key', key: 'app.name' }, 'root')
const TRACK = node('root/track:t-net', { kind: 'text', text: 'Network' })
const GROUP = node('root/track:t-net/group:blocked', { kind: 'text', text: 'Blocked' }, 'group')

describe('Breadcrumb', () => {
  it('draws nothing for the unfocused map', () => {
    // `resolveFocus` returns exactly `[root]` when nothing is focused. A bar
    // whose only entry is the place you already are says nothing and costs a
    // row of the screen the map could be using.
    expect(renderToStaticMarkup(<Breadcrumb trail={[ROOT]} onFocus={() => {}} />)).toBe('')
    expect(renderToStaticMarkup(<Breadcrumb trail={[]} onFocus={() => {}} />)).toBe('')
  })

  it('links every hop except the last, and the last says where you are', () => {
    const html = renderToStaticMarkup(
      <Breadcrumb trail={[ROOT, TRACK, GROUP]} onFocus={() => {}} />,
    )
    // Two links for a three-deep trail: the root and the track.
    expect(html.match(/<button/g)).toHaveLength(2)
    expect(html).toContain('aria-current="location"')
    // The current location is NOT inside a button.
    expect(html).toMatch(/<span class="mtree-crumbbar-here" aria-current="location">[^<]*Blocked/)
  })

  it('keeps the ROOT as the first crumb at every depth — one press, always', () => {
    const deep = [ROOT, TRACK, GROUP, node('root/track:t-net/group:blocked/more', { kind: 'key', key: 'mindtree.more', vars: { count: 3 } }, 'more')]
    for (const trail of [[ROOT, TRACK], [ROOT, TRACK, GROUP], deep]) {
      const html = renderToStaticMarkup(<Breadcrumb trail={trail} onFocus={() => {}} />)
      const firstButton = html.slice(html.indexOf('<button'))
      expect(firstButton).toContain('All tracks')
    }
  })

  it('clears the focus rather than focusing the root node by id', () => {
    // lib/mindtree/focus.ts's URL codec writes "no focus" and "focus=root" the
    // same way (no param at all), so passing the root's id would make one state
    // reachable by two encodings — and a reader who pressed the first crumb
    // would get a URL that did not match the one they arrived on.
    expect(crumbTarget(0, ROOT)).toBeNull()
    expect(crumbTarget(1, TRACK)).toBe('root/track:t-net')
    expect(crumbTarget(2, GROUP)).toBe('root/track:t-net/group:blocked')
  })

  it('resolves a key label through t() and a text label verbatim', () => {
    const html = renderToStaticMarkup(
      <Breadcrumb
        trail={[ROOT, TRACK, node('root/track:t-net/group:x', { kind: 'key', key: 'entry.unassigned' }, 'group')]}
        onFocus={() => {}}
      />,
    )
    expect(html).toContain('Unassigned')
    // A database label must never reach t(): t() echoes an unknown key, so the
    // failure renders as the track name itself and hides.
    expect(html).toContain('Network')
    expect(html).not.toContain('entry.unassigned')
  })

  it('isolates database text so a mixed-script trail cannot reorder', () => {
    const html = renderToStaticMarkup(
      <Breadcrumb trail={[ROOT, node('root/track:t-ar', { kind: 'text', text: 'شبكة' })]} onFocus={() => {}} />,
    )
    // FSI … PDI around the value, per lib/bidi.isolate.
    expect(html).toContain('⁨شبكة⁩')
  })

  it('names the trail and marks the chevrons as directional', () => {
    const html = renderToStaticMarkup(<Breadcrumb trail={[ROOT, TRACK]} onFocus={() => {}} />)
    expect(html).toContain('aria-label="Where you are in the map"')
    // The class global.css mirrors in RTL. A literal `›` — which is what the
    // page's first hand-rolled trail used — is not an icon and does not mirror,
    // so an Arabic reader got arrows pointing back the way they came.
    expect(html).toContain('icon-directional')
    // One separator per LINK crumb: it sits between a crumb and the next one.
    expect(html.match(/icon-directional/g)).toHaveLength(1)
  })

  it('carries the visible label inside the accessible name (SC 2.5.3)', () => {
    const html = renderToStaticMarkup(
      <Breadcrumb trail={[ROOT, TRACK, GROUP]} onFocus={() => {}} />,
    )
    expect(html).toContain('aria-label="Back to ⁨Network⁩"')
    // The root crumb takes none: "All tracks" is already the whole sentence, and
    // a name that merely repeated it would be noise on every depth.
    expect(html).not.toContain('aria-label="Back to All tracks"')
  })

  it('falls back to a readable label rather than an empty crumb', () => {
    const html = renderToStaticMarkup(
      <Breadcrumb trail={[ROOT, node('root/track:blank', { kind: 'text', text: '   ' })]} onFocus={() => {}} />,
    )
    expect(html).toContain('Untitled')
  })
})
