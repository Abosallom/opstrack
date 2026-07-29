import type { ReactElement } from 'react'
import Placeholder from './Placeholder'
import { IconColumns } from '../components/icons'
import { t, useLocale } from '../lib/i18n'

export default function Board(): ReactElement {
  useLocale()
  return (
    <Placeholder
      icon={<IconColumns size={30} />}
      title={t('route.board')}
      description={t('placeholder.board')}
    />
  )
}
