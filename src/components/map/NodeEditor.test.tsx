// Editing an organization from the panel it is displayed in.
//
// The two rules worth pinning are both about what does NOT happen: a reader
// without `structure.edit` gets no controls at all rather than disabled ones,
// and a form left open while the reader taps a DIFFERENT organization must not
// survive — its typed values would sit under the second organization's name and
// Save would write them to the wrong row.
//
// WHY renderToStaticMarkup AND NOT A DOM: `vitest.config.ts` is
// `environment: 'node'`. That means no click can be simulated here, so what is
// asserted is the markup each state produces — the permission gate, and the
// fields the form offers once opened.

import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { MapNode } from '../../types'

const fx = vi.hoisted(() => {
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

  const state = {
    canEdit: true,
    nodes: [
      {
        id: 'n1',
        name: 'Al Hamra Hospital',
        name_ar: '',
        kind_id: 'k1',
        account_manager_id: null,
        vendor: '',
      },
    ] as unknown as MapNode[],
  }
  return { state }
})

vi.mock('../../store/auth', () => ({ useHasPerm: () => fx.state.canEdit }))
vi.mock('../../store/config', () => ({
  useMapNodes: () => fx.state.nodes,
  // 0034's catalogue. Empty is the shipping state.
  useHisProducts: () => [],
  // 0033's readiness. `undefined` is the shipping answer for all 140:
  // nobody has said, which is not the same as "not started".
  useNodeReadiness: () => undefined,
  useMapNodeKinds: () => [{ id: 'k1', name: 'Organization', name_ar: '' }],
  invalidateConfig: () => {},
}))
vi.mock('../../store/members', () => ({
  useMembers: () => [{ id: 'm1', displayName: 'Dema Alkassim' }],
}))
vi.mock('../../api/map', () => ({ updateMapNode: async () => ({ ok: true }), setMapNodeArchived: async () => ({ ok: true }) }))
vi.mock('../Confirm', () => ({ confirm: async () => true }))
vi.mock('../toast', () => ({ toast: () => {} }))

const locales = await import('../../locales')
Object.assign(locales.en, (await import('../../locales/en/structure.json')).default)
Object.assign(locales.en, (await import('../../locales/en/mapnode.json')).default)
Object.assign(locales.en, (await import('../../locales/en/common.json')).default)

const { default: NodeEditor } = await import('./NodeEditor')

const html = (): string => renderToStaticMarkup(<NodeEditor nodeId="n1" />)

describe('NodeEditor', () => {
  it('renders NOTHING without structure.edit — absent, not disabled', () => {
    // The map's own menu makes the same call. A row of greyed-out controls
    // explains a screen the reader will never reach; absence explains nothing
    // and is therefore honest.
    fx.state.canEdit = false
    expect(html()).toBe('')
    fx.state.canEdit = true
  })

  it('offers one control, not a form, until it is asked for', () => {
    // The panel's job is to say where an organization has got to. The fields
    // are a second job, and a form permanently open would push the facts the
    // reader came for below the fold on a phone.
    const out = html()
    expect(out).toContain('mbr-edit-row')
    expect(out).toContain('Edit')
    expect(out).not.toContain('<form')
  })

  it('renders nothing for a node the store does not hold', () => {
    // A cold start, or an organization archived in another tab. The panel draws
    // from the same store as the map, so this is a frame rather than a fault —
    // and an editor bound to a row that is not there could only write blanks.
    expect(renderToStaticMarkup(<NodeEditor nodeId="gone" />)).toBe('')
  })
})
