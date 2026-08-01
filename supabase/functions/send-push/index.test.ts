// The sentence that lands on a lock screen, where nobody can correct it.
//
// ═══ THE DEFECT THIS FILE EXISTS TO KEEP FIXED ═══
//
// `0019_nudges.sql` widened `notifications_kind_check` to allow `'nudged'` and
// its PART 2 note says exactly why: *"it must be distinguishable from 'you were
// assigned this' or the inbox will say the wrong thing."* `buildPayload()` then
// read that three-valued column through a BOOLEAN — `row.kind === 'completed'`
// — and rendered every other kind as `assigned`. So the first thing the nudge
// feature ever did in production was tell the owner of an item they already
// owned that it had just been assigned to them.
//
// 0019's own PROBE 1 could not catch it: a migration probe can assert that a
// `push_outbox` row exists, and this function is what decides what that row
// SAYS. That gap is the reason these assertions are here and not in SQL.
//
// The strings are a deliberate second copy of `src/locales/{en,ar}/notif.json`
// (a service worker cannot call `t()`), so the last block below pins the copy
// to the source tree — the two drift silently otherwise, and a push that
// disagrees with the inbox line it links to is worse than either alone.

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

import { buildPayload, type QueuedNotification } from './index.ts'

interface Payload {
  id: string
  kind: string
  title: string
  body: string
  path: string
  tag: string
}

function row(over: Partial<QueuedNotification> = {}): QueuedNotification {
  return {
    outbox_id: 1,
    notification_id: 77,
    kind: 'assigned',
    entry_id: 'e1e1e1e1-1111-4111-8111-111111111111',
    entry_title: 'Renew the gateway certificate',
    actor_name: 'Aziz',
    recipient_locale: 'en',
    subscriptions: [],
    ...over,
  }
}

/** Never `JSON.parse(buildPayload(...)!)` — a null here is the bug under test. */
function payloadOf(r: QueuedNotification): Payload {
  const raw = buildPayload(r)
  expect(raw).not.toBeNull()
  return JSON.parse(String(raw)) as Payload
}

/* ─────────────────────── the three kinds, both languages ───────────────── */

describe('buildPayload — a nudge must not read as an assignment', () => {
  it('says somebody is ASKING, not that anything was assigned', () => {
    const p = payloadOf(row({ kind: 'nudged' }))
    expect(p.kind).toBe('nudged')
    expect(p.title).toBe('Update requested')
    expect(p.body).toContain('is asking for an update on')
    expect(p.body).not.toContain('assigned')
  })

  it('says the same thing in Arabic', () => {
    const p = payloadOf(row({ kind: 'nudged', recipient_locale: 'ar' }))
    expect(p.title).toBe('طُلب منك تحديث')
    expect(p.body).toContain('يطلب')
    expect(p.body).not.toContain('أسند')
  })

  it('still renders an assignment as an assignment', () => {
    const p = payloadOf(row({ kind: 'assigned' }))
    expect(p.kind).toBe('assigned')
    expect(p.title).toBe('Assigned to you')
    expect(p.body).toBe('⁨Aziz⁩ assigned you “⁨Renew the gateway certificate⁩”')
  })

  it('still renders a completion as a completion', () => {
    const p = payloadOf(row({ kind: 'completed' }))
    expect(p.kind).toBe('completed')
    expect(p.title).toBe('Item completed')
    expect(p.body).toContain('completed')
  })

  it('gives the three kinds three DIFFERENT headings and three different bodies', () => {
    // The property the boolean broke, stated as a property rather than as three
    // examples: no two kinds may be indistinguishable on a lock screen.
    for (const locale of ['en', 'ar']) {
      const seen = ['assigned', 'completed', 'nudged'].map((kind) =>
        payloadOf(row({ kind, recipient_locale: locale })),
      )
      expect(new Set(seen.map((p) => p.title)).size).toBe(3)
      expect(new Set(seen.map((p) => p.body)).size).toBe(3)
      expect(new Set(seen.map((p) => p.kind)).size).toBe(3)
    }
  })
})

describe('buildPayload — the actorless branch of every kind', () => {
  // `actor_name` is empty when the actor's profile is gone, which is exactly
  // when a sentence built by string-replacing an empty {actor} reads as broken
  // punctuation. Each kind has its own sentence for that case.
  for (const kind of ['assigned', 'completed', 'nudged']) {
    for (const locale of ['en', 'ar']) {
      it(`renders ${kind}/${locale} with no actor and leaves no placeholder`, () => {
        const p = payloadOf(row({ kind, recipient_locale: locale, actor_name: '   ' }))
        expect(p.body).not.toContain('{actor}')
        expect(p.body).not.toContain('{title}')
        expect(p.body).not.toContain('⁨⁩')
        expect(p.body.trim()).toBe(p.body)
      })
    }
  }

  it('names the person when there is one', () => {
    expect(payloadOf(row({ kind: 'nudged' })).body).toContain('Aziz')
    expect(payloadOf(row({ kind: 'nudged', actor_name: '' })).body).toContain('Someone')
  })
})

