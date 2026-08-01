// WHY THE RULES ARE TESTED AND THE MARKUP IS NOT. vitest runs
// `environment: 'node'` by design (vitest.config.ts: "a test that needs a
// document is a sign the logic is in the wrong layer") and there is no jsdom in
// the dependency budget — UpdateThread.test.tsx, atoms.test.tsx and
// FollowUps.test.tsx all open with the same paragraph. So the assertions are on
// the two DECISIONS, both exported for exactly that: may this person be asked,
// and is an ask still outstanding. One of them sends a colleague a notification;
// the other decides whether the app double-chases them.
//
// WHY THE MOCKS. store/members.ts registers a `window` focus listener at module
// init, which is fatal under `node`. UpdateThread.test.tsx shims the same
// globals for the same reason.

import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { Entry } from '../../types'

vi.hoisted(() => {
  const g = globalThis as unknown as Record<string, unknown>
  g.addEventListener = () => {}
  g.removeEventListener = () => {}
  g.window = globalThis
  g.document = { documentElement: { dir: 'ltr', lang: 'en' } }
})

vi.mock('../../store/members', () => ({
  useMemberMap: () => new Map(),
  useMemberLabel: () => () => 'Sara',
}))

vi.mock('../../store/nudges', () => ({
  useLocalAsk: () => undefined,
  sendNudge: () => Promise.resolve({ ok: false, error: 'nudge.errFailed' }),
}))

const { askOffer, canNudge, outstandingAsk } = await import('./NudgeButton')
const { default: NudgeButton } = await import('./NudgeButton')

/**
 * The component's own source, for the wiring assertions at the bottom. Read
 * through import.meta.glob('?raw') rather than node:fs, for the reason
 * lib/localeReach.test.ts gives: tsconfig.app.json pins `types: ["vite/client"]`
 * and widening it to include "node" would leak node globals into the type space
 * of every app file.
 */
const SOURCES: Record<string, string> = import.meta.glob('./NudgeButton.tsx', {
  query: '?raw',
  import: 'default',
  eager: true,
})
const SOURCE = SOURCES['./NudgeButton.tsx'] ?? ''
/**
 * The same source with its prose removed. This file is heavily commented and the
 * comments NAME the things the assertions forbid — "no loader, no store to warm"
 * is the explanation of the rule, not a violation of it.
 */
const CODE = SOURCE.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

/**
 * The sheet, for the one rule that lives in CSS and decides whether a person can
 * see what this button will do before they tap it.
 *
 * NOT `import.meta.glob('?raw')`, which works for the .tsx above and cannot work
 * here: vitest.config.ts leaves `css` disabled and Vitest stubs on the file
 * EXTENSION before the query is read, so a glob returns '' and every assertion
 * below would pass while checking nothing. styles/contrast.test.ts hit exactly
 * this and its header records the fix — a computed `node:fs` specifier, so
 * tsconfig.app.json's `types: ["vite/client"]` stays pinned.
 */
const NODE_FS = 'node:fs'
const { readFileSync } = (await import(NODE_FS)) as {
  readFileSync: (path: URL, encoding: 'utf8') => string
}
const CSS = readFileSync(new URL('./nudge.css', import.meta.url), 'utf8')
if (CSS.trim() === '') throw new Error('nudge.css is empty')

const DAY = 86_400_000
const NOW = Date.parse('2026-08-01T12:00:00.000Z')

/** An entry, with 0019's two columns riding along as PostgREST delivers them. */
function entry(over: Partial<Entry> & { nudged_at?: string | null; nudged_by?: string | null } = {}): Entry {
  return {
    id: 'e1',
    track_id: null,
    title: 'Switch firmware upgrade',
    description: '',
    type: 'action',
    status: 'in_progress',
    priority: 'high',
    owner_id: 'owner',
    owner_name: null,
    requester: null,
    due_date: null,
    follow_up_date: null,
    tags: [],
    links: [],
    created_by: 'me',
    created_at: '2026-07-01T00:00:00.000Z',
    updated_at: '2026-07-01T00:00:00.000Z',
    closed_at: null,
    last_activity_at: '2026-07-01T00:00:00.000Z',
    meeting_id: null,
    template_id: null,
    ...over,
  } as Entry
}

