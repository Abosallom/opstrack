// Push notifications (/settings/notifications) — the only screen that can turn
// them on, and the only one that can turn them off.
//
// THE PERMISSION FLOW IS EXPLAIN-FIRST, AND THAT IS THE WHOLE DESIGN OF THIS
// PAGE. Nothing here calls `Notification.requestPermission()` until the user
// presses a button whose label says what will happen, sitting under three lines
// that say what will be sent and when. The reason is not manners: a browser
// permission prompt is answered ONCE and the answer is final — a `denied` cannot
// be re-asked by this app in any browser, ever, and the only cure is the user
// finding the site settings themselves. So the cheap moment (reading a card) has
// to come before the expensive one (the OS dialog). A prompt on mount, or on a
// toggle whose label is just "Push notifications", spends the single most
// unrecoverable interaction in the product on a user who did not know it was
// coming.
//
// EVERY BRANCH IS A REAL SCREEN, not a disabled control. `verdictFor()` in
// lib/push.ts resolves to one of four states and each gets its own card:
//   ready        → the explainer + Enable, or the status + Disable
//   needsInstall → iOS Safari, with the three taps that fix it
//   blocked      → what the browser did and where to undo it
//   unsupported  → what is missing, and what still works without it
// A greyed-out switch would say none of that, and "nothing happens when I tap
// it" is the report that follows.
//
// THE INBOX IS THE FALLBACK AND IT IS STATED TWICE. Push is an accelerator for
// notifications that already exist as rows; if any of this is unavailable the
// bell still fills. Saying so is what keeps an unsupported browser from reading
// as a broken feature.

import { useEffect, useId, useState, type ReactElement } from 'react'
import { Link } from 'react-router-dom'
import { confirm } from '../../components/Confirm'
import { IconArrowStart, IconMonitor, IconShieldCheck } from '../../components/icons'
import { IconBell } from '../../components/NotificationBell'
import { Skeleton } from '../../components/shared'
import { toast } from '../../components/toast'
import { formatDate, instantToIsoDate } from '../../lib/dates'
import { t, useLocale } from '../../lib/i18n'
import {
  disablePushOnThisDevice,
  enablePushOnThisDevice,
  loadPushState,
  removePushDevice,
  setPushPref,
  usePushBusy,
  usePushDevices,
  usePushError,
  usePushLoading,
  usePushPrefs,
  usePushVerdict,
  useThisDeviceSubscribed,
  type PushPrefs,
} from '../../store/push'
import './push.css'

/**
 * A `role="switch"` row over global.css's `.switch` primitive.
 *
 * Same construction as the digest screen's toggle and for the same reasons: the
 * whole row is the control so the label is part of the 44px target, and
 * `aria-checked` is repeated on the visual span because that attribute IS the
 * primitive's styling contract — `push.css` owns `.push-*` and may not restyle
 * another sheet's class. The span is `aria-hidden`, so only the button is
 * announced.
 */
function Toggle({
  label,
  hint,
  checked,
  disabled,
  onChange,
}: {
  label: string
  hint: string
  checked: boolean
  disabled: boolean
  onChange: (next: boolean) => void
}): ReactElement {
  const hintId = useId()
  return (
    <button
      type="button"
      className="push-toggle"
      role="switch"
      aria-checked={checked}
      aria-describedby={hintId}
      disabled={disabled}
      onClick={() => onChange(!checked)}
    >
      <span className="push-toggle-text">
        <span className="push-toggle-label">{label}</span>
        <span className="push-note" id={hintId}>
          {hint}
        </span>
      </span>
      <span className="switch" aria-hidden="true" aria-checked={checked} />
    </button>
  )
}

/** One titled card. Local rather than imported so this sheet owns its spacing. */
function Card({
  title,
  children,
  tone,
}: {
  title: string
  children: ReactElement | ReactElement[]
  tone?: 'warn'
}): ReactElement {
  return (
    <section className={`card push-card${tone ? ` push-card-${tone}` : ''}`}>
      <h2 className="push-card-title">{title}</h2>
      {children}
    </section>
  )
}

