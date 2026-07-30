// Supabase Edge Function: send-push
//
// The Web Push sender. It takes rows off `public.push_outbox`, encrypts one
// payload per subscription per RFC 8291, signs a VAPID token per RFC 8292, and
// POSTs the result to whatever push service the browser handed us (FCM for
// Chrome/Edge, Mozilla autopush for Firefox, Apple's for Safari and installed
// iOS PWAs).
//
// ── WHY A QUEUE AND NOT A DATABASE WEBHOOK ────────────────────────────────────
// Supabase's Database Webhooks are one `net.http_post` fired from an AFTER
// INSERT trigger. That is the whole mechanism: fire-and-forget, no retry, no
// record that a delivery was ever owed. A function cold-start that times out, a
// 30-second FCM blip, or a deploy in progress silently drops the notification
// and nothing anywhere knows. For an app whose entire proposition is "you will
// be told when something becomes yours", a silently-lost telling is the worst
// available failure.
//
// So 0011 gives the delivery a ROW. `notifications_enqueue_push_trg` writes one
// `push_outbox` row per notification inside the same transaction that wrote the
// notification — if the entry update commits, the delivery obligation commits
// with it. Two things then drain it, and both call this function:
//
//   1. the same trigger's best-effort `net.http_post` wake-up, for latency
//      (delivery lands in ~1s rather than waiting for the tick), wrapped in an
//      exception block so a push problem can never roll back a user's edit;
//   2. `cron.schedule('opstrack-drain-push', '* * * * *')`, for truth — it
//      retries with backoff, survives this function being down, and closes the
//      window where the wake-up itself was the thing that failed.
//
// Everything about which rows are due, how many attempts are left and when the
// next one is allowed lives in SQL (`claim_push_batch` / `settle_push`), so two
// concurrent drains cannot send the same notification twice: the claim is a
// `for update skip locked` inside one statement.
//
// ── AUTH ──────────────────────────────────────────────────────────────────────
// Two gates, because one is not enough:
//   * `verify_jwt` stays ON at the gateway, so an anonymous caller with no
//     project key never reaches this code at all. The database sends the ANON
//     key, which is public by design and satisfies exactly that gate.
//   * `x-push-drain` must equal the `PUSH_DRAIN_SECRET` function secret. This
//     is the real gate: the anon key is in every browser bundle, and without
//     this header anyone could make the queue drain early or fish for a summary.
// The service-role key is never sent by the caller — it is injected into this
// function's environment by Supabase and used only here, to read subscriptions
// and settle the queue.
//
// ── THE VAPID PRIVATE KEY ─────────────────────────────────────────────────────
// `VAPID_PRIVATE_KEY` is a function secret and exists nowhere else: not in the
// repo, not in `.env`, not in the database. It is the raw 32-byte P-256 scalar,
// base64url, exactly as every web-push library writes it. The matching public
// key is NOT a secret — it ships in the client bundle, because the browser has
// to hand it to the push service at subscribe time.
//
// ── WHY THE CRYPTO IS WRITTEN OUT HERE ────────────────────────────────────────
// `npm:web-push` is a Node library that reaches for `node:crypto`'s EC APIs and
// pulls a dependency tree into a function that has to cold-start fast. All of
// RFC 8291 is four HMACs, one ECDH and one AES-GCM seal — 60 lines of WebCrypto
// that Deno, Node and every browser implement natively. It is written out below
// and pinned to the worked example in RFC 8291 §5 (see `encryptPayload`), which
// is a far stronger guarantee than "the library is popular".
//
// Deploy:
//   npx supabase functions deploy send-push --project-ref <ref> --use-api
// Secrets (Management API, never committed):
//   VAPID_PUBLIC_KEY  VAPID_PRIVATE_KEY  VAPID_SUBJECT  PUSH_DRAIN_SECRET

import { createClient } from 'npm:@supabase/supabase-js@2'

