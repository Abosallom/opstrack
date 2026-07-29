// One shared "not built yet" page, wrapped by every phase-2+ route.
//
// The point is that it reads as deliberate rather than broken: it names the
// screen, says in one line what will live there, and carries an explicit phase
// badge. A blank route or a bare "TODO" makes the whole app feel unfinished,
// and the shell is the thing being reviewed at this stage.

import type { ReactElement, ReactNode } from 'react'
import { t, useLocale } from '../lib/i18n'
import './placeholder.css'

export default function Placeholder({
  icon,
  title,
  description,
}: {
  icon: ReactNode
  title: string
  description: string
}): ReactElement {
  useLocale()
  return (
    <div className="ph">
      <div className="ph-icon" aria-hidden="true">
        {icon}
      </div>
      <span className="pill info">{t('placeholder.comingSoon')}</span>
      <h2 className="ph-title">{title}</h2>
      <p className="ph-desc">{description}</p>
    </div>
  )
}
