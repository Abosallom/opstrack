// THE FIXTURES ARE THE SEED VALUES, VERBATIM.
//
// Every `name` and `nameAr` below is byte-identical to what the migrations
// insert — the five tracks 0001 seeds and the Onboarding track 0004 adds. Wave-1
// gate (i) greps this list against the SQL for exactly one reason: the contracts
// document's original fixture list used `الشبكة` (singular) for Network while
// 0001 actually seeds `الشبكات` (plural), and a test written from the wrong
// fixture would have proved the parser worked against data that does not exist.
// The Arabic half would have shipped broken AND GREEN. If a track is renamed,
// this block changes and the grep is what catches it.
//
// `now` is 2026-07-29, a WEDNESDAY, matching the ten worked examples in plan
// §2.13. It is always injected; nothing here reads the clock.

import { describe, expect, it } from 'vitest'
import {
  PROBLEM_KEYS,
  canSubmit,
  matchMember,
  matchTrack,
  parse,
  toNewEntry,
  toRecurringTemplateInput,
} from './parse'
import type { ParseContext, ParseMember, ParseTrack, ParsedEntry } from './parse'

const TRACKS: readonly ParseTrack[] = [
  { id: 't-pmo', name: 'PMO', nameAr: 'مكتب إدارة المشاريع' },
  { id: 't-ito', name: 'IT Operations', nameAr: 'عمليات تقنية المعلومات' },
  { id: 't-net', name: 'Network', nameAr: 'الشبكات' },
  { id: 't-inf', name: 'Infrastructure', nameAr: 'البنية التحتية' },
  { id: 't-sre', name: 'SRE', nameAr: 'هندسة موثوقية الأنظمة' },
  { id: 't-onb', name: 'Onboarding', nameAr: 'التهيئة والربط' },
]

const MEMBERS: readonly ParseMember[] = [
  { id: 'm-ahmed', displayName: 'Ahmed Al-Otaibi' },
  { id: 'm-sara', displayName: 'Sara Nasser' },
]

const NOW = new Date(2026, 6, 29, 12, 0, 0)

function ctx(over: Partial<ParseContext> = {}): ParseContext {
  return { tracks: TRACKS, members: MEMBERS, now: NOW, locale: 'en', ...over }
}

function run(input: string, over: Partial<ParseContext> = {}): ParsedEntry {
  return parse(input, ctx(over))
}

function problemKeys(p: ParsedEntry): string[] {
  return p.problems.map((x) => x.key)
}

/**
 * Problems are emitted in TOKEN order, which is what the chip row renders.
 * Plan §2.13's worked examples list them unordered, so assertions compare sets.
 */
function sortedProblems(p: ParsedEntry): string[] {
  return [...problemKeys(p)].sort()
}

/** The span invariant, asserted everywhere it is cheap to assert. */
function spansAreExact(input: string, p: ParsedEntry): boolean {
  let last = 0
  for (const t of p.tokens) {
    if (t.start < last || t.end <= t.start) return false
    if (input.slice(t.start, t.end) !== t.raw) return false
    last = t.end
  }
  return true
}

// ── the ten worked examples (plan §2.13) ───────────────────────────────────

