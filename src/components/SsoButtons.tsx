// The Microsoft sign-in button, and the notice that appears when a Microsoft
// sign-in was refused.
//
// IT RENDERS NOTHING UNTIL THE PROVIDER IS ACTUALLY ENABLED. On mount it asks
// `/auth/v1/settings` whether `external.azure` is true and returns null while the
// answer is unknown or false. Measured against the live project as this was
// written: `false`. That is the whole reason this component exists rather than a
// hardcoded button — the plan promised Wave 4 would ship the Microsoft path
// "button-only until the owner's tenant supplies a client id/secret"
// (WAVE1-ADDENDUM §1), and a button that always renders would be a button that
// fails with `{"error":"Unsupported provider"}` for everyone until IT finishes.
// A control that cannot work must not be visible; a control that can, appears the
// moment the dashboard toggle is flipped, with no deploy.
//
// NO LAYOUT SHIFT WHEN IT DOES APPEAR. The probe is one request against an
// already-warm origin and the sign-in card is centred with `align-items: center`,
// so the button materialises below the separator without moving the fields the
// user is typing in. Rendering a skeleton in its place would reserve space for a
// button that, on this project today, never comes.
//
// PLACEMENT. SignIn.tsx mounts this under its own separator, in the alternatives
// slot beside "email me a link" / "first time?". This file deliberately does not
// render a separator of its own — see the `sso-block` comment below.

import { useEffect, useState, type ReactElement } from 'react'
import { supabase } from '../api/supabase'
import { t } from '../lib/i18n'
import {
  AZURE_PROVIDER,
  fetchAuthSettings,
  installSsoGuard,
  providerEnabled,
  startAzureSignIn,
  takeSsoRejection,
} from '../lib/sso'
import './sso.css'

/**
 * The Microsoft logo — four squares, the one mark Microsoft's brand rules require
 * on a "Sign in with Microsoft" button.
 *
 * Local to this file because `components/icons.tsx` is a monochrome
 * stroke=currentColor family, closed after Wave 1, and this is neither
 * monochrome nor a line icon: the four brand colours ARE the logo, and tinting
 * them with `currentColor` would make it something else.
 */
function MicrosoftMark(): ReactElement {
  return (
    <svg
      className="sso-mark"
      viewBox="0 0 20 20"
      width={16}
      height={16}
      aria-hidden="true"
      focusable="false"
    >
      <rect x="1" y="1" width="8" height="8" fill="#f25022" />
      <rect x="11" y="1" width="8" height="8" fill="#7fba00" />
      <rect x="1" y="11" width="8" height="8" fill="#00a4ef" />
      <rect x="11" y="11" width="8" height="8" fill="#ffb900" />
    </svg>
  )
}

export default function SsoButtons(): ReactElement | null {
  const [enabled, setEnabled] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Read ONCE, on mount, and cleared by the read — see takeSsoRejection(). The
  // rejection was recorded by the guard just before it signed the user out, and
  // this component is the first thing that renders afterwards.
  const [rejected, setRejected] = useState<string | null>(() => takeSsoRejection())

  useEffect(() => {
    // Belt and braces. main.tsx installs the guard for the session (it has to:
    // an SSO redirect can land straight in the shell, where this component never
    // mounts). Calling it again here is idempotent, and it means the refusal path
    // still works in a build whose composition root was not wired.
    installSsoGuard(supabase)
  }, [])

  useEffect(() => {
    const abort = new AbortController()
    void fetchAuthSettings(abort.signal).then((settings) => {
      // No `if (!aborted)` guard needed beyond the abort itself: fetchAuthSettings
      // resolves to an empty provider map on an aborted request, so a late
      // resolve after unmount sets `false` on a component React has discarded.
      setEnabled(providerEnabled(settings, AZURE_PROVIDER))
    })
    return () => abort.abort()
  }, [])

  async function onClick(): Promise<void> {
    if (!supabase || pending) return
    setPending(true)
    setError(null)
    const failure = await startAzureSignIn(supabase)
    if (failure) {
      // On success the browser is already navigating to Microsoft, so there is
      // nothing to re-enable — only a failure returns to this screen.
      setPending(false)
      setError(failure)
    }
  }

  // The refusal notice outlives the button's own visibility: if an admin turns
  // the provider off between a refused sign-in and this render, the person still
  // deserves the explanation for why they were signed out.
  if (!enabled && rejected === null) return null

  return (
    // No separator element here. SignIn.tsx owns the one `.signin-sep` above the
    // alternatives slot, and a second rule drawn by this component would double
    // it on the one screen that mounts both.
    <div className="sso-block">
      {rejected !== null ? (
        <div className="sso-notice" role="status">
          <p className="sso-notice-title">{t('sso.rejectedTitle')}</p>
          <p className="sso-notice-body">{t('sso.rejectedBody', { email: rejected })}</p>
          <p className="sso-notice-body">{t('sso.rejectedAsk')}</p>
          <button
            type="button"
            className="btn btn-ghost btn-sm sso-dismiss"
            onClick={() => setRejected(null)}
          >
            {t('sso.rejectedDismiss')}
          </button>
        </div>
      ) : null}

      {enabled ? (
        <>
          <button
            type="button"
            className="btn btn-block sso-button"
            disabled={pending}
            onClick={() => void onClick()}
          >
            <MicrosoftMark />
            {/* `signin.microsoft` is not a new key: it has shipped in both
                languages since Wave 1, reserved for exactly this button and
                documented as dormant in SignIn.tsx's header. This is the wave
                that wakes it up. */}
            {pending ? t('sso.redirecting') : t('signin.microsoft')}
          </button>
          <p className="sso-hint">{t('sso.hint')}</p>
          {error !== null ? (
            <p className="field-error sso-error" role="alert">
              {t(error)}
            </p>
          ) : null}
        </>
      ) : null}
    </div>
  )
}
