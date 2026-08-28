// Settings › Catalogue — which of the five rungs each capability passes through.
//
// ── THE OWNER'S ASK, AND WHAT THIS SCREEN IS AND IS NOT ───────────────────
//
//   "each use case has its own phases"
//
// and, asked what differs: the same five, but some do not apply to some use
// cases. So this is NOT a screen for naming phases. Intake → DEV → STG/TEST →
// COC → PROD stays the programme's shared vocabulary — five values in one CHECK
// constraint, five words in `USE_CASE_RUNGS`, the same five in the announcement
// in both languages. What this screen edits is which STOPS a capability makes.
//
// ⚠ WHICH IS WHY IT IS A MATRIX AND NOT ELEVEN FORMS. The question a person
//   actually has here is comparative — "which capabilities skip STG/TEST?" — and
//   that is a column, readable in one glance. Eleven separate editors would
//   answer it only by remembering ten screens.
//
// ── ABSENT MEANS ALL FIVE, AND THE SCREEN SAYS SO ─────────────────────────
//
// 0036 may not be applied. The read then fails on every load, the map is empty,
// and `rungsFor()` answers with all five for everybody — which is exactly the
// behaviour before the table existed. Rather than draw a full matrix that
// silently cannot be edited, the screen states that no ladder has been narrowed
// yet. That sentence is equally true after somebody switches everything back on,
// which is why it is phrased about the state and not about the migration.
//
// ── intake AND prod ARE NOT OFFERED, RATHER THAN OFFERED AND REFUSED ──────
//
// 0036's guard refuses to remove either: every one of the 1,540 links sits at
// intake, so removing it would orphan the estate in one click, and a ladder with
// no PROD is one a capability can never finish. The control is ABSENT for those
// two — `PortfolioEditor.tsx`'s rule, that a disabled control is a promise and
// this one would be a lie. A capability that genuinely never goes live is
// `scope = 'not_applicable'` on the pair, which 0032 already has.

import { useState, type ReactElement } from 'react'
import { toast } from '../toast'
import { t } from '../../lib/i18n'
import { USE_CASE_RUNGS, type UseCase, type UseCaseRung } from '../../types'
import { rungApplies, rungIsRequired } from '../../lib/useCaseRungs'
import { useHasPerm } from '../../store/auth'
import { loadConfig, useUseCaseRungRows, useUseCaseRungs } from '../../store/config'
import { applyUseCaseRung, unapplyUseCaseRung } from '../../api/map'

/** The rung as a word — the same five keys the map's own track uses. */
const RUNG_WORD: Record<UseCaseRung, string> = {
  intake: 'mapnode.rungIntake',
  dev: 'mapnode.rungDev',
  stg: 'mapnode.rungStg',
  coc: 'mapnode.rungCoc',
  prod: 'mapnode.rungProd',
}

export function UseCaseLadders({ useCases }: { useCases: readonly UseCase[] }): ReactElement | null {
  // 0036 gates these writes on `structure.edit`, NOT on the `vocab.edit` that
  // gates the screen around this one. The ladder is structure: which stops a
  // capability makes restates what every rung count means. Today nobody is
  // affected — Admin and Director hold both keys — but the gate matches the RLS
  // rather than the route, because offering a control the database refuses is a
  // lie the client tells first.
  const canEdit = useHasPerm('structure.edit')
  const ladders = useUseCaseRungs()
  const rows = useUseCaseRungRows()
  const [busy, setBusy] = useState<string | null>(null)

  const visible = useCases.filter((u) => !u.hidden)
  if (visible.length === 0) return null

  const toggle = async (useCase: UseCase, rung: UseCaseRung, on: boolean): Promise<void> => {
    const key = `${useCase.id}:${rung}`
    setBusy(key)
    const result = on ? await applyUseCaseRung(useCase.id, rung) : await unapplyUseCaseRung(useCase.id, rung)
    setBusy(null)
    if (!result.ok) {
      // An i18n KEY from pgErrorKey — `use_case_rung_in_use` names how many
      // organizations are standing on the rung, which is the whole reason the
      // database refuses rather than the client.
      toast(t(result.error), { tone: 'error' })
      return
    }
    // The whole config, because the matrix is derived from it and a partial
    // update here would be a second opinion about what the ladder is.
    await loadConfig(true)
    toast(t('common.saved'))
  }

  return (
    <section className="card cat-section" aria-labelledby="cat-h-ladder">
      <div className="cat-section-head">
        <h2 className="cat-section-title" id="cat-h-ladder">
          {t('catalogue.laddersTitle')}
        </h2>
      </div>
      <p className="muted cat-section-desc">{t('catalogue.laddersDesc')}</p>

      {rows.length === 0 && <p className="cat-note">{t('catalogue.laddersUnconfigured')}</p>}

      <div className="cat-ladder-scroll">
        <table className="cat-ladder">
          <thead>
            <tr>
              <th scope="col">{t('catalogue.laddersCapability')}</th>
              {USE_CASE_RUNGS.map((rung) => (
                <th scope="col" key={rung}>
                  {t(RUNG_WORD[rung])}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visible.map((useCase) => (
              <tr key={useCase.id}>
                <th scope="row" className="cat-ladder-name">
                  {useCase.name}
                </th>
                {USE_CASE_RUNGS.map((rung) => {
                  const on = rungApplies(ladders, useCase.id, rung)
                  const required = rungIsRequired(rung)
                  return (
                    <td key={rung} className="cat-ladder-cell" data-on={on ? '' : undefined}>
                      {required ? (
                        // Absent, not disabled. See the header.
                        <span className="cat-ladder-fixed" title={t('catalogue.laddersAlways')}>
                          {t('catalogue.laddersAlwaysMark')}
                        </span>
                      ) : (
                        <label className="cat-ladder-toggle">
                          <input
                            type="checkbox"
                            checked={on}
                            disabled={!canEdit || busy !== null}
                            onChange={(e) => void toggle(useCase, rung, e.target.checked)}
                          />
                          <span className="sr-only">
                            {t('catalogue.laddersToggle', {
                              rung: t(RUNG_WORD[rung]),
                              name: useCase.name,
                            })}
                          </span>
                        </label>
                      )}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}