describe('the ten worked examples', () => {
  it('1 · full English line', () => {
    const input = 'Firewall rule DC2 #network @ahmed !high due:thu'
    const p = run(input)
    expect(p.title).toBe('Firewall rule DC2')
    expect(p.trackId).toBe('t-net')
    expect(p.ownerId).toBe('m-ahmed')
    expect(p.priority).toBe('high')
    expect(p.dueDate).toBe('2026-07-30')
    expect(p.tokens).toHaveLength(4)
    expect(p.tokens.every((t) => t.ok)).toBe(true)
    expect(p.problems).toHaveLength(0)
    expect(spansAreExact(input, p)).toBe(true)
  })

  it('2 · prefix track, free-text owner, tag, offset date, type', () => {
    const p = run('#onb New vendor portal access +portal @Fatimah due:+3d /request')
    expect(p.title).toBe('New vendor portal access')
    expect(p.trackId).toBe('t-onb')
    expect(p.ownerId).toBeNull()
    expect(p.ownerName).toBe('Fatimah')
    expect(p.tags).toEqual(['portal'])
    expect(p.dueDate).toBe('2026-08-01')
    expect(p.type).toBe('request')
    expect(problemKeys(p)).toEqual([PROBLEM_KEYS.newOwner])
  })

  it('3 · full Arabic line, matched on name_ar', () => {
    const p = run('ترقية سويتش الكور #الشبكات @ahmed !عاجل due:الخميس')
    expect(p.title).toBe('ترقية سويتش الكور')
    expect(p.trackId).toBe('t-net')
    expect(p.ownerId).toBe('m-ahmed')
    expect(p.priority).toBe('critical')
    expect(p.dueDate).toBe('2026-07-30')
    expect(p.problems).toHaveLength(0)
  })

  it('3b · the SINGULAR must resolve too, via the stem clause', () => {
    // `#الشبكة` folds to `الشبكه`; the seed is `الشبكات`. Tier 1 fails, tier 2's
    // prefix fails in both directions, tier 3 fails because the singular's final
    // ه is not in the plural at all. stemArabic folds both to `الشبك`.
    expect(run('ترقية سويتش #الشبكة').trackId).toBe('t-net')
    expect(matchTrack('الشبكة', TRACKS).id).toBe('t-net')
  })

  it('4 · a track name inside the TITLE is not a track match', () => {
    const p = run('اجتماع مراجعة الشبكة due:غدا fu:الأحد !متوسط')
    expect(p.title).toBe('اجتماع مراجعة الشبكة')
    expect(p.trackId).toBeNull() // only sigils match — this is the whole point
    expect(p.dueDate).toBe('2026-07-30')
    expect(p.followUpDate).toBe('2026-08-02')
    expect(p.priority).toBe('medium')
  })

  it('5 · a cadence makes it a template, not an entry', () => {
    const p = run('Weekly network capacity review #network every:weekly @sara !medium')
    expect(p.title).toBe('Weekly network capacity review')
    expect(p.recurrence).toEqual({
      cadence: 'weekly',
      customIntervalDays: null,
      dayOfWeek: 3, // Wednesday, anchored to `now`
      dayOfMonth: null,
      firstRunOn: '2026-07-29',
    })
    expect(toNewEntry(p, ctx())).toBeNull()
    expect(toRecurringTemplateInput(p, ctx())).toEqual({
      title: 'Weekly network capacity review',
      trackId: 't-net',
      type: 'action',
      priority: 'medium',
      ownerId: 'm-sara',
      ownerName: null,
      cadence: 'weekly',
      customIntervalDays: null,
      dayOfWeek: 3,
      dayOfMonth: null,
      nextRunOn: '2026-07-29',
      leadDays: 0,
    })
  })

  it('6 · a mid-word sigil is not a token', () => {
    const input = 'Ticket https://jira.corp/x#INC-42 for @sara due:2026-08-14'
    const p = run(input)
    expect(p.title).toBe('Ticket https://jira.corp/x#INC-42 for')
    expect(p.trackId).toBeNull()
    expect(p.ownerId).toBe('m-sara')
    expect(p.dueDate).toBe('2026-08-14')
    expect(spansAreExact(input, p)).toBe(true)
  })

  it('7 · garbage parses partially and loses nothing', () => {
    const p = run('#### @@ !urgent-ish due:someday /nope +')
    // Bare sigils are not tokens; unresolved closed-vocabulary sigils stay put;
    // `due:` is consumed either way because `due:someday` in a title is noise.
    expect(p.title).toBe('#### @@ !urgent-ish /nope +')
    expect(p.dueDate).toBeNull()
    expect(p.priority).toBeNull()
    expect(p.type).toBeNull()
    expect(sortedProblems(p)).toEqual(
      [PROBLEM_KEYS.date, PROBLEM_KEYS.priority, PROBLEM_KEYS.type].sort(),
    )
    expect(canSubmit(p)).toBe(true)
  })

  it('8 · an ambiguous track offers candidates instead of guessing', () => {
    const p = run('#i Rebuild jump host')
    expect(p.title).toBe('Rebuild jump host')
    expect(p.trackId).toBeNull()
    expect([...(p.tokens[0]?.candidates ?? [])].sort()).toEqual(['t-inf', 't-ito'])
    expect(problemKeys(p)).toEqual([PROBLEM_KEYS.trackAmbiguous])
  })

  it('9 · self-correction is last-wins, and says so', () => {
    const p = run('#pmo Kickoff deck #network !low !critical')
    expect(p.title).toBe('Kickoff deck')
    expect(p.trackId).toBe('t-net')
    expect(p.priority).toBe('critical')
    expect(problemKeys(p)).toEqual([PROBLEM_KEYS.duplicate, PROBLEM_KEYS.duplicate])
  })

  it('10 · a blank box is not an error', () => {
    const p = run('   ')
    expect(p.isEmpty).toBe(true)
    expect(canSubmit(p)).toBe(false)
    expect(p.title).toBe('')
    expect(p.tokens).toHaveLength(0)
    expect(p.problems).toHaveLength(0)
    expect(toNewEntry(p, ctx())).toBeNull()
  })
})

// ── every token kind, one at a time ────────────────────────────────────────

