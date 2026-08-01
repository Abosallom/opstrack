// Render proof for the AI suggestion row.
//
// WHY renderToStaticMarkup AND NOT A DOM. vitest.config.ts is `environment:
// 'node'` and jsdom is not in the dependency budget; NotificationBell.test.tsx,
// Board.test.tsx and the entry kit's test all open with the same paragraph.
// react-dom/server exercises the real tree, the real i18n bundle, the real
// validator and the real token writer, and hands back markup to assert on.
//
// WHAT IT IS DEFENDING:
//
//  · THE ROW SAYS WHAT IT WILL DO. The chips and the tokens both come from
//    `newFields()`, so asserting that the track, the owner, the type and the
//    spelled-out date are on screen is asserting that accepting adds exactly
//    those four things.
//  · IT NEVER SHOWS RAW JSON, AN ID, OR A TOKEN. A track id or a `#"Dev & QA"`
//    reaching the markup is the failure this feature is most likely to ship —
//    the payload is right there in the component's own props — and it is
//    invisible to a unit test of the store.
//  · THE MODEL'S TITLE NEVER APPEARS. This surface appends; it does not rewrite.
//    A cleaned-up title on screen would be an offer to replace words the user is
//    still typing.
//  · THE LIVE REGION EXISTS BEFORE THE CONTENT DOES. A region added at the same
//    moment as its text is a region screen readers routinely miss, so the
//    empty-state render must still contain it.
//  · THE KEYBOARD CONTRACT IS ON SCREEN. "Tab" and "Enter" have to appear in the
//    hint, because a shortcut nobody is told about is a shortcut nobody uses —
//    and because the one thing this row may never do is leave a person unsure
//    what Enter will submit.
//
// The zustand stores are mocked rather than driven: `useSyncExternalStore`
// serves getInitialState() under a server render, so a store written to with
// setState would render its initial value and every assertion below would be
// about an empty row. The mocks replace the HOOKS only.

import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

const fx = vi.hoisted(() => {
  // lib/i18n reads localStorage at module scope, at IMPORT time.
  const g = globalThis as unknown as Record<string, unknown>
  if (!g.localStorage) {
    const mem = new Map<string, string>()
    g.localStorage = {
      getItem: (k: string) => mem.get(k) ?? null,
      setItem: (k: string, v: string) => void mem.set(k, v),
      removeItem: (k: string) => void mem.delete(k),
      clear: () => mem.clear(),
      key: (i: number) => [...mem.keys()][i] ?? null,
      get length() {
        return mem.size
      },
    }
  }
  if (!g.document) g.document = { documentElement: { dir: 'ltr', lang: 'en' } }

  const state = {
    suggestion: null as { line: string; suggestion: unknown; model: string } | null,
    pending: false,
  }
  return { state }
})

vi.mock('../../store/ai', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../store/ai')>()
  return {
    ...actual,
    useAiEnabled: () => true,
    useAiPrefsReady: () => true,
    useAiPending: () => fx.state.pending,
    useAiSuggestion: () => fx.state.suggestion,
    loadAiPrefs: () => Promise.resolve(),
    requestSuggestion: () => Promise.resolve(),
  }
})

const TRACK = {
  id: 't-devqa',
  name: 'Dev & QA',
  name_ar: 'التطوير والجودة',
  color: '#47b1d8',
  color_light: '#1e7291',
} as unknown as import('../../types').Track

vi.mock('../../store/config', () => ({
  useTrackMap: () => new Map([['t-devqa', TRACK]]),
}))

const { AiSuggestion } = await import('./AiSuggestion')
const { parse } = await import('../../lib/capture/parse')

import type { ParseContext } from '../../lib/capture/parse'
import type { ValidatedSuggestion } from '../../lib/ai/types'

// EVERY ASSERTION BELOW READS A REAL SHIPPED STRING out of src/locales/en/ai.json
// through the merged bundle, rather than a key. That is deliberate: a component
// test that asserted dot paths would stay green through a namespace that was
// never wired into src/locales/index.ts, which is exactly the failure
// localeReach.test.ts was written for after the Wave-2 SLA keys shipped missing.

const CTX: ParseContext = {
  tracks: [{ id: 't-devqa', name: 'Dev & QA', nameAr: 'التطوير والجودة' }],
  members: [{ id: 'm-sara', displayName: 'Sara Ahmed', username: 'sara' }],
  now: new Date('2026-08-01T09:00:00Z'),
  locale: 'en',
}

const LINE = 'sprint 38 deployment next friday'