/* ────────────────────────────── environment ────────────────────────────── */

/**
 * Deno's globals, reached through `globalThis` rather than the bare `Deno`
 * identifier.
 *
 * This file is imported by a Node harness that runs the RFC 8291 vector against
 * the very functions this function ships (see docs/RUNBOOK.md §9). A top-level
 * `Deno.env.get(...)` would throw there before a single test ran, and a copy of
 * the crypto kept somewhere else "for testing" is a copy that drifts.
 */
interface DenoLike {
  env: { get(key: string): string | undefined }
  serve(handler: (req: Request) => Promise<Response>): void
}

const DENO: DenoLike | undefined = (globalThis as { Deno?: DenoLike }).Deno

function env(key: string): string {
  return DENO?.env.get(key) ?? ''
}

/* ─────────────────────────────── base64url ─────────────────────────────── */

export function base64UrlToBytes(value: string): Uint8Array {
  // Restore the padding and the two substituted characters. Push subscriptions
  // arrive base64url from the browser; JWTs and VAPID keys are base64url too.
  const padded = value.replace(/-/g, '+').replace(/_/g, '/')
  const binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4))
  const out = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i)
  return out
}

export function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = ''
  // Chunked: `String.fromCharCode(...bytes)` on a multi-kilobyte payload blows
  // the argument limit, and the ciphertext here is routinely 4 KB.
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0)
  const out = new Uint8Array(total)
  let at = 0
  for (const p of parts) {
    out.set(p, at)
    at += p.length
  }
  return out
}

const utf8 = (s: string): Uint8Array => new TextEncoder().encode(s)

/* ──────────────────────────────── HKDF ─────────────────────────────────── */

async function hmac(key: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  const k = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
  ])
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, data))
}

/** HKDF-Extract (RFC 5869 §2.2) — one HMAC, salt as the key. */
const hkdfExtract = (salt: Uint8Array, ikm: Uint8Array): Promise<Uint8Array> => hmac(salt, ikm)

/**
 * HKDF-Expand (RFC 5869 §2.3), capped at one block.
 *
 * Every output this protocol asks for is 32 bytes or fewer (a 16-byte content
 * key, a 12-byte nonce, a 32-byte IKM), so the counter never leaves 0x01 and
 * the multi-block loop would be unreachable code.
 */
async function hkdfExpand(prk: Uint8Array, info: Uint8Array, length: number): Promise<Uint8Array> {
  const block = await hmac(prk, concat(info, Uint8Array.of(1)))
  return block.subarray(0, length)
}

/* ───────────────────────── RFC 8291 content encoding ───────────────────── */

/** The 65-byte uncompressed point a browser publishes as `p256dh`. */
async function importUaPublic(raw: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', raw, { name: 'ECDH', namedCurve: 'P-256' }, true, [])
}

/** Our ephemeral half of the ECDH, or a fixed pair when a test vector supplies one. */
async function ephemeralKeys(fixed?: { d: string; publicKey: Uint8Array }) {
  if (!fixed) {
    const pair = (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, [
      'deriveBits',
    ])) as CryptoKeyPair
    return {
      privateKey: pair.privateKey,
      publicKey: new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey)),
    }
  }
  const privateKey = await crypto.subtle.importKey(
    'jwk',
    {
      kty: 'EC',
      crv: 'P-256',
      d: fixed.d,
      // x and y are the two halves of the uncompressed point after its 0x04 tag.
      x: bytesToBase64Url(fixed.publicKey.subarray(1, 33)),
      y: bytesToBase64Url(fixed.publicKey.subarray(33, 65)),
      ext: true,
    },
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    ['deriveBits'],
  )
  return { privateKey, publicKey: fixed.publicKey }
}

/** The record size in the aes128gcm header. 4096 is what every library sends. */
const RECORD_SIZE = 4096

