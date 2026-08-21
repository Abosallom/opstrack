// /privacy — the privacy policy, written about THIS app.
//
// WHY IT EXISTS. Apple requires a reachable privacy policy for any app with
// accounts, and App Store Connect wants a URL rather than a screen. This page
// is that URL: it is mounted on BOTH sides of the auth gate in App.tsx, so
// `…/#/privacy` resolves for a reviewer who has no credentials and for a member
// who is already signed in. Everything else on this route follows from that one
// requirement.
//
// IT IS NOT BOILERPLATE, AND THAT IS THE POINT. Every claim below was read out
// of the source before it was written down: the tables come from
// supabase/migrations/0001, 0004, 0011, 0020 and 0021; the "who can see it"
// paragraphs come from the RLS policies in those same files; the AI section
// comes from supabase/functions/capture-assist/index.ts (buildSystemPrompt and
// the `NO PROMPT OR RESPONSE LOGGING` note in its header) and from 0020's
// header, which states in the migration itself that the ledger holds no prompt
// text; the push paragraph comes from src/lib/push.ts's `verdictFor`, which
// returns 'unsupported' for a native build; the deletion paragraph comes from
// `case 'delete'` in supabase/functions/admin-members/index.ts, including the
// three refusals it enumerates. A reviewer reads this page. A generic policy
// that contradicts the app is worse than no policy at all.
//
// THE ONE UNCOMFORTABLE SENTENCE STAYS. `privacy.deleteSelf` says there is no
// self-service delete yet, names the three server-side refusals, and points at
// the person who can act. That is the true state of the code today, and writing
// it as though a Delete-my-account button existed would be the one lie on the
// page a reviewer could catch by opening Settings. docs/APP-STORE.md carries
// the work item.
//
// TWO SHAPES, ONE COMPONENT. `standalone` is passed by the signed-out route
// only. Signed in, the app header already renders the route's <h1> (App.tsx
// via lib/routeTitle.titleKeyFor), so drawing another one here would give the
// page two. Signed out there is no shell at all, so the page supplies its own
// frame, its own heading, the language toggle — the same pre-auth argument
// SignIn.tsx makes for having one — and a way back to the sign-in form.
//
// A prop rather than a `useAuth()` read, deliberately: the route already knows
// which side of the gate it is on, and `?shell` fakes a session in App.tsx
// without touching the auth store, so a store read would draw the wrong frame
// in the one place the shell is reviewed.

