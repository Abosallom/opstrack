// Render proof for the capture bar on the map.
//
// THIS IS pages/Capture.test.tsx REWRITTEN, NOT REPLACED. Every guarantee that
// file pinned is restated here against the new structure, because the screen it
// covered is being deleted and the guarantees are not. Where a case asserted
// something that only a PAGE can have — a route seed, an empty-preview strip, a
// session list — it is replaced by the equivalent assertion about the bar rather
// than dropped. New here: the sheet that did not exist, the cheatsheet and the
// suggested tags that moved off that page, the keyboard boundary against the
// map, and the module-level seams the shell compiles against.
//
// WHY renderToStaticMarkup AND NOT A DOM. `vitest.config.ts` is
// `environment: 'node'` on purpose and the repo's one-new-devDependency budget
// was spent on vitest itself — there is no jsdom and no testing-library.
// `react-dom/server` needs neither: it runs the real component, the real hooks,
// the real parser and the real translator, and hands back markup to assert on.
// What it cannot see is events, which is why the line under test arrives as
// `initialLine`, a prop whose own doc comment says it exists for this and
// nothing else.
//
// WHAT IS THEREFORE NOT COVERED HERE, stated rather than implied: anything that
// needs a layout or a gesture. The bar being FIXED to the block end on a phone,
// the visual order inverting so the keyboard covers only the input, the 44px hit
// overlays, and the height this component publishes to the phone sheet are all
// real behaviour that this file can only assert the SOURCE of — vitest replaces
// every CSS request with an empty module under `environment: 'node'`, so the
// sheet's own text is unreadable from here (see the map-capture.css block at the
// bottom). Those four were checked by reading, not by running.
//
// WHAT THIS FILE IS ACTUALLY FOR. The same three failure classes, plus one:
//
//  1. The bar crashing on mount. `lib/capture/parse` is total, but the ASSEMBLY
//     around it — a chip renderer indexing a Record by TokenKind, a resolver
//     reaching into a Map that has not loaded — is not, and this component is
//     now mounted on the app's ONLY screen.
//  2. A locale key that does not resolve. `t()` falls back to the key itself, so
//     a typo renders `capture.chipTrack` at the user instead of failing
//     anything. Every assertion below runs in BOTH languages and the markup is
//     checked for stray dot-paths.
//  3. A PLACEHOLDER MISMATCH between the parser and the strings — `newOwner`
//     reporting `{ name }` against a string worded `{value}`. Invisible to the
//     parity test, which compares en to ar and neither to its caller.
//  4. NEW: THE SHEET. `MapCapture.tsx` imported `./map-capture.css` for its
//     whole life while that file did not exist, and nothing caught it because
//     the component was imported by nobody — an unreferenced import is never
//     resolved. It is mounted now, so this file imports the sheet itself: the
//     import is the assertion, and the class-coverage case below is what
//     notices a class that outran it.
//
// The five stores are mocked because they touch localStorage, `window` and the
// Supabase client at module init. Everything else is real: the real parser, the
// real `lib/dates`, the real `trackVars()`, the real `t()`, the real AI row
// (which renders nothing without a suggestion, and proving that is part of the
// point).

import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import type { Track } from '../../types'
import { stripIsolates } from '../../lib/bidi'
import { isTypingTarget } from '../../lib/hotkeys'
// NOT DECORATION — this is the assertion. `MapCapture.tsx` imported this sheet
// for its whole life while the file did not exist, and nothing noticed because
// the component was imported by nobody. Importing it here means the sheet going
// missing fails this test file at transform time instead of failing `vite build`
// on the integrator's machine. Vitest stubs the module's contents (see the
// map-capture.css block at the bottom); the RESOLUTION is the point.
import './map-capture.css'

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
  // that is what drives every logical property in the app, so it is not optional
  // and not worth stubbing out of i18n. Two writable fields are the whole
  // surface it touches; react-dom/server never looks at `document` at all.
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

vi.mock('../../store/config', () => ({
  useActiveTracks: () => fx.tracks,
  useTrackMap: () => new Map(fx.tracks.map((tr) => [tr.id, tr])),
}))

