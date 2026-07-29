import type { ReactElement } from 'react'
import Placeholder from './Placeholder'
import { IconChart } from '../components/icons'
import { t, useLocale } from '../lib/i18n'

export default function Dashboard(): ReactElement {
  useLocale()
  return (
    <Placeholder
      icon={<IconChart size={30} />}
      title={t('route.dashboard')}
      description={t('placeholder.dashboard')}
    />
  )
}