import { type ReactElement, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { IconArrowStart, IconRing, IconShieldCheck } from '../components/icons'
import { t, useLocale } from '../lib/i18n'
import { setLocaleSetting } from '../store/settings'
import './privacy.css'

/**
 * When the text below was last checked against the source, as an ISO day.
 *
 * A constant rather than a build date: "last reviewed" is a claim about a human
 * having re-read the migrations, and a timestamp injected by the bundler would
 * renew that claim on every unrelated deploy. Interpolated rather than written
 * into the locale files so the Arabic string never carries a literal digit run
 * for the bidi gate to have to fence (lib/bidi.test.ts, "literal ranges").
 */
const REVIEWED = '2026-08-11'

/** Named in the text, so it is a link rather than a claim about someone else. */
const ANTHROPIC_PRIVACY = 'https://www.anthropic.com/legal/privacy'

/**
 * One titled block.
 *
 * `aria-labelledby` rather than `aria-label`: the heading is already on screen
 * and already translated, so pointing at it keeps the accessible name and the
 * visible name the same string by construction.
 */
function Section({
  id,
  title,
  children,
}: {
  id: string
  title: string
  children: ReactNode
}): ReactElement {
  return (
    <section className="card pv-section" id={id} aria-labelledby={`${id}-h`}>
      <h2 className="pv-h2" id={`${id}-h`}>
        {title}
      </h2>
      {children}
    </section>
  )
}

/** A label/body pair inside a definition list. */
function Term({ term, children }: { term: string; children: ReactNode }): ReactElement {
  return (
    <>
      <dt className="pv-dt">{term}</dt>
      <dd className="pv-dd">{children}</dd>
    </>
  )
}

export default function Privacy({ standalone = false }: { standalone?: boolean }): ReactElement {
  // Subscribed even when the toggle is not rendered: t() is a plain function,
  // so without this the signed-in copy of this page would keep the language it
  // was first painted in.
  const locale = useLocale()

  const body = (
    <article className="pv-body">
      <p className="pv-standfirst">{t('privacy.standfirst')}</p>
      <p className="pv-meta">
        {t('privacy.updated', { version: __APP_VERSION__, date: REVIEWED })}
      </p>

      <Section id="pv-scope" title={t('privacy.scopeTitle')}>
        <p className="pv-p">{t('privacy.scopeBody')}</p>
        <p className="pv-p">{t('privacy.scopeNoSignup')}</p>
      </Section>

      <Section id="pv-stored" title={t('privacy.storedTitle')}>
        <p className="pv-p">{t('privacy.storedIntro')}</p>
        <dl className="pv-dl">
          <Term term={t('privacy.storedAccount')}>{t('privacy.storedAccountBody')}</Term>
          <Term term={t('privacy.storedWork')}>{t('privacy.storedWorkBody')}</Term>
          <Term term={t('privacy.storedThread')}>{t('privacy.storedThreadBody')}</Term>
          <Term term={t('privacy.storedNotify')}>{t('privacy.storedNotifyBody')}</Term>
          <Term term={t('privacy.storedAi')}>{t('privacy.storedAiBody')}</Term>
          <Term term={t('privacy.storedGuards')}>{t('privacy.storedGuardsBody')}</Term>
          <Term term={t('privacy.storedDevice')}>{t('privacy.storedDeviceBody')}</Term>
        </dl>
      </Section>

      <Section id="pv-who" title={t('privacy.whoTitle')}>
        <p className="pv-p">{t('privacy.whoBody')}</p>
        <p className="pv-p">{t('privacy.whoRls')}</p>
        <h3 className="pv-h3">{t('privacy.whoPrivateTitle')}</h3>
        <ul className="pv-list">
          <li>{t('privacy.whoPrivateNotif')}</li>
          <li>{t('privacy.whoPrivatePush')}</li>
          <li>{t('privacy.whoPrivateAi')}</li>
        </ul>
        <p className="pv-p">{t('privacy.whoAdmin')}</p>
      </Section>

      <Section id="pv-where" title={t('privacy.whereTitle')}>
        <p className="pv-p">{t('privacy.whereBody')}</p>
      </Section>

      <Section id="pv-ai" title={t('privacy.aiTitle')}>
        <p className="pv-p">{t('privacy.aiOff')}</p>

        <h3 className="pv-h3">{t('privacy.aiSentTitle')}</h3>
        <ul className="pv-list">
          <li>{t('privacy.aiSentLine')}</li>
          <li>{t('privacy.aiSentNames')}</li>
          <li>{t('privacy.aiSentToday')}</li>
          <li>{t('privacy.aiSentLabels')}</li>
        </ul>

        {/* The "not" list carries the same weight as the "sent" list and is
            marked apart rather than merely worded apart — AiSettings.tsx makes
            the same call for the same reason. */}
        <h3 className="pv-h3 pv-h3-not">{t('privacy.aiNotTitle')}</h3>
        <ul className="pv-list pv-list-not">
          <li>{t('privacy.aiNotEntries')}</li>
          <li>{t('privacy.aiNotThread')}</li>
          <li>{t('privacy.aiNotFiles')}</li>
          <li>{t('privacy.aiNotIdentity')}</li>
          <li>{t('privacy.aiNotElse')}</li>
        </ul>

        <p className="pv-p">{t('privacy.aiWho')}</p>
        <p className="pv-p">{t('privacy.aiKept')}</p>
        <p className="pv-p">{t('privacy.aiNever')}</p>
        <p className="pv-p">
          {t('privacy.aiThird')}{' '}
          {/* rel is not decoration here: `noopener` is what stops the opened
              tab reaching back through window.opener, and this is the only
              outbound link in the app. */}
          <a
            className="pv-link"
            href={ANTHROPIC_PRIVACY}
            target="_blank"
            rel="noopener noreferrer"
          >
            {t('privacy.aiThirdLink')}
          </a>
        </p>
      </Section>

      <Section id="pv-push" title={t('privacy.pushTitle')}>
        <p className="pv-p">{t('privacy.pushBody')}</p>
        <p className="pv-p">{t('privacy.pushNative')}</p>
      </Section>

      <Section id="pv-not" title={t('privacy.notTitle')}>
        <ul className="pv-list pv-list-not">
          <li>{t('privacy.notAnalytics')}</li>
          <li>{t('privacy.notDevice')}</li>
          <li>{t('privacy.notSell')}</li>
        </ul>
      </Section>

      <Section id="pv-keep" title={t('privacy.keepTitle')}>
        <p className="pv-p">{t('privacy.keepBody')}</p>
      </Section>

      <Section id="pv-delete" title={t('privacy.deleteTitle')}>
        <p className="pv-p">{t('privacy.deleteBody')}</p>
        <p className="pv-p">{t('privacy.deleteWhat')}</p>
        <p className="pv-p pv-p-flag">{t('privacy.deleteSelf')}</p>
      </Section>

      <Section id="pv-ask" title={t('privacy.askTitle')}>
        <p className="pv-p">{t('privacy.askBody')}</p>
      </Section>

      <Section id="pv-changes" title={t('privacy.changesTitle')}>
        <p className="pv-p">{t('privacy.changesBody')}</p>
      </Section>
    </article>
  )

  if (!standalone) return <div className="pv-page">{body}</div>

  return (
    <div className="pv-shellless">
      <div className="pv-page">
        <div className="pv-brand">
          <span className="pv-mark" aria-hidden="true">
            <IconRing size={16} />
          </span>
          <span className="pv-brand-name">{t('app.name')}</span>
          {/* The pre-auth language control, for the reason SignIn.tsx states:
              the header's toggle lives inside the shell, which nobody reading
              this page from an App Store listing has reached. */}
          <button
            type="button"
            className="btn btn-ghost btn-sm pv-lang"
            lang={locale === 'en' ? 'ar' : 'en'}
            aria-label={t('common.toggleLanguage')}
            onClick={() => setLocaleSetting(locale === 'en' ? 'ar' : 'en')}
          >
            {locale === 'en' ? t('settings.languageAr') : t('settings.languageEn')}
          </button>
        </div>

        <h1 className="pv-h1">
          {/* The icon factory already sets aria-hidden on every glyph. */}
          <IconShieldCheck className="pv-h1-icon" size={20} />
          {t('privacy.title')}
        </h1>

        {body}

        <p className="pv-back">
          <Link className="btn btn-ghost btn-sm" to="/signin">
            {/* icon-directional: a back arrow points at the reading start, so
                it mirrors in Arabic. */}
            <IconArrowStart className="icon-directional" size={16} />
            {t('privacy.backToSignIn')}
          </Link>
        </p>
      </div>
    </div>
  )
}