/* ───────────────── an unknown kind must not assert a falsehood ─────────── */

describe('buildPayload — a kind this build has never heard of', () => {
  it('returns null rather than guessing', () => {
    // The old default guessed 'assigned' and that is the whole defect. A banner
    // stating something untrue is worse than no banner: the in-app inbox still
    // holds the row and renders it from the client's own locale tree.
    for (const kind of ['mentioned', 'escalated', '', 'ASSIGNED', 'nudge']) {
      expect(buildPayload(row({ kind }))).toBeNull()
    }
  })

  it('does not fall through a prototype key', () => {
    for (const kind of ['constructor', 'toString', '__proto__']) {
      expect(buildPayload(row({ kind }))).toBeNull()
    }
  })
})

/* ──────────────────────────── the invariants ───────────────────────────── */

describe('buildPayload — what every payload carries whatever the kind', () => {
  it('isolates both interpolations, in both directions', () => {
    // U+2068 … U+2069. They matter MORE here than in the app: the OS
    // notification shade runs the same bidi algorithm and has no CSS to fix it.
    for (const kind of ['assigned', 'completed', 'nudged']) {
      for (const locale of ['en', 'ar']) {
        const p = payloadOf(
          row({ kind, recipient_locale: locale, entry_title: 'Renew SSL', actor_name: 'عزيز' }),
        )
        const opens = [...p.body].filter((c) => c === '⁨').length
        const closes = [...p.body].filter((c) => c === '⁩').length
        expect(opens).toBe(2)
        expect(closes).toBe(2)
      }
    }
  })

  it('falls back to a title rather than an empty pair of quotes', () => {
    expect(payloadOf(row({ kind: 'nudged', entry_title: '   ' })).body).toContain('Untitled item')
    expect(
      payloadOf(row({ kind: 'nudged', entry_title: '', recipient_locale: 'ar' })).body,
    ).toContain('بند بلا عنوان')
  })

  it('routes to the entry as a hash path, not a deployment-specific URL', () => {
    const p = payloadOf(row({ kind: 'nudged' }))
    expect(p.path).toBe('#/entry/e1e1e1e1-1111-4111-8111-111111111111')
    expect(p.path).not.toContain('http')
  })

  it('tags one notification per inbox row so a retry replaces the banner', () => {
    expect(payloadOf(row({ kind: 'nudged' })).tag).toBe('opstrack-n-77')
    expect(payloadOf(row({ kind: 'nudged' })).id).toBe('77')
  })

  it('treats an unrecognised locale as English rather than as nothing', () => {
    const p = payloadOf(row({ kind: 'nudged', recipient_locale: 'fr' }))
    expect(p.title).toBe('Update requested')
  })
})

/* ────────── the second copy must equal the tree it is a copy of ────────── */

describe('the push sentences are byte-identical to the locale trees', () => {
  // A person who taps the banner lands on the inbox line describing the same
  // event. If the two disagree, one of them is lying about what happened.
  const keys = [
    ['assigned', 'assigned'],
    ['completed', 'completed'],
    ['nudged', 'nudged'],
    ['assignedNoActor', 'assignedNoActor'],
    ['completedNoActor', 'completedNoActor'],
    ['nudgedNoActor', 'nudgedNoActor'],
    ['untitled', 'untitled'],
  ] as const

  for (const locale of ['en', 'ar'] as const) {
    const tree = JSON.parse(
      readFileSync(new URL(`../../../src/locales/${locale}/notif.json`, import.meta.url), 'utf8'),
    ) as { notif: Record<string, string> }

    for (const [pushKey, notifKey] of keys) {
      it(`${locale}.${pushKey} matches notif.${notifKey}`, () => {
        // Rendered through buildPayload rather than read off the constant, so
        // this also proves the sentence is the one actually SELECTED.
        const kind =
          pushKey.startsWith('assigned') ? 'assigned'
          : pushKey.startsWith('completed') ? 'completed'
          : pushKey.startsWith('nudged') ? 'nudged'
          : 'assigned'
        const actor = pushKey.endsWith('NoActor') ? '' : 'Aziz'
        const title = pushKey === 'untitled' ? '' : 'Renew SSL'
        const p = payloadOf(row({ kind, recipient_locale: locale, actor_name: actor, entry_title: title }))
        const expected = tree.notif[notifKey]
          .replace('{actor}', actor)
          .replace('{title}', title || tree.notif.untitled)
        if (pushKey === 'untitled') {
          expect(p.body).toContain(tree.notif.untitled)
        } else {
          expect(p.body).toBe(expected)
        }
      })
    }
  }
})
