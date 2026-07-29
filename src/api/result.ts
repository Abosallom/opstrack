// The result convention every api/ module returns.
//
// Lifted out of entries.ts once a second module (tracks.ts) needed the same
// three pieces. Nothing here is track- or entry-specific on purpose: this is the
// one place that decides what "failed" looks like to a caller.
//
// Functions return a discriminated ApiResult instead of throwing, and every one
// of them guards the nullable Supabase client first — a build without
// credentials has to degrade into a readable message, not a stack trace.
//
// entries.ts re-exports ApiResult so its existing importers keep working.

export type ApiResult<T> = { ok: true; data: T } | { ok: false; error: string }

/**
 * The failure half of ApiResult. Typed as the literal `{ ok: false }` rather
 * than `ApiResult<T>` so a caller can `return fail(...)` from a function of any
 * data type without naming the generic.
 */
export function fail(message: string): { ok: false; error: string } {
  return { ok: false, error: message }
}

/**
 * The mandatory first line of every api function: `if (!supabase) return notConfigured()`.
 *
 * Returns the i18n KEY, not the translated sentence. tracks.ts documents its
 * errors as keys and every caller renders them through `t(result.error)`;
 * resolving the string here made that a double translation which only happened
 * to work because t() passes an unknown key through verbatim. Handing back the
 * key also means the message is resolved when it is rendered rather than when
 * the call failed, so it is in the right language after a locale switch.
 */
export function notConfigured(): { ok: false; error: string } {
  return fail('common.notConfigured')
}
