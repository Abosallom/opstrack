// Render proof for the capture screen.
//
// WHY renderToStaticMarkup AND NOT A DOM. vitest.config.ts is `environment:
// 'node'` on purpose and the repo's one-new-devDependency budget was spent on
// vitest itself — there is no jsdom and no testing-library. react-dom/server
// needs neither: it runs the real component, the real hooks, the real parser and
// the real translator, and hands back markup to assert on. What it cannot see is
// events, which is why the line under test arrives through `/capture?q=…` — the
// same seed a Wave-4 hotkey or palette entry will use, so the test exercises a
// shipped path rather than a test-only hatch.
//
// WHAT THIS FILE IS ACTUALLY FOR. Three failure classes that no other test in
// the repo can catch:
//
//  1. The screen crashing on mount. `lib/capture/parse` is total, but the
//     ASSEMBLY around it — a chip renderer indexing a Record by TokenKind, a
//     resolver reaching into a Map that has not loaded — is not, and this is the
//     one screen the product cannot ship without.
//  2. A locale key that does not resolve. `t()` falls back to the key itself, so
//     a typo renders `capture.chipTrack` at the user instead of failing
//     anything. Every assertion below runs in BOTH languages and the markup is
//     checked for stray dot-paths.
//  3. A PLACEHOLDER MISMATCH between the parser and the strings. `parse()`
//     reports `capture.newOwner` with `{ name }` while the string shipped with
//     `{value}`, and `capture.warnDuplicate` with `{ kind }` against `{field}` —
//     both rendered the literal brace text at the user, and both were invisible
//     to the locale parity test (which compares en against ar, not either
//     against its caller). The problems assertions below are that regression.
//
// The four stores are mocked because they touch localStorage, `window` and the
// Supabase client at module init; `components/entry` is mocked because the kit
// has its own render proof and because it is being edited by another worker for
// the length of this wave. Everything else is real: the real parser, the real
// `lib/dates`, the real `trackVars()`, the real `t()`.

import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import type { ReactElement } from 'react'
import type { Track } from '../types'
import { stripIsolates } from '../lib/bidi'

const fx = vi.hoisted(() => {
  // lib/i18n reads localStorage at module scope. Installed in vi.hoisted because
  // that runs before the import graph is evaluated; a beforeAll() is far too
  // late. Shimming it keeps the REAL translator in the test, which is the whole
  // point of failure class 2 above.
  const mem = new Map<string, string>()
  ;(globalThis as { localStorage?: Storage }).localStorage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => void mem.set(k, v),
    removeItem: (k: string) => void mem.delete(k),
    clear: () => mem.clear(),
    key: (i: number) => [...mem.keys()][i] ?? null,
    get length() {
      return mem.size
    },
  } as Storage

  // setLocale() pushes `lang`/`dir` onto <html> before notifying its listeners —
  // that is what drives every logical property in the app, so it is not
  // optional and not worth stubbing out of i18n. Two writable fields are the
  // whole surface it touches; react-dom/server never looks at `document` at all.
  ;(globalThis as { document?: Document }).document = {
    documentElement: { lang: '', dir: '' },
  } as Document

  const track = (
    id: string,
    name: string,
    nameAr: string,
    color: string,
    suggested: string[] = [],
  ): Track => ({
    id,
    name,
    name_ar: nameAr,
    description: '',
    description_ar: '',
    color,
    color_light: '#9c6600',
    icon: 'network',
    suggested_tags: suggested,
    sort_order: 1,
    archived: false,
    archived_at: null,
    created_by: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  })

  // The seeded workspace, verbatim from 0001/0004 — the same fixture list
  // parse.test.ts uses, so an alias that resolves there resolves here.
  const tracks: Track[] = [
    track('t-pmo', 'PMO', 'مكتب إدارة المشاريع', '#8b7bf5'),
    track('t-ito', 'IT Operations', 'عمليات تقنية المعلومات', '#22b8d6'),
    track('t-net', 'Network', 'الشبكات', '#e0a020'),
    track('t-inf', 'Infrastructure', 'البنية التحتية', '#46c26a'),
    track('t-sre', 'SRE', 'هندسة موثوقية الأنظمة', '#f2678f'),
    track('t-onb', 'Onboarding', 'الانضمام', '#45aef2', ['direct-integration', 'portal']),
  ]

  return { tracks }
})

vi.mock('../store/config', () => ({
  useActiveTracks: () => fx.tracks,
  useTrackMap: () => new Map(fx.tracks.map((tr) => [tr.id, tr])),
}))