export default function NotificationPrefs(): ReactElement {
  const locale = useLocale()
  const verdict = usePushVerdict()
  const subscribed = useThisDeviceSubscribed()
  const devices = usePushDevices()
  const prefs = usePushPrefs()
  const loading = usePushLoading()
  const busy = usePushBusy()
  const errorKey = usePushError()
  // Announced through role="status" below rather than as a toast: the user is
  // looking at the control that changed, and a toast would cover the tab bar.
  const [live, setLive] = useState('')

  // A READ, NEVER A PROMPT. loadPushState() inspects the browser, reads the
  // device list and repairs a rotated subscription; the OS dialog is only
  // reachable from the Enable button below.
  useEffect(() => {
    void loadPushState()
  }, [])

  async function onEnable(): Promise<void> {
    const failure = await enablePushOnThisDevice()
    if (!failure) {
      setLive(t('push.enabled'))
      toast(t('push.enabled'))
    }
  }

  async function onDisable(): Promise<void> {
    const failure = await disablePushOnThisDevice()
    if (!failure) {
      setLive(t('push.disabled'))
      toast(t('push.disabled'))
    }
  }

  async function onRemove(id: string, label: string): Promise<void> {
    // A destructive act on a device the user may not be holding, so it is
    // confirmed — the hard rule, and the honest reading of "remove".
    const ok = await confirm({
      // Named, because the user may be removing a device they are not holding —
      // "Remove iPhone?" is answerable and "Remove this device?" is not.
      title: t('push.removeTitle', { name: label }),
      body: t('push.removeBody'),
      confirmLabel: t('push.remove'),
      cancelLabel: t('common.cancel'),
      danger: true,
    })
    if (!ok) return
    const failure = await removePushDevice(id)
    if (!failure) {
      setLive(t('push.removed'))
      toast(t('push.removed'))
    }
  }

  function onPref(key: keyof PushPrefs, value: boolean): void {
    void setPushPref(key, value)
  }

  return (
    <div className="push">
      <div className="push-bar">
        <Link to="/settings" className="btn btn-ghost btn-sm">
          {/* A back arrow points at the reading start, so it mirrors in Arabic. */}
          <IconArrowStart className="icon-directional" size={16} />
          {t('common.back')}
        </Link>
      </div>

      {/* No page heading: App.tsx's header renders this route's title as the
          document h1, and a second copy is noise in the outline. */}
      <div className="push-intro">
        <p className="push-lead">{t('push.subtitle')}</p>
        <p className="push-note">{t('push.inboxNote')}</p>
      </div>

      <p className="sr-only" role="status" aria-live="polite">
        {live}
      </p>

      {loading && devices.length === 0 ? <Skeleton height={120} count={2} /> : null}

      {verdict === 'ready' && !subscribed ? (
        <Card title={t('push.explainTitle')}>
          {/* The current state, said out loud. Without it the card explains what
              turning push on would do and never confirms that it is off — which
              is the question a user arriving here from a missed notification
              actually has. */}
          <p className="push-status">
            <span className="pill">{t('push.statusOff')}</span>
          </p>
          <p className="push-body">{t('push.explainBody')}</p>
          {/* A list, because these are the two things that will interrupt the
              user and each one is a separate promise. */}
          <ul className="push-list">
            <li>{t('push.explainAssigned')}</li>
            <li>{t('push.explainCompleted')}</li>
          </ul>
          <p className="push-note">{t('push.explainPrivacy')}</p>
          <button
            type="button"
            className="btn btn-primary push-action"
            disabled={busy}
            onClick={() => void onEnable()}
          >
            <IconBell size={18} />
            {busy ? t('push.enabling') : t('push.enable')}
          </button>
        </Card>
      ) : null}

      {verdict === 'ready' && subscribed ? (
        <Card title={t('push.title')}>
          <p className="push-status">
            <span className="pill ok">{t('push.statusOn')}</span>
          </p>
          <p className="push-note">{t('push.explainPrivacy')}</p>
          <button
            type="button"
            className="btn push-action"
            disabled={busy}
            onClick={() => void onDisable()}
          >
            {busy ? t('push.disabling') : t('push.disable')}
          </button>
        </Card>
      ) : null}

      {verdict === 'needsInstall' ? (
        <Card title={t('push.iosTitle')} tone="warn">
          <p className="push-body">{t('push.iosBody')}</p>
          {/* Ordered: these are three steps in sequence, and the numbers are the
              instruction. `push-steps` only sets spacing — the markers are the
              browser's, so they localise and mirror on their own. */}
          <ol className="push-steps">
            <li>{t('push.iosStep1')}</li>
            <li>{t('push.iosStep2')}</li>
            <li>{t('push.iosStep3')}</li>
          </ol>
        </Card>
      ) : null}

      {verdict === 'blocked' ? (
        <Card title={t('push.blockedTitle')} tone="warn">
          <p className="push-body">{t('push.blockedBody')}</p>
        </Card>
      ) : null}

      {verdict === 'unsupported' ? (
        <Card title={t('push.unsupportedTitle')}>
          <p className="push-body">{t('push.unsupportedBody')}</p>
        </Card>
      ) : null}

      {errorKey ? (
        <p className="field-error push-error" role="alert">
          {t(errorKey)}
        </p>
      ) : null}

      {/* The preference switches exist only once SOMETHING is registered.
          Rendering them for a user with no devices would be three controls
          governing nothing — and on an unsupported browser, three controls that
          can never govern anything. */}
      {devices.length > 0 ? (
        <>
          <Card title={t('push.kinds')}>
            <p className="push-note">{t('push.kindsHint')}</p>
            <div className="push-toggles">
              <Toggle
                label={t('push.master')}
                hint={t('push.masterHint')}
                checked={prefs.enabled}
                disabled={busy}
                onChange={(next) => onPref('enabled', next)}
              />
              {/* Indented under the master switch and disabled with it: with
                  push muted these two decide nothing, and a live-looking control
                  that decides nothing is the thing this page is built to avoid. */}
              <Toggle
                label={t('push.kindAssigned')}
                hint={t('push.kindAssignedHint')}
                checked={prefs.assigned}
                disabled={busy || !prefs.enabled}
                onChange={(next) => onPref('assigned', next)}
              />
              <Toggle
                label={t('push.kindCompleted')}
                hint={t('push.kindCompletedHint')}
                checked={prefs.completed}
                disabled={busy || !prefs.enabled}
                onChange={(next) => onPref('completed', next)}
              />
            </div>
          </Card>

          <Card title={t('push.devices')}>
            <p className="push-note">{t('push.devicesHint')}</p>
            <ul className="push-devices">
              {devices.map((device) => {
                const label = device.label || t('push.unknownDevice')
                return (
                  <li className="push-device" key={device.id}>
                    <span className="push-device-icon" aria-hidden="true">
                      <IconMonitor size={18} />
                    </span>
                    <span className="push-device-text">
                      {/* The label is a browser/platform pair like "iPhone" or
                          "Mac · Chrome" — Latin in both languages, so it is
                          fenced by the locale string that carries it rather
                          than styled with a direction here. */}
                      <span className="push-device-name">{label}</span>
                      <span className="push-note">
                        {device.isThisDevice
                          ? t('push.thisDevice')
                          : t('push.added', {
                              date: formatDate(instantToIsoDate(device.createdAt), locale),
                            })}
                      </span>
                    </span>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm push-remove"
                      // The visible word is "Remove" on every row, so the
                      // accessible name has to name the row it belongs to.
                      aria-label={t('push.removeLabel', { name: label })}
                      disabled={busy}
                      onClick={() => void onRemove(device.id, label)}
                    >
                      {t('push.remove')}
                    </button>
                  </li>
                )
              })}
            </ul>
          </Card>
        </>
      ) : null}

      {devices.length === 0 && !loading && verdict !== 'ready' ? (
        <p className="push-note push-empty">
          {/* Every icon in components/icons.tsx is aria-hidden already, so this
              is decorative beside the sentence that carries the meaning. */}
          <IconShieldCheck size={16} />
          {t('push.devicesEmpty')}
        </p>
      ) : null}
    </div>
  )
}