describe('token kinds', () => {
  it('#track — resolved, unknown and quoted multi-word', () => {
    expect(run('a #sre').trackId).toBe('t-sre')
    expect(run('a #"IT Operations"').trackId).toBe('t-ito')
    const unknown = run('a #nosuchtrack')
    expect(unknown.trackId).toBeNull()
    expect(unknown.title).toBe('a') // consumed anyway: the chip renders unknown
    expect(problemKeys(unknown)).toEqual([PROBLEM_KEYS.trackUnknown])
  })

  it('@owner — matched, quoted free text, and ambiguous', () => {
    expect(run('a @ahmed').ownerId).toBe('m-ahmed')
    expect(run('a @"Ahmed Al-Otaibi"').ownerId).toBe('m-ahmed')

    const vendor = run('a @"Ali Hassan"')
    expect(vendor.ownerId).toBeNull()
    expect(vendor.ownerName).toBe('Ali Hassan')
    expect(vendor.title).toBe('a')

    const twins: readonly ParseMember[] = [
      { id: 'm-1', displayName: 'Ahmed Al-Otaibi' },
      { id: 'm-2', displayName: 'Ahmed Bin Salem' },
    ]
    const amb = run('a @ahmed', { members: twins })
    expect(amb.ownerId).toBeNull()
    expect(amb.ownerName).toBe('ahmed') // free text, never a coin flip
    expect(problemKeys(amb)).toEqual([PROBLEM_KEYS.ownerAmbiguous])
  })

  it('!priority — every key, both languages, and the unresolved case', () => {
    expect(run('a !low').priority).toBe('low')
    expect(run('a !medium').priority).toBe('medium')
    expect(run('a !high').priority).toBe('high')
    expect(run('a !critical').priority).toBe('critical')
    expect(run('a !p1').priority).toBe('critical')
    expect(run('a !عاجل').priority).toBe('critical')
    expect(run('a !عالية').priority).toBe('high')
    expect(run('a !متوسط').priority).toBe('medium')
    expect(run('a !منخفض').priority).toBe('low')
    // Unresolved stays in the title: `Ship it!` must survive a parser.
    expect(run('Ship it! today').title).toBe('Ship it! today')
    expect(run('a !nonsense').title).toBe('a !nonsense')
  })

  it('/type — every key, both languages, and the unresolved case', () => {
    expect(run('a /action').type).toBe('action')
    expect(run('a /decision').type).toBe('decision')
    expect(run('a /issue').type).toBe('issue')
    expect(run('a /request').type).toBe('request')
    expect(run('a /change').type).toBe('change')
    expect(run('a /escalation').type).toBe('escalation')
    expect(run('a /note').type).toBe('note')
    expect(run('a /طلب').type).toBe('request')
    expect(run('a /قرار').type).toBe('decision')
    expect(run('a /مشكلة').type).toBe('issue')
    // `read/write` is ordinary title text, not a type token — the `/` is
    // mid-word, so it is never even considered.
    expect(run('Document read/write access').title).toBe('Document read/write access')
    expect(run('a /nope').title).toBe('a /nope')
  })

  it('+tag — lowercased, deduped, accumulating, Arabic preserved verbatim', () => {
    const p = run('a +Portal +portal +Direct-Integration')
    expect(p.tags).toEqual(['portal', 'direct-integration'])
    expect(p.title).toBe('a')
    // Tags are NOT Arabic-folded: they are stored verbatim and matched with `=`.
    expect(run('a +الشبكة').tags).toEqual(['الشبكة'])
    // Accumulating, so a repeat is a stutter rather than a contradiction.
    expect(problemKeys(run('a +x +x'))).toHaveLength(0)
  })

  it('due: / d: and fu: / f: — both spellings of each key', () => {
    expect(run('a due:tomorrow').dueDate).toBe('2026-07-30')
    expect(run('a d:tomorrow').dueDate).toBe('2026-07-30')
    expect(run('a fu:thu').followUpDate).toBe('2026-07-30')
    expect(run('a f:thu').followUpDate).toBe('2026-07-30')
    expect(run('a DUE:thu').dueDate).toBe('2026-07-30')
    expect(run('a due:"نهاية الشهر"').dueDate).toBe('2026-07-31')
    const bad = run('a due:someday')
    expect(bad.dueDate).toBeNull()
    expect(bad.title).toBe('a')
    expect(problemKeys(bad)).toEqual([PROBLEM_KEYS.date])
  })

  it('every: / ev: — every cadence, plus the custom interval form', () => {
    expect(run('a every:daily').recurrence?.cadence).toBe('daily')
    expect(run('a every:weekly').recurrence?.cadence).toBe('weekly')
    expect(run('a every:2w').recurrence?.cadence).toBe('biweekly')
    expect(run('a every:monthly').recurrence?.cadence).toBe('monthly')
    expect(run('a every:quarterly').recurrence?.cadence).toBe('quarterly')
    expect(run('a ev:q').recurrence?.cadence).toBe('quarterly')
    expect(run('a every:يومي').recurrence?.cadence).toBe('daily')
    expect(run('a every:أسبوعي').recurrence?.cadence).toBe('weekly')
    expect(run('a every:شهري').recurrence?.cadence).toBe('monthly')
    expect(run('a every:"كل أسبوعين"').recurrence?.cadence).toBe('biweekly')

    const custom = run('a every:10d')
    expect(custom.recurrence?.cadence).toBe('custom')
    expect(custom.recurrence?.customIntervalDays).toBe(10)

    const bad = run('a every:sometimes')
    expect(bad.recurrence).toBeNull()
    expect(bad.title).toBe('a')
    expect(problemKeys(bad)).toEqual([PROBLEM_KEYS.recurrence])
  })

  it("'unknown' — a quoted empty value is intent without a value", () => {
    const p = run('Fix #"" bar')
    expect(p.tokens).toHaveLength(1)
    expect(p.tokens[0]?.kind).toBe('unknown')
    expect(p.trackId).toBeNull()
    expect(p.title).toBe('Fix bar') // consumed: the quotes were unambiguous
  })

  it('a bare sigil is not a token at all', () => {
    for (const input of ['####', '@@', '+', '!', '/', 'due:', 'a # b', 'a @ b']) {
      const p = run(input)
      expect(p.tokens, input).toHaveLength(0)
      expect(p.title, input).toBe(input.replace(/\s+/g, ' ').trim())
    }
  })

  it('a backslash escapes a sigil to a literal', () => {
    expect(run(String.raw`Ship \#hashtag please`).title).toBe('Ship #hashtag please')
    expect(run(String.raw`Ship \#hashtag please`).trackId).toBeNull()
    expect(run(String.raw`Rate \+5 \@home \!now \/day`).title).toBe('Rate +5 @home !now /day')
    expect(run(String.raw`a \#network`).tokens).toHaveLength(0)
  })
})

