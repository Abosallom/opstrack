// Connectivity banner, rendered between the header and the page content.
//
// The wrapper stays mounted at all times because it IS the live region: screen
// readers only announce content inserted into a region that already exists, so
// mounting the region together with its message announces nothing. It collapses
// to zero height when there is no message.
//
// .offline-banner and .offline-banner-dot are styled in app-shell.css; this
// component only owns the wrapper.

import { useEffect, useState, type ReactElement } from 'react'
import { t, useLocale } from '../lib/i18n'
import './offline-banner.css'

export default function OfflineBanner(): ReactElement {
  useLocale()
  const [offline, setOffline] = useState(() => !navigator.onLine)

  useEffect(() => {
    const goOffline = () => setOffline(true)
    const goOnline = () => setOffline(false)
    window.addEventListener('offline', goOffline)
    window.addEventListener('online', goOnline)
    return () => {
      window.removeEventListener('offline', goOffline)
      window.removeEventListener('online', goOnline)
    }
  }, [])

  return (
    <div className="offline-region" role="status" aria-live="polite">
      {offline && (
        <div className="offline-banner">
          <span className="offline-banner-dot" aria-hidden="true" />
          <span>{t('offline.banner')}</span>
        </div>
      )}
    </div>
  )
}
