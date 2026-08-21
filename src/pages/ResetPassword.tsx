// /reset — the whole of password recovery, on one screen, in two halves.
//
// WHY THIS ROUTE EXISTS. Until it did, the product had no recovery path of any
// kind: no resetPasswordForEmail call anywhere in src/, no "forgot your
// password" affordance, and an ADMIN at the top of the tree with nobody above
// him to reset it for him. A forgotten password was permanent, and nothing on
// screen said so.
//
// THE TWO HALVES, and the constraint that makes them two rather than one:
//
//  1. ASKING. `recovery` is null (or 'expired'), so this is a person who cannot
//     get in. They type the identifier they sign in with, and the answer branches
//     on the same '@' that store/auth.signInPassword() branches on:
//       a real address → Supabase mails a recovery link. "Check your email."
//       a username     → NOTHING IS SENT, and the screen says so. These accounts
//         authenticate against `<name>@opstrack.internal`, which RFC 6761
//         guarantees can never receive mail; resetPasswordForEmail() against one
//         returns success and delivers nothing. Their recovery is an admin
//         reissuing the invite code (api/members.reissueInvite → the
//         `reissue-code` action) and the member re-claiming at /claim. That path
//         has existed since Wave 1 and was simply invisible. The three steps are
//         named here because "ask your admin" without them is a shrug.
//
//  2. SETTING. `recovery` is 'active': the link was opened, supabase-js adopted
//     the session it carried, and store/auth.ts is deliberately WITHHOLDING that
//     session from the UI so that App.tsx keeps rendering the signed-out tree
//     and this screen survives long enough to be used. One field, then
//     updateUser(), then the app.
//
// ONE PASSWORD FIELD WITH A REVEAL, WHERE /claim USES TWO. The argument is not
// symmetry, it is what each screen can afford to get wrong. A confirm field
// defends against a typo you cannot see; a reveal defends against the same typo
// by letting you read it, and NIST 800-63B §5.1.1.2 explicitly allows dropping
// the confirmation when the value can be displayed. /claim keeps two because the
// member is typing a password beside a one-time invite code they may not be able
// to get a second copy of quickly. Here the second copy is an EMAIL, and this
// project's free-tier SMTP allows a handful of those per hour workspace-wide —
// so the screen buys certainty the cheap way, with a control that shows the
// exact string, rather than by asking for the same long password twice on a
// phone keyboard and hoping the two typos differ.
//
// WHAT IS NEVER RENDERED, LOGGED OR TOASTED: the password, the recovery link,
// and any token from it. store/auth.ts logs failure CODES only, exactly as the
// claim path does with its invite.
//
// The floor is MIN_PASSWORD_LENGTH, imported from the store. The number is not
// restated here or in the copy — `claim.passwordHint` interpolates it.

import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent, type ReactElement } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { isConfigured } from '../api/supabase'
import { IconArrowStart, IconKey, IconMail, IconRing, IconShieldCheck, IconUser } from '../components/icons'
import { toast } from '../components/toast'
import { t, useLocale } from '../lib/i18n'
import {
  MIN_PASSWORD_LENGTH,
  cancelRecovery,
  requestPasswordReset,
  updatePassword,
  useAuth,
} from '../store/auth'
import { setLocaleSetting } from '../store/settings'
import './reset.css'

// Deliberately loose, and the same expression SignIn.tsx uses: the authoritative
// check is Supabase's, and a strict client pattern only ever rejects addresses
// that are in fact valid.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** Which panel is on screen. 'ask' is the entry state for a reader with no link. */
type Step = 'ask' | 'sent' | 'noMailbox'

