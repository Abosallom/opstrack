// The product's front door. ONE identifier field decides the whole flow.
//
// WHY ONE FIELD. There are two kinds of account — a real email address (the
// owner's) and a predefined username (everyone else) — and asking a person to
// first classify their own credential is a worse form than reading the one
// character that distinguishes them. `store/auth.signInPassword()` already
// branches on '@' and maps a bare username through `usernameToEmail()`; this
// screen branches on the same character purely to decide what to OFFER
// alongside the password:
//
//   contains '@' → "email me a sign-in link"  (sendOtp)
//   no '@'       → "first time? claim your account"  (→ /claim)
//
// A LINK, NOT A CODE (WAVE2-NOTES §1). Supabase's free tier refuses
// email-template changes, so the mail it sends always contains a magic link and
// never a visible {{ .Token }}. The screen that promised "a 6-digit code" was
// promising something the member could not receive. After sendOtp() this screen
// says "check your email and open the link" instead. verifyOtp() stays wired
// behind the "enter a code instead" disclosure: it costs nothing today and
// becomes the primary path the day custom SMTP is configured.
//
// The magic-link redirect carries its tokens in the URL hash. supabase-js parses
// and strips them at module init, before React Router ever sees the hash — so
// there is deliberately NO hash handling here (WAVE2-NOTES §1.3).
//
// ERROR WORDING IS THE STORE'S. store/auth.ts returns a translated sentence
// rather than an ApiResult key (WAVE1-ADDENDUM §2.4) and owns the one rule that
// matters: a wrong password and a nonexistent username produce the SAME
// sentence, because the difference is a username oracle. The only messages this
// file raises itself are the two the store cannot see — an address that is not
// an address, and a code that is not six digits.
//
// There is no sign-up path by design: project signups are disabled and members
// are provisioned by an admin.
//
// DORMANT KEYS. `signin.sendCode`, `signin.codeSent`, `signin.codeResent`,
// `signin.errEmailRequired`, `signin.useEmail` and `signin.useUsername` are
// unused by this screen. The first four are the vocabulary of the custom-SMTP
// path above; the last two belonged to the two-button flow this one replaced.
// They cannot be deleted: localeParity.test.ts pins all 213 pre-split keys.
//
// `signin.microsoft` WAS on that list and is now gone, which is the one case the
// pin did not cover. It was added by the same commit that performed the namespace
// split rather than inherited from the monolithic bundle, so it was never one of
// the 213 — and WAVE5-NOTES §2 cancelled the button it labelled. It is deleted in
// both languages rather than left dormant, because a dormant key for a feature
// that is coming reads differently from one for a feature that was cancelled, and
// only the first is worth carrying.

import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type ReactElement,
} from 'react'
import { Link } from 'react-router-dom'
import { isConfigured } from '../api/supabase'
import { IconArrowStart, IconBolt, IconKey, IconMail, IconUser } from '../components/icons'
import { toast } from '../components/toast'
import { t, useLocale } from '../lib/i18n'
import { sendOtp, signInPassword, verifyOtp } from '../store/auth'
import { setLocaleSetting } from '../store/settings'
import './signin.css'

const CODE_LENGTH = 6
const RESEND_COOLDOWN_S = 30

/** Live auth config sets `mailer_otp_exp = 600` — stated to the user in minutes. */
const LINK_EXPIRY_MIN = 10

// Deliberately loose. The authoritative check is Supabase's; a strict
// client-side pattern only ever rejects addresses that are actually valid.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

type Mode = 'credentials' | 'linkSent'
/** Which request is in flight — three buttons can each be the busy one. */
type Pending = 'password' | 'link' | 'code' | null
/** Which control the error points at, when we know. Store errors point nowhere. */
type ErrorField = 'identifier' | 'code' | null