// ── combinations, ordering and partial parses ──────────────────────────────

describe('combinations and partial parses', () => {
  it('parses every token kind in one line', () => {
    const input = 'Quarterly review #pmo @sara !high /decision +audit due:thu fu:fri every:quarterly'
    const p = run(input)
    expect(p.title).toBe('Quarterly review')
    expect(p.trackId).toBe('t-pmo')
    expect(p.ownerId).toBe('m-sara')
    expect(p.priority).toBe('high')
    expect(p.type).toBe('decision')
    expect(p.tags).toEqual(['audit'])
    expect(p.dueDate).toBe('2026-07-30')
    expect(p.followUpDate).toBe('2026-07-31')
    expect(p.recurrence?.cadence).toBe('quarterly')
    expect(p.tokens).toHaveLength(8)
    expect(p.problems).toHaveLength(0)
    expect(spansAreExact(input, p)).toBe(true)
  })

  it('accepts tokens before, inside and after the title', () => {
    expect(run('#sre Fix the thing tonight').title).toBe('Fix the thing tonight')
    expect(run('Fix #sre the thing').title).toBe('Fix the thing')
    expect(run('Fix the thing #sre').title).toBe('Fix the thing')
  })

  it('is last-wins on every field except tags, and warns each time', () => {
    const p = run('a #pmo #sre @ahmed @sara !low !high /note /issue due:thu due:fri')
    expect(p.trackId).toBe('t-sre')
    expect(p.ownerId).toBe('m-sara')
    expect(p.priority).toBe('high')
    expect(p.type).toBe('issue')
    expect(p.dueDate).toBe('2026-07-31')
    expect(problemKeys(p).filter((k) => k === PROBLEM_KEYS.duplicate)).toHaveLength(5)
  })

  it('does not count a FAILED second token as a duplicate', () => {
    // `!high !urgent-ish` set the priority once; the second is its own failure.
    const p = run('a !high !urgent-ish')
    expect(p.priority).toBe('high')
    expect(problemKeys(p)).toEqual([PROBLEM_KEYS.priority])
  })

  it('never loses text: unknown tokens and unresolved sigils stay in the title', () => {
    const p = run('#nope Rebuild !maybe /perhaps due:whenever the jump host')
    expect(p.title).toBe('Rebuild !maybe /perhaps the jump host')
    expect(canSubmit(p)).toBe(true)
    expect(sortedProblems(p)).toEqual(
      [PROBLEM_KEYS.trackUnknown, PROBLEM_KEYS.priority, PROBLEM_KEYS.type, PROBLEM_KEYS.date].sort(),
    )
  })

  it('collapses the whitespace a consumed token leaves behind', () => {
    expect(run('a    #sre     b').title).toBe('a b')
    expect(run('  #sre  ').title).toBe('')
    expect(run('\ta\nb ').title).toBe('a b')
  })

  it('title-only input is passed through untouched', () => {
    const plain = 'Reconcile the Q3 numbers with finance and re-issue the report'
    expect(run(plain).title).toBe(plain)
    expect(run(plain).tokens).toHaveLength(0)
    expect(run(plain).isEmpty).toBe(false)
  })
})

// ── Arabic end to end ──────────────────────────────────────────────────────