const SUGGESTION: ValidatedSuggestion = {
  title: 'Sprint 38 deployment',
  trackId: 't-devqa',
  ownerId: 'm-sara',
  priority: 'high',
  type: 'change',
  dueDate: '2026-08-07',
  followUpDate: null,
  tags: ['portal'],
  dropped: [],
}

function render(line = LINE): string {
  return renderToStaticMarkup(
    <AiSuggestion
      line={line}
      parsed={parse(line, CTX)}
      ctx={CTX}
      onAccept={() => {}}
      onDismiss={() => {}}
    />,
  )
}

describe('AiSuggestion', () => {
  it('renders the row as words, never as fields, ids or tokens', () => {
    fx.state.suggestion = { line: LINE, suggestion: SUGGESTION, model: 'claude-sonnet-5' }
    const html = render()

    // What it understood, in the order it will be written into the line.
    expect(html).toContain('Dev &amp; QA')
    expect(html).toContain('Sara Ahmed')
    expect(html).toContain('High')
    expect(html).toContain('Change')
    expect(html).toContain('7 August 2026')
    // FENCED, and asserted fenced: every interpolated value in this namespace is
    // wrapped in FSI…PDI so a Latin tag inside an Arabic sentence does not drag
    // its `+` to the far side of the word. Asserting the bare string would be
    // asserting the bug lib/bidi.ts exists to have removed.
    expect(html).toContain('+⁨portal⁩')

    // The four things that must NEVER be on screen: an id, a raw token, the
    // model's title, or a field name.
    expect(html).not.toContain('t-devqa')
    expect(html).not.toContain('m-sara')
    expect(html).not.toContain('#&quot;')
    expect(html).not.toContain('Sprint 38 deployment')
    expect(html).not.toContain('trackId')

    // Preview is the badge that earns the "Not right" button beside it.
    expect(html).toContain('Preview')
    expect(html).toContain('Not right')
    expect(html).toContain('Add these')
    expect(html).toContain('Ignore')

    // Three real buttons, so nothing here is pointer-only.
    expect(html.match(/<button/g)).toHaveLength(3)

    // The keyboard contract, said out loud.
    expect(html).toContain('Tab')
    expect(html).toContain('Enter')
  })

  it('announces itself politely, once, with the whole sentence', () => {
    fx.state.suggestion = { line: LINE, suggestion: SUGGESTION, model: 'claude-sonnet-5' }
    const html = render()
    expect(html).toContain('aria-live="polite"')
    expect(html).toContain('role="status"')
    // One region, not one per chip.
    expect(html.match(/aria-live/g)).toHaveLength(1)
    // The summary is fenced by lib/bidi.isolate() because it is assembled in
    // TypeScript out of values whose direction is not known until they resolve.
    expect(html).toMatch(/Suggestion: [⁦-⁩]/u)
  })

  it('shows the owner’s NAME while the line gets the handle', () => {
    fx.state.suggestion = { line: LINE, suggestion: SUGGESTION, model: 'claude-sonnet-5' }
    const html = render()
    expect(html).toContain('for ⁨Sara Ahmed⁩')
    // The handle never reaches the screen; it only ever reaches the line.
    expect(html).not.toContain('⁨sara⁩')
  })

  it('offers only what the line does not already say', () => {
    // A track already on the line must not come back as a chip, because it
    // would not come back as a token either.
    const keyed = 'deploy the switch #"Dev & QA" and check the portal'
    fx.state.suggestion = { line: keyed, suggestion: SUGGESTION, model: 'm' }
    const html = render(keyed)
    expect(html).not.toContain('Dev &amp; QA')
    expect(html).toContain('Sara Ahmed')
  })

  it('renders nothing but the live region when there is no suggestion', () => {
    fx.state.suggestion = null
    fx.state.pending = false
    const html = render()
    expect(html).toContain('aria-live="polite"')
    expect(html).not.toContain('ais-chip')
    expect(html).not.toContain('<button')
  })

  it('holds the slot while it is reading, without a control on it', () => {
    fx.state.suggestion = null
    fx.state.pending = true
    const html = render()
    expect(html).toContain('Reading your line')
    expect(html).toContain('Preview')
    // Nothing to press, and nothing announced: a live region that reported
    // waiting would read a sentence to a screen-reader user on every pause.
    expect(html).not.toContain('<button')
    expect(html).toMatch(/aria-live="polite"><\/p>/)
  })

  it('says nothing at all for a line that already parses', () => {
    // The row is a response to PROSE. A keyed line is already understood, and a
    // second opinion on it is noise.
    fx.state.suggestion = null
    fx.state.pending = true
    const html = render('deploy the switch #"Dev & QA" @sara due:+7d /change')
    expect(html).not.toContain('Reading your line')
  })
})
