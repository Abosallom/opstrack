// First registration for a predefined username account: /claim.
//
// An admin creates the username and hands over a one-time invite code in
// person; this screen exchanges that code for a password the member chooses and
// signs them straight in. It is reached from the sign-in form's "First time
// here? Claim your account", and it is the ONLY route to a working password for
// an account that has never had one — including after a reset, which is an
// admin reissuing a code rather than a "check your inbox" screen for an inbox
// that cannot exist (@opstrack.internal is RFC 6761 reserved).
//
// WHAT THIS FILE OWNS AND WHAT IT DOES NOT. `store/auth.claimAccount()` owns
// the round trip, the single-use guarantee, the mapping from the edge
// function's failure codes to sentences, and the sign-in that follows a
// successful claim (WAVE1-ADDENDUM §2.4). This screen owns only the four
// checks that never need to leave the browser — a missing username, a missing
// code, a password under the floor, and two passwords that disagree — because
// each of those costs a round trip AND a slice of the invite's per-account
// failure budget, and the fourth one the server cannot see at all.
//
// The strength meter is ADVISORY. The only rule anyone enforces is length:
// MIN_PASSWORD_LENGTH here, the same number in the edge function. The meter
// exists because "at least 8 characters" alone teaches people to type exactly
// eight.
//
// NO SUCCESS PANEL. claimAccount() ends by signing the member in, so a
// successful claim publishes a session and App swaps this route out mid-render.
// `claim.success`, `claim.successHint` and `claim.goToSignIn` are therefore
// unused today; they are kept at parity for the Wave-4 Members screen, which
// verifies a code on a member's behalf and does need a terminal state.

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
import { IconArrowStart, IconBolt, IconKey, IconShieldCheck, IconUser } from '../components/icons'
import { t, useLocale } from '../lib/i18n'
import { MIN_PASSWORD_LENGTH, claimAccount } from '../store/auth'
import { setLocaleSetting } from '../store/settings'
import './claim.css'

/** `admin-members` mints 8 characters from a 32-symbol alphabet, shown XXXX-XXXX. */
const INVITE_LENGTH = 8

type Field = 'username' | 'invite' | 'password' | 'confirm' | null

/**
 * Type the code the way it was written down.
 *
 * The edge function normalizes with the same two rules (upper-case, drop
 * everything outside A–Z0–9) before hashing, so nothing here can make a valid
 * code invalid — this only spares the member the shift key and the hyphen.
 *
 * Exported for Claim.test.tsx. The pairing with `normalizeCode()` in
 * supabase/functions/claim-account is the whole reason the hyphen this function
 * inserts is safe to send, and that pairing is worth a test that fails if
 * either side drifts.
 */
export function formatInvite(raw: string): string {
  const clean = raw
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, INVITE_LENGTH)
  return clean.length > 4 ? `${clean.slice(0, 4)}-${clean.slice(4)}` : clean
}

/**
 * 0 = too short to score, 1 = weak, 2 = fair, 3 = strong.
 *
 * Length is weighted far above composition on purpose: a 16-character
 * passphrase beats "P@ssw0rd" by every measure that matters, and a meter that
 * says otherwise trains the wrong habit. The character-class count is a
 * tie-breaker, not a requirement — and it is Latin-centric by construction, so
 * an Arabic passphrase scores on length alone. That is the correct outcome
 * (nothing is rejected for it) and it is why the meter is advisory.
 *
 * Exported for Claim.test.tsx — the thresholds below are the only place the
 * "long beats clever" policy is actually written down in code.
 */
export function strengthOf(password: string): 0 | 1 | 2 | 3 {
  if (password.length < MIN_PASSWORD_LENGTH) return 0
  let classes = 0
  if (/[a-z]/.test(password)) classes += 1
  if (/[A-Z]/.test(password)) classes += 1
  if (/\d/.test(password)) classes += 1
  if (/[^A-Za-z0-9]/.test(password)) classes += 1
  if (password.length >= 16 || (password.length >= 12 && classes >= 3)) return 3
  if (password.length >= 12 || classes >= 3) return 2
  return 1
}

