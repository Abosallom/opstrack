// Digest collection — the ONE impure half of the feature.
//
// NAMING NOTE, so nobody hunts for the other file: plan §2.16 names this module
// `src/api/digestCollect.ts`, and §2's opening line freezes the contract against
// renames. The Wave-3 brief for this worker said `src/api/digest.ts`; the plan
// wins, and there is no second file. Flagged in the handoff.
//
// EVERYTHING ELSE IN THE FEATURE IS PURE. `src/lib/digest/**` may not import
// from `src/store/**` or `src/api/**` (contracts rule 2, enforced by the
// standing grep), which is what makes the model builder and all three renderers
// testable with zero mocking. This file is the only place a fetch, a store read
// or a clock lives, and it hands `buildDigestModel()` plain data.
//
// WHY IT READS THE STORE RATHER THAN RE-FETCHING EVERYTHING. The working set is
// already in `store/entries` — one fetch, client-side filtering, the decision
// §2.3 makes for the whole app — and the digest must report the SAME rows the
// user just triaged on the follow-ups screen. Re-querying would produce a report
// that disagrees with the screen it was generated from, which is the exact
// failure this codebase keeps writing headers about. So the collector WARMS the
// store (open entries + the closed tail the range needs + members + vocabulary)
// and then reads its snapshot.
//
// TRUNCATION IS CARRIED, NOT SWALLOWED. PostgREST clips every read at 1000 rows
// and reports it as a 200 with fewer rows (FIX-BACKLOG C8). A status report
// missing its oldest rows with no caveat is worse than one that fails, so the
// flag rides on `DigestRows.truncated` all the way into the document itself —
// for BOTH the open working set and the closed tail, which are fetched and
// clipped independently.

import { listUpdatesFor } from './entries'
import { listTracks } from './tracks'
import { fail } from './result'
import { getVocabSnapshot, loadVocab, vocabLabel } from '../store/vocab'
import { getMembersSnapshot, loadMembers } from '../store/members'
import { getEntriesCoverage, getEntriesSnapshot, loadClosedSince, loadEntries } from '../store/entries'
import { instantToIsoDate, addDays } from '../lib/dates'
import type { ApiResult } from './result'
import type { DigestQuery, DigestRows } from '../lib/digest'
import type { Locale } from '../lib/i18n'
import type { Entry, EntryUpdate, VocabKind } from '../types'

export type { DigestQuery, DigestRows }

/**
 * Gather everything one digest needs, in as few round trips as the shape allows.
 *
 * Four concurrent warms, then ONE batched `listUpdatesFor()` over the entry ids
 * in the window — the N+1 the contract calls out by name. `listUpdatesFor`
 * chunks the id list itself (a uuid costs ~37 bytes of query string and a
 * 400-entry window would build a URL a proxy rejects), so the caller passes the
 * whole list and does not think about it.
 *
 * Never throws, per the ApiResult convention; every failure comes back as an
 * i18n KEY.
 */