// The roster carries USERNAMES, because the live one does: `listMembers()` reads
// `member_directory()` and every provisioned account has a handle. A fixture
// without them cannot see the wiring failure this file exists to catch — see the
// `@handle` case in "a line that parses".
vi.mock('../store/members', () => ({
  loadMembers: () => Promise.resolve(),
  useMembers: () => [
    { id: 'm-ahmed', displayName: 'Ahmed Al-Otaibi', role: 'member', username: 'ahmed.otaibi' },
    { id: 'm-sara', displayName: 'Sara Nasser', role: 'member', username: 'sara.nasser' },
  ],
  useMemberLabel: () => () => 'Ahmed Al-Otaibi',
}))

vi.mock('../store/vocab', () => ({
  // No admin renames in the fixture: the parser's own alias tables have to carry
  // `!high` and `!عاجل` unaided, which is exactly what should be proven.
  getVocabSnapshot: () => ({ rows: [], loadedAt: 1 }),
  useVocabAll: () => [],
  useVocabLabel: () => (_kind: string, key: string) => key,
}))

vi.mock('../store/entries', () => ({
  createEntryOptimistic: () => Promise.resolve({ ok: false, error: 'common.error' }),
  loadEntries: () => Promise.resolve(),
  undoCapture: () => Promise.resolve({ ok: true, data: null }),
  useEntry: () => undefined,
  useEntryHealth: () => undefined,
  usePendingOp: () => undefined,
}))

vi.mock('../store/outbox', () => ({
  getOutboxSnapshot: () => [],
}))

// The kit has its own render proof (components/entry/atoms.test.tsx), and the
// session list is empty in every case below — mocking the barrel keeps this file
// from importing EntrySheet/UpdateThread, which another worker owns this wave.
vi.mock('../components/entry', () => ({
  EntryRow: (): ReactElement | null => null,
}))

const { default: Capture } = await import('./Capture')
const { setLocale } = await import('../lib/i18n')

/** The screen at `/capture?q=<line>`, as static markup. */
function render(line: string): string {
  const search = line === '' ? '' : `?q=${encodeURIComponent(line)}`
  return renderToStaticMarkup(
    <MemoryRouter initialEntries={[`/capture${search}`]}>
      <Capture />
    </MemoryRouter>,
  )
}

/** Render the same line in both languages. */
function bilingual(line: string): { en: string; ar: string } {
  setLocale('en')
  const en = render(line)
  setLocale('ar')
  const ar = render(line)
  setLocale('en')
  return { en, ar }
}

/**
 * Every `capture.*` key the screen can render, as it would appear if `t()` fell
 * through to the key. `t()` returns the key itself when a lookup misses, so this
 * is the only way a missing string announces itself.
 */
function untranslated(html: string): string[] {
  return [...new Set(html.match(/\bcapture\.[a-zA-Z]+/g) ?? [])]
}

/** The title fragment — everything the tokens did not consume. */
function plainOf(html: string): string {
  return /<span class="cap-read-plain">([^<]*)<\/span>/.exec(html)?.[1] ?? ''
}

/**
 * The markup with the four bidi isolates removed, for assertions about WORDS.
 *
 * The en/ locale tree fences every user-value interpolation with FSI…PDI, the
 * same way ar/ does — the value can be Arabic whatever language the sentence is
 * in (see lib/bidi.test.ts). Those controls are invisible and correct, and a
 * `toContain('Creates one item in Network.')` that fails on them is asserting
 * the fence, not the sentence. Assertions that are ABOUT direction keep reading
 * the raw markup.
 */
function words(html: string): string {
  return stripIsolates(html)
}

describe('Capture — empty', () => {
  it('mounts and offers its empty states in both languages', () => {
    const { en, ar } = bilingual('')
    for (const html of [en, ar]) {
      expect(untranslated(html)).toEqual([])
      // The reading strip and the session list each say something rather than
      // rendering a blank box — the polish mandate's "real empty states".
      expect(html).toContain('cap-read-empty')
      expect(html).toContain('cap-empty')
      // Nothing to capture, so the control that would capture it is off.
      expect(html).toMatch(/class="btn btn-primary cap-submit"[^>]*disabled/)
    }
    expect(en).toContain('Start typing to see what gets created.')
    expect(ar).toContain('ابدأ الكتابة لترى ما سيُنشأ.')
  })

  it('carries no chips, no problems and no preview line', () => {
    const html = render('')
    expect(html).not.toContain('cap-chip')
    expect(html).not.toContain('cap-problems')
    expect(html).not.toContain('cap-preview')
  })
})

