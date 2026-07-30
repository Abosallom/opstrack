// dates.ts is the app's one date implementation, so this file is where the two
// traps its header names get proven rather than asserted.
//
// EVERY TEST IS TIMEZONE-INDEPENDENT, and that took deliberate construction.
// Anchors are built with `new Date(y, m, d, ...)` (LOCAL components) and
// instants are produced by `.toISOString()` from those local anchors, so a run
// in Asia/Riyadh, UTC and America/Los_Angeles all see the same calendar. A test
// that wrote '2026-07-29T10:00:00Z' as a literal would pass in Riyadh and fail
// in CI at exactly the hours nobody is watching.
//
// `now` is always INJECTED. Nothing here reads the wall clock, so the suite
// gives the same result on a leap day at 23:59 as it does at noon in March.
//
// THE ±1 DAY TOLERANCE, restated: v_entry_health counts days against the
// server's UTC current_date and this module counts them against the user's
// local calendar. Near midnight they legitimately disagree by one day. The
// assertions below are on the LOCAL answer, because "due today" has to mean the
// user's today; the live comparison in the Wave-1 gate is the one that tolerates
// the drift.

import { describe, expect, it } from 'vitest'
import {
  addDays,
  addMonths,
  bucketAge,
  clampIso,
  daysSince,
  diffDays,
  dueBucket,
  formatAge,
  formatDate,
  formatDateLong,
  formatDateRange,
  formatDue,
  formatRelativeTime,
  formatTimestamp,
  formatWeekday,
  instantToIsoDate,
  isoWeekday,
  lastNDays,
  MAX_ISO_YEAR,
  MIN_ISO_YEAR,
  parseIsoDate,
  parseRelativeDate,
  toIsoDate,
  todayIso,
  weekBounds,
} from './dates'
import type { IsoDate } from './dates'
import type { Locale } from './i18n'

/** 2026-07-29, a WEDNESDAY — the anchor every worked example in plan §2.13 uses. */
const NOW = new Date(2026, 6, 29, 12, 0, 0)

const EN: Locale = 'en'
const AR: Locale = 'ar'

/**
 * Intl inserts RLM marks around the separators in Arabic dates (`29‏/07‏/2026`),
 * which is CORRECT for rendering and useless in an assertion. Strip them here
 * rather than stripping them in the formatter — the marks are what make a date
 * read the right way round inside an Arabic sentence.
 */
function visible(s: string): string {
  return s.replace(/[\u200B-\u200F\u061C\uFEFF]/g, '')
}

/** An instant at a given LOCAL wall-clock time, so no test depends on the zone. */
function localInstant(y: number, m: number, d: number, hh = 12, mm = 0): string {
  return new Date(y, m - 1, d, hh, mm, 0, 0).toISOString()
}

function rel(input: string, now: Date = NOW, weekStartsOn?: 0 | 1 | 6): string | null {
  return parseRelativeDate(input, { now, locale: EN, weekStartsOn })
}

