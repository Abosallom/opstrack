import type { ReactElement } from 'react'
import Placeholder from './Placeholder'
import { IconBolt } from '../components/icons'
import { t, useLocale } from '../lib/i18n'

export default function Capture(): ReactElement {
  useLocale()
  return (
    <Placeholder
      icon={<IconBolt size={30} />}
      title={t('route.capture')}
      description={t('placeholder.capture')}
    />
  )
}
