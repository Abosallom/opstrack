import type { ReactElement } from 'react'
import Placeholder from './Placeholder'
import { IconChecklist } from '../components/icons'
import { t, useLocale } from '../lib/i18n'

export default function FollowUps(): ReactElement {
  useLocale()
  return (
    <Placeholder
      icon={<IconChecklist size={30} />}
      title={t('route.followups')}
      description={t('placeholder.followups')}
    />
  )
}