describe('calendar primitives', () => {
  it('formats a local date without ever touching UTC', () => {
    expect(toIsoDate(new Date(2026, 0, 5))).toBe('2026-01-05')
    expect(toIsoDate(new Date(2026, 11, 31, 23, 59))).toBe('2026-12-31')
    expect(todayIso(NOW)).toBe('2026-07-29')
  })

  it('parses an ISO date onto the LOCAL calendar', () => {
    // The whole reason this function exists: `new Date('2026-08-14')` is UTC
    // midnight and reads back as the 13th anywhere west of Greenwich.
    const d = parseIsoDate('2026-08-14')
    expect(d).not.toBeNull()
    expect(d?.getFullYear()).toBe(2026)
    expect(d?.getMonth()).toBe(7)
    expect(d?.getDate()).toBe(14)
    expect(d?.getHours()).toBe(0)
  })

  it('rejects everything that is not exactly YYYY-MM-DD', () => {
    for (const bad of [
      '',
      '   ',
      '2026-8-14',
      '14/08/2026',
      '2026-02-30', // rolls to Mar 2 under the Date constructor; must not pass
      '2026-13-01',
      '2026-00-10',
      '2026-08-00',
      '2026-08-14T10:00:00Z',
      'tomorrow',
      'null',
    ]) {
      expect(parseIsoDate(bad), bad).toBeNull()
    }
    expect(parseIsoDate(null)).toBeNull()
    expect(parseIsoDate(undefined)).toBeNull()
  })

  it('adds days across month, year and leap boundaries', () => {
    expect(addDays('2026-07-29', 1)).toBe('2026-07-30')
    expect(addDays('2026-07-29', 3)).toBe('2026-08-01')
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31')
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29')
    expect(addDays('2026-02-28', 1)).toBe('2026-03-01')
    expect(addDays('2026-07-29', 0)).toBe('2026-07-29')
  })

  it('clamps addMonths to the target month rather than overflowing', () => {
    // Jan 31 + 1 month is Feb 28, never Mar 3 — this is what stops a monthly
    // template anchored on the 31st migrating to the 3rd of every month.
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28')
    expect(addMonths('2028-01-31', 1)).toBe('2028-02-29')
    expect(addMonths('2026-03-31', -1)).toBe('2026-02-28')
    expect(addMonths('2026-07-29', 12)).toBe('2027-07-29')
    expect(addMonths('2026-01-15', -1)).toBe('2025-12-15')
  })

  it('diffs days as b - a', () => {
    expect(diffDays('2026-07-29', '2026-07-30')).toBe(1)
    expect(diffDays('2026-07-30', '2026-07-29')).toBe(-1)
    expect(diffDays('2026-07-29', '2026-07-29')).toBe(0)
    expect(diffDays('2026-01-01', '2027-01-01')).toBe(365)
    expect(diffDays('nonsense', '2026-07-29')).toBe(0)
  })

  it('reports weekdays with Sunday at 0', () => {
    expect(isoWeekday('2026-07-29')).toBe(3) // Wednesday
    expect(isoWeekday('2026-08-02')).toBe(0) // Sunday
    expect(isoWeekday('2026-08-01')).toBe(6) // Saturday
  })

  it('clamps to a range', () => {
    expect(clampIso('2026-07-29', '2026-08-01')).toBe('2026-08-01')
    expect(clampIso('2026-07-29', undefined, '2026-07-01')).toBe('2026-07-01')
    expect(clampIso('2026-07-29', '2026-07-01', '2026-08-01')).toBe('2026-07-29')
  })

  it('converts instants to the LOCAL calendar date, not the UTC slice', () => {
    expect(instantToIsoDate(localInstant(2026, 7, 29, 23, 50))).toBe('2026-07-29')
    expect(instantToIsoDate(localInstant(2026, 7, 29, 0, 10))).toBe('2026-07-29')
    expect(instantToIsoDate('not an instant')).toBe('')
  })

  it('counts CALENDAR days since an instant, not elapsed 24h periods', () => {
    // Touched at 23:50 last night is one day old this morning, which is what
    // v_entry_health.days_since_activity means and what a human means.
    expect(daysSince(localInstant(2026, 7, 28, 23, 50), new Date(2026, 6, 29, 0, 10))).toBe(1)
    expect(daysSince(localInstant(2026, 7, 29, 8, 0), NOW)).toBe(0)
    expect(daysSince(localInstant(2026, 7, 15, 12, 0), NOW)).toBe(14)
  })
})

// ── the year range (FIX-BACKLOG DATE-YEAR) ─────────────────────────────────
//
// `\d{4}` is a shape check. Every helper here used to re-enter JavaScript's
// two-digit-year trap through `Date.UTC(y, …)` — which maps 0-99 to 1900-1999
// exactly like `new Date(y, …)` — and none of them padded the year on the way
// out. The four reproductions below are the auditor's, verbatim; each one is a
// different way for a four-digit-looking year to produce a plausible wrong
// answer, which is worse than a refusal.

