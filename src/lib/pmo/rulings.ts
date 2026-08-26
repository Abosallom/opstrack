// Organizations that need a person to decide something.
//
// PURE, ON src/lib/pmo/summary.ts's CONTRACT: no store, no clock beyond the
// `today` it is handed, no `t()`, no React. Everything arrives as an argument
// and the same arguments always produce the same answer.
//
// ── WHY THIS EXISTS ────────────────────────────────────────────────────────
//
// The owner's ruling on two hospitals the importer could not place: *"ignore
// Aseer tickets. have it flagged in a new tab in PMO dashboard"*, and then, of
// what the tab should hold: *"any org with the issues mentioned before, or
// similar"*.
//
// Eight tickets in the Jira export name only "Aseer", and the map holds two
// Aseer rows — `Aseer (Care Ware)` and `Aseer (Vida Plus)` — that were split by
// system on his own ruling. There is no honest way to file those eight. The same
// is true of `Jazan`, which is two clusters. So they are not filed and not
// guessed at; they are named here, with their counts, for a person.
//
// ── AND WHY IT IS COMPUTED LIVE ────────────────────────────────────────────
//
// Every reading below comes from `map_nodes` and `entries`, which the PMO page
// already holds. Nothing is imported, nothing is snapshotted, nothing goes
// stale: merge two rows in the morning and the pair is gone from this tab in the
// afternoon. The alternative — a table written by a script when an export
// arrives — would be a photograph of a problem that the fix does not update.
//
// ── IT FLAGS. IT DOES NOT MERGE. ───────────────────────────────────────────
//
// Merging two organizations moves their activities, their use-case links and
// their progress rows. `scripts/report/merge-orgs.mjs` already does that, with a
// dry run and an undo manifest written before it touches a row. A button here
// that quietly rewrote the estate would be the one destructive act in this
// product with no manifest behind it.

import type { MapNode } from '../../types'

/** Why a row is on this list. Each is a different question for a person. */
export type RulingKind =
  /** Two rows whose names are the same once punctuation is dropped. */
  | 'duplicate'
  /** One name contains the other — `KFSHRC` inside its own long form. */
  | 'contained'
  /** Two names within two characters of each other. */
  | 'near'
  /** Two rows share a stem, so a ticket naming only the stem cannot be filed. */
  | 'ambiguous'
  /** Nothing has ever been filed against this organization. */
  | 'silent'
  /** Nobody is accountable for it. */
  | 'unowned'

/** One organization on the list, with the count that makes it worth reading. */
export interface RulingParty {
  nodeId: string
  name: string
  /** Activities filed against it. The number that says which row is the real one. */
  activities: number
}

export interface RulingRow {
  /** Stable across loads, so React keys and test assertions do not shuffle. */
  key: string
  kind: RulingKind
  /**
   * The organizations involved. Two for a pair, one for `silent` and `unowned`.
   * Ordered by activity count, heaviest first: on a duplicate the heavier row is
   * almost always the one to keep, and putting it first states the recommendation
   * without making the decision.
   */
  parties: RulingParty[]
}

export interface RulingsInput {
  /** Organizations only — the caller filters by kind, as the PMO page already does. */
  nodes: readonly MapNode[]
  /** How many activities each node carries, by node id. */
  openByNode: ReadonlyMap<string, number>
}

export interface Rulings {
  rows: RulingRow[]
  /** Organizations considered — the denominator for every count on the tab. */
  organizations: number
}

/* ────────────────────────────── the readings ────────────────────────────── */

/** Punctuation and case removed. Two names equal here are one hospital. */
function normalize(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '')
}

/**
 * The name with its parenthetical and its generic words removed.
 *
 * `Aseer (Care Ware)` and `Aseer (Vida Plus)` both reduce to `aseer`, which is
 * exactly the fact that makes a ticket saying only "Aseer" unfilable.
 */
const GENERIC = /\b(?:hospitals?|clusters?|medical|centers?|centres?|health|general)\b/g

function stem(name: string): string {
  return name
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ')
    .replace(GENERIC, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

/** Levenshtein, bailing out early. Two edits is the threshold; three is a different name. */
function distance(a: string, b: string): number {
  if (Math.abs(a.length - b.length) > 2) return 9
  const row = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i += 1) {
    let prev = row[0]
    row[0] = i
    for (let j = 1; j <= b.length; j += 1) {
      const above = row[j]
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1))
      prev = above
    }
  }
  return row[b.length]
}