describe('Arabic input end to end', () => {
  it('resolves every sigil against Arabic values in one line', () => {
    const input = 'تحديث أجهزة التوجيه #الشبكات @ahmed !عاجل /مشكلة +صيانة due:الخميس fu:الأحد'
    const p = run(input, { locale: 'ar' })
    expect(p.title).toBe('تحديث أجهزة التوجيه')
    expect(p.trackId).toBe('t-net')
    expect(p.ownerId).toBe('m-ahmed')
    expect(p.priority).toBe('critical')
    expect(p.type).toBe('issue')
    expect(p.tags).toEqual(['صيانة'])
    expect(p.dueDate).toBe('2026-07-30')
    expect(p.followUpDate).toBe('2026-08-02')
    expect(p.problems).toHaveLength(0)
    expect(spansAreExact(input, p)).toBe(true)
  })

  it('matches every seeded Arabic track name, and its stem', () => {
    expect(matchTrack('مكتب إدارة المشاريع', TRACKS).id).toBe('t-pmo')
    expect(matchTrack('عمليات تقنية المعلومات', TRACKS).id).toBe('t-ito')
    expect(matchTrack('الشبكات', TRACKS).id).toBe('t-net')
    expect(matchTrack('البنية التحتية', TRACKS).id).toBe('t-inf')
    expect(matchTrack('هندسة موثوقية الأنظمة', TRACKS).id).toBe('t-sre')
    expect(matchTrack('التهيئة والربط', TRACKS).id).toBe('t-onb')
  })

  it('matches Arabic names written without hamza or tashkeel', () => {
    // Nobody types the vowel marks, and half the keyboards make أ hard to reach.
    expect(matchTrack('البنيه التحتيه', TRACKS).id).toBe('t-inf')
    expect(matchTrack('مكتب ادارة المشاريع', TRACKS).id).toBe('t-pmo')
    expect(matchTrack('الشَّبكات', TRACKS).id).toBe('t-net')
  })

  it('does not match an Arabic display name that profiles cannot store', () => {
    // `profiles` has no display_name_ar, so `@أحمد` is free text — documented,
    // and fixable through ParseMember.aliases without reopening the parser.
    const p = run('مهمة @أحمد')
    expect(p.ownerId).toBeNull()
    expect(p.ownerName).toBe('أحمد')
    expect(problemKeys(p)).toEqual([PROBLEM_KEYS.newOwner])

    const aliased = run('مهمة @أحمد', {
      members: [{ id: 'm-ahmed', displayName: 'Ahmed Al-Otaibi', aliases: ['أحمد'] }],
    })
    expect(aliased.ownerId).toBe('m-ahmed')
  })

  it('accepts Arabic-Indic digits inside date tokens', () => {
    expect(run('a due:+٣d').dueDate).toBe('2026-08-01')
    expect(run('a due:١٤/٨').dueDate).toBe('2026-08-14')
  })
})

// ── RTL marks ──────────────────────────────────────────────────────────────

describe('RTL-marks tolerance', () => {
  // An Arabic keyboard emits an RLM before punctuation and an RTL chat client
  // wraps pasted runs in LRM/RLM pairs. None of it is visible to the user, so
  // none of it may change what the parser sees — while every token's span must
  // still slice back to exactly what was typed.
  const RLM = '‏'
  const LRM = '‎'
  const ALM = '؜'

  it('resolves a token whose sigil is preceded by an invisible mark', () => {
    const input = `ترقية ${RLM}#الشبكات ${RLM}@ahmed`
    const p = run(input)
    expect(p.trackId).toBe('t-net')
    expect(p.ownerId).toBe('m-ahmed')
    expect(spansAreExact(input, p)).toBe(true)
  })

  it('consumes the invisible prefix with the token rather than orphaning it', () => {
    const p = run(`${RLM}#الشبكات ترقية`)
    expect(p.title).toBe('ترقية')
    expect(p.title.includes(RLM)).toBe(false)
  })

  it('ignores marks inside a token value', () => {
    expect(run(`a due:${RLM}الخميس`).dueDate).toBe('2026-07-30')
    expect(run(`a #${LRM}network`).trackId).toBe('t-net')
    expect(run(`a !${ALM}عاجل`).priority).toBe('critical')
    expect(run(`a +${RLM}portal${LRM}`).tags).toEqual(['portal'])
  })

  it('treats a line of nothing but marks as empty', () => {
    const p = run(`${RLM}${LRM}${ALM}  `)
    expect(p.isEmpty).toBe(true)
    expect(canSubmit(p)).toBe(false)
  })
})

// ── matchers, directly ─────────────────────────────────────────────────────

describe('matchTrack tiers', () => {
  it('tier 1 — exact fold-equality on name, name_ar or an alias', () => {
    expect(matchTrack('PMO', TRACKS).id).toBe('t-pmo')
    expect(matchTrack('pmo', TRACKS).id).toBe('t-pmo')
    expect(matchTrack('it operations', TRACKS).id).toBe('t-ito')
    expect(matchTrack('it-operations', TRACKS).id).toBe('t-ito') // separators folded
    expect(matchTrack('netops', [{ id: 't-net', name: 'Network', nameAr: 'الشبكات', aliases: ['NetOps'] }]).id).toBe('t-net')
  })

  it('tier 2 — prefix, or an equal Arabic stem', () => {
    expect(matchTrack('onb', TRACKS).id).toBe('t-onb')
    expect(matchTrack('netw', TRACKS).id).toBe('t-net')
    expect(matchTrack('الشبكة', TRACKS).id).toBe('t-net')
  })

  it('tier 3 — subsequence, the loosest tier', () => {
    expect(matchTrack('itops', TRACKS).id).toBe('t-ito')
    expect(matchTrack('infra', TRACKS).id).toBe('t-inf')
  })

  it('a tie inside a tier is ambiguity, never a guess', () => {
    const hit = matchTrack('i', TRACKS)
    expect(hit.id).toBeNull()
    expect([...hit.candidates].sort()).toEqual(['t-inf', 't-ito'])
  })

  it('no hit at any tier is an empty candidate list', () => {
    expect(matchTrack('zzz', TRACKS)).toEqual({ id: null, candidates: [] })
    expect(matchTrack('', TRACKS)).toEqual({ id: null, candidates: [] })
    expect(matchTrack('anything', [])).toEqual({ id: null, candidates: [] })
  })

  it('a higher tier always beats a lower one', () => {
    // 'sre' is an exact hit AND a subsequence of `هندسة...`'s Latin-free form is
    // irrelevant; what matters is that an exact hit ends the search.
    expect(matchTrack('sre', TRACKS).id).toBe('t-sre')
    // 'on' is a prefix of exactly one track, even though it is a subsequence of
    // several — tier 2 wins outright and tier 3 is never consulted.
    expect(matchTrack('on', TRACKS).id).toBe('t-onb')
  })
})