describe('year range and totality', () => {
  it('rejects a year outside the supported range', () => {
    for (const bad of [
      '0026-08-14', // the reproduction: accepted, then arithmetic read it as 1926
      '0000-01-01',
      '0050-01-31',
      '0099-06-15',
      '1899-12-31',
      '3000-01-01',
    ]) {
      expect(parseIsoDate(bad), bad).toBeNull()
    }
    // …and the boundaries themselves are IN.
    expect(parseIsoDate('1900-01-01')).not.toBeNull()
    expect(parseIsoDate('2999-12-31')).not.toBeNull()
    expect(MIN_ISO_YEAR).toBe(1900)
    expect(MAX_ISO_YEAR).toBe(2999)
  })

  it('never returns a string it would not accept back', () => {
    // `addMonths('0050-01-31', -12)` returned '49-01-31': not YYYY-MM-DD, and
    // parseIsoDate rejected this module's own output. The round trip is the
    // invariant, so it is asserted as a round trip.
    const cases: IsoDate[] = []
    for (const iso of ['1900-01-01', '2026-07-29', '2999-12-31', '2028-02-29']) {
      for (const n of [-400, -31, -1, 0, 1, 31, 400]) {
        cases.push(addDays(iso, n), addMonths(iso, n))
      }
    }
    for (const out of cases) {
      expect(out, out).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      // Either a real date, or the argument handed back untouched — never a
      // third thing.
      expect(parseIsoDate(out), out).not.toBeNull()
    }
  })

  it('hands the argument back rather than folding out of range', () => {
    // TOTAL, and visibly so: an answer outside the range is not silently
    // wrapped into a plausible one.
    expect(addDays('2999-12-31', 1)).toBe('2999-12-31')
    expect(addMonths('2999-12-31', 1)).toBe('2999-12-31')
    expect(addDays('1900-01-01', -1)).toBe('1900-01-01')
    expect(addMonths('1900-01-01', -1)).toBe('1900-01-01')
    // An out-of-range ARGUMENT is unparseable and comes back verbatim, exactly
    // like 'tomorrow' or ''.
    expect(addDays('0026-08-14', 1)).toBe('0026-08-14') // was '1926-08-15'
    expect(addMonths('0050-01-31', -12)).toBe('0050-01-31') // was '49-01-31'
    expect(addDays('nonsense', 1)).toBe('nonsense')
  })

  it('refuses to measure a distance it cannot measure', () => {
    // 9862 was the answer this returned: the gap from 1999, not from 99.
    expect(diffDays('0099-06-15', '2026-06-15')).toBe(0)
    expect(diffDays('2026-06-15', '0099-06-15')).toBe(0)
    expect(diffDays('2026-06-15', '2026-06-20')).toBe(5)
  })

  it('does not let a two-digit year reach a formatter', () => {
    // `formatDate('0026-08-14')` rendered '14/08/26' — a date that looks fine
    // and is nineteen centuries wrong. Unparseable input is passed through
    // verbatim on purpose: bad data must look like bad data.
    expect(formatDate('0026-08-14', EN)).toBe('0026-08-14')
    expect(formatDateLong('0026-08-14', EN)).toBe('0026-08-14')
    expect(formatWeekday('0026-08-14', EN)).toBe('')
    // `formatDue` said '36509 d overdue'.
    expect(formatDue('0026-08-14', EN, NOW)).toBe('—')
    expect(dueBucket('0026-08-14', NOW)).toBe('none')
  })

  it('refuses a relative offset that would leave the range', () => {
    // `due:-9999m` is 833 years back. Returning today would file the item on a
    // date the user never typed, with no problem chip — so this is a MISS, and
    // the capture screen renders it red.
    expect(rel('-9999m')).toBeNull()
    expect(rel('+9999m')).toBe('2859-10-29')
    expect(rel('-9999w')).toBeNull()
    expect(rel('+9999d')).toBe('2053-12-13')
    expect(rel('0026-08-14')).toBeNull()
    expect(rel('14/8/1899')).toBeNull()
  })
})