/**
 * Encrypt one push payload into an `aes128gcm` body (RFC 8188 + RFC 8291).
 *
 * PINNED TO THE SPEC'S OWN EXAMPLE. RFC 8291 §5 publishes a complete worked
 * case — fixed UA keys, fixed application-server keys, fixed salt, and the exact
 * body bytes they must produce. `salt` and `fixedKeys` exist for no other reason
 * than to let that vector be replayed: pass nothing in production and both are
 * fresh random values, as they must be (a reused salt with a reused key pair
 * repeats the AES-GCM keystream). The harness in docs/RUNBOOK.md §9 replays the
 * vector against this exact function.
 *
 * The body layout is RFC 8188 §2, single record:
 *   salt(16) ‖ rs(4, big-endian) ‖ idlen(1)=65 ‖ as_public(65) ‖ ciphertext
 * and the plaintext is the payload with a single 0x02 delimiter appended, which
 * is what marks it as the LAST record. A 0x01 there would tell the browser to
 * expect another record and it would reject the message.
 */
export async function encryptPayload(
  payload: Uint8Array,
  uaPublicRaw: Uint8Array,
  authSecret: Uint8Array,
  salt: Uint8Array = crypto.getRandomValues(new Uint8Array(16)),
  fixedKeys?: { d: string; publicKey: Uint8Array },
): Promise<Uint8Array> {
  const uaPublic = await importUaPublic(uaPublicRaw)
  const as = await ephemeralKeys(fixedKeys)

  const ecdhSecret = new Uint8Array(
    await crypto.subtle.deriveBits({ name: 'ECDH', public: uaPublic }, as.privateKey, 256),
  )

  // RFC 8291 §3.3. The auth secret is the salt of the FIRST extract, and the
  // info string binds the derived key to both public keys — which is what stops
  // a payload encrypted for one subscription decrypting under another.
  const prkKey = await hkdfExtract(authSecret, ecdhSecret)
  const keyInfo = concat(utf8('WebPush: info'), Uint8Array.of(0), uaPublicRaw, as.publicKey)
  const ikm = await hkdfExpand(prkKey, keyInfo, 32)

  // RFC 8188 §2.2. No context suffix on these two info strings — that is the
  // difference between `aes128gcm` and the deprecated `aesgcm` encoding, and
  // getting it wrong produces a body every push service happily accepts and no
  // browser can decrypt.
  const prk = await hkdfExtract(salt, ikm)
  const cek = await hkdfExpand(prk, concat(utf8('Content-Encoding: aes128gcm'), Uint8Array.of(0)), 16)
  const nonce = await hkdfExpand(prk, concat(utf8('Content-Encoding: nonce'), Uint8Array.of(0)), 12)

  const key = await crypto.subtle.importKey('raw', cek, { name: 'AES-GCM' }, false, ['encrypt'])
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: nonce, tagLength: 128 },
      key,
      concat(payload, Uint8Array.of(2)),
    ),
  )

  const header = new Uint8Array(5)
  new DataView(header.buffer).setUint32(0, RECORD_SIZE, false)
  header[4] = as.publicKey.length
  return concat(salt, header, as.publicKey, ciphertext)
}

/* ──────────────────────────── RFC 8292 VAPID ───────────────────────────── */

/**
 * `Authorization: vapid t=<jwt>, k=<public key>` for one push service origin.
 *
 * `aud` is the ORIGIN of the endpoint and nothing else — including the path
 * makes Firefox reject the token outright, and FCM accept it today and stop
 * tomorrow. The token is scoped per push service for that reason, so it is
 * built per endpoint rather than once per drain.
 *
 * 12 hours is well inside the 24-hour ceiling RFC 8292 §2 sets; a longer `exp`
 * is rejected as unverifiable rather than treated as generous.
 */
