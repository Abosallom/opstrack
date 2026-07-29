import type { ReactElement } from 'react'
import Placeholder from './Placeholder'
import { IconMic } from '../components/icons'
import { t, useLocale } from '../lib/i18n'

export default function Meetings(): ReactElement {
  useLocale()
  return (
    <Placeholder
      icon={<IconMic size={30} />}
      title={t('route.meetings')}
      description={t('placeholder.meetings')}
    />
  )
}