describe('parseRelativeDate — English', () => {
  it('resolves the fixed words', () => {
    expect(rel('today')).toBe('2026-07-29')
    expect(rel('tod')).toBe('2026-07-29')
    expect(rel('TODAY')).toBe('2026-07-29')
    expect(rel('tomorrow')).toBe('2026-07-30')
    expect(rel('tmr')).toBe('2026-07-30')
    expect(rel('yesterday')).toBe('2026-07-28')
  })

  it('takes a bare weekday to the next STRICTLY FUTURE occurrence', () => {
    expect(rel('thu')).toBe('2026-07-30')
    expect(rel('thursday')).toBe('2026-07-30')
    expect(rel('fri')).toBe('2026-07-31')
    expect(rel('sun')).toBe('2026-08-02')
    // The frozen rule: today's own weekday is +7, never today.
    expect(rel('wed')).toBe('2026-08-05')
    expect(rel('wednesday')).toBe('2026-08-05')
  })

  it('resolves +N offsets in days, weeks and months', () => {
    expect(rel('+3d')).toBe('2026-08-01')
    expect(rel('+1d')).toBe('2026-07-30')
    expect(rel('+2w')).toBe('2026-08-12')
    expect(rel('+1m')).toBe('2026-08-29')
    expect(rel('-3d')).toBe('2026-07-26')
    // A bare number is not an offset: the sign is what makes it unambiguous.
    expect(rel('3d')).toBeNull()
  })

  it('accepts ISO and DAY-FIRST slash dates only', () => {
    expect(rel('2026-08-14')).toBe('2026-08-14')
    expect(rel('14/8')).toBe('2026-08-14')
    expect(rel('14/8/2026')).toBe('2026-08-14')
    expect(rel('14/8/26')).toBe('2026-08-14')
    expect(rel('1/9')).toBe('2026-09-01')
    // Month-first is never guessed at: 29/07 is 29 July, and 07/29 is invalid
    // rather than silently re-read as the American order.
    expect(rel('07/29')).toBeNull()
    expect(rel('2026-02-30')).toBeNull()
  })

  it('resolves end-of-week and end-of-month', () => {
    expect(rel('eow')).toBe('2026-08-01') // Sunday-anchored week: Sun 26 → Sat 1
    expect(rel('eow', NOW, 1)).toBe('2026-08-02') // Monday-anchored: Mon 27 → Sun 2
    expect(rel('eom')).toBe('2026-07-31')
    expect(parseRelativeDate('eom', { now: new Date(2028, 1, 3), locale: EN })).toBe('2028-02-29')
  })

  it('returns null on garbage and never throws', () => {
    for (const bad of ['someday', '', '   ', '???', 'due', 'next tuesdayish', '99/99/9999']) {
      expect(rel(bad), bad).toBeNull()
    }
  })
})

describe('parseRelativeDate — Arabic', () => {
  it('resolves the fixed words in every spelling that folds the same', () => {
    expect(rel('اليوم')).toBe('2026-07-29')
    expect(rel('غدا')).toBe('2026-07-30')
    expect(rel('غداً')).toBe('2026-07-30') // tanween stripped by foldArabic
    expect(rel('بكرة')).toBe('2026-07-30')
    expect(rel('أمس')).toBe('2026-07-28')
    expect(rel('امس')).toBe('2026-07-28') // hamza-less alef, the common typing
  })

  it('resolves weekdays with and without the definite article', () => {
    expect(rel('الخميس')).toBe('2026-07-30')
    expect(rel('خميس')).toBe('2026-07-30')
    expect(rel('الأحد')).toBe('2026-08-02')
    expect(rel('الاحد')).toBe('2026-08-02')
    expect(rel('الجمعة')).toBe('2026-07-31')
    expect(rel('الجمعه')).toBe('2026-07-31')
    expect(rel('الأربعاء')).toBe('2026-08-05') // today's weekday → +7
    expect(rel('السبت')).toBe('2026-08-01')
    expect(rel('الاثنين')).toBe('2026-08-03')
    expect(rel('الإثنين')).toBe('2026-08-03')
    expect(rel('الثلاثاء')).toBe('2026-08-04')
  })

  it('accepts Arabic-Indic and Eastern Arabic digits in offsets and dates', () => {
    // An Arabic keyboard produces these. Refusing them would make the parser
    // feel broken to exactly the users it was translated for.
    expect(rel('+٣d')).toBe('2026-08-01')
    expect(rel('+۳d')).toBe('2026-08-01')
    expect(rel('١٤/٨')).toBe('2026-08-14')
    expect(rel('٢٠٢٦-٠٨-١٤')).toBe('2026-08-14')
  })

  it('resolves the multi-word end-of-period phrases', () => {
    expect(rel('نهاية الأسبوع')).toBe('2026-08-01')
    expect(rel('نهاية الشهر')).toBe('2026-07-31')
  })

  it('tolerates the invisible bidi marks an RTL keyboard emits', () => {
    expect(rel('‏الخميس')).toBe('2026-07-30')
    expect(rel('الخميس‎')).toBe('2026-07-30')
    expect(rel('؜غدا‏')).toBe('2026-07-30')
    expect(rel('‏+3d')).toBe('2026-08-01')
  })
})