describe('matchMember', () => {
  it('matches exact and prefix, and nothing looser', () => {
    expect(matchMember('Ahmed Al-Otaibi', MEMBERS)).toBe('m-ahmed')
    expect(matchMember('ahmed', MEMBERS)).toBe('m-ahmed')
    expect(matchMember('sara', MEMBERS)).toBe('m-sara')
    // Subsequence is deliberately NOT a tier: assigning work to the wrong
    // person silently is worse than leaving free text.
    expect(matchMember('anr', MEMBERS)).toBeNull()
    expect(matchMember('sn', MEMBERS)).toBeNull()
  })

  it('returns null rather than choosing between two matches', () => {
    const twins: readonly ParseMember[] = [
      { id: 'm-1', displayName: 'Sara Nasser' },
      { id: 'm-2', displayName: 'Sara Qahtani' },
    ]
    expect(matchMember('sara', twins)).toBeNull()
    expect(matchMember('', MEMBERS)).toBeNull()
  })
})

// ── vocabulary overrides ───────────────────────────────────────────────────

describe('admin vocabulary aliases', () => {
  it('resolves a renamed priority and type through ctx.vocabAliases', () => {
    const over: Partial<ParseContext> = {
      vocabAliases: {
        priority: { critical: ['blocker', 'مانع'] },
        type: { escalation: ['esc-up'] },
      },
    }
    expect(run('a !blocker', over).priority).toBe('critical')
    expect(run('a !مانع', over).priority).toBe('critical')
    expect(run('a /esc-up', over).type).toBe('escalation')
    // The built-in aliases still work — overrides ADD, they do not replace.
    expect(run('a !high', over).priority).toBe('high')
  })

  it('accepts a status map without doing anything with it', () => {
    // There is no status sigil: capture always creates at `new`. The field
    // exists for shape compatibility with store/vocab's snapshot.
    const p = run('a !high', { vocabAliases: { status: { blocked: ['stuck'] } } })
    expect(p.priority).toBe('high')
    expect(p.problems).toHaveLength(0)
  })
})

// ── recurrence anchoring ───────────────────────────────────────────────────

describe('recurrence anchoring', () => {
  it('anchors dayOfWeek for weekly and biweekly', () => {
    expect(run('a every:weekly').recurrence?.dayOfWeek).toBe(3)
    expect(run('a every:2w').recurrence?.dayOfWeek).toBe(3)
    expect(run('a every:weekly').recurrence?.dayOfMonth).toBeNull()
  })

  it('anchors dayOfMonth for monthly and quarterly', () => {
    expect(run('a every:monthly').recurrence?.dayOfMonth).toBe(29)
    expect(run('a every:quarterly').recurrence?.dayOfMonth).toBe(29)
    expect(run('a every:monthly').recurrence?.dayOfWeek).toBeNull()
  })

  it('anchors nothing for daily and custom', () => {
    expect(run('a every:daily').recurrence).toEqual({
      cadence: 'daily',
      customIntervalDays: null,
      dayOfWeek: null,
      dayOfMonth: null,
      firstRunOn: '2026-07-29',
    })
    expect(run('a every:5d').recurrence?.customIntervalDays).toBe(5)
  })

  it('lets due: override the anchor by supplying the first run', () => {
    const p = run('Monthly report #pmo every:monthly due:2026-08-01')
    expect(p.recurrence?.firstRunOn).toBe('2026-08-01')
    expect(p.recurrence?.dayOfMonth).toBe(1)
    const weekly = run('a every:weekly due:sun')
    expect(weekly.recurrence?.firstRunOn).toBe('2026-08-02')
    expect(weekly.recurrence?.dayOfWeek).toBe(0)
  })
})

// ── the two output mappings ────────────────────────────────────────────────