// The roster carries USERNAMES, because the live one does: `listMembers()` reads
// `member_directory()` and every provisioned account has a handle. A fixture
// without them cannot see the wiring failure this file exists to catch — see the
// `@handle` case in "a line that parses".
vi.mock('../../store/members', () => ({
  loadMembers: () => Promise.resolve(),
  useMembers: () => [
    { id: 'm-ahmed', displayName: 'Ahmed Al-Otaibi', role: 'member', username: 'ahmed.otaibi' },
    { id: 'm-sara', displayName: 'Sara Nasser', role: 'member', username: 'sara.nasser' },
  ],
  useMemberLabel: () => () => 'Ahmed Al-Otaibi',
}))

vi.mock('../../store/vocab', () => ({
  // No admin renames in the fixture: the parser's own alias tables have to carry
  // `!high` and `!عاجل` unaided, which is exactly what should be proven.
  getVocabSnapshot: () => ({ rows: [], loadedAt: 1 }),
  useVocabAll: () => [],
  useVocabLabel: () => (_kind: string, key: string) => key,
}))

vi.mock('../../store/entries', () => ({
  createEntryOptimistic: () => Promise.resolve({ ok: false, error: 'common.error' }),
  undoCapture: () => Promise.resolve({ ok: true, data: null }),
}))

vi.mock('../../store/outbox', () => ({
  getOutboxSnapshot: () => [],
}))

const { default: MapCapture, confirmationFor, focusMapCapture } = await import('./MapCapture')
const { setLocale, t } = await import('../../lib/i18n')
const { parse } = await import('../../lib/capture/parse')

/* ─────────────────────── the component and the sheet, as text ──────────────── */

// Eager + ?raw, the same mechanism localeReach.test.ts uses: it is how a node
// test reads its own subject as text. Three cases below are source assertions
// about promises this component makes that no rendered markup can show — that it
// binds no document listener, that every Escape branch consumes the key, and
// that it publishes its own height to the phone sheet. If the glob ever resolved
// to nothing, `SOURCE` would be '' and all three would fail loudly rather than
// pass vacuously.
const COMPONENT_SRC: Record<string, string> = import.meta.glob('./MapCapture.tsx', {
  query: '?raw',
  import: 'default',
  eager: true,
})
const SOURCE = COMPONENT_SRC['./MapCapture.tsx'] ?? ''

/** Every `.mcap-*` name in a file, whether it is a class or a custom property. */
function mcapNames(text: string): Set<string> {
  return new Set(text.match(/mcap-[a-z0-9-]+/g) ?? [])
}

/* ──────────────────────────────── render helpers ───────────────────────────── */