const STRENGTH_KEY: Record<1 | 2 | 3, string> = {
  1: 'claim.strengthWeak',
  2: 'claim.strengthFair',
  3: 'claim.strengthStrong',
}

/** One bar per strength step. A literal so the meter cannot drift from the scale. */
const METER_STEPS: readonly (1 | 2 | 3)[] = [1, 2, 3]

export default function Claim(): ReactElement {
  const locale = useLocale()
  const configured = isConfigured()

  const [username, setUsername] = useState('')
  const [invite, setInvite] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [revealed, setRevealed] = useState(false)
  const [capsOn, setCapsOn] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [errorField, setErrorField] = useState<Field>(null)
  const [busy, setBusy] = useState(false)

  const usernameRef = useRef<HTMLInputElement>(null)
  const inviteRef = useRef<HTMLInputElement>(null)
  const passwordRef = useRef<HTMLInputElement>(null)
  const confirmRef = useRef<HTMLInputElement>(null)

  const strength = strengthOf(password)
  // Only once both are non-empty: an empty confirm field is not a mismatch, it
  // is an unanswered question, and flagging it red as the member tabs into it
  // is the classic form that shouts before it has been given a chance.
  const mismatch = confirm.length > 0 && password !== confirm
  const matched = confirm.length > 0 && password === confirm

  // This route renders outside the shell, so nothing else sets the title.
  //
  // Keyed on `locale` for the reason SignIn's twin gives: the language toggle
  // sits on this very screen, so an empty dep array leaves the browser tab in
  // the language the member just switched away from.
  useEffect(() => {
    document.title = `${t('claim.title')} · ${t('app.name')}`
  }, [locale])

  useEffect(() => {
    if (configured) usernameRef.current?.focus()
  }, [configured])

  function clearError(): void {
    setError(null)
    setErrorField(null)
  }

  function trackCaps(e: KeyboardEvent<HTMLInputElement>): void {
    setCapsOn(e.getModifierState('CapsLock'))
  }

  /** Report, point at the control that can fix it, and put the caret there. */
  function fail(message: string, field: Field, target: HTMLInputElement | null): boolean {
    setError(message)
    setErrorField(field)
    target?.focus()
    return false
  }

  function validate(): boolean {
    if (!username.trim()) {
      return fail(t('claim.errUsernameRequired'), 'username', usernameRef.current)
    }
    if (!invite.trim()) {
      return fail(t('claim.errInviteRequired'), 'invite', inviteRef.current)
    }
    if (!password) {
      return fail(t('claim.errPasswordRequired'), 'password', passwordRef.current)
    }
    if (password.length < MIN_PASSWORD_LENGTH) {
      return fail(
        t('claim.errPasswordShort', { min: MIN_PASSWORD_LENGTH }),
        'password',
        passwordRef.current,
      )
    }
    if (password !== confirm) {
      return fail(t('claim.errPasswordMismatch'), 'confirm', confirmRef.current)
    }
    return true
  }

  async function submit(e: FormEvent): Promise<void> {
    e.preventDefault()
    if (busy) return
    clearError()
    if (!validate()) return

    setBusy(true)
    const message = await claimAccount({ username, inviteCode: invite, password })
    setBusy(false)
    // No success branch: claimAccount() signs the member in, the auth store
    // publishes a session, and App swaps this route out from under us.
    if (!message) return
    // The store's sentence, unqualified — it cannot tell us which field was
    // wrong, and guessing would point at the wrong one. "Already claimed it?
    // Sign in" stays below as the recovery path, which is also what rescues the
    // narrow case where the claim landed but the sign-in behind it was rate
    // limited: the password is set, so signing in is all that is left to do.
    setError(message)
    setErrorField(null)
  }

  const errorNode = error ? (
    <p className="field-error claim-error" id="claim-error" role="alert">
      {error}
    </p>
  ) : null

  return (
    <main className="claim">
      <div className="card claim-card">
        <div className="claim-brand">
          <span className="claim-mark" aria-hidden="true">
            <IconBolt size={16} />
          </span>
          <span className="claim-brand-name">{t('app.name')}</span>
          {/* The only language control before sign-in — the header's toggle
              lives inside the shell, which nobody on this screen has reached
              yet. A member claiming an account is the single most likely person
              to need the other language, since this is the first CoreTrack
              screen they have ever seen. */}
          <button
            type="button"
            className="btn btn-ghost btn-sm claim-lang"
            lang={locale === 'en' ? 'ar' : 'en'}
            aria-label={t('common.toggleLanguage')}
            onClick={() => setLocaleSetting(locale === 'en' ? 'ar' : 'en')}
          >
            {locale === 'en' ? t('settings.languageAr') : t('settings.languageEn')}
          </button>
        </div>

        {!configured ? (
          <div className="claim-notice" role="status">
            <p className="claim-notice-title">{t('settings.backendNotConfigured')}</p>
            <p className="claim-notice-body">{t('claim.notConfigured')}</p>
          </div>
        ) : (
          <form className="claim-form" onSubmit={(e) => void submit(e)} noValidate>
            <h2 className="claim-title">{t('claim.title')}</h2>
            <p className="claim-sub">{t('claim.subtitle')}</p>

            <div className="claim-fields">
              <div className="field">
                <label className="field-label" htmlFor="claim-username">
                  {t('claim.username')}
                </label>
                <div className="claim-field">
                  <IconUser className="claim-field-icon" size={18} />
                  <input
                    ref={usernameRef}
                    id="claim-username"
                    className="input claim-input"
                    type="text"
                    autoComplete="username"
                    autoCapitalize="off"
                    autoCorrect="off"
                    spellCheck={false}
                    placeholder={t('claim.usernamePlaceholder')}
                    value={username}
                    onChange={(e) => {
                      setUsername(e.target.value)
                      clearError()
                    }}
                    aria-describedby={
                      errorField === 'username' ? 'claim-error' : 'claim-username-hint'
                    }
                    aria-invalid={errorField === 'username' ? true : undefined}
                  />
                </div>
                <p className="claim-hint" id="claim-username-hint">
                  {t('claim.usernameHint')}
                </p>
              </div>

              <div className="field">
                <label className="field-label" htmlFor="claim-invite">
                  {t('claim.inviteCode')}
                </label>
                <div className="claim-field">
                  <IconShieldCheck className="claim-field-icon" size={18} />
                  <input
                    ref={inviteRef}
                    id="claim-invite"
                    className="input claim-input claim-invite-input"
                    type="text"
                    // The alphabet excludes I, O, 0 and 1, so there is nothing
                    // for autocorrect to "fix" and everything for it to break.
                    autoComplete="off"
                    autoCapitalize="characters"
                    autoCorrect="off"
                    spellCheck={false}
                    maxLength={INVITE_LENGTH + 1}
                    placeholder={t('claim.invitePlaceholder')}
                    value={invite}
                    onChange={(e) => {
                      setInvite(formatInvite(e.target.value))
                      clearError()
                    }}
                    aria-describedby={errorField === 'invite' ? 'claim-error' : 'claim-invite-hint'}
                    aria-invalid={errorField === 'invite' ? true : undefined}
                  />
                </div>
                <p className="claim-hint" id="claim-invite-hint">
                  {t('claim.inviteHint')}
                </p>
              </div>

              <div className="field">
                <label className="field-label" htmlFor="claim-password">
                  {t('claim.password')}
                </label>
                <div className="claim-field">
                  <IconKey className="claim-field-icon" size={18} />
                  <input
                    ref={passwordRef}
                    id="claim-password"
                    className="input claim-input claim-input-secret"
                    type={revealed ? 'text' : 'password'}
                    autoComplete="new-password"
                    autoCapitalize="off"
                    autoCorrect="off"
                    spellCheck={false}
                    value={password}
                    onChange={(e) => {
                      setPassword(e.target.value)
                      clearError()
                    }}
                    onKeyUp={trackCaps}
                    onKeyDown={trackCaps}
                    onBlur={() => setCapsOn(false)}
                    aria-describedby={
                      errorField === 'password' ? 'claim-error' : 'claim-password-hint'
                    }
                    aria-invalid={errorField === 'password' ? true : undefined}
                  />
                  {/* One toggle for both password fields: they are meant to hold
                      the same value, so revealing one and not the other would
                      defeat the point of the second field. */}
                  <button
                    type="button"
                    className="claim-reveal tap-44"
                    aria-pressed={revealed}
                    onClick={() => setRevealed((v) => !v)}
                  >
                    {revealed ? t('claim.hidePassword') : t('claim.showPassword')}
                  </button>
                </div>

                {/* The meter is decoration; the sentence beside it carries the
                    meaning, which is why the bars are aria-hidden and the label
                    is a live region rather than a colour change. */}
                <div className="claim-strength">
                  <div className="claim-meter" aria-hidden="true">
                    {/* Every filled bar takes the CURRENT tone, so the row reads
                        as one signal rather than a red-amber-green rainbow. */}
                    {METER_STEPS.map((step) => (
                      <span
                        key={step}
                        className={`claim-meter-bar${strength >= step ? ` s${strength}` : ''}`}
                      />
                    ))}
                  </div>
                  <p className="claim-strength-label" role="status">
                    {strength === 0
                      ? t('claim.strengthLabel')
                      : `${t('claim.strengthLabel')}: ${t(STRENGTH_KEY[strength])}`}
                  </p>
                </div>

                <p className="claim-hint" id="claim-password-hint">
                  {t('claim.passwordHint', { min: MIN_PASSWORD_LENGTH })}
                </p>

                {capsOn ? (
                  <p className="claim-caps" role="status">
                    {t('claim.capsLock')}
                  </p>
                ) : null}
              </div>

              <div className="field">
                <label className="field-label" htmlFor="claim-confirm">
                  {t('claim.confirmPassword')}
                </label>
                <div className="claim-field">
                  <IconKey className="claim-field-icon" size={18} />
                  <input
                    ref={confirmRef}
                    id="claim-confirm"
                    className="input claim-input"
                    type={revealed ? 'text' : 'password'}
                    autoComplete="new-password"
                    autoCapitalize="off"
                    autoCorrect="off"
                    spellCheck={false}
                    value={confirm}
                    onChange={(e) => {
                      setConfirm(e.target.value)
                      clearError()
                    }}
                    onKeyUp={trackCaps}
                    onKeyDown={trackCaps}
                    onBlur={() => setCapsOn(false)}
                    aria-describedby={
                      errorField === 'confirm' ? 'claim-error' : 'claim-confirm-status'
                    }
                    aria-invalid={errorField === 'confirm' || mismatch ? true : undefined}
                  />
                </div>
                {/* Answered live, in both directions. A confirm field that only
                    ever speaks up on submit makes the member retype two long
                    passwords to find a typo in one of them. */}
                <p
                  className={`claim-match${matched ? ' ok' : ''}${mismatch ? ' bad' : ''}`}
                  id="claim-confirm-status"
                  role="status"
                >
                  {matched ? t('claim.matchOk') : mismatch ? t('claim.errPasswordMismatch') : ''}
                </p>
              </div>
            </div>

            {errorNode}

            <button type="submit" className="btn btn-primary btn-block claim-submit" disabled={busy}>
              {busy ? t('claim.submitting') : t('claim.submit')}
            </button>

            <div className="claim-sep" role="presentation" />

            <Link className="claim-link" to="/signin">
              {/* icon-directional: this arrow points back toward the inline
                  start, so it has to mirror in Arabic. */}
              <IconArrowStart className="icon-directional" size={16} />
              {t('claim.haveAccount')}
            </Link>

            <p className="claim-foot">{t('claim.noCode')}</p>
          </form>
        )}
      </div>
    </main>
  )
}