describe('toNewEntry', () => {
  it('applies the documented defaults and the owner XOR', () => {
    const p = run('Firewall rule DC2 #network @ahmed !high due:thu')
    expect(toNewEntry(p, ctx())).toEqual({
      title: 'Firewall rule DC2',
      trackId: 't-net',
      description: '', // NOT null — the column is NOT NULL, `?? null` is a 23502
      type: 'action',
      priority: 'high',
      ownerId: 'm-ahmed',
      ownerName: null, // cleared: an entry never shows two owners
      dueDate: '2026-07-30',
      followUpDate: null,
      tags: [],
    })
  })

  it('falls back to ctx.defaults before the hard-coded defaults', () => {
    const withDefaults = ctx({ defaults: { trackId: 't-sre', priority: 'critical', type: 'issue' } })
    const p = parse('Something broke', withDefaults)
    expect(toNewEntry(p, withDefaults)).toMatchObject({
      trackId: 't-sre',
      priority: 'critical',
      type: 'issue',
    })
    // Parsed values beat defaults.
    const explicit = parse('Something broke #pmo !low /note', withDefaults)
    expect(toNewEntry(explicit, withDefaults)).toMatchObject({
      trackId: 't-pmo',
      priority: 'low',
      type: 'note',
    })
  })

  it('keeps a free-text owner as ownerName', () => {
    const p = run('Vendor callback @Fatimah')
    expect(toNewEntry(p, ctx())).toMatchObject({ ownerId: null, ownerName: 'Fatimah' })
  })

  it('is null for a recurrence or an empty title', () => {
    expect(toNewEntry(run('a every:weekly'), ctx())).toBeNull()
    expect(toNewEntry(run('#sre'), ctx())).toBeNull()
    expect(toNewEntry(run(''), ctx())).toBeNull()
  })
})

describe('toRecurringTemplateInput', () => {
  it('is null unless the line carries a cadence', () => {
    expect(toRecurringTemplateInput(run('Firewall rule #network'), ctx())).toBeNull()
    expect(toRecurringTemplateInput(run('every:weekly'), ctx())).toBeNull() // no title
  })

  it('carries the custom interval through', () => {
    const p = run('Disk check #sre every:10d')
    expect(toRecurringTemplateInput(p, ctx())).toMatchObject({
      cadence: 'custom',
      customIntervalDays: 10,
      nextRunOn: '2026-07-29',
      leadDays: 0,
    })
  })
})

// ── totality ───────────────────────────────────────────────────────────────

describe('totality', () => {
  const NASTY = [
    '',
    ' ',
    '\n\t  \r',
    '#',
    '@',
    '!',
    '/',
    '+',
    ':',
    'due:',
    'every:',
    '#"',
    '@"unterminated',
    'due:"',
    '####@@@@!!!!////++++',
    '\\',
    '\\\\\\',
    'a\\',
    '#‏',
    ' ',
    '😀 #network 🎉',
    'x'.repeat(5000),
    '#'.repeat(500),
    'due:'.repeat(200),
    '#network '.repeat(100),
    'aـــb',
    '\uD83D', // a lone surrogate half
    '#😀',
  ]

  it('never throws, whatever it is handed', () => {
    for (const input of NASTY) {
      expect(() => run(input), JSON.stringify(input)).not.toThrow()
    }
  })

  it('every token span slices back to its raw, on every input', () => {
    for (const input of NASTY) {
      const p = run(input)
      expect(spansAreExact(input, p), JSON.stringify(input)).toBe(true)
    }
  })

  it('survives 500 pseudo-random strings with the span invariant intact', () => {
    // Seeded, so a failure is reproducible from the printed input rather than
    // being a flake somebody re-runs until it passes.
    const alphabet = [
      ...'#@!+/:\\" ',
      ...'abcdefghijkmnop',
      ...'0123456789',
      ...'due fu every thu غدا الشبكات عاجل',
      '‏',
      '‎',
      '؜',
      '\t',
      '\n',
    ]
    let seed = 0x5eed
    const next = (): number => {
      seed = (seed * 1664525 + 1013904223) >>> 0
      return seed / 0x1_0000_0000
    }

    for (let i = 0; i < 500; i += 1) {
      const length = 1 + Math.floor(next() * 60)
      let input = ''
      for (let c = 0; c < length; c += 1) {
        input += alphabet[Math.floor(next() * alphabet.length)] as string
      }
      let p: ParsedEntry
      expect(() => {
        p = run(input)
      }, JSON.stringify(input)).not.toThrow()
      p = run(input)
      expect(spansAreExact(input, p), JSON.stringify(input)).toBe(true)
      expect(typeof p.title, JSON.stringify(input)).toBe('string')
      expect(p.title.trim(), JSON.stringify(input)).toBe(p.title)
      expect(p.tags.length, JSON.stringify(input)).toBe(new Set(p.tags).size)
      for (const token of p.tokens) {
        expect(token.ok || typeof token.error === 'string', JSON.stringify(input)).toBe(true)
      }
    }
  })

  it('reports an unterminated quote as one token to the end of the line', () => {
    // The live-capture trade-off, stated in readValue(): mid-typing `#"IT Oper`
    // should already resolve rather than flickering through an unknown-track
    // error that fixes itself one keystroke later.
    const p = run('Fix #"IT Operations')
    expect(p.trackId).toBe('t-ito')
    expect(p.title).toBe('Fix')
  })
})

