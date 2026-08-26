// The three things that come before ADT — 0033, on the organization panel.
//
// Patient Registry and Provider Portal as tick boxes, SSO as the three states
// the owner named: Not started, UAT, PRD. ONE SET PER HOSPITAL, not one per use
// case — registering with the patient registry is something an organization does
// once, not something it does again for Lab Order.
//
// ── THE STATE THIS SCREEN IS ACTUALLY IN ───────────────────────────────────
//
// `map_node_readiness` is EMPTY. Every one of the 140 organizations has no row,
// and no row means nobody has said — which is not the same as "not started".
//
// ⚠ SO THE UNSET STATE IS DRAWN, AND IT IS NOT THE FIRST RUNG. A missing row
//   rendered as two unticked boxes and "Not started" would be printing a
//   measurement nobody took, in the shape of one somebody did, on all 140
//   hospitals at once. `map_node_progress` makes the identical argument about
//   its own third state and `store/pmo.ts` states the rule in general: null is
//   "nobody has looked" and it is not an empty portfolio.
//
//   The controls therefore open UNANSWERED, and the line above them says so.
//   The first save is a person speaking; until then the panel says nothing on
//   their behalf.
//
// ── WHY IT WRITES THE WHOLE SET ────────────────────────────────────────────
//
// `setReadiness` takes all three fields, and this component always sends all
// three. A partial upsert on a missing row would take the column defaults for
// the other two and assert, in somebody's name, that they are not started — the
// same failure as drawing the unset state as the first rung, arriving through
// the write path instead of the render.

import { useCallback, useRef, useState, type ReactElement } from 'react'

import { setReadiness } from '../../api/map'
import { t } from '../../lib/i18n'
import { toast } from '../toast'
import { invalidateConfig, useNodeReadiness } from '../../store/config'
import type { SsoState } from '../../types'

/** The three SSO states, in the order the owner listed them. */
const SSO_STATES: readonly SsoState[] = ['not_started', 'uat', 'prd']

/** Literals, so `localeReach.test.ts` can see every key. */
const SSO_WORD: Readonly<Record<SsoState, string>> = {
  not_started: 'mapnode.ssoNotStarted',
  uat: 'mapnode.ssoUat',
  prd: 'mapnode.ssoPrd',
}

export interface ReadinessControlsProps {
  nodeId: string
}

export default function ReadinessControls({ nodeId }: ReadinessControlsProps): ReactElement {
  const stored = useNodeReadiness(nodeId)
  const [busy, setBusy] = useState(false)
  const alive = useRef(true)

  // What the controls show. `stored` absent is the unanswered state, and the
  // FALSE below is what a control renders, not what the database holds — the
  // difference is carried by `answered`, which is what the note reads.
  const answered = stored !== undefined
  const registry = stored?.patient_registry ?? false
  const portal = stored?.provider_portal ?? false
  const sso = stored?.sso ?? 'not_started'

  const save = useCallback(
    (next: { patientRegistry: boolean; providerPortal: boolean; sso: SsoState }) => {
      setBusy(true)
      void setReadiness(nodeId, next).then((result) => {
        if (!alive.current) return
        setBusy(false)
        if (!result.ok) {
          // `result.error` is an i18n KEY from `pgErrorKey`, not a constraint name.
          toast(t(result.error), { tone: 'error' })
          return
        }
        // The store holds one row per node; refetching is cheaper to reason
        // about than a second copy of the truth, and this is not a control
        // anybody uses in a tight loop.
        invalidateConfig()
      })
    },
    [nodeId],
  )

  return (
    <div className="mbr-readiness">
      <h4 className="mbr-sub">{t('mapnode.readiness')}</h4>
      {/* ⚠ MANDATORY WHILE UNANSWERED. Without it the two unticked boxes read as
          "we checked and this hospital has neither", which is a claim nobody
          made about any of the 140. */}
      {!answered && <p className="mbr-note">{t('mapnode.readinessNone')}</p>}

      <label className="mbr-ready-row">
        <input
          type="checkbox"
          checked={registry}
          disabled={busy}
          onChange={(e) =>
            save({ patientRegistry: e.target.checked, providerPortal: portal, sso })
          }
        />
        <span>{t('mapnode.patientRegistry')}</span>
      </label>

      <label className="mbr-ready-row">
        <input
          type="checkbox"
          checked={portal}
          disabled={busy}
          onChange={(e) =>
            save({ patientRegistry: registry, providerPortal: e.target.checked, sso })
          }
        />
        <span>{t('mapnode.providerPortal')}</span>
      </label>

      <label className="mbr-ready-row">
        <span>{t('mapnode.sso')}</span>
        <select
          className="input"
          value={sso}
          disabled={busy}
          onChange={(e) =>
            save({
              patientRegistry: registry,
              providerPortal: portal,
              sso: e.target.value as SsoState,
            })
          }
        >
          {SSO_STATES.map((state) => (
            <option key={state} value={state}>
              {t(SSO_WORD[state])}
            </option>
          ))}
        </select>
      </label>
    </div>
  )
}