export async function collectDigest(q: DigestQuery): Promise<ApiResult<DigestRows>> {
  // Archived tracks INCLUDED. An archived track keeps its entries — the FKs are
  // `on delete set null`, and archiving is not deleting — so excluding it would
  // silently re-file last quarter's work under "No track".
  const force = q.force === true
  const [tracks] = await Promise.all([
    listTracks(true),
    loadEntries(force),
    // The closed tail this range needs. `loadClosedSince` is a no-op when the
    // store already covers an earlier date, so switching from 7 days to 30 costs
    // one fetch and switching back costs none.
    loadClosedSince(q.from),
    loadMembers(force),
    loadVocab(force),
  ])
  if (!tracks.ok) return tracks

  // Read AFTER the warms above, so it describes the fetches this call made.
  const coverage = getEntriesCoverage()
  // A FAILED CLOSED READ FAILS THE DOCUMENT. This module's header states the
  // principle — "a status report missing its oldest rows with no caveat is worse
  // than one that fails" — and the closed tail is the half most exposed to it:
  // `loadEntries(force)` short-circuits on the store the Shell already warmed,
  // so `loadClosedSince()` is usually the ONLY entries fetch a digest makes.
  // When it failed, `collectDigest` still returned ok with an empty closed set,
  // buildDigestModel dropped the whole Closed section (`build.ts`: empty buckets
  // are skipped) and the summary line quietly lost its "N closed" clause — a
  // report you paste into an email to your boss that under-states finished work
  // and looks exactly like a quiet week. The error key travels to Digest.tsx,
  // which already renders it with a Retry.
  if (coverage.closedError !== null) return fail(coverage.closedError)

  const snapshot = getEntriesSnapshot()
  const entries = inRange([...snapshot.byId.values()], q)

  let lastUpdate = new Map<string, EntryUpdate>()
  if (q.includeUpdates && entries.length > 0) {
    const updates = await listUpdatesFor(
      entries.map((e) => e.id),
      q.from,
    )
    if (!updates.ok) return fail(updates.error)
    lastUpdate = newestPerEntry(updates.data)
  }

  return {
    ok: true,
    data: {
      entries,
      health: [...snapshot.health.values()],
      lastUpdate,
      tracks: tracks.data,
      members: getMembersSnapshot(),
      // BOTH HALVES OF THE WINDOW. This used to be a hard-coded `false` with a
      // note asking the screen to OR the real answer back in, because coverage
      // was reachable only through a hook and this is a module function. That
      // made the collector structurally unable to report a clip — and the
      // screen's merge only ever saw `coverage.truncated`, which describes the
      // OPEN fetch, so a clipped CLOSED read (the entire Closed section of this
      // document, plus every throughput number derived from it) reached the
      // reader with no caveat at all. `getEntriesCoverage()` is the getter that
      // note asked for; Digest.tsx's merge is now belt-and-braces rather than
      // the only path.
      truncated: coverage.truncated || coverage.closedTruncated,
    },
  }
}

/**
 * A cheap pre-filter, NOT the membership rule.
 *
 * `buildDigestModel()` owns the frozen §2.16 predicate and re-applies it; this
 * only drops rows that cannot possibly qualify under any of its four clauses, so
 * the model builder is not handed the whole history on every keystroke. The
 * bound is deliberately generous — an OPEN row is always kept, because the
 * "open and overdue as of `to`" clause reaches arbitrarily far back and a
 * cleverer filter here would silently delete the most important rows in the
 * report.
 */
function inRange(entries: Entry[], q: DigestQuery): Entry[] {
  const toExclusive = addDays(q.to, 1)
  return entries.filter((e) => {
    if (e.closed_at === null) return instantToIsoDate(e.created_at) < toExclusive
    const closed = instantToIsoDate(e.closed_at)
    return (
      (closed >= q.from && closed <= q.to) ||
      (instantToIsoDate(e.created_at) >= q.from && instantToIsoDate(e.created_at) <= q.to)
    )
  })
}

/**
 * One update per entry — the newest.
 *
 * `listUpdatesFor` returns newest first and re-sorts across chunks, so the first
 * row seen for an id is its newest and the rest are skipped. Compared by
 * timestamp anyway rather than trusted, because "ordered desc" is a property of
 * that function's implementation and this one should not break if it changes.
 */
function newestPerEntry(updates: EntryUpdate[]): Map<string, EntryUpdate> {
  const out = new Map<string, EntryUpdate>()
  for (const u of updates) {
    const held = out.get(u.entry_id)
    if (held === undefined || u.created_at > held.created_at) out.set(u.entry_id, u)
  }
  return out
}

/* ─────────────────────────── vocabulary labels ─────────────────────── */

/**
 * The `DigestOptions.vocabLabel` closure, bound to an explicit locale.
 *
 * `buildDigestModel` takes this as a parameter because `src/lib/**` may not
 * import `src/store/**`, and the frozen five-step label resolution order lives
 * in store/vocab.ts. Building it here — beside the other store reads — keeps the
 * screen from having to know that `getVocabSnapshot()` exists, and keeps the
 * ONE copy of the resolution order in the file that owns it.
 *
 * The snapshot is read at CALL time, not closed over, so a vocabulary edit
 * landing between two renders is reflected without rebuilding the closure.
 */
export function digestVocabLabel(locale: Locale): (kind: VocabKind, key: string) => string {
  return (kind, key) => vocabLabel(getVocabSnapshot(), kind, key, locale)
}