export async function vapidAuthHeader(
  endpoint: string,
  subject: string,
  publicKeyB64: string,
  privateKeyB64: string,
): Promise<string> {
  const audience = new URL(endpoint).origin
  const header = bytesToBase64Url(utf8(JSON.stringify({ typ: 'JWT', alg: 'ES256' })))
  const claims = bytesToBase64Url(
    utf8(
      JSON.stringify({
        aud: audience,
        exp: Math.floor(Date.now() / 1000) + 12 * 3600,
        sub: subject,
      }),
    ),
  )
  const signingInput = utf8(`${header}.${claims}`)

  const publicRaw = base64UrlToBytes(publicKeyB64)
  const key = await crypto.subtle.importKey(
    'jwk',
    {
      kty: 'EC',
      crv: 'P-256',
      d: privateKeyB64,
      x: bytesToBase64Url(publicRaw.subarray(1, 33)),
      y: bytesToBase64Url(publicRaw.subarray(33, 65)),
      ext: true,
    },
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign'],
  )
  // WebCrypto signs ECDSA in IEEE P1363 form (r‖s, 64 bytes), which is exactly
  // what JWS ES256 wants. A DER signature here — what `node:crypto`'s sign()
  // returns by default — is the classic reason a hand-rolled VAPID token gets a
  // 401 from every push service.
  const signature = new Uint8Array(
    await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, signingInput),
  )
  return `vapid t=${header}.${claims}.${bytesToBase64Url(signature)}, k=${publicKeyB64}`
}

/* ──────────────────────────────── sending ──────────────────────────────── */

export interface PushSubscriptionRow {
  id: string
  endpoint: string
  p256dh: string
  auth: string
}

export interface SendOutcome {
  endpoint: string
  status: number
  /** True when the push service says this subscription is permanently gone. */
  gone: boolean
  error: string | null
}

/** How long the push service should hold the message for an offline device. */
const TTL_SECONDS = 24 * 3600

/**
 * One encrypted POST to one push service.
 *
 * NEVER THROWS. A DNS failure for one subscription must not abandon the other
 * four in the same batch, so the fetch is caught and reported as status 0.
 *
 * 404 and 410 are the two codes that mean "this endpoint is dead" — the user
 * cleared site data, uninstalled the PWA, or the browser rotated it. Those get
 * `gone: true` and the row is deleted. Everything else (429, 5xx, a timeout) is
 * transient and is left for the next attempt.
 *
 * APPLE IS THE EXCEPTION AND IT IS NAMED. `web.push.apple.com` answers a dead
 * subscription with **400 `{"reason":"BadWebPushToken"}"`, not 404 — measured
 * against the live service, see RUNBOOK §9.5. A bare 400 must NOT prune (that is
 * what our own malformed request would look like, and deleting a member's device
 * over our bug is unrecoverable for them), so the reason string is what promotes
 * it. Apple's VAPID failures have their own distinct reasons — `BadJwtToken`,
 * `ExpiredPushToken`, `MissingTopic` — and none of them match this test.
 */
export async function sendOne(
  sub: PushSubscriptionRow,
  payload: string,
  vapid: { subject: string; publicKey: string; privateKey: string },
): Promise<SendOutcome> {
  try {
    const body = await encryptPayload(
      utf8(payload),
      base64UrlToBytes(sub.p256dh),
      base64UrlToBytes(sub.auth),
    )
    const response = await fetch(sub.endpoint, {
      method: 'POST',
      headers: {
        Authorization: await vapidAuthHeader(
          sub.endpoint,
          vapid.subject,
          vapid.publicKey,
          vapid.privateKey,
        ),
        'Content-Encoding': 'aes128gcm',
        'Content-Type': 'application/octet-stream',
        TTL: String(TTL_SECONDS),
        Urgency: 'normal',
      },
      body,
    })
    if (response.ok) return { endpoint: sub.endpoint, status: response.status, gone: false, error: null }
    // The body is the only place a push service explains itself, and it is
    // short. Truncated because it lands in `push_outbox.last_error`.
    const text = (await response.text().catch(() => '')).slice(0, 300)
    const gone =
      response.status === 404 ||
      response.status === 410 ||
      (response.status === 400 && /bad(device|webpush)token/i.test(text))
    return {
      endpoint: sub.endpoint,
      status: response.status,
      gone,
      error: `${response.status} ${text}`.trim(),
    }
  } catch (e) {
    return {
      endpoint: sub.endpoint,
      status: 0,
      gone: false,
      error: (e as Error).message.slice(0, 300),
    }
  }
}