describe('Capture — a line that parses', () => {
  const LINE = 'Firewall rule DC2 #network @ahmed !high due:thu'

  it('shows the title as plain text and every token as a resolved chip', () => {
    const html = render(LINE)
    // The title is what SURVIVES the tokens — the consume rule, made visible.
    // Asserted on the plain fragment alone, because the tokens are of course
    // still in the input's own value (and in each chip's remove label): the box
    // holds the line the user typed, the strip holds what it MEANT.
    expect(plainOf(html)).toBe('Firewall rule DC2')

    for (const kind of ['track', 'owner', 'priority', 'due']) {
      expect(html).toContain(`data-kind="${kind}" data-ok="true"`)
    }
    // The owner chip carries the RESOLVED display name, not the handle typed.
    expect(html).toContain('Ahmed Al-Otaibi')
    // Nothing went wrong, so nothing is reported.
    expect(html).not.toContain('cap-problems')
    expect(html).not.toContain('data-ok="false"')
  })

  it('resolves the USERNAME people are handed, not just the display name', () => {
    // The wiring, pinned where no parser test can reach it: this screen builds
    // the parser's member list by hand, and v1.0.0 built it out of `id` and
    // `displayName` alone. The parser could match handles all day; the field
    // never arrived. `@ahmed.otaibi` is not a prefix of any display name here,
    // so it resolves ONLY if Capture.tsx passes `username` through.
    const html = render('Firewall rule DC2 #network @ahmed.otaibi !high')
    expect(html).toContain('data-kind="owner" data-ok="true"')
    // The chip shows the person, not the handle that was typed.
    expect(html).toContain('Ahmed Al-Otaibi')
    // No "new owner" line: this is an assignment, not a free-text vendor.
    expect(html).not.toContain('cap-problems')
  })

  it('paints the track chip in the track’s own colour', () => {
    const html = render(LINE)
    // Both stored hexes, on the wrapper, for global.css to choose between —
    // never one hex picked in JS. See lib/trackStyle.ts.
    expect(html).toContain('--track-c-dark:#e0a020')
    expect(html).toContain('--track-c-light:#9c6600')
    expect(html).toContain('track-dot')
  })

  it('enables the submit control and says what Enter will do', () => {
    const { en, ar } = bilingual(LINE)
    expect(en).not.toMatch(/cap-submit"[^>]*disabled/)
    expect(words(en)).toContain('Creates one item in Network.')
    expect(ar).toContain('الشبكات')
    for (const html of [en, ar]) expect(untranslated(html)).toEqual([])
  })

  it('files a line with no track under no track', () => {
    const html = render('Chase the vendor about the switch RMA')
    expect(html).toContain('Creates one item with no track.')
    expect(html).toContain('No tokens yet.')
  })
})

describe('Capture — Arabic', () => {
  it('resolves an Arabic track name, an Arabic priority and an Arabic date', () => {
    setLocale('ar')
    const html = render('ترقية سويتش الكور #الشبكات @ahmed !عاجل due:الخميس')
    setLocale('en')
    expect(html).toContain('ترقية سويتش الكور')
    for (const kind of ['track', 'owner', 'priority', 'due']) {
      expect(html).toContain(`data-kind="${kind}" data-ok="true"`)
    }
    // The Arabic name, because the UI is Arabic — trackLabel() picks name_ar.
    expect(html).toContain('الشبكات')
    expect(html).not.toContain('data-ok="false"')
  })

  it('resolves the SINGULAR الشبكة against the plural seed, via the stem clause', () => {
    setLocale('ar')
    const html = render('مراجعة #الشبكة')
    setLocale('en')
    expect(html).toContain('data-kind="track" data-ok="true"')
  })

  it('does not read a track name out of ordinary title text', () => {
    setLocale('ar')
    const html = render('اجتماع مراجعة الشبكة due:غدا')
    setLocale('en')
    // Only sigils match. The bare word inside the title is just words.
    expect(html).not.toContain('data-kind="track"')
    expect(html).toContain('data-kind="due" data-ok="true"')
  })

  it('parses the two-word date its OWN hint teaches, unquoted', () => {
    // `capture.hintDates` (ar) lists `نهاية الأسبوع` inline and unquoted, where
    // the English twin lists the single token `eow`. Typing what the screen
    // teaches used to strip the date, report `capture.errDate` and glue the
    // orphaned `الأسبوع` onto the title — "مراجعة العقد الأسبوع". The hint and
    // the grammar are two files that had no way to notice they disagreed; this
    // is the assertion that notices.
    setLocale('ar')
    const html = render('مراجعة العقد due:نهاية الأسبوع')
    setLocale('en')
    expect(html).toContain('data-kind="due" data-ok="true"')
    expect(html).not.toContain('data-ok="false"')
    expect(plainOf(words(html))).toBe('مراجعة العقد')
  })

  it('parses the cadence its OWN chip prints as that cadence\'s name', () => {
    // `capture.cadenceBiweekly` DISPLAYS `كل أسبوعين`. Typing back what the app
    // shows has to work, and did not.
    setLocale('ar')
    const html = render('مراجعة السعة every:كل أسبوعين')
    setLocale('en')
    expect(html).toContain('data-kind="recurring" data-ok="true"')
    expect(plainOf(words(html))).toBe('مراجعة السعة')
  })
})

describe('Capture — problems', () => {
  const GARBAGE = '#nope @Fatimah !urgent-ish due:someday /nope'

  it('interpolates every problem string — no literal {placeholder} survives', () => {
    const { en, ar } = bilingual(GARBAGE)
    for (const html of [en, ar]) {
      expect(html).toContain('cap-problems')
      // THE REGRESSION. `newOwner` reports { name } and used to be worded with
      // {value}; `warnDuplicate` reports { kind } against {field}. Both rendered
      // the braces at the user. i18n leaves an unknown placeholder verbatim
      // precisely so it can be caught here.
      expect(html).not.toMatch(/\{(value|name|kind|field|count|token|track|title|tag|days)\}/)
      expect(untranslated(html)).toEqual([])
    }
    // The values the parser reported, in the sentences that describe them.
    expect(en).toContain('nope')
    expect(en).toContain('Fatimah')
    expect(en).toContain('urgent-ish')
    expect(en).toContain('someday')
  })

  it('marks the failed tokens and keeps the unresolved closed-vocabulary ones in the title', () => {
    const html = render(GARBAGE)
    expect(html).toContain('data-kind="track" data-ok="false"')
    expect(html).toContain('data-kind="due" data-ok="false"')
    // `!urgent-ish` and `/nope` did not resolve, so they stay title text, while
    // `#nope`, `@Fatimah` and `due:someday` are consumed whether they resolved
    // or not — the consume rule's two halves, in one assertion.
    expect(plainOf(html)).toBe('!urgent-ish /nope')
    // A title survived, so the line is still capturable.
    expect(html).not.toMatch(/cap-submit"[^>]*disabled/)
  })

  it('names the duplicated FIELD in a human word, not a TokenKind', () => {
    const html = render('#pmo Kickoff deck #network !low !critical')
    expect(words(html)).toContain('Track was set twice')
    expect(words(html)).toContain('Priority was set twice')
    expect(words(html)).not.toContain('track was set twice')
  })

  it('offers a two-option picker for an ambiguous track', () => {
    const html = render('#i Rebuild jump host')
    expect(html).toContain('cap-pick')
    expect(html).toContain('Which track?')
    expect(html).toContain('Infrastructure')
    expect(html).toContain('IT Operations')
  })

  it('flags a title long enough to be unreadable in a list', () => {
    const html = render('x'.repeat(120))
    expect(html).toContain('Long titles are hard to scan in lists.')
  })
})

describe('Capture — suggested tags', () => {
  it('offers the parsed track’s suggested tags', () => {
    const { en, ar } = bilingual('#onboarding New vendor portal access')
    for (const html of [en, ar]) {
      expect(html).toContain('cap-suggest')
      expect(html).toContain('direct-integration')
      expect(html).toContain('portal')
      expect(untranslated(html)).toEqual([])
    }
  })

  it('drops a suggestion the line already carries', () => {
    const html = render('#onboarding New vendor portal access +portal')
    expect(words(html)).toContain('Add the tag direct-integration')
    // `portal` is on the line, so it is a chip and no longer an offer.
    expect(html).toContain('data-kind="tag" data-ok="true"')
    expect(html).not.toContain('Add the tag portal')
  })

  it('offers nothing when the track has no suggestions', () => {
    const html = render('#network Core switch upgrade')
    expect(html).not.toContain('cap-suggest')
  })
})

describe('Capture — recurrence', () => {
  const LINE = 'Capacity review #network every:weekly @ahmed'

  // A repeat rule is SUBMITTABLE — it writes `recurring_templates` instead of
  // `entries`. It used to disable the button and say the feature shipped "in a
  // later release", with /settings/recurring already live and this screen's own
  // hints teaching the token.
  it('accepts a repeat rule and says which table it lands in', () => {
    const { en, ar } = bilingual(LINE)
    for (const html of [en, ar]) {
      expect(html).toContain('data-kind="recurring" data-ok="true"')
      expect(html).not.toMatch(/cap-submit"[^>]*disabled/)
      expect(html).toContain('cap-notice')
      // The way to the screen that owns what this line creates.
      expect(html).toContain('cap-notice-link')
      expect(untranslated(html)).toEqual([])
    }
    expect(en).toContain('Creates a repeating item, not a one-off.')
    expect(en).toContain('Manage repeating items')
    expect(en).toContain('Weekly')
    expect(ar).toContain('أسبوعيًا')
  })

  it('labels a custom interval with its day count', () => {
    const html = render('Backup check every:10d')
    expect(html).toContain('Every 10 days')
  })
})