describe('canNudge', () => {
  it('offers the ask on a colleague’s item', () => {
    expect(canNudge(entry(), 'me')).toBe(true)
  })

  it('never offers to chase yourself', () => {
    // Being asked for an update on the thing you are holding is a joke the
    // second time and noise the third. 0019 refuses it too (`nudge_self`); this
    // is the half that stops the button existing.
    expect(canNudge(entry({ owner_id: 'me' }), 'me')).toBe(false)
  })

  it('offers nothing on an unowned item', () => {
    // There is nobody to notify. The Unassigned bucket already carries the two
    // controls that FIX this — take it, assign it — which is the right answer to
    // an unowned item and is not "chase".
    expect(canNudge(entry({ owner_id: null }), 'me')).toBe(false)
  })

  it('offers nothing on an item owned by free text', () => {
    // `owner_name` is a vendor or another department: no profile, no inbox, no
    // push. An affordance whose only possible outcome is a refusal is worse than
    // no affordance.
    expect(canNudge(entry({ owner_id: null, owner_name: 'Cisco TAC' }), 'me')).toBe(false)
  })

  it('offers nothing when nobody is signed in', () => {
    expect(canNudge(entry(), null)).toBe(false)
  })
})

describe('outstandingAsk', () => {
  it('reports nothing when nobody has asked', () => {
    expect(outstandingAsk(entry(), undefined, NOW)).toBeNull()
  })

  it('reads the ask off the entry row, which is where 0019 stamps it', () => {
    const ask = outstandingAsk(
      entry({ nudged_at: '2026-07-30T12:00:00.000Z', nudged_by: 'sara' }),
      undefined,
      NOW,
    )
    expect(ask).toEqual({
      askedAt: '2026-07-30T12:00:00.000Z',
      askedBy: 'sara',
      answered: false,
      mayAskAgain: true,
    })
  })

  it('treats activity after the ask as an answer, and hides the record', () => {
    // THE WHOLE REASON 0019 KEEPS THE ACTIVITY CLOCK STILL THROUGH A NUDGE. With
    // last_activity_at frozen by the migration, this one comparison is an exact
    // answer to "has anything happened since I asked?" — no extra column, no
    // join, and it cannot drift from the thing it describes.
    const ask = outstandingAsk(
      entry({
        nudged_at: '2026-07-30T12:00:00.000Z',
        nudged_by: 'sara',
        last_activity_at: '2026-07-31T09:00:00.000Z',
      }),
      undefined,
      NOW,
    )
    expect(ask?.answered).toBe(true)
  })

  it('keeps the record visible when the activity clock will not parse', () => {
    // The safe direction: hiding an unanswered ask is what causes a double-chase,
    // and showing a spent one costs a glance.
    const ask = outstandingAsk(
      entry({ nudged_at: '2026-07-30T12:00:00.000Z', last_activity_at: 'not a date' }),
      undefined,
      NOW,
    )
    expect(ask?.answered).toBe(false)
  })

  it('offers the repeat only once the server’s window has passed', () => {
    const fresh = outstandingAsk(entry({ nudged_at: '2026-08-01T09:00:00.000Z' }), undefined, NOW)
    expect(fresh?.mayAskAgain).toBe(false)

    // Exactly at the boundary the server would accept it, so the UI must too —
    // an off-by-one here is a button that refuses for an extra day with no
    // explanation.
    const due = outstandingAsk(
      entry({ nudged_at: new Date(NOW - DAY).toISOString() }),
      undefined,
      NOW,
    )
    expect(due?.mayAskAgain).toBe(true)
  })

  it('takes this session’s ask while the row is still catching up', () => {
    // The gap between the tap and realtime delivering the stamped row. Without
    // this the button spends a round trip still offering to ask, and on a phone
    // a double-tap is one gesture.
    const ask = outstandingAsk(entry(), { askedAt: '2026-08-01T11:59:00.000Z', askedBy: 'me' }, NOW)
    expect(ask?.askedBy).toBe('me')
    expect(ask?.mayAskAgain).toBe(false)
  })

  it('never lets a stale local ask mask a colleague’s newer one', () => {
    // 0019's rate limit is per ENTRY from ANYBODY. If Sara asked an hour ago,
    // that is the ask this row has to report — showing yesterday's local one
    // would tell the reader they may ask again when the server will refuse.
    const ask = outstandingAsk(
      entry({ nudged_at: '2026-08-01T11:00:00.000Z', nudged_by: 'sara' }),
      { askedAt: '2026-07-25T09:00:00.000Z', askedBy: 'me' },
      NOW,
    )
    expect(ask?.askedBy).toBe('sara')
    expect(ask?.mayAskAgain).toBe(false)
  })

  it('degrades to "nobody asked" on a value it cannot read', () => {
    // A hand-edited column, a build where 0019 has not been applied and the
    // columns are simply absent. The row offers the button, the RPC answers
    // PGRST202, and the user is told the feature is not set up — rather than
    // reading "Asked Invalid Date".
    expect(outstandingAsk(entry({ nudged_at: 'yesterday-ish' }), undefined, NOW)).toBeNull()
    expect(outstandingAsk(entry({ nudged_at: null }), undefined, NOW)).toBeNull()
  })
})

