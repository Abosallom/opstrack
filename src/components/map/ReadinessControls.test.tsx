// The three things before ADT, and the one mistake this component exists to
// avoid making 140 times.
//
// WHY renderToStaticMarkup AND NOT A DOM: the reason every sibling test gives —
// `vitest.config.ts` is `environment: 'node'`, there is no jsdom, so react-dom's
// server renderer runs the real component and the real translator. Effects do
// not run, which is why nothing below claims a behaviour that needs one.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

import { t } from '../../lib/i18n'
import type { NodeReadiness } from '../../types'

const fx = vi.hoisted(() => ({ row: undefined as NodeReadiness | undefined }))

vi.mock('../../store/config', () => ({
  useNodeReadiness: () => fx.row,
  invalidateConfig: () => {},
}))
vi.mock('../../api/map', () => ({ setReadiness: () => Promise.resolve({ ok: true, data: null }) }))
vi.mock('../toast', () => ({ toast: () => {} }))

const { default: ReadinessControls } = await import('./ReadinessControls')

const render = (): string => renderToStaticMarkup(<ReadinessControls nodeId="org-1" />)

/** React's own escaping, so a locale string can be matched in markup. */
const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

beforeEach(() => {
  fx.row = undefined
})

describe('when nobody has said anything', () => {
  it('says the boxes are unanswered rather than answered no', () => {
    // ⚠ THE WHOLE POINT. The table is empty, so this is the state all 140
    //   organizations are in. Two unticked boxes with no sentence read as "we
    //   checked and this hospital has neither" — a claim nobody has made about
    //   any of them.
    expect(render()).toContain(esc(t('mapnode.readinessNone')))
  })

  it('still draws the controls, so the first answer is one click away', () => {
    const html = render()
    expect(html).toContain('type="checkbox"')
    expect(html).toContain(esc(t('mapnode.patientRegistry')))
    expect(html).toContain(esc(t('mapnode.providerPortal')))
    expect(html).toContain(esc(t('mapnode.sso')))
  })

  it('offers the three SSO states the owner named, and no fourth', () => {
    const html = render()
    const options = [...html.matchAll(/<option value="([a-z_]+)"/g)].map((m) => m[1])
    expect(options).toEqual(['not_started', 'uat', 'prd'])
  })
})

describe('once somebody has answered', () => {
  it('drops the unanswered note, because it is no longer true', () => {
    fx.row = {
      node_id: 'org-1',
      patient_registry: true,
      provider_portal: false,
      sso: 'uat',
      updated_at: '2026-08-26T00:00:00Z',
      updated_by: 'member-1',
    }
    const html = render()
    expect(html).not.toContain(esc(t('mapnode.readinessNone')))
  })

  it('shows what was recorded, ticked and unticked alike', () => {
    fx.row = {
      node_id: 'org-1',
      patient_registry: true,
      provider_portal: false,
      sso: 'prd',
      updated_at: '2026-08-26T00:00:00Z',
      updated_by: 'member-1',
    }
    const html = render()
    // One box checked, one not — a recorded "no" is a real answer and must not
    // look the same as the unanswered state above.
    expect(html.match(/checked=""/g) ?? []).toHaveLength(1)
    expect(html).toContain('selected=""')
  })
})
