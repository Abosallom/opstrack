// Who is carrying what — a TABLE, not a chart, and deliberately so.
//
// The other five panels answer shape questions ("where is the work", "is it
// getting older"). This one answers a name question, and the reader's next
// action after reading it is to move an item from one person to another. That
// needs exact numbers next to exact names, sortable by eye, copyable — which is
// a table. A horizontal bar chart of the same data would make the numbers the
// thing you squint at.
//
// The bar in each row is DECORATION over the number it sits behind: `inline-size`
// as a percentage of the heaviest load, aria-hidden, purely so the eye finds the
// top of the list without reading four rows. Removing it would cost nothing but
// scanning speed, which is exactly the right weight for a graphic in a table.
//
// UNASSIGNED IS A ROW, NOT AN OMISSION, and lib/aggregate pins it last. Work
// nobody owns is the single most actionable line on this panel; hiding it
// because it has no name would be hiding the answer.

import { useId, type ReactElement } from 'react'
import { isolate } from '../../lib/bidi'
import { t, useLocale } from '../../lib/i18n'
import type { OwnerLoad } from '../../lib/aggregate'
import './charts.css'

export interface OwnerLoadRow extends OwnerLoad {
  label: string
  /** True for the `''` key — styled as a gap in the data, not as a person. */
  unassigned: boolean
}

export function OwnerLoadTable({
  rows,
  loading = false,
}: {
  rows: readonly OwnerLoadRow[]
  loading?: boolean
}): ReactElement {
  useLocale()
  const capId = useId()

  const heaviest = rows.reduce((max, r) => (r.open > max ? r.open : max), 0)

  return (
    <section className="cht" aria-labelledby={capId}>
      <div className="cht-head">
        <h3 className="cht-title" id={capId}>
          {t('dashboard.ownerTitle')}
        </h3>
      </div>
      <p className="cht-desc">{t('dashboard.ownerDesc')}</p>

      {loading ? (
        <div className="cht-ownerskeleton" aria-hidden="true">
          <div className="skeleton" style={{ blockSize: 34 }} />
          <div className="skeleton" style={{ blockSize: 34 }} />
          <div className="skeleton" style={{ blockSize: 34 }} />
        </div>
      ) : rows.length === 0 ? (
        <p className="cht-empty">{t('dashboard.ownerEmpty')}</p>
      ) : (
        <div className="cht-tablewrap">
          <table className="cht-table cht-ownertable">
            <caption className="sr-only">{t('dashboard.ownerTitle')}</caption>
            <thead>
              <tr>
                <th scope="col">{t('dashboard.colOwner')}</th>
                <th scope="col" className="cht-num">
                  {t('dashboard.colOpen')}
                </th>
                <th scope="col" className="cht-num">
                  {t('dashboard.colOverdue')}
                </th>
                <th scope="col" className="cht-num">
                  {t('dashboard.colQuiet')}
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.ownerKey || 'unassigned'} className={row.unassigned ? 'is-unassigned' : undefined}>
                  <th scope="row">
                    {/* A member's display name, or a free-text owner somebody
                        typed — direction unknown either way, and the cell sits
                        against a number. Isolated so `2026 Vendor` does not
                        arrive as `Vendor 2026` in the Arabic table. */}
                    <span className="cht-ownername">{isolate(row.label)}</span>
                    <span
                      className="cht-loadbar"
                      aria-hidden="true"
                      style={{
                        // A share of the heaviest load, floored at 2% so a
                        // one-item owner still shows a mark rather than an
                        // empty cell that reads as missing data.
                        inlineSize: `${heaviest > 0 ? Math.max(2, (row.open / heaviest) * 100) : 0}%`,
                      }}
                    />
                  </th>
                  <td className="cht-num tabular">{row.open}</td>
                  <td className={row.overdue > 0 ? 'cht-num tabular is-bad' : 'cht-num tabular'}>
                    {row.overdue}
                  </td>
                  <td className={row.stale > 0 ? 'cht-num tabular is-warn' : 'cht-num tabular'}>
                    {row.stale}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="cht-note">{t('dashboard.ownerNote')}</p>
    </section>
  )
}