/** The bar, mounted on the map's route, as static markup. */
function render(line: string): string {
  return renderToStaticMarkup(
    <MemoryRouter initialEntries={['/mindtree']}>
      <MapCapture initialLine={line} />
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
 * Every `capture.*` key the bar can render, as it would appear if `t()` fell
 * through to the key. `t()` returns the key itself when a lookup misses, so this
 * is the only way a missing string announces itself.
 */
function untranslated(html: string): string[] {
  return [...new Set(html.match(/\bcapture\.[a-zA-Z]+/g) ?? [])]
}

/** The title fragment — everything the tokens did not consume. */
function plainOf(html: string): string {
  return /<span class="mcap-read-plain">([^<]*)<\/span>/.exec(html)?.[1] ?? ''
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

/* ══════════════════════════════════ at rest ══════════════════════════════════ */
//
// REPLACES pages/Capture.test.tsx's two "empty" cases. That screen proved its
// empty states by rendering `capture.previewEmpty` and `capture.recentEmpty` in
// a reading strip and a session list that were always present. This bar has
// neither on purpose: at rest it is one input, one button, one line of hint and
// one ghost disclosure, because on a map screen every idle block costs canvas.
// The guarantee those cases were defending — "the surface says what it is for
// before anything is typed, and cannot be submitted empty" — is restated here.

describe('MapCapture — at rest', () => {
  it('mounts, says what it is for and refuses to submit, in both languages', () => {
    const { en, ar } = bilingual('')
    for (const html of [en, ar]) {
      expect(untranslated(html)).toEqual([])
      // Named as a landmark, so a reader on a map screen can jump to it.
      expect(html).toContain('class="mcap"')
      // The placeholder teaches the grammar and the hint says what Enter does.
      expect(html).toContain('mcap-hint')
      expect(html).toContain('mcap-input')
      // Nothing to capture, so the control that would capture it is off.
      expect(html).toMatch(/class="btn btn-primary mcap-submit"[^>]*disabled/)
      // The cheatsheet is reachable without typing anything at all.
      expect(html).toContain('mcap-hints-toggle')
    }
    expect(en).toContain('One line in.')
    expect(ar).toContain('سطر واحد يكفي.')
  })

  it('draws nothing else at all — no chips, no problems, no strip, no notice', () => {
    const html = render('')
    expect(html).not.toContain('mcap-chip')
    expect(html).not.toContain('mcap-problems')
    expect(html).not.toContain('mcap-read')
    expect(html).not.toContain('mcap-notice')
    expect(html).not.toContain('mcap-kept')
    expect(html).not.toContain('mcap-clear')
  })

  it('is a plain <section>, so nothing it renders is inside the map’s <svg>', () => {
    // The keyboard boundary starts as a DOM fact: `useMapKeyboard`'s handler is
    // a React onKeyDown on the <svg> and React events bubble through the SVG
    // subtree only. A composer rendered as a sibling of the canvas — which is
    // what pages/Mindtree.tsx does — is therefore inert to the map's grammar.
    const html = render('Firewall rule DC2 #network')
    expect(html.startsWith('<section class="mcap"')).toBe(true)
    expect(html).not.toContain('<svg')
  })
})

/* ═══════════════════════════ a line that parses ══════════════════════════════ */

describe('MapCapture — a line that parses', () => {
  const LINE = 'Firewall rule DC2 #network @ahmed !high due:thu'

  it('shows the title as plain text and every token as a resolved chip', () => {
    const html = render(LINE)
    // The title is what SURVIVES the tokens — the consume rule, made visible.
    // Asserted on the plain fragment alone, because the tokens are of course
    // still in the input's own value (and in each chip's remove label): the box
    // holds the line typed, the strip holds what it MEANT.
    expect(plainOf(html)).toBe('Firewall rule DC2')

    for (const kind of ['track', 'owner', 'priority', 'due']) {
      expect(html).toContain(`data-kind="${kind}" data-ok="true"`)
    }
    // The owner chip carries the RESOLVED display name, not the handle typed.
    expect(html).toContain('Ahmed Al-Otaibi')
    // Nothing went wrong, so nothing is reported.
    expect(html).not.toContain('mcap-problems')
    expect(html).not.toContain('data-ok="false"')
  })

  it('resolves the USERNAME people are handed, not just the display name', () => {
    // The wiring, pinned where no parser test can reach it: this component
    // builds the parser's member list by hand, and the version of that code on
    // /capture built it out of `id` and `displayName` alone. The parser could
    // match handles all day; the field never arrived. `@ahmed.otaibi` is not a
    // prefix of any display name here, so it resolves ONLY if `username` is
    // passed through.
    const html = render('Firewall rule DC2 #network @ahmed.otaibi !high')
    expect(html).toContain('data-kind="owner" data-ok="true"')
    expect(html).toContain('Ahmed Al-Otaibi')
    // No "new owner" line: this is an assignment, not a free-text vendor.
    expect(html).not.toContain('mcap-problems')
  })

  it('paints the track chip in the track’s own colour', () => {
    const html = render(LINE)
    // Both stored hexes, on the wrapper, for the sheet to choose between —
    // never one hex picked in JS. See lib/trackStyle.ts.
    expect(html).toContain('--track-c-dark:#e0a020')
    expect(html).toContain('--track-c-light:#9c6600')
    expect(html).toContain('track-dot')
  })

  it('enables the submit control and says what Enter will do', () => {
    const { en, ar } = bilingual(LINE)
    expect(en).not.toMatch(/mcap-submit"[^>]*disabled/)
    expect(words(en)).toContain('Creates one item in Network.')
    expect(ar).toContain('الشبكات')
    for (const html of [en, ar]) expect(untranslated(html)).toEqual([])
  })

  it('files a line with no track under no track', () => {
    // REPLACES the `capture.chipNone` assertion. The page drew "No tokens yet."
    // into an always-present strip; this bar unmounts the strip instead, so the
    // fact being asserted is the sentence that says where the row will land.
    const html = render('Chase the vendor about the switch RMA')
    expect(html).toContain('Creates one item with no track.')
    expect(plainOf(html)).toBe('Chase the vendor about the switch RMA')
    expect(html).not.toContain('mcap-chip')
  })

  it('offers a way to clear the line as soon as there is one', () => {
    expect(render('anything')).toContain('mcap-clear')
    expect(render('')).not.toContain('mcap-clear')
  })
})

/* ═════════════════════════════════ Arabic ════════════════════════════════════ */

describe('MapCapture — Arabic', () => {
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

  it('parses the two-word date its OWN cheatsheet teaches, unquoted', () => {
    // `capture.hintDates` (ar) lists `نهاية الأسبوع` inline and unquoted, where
    // the English twin lists the single token `eow`. Typing what the surface
    // teaches used to strip the date, report `capture.errDate` and glue the
    // orphaned `الأسبوع` onto the title. The hint and the grammar are two files
    // that had no way to notice they disagreed; this is the assertion that
    // notices — and it matters MORE now, because the cheatsheet moved onto this
    // component and is the only copy left.
    setLocale('ar')
    const html = render('مراجعة العقد due:نهاية الأسبوع')
    setLocale('en')
    expect(html).toContain('data-kind="due" data-ok="true"')
    expect(html).not.toContain('data-ok="false"')
    expect(plainOf(words(html))).toBe('مراجعة العقد')
  })

  it('parses the cadence its OWN chip prints as that cadence’s name', () => {
    // `capture.cadenceBiweekly` DISPLAYS `كل أسبوعين`. Typing back what the app
    // shows has to work, and did not.
    setLocale('ar')
    const html = render('مراجعة السعة every:كل أسبوعين')
    setLocale('en')
    expect(html).toContain('data-kind="recurring" data-ok="true"')
    expect(plainOf(words(html))).toBe('مراجعة السعة')
  })
})

/* ════════════════════════════════ problems ═══════════════════════════════════ */

describe('MapCapture — problems', () => {
  const GARBAGE = '#nope @Fatimah !urgent-ish due:someday /nope'

  it('interpolates every problem string — no literal {placeholder} survives', () => {
    const { en, ar } = bilingual(GARBAGE)
    for (const html of [en, ar]) {
      expect(html).toContain('mcap-problems')
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
    expect(html).not.toMatch(/mcap-submit"[^>]*disabled/)
  })

  it('offers a Fix per failed token, and the Fix names the token it will select', () => {
    // The control SELECTS the token's span rather than deleting it: the reader
    // typed `due:someday` because they meant a date, so the attempt is the
    // intent and a control that silently removes it loses both. The markup can
    // only show that the button exists and says which token it is about; the
    // selection itself is `setSelectionRange`, which no node test can observe.
    const html = render(GARBAGE)
    expect(html).toContain('mcap-problem-fix')
    expect(words(html)).toContain('Fix due:someday')
  })

  it('names the duplicated FIELD in a human word, not a TokenKind', () => {
    const html = render('#pmo Kickoff deck #network !low !critical')
    expect(words(html)).toContain('Track was set twice')
    expect(words(html)).toContain('Priority was set twice')
    expect(words(html)).not.toContain('track was set twice')
  })

  it('offers a two-option picker for an ambiguous track', () => {
    const html = render('#i Rebuild jump host')
    expect(html).toContain('mcap-pick')
    expect(html).toContain('Which track?')
    expect(html).toContain('Infrastructure')
    expect(html).toContain('IT Operations')
  })

  it('flags a title long enough to be unreadable in a list', () => {
    const html = render('x'.repeat(120))
    expect(html).toContain('Long titles are hard to scan in lists.')
  })

  it('gives every chip a remove control that names its own token', () => {
    const html = render('Firewall rule DC2 #network')
    expect(html).toContain('mcap-chip-x')
    expect(words(html)).toContain('Remove #network')
  })
})

/* ═════════════════════════════ suggested tags ════════════════════════════════ */
//
// These three cases came off pages/Capture.test.tsx unchanged in substance. The
// feature moved onto the bar rather than dying with the page: one tap is the
// whole of it, and re-typing a two-word tag by hand is not the same job.

describe('MapCapture — suggested tags', () => {
  it('offers the parsed track’s suggested tags', () => {
    const { en, ar } = bilingual('#onboarding New vendor portal access')
    for (const html of [en, ar]) {
      expect(html).toContain('mcap-suggest')
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
    expect(words(html)).not.toContain('Add the tag portal')
  })

  it('offers nothing when the track has no suggestions', () => {
    const html = render('#network Core switch upgrade')
    expect(html).not.toContain('mcap-suggest')
  })
})

/* ═══════════════════════════════ recurrence ══════════════════════════════════ */

describe('MapCapture — recurrence', () => {
  const LINE = 'Capacity review #network every:weekly @ahmed'

  // A repeat rule is SUBMITTABLE — it writes `recurring_templates` instead of
  // `entries`. It used to disable the button and say the feature shipped "in a
  // later release", with /settings/recurring already live and this box's own
  // placeholder teaching the token.
  it('accepts a repeat rule and says which table it lands in', () => {
    const { en, ar } = bilingual(LINE)
    for (const html of [en, ar]) {
      expect(html).toContain('data-kind="recurring" data-ok="true"')
      expect(html).not.toMatch(/mcap-submit"[^>]*disabled/)
      expect(html).toContain('mcap-notice')
      // The way to the screen that owns what this line creates. A template never
      // appears on the map, and a reader who does not know that watches for a
      // node that is never coming.
      expect(html).toContain('mcap-notice-link')
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

/* ════════════════════════════ the token cheatsheet ═══════════════════════════ */

describe('MapCapture — the cheatsheet that moved off the page', () => {
  it('teaches all twelve tokens and all three examples, in both languages', () => {
    const { en, ar } = bilingual('')
    for (const html of [en, ar]) {
      expect(untranslated(html)).toEqual([])
      expect(html).toContain('mcap-hints-body')
      expect(html).toContain('mcap-example')
      // Twelve <li> in the list, one per token family. A key that went missing
      // would render its own dot path and be caught by untranslated() above;
      // a LINE that went missing would not, which is what this counts.
      expect((html.match(/<li>/g) ?? []).length).toBe(12)
      expect((html.match(/class="mcap-example"/g) ?? []).length).toBe(3)
    }
    expect(en).toContain('#track')
    expect(en).toContain('every:weekly')
    expect(ar).toContain('#المسار')
  })

  it('is collapsed until it is asked for', () => {
    const html = render('')
    expect(html).toMatch(/class="mcap-hints-body"[^>]*hidden/)
    expect(html).toContain('aria-expanded="false"')
  })

  it('renders the examples ISOLATED, so the grammar does not read back-to-front', () => {
    // Under `dir="rtl"` the Unicode algorithm resolves the neutral sigils from
    // their neighbours: `@sara` renders as `sara@` and `due:+7d +portal` comes
    // out in the opposite order. These lines ARE the grammar being taught, so a
    // lesson that reads backwards teaches the wrong thing. Asserted on the RAW
    // markup, because it is the isolate itself that is the subject.
    setLocale('ar')
    const html = render('')
    setLocale('en')
    // U+2066 LRI, written by lib/bidi.isolateTokens() around the Latin runs.
    expect(html).toContain('⁦')
    // …and the locale strings themselves stay isolate-free where the parser can
    // see them: the raw string is what setText() hands to parse(), which must
    // never see U+2066.
    expect(t('capture.exampleFull')).not.toContain('⁦')
  })
})

/* ══════════ R2-PRODUCT-2 · the confirmation carries the parse outcome ══════════ */
//
// WHAT BROKE. `canSubmit()` asks for a non-empty title and nothing else
// (lib/capture/parse), so a line whose owner and date both failed to resolve is
// written exactly like a line that parsed perfectly — and `raiseCaptured` never
// read `problems`, so it always raised `tone: 'success'` with an Undo button.
// Meanwhile `setText('')` runs BEFORE the await, which unmounts the problems
// panel in the same frame. The user pressed the key the hint tells them to
// press, watched the warnings vanish, and got a green tick over an item with no
// owner, no due date and a stray word welded onto its title.
//
// WHY THE DECISION IS A FUNCTION, AND WHY IT IS EXPORTED. vitest is
// `environment: 'node'`, so nothing inside an event handler is reachable from a
// test here. The lift is what makes the branch that did not exist assertable at
// all. These ten assertions are pages/Capture.test.tsx:462's, restated against
// this component's copy of the decision — the copy the handoff asks the
// integrator to promote into `src/lib/capture/confirm.ts` and import from both.

describe('MapCapture — the confirmation reports what the parser understood', () => {
  it('is a green tick with an Undo only when the line parsed clean', () => {
    expect(confirmationFor(false, 0, true)).toEqual({
      key: 'capture.captured',
      tone: 'success',
      offline: false,
      action: 'undo',
    })
  })

  it('drops the success tone the moment anything is unresolved', () => {
    const say = confirmationFor(false, 2, true)
    expect(say.tone).toBe('default')
    expect(say.key).toBe('capture.capturedIssues')
  })

  it('offers repair, not deletion, for a line that was only partly understood', () => {
    // The whole point. Undo DELETES the row — the wrong remedy for an item that
    // is right except for two fields.
    expect(confirmationFor(false, 1, true).action).toBe('open')
    expect(confirmationFor(true, 1, true).action).toBe('open')
  })

  it('keeps "where is it" and "did it understand me" independent', () => {
    // A queued capture can also be a misparsed one, and both facts have to fit
    // in one sentence. `offline.queued` is a NOTICE, not an error: offline was
    // never a success tone and still is not.
    expect(confirmationFor(true, 0, true)).toEqual({
      key: 'capture.capturedQueued',
      tone: 'default',
      offline: true,
      action: 'undo',
    })
    expect(confirmationFor(true, 3, true)).toEqual({
      key: 'capture.capturedQueuedIssues',
      tone: 'default',
      offline: true,
      action: 'open',
    })
  })

  it('offers no button at all when there is no id to act on', () => {
    // The one path that produces this: a queued write whose temp id could not be
    // recovered from the outbox. A button that cannot find its row is worse than
    // no button.
    expect(confirmationFor(true, 0, false).action).toBeNull()
    expect(confirmationFor(true, 2, false).action).toBeNull()
  })

  it('names four keys that exist in both languages', () => {
    const keys = [
      confirmationFor(false, 0, true).key,
      confirmationFor(false, 1, true).key,
      confirmationFor(true, 0, true).key,
      confirmationFor(true, 1, true).key,
    ]
    expect(new Set(keys).size).toBe(4)
    for (const locale of ['en', 'ar'] as const) {
      setLocale(locale)
      for (const key of keys) {
        const sentence = t(key, { title: 'Renew the DR contract' })
        // t() echoes its own argument on a miss, which is the only way a missing
        // string announces itself — see untranslated() above.
        expect(sentence).not.toBe(key)
        expect(stripIsolates(sentence)).toContain('Renew the DR contract')
      }
    }
    setLocale('en')
  })

  it('the reported case: a real line whose owner and date both fail is NOT clean', () => {
    // The reporter's line, run through the real parser against the real seeded
    // workspace. `#infrastrcture` DOES resolve — matchTrackTiers has a
    // subsequence tier — so this is two problems, not three, and the two that
    // remain are the ones that cost something: no owner_id means nobody was
    // assigned and nobody was notified, and no due date means the item can never
    // surface in Overdue or Due soon.
    const parsed = parse('Renew the DR contract #infrastrcture @sarah due:next friday', {
      tracks: fx.tracks.map((tr) => ({ id: tr.id, name: tr.name, nameAr: tr.name_ar })),
      members: [
        { id: 'm-ahmed', displayName: 'Ahmed Al-Otaibi', username: 'ahmed.otaibi' },
        { id: 'm-sara', displayName: 'Sara Nasser', username: 'sara.nasser' },
      ],
      now: new Date('2026-07-29T09:00:00Z'),
      locale: 'en',
      vocabAliases: { priority: {}, type: {} },
    })
    expect(parsed.trackId).toBe('t-inf')
    expect(parsed.ownerId).toBeNull()
    expect(parsed.dueDate).toBeNull()
    expect(parsed.problems.length).toBe(2)
    // …and the confirmation must therefore say so, and the bar must leave the
    // record the toast cannot be.
    const say = confirmationFor(false, parsed.problems.length, true)
    expect(say.tone).not.toBe('success')
    expect(say.action).toBe('open')
  })
})

/* ═══════════════════════ the seams the shell compiles against ════════════════ */

describe('MapCapture — the imperative seam', () => {
  it('focusMapCapture() is synchronous and answers false when nothing is mounted', () => {
    // The phone win in one line: WebKit raises the software keyboard only for a
    // focus() taken inside the user-activation call stack, and Chromium gates it
    // the same way. A promise, an effect or a state flag all leave that stack,
    // which is why open task #67 costs a second tap on every first capture of a
    // session today. Nothing is mounted under renderToStaticMarkup — effects
    // never run — so the honest answer here is `false`, and the caller is then
    // free to fall back to a navigation.
    const answer = focusMapCapture()
    expect(answer).toBe(false)
    expect(answer).not.toBeInstanceOf(Promise)
  })

  it('binds no document or window listener', () => {
    // The map's keyboard grammar and `lib/overlayStack` both own document-level
    // keys. A listener here would fire for keystrokes meant for them, and would
    // keep firing while the caret is somewhere else entirely. Every key this
    // component handles is handled in `onKeyDown` on its own <input>.
    expect(SOURCE).not.toMatch(/document\.addEventListener/)
    expect(SOURCE).not.toMatch(/window\.addEventListener/)
    // The one observer it does own watches its own element and is disconnected
    // on unmount — that is not a document listener, and it is how the bar's real
    // height reaches the phone sheet.
    expect(SOURCE).toContain('new ResizeObserver')
    expect(SOURCE).toContain('observer.disconnect()')
    expect(SOURCE).toContain('--map-composer-block-size')
  })

  it('is a typing target as far as lib/hotkeys is concerned', () => {
    // `isTypingTarget()` is a STRUCTURAL test — the tag name, not a class or a
    // data attribute — so a real <input> anywhere in the document is inert to
    // the global hotkey table while it holds focus. That is what stops typing
    // `board` into this box from opening the board, and it needs no cooperation
    // from this component beyond rendering a real input, which the markup above
    // proves it does.
    const input = { tagName: 'INPUT', isContentEditable: false, getAttribute: () => null }
    expect(isTypingTarget(input)).toBe(true)
    expect(render('')).toContain('<input')
  })

  it('every Escape branch consumes the key', () => {
    // MapPanel.tsx's header states the order and names this component as level
    // 3: "the composer clears its text … which must preventDefault or this panel
    // closes underneath it". `lib/overlayStack` bails on `defaultPrevented`, so
    // preventDefault is both how Firefox is stopped from reverting the field and
    // how the panel is told the key was spent. There are three branches —
    // dismiss the assist, clear the line, leave the field — and the call is
    // hoisted above all three so none of them can be added without it.
    const branch = /if \(event\.key === 'Escape'\) \{\s*event\.preventDefault\(\)/
    expect(SOURCE).toMatch(branch)
  })
})

/* ══════════════════════════════ the sheet ════════════════════════════════════ */
//
// THE FAILURE THIS BLOCK EXISTS FOR. `MapCapture.tsx` has imported
// './map-capture.css' since the day it was written and that file did not exist.
// Nothing caught it — the component was imported by nobody and a bundler never
// resolves an unreferenced import — so the first `vite build` after the shell
// mounted it would have failed.
//
// WHAT THESE CASES CAN AND CANNOT SEE, stated because the gap matters. Vitest
// replaces every CSS request with an empty module under `environment: 'node'`,
// and `?raw` does not escape it — Vite's CSS test matches the EXTENSION and
// ignores the query — so the sheet's TEXT is unreadable from here. Two things
// are still provable and they are the two that broke: the file RESOLVES (the
// import at the top of this file throws at transform time if it does not, which
// is precisely the `vite build` failure that was waiting to happen), and the
// component renders no class outside the reviewed set the sheet was written
// against. The rules inside the sheet — logical properties, the phone
// inversion, `row-gap: 16px` on every wrapping cluster — are covered by the
// repo's standing greps and by review, NOT by this file. Turning on
// `test: { css: true }` in vitest.config.ts would make them assertable; that
// file is integrator-owned and the handoff asks for it.

/**
 * Every `.mcap-*` name this component is allowed to render.
 *
 * Written out rather than derived: the sheet cannot be read from here, and a
 * list that derives itself from the component under test proves nothing. This is
 * the reviewed set map-capture.css was written against — the thirty in the
 * contract's own inventory plus the ten the suggested-tag row and the token
 * cheatsheet brought with them off pages/Capture.tsx. Adding a class to the
 * component fails this case, which is the prompt to add its rule.
 */
const SHEET_NAMES: readonly string[] = [
  'mcap-bar',
  'mcap-chip',
  'mcap-chip-sigil',
  'mcap-chip-value',
  'mcap-chip-x',
  'mcap-clear',
  'mcap-error',
  'mcap-example',
  'mcap-examples',
  'mcap-field',
  'mcap-form',
  'mcap-hint',
  'mcap-hints',
  'mcap-hints-body',
  'mcap-hints-list',
  'mcap-hints-title',
  'mcap-hints-toggle',
  'mcap-input',
  'mcap-kept',
  'mcap-kept-fix',
  'mcap-kept-line',
  'mcap-notice',
  'mcap-notice-link',
  'mcap-pick',
  'mcap-pick-chip',
  'mcap-pick-title',
  'mcap-problem',
  'mcap-problem-fix',
  'mcap-problem-text',
  'mcap-problems',
  'mcap-problems-count',
  'mcap-problems-title',
  'mcap-read',
  'mcap-read-plain',
  'mcap-submit',
  'mcap-suggest',
  'mcap-suggest-chip',
  'mcap-suggest-title',
  // A custom property, not a class: global.css resolves the stored dark/light
  // pair to `--track-color` for `.track-dot` only, so the sheet mirrors the same
  // choice into `--mcap-track-color` for the chip's own border.
  'mcap-track-color',
  'mcap-will',
]

/**
 * The five names no static render can produce.
 *
 * `mcap-error` and the three `mcap-kept*` are state AFTER a write — a failed
 * save and a capture that landed with unresolved tokens — and both need an
 * event and a promise. `mcap-track-color` is a custom property the sheet
 * declares and the component only names in a comment.
 */
const AFTER_A_WRITE = new Set([
  'mcap-error',
  'mcap-kept',
  'mcap-kept-fix',
  'mcap-kept-line',
  'mcap-track-color',
])

describe('map-capture.css', () => {
  it('resolves — the import at the top of this file is the proof', () => {
    // If the sheet is deleted, this module never loads and every case above
    // fails with a resolution error rather than a wrong assertion. That is the
    // strongest statement a node test can make about a stylesheet, and it is
    // exactly the class of failure that was sitting in this component.
    expect(SOURCE).toContain("import './map-capture.css'")
  })

  it('renders no .mcap- name the sheet was not written against', () => {
    expect([...mcapNames(SOURCE)].sort()).toEqual([...SHEET_NAMES].sort())
    // A glob that resolved to nothing would make the line above vacuously
    // wrong rather than vacuously right, but pin the size anyway.
    expect(mcapNames(SOURCE).size).toBeGreaterThan(25)
  })

  it('renders every class it declares in the markup it can produce', () => {
    // The other direction, as far as static markup reaches: two lines that
    // between them carry a track, an ambiguous token, a failed token, a repeat
    // rule and a suggested tag light up every region this bar has. A name in the
    // list above that no reachable state renders is a rule with nothing behind
    // it, and a name the sheet lacks fails the case before this one.
    const html =
      render('#i Rebuild jump host due:someday') + render('#onboarding Portal access every:weekly')
    const missing = SHEET_NAMES.filter((n) => !AFTER_A_WRITE.has(n) && !html.includes(n))
    expect(missing).toEqual([])
  })
})