/**
 * ⚠ THE SIX-CHARACTER FLOOR IS THE DIFFERENCE BETWEEN A WORKLIST AND NOISE, AND
 *   IT IS NOT A TUNING CONSTANT.
 *
 *   Every three-letter code is within two edits of every other one. Run without
 *   this floor over the real 140 organizations, the edit-distance rule reported
 *   `NMC`~`SMC`, `KFMC`~`NMC`, `MMS`~`NMC`, `RCH`~`SGH` and `CMRC`~`SMC` — five
 *   pairs of entirely different hospitals — and a PMO who works through a list
 *   like that once does not open the tab again.
 *
 *   It compares STEMS rather than whole names for the same reason: `Aya
 *   Hospital` and `GAMA Hospital` are two edits apart as written, and their
 *   stems `aya` and `gama` fall under the floor where they belong. So do `Hail
 *   Cluster` and `Taif Cluster`.
 *
 *   This is `scripts/report/rebuild.mjs`'s own `nearDuplicates` guard, which its
 *   header defends at length: *"guessing that two differently-spelled names are
 *   one hospital is how a merge quietly deletes a real organization"*. I dropped
 *   it on the first attempt at this file and got those five pairs back, which is
 *   how it earned this paragraph.
 */
const MIN_STEM = 6

/** The shorter name must be at least this long before containment means anything. */
const MIN_CONTAINED = 5

export function buildRulings(input: RulingsInput): Rulings {
  const orgs = input.nodes.filter((n) => !n.archived)
  const partyOf = (node: MapNode): RulingParty => ({
    nodeId: node.id,
    name: node.name,
    activities: input.openByNode.get(node.id) ?? 0,
  })
  // Heaviest first: on a duplicate the row carrying the work is almost always
  // the one to keep, and saying so is not the same as deciding it.
  const pair = (a: MapNode, b: MapNode): RulingParty[] =>
    [partyOf(a), partyOf(b)].sort((x, y) => y.activities - x.activities)

  const rows: RulingRow[] = []
  const pairKey = (a: MapNode, b: MapNode): string => [a.id, b.id].sort().join('~')

  for (let i = 0; i < orgs.length; i += 1) {
    for (let j = i + 1; j < orgs.length; j += 1) {
      const a = orgs[i]
      const b = orgs[j]
      const na = normalize(a.name)
      const nb = normalize(b.name)
      if (na === '' || nb === '') continue

      // ⚠ ONE READING PER PAIR, STRONGEST FIRST. The chain is `else if` rather
      //   than three independent tests, and that is what keeps a pair off this
      //   list twice: an identical pair is not ALSO "near", and reporting it
      //   under both readings would double the work the tab exists to bound.
      //   (An earlier cut of this guarded the same thing with a `Set` of pair
      //   keys, which was dead code — the loop visits each pair exactly once.)
      let kind: RulingKind | null = null
      if (na === nb) kind = 'duplicate'
      else if (
        (na.includes(nb) || nb.includes(na)) &&
        Math.min(na.length, nb.length) >= MIN_CONTAINED
      ) {
        kind = 'contained'
      } else {
        const sa = stem(a.name)
        const sb = stem(b.name)
        if (sa.length >= MIN_STEM && sb.length >= MIN_STEM && distance(sa, sb) <= 2) kind = 'near'
      }
      if (kind === null) continue
      rows.push({ key: `${kind}:${pairKey(a, b)}`, kind, parties: pair(a, b) })
    }
  }

  // ── the stems two organizations share ────────────────────────────────────
  //
  // Reported per STEM rather than per pair, because the question is not "are
  // these two the same?" — the owner already ruled that they are not — but "what
  // do we do with a ticket that names only this?". Three rows sharing a stem is
  // one question, not three.
  const byStem = new Map<string, MapNode[]>()
  for (const org of orgs) {
    const key = stem(org.name)
    if (key.length < 3) continue
    const held = byStem.get(key)
    if (held === undefined) byStem.set(key, [org])
    else held.push(org)
  }
  for (const [key, held] of byStem) {
    if (held.length < 2) continue
    rows.push({
      key: `ambiguous:${key}`,
      kind: 'ambiguous',
      parties: held.map(partyOf).sort((x, y) => y.activities - x.activities),
    })
  }

  // ── the two single-organization readings ─────────────────────────────────
  for (const org of orgs) {
    if ((input.openByNode.get(org.id) ?? 0) === 0) {
      rows.push({ key: `silent:${org.id}`, kind: 'silent', parties: [partyOf(org)] })
    }
    if (org.account_manager_id === null) {
      rows.push({ key: `unowned:${org.id}`, kind: 'unowned', parties: [partyOf(org)] })
    }
  }

  // Grouped by kind in the order a person would work them — a duplicate is a
  // decision, an unowned row is an assignment — then by weight inside each kind,
  // then by key so two loads never render the same data in two orders.
  const ORDER: Record<RulingKind, number> = {
    duplicate: 0,
    ambiguous: 1,
    contained: 2,
    near: 3,
    silent: 4,
    unowned: 5,
  }
  const weight = (r: RulingRow): number => r.parties.reduce((n, p) => n + p.activities, 0)
  rows.sort(
    (a, b) =>
      ORDER[a.kind] - ORDER[b.kind] ||
      weight(b) - weight(a) ||
      (a.key < b.key ? -1 : a.key > b.key ? 1 : 0),
  )

  return { rows, organizations: orgs.length }
}