describe('askOffer — the window decides, not the movement', () => {
  it('offers the first ask when nobody has asked', () => {
    expect(askOffer(null)).toBe('first')
  })

  it('offers the repeat once the server’s window has passed', () => {
    expect(askOffer({ mayAskAgain: true })).toBe('again')
  })

  it('offers NOTHING inside the window, however much the item has moved', () => {
    // THE DEAD BUTTON THIS FUNCTION EXISTS TO DELETE. The row used to fall back
    // to a plain "Ask for an update" the moment `answered` went true — which
    // happens the instant anything touches the item, INCLUDING the owner posting
    // the very update that was asked for. 0019's gate is
    // `v_nudged > v_now - interval '24 hours'` and nothing else, so:
    //
    //   09:00 nudge Sara · 10:00 Sara posts an update (answered = true, and the
    //   item is still overdue so the row stays on Follow-ups) · 11:00 the row
    //   offered a FIRST ask → PT429 → "Someone already asked about this one
    //   today" → refreshEntries() → the same dead button back, every tap.
    //
    // An affordance whose only possible outcome is a refusal is worse than none;
    // this file's own header says so about the no-owner case.
    expect(askOffer({ mayAskAgain: false })).toBeNull()
  })

  it('agrees with outstandingAsk on the answered-but-fresh row', () => {
    // End to end on real timestamps, because the bug lived in the JOIN between
    // these two functions rather than in either of them.
    const ask = outstandingAsk(
      entry({
        nudged_at: '2026-08-01T09:00:00.000Z',
        nudged_by: 'me',
        last_activity_at: '2026-08-01T10:00:00.000Z',
      }),
      undefined,
      NOW,
    )
    expect(ask?.answered).toBe(true)
    expect(ask?.mayAskAgain).toBe(false)
    expect(askOffer(ask)).toBeNull()
  })
})

/* ─────────────────────── the four states, rendered ─────────────────────── */
//
// The rules above are pure and provable; this is what a person actually SEES,
// which is where the defect lived. `renderToStaticMarkup` under
// `environment: 'node'` is the same technique AiSuggestion.test.tsx and
// NotificationBell.test.tsx use — the stores this component touches are already
// mocked at the top of this file, so there is nothing left that needs a
// document.
//
// `nudged_at` is written relative to a FIXED now so `formatRelativeTime` has a
// stable answer; the assertions are on the presence of the control and the
// claim the sentence makes, never on the exact phrasing of the interval.

function markup(over: Partial<Entry> & { nudged_at?: string | null; nudged_by?: string | null }): string {
  return renderToStaticMarkup(<NudgeButton entry={entry(over)} meId="me" className="fu-act" />)
}

const HOURS_2 = new Date(Date.now() - 2 * 3600_000).toISOString()
const DAYS_2 = new Date(Date.now() - 2 * DAY).toISOString()