/* ────────────────────────────── the payload ────────────────────────────── */

/**
 * The two sentences, in both languages, duplicated from `notif.json` in each of
 * the two locale trees under `src/locales/`.
 *
 * THIS IS A DELIBERATE SECOND COPY AND IT IS THE ONLY ONE IN THE PRODUCT. A
 * service worker cannot call `t()` — the app bundle is not running when a push
 * arrives, and the whole point of a push is that no tab is open — so the
 * sentence has to be built where the recipient's locale is known, which is
 * here: `profiles.locale` is a column and the queue hands it over with the row.
 *
 * The bidi isolates (U+2068 … U+2069) around the two interpolations are carried
 * over verbatim. They matter MORE here than in the app: an Arabic notification
 * body containing a Latin entry title renders in the OS notification shade,
 * which applies the same Unicode bidi algorithm and has no CSS to correct it.
 */
const STRINGS = {
  en: {
    assignedTitle: 'Assigned to you',
    completedTitle: 'Item completed',
    assigned: '⁨{actor}⁩ assigned you “⁨{title}⁩”',
    completed: '⁨{actor}⁩ completed “⁨{title}⁩”',
    assignedNoActor: 'You were assigned “⁨{title}⁩”',
    completedNoActor: '“⁨{title}⁩” was completed',
    untitled: 'Untitled item',
  },
  ar: {
    assignedTitle: 'أُسنِد إليك',
    completedTitle: 'اكتمل بند',
    assigned:
      'أسند إليك ⁨{actor}⁩ «⁨{title}⁩»',
    completed: 'أكمل ⁨{actor}⁩ «⁨{title}⁩»',
    assignedNoActor:
      'أُسنِد إليك «⁨{title}⁩»',
    completedNoActor: 'اكتمل «⁨{title}⁩»',
    untitled: 'بند بلا عنوان',
  },
} as const

export interface QueuedNotification {
  outbox_id: number
  notification_id: number
  kind: string
  entry_id: string
  entry_title: string
  actor_name: string
  recipient_locale: string
  subscriptions: PushSubscriptionRow[]
}

/**
 * Row → the JSON string the service worker reads.
 *
 * `path` is a hash route, not a URL: the service worker resolves it against its
 * own registration scope, so the same payload works on `localhost:5173`, on
 * `abosallom.github.io/opstrack/` and inside the installed PWA without this
 * function knowing where the app is deployed.
 */
export function buildPayload(row: QueuedNotification): string {
  const s = STRINGS[row.recipient_locale === 'ar' ? 'ar' : 'en']
  const completed = row.kind === 'completed'
  const title = row.entry_title.trim() || s.untitled
  const actor = row.actor_name.trim()
  const template = completed
    ? actor
      ? s.completed
      : s.completedNoActor
    : actor
      ? s.assigned
      : s.assignedNoActor
  return JSON.stringify({
    id: String(row.notification_id),
    kind: completed ? 'completed' : 'assigned',
    title: completed ? s.completedTitle : s.assignedTitle,
    body: template.replace('{actor}', actor).replace('{title}', title),
    path: `#/entry/${row.entry_id}`,
    // One notification per inbox row: a re-send after a retry replaces the
    // earlier banner instead of stacking a duplicate on the lock screen.
    tag: `opstrack-n-${row.notification_id}`,
  })
}

/* ─────────────────────────────── the drain ─────────────────────────────── */