export default function SignIn(): ReactElement {
  const locale = useLocale()
  const configured = isConfigured()

  const [mode, setMode] = useState<Mode>('credentials')
  const [identifier, setIdentifier] = useState('')
  const [password, setPassword] = useState('')
  const [revealed, setRevealed] = useState(false)
  const [capsOn, setCapsOn] = useState(false)
  const [code, setCode] = useState('')
  const [codeOpen, setCodeOpen] = useState(false)
  // The address the link actually went to, kept apart from `identifier` so a
  // resend cannot be retargeted by an edit the user made after sending.
  const [linkTarget, setLinkTarget] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [errorField, setErrorField] = useState<ErrorField>(null)
  const [pending, setPending] = useState<Pending>(null)
  const [cooldown, setCooldown] = useState(0)

  const identifierRef = useRef<HTMLInputElement>(null)
  const passwordRef = useRef<HTMLInputElement>(null)
  const codeRef = useRef<HTMLInputElement>(null)
  const sentRef = useRef<HTMLDivElement>(null)
  // Guards the auto-submit below from firing twice for the same six digits — a
  // paste and a keypress can land in the same tick, and React 19 StrictMode
  // re-runs the handler path in dev.
  const submittedCode = useRef<string | null>(null)

  const isEmail = identifier.includes('@')
  const busy = pending !== null

  // This route renders outside the shell, so nothing else sets the title.
  //
  // Keyed on `locale`, unlike Shell's equivalent effect, because this screen
  // carries the language toggle itself: without the dep, switching to Arabic
  // repaints every string on the page and leaves the browser tab reading
  // "Sign in · CoreTrack" — the one label the toggle visibly failed to reach.
  useEffect(() => {
    document.title = `${t('route.signin')} · ${t('app.name')}`
  }, [locale])

  // Resend countdown. Cleared on unmount so a stale interval cannot keep
  // ticking after the user has signed in and this screen is gone.
  useEffect(() => {
    if (cooldown <= 0) return
    const id = window.setInterval(() => setCooldown((c) => Math.max(0, c - 1)), 1000)
    return () => window.clearInterval(id)
  }, [cooldown])

  // Focus follows the step. Arriving at "check your email" moves focus into the
  // panel itself rather than onto a button: the panel is the announcement, and
  // it is marked role="status" so screen readers read it on arrival. Stepping
  // back returns focus to the identifier field instead of stranding it on a
  // control that no longer exists. A ref rather than autoFocus, which fires only
  // on first mount and so misses every one of these transitions.
  useEffect(() => {
    if (!configured) return
    if (mode === 'linkSent') sentRef.current?.focus()
    else identifierRef.current?.focus()
  }, [mode, configured])

  // Opening the disclosure has to put the caret in the field it revealed —
  // otherwise the OS one-time-code suggestion never appears.
  useEffect(() => {
    if (codeOpen) codeRef.current?.focus()
  }, [codeOpen])

  function clearError(): void {
    setError(null)
    setErrorField(null)
  }

  function fail(message: string, field: ErrorField = null): void {
    setError(message)
    setErrorField(field)
  }

  /** Caps Lock is the single most common cause of a "wrong password" that isn't. */
  function trackCaps(e: KeyboardEvent<HTMLInputElement>): void {
    setCapsOn(e.getModifierState('CapsLock'))
  }

  async function submitPassword(e: FormEvent): Promise<void> {
    e.preventDefault()
    if (busy) return
    setPending('password')
    clearError()
    // No local validation of either field: the store answers for an empty
    // username, an empty password and a wrong credential alike, and duplicating
    // those checks here would mean two sources for one sentence.
    const message = await signInPassword(identifier, password)
    setPending(null)
    // On success the auth store publishes a session and App swaps this route out
    // from under us; there is nothing to navigate to from here.
    if (!message) return
    fail(message)
    // Send the caret where the fix is. A pre-selected password means the retype
    // replaces rather than appends — the usual outcome of a rejected password.
    if (identifier.trim()) {
      passwordRef.current?.focus()
      passwordRef.current?.select()
    } else {
      identifierRef.current?.focus()
    }
  }

  async function requestLink(isResend: boolean): Promise<void> {
    if (busy) return
    const target = (isResend ? linkTarget : identifier).trim().toLowerCase()
    // The one check the store cannot make for us: sendOtp() accepts any string,
    // and a typo'd address fails as a generic error a round-trip later.
    if (!EMAIL_RE.test(target)) {
      fail(t('signin.errEmailInvalid'), 'identifier')
      identifierRef.current?.focus()
      return
    }
    setPending('link')
    clearError()
    const message = await sendOtp(target)
    setPending(null)
    if (message) {
      fail(message)
      return
    }
    setIdentifier(target)
    setLinkTarget(target)
    setMode('linkSent')
    setCooldown(RESEND_COOLDOWN_S)
    if (isResend) toast(t('signin.linkResent'))
  }

  async function submitCode(value: string): Promise<void> {
    if (busy) return
    if (value.length !== CODE_LENGTH) {
      fail(t('signin.errCodeRequired'), 'code')
      return
    }
    setPending('code')
    clearError()
    const message = await verifyOtp(linkTarget, value)
    setPending(null)
    if (message) {
      fail(message, 'code')
      // A rejected code is almost always mistyped — clear it so the next
      // attempt starts from an empty field instead of needing a select-all.
      setCode('')
      submittedCode.current = null
      codeRef.current?.focus()
    }
  }

  function onCodeChange(raw: string): void {
    const digits = raw.replace(/\D/g, '').slice(0, CODE_LENGTH)
    setCode(digits)
    clearError()
    // Auto-submit on the sixth digit: with OS autofill the code arrives
    // complete, and making the user reach for a button after that is friction
    // for no benefit.
    if (digits.length === CODE_LENGTH && submittedCode.current !== digits) {
      submittedCode.current = digits
      void submitCode(digits)
    }
  }

  function backToCredentials(): void {
    setMode('credentials')
    setCode('')
    setCodeOpen(false)
    clearError()
    submittedCode.current = null
  }

  const errorNode = error ? (
    <p className="field-error signin-error" id="signin-error" role="alert">
      {error}
    </p>
  ) : null

  const IdentifierIcon = isEmail ? IconMail : IconUser

  return (
    <main className="signin">
      <div className="card signin-card">
        <div className="signin-brand">
          <span className="signin-mark" aria-hidden="true">
            <IconBolt size={16} />
          </span>
          <span className="signin-brand-name">{t('app.name')}</span>
          {/* The ONLY language control that exists before sign-in. The header's
              toggle lives inside the shell, which a signed-out user never
              reaches — without this, an Arabic-first member handed an English
              build (or the reverse) has no way to read the front door. Same
              pattern as AppHeader: the target language written in its own
              script, `lang` set so it picks up the right face and voice.
              setLocaleSetting() is a no-op against the profile while signed
              out, so this costs nothing here. */}
          <button
            type="button"
            className="btn btn-ghost btn-sm signin-lang"
            lang={locale === 'en' ? 'ar' : 'en'}
            aria-label={t('common.toggleLanguage')}
            onClick={() => setLocaleSetting(locale === 'en' ? 'ar' : 'en')}
          >
            {locale === 'en' ? t('settings.languageAr') : t('settings.languageEn')}
          </button>
        </div>

        {!configured ? (
          <div className="signin-notice" role="status">
            <p className="signin-notice-title">{t('settings.backendNotConfigured')}</p>
            <p className="signin-notice-body">{t('signin.notConfigured')}</p>
          </div>
        ) : mode === 'credentials' ? (
          <form className="signin-form" onSubmit={(e) => void submitPassword(e)} noValidate>
            <h2 className="signin-title">{t('signin.heading')}</h2>
            <p className="signin-sub">{t('signin.subtitle')}</p>

            <div className="signin-fields">
              <div className="field">
                <label className="field-label" htmlFor="signin-identifier">
                  {t('signin.identifierLabel')}
                </label>
                <div className="signin-field">
                  {/* The glyph tracks what has been typed: a mail envelope the
                      moment an '@' appears, a person before that. It is the only
                      visible sign that one field is serving two account kinds. */}
                  <IdentifierIcon className="signin-field-icon" size={18} />
                  <input
                    ref={identifierRef}
                    id="signin-identifier"
                    className="input signin-input"
                    type="text"
                    // Not type="email": this field takes a username too, and the
                    // browser's built-in email validation would reject one.
                    inputMode={isEmail ? 'email' : 'text'}
                    autoComplete="username"
                    autoCapitalize="off"
                    autoCorrect="off"
                    spellCheck={false}
                    placeholder={t('signin.identifierPlaceholder')}
                    value={identifier}
                    onChange={(e) => {
                      setIdentifier(e.target.value)
                      clearError()
                    }}
                    aria-describedby={
                      errorField === 'identifier' ? 'signin-error' : 'signin-identifier-hint'
                    }
                    aria-invalid={errorField === 'identifier' ? true : undefined}
                  />
                </div>
                <p className="signin-hint" id="signin-identifier-hint">
                  {t('signin.identifierHint')}
                </p>
              </div>

              <div className="field">
                <label className="field-label" htmlFor="signin-password">
                  {t('signin.passwordLabel')}
                </label>
                <div className="signin-field">
                  <IconKey className="signin-field-icon" size={18} />
                  <input
                    ref={passwordRef}
                    id="signin-password"
                    className="input signin-input signin-input-secret"
                    type={revealed ? 'text' : 'password'}
                    autoComplete="current-password"
                    autoCapitalize="off"
                    autoCorrect="off"
                    spellCheck={false}
                    placeholder={t('signin.passwordPlaceholder')}
                    value={password}
                    onChange={(e) => {
                      setPassword(e.target.value)
                      clearError()
                    }}
                    onKeyUp={trackCaps}
                    onKeyDown={trackCaps}
                    onBlur={() => setCapsOn(false)}
                  />
                  {/* A word, not an eye glyph: components/icons.tsx is closed
                      after Wave 1, and "Show"/"Hide" states the toggle's effect
                      without needing a label a screen reader has to be told. */}
                  <button
                    type="button"
                    className="signin-reveal tap-44"
                    aria-pressed={revealed}
                    onClick={() => setRevealed((v) => !v)}
                  >
                    {revealed ? t('signin.hidePassword') : t('signin.showPassword')}
                  </button>
                </div>
                {capsOn ? (
                  <p className="signin-caps" role="status">
                    {t('signin.capsLock')}
                  </p>
                ) : null}
              </div>
            </div>

            {errorNode}

            <button
              type="submit"
              className="btn btn-primary btn-block signin-submit"
              disabled={busy}
            >
              {pending === 'password' ? t('signin.signingIn') : t('signin.verify')}
            </button>

            {/* One separator, one alternative — the branch swaps WHAT the
                alternative is, never whether there is one, so nothing below the
                submit button moves as the identifier is typed. */}
            <div className="signin-sep" role="presentation" />

            {isEmail ? (
              <button
                type="button"
                className="btn btn-block signin-alt"
                disabled={busy}
                onClick={() => void requestLink(false)}
              >
                <IconMail size={16} />
                {pending === 'link' ? t('signin.sending') : t('signin.sendLink')}
              </button>
            ) : (
              <Link className="signin-link" to="/claim">
                {t('signin.firstTime')}
              </Link>
            )}

            {/* Nothing follows the alternatives slot. Wave 4b mounted
                `<SsoButtons />` here — a Microsoft Entra button that rendered only
                once `/auth/v1/settings` reported `external.azure: true`, which it
                never did. WAVE5-NOTES §2 removed the provider outright: the
                admin-managed Members directory IS the directory, so this screen's
                two paths — a username + password, or an emailed link — are the
                only ways in, and both terminate at an account an admin created. */}
          </form>
        ) : (
          <div
            className="signin-sent"
            ref={sentRef}
            tabIndex={-1}
            role="status"
            aria-live="polite"
          >
            <span className="signin-sent-mark" aria-hidden="true">
              <IconMail size={22} />
            </span>
            <h2 className="signin-title">{t('signin.linkHeading')}</h2>
            <p className="signin-sub">{t('signin.linkSent', { email: linkTarget })}</p>
            <p className="signin-note">{t('signin.linkHint', { minutes: LINK_EXPIRY_MIN })}</p>

            {!codeOpen ? errorNode : null}

            <div className="signin-actions">
              <button type="button" className="btn btn-ghost btn-sm" onClick={backToCredentials}>
                {/* icon-directional: this arrow points back toward the inline
                    start, so it has to mirror in Arabic. */}
                <IconArrowStart className="icon-directional" size={16} />
                {t('signin.changeEmail')}
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                disabled={busy || cooldown > 0}
                onClick={() => void requestLink(true)}
              >
                {cooldown > 0 ? t('signin.resendIn', { count: cooldown }) : t('signin.resend')}
              </button>
            </div>

            <div className="signin-disclosure">
              <button
                type="button"
                className="signin-disclosure-toggle"
                aria-expanded={codeOpen}
                aria-controls="signin-code-panel"
                onClick={() => {
                  setCodeOpen((open) => !open)
                  clearError()
                }}
              >
                <span className="signin-disclosure-marker" aria-hidden="true">
                  {codeOpen ? '−' : '+'}
                </span>
                {t('signin.enterCodeInstead')}
              </button>

              {codeOpen ? (
                <form
                  id="signin-code-panel"
                  className="signin-code-form"
                  onSubmit={(e) => {
                    e.preventDefault()
                    void submitCode(code)
                  }}
                  noValidate
                >
                  <p className="signin-note">{t('signin.codeDisclosureHint')}</p>

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
                        // inputMode + one-time-code together are what make iOS
                        // show the numeric keypad AND offer the emailed code
                        // above it. type="number" would do neither, and adds
                        // spinner arrows.
                        inputMode="numeric"
                        autoComplete="one-time-code"
                        pattern="[0-9]*"
                        maxLength={CODE_LENGTH}
                        placeholder={t('signin.codePlaceholder')}
                        value={code}
                        onChange={(e) => onCodeChange(e.target.value)}
                        aria-describedby={errorField === 'code' ? 'signin-error' : undefined}
                        aria-invalid={errorField === 'code' ? true : undefined}
                      />
                    </div>
                    {errorNode}
                  </div>

                  <button
                    type="submit"
                    className="btn btn-primary btn-block signin-submit"
                    disabled={busy}
                  >
                    {pending === 'code' ? t('signin.verifying') : t('signin.verify')}
                  </button>
                </form>
              ) : null}
            </div>
          </div>
        )}
      </div>
    </main>
  )
}
