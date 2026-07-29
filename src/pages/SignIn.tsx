// Two-step email OTP sign-in.
//
// There is no sign-up path by design: Supabase project signups are disabled and
// members are provisioned by an admin through the admin-members edge function.
// The subtitle says so up front, because the alternative is a user typing an
// unknown address, getting "signups not allowed", and concluding the app is
// broken. (store/auth.ts translates that error into a human sentence too.)

import { useEffect, useRef, useState, type FormEvent, type ReactElement } from 'react'
import { isConfigured } from '../api/supabase'
import { IconArrowStart, IconKey, IconMail } from '../components/icons'
import { toast } from '../components/toast'
import { t, useLocale } from '../lib/i18n'
import { sendOtp, verifyOtp } from '../store/auth'
import './signin.css'

const CODE_LENGTH = 6
const RESEND_COOLDOWN_S = 30

// Deliberately loose. The authoritative check is Supabase's; a strict
// client-side pattern only ever rejects addresses that are actually valid.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export default function SignIn(): ReactElement {
  useLocale()
  const configured = isConfigured()

  const [step, setStep] = useState<'email' | 'code'>('email')
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [cooldown, setCooldown] = useState(0)
  const emailRef = useRef<HTMLInputElement>(null)
  const codeRef = useRef<HTMLInputElement>(null)
  // Guards the auto-submit below from firing twice for the same six digits — a
  // paste and a keypress can land in the same tick, and React 19 StrictMode
  // re-runs the handler path in dev.
  const submittedCode = useRef<string | null>(null)

  // Resend countdown. Cleared on unmount so a stale interval cannot keep
  // ticking after the user has signed in and this screen is gone.
  useEffect(() => {
    if (cooldown <= 0) return
    const id = window.setInterval(() => setCooldown((c) => Math.max(0, c - 1)), 1000)
    return () => window.clearInterval(id)
  }, [cooldown])

  // Focus follows the step: arriving at step 2 focuses the code field so the OS
  // one-time-code suggestion appears without an extra tap, and stepping back
  // returns focus to the email field instead of stranding it on a button that
  // no longer exists. Done with a ref rather than the autoFocus attribute,
  // which only fires on first mount and so misses the back navigation.
  useEffect(() => {
    if (!configured) return
    if (step === 'code') codeRef.current?.focus()
    else emailRef.current?.focus()
  }, [step, configured])

  async function requestCode(target: string, isResend: boolean): Promise<void> {
    setBusy(true)
    setError(null)
    const message = await sendOtp(target)
    setBusy(false)
    if (message) {
      setError(message)
      return
    }
    setStep('code')
    setCooldown(RESEND_COOLDOWN_S)
    if (isResend) toast(t('signin.codeResent'))
  }

  async function submitEmail(e: FormEvent): Promise<void> {
    e.preventDefault()
    const target = email.trim().toLowerCase()
    if (!target) {
      setError(t('signin.errEmailRequired'))
      return
    }
    if (!EMAIL_RE.test(target)) {
      setError(t('signin.errEmailInvalid'))
      return
    }
    setEmail(target)
    await requestCode(target, false)
  }

  async function submitCode(value: string): Promise<void> {
    if (busy) return
    if (value.length !== CODE_LENGTH) {
      setError(t('signin.errCodeRequired'))
      return
    }
    setBusy(true)
    setError(null)
    const message = await verifyOtp(email, value)
    setBusy(false)
    if (message) {
      setError(message)
      // A rejected code is almost always mistyped — clear it so the next
      // attempt starts from an empty field instead of needing a select-all.
      setCode('')
      submittedCode.current = null
      codeRef.current?.focus()
    }
    // On success the auth store publishes a session and App swaps this route
    // out from under us; there is nothing to navigate to from here.
  }

  function onCodeChange(raw: string): void {
    const digits = raw.replace(/\D/g, '').slice(0, CODE_LENGTH)
    setCode(digits)
    setError(null)
    // Auto-submit on the sixth digit: with OS autofill the code arrives
    // complete, and making the user reach for a button after that is friction
    // for no benefit.
    if (digits.length === CODE_LENGTH && submittedCode.current !== digits) {
      submittedCode.current = digits
      void submitCode(digits)
    }
  }

  const errorNode = error ? (
    <p className="field-error" id="signin-error" role="alert">
      {error}
    </p>
  ) : null

  return (
    <main className="signin">
      <div className="card signin-card">
        <div className="signin-brand">
          <span className="sidebar-brand-mark" aria-hidden="true" />
          {t('app.name')}
        </div>

        {!configured ? (
          <div className="signin-notice" role="status">
            <p className="signin-notice-title">{t('settings.backendNotConfigured')}</p>
            <p className="signin-notice-body">{t('signin.notConfigured')}</p>
          </div>
        ) : step === 'email' ? (
          <form className="signin-form" onSubmit={(e) => void submitEmail(e)} noValidate>
            <h2 className="signin-title">{t('signin.heading')}</h2>
            <p className="signin-sub">{t('signin.subtitle')}</p>

            <div className="field">
              <label className="field-label" htmlFor="signin-email">
                {t('signin.emailLabel')}
              </label>
              <div className="signin-field">
                <IconMail className="signin-field-icon" size={18} />
                <input
                  ref={emailRef}
                  id="signin-email"
                  className="input signin-input"
                  type="email"
                  inputMode="email"
                  autoComplete="email"
                  autoCapitalize="off"
                  autoCorrect="off"
                  spellCheck={false}
                  placeholder={t('signin.emailPlaceholder')}
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value)
                    setError(null)
                  }}
                  aria-describedby={error ? 'signin-error' : undefined}
                  aria-invalid={error ? true : undefined}
                />
              </div>
              {errorNode}
            </div>

            <button
              type="submit"
              className="btn btn-primary btn-block signin-submit"
              disabled={busy}
            >
              {busy ? t('signin.sending') : t('signin.sendCode')}
            </button>
          </form>
        ) : (
          <form
            className="signin-form"
            onSubmit={(e) => {
              e.preventDefault()
              void submitCode(code)
            }}
            noValidate
          >
            <h2 className="signin-title">{t('signin.codeHeading')}</h2>
            <p className="signin-sub">{t('signin.codeSent', { email })}</p>

            <div className="field">
              <label className="field-label" htmlFor="signin-code">
                {t('signin.codeLabel')}
              </label>
              <div className="signin-field">
                <IconKey className="signin-field-icon" size={18} />
                <input
                  ref={codeRef}
                  id="signin-code"
                  className="input signin-input signin-code-input"
                  type="text"
                  // inputMode + one-time-code together are what make iOS show
                  // the numeric keypad AND offer the emailed code above it.
                  // type="number" would do neither, and adds spinner arrows.
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  pattern="[0-9]*"
                  maxLength={CODE_LENGTH}
                  placeholder={t('signin.codePlaceholder')}
                  value={code}
                  onChange={(e) => onCodeChange(e.target.value)}
                  aria-describedby={error ? 'signin-error' : undefined}
                  aria-invalid={error ? true : undefined}
                />
              </div>
              {errorNode}
            </div>

            <button
              type="submit"
              className="btn btn-primary btn-block signin-submit"
              disabled={busy}
            >
              {busy ? t('signin.verifying') : t('signin.verify')}
            </button>

            <div className="signin-actions">
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => {
                  setStep('email')
                  setCode('')
                  setError(null)
                  submittedCode.current = null
                }}
              >
                {/* icon-directional: this arrow points back toward the inline
                    start, so it has to mirror in Arabic. */}
                <IconArrowStart className="icon-directional" size={16} />
                {t('signin.changeEmail')}
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                disabled={busy || cooldown > 0}
                onClick={() => void requestCode(email, true)}
              >
                {cooldown > 0 ? t('signin.resendIn', { seconds: cooldown }) : t('signin.resend')}
              </button>
            </div>
          </form>
        )}
      </div>
    </main>
  )
}