/** Rows claimed per invocation. Bounded so one drain cannot outlive the worker. */
const BATCH_LIMIT = 25

interface DrainSummary {
  claimed: number
  sent: number
  failed: number
  suppressed: number
  pruned: number
}

async function drain(): Promise<DrainSummary> {
  const vapid = {
    subject: env('VAPID_SUBJECT') || 'mailto:az.alsaloom@gmail.com',
    publicKey: env('VAPID_PUBLIC_KEY'),
    privateKey: env('VAPID_PRIVATE_KEY'),
  }
  const summary: DrainSummary = { claimed: 0, sent: 0, failed: 0, suppressed: 0, pruned: 0 }
  if (!vapid.publicKey || !vapid.privateKey) {
    throw new Error('VAPID keys are not configured on this function')
  }

  const admin = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), {
    auth: { persistSession: false },
  })

  // One statement claims, increments the attempt counter and pushes
  // next_attempt_at out of the way, so a second drain running concurrently sees
  // nothing to do rather than sending everything twice.
  const { data, error } = await admin.rpc('claim_push_batch', { p_limit: BATCH_LIMIT })
  if (error) throw new Error(`claim_push_batch: ${error.message}`)

  const rows = (data ?? []) as QueuedNotification[]
  summary.claimed = rows.length

  for (const row of rows) {
    const subs = row.subscriptions ?? []
    if (subs.length === 0) {
      // Either the recipient has no device registered or their preferences say
      // no for this kind. Both are a completed obligation, not a failure — the
      // in-app inbox already has the row.
      summary.suppressed++
      await admin.rpc('settle_push', { p_outbox_id: row.outbox_id, p_ok: true, p_error: null })
      continue
    }

    const payload = buildPayload(row)
    const outcomes = await Promise.all(subs.map((sub) => sendOne(sub, payload, vapid)))

    const dead = outcomes.filter((o) => o.gone).map((o) => o.endpoint)
    if (dead.length > 0) {
      // Service role, so this is not subject to the owner-only RLS policy —
      // which is the point: the owner of a dead subscription is by definition
      // not here to clean it up.
      await admin.from('push_subscriptions').delete().in('endpoint', dead)
      summary.pruned += dead.length
    }

    // Delivered to at least one device, or every failure was permanent: either
    // way there is nothing left to retry. Retrying a batch because ONE of three
    // devices 500'd would re-notify the other two.
    const delivered = outcomes.some((o) => o.status >= 200 && o.status < 300)
    const retryable = outcomes.filter((o) => !o.gone && (o.status === 0 || o.status >= 500 || o.status === 429))
    const ok = delivered || retryable.length === 0
    if (ok) summary.sent++
    else summary.failed++
    await admin.rpc('settle_push', {
      p_outbox_id: row.outbox_id,
      p_ok: ok,
      p_error: ok
        ? outcomes.find((o) => o.error)?.error ?? null
        : (retryable[0]?.error ?? 'push failed'),
    })
  }

  return summary
}

/* ─────────────────────────────── the handler ───────────────────────────── */

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-push-drain',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })
}

export async function handle(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ code: 'method_not_allowed' }, 405)

  const secret = env('PUSH_DRAIN_SECRET')
  // A missing secret must FAIL CLOSED. An empty-string comparison would let
  // every caller through the moment the secret was rotated away by accident.
  if (!secret || req.headers.get('x-push-drain') !== secret) {
    return json({ code: 'forbidden' }, 403)
  }

  try {
    return json({ ok: true, ...(await drain()) })
  } catch (e) {
    // The message, never the payload and never a key. This lands in the
    // function logs, which the owner reads from the dashboard.
    console.error('[send-push]', (e as Error).message)
    return json({ code: 'drain_failed', message: (e as Error).message }, 500)
  }
}

// Guarded so the Node harness that replays the RFC 8291 vector can import this
// module without starting a server.
DENO?.serve(handle)
