import { describe, expect, it, vi } from 'vitest'

// WHAT THIS FILE EXISTS FOR, IN ONE SENTENCE: a PostgREST query builder is a
// thenable, not a promise, so the only observable difference between "the
// profile write was sent" and "the profile write was built and thrown away" is
// whether something called `.then()` on it — and that difference shipped
// undetected from Wave 1 to the v1.0.0 release smoke.
//
// THE BUG. `setLocaleSetting` mirrors the chosen language to `profiles.locale`
// so it follows the user to another device. It did it like this:
//
//     void client.from('profiles').update({ locale: l }).eq('id', userId)
//
// `void` evaluates its operand and discards the result. `postgrest-js` builds
// the URL, sets the headers and calls `fetch` inside `PostgrestBuilder.then()`
// — nothing before it touches the network. So that line constructed a builder,
// dropped it, and sent nothing, for every language change by every user.
//
// WHY IT SURVIVED EVERY OTHER GATE. It is not a type error: the expression is
// well-typed and `void` is the lint-approved way to say "I am deliberately not
// awaiting this". It is not a runtime error: nothing rejects, nothing logs. And
// it is invisible in the session that causes it — lib/i18n has already switched
// the interface and written `opstrack_locale`, so the app is in the right
// language and stays there. The symptom lands on the NEXT load, when
// store/auth's applyProfileLocale reads the stale column and pulls the UI back
// to English, on a different screen, with nothing connecting it to the toggle.
//
// WHY THE ASSERTION IS SHAPED LIKE THIS. Asserting on a fetch spy would test
// postgrest-js, need a URL, and break on any client upgrade. Asserting that
// `.update()` was called would have PASSED against the bug — it was called; it
// just never ran. Subscription is the boundary between the two states, so
// subscription is what the fake records and what this file asserts.

// Two browser globals, shimmed before the dynamic import below rather than
// mocked, for the reason store/vocab.test.ts sets out at length: vitest runs in
// `node`, and lib/i18n legitimately reads `localStorage` at module scope and
// stamps `lang`/`dir` onto `document.documentElement` on every change. Handing
// it the globals it expects keeps the module under test unmodified; a static
// import would hoist above this block and defeat the ordering.
const g = globalThis as { localStorage?: Storage; document?: Document }
if (!g.document) {
  g.document = { documentElement: { lang: '', dir: '' } } as unknown as Document
}
if (!g.localStorage) {
  const mem = new Map<string, string>()
  g.localStorage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => {
      mem.set(k, v)
    },
    removeItem: (k: string) => {
      mem.delete(k)
    },
    clear: () => {
      mem.clear()
    },
    key: (i: number) => [...mem.keys()][i] ?? null,
    get length() {
      return mem.size
    },
  } as unknown as Storage
}

/** What the fake client recorded about the one write this module can make. */
const calls = {
  /** Tables `.from()` was asked for. */
  tables: [] as string[],
  /** Payloads handed to `.update()`. */
  updates: [] as Record<string, unknown>[],
  /** `.eq()` filters, as [column, value]. */
  filters: [] as [string, unknown][],
  /** THE ONE THAT MATTERS: did anything subscribe to the builder? */
  subscribed: 0,
}

/**
 * A stand-in for the two client surfaces this module touches.
 *
 * The builder deliberately mimics postgrest-js's laziness rather than being a
 * resolved promise: `then` increments a counter, so a caller that only
 * constructs the chain leaves it at zero exactly as the real client leaves the
 * network untouched. A plain `Promise.resolve()` here would make the fake
 * incapable of expressing the bug, and the test would pass either way.
 */
const fakeClient = {
  auth: {
    getSession: () => Promise.resolve({ data: { session: { user: { id: 'u-1' } } } }),
  },
  from(table: string) {
    calls.tables.push(table)
    const builder = {
      update(payload: Record<string, unknown>) {
        calls.updates.push(payload)
        return builder
      },
      eq(col: string, val: unknown) {
        calls.filters.push([col, val])
        return builder
      },
      then(onfulfilled?: (v: unknown) => unknown) {
        calls.subscribed += 1
        return Promise.resolve({ data: null, error: null }).then(onfulfilled)
      },
    }
    return builder
  },
}

vi.mock('../api/supabase', () => ({
  supabase: fakeClient,
  isConfigured: () => true,
}))

const { setLocaleSetting } = await import('./settings')
const { getLocale } = await import('../lib/i18n')

/** Let the `getSession()` microtask and the builder subscription settle. */
const settle = () => new Promise((r) => setTimeout(r, 0))

describe('setLocaleSetting mirrors the language to the profile', () => {
  it('SENDS the update — subscribes to the builder, not just builds it', async () => {
    const target = getLocale() === 'ar' ? 'en' : 'ar'
    setLocaleSetting(target)
    await settle()

    // The regression assertion. Against the `void builder` form every
    // expectation below except this one still held.
    expect(calls.subscribed).toBe(1)

    expect(calls.tables).toContain('profiles')
    expect(calls.updates).toContainEqual({ locale: target })
    expect(calls.filters).toContainEqual(['id', 'u-1'])
  })

  it('switches the interface immediately, before the write resolves', () => {
    const target = getLocale() === 'ar' ? 'en' : 'ar'
    setLocaleSetting(target)
    // Synchronous: the UI must never wait on the network to change language,
    // which is the reason the write is fire-and-forget in the first place.
    expect(getLocale()).toBe(target)
  })

  it('is a no-op when the requested locale is already active', async () => {
    const before = calls.subscribed
    setLocaleSetting(getLocale())
    await settle()
    expect(calls.subscribed).toBe(before)
  })
})
