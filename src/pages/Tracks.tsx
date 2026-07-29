import type { ReactElement } from 'react'
import { useParams } from 'react-router-dom'
import Placeholder from './Placeholder'
import { IconLayers } from '../components/icons'
import { t, useLocale } from '../lib/i18n'

// Serves both /tracks and /tracks/:id. Until the timeline exists there is
// nothing for the id to change beyond the copy, but routing the deep link here
// keeps shared per-track links alive instead of bouncing them home.
export default function Tracks(): ReactElement {
  useLocale()
  const { id } = useParams<{ id: string }>()
  return (
    <Placeholder
      icon={<IconLayers size={30} />}
      title={t(id ? 'route.trackDetail' : 'route.tracks')}
      description={t(id ? 'placeholder.trackDetail' : 'placeholder.tracks')}
    />
  )
}