export default function ResetPassword(): ReactElement {
  const locale = useLocale()
  const configured = isConfigured()
  const { recovery } = useAuth()
  const navigate = useNavigate()

  const [identifier, setIdentifier] = useState('')
  const [password, setPassword] = useState('')
  const [revealed, setRevealed] = useState(false)
  const [capsOn, setCapsOn] = useState(false)
  const [step, setStep] = useState<Step>('ask')
  // The address the mail actually went to, kept apart from `identifier` so the
  // panel cannot be made to name somewhere the link was not sent.
  const [target, setTarget] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const identifierRef = useRef<HTMLInputElement>(null)
  const passwordRef = useRef<HTMLInputElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  const setting = recovery === 'active'

  // This route renders outside the shell, so nothing else sets the title. Keyed
  // on `locale` for the reason SignIn's twin gives: the language toggle is on
  // this very screen, so an empty dep array leaves the tab in the language the
  // reader just switched away from.
  useEffect(() => {
    document.title = `${t(setting ? 'signin.resetTitle' : 'signin.forgotTitle')} · ${t('app.name')}`
  }, [locale, setting])

  // Focus follows the step. An answer panel takes focus itself rather than
  // handing it to a button: the panel IS the answer, and it is marked
  // role="status" so it is read on arrival. Everything else puts the caret in
  // the field the reader has to fill.
  useEffect(() => {
    if (!configured) return
    if (step !== 'ask') panelRef.current?.focus()
    else if (setting) passwordRef.current?.focus()
    else identifierRef.current?.focus()
  }, [configured, step, setting])

  /** Caps Lock is the single most common cause of a password that "won't take". */
  function trackCaps(e: KeyboardEvent<HTMLInputElement>): void {
    setCapsOn(e.getModifierState('CapsLock'))
  }

  async function submitRequest(e: FormEvent): Promise<void> {
    e.preventDefault()
    if (busy) return
    const id = identifier.trim()
    // The two checks the store cannot make: an empty field, and a string with an
    // '@' in it that is not an address — which would otherwise cost a round trip
    // AND a slice of an hourly mail budget the whole workspace shares.
    if (!id) {
      setError(t('signin.errIdentifierRequired'))
      identifierRef.current?.focus()
      return
    }
    if (id.includes('@') && !EMAIL_RE.test(id)) {
      setError(t('signin.errEmailInvalid'))
      identifierRef.current?.focus()
      return
    }
    setBusy(true)
    setError(null)
    const result = await requestPasswordReset(id)
    setBusy(false)
    if (result.kind === 'error') {
      setError(result.message)
      return
    }
    if (result.kind === 'noMailbox') {
      // No request left the browser and none will: the branch is decided from
      // the identifier alone. A spinner that resolved into silence here would be
      // worse than the dead end this replaces.
      setIdentifier(result.username)
      setStep('noMailbox')
      return
    }
    setTarget(result.email)
    setStep('sent')
  }

  async function submitPassword(e: FormEvent): Promise<void> {
    e.preventDefault()
    if (busy) return
    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(t('signin.errPasswordShort', { min: MIN_PASSWORD_LENGTH }))
      passwordRef.current?.focus()
      return
    }
    setBusy(true)
    setError(null)
    const message = await updatePassword(password)
    setBusy(false)
    if (message) {
      setError(message)
      passwordRef.current?.focus()
      return
    }
    // The store has published the session, so App.tsx is already swapping this
    // route out for the app. The toast is the only confirmation that survives
    // that swap — and it says what changed, never what it changed to.
    toast(t('signin.resetDone'))
  }

  /**
   * Give the link's session back and go to the form.
   *
   * BOTH HALVES ARE NECESSARY. Signing out alone would leave this screen
   * standing, silently switching from "choose a new password" to "ask for a
   * link" under the reader's hands; navigating alone would leave a standing key
   * to this account in localStorage, and /signin would forward straight back
   * here because the recovery is still live.
   */
  async function abandon(): Promise<void> {
    if (busy) return
    setBusy(true)
    await cancelRecovery()
    setBusy(false)
    navigate('/signin', { replace: true })
  }

  const errorNode = error ? (
    <p className="field-error rst-error" id="rst-error" role="alert">
      {error}
    </p>
  ) : null

  return (
    <main className="rst">
      <div className="card rst-card">
        <div className="rst-brand">
          <span className="rst-mark" aria-hidden="true">
            <IconRing size={16} />
          </span>
          <span className="rst-brand-name">{t('app.name')}</span>
          {/* Same argument SignIn and Claim make for carrying a language control
              on a pre-auth screen: the header's toggle lives inside the shell,
              and nobody on this screen has reached it. A reader who is locked
              out is the last person who should also be stuck in the wrong
              language. */}
          <button
            type="button"
            className="btn btn-ghost btn-sm rst-lang"
            lang={locale === 'en' ? 'ar' : 'en'}
            aria-label={t('common.toggleLanguage')}
            onClick={() => setLocaleSetting(locale === 'en' ? 'ar' : 'en')}
          >
            {locale === 'en' ? t('settings.languageAr') : t('settings.languageEn')}
          </button>
        </div>

        {!configured ? (
          <div className="rst-notice" role="status">
            <p className="rst-notice-title">{t('settings.backendNotConfigured')}</p>
            <p className="rst-notice-body">{t('signin.notConfigured')}</p>
          </div>
        ) : setting ? (
          /* ── half two: the link was opened, set the password ── */
          <form className="rst-form" onSubmit={(e) => void submitPassword(e)} noValidate>
            <h2 className="rst-title">{t('signin.resetTitle')}</h2>
            <p className="rst-sub">{t('signin.resetSub')}</p>

            <div className="field rst-field-block">
              <label className="field-label" htmlFor="rst-password">
                {t('signin.newPasswordLabel')}
              </label>
              <div className="rst-field">
                <IconKey className="rst-field-icon" size={18} />
                <input
                  ref={passwordRef}
                  id="rst-password"
                  className="input rst-input rst-input-secret"
                  type={revealed ? 'text' : 'password'}
                  autoComplete="new-password"
                  autoCapitalize="off"
                  autoCorrect="off"
                  spellCheck={false}
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value)
                    setError(null)
                  }}
                  onKeyUp={trackCaps}
                  onKeyDown={trackCaps}
                  onBlur={() => setCapsOn(false)}
                  aria-describedby={error ? 'rst-error' : 'rst-password-hint'}
                  aria-invalid={error ? true : undefined}
                />
                {/* A word rather than an eye glyph, for the reason SignIn gives:
                    components/icons.tsx is closed, and "Show"/"Hide" states the
                    effect without needing a label read out separately. This
                    control is doing the job /claim's confirm field does, so it
                    is not decoration — see the header. */}
                <button
                  type="button"
                  className="rst-reveal tap-44"
                  aria-pressed={revealed}
                  aria-controls="rst-password"
                  onClick={() => setRevealed((v) => !v)}
                >
                  {revealed ? t('signin.hidePassword') : t('signin.showPassword')}
                </button>
              </div>
              <p className="rst-hint" id="rst-password-hint">
                {t('claim.passwordHint', { min: MIN_PASSWORD_LENGTH })}
              </p>
              {capsOn ? (
                <p className="rst-caps" role="status">
                  {t('signin.capsLock')}
                </p>
              ) : null}
            </div>

            {errorNode}

            <button type="submit" className="btn btn-primary btn-block rst-submit" disabled={busy}>
              {busy ? t('signin.resetSubmitting') : t('signin.resetSubmit')}
            </button>

            <div className="rst-sep" role="presentation" />

            {/* The way out of a recovery nobody wanted. It signs the link's
                session out rather than merely navigating, because /signin
                forwards back here for as long as that session is live — and a
                standing key to this account has no reason to sit in localStorage
                once its one job has been declined. */}
            <button
              type="button"
              className="rst-link"
              disabled={busy}
              onClick={() => void abandon()}
            >
              {/* icon-directional: this arrow points at the inline start, so it
                  mirrors in Arabic. */}
              <IconArrowStart className="icon-directional" size={16} />
              {t('signin.backToSignIn')}
            </button>
          </form>
        ) : step === 'ask' ? (
          /* ── half one: ask for it ── */
          <form className="rst-form" onSubmit={(e) => void submitRequest(e)} noValidate>
            <h2 className="rst-title">{t('signin.forgotTitle')}</h2>
            <p className="rst-sub">{t('signin.forgotSub')}</p>

            {recovery === 'expired' ? (
              <p className="rst-note" role="status">
                {t('signin.linkDead')}
              </p>
            ) : null}

            <div className="field rst-field-block">
              <label className="field-label" htmlFor="rst-identifier">
                {t('signin.identifierLabel')}
              </label>
              <div className="rst-field">
                {/* The glyph tracks what has been typed, exactly as it does on
                    the sign-in form: it is the only visible sign that this one
                    field is serving two kinds of account with two recoveries. */}
                {identifier.includes('@') ? (
                  <IconMail className="rst-field-icon" size={18} />
                ) : (
                  <IconUser className="rst-field-icon" size={18} />
                )}
                <input
                  ref={identifierRef}
                  id="rst-identifier"
                  className="input rst-input"
                  type="text"
                  // Not type="email": this field takes a username too, and the
                  // browser's built-in validation would reject one.
                  inputMode={identifier.includes('@') ? 'email' : 'text'}
                  autoComplete="username"
                  autoCapitalize="off"
                  autoCorrect="off"
                  spellCheck={false}
                  placeholder={t('signin.identifierPlaceholder')}
                  value={identifier}
                  onChange={(e) => {
                    setIdentifier(e.target.value)
                    setError(null)
                  }}
                  aria-describedby={error ? 'rst-error' : 'rst-identifier-hint'}
                  aria-invalid={error ? true : undefined}
                />
              </div>
              <p className="rst-hint" id="rst-identifier-hint">
                {t('signin.identifierHint')}
              </p>
            </div>

            {errorNode}

            <button type="submit" className="btn btn-primary btn-block rst-submit" disabled={busy}>
              {busy ? t('signin.sending') : t('signin.sendReset')}
            </button>

            <div className="rst-sep" role="presentation" />

            <Link className="rst-link" to="/signin">
              <IconArrowStart className="icon-directional" size={16} />
              {t('signin.backToSignIn')}
            </Link>
          </form>
        ) : (
          /* ── the two answers ── */
          <div className="rst-panel" ref={panelRef} tabIndex={-1} role="status" aria-live="polite">
            <span className="rst-panel-mark" aria-hidden="true">
              {step === 'sent' ? <IconMail size={22} /> : <IconShieldCheck size={22} />}
            </span>

            {step === 'sent' ? (
              <>
                <h2 className="rst-title">{t('signin.linkHeading')}</h2>
                <p className="rst-sub">{t('signin.resetSent', { email: target })}</p>
                <p className="rst-note">{t('signin.resetSentHint')}</p>
              </>
            ) : (
              <>
                <h2 className="rst-title">{t('signin.noMailboxHeading')}</h2>
                <p className="rst-sub">{t('signin.noMailboxBody', { username: identifier })}</p>
                {/* The steps, named. An <ol> rather than three paragraphs
                    because they are ordered and the second cannot happen before
                    the first — and because a screen reader announces "list, 3
                    items", which is the shape of the answer. */}
                <ol className="rst-steps">
                  <li className="rst-step">{t('signin.noMailboxStep1')}</li>
                  <li className="rst-step">{t('signin.noMailboxStep2')}</li>
                  <li className="rst-step">{t('signin.noMailboxStep3')}</li>
                </ol>
                <Link className="btn btn-block rst-claim" to="/claim">
                  {t('claim.title')}
                </Link>
              </>
            )}

            <div className="rst-sep" role="presentation" />

            <Link className="rst-link" to="/signin">
              <IconArrowStart className="icon-directional" size={16} />
              {t('signin.backToSignIn')}
            </Link>
          </div>
        )}
      </div>
    </main>
  )
}