// ── never delete what the user typed ───────────────────────────────────────
//
// The module's central invariant: every character of the input either ends up
// in the title or is accounted for by a token the user can see. Three ways it
// was being violated, all three shipped, all three silent.

describe('typed text survives the parse', () => {
  it('keeps Windows paths out of the date parser', () => {
    // THE bug. `d:` and `f:` are drive letters before they are date keys, and
    // failed date tokens are consumed — so this line was stored as
    // "Restore to", losing both paths, in an IT-operations tracker.
    const p = run(String.raw`Restore D:\backup to F:\data`)
    expect(p.title).toBe(String.raw`Restore D:\backup to F:\data`)
    expect(p.dueDate).toBeNull()
    expect(p.followUpDate).toBeNull()
    expect(p.tokens).toHaveLength(0)
    expect(problemKeys(p)).toEqual([])
  })

  it('leaves every other short-key collision alone too', () => {
    // Same root, three more shapes the audit found: a forward-slash path, a
    // flag with a numeric argument, and a ratio.
    for (const input of ['Mount d:/mnt/share', 'Set F:1 flag', 'check ev:1 ratio']) {
      const p = run(input)
      expect(p.title, input).toBe(input)
      expect(p.tokens, input).toHaveLength(0)
      expect(problemKeys(p), input).toEqual([])
    }
  })

  it('still honours the short keys when they resolve', () => {
    // The fix must not cost the abbreviations. An abbreviation is a keyword
    // only when it works — when it works, it works exactly as before.
    expect(run('a d:tomorrow').dueDate).toBe('2026-07-30')
    expect(run('a d:tomorrow').title).toBe('a')
    expect(run('a f:thu').followUpDate).toBe('2026-07-30')
    expect(run('a ev:daily').recurrence?.cadence).toBe('daily')
    expect(run('a ev:10d').recurrence?.customIntervalDays).toBe(10)
  })

  it('still marks a spelled-out key red when its value is nonsense', () => {
    // `due:` and `every:` are unambiguous, so a miss is a real mistake and
    // keeps the old behaviour: consumed, and reported.
    const due = run('a due:someday')
    expect(due.title).toBe('a')
    expect(problemKeys(due)).toEqual([PROBLEM_KEYS.date])

    const every = run('a every:sometimes')
    expect(every.title).toBe('a')
    expect(problemKeys(every)).toEqual([PROBLEM_KEYS.recurrence])
  })

  it('warns when an open quote swallows the rest of the line', () => {
    // `@` treats free text as a success and `+` accepts anything, so these two
    // absorbed a date, a priority and a track with problems: [].
    const owner = run('Call @"Ahmed due:thu !high #network')
    expect(owner.ownerName).toBe('Ahmed due:thu !high #network')
    expect(problemKeys(owner)).toContain(PROBLEM_KEYS.unterminatedQuote)

    const tag = run('Escalate +"outage @sara due:fri')
    expect(tag.tags).toEqual(['outage @sara due:fri'])
    expect(problemKeys(tag)).toEqual([PROBLEM_KEYS.unterminatedQuote])
  })

  it('says nothing about a quote that is closed', () => {
    const p = run('Escalate +"core switch" @sara')
    expect(p.tags).toEqual(['core switch'])
    expect(p.ownerId).toBe('m-sara')
    expect(problemKeys(p)).not.toContain(PROBLEM_KEYS.unterminatedQuote)
  })

  it('takes the whole track name when it is unquoted and multi-word', () => {
    // Resolved off `IT` alone and consumed only `#IT`, so the tail of the track
    // name was stored as part of the title — with problems: [], because as far
    // as the parser was concerned everything had worked. Live row b87acd3a was
    // written this way.
    const p = run('Renew cert #IT Operations')
    expect(p.trackId).toBe('t-ito')
    expect(p.title).toBe('Renew cert')
    expect(problemKeys(p)).toEqual([])
  })

  it('stops the track lookahead at the end of the name', () => {
    expect(run('Renew cert #IT Operations tomorrow').title).toBe('Renew cert tomorrow')
    expect(run('Renew cert #IT Operations tomorrow').trackId).toBe('t-ito')
    // Arabic names run to three words and must extend the same way.
    const ar = run('تجديد الشهادة #عمليات تقنية المعلومات غدًا')
    expect(ar.trackId).toBe('t-ito')
    expect(ar.title).toBe('تجديد الشهادة غدًا')
  })

  it('never extends a track token on a fuzzy match', () => {
    // The lookahead accepts EXACT names only. A prefix or subsequence hit on
    // the wider string would eat title words to feed a guess.
    expect(run('Deploy #Network now').title).toBe('Deploy now')
    expect(run('Deploy #Network now').trackId).toBe('t-net')
    expect(run('Check #Net work order').title).toBe('Check work order')
    expect(run('Check #Net work order').trackId).toBe('t-net')
  })

  it('never lets the lookahead swallow another token', () => {
    const p = run('Renew cert #IT due:thu')
    expect(p.trackId).toBe('t-ito')
    expect(p.dueDate).toBe('2026-07-30')
    expect(p.title).toBe('Renew cert')
  })
})
