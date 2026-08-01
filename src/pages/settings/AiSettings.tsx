// AI assist (/settings/ai) — the switch, the promise, and the count.
//
// THREE QUESTIONS, IN THE ORDER PEOPLE ASK THEM. Can I turn it off? What
// exactly leaves my browser? How much has it been used? Everything on this
// screen answers one of those, and nothing else is here.
//
// THE PRIVACY STATEMENT IS THE POINT OF THE PAGE, not its small print. A
// feature that sends what someone typed to a third party has to say so in the
// words they would use, in a place they can find without being told — and it
// has to say what is NOT sent, because "the line" is only reassuring next to
// "no history, no updates, no other entries". Both halves are listed, marked
// apart, and phrased so that a reader who stops after three lines has still
// read the truth. This is the same discipline NotificationPrefs.tsx applies to
// the browser permission dialog: the cheap moment (reading a card) comes before
// the expensive one (the thing you cannot take back).
//
// THE SWITCH IS SERVER-BACKED AND PER USER, following store/push.ts +
// NotificationPrefs.tsx — the app's only precedent for a toggle that has to
// mean the same thing on every device somebody signs in on. Optimistic with a
// snapshot rollback, because a switch that waits for a round trip before moving
// reads as broken and the stake is one boolean.
//
// THE COUNT IS TODAY'S, read on mount from the function that owns the counter.
// It is a courtesy rather than a control: nobody comes here to budget
// suggestions, they come to find out whether the thing is on and what it costs
// them in privacy. It earns its place by being the one number that proves the
// feature is actually running.

import { useEffect, useId, useState, type ReactElement } from 'react'
import { Link } from 'react-router-dom'
import { IconArrowStart, IconShieldCheck } from '../../components/icons'
import { Skeleton } from '../../components/shared'
import { toast } from '../../components/toast'
import { t } from '../../lib/i18n'
import {
  loadAiPrefs,
  loadAiUsage,
  setAiEnabled,
  useAiBusy,
  useAiDailyLimit,
  useAiEnabled,
  useAiError,
  useAiPrefsReady,
  useAiUsage,
  useAiUsageLoading,
} from '../../store/ai'
import '../../components/capture/ai-suggest.css'

/** One titled card. Local, so this screen owns its own spacing. */
function Card({
  title,
  children,
}: {
  title: string
  children: ReactElement | (ReactElement | null)[]
}): ReactElement {
  return (
    <section className="card ais-card">
      <h2 className="ais-card-title">{title}</h2>
      {children}
    </section>
  )
}

export default function AiSettings(): ReactElement {
  const enabled = useAiEnabled()
  const ready = useAiPrefsReady()
  const busy = useAiBusy()
  const errorKey = useAiError()
  const usage = useAiUsage()
  const usageLoading = useAiUsageLoading()
  const dailyLimit = useAiDailyLimit()
  const hintId = useId()
  // Announced through role="status" rather than as a toast: the user is looking
  // at the control that changed, and a toast would cover the tab bar.
  const [live, setLive] = useState('')

  useEffect(() => {
    void loadAiPrefs()
    void loadAiUsage()
  }, [])

  async function onToggle(next: boolean): Promise<void> {
    const failure = await setAiEnabled(next)
    if (failure) return
    const said = next ? t('ai.turnedOn') : t('ai.turnedOff')
    setLive(said)
    toast(said)
  }

  return (
    <div className="ais-page">
      <div className="ais-bar">
        <Link to="/settings" className="btn btn-ghost btn-sm">
          {/* A back arrow points at the reading start, so it mirrors in Arabic. */}
          <IconArrowStart className="icon-directional" size={16} />
          {t('common.back')}
        </Link>
      </div>

      {/* No page heading: App.tsx's header renders this route's title as the
          document h1, and a second copy is noise in the outline. */}
      <div className="ais-intro">
        <p className="ais-lead">{t('ai.subtitle')}</p>
        <p className="ais-note">{t('ai.previewNote')}</p>
      </div>

      <p className="sr-only" role="status" aria-live="polite">
        {live}
      </p>

      <Card title={t('ai.switchTitle')}>
        <p className="ais-body">
          <span className={`pill${enabled ? ' ok' : ''}`}>
            {enabled ? t('ai.statusOn') : t('ai.statusOff')}
          </span>
        </p>
        <button
          type="button"
          className="ais-toggle"
          role="switch"
          aria-checked={enabled}
          aria-describedby={hintId}
          disabled={busy}
          onClick={() => void onToggle(!enabled)}
        >
          <span className="ais-toggle-text">
            <span className="ais-toggle-label">{t('ai.toggleLabel')}</span>
            <span className="ais-note" id={hintId}>
              {t('ai.toggleHint')}
            </span>
          </span>
          {/* aria-checked is repeated on the visual span because that attribute
              IS `.switch`'s styling contract in global.css, and this sheet may
              not restyle another's primitive. aria-hidden, so only the button
              is announced. */}
          <span className="switch" aria-hidden="true" aria-checked={enabled} />
        </button>
        {/* The preference could not be read, so the app is not sending anything
            — said plainly, because otherwise this screen shows a switch that
            claims to be on while capture stays silent. */}
        {!ready ? <p className="ais-note">{t('ai.prefsUnread')}</p> : null}
      </Card>

      <Card title={t('ai.sentTitle')}>
        <p className="ais-body">{t('ai.sentBody')}</p>
        <ul className="ais-sent">
          <li data-tone="yes">{t('ai.sentLine')}</li>
          <li data-tone="yes">{t('ai.sentNames')}</li>
          <li data-tone="yes">{t('ai.sentToday')}</li>
          <li data-tone="no">{t('ai.notSentHistory')}</li>
          <li data-tone="no">{t('ai.notSentUpdates')}</li>
          <li data-tone="no">{t('ai.notSentElse')}</li>
        </ul>
        <p className="ais-note">
          <IconShieldCheck size={16} />
          {t('ai.keyNote')}
        </p>
        <p className="ais-note">{t('ai.neverFiles')}</p>
      </Card>

      <Card title={t('ai.usageTitle')}>
        {usageLoading && !usage ? (
          <Skeleton height={44} />
        ) : (
          <>
            <p className="ais-usage">
              <span className="ais-usage-count tabular">{usage ? usage.calls : 0}</span>
              <span className="ais-usage-of">{t('ai.usageCalls')}</span>
              {/* The ceiling appears only once it is KNOWN. `ai_usage` cannot
                  report it — the number lives in the edge function — so it is
                  learned from the first suggestion of the session, and printing
                  "of 0" until then would read as a broken feature rather than as
                  a figure this screen does not have. */}
              {dailyLimit !== null ? (
                <span className="ais-usage-of">{t('ai.usageOf', { limit: dailyLimit })}</span>
              ) : null}
            </p>
            {/* Cost measured, not estimated — the wave asked for a number, and a
                number nobody can see is not a measurement. These are the counts
                the upstream API itself reported, stored by migration 0020. */}
            <p className="ais-note">
              {t('ai.usageTokens', {
                input: usage ? usage.inputTokens : 0,
                output: usage ? usage.outputTokens : 0,
              })}
            </p>
          </>
        )}
        <p className="ais-note">{t('ai.usageHint')}</p>
      </Card>

      {errorKey ? (
        <p className="field-error ais-error" role="alert">
          {t(errorKey)}
        </p>
      ) : null}
    </div>
  )
}