describe('ranges and buckets', () => {
  it('bounds the week Sunday-first by default', () => {
    expect(weekBounds(NOW)).toEqual({ from: '2026-07-26', to: '2026-08-01' })
    expect(weekBounds(NOW, 1)).toEqual({ from: '2026-07-27', to: '2026-08-02' })
    expect(weekBounds(NOW, 6)).toEqual({ from: '2026-07-25', to: '2026-07-31' })
  })

  it('takes lastNDays INCLUSIVE of today', () => {
    expect(lastNDays(7, NOW)).toEqual({ from: '2026-07-23', to: '2026-07-29' })
    expect(lastNDays(1, NOW)).toEqual({ from: '2026-07-29', to: '2026-07-29' })
  })

  it('buckets a due date by the calendar week, not by 168 hours', () => {
    expect(dueBucket(null, NOW)).toBe('none')
    expect(dueBucket('garbage', NOW)).toBe('none')
    expect(dueBucket('2026-07-28', NOW)).toBe('overdue')
    expect(dueBucket('2026-07-29', NOW)).toBe('today')
    expect(dueBucket('2026-08-01', NOW)).toBe('week') // last day of this week
    expect(dueBucket('2026-08-02', NOW)).toBe('later') // first day of the next
  })

  it('buckets ages into the histogram columns', () => {
    expect(bucketAge(0)).toBe('0-3')
    expect(bucketAge(3)).toBe('0-3')
    expect(bucketAge(4)).toBe('4-7')
    expect(bucketAge(7)).toBe('4-7')
    expect(bucketAge(8)).toBe('8-14')
    expect(bucketAge(14)).toBe('8-14')
    expect(bucketAge(15)).toBe('15+')
    expect(bucketAge(400)).toBe('15+')
  })
})