describe('what the row shows', () => {
  it('offers the first ask, in words, with a shorter word for the phone', () => {
    const html = markup({})
    expect(html).toContain('Ask for an update')
    // The narrow-width word. It is in the DOM at every width — the stylesheet
    // chooses which of the two is painted — and it is aria-hidden, so the
    // accessible name is the full sentence either way.
    expect(html).toContain('class="ndg-short" aria-hidden="true">Ask<')
    expect(html).not.toContain('ndg-pill')
  })

  it('states the outstanding ask and offers nothing while the window is open', () => {
    const html = markup({ nudged_at: HOURS_2, nudged_by: 'me' })
    expect(html).toContain('ndg-pill')
    expect(html).toContain('nothing since')
    expect(html).not.toContain('<button')
  })

  it('NEVER offers a dead ask on an item that moved inside the window', () => {
    // THE DEFECT. Nudge Sara at 09:00, Sara posts an update at 10:00, the item
    // is still overdue so the row stays on Follow-ups. At 11:00 this used to
    // render "Ask for an update" — labelled as a FIRST ask — and the database
    // answered PT429 every single time it was tapped.
    const html = markup({ nudged_at: HOURS_2, nudged_by: 'me', last_activity_at: new Date().toISOString() })
    expect(html).not.toContain('<button')
    // The record stays, because the missing button needs explaining — and it
    // does NOT claim a silence that ended.
    expect(html).toContain('ndg-pill')
    expect(html).toContain('moved since')
    expect(html).not.toContain('nothing since')
    // Untinted: the warn tint means "and nothing came back", which is now false.
    expect(html).not.toContain('ndg-pill warn')
  })

  it('brings the repeat back once the window has passed, labelled as a repeat', () => {
    const html = markup({ nudged_at: DAYS_2, nudged_by: 'me' })
    expect(html).toContain('Ask again')
    expect(html).not.toContain('Ask for an update')
    // The prompt tint, and the pill saying how long the silence has been.
    expect(html).toContain('ndg-pill warn')
  })

  it('drops the spent record once the item has moved and the window has passed', () => {
    const html = markup({ nudged_at: DAYS_2, nudged_by: 'me', last_activity_at: new Date().toISOString() })
    expect(html).toContain('Ask again')
    expect(html).not.toContain('ndg-pill')
  })
})

describe('the component reads its record and never fetches it', () => {
  it('has no effect and no loader of its own', () => {
    // The ask is a COLUMN ON THE ENTRY, so the row it was handed already carries
    // it — cached for a cold start and realtime-patched when a colleague asks
    // from their own laptop. A fetch from inside the row would be 150 requests
    // on the screen this app opens on, and a second source that can disagree.
    expect(CODE).not.toContain('useEffect')
    expect(CODE).not.toContain('supabase')
    // The reads ARE there, so the checks above cannot pass by the component
    // having no data at all.
    expect(CODE).toContain('useLocalAsk(entry.id)')
    expect(CODE).toContain('outstandingAsk(entry, local)')
  })

  it('never decides whether to OFFER the ask from whether the item moved', () => {
    // The regression, in source form. `answered` may decide what the row SAYS;
    // only the window may decide whether the button exists.
    expect(CODE).not.toContain('ask === null || ask.answered')
    expect(CODE).toContain('askOffer(ask)')
  })

  it('carries a word on the button at every width, and no glyph', () => {
    // The narrow form is a SHORTER WORD, never a picture: this is the only
    // control in the app that reaches another human, it has no confirm and no
    // undo, and touch has no hover to reveal the `title`. nudge.css carries the
    // 375px measurements that rule out the full sentence.
    expect(CODE).toContain('ndg-short')
    // aria-hidden on the short word, so the accessible name is the full
    // sentence at EVERY viewport rather than changing with the layout.
    expect(CODE).toContain('aria-hidden="true"')
    expect(CODE).toContain('ndg-label')

    const narrow = CSS.slice(CSS.indexOf('@media (max-width: 639px)'))
    expect(narrow).toContain('.ndg-short')
    // No glyph anywhere: the icon that used to replace the words is gone, in
    // both the component and the sheet, so there is nothing to "restore".
    expect(CSS).not.toContain('.ndg-icon')
    expect(CODE).not.toContain('IconAsk')
  })

  it('never renders an error sentence it wrote itself', () => {
    // Every refusal is an i18n KEY from api/nudge.ts's table, rendered through
    // t(result.error). A literal sentence here would be untranslated English in
    // an RTL layout — the defect lib/pgError.ts exists to prevent.
    expect(CODE).toContain('t(result.error)')
  })
})