describe('formatting', () => {
  it('renders Gregorian, day-first, LATIN numerals in both languages', () => {
    // The trap: `new Intl.DateTimeFormat('ar')` gives an Islamic calendar and
    // Arabic-Indic digits, both forbidden by spec §5.
    expect(formatDate('2026-07-29', EN)).toBe('29/07/2026')
    expect(visible(formatDate('2026-07-29', AR))).toBe('29/07/2026')
    expect(formatDate(null, EN)).toBe('—')
    expect(formatDate('garbage', EN)).toBe('garbage')
  })

  it('renders the long form with a spelled month', () => {
    expect(formatDateLong('2026-07-29', EN)).toBe('29 July 2026')
    expect(visible(formatDateLong('2026-07-29', AR))).toContain('2026')
    expect(visible(formatDateLong('2026-07-29', AR))).toContain('29')
  })

  it('joins a range with the locale separator', () => {
    expect(formatDateRange('2026-07-23', '2026-07-29', EN)).toBe('23/07/2026–29/07/2026')
  })

  it('renders timestamps on a 24-hour clock', () => {
    const ts = localInstant(2026, 7, 29, 14, 5)
    expect(formatTimestamp(ts, EN)).toBe('29/07/2026, 14:05')
    expect(visible(formatTimestamp(ts, AR))).toContain('14:05')
    expect(formatTimestamp('not an instant', EN)).toBe('not an instant')
  })

  it('renders relative time and falls back to a date past a week', () => {
    expect(formatRelativeTime(new Date(NOW.getTime() - 30_000).toISOString(), EN, NOW)).toBe(
      'Just now',
    )
    expect(formatRelativeTime(new Date(NOW.getTime() - 5 * 60_000).toISOString(), EN, NOW)).toBe(
      '5 min ago',
    )
    expect(formatRelativeTime(new Date(NOW.getTime() - 3 * 3_600_000).toISOString(), EN, NOW)).toBe(
      '3 h ago',
    )
    expect(formatRelativeTime(localInstant(2026, 7, 27, 12, 0), EN, NOW)).toBe('2 d ago')
    // Past a week the count stops meaning anything and the date takes over.
    expect(formatRelativeTime(localInstant(2026, 6, 1, 12, 0), EN, NOW)).toBe('01/06/2026')
  })

  it('renders the age pill with Latin numerals in Arabic too', () => {
    expect(formatAge(14, EN)).toBe('14d')
    expect(formatAge(14, AR)).toBe('14ي')
    expect(formatAge(-3, EN)).toBe('0d')
  })

  it('renders a due date the way a human reads one', () => {
    expect(formatDue(null, EN, NOW)).toBe('—')
    expect(formatDue('2026-07-27', EN, NOW)).toBe('2 d overdue')
    expect(formatDue('2026-07-29', EN, NOW)).toBe('Today')
    expect(formatDue('2026-07-30', EN, NOW)).toBe('Tomorrow')
    expect(formatDue('2026-08-03', EN, NOW)).toBe('due in 5 d')
    expect(formatDue('2026-09-30', EN, NOW)).toBe('30/09/2026')
    expect(formatDue('2026-07-29', AR, NOW)).toBe('اليوم')
  })

  it('inflects the Arabic day count instead of pinning one form', () => {
    // The failure lib/plural.ts exists to stop, end to end through s(): the
    // singular `يوم` is ungrammatical for 2 and for 3–10, and this module's
    // strings are the ones a user reads most. English is invariant here on
    // purpose — its `date.*` counts are abbreviated ("2 d overdue"), so they
    // stay plain strings and are asserted above.
    expect(formatDue('2026-07-28', AR, NOW)).toBe('متأخّر يومًا واحدًا')
    expect(formatDue('2026-07-27', AR, NOW)).toBe('متأخّر يومين')
    expect(formatDue('2026-07-24', AR, NOW)).toBe('متأخّر 5 أيام')
    expect(formatDue('2026-07-31', AR, NOW)).toBe('يستحق خلال يومين')
    expect(formatDue('2026-08-03', AR, NOW)).toBe('يستحق خلال 5 أيام')
  })

  it('inflects the Arabic relative time the same way', () => {
    const ago = (ms: number): string =>
      formatRelativeTime(new Date(NOW.getTime() - ms).toISOString(), AR, NOW)
    expect(ago(2 * 60_000)).toBe('قبل دقيقتين')
    expect(ago(5 * 60_000)).toBe('قبل 5 دقائق')
    expect(ago(30 * 60_000)).toBe('قبل 30 دقيقة')
    expect(ago(2 * 3_600_000)).toBe('قبل ساعتين')
    expect(ago(5 * 3_600_000)).toBe('قبل 5 ساعات')
  })

  it('renders weekday names', () => {
    expect(formatWeekday('2026-07-29', EN)).toBe('Wed')
    expect(formatWeekday('2026-07-29', EN, 'long')).toBe('Wednesday')
    expect(formatWeekday('2026-07-29', AR, 'long')).toBe('الأربعاء')
    expect(formatWeekday('garbage', EN)).toBe('')
  })

  it('honours the requested locale rather than the global one', () => {
    // The property the digest depends on: an Arabic digest generated while the
    // UI is in English must render Arabic date labels. A formatter built on t()
    // would silently ignore its own argument here.
    expect(formatDue('2026-07-30', AR, NOW)).not.toBe(formatDue('2026-07-30', EN, NOW))
    expect(formatAge(3, AR)).not.toBe(formatAge(3, EN))
  })
})
