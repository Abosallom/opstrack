// THE DETAIL BAND — what an organization IS, above what is open on it.
//
// Aziz's sentence for this feature: *"When click on any Org, a sidebar page
// within the map to see the details like: Account Manager, Use cases integrated,
// outstanding issue."* Two of those three are here. The third is not, and that
// is the most important decision in this file — see THREE NUMBERS below.
//
// IT RIDES THE `branch` SUBJECT AT ZERO WIRING COST. `subjectForLens('shape',
// focusNodeId)` already yields `{kind:'branch', nodeId}`, so focusing an
// organization opens the branch panel on it and this band is one more section
// inside it. A sixth `PanelSubject` and a sixth `MapLens` would both cascade
// through closed unions, the exhaustive switch in Mindtree.tsx and lens.test.ts,
// and buy nothing the band order does not already give: Breadcrumb → DETAIL →
// stats → work → history, which is what a reader asks in that order.
//
// A SEPARATE FILE FROM MapBranch.tsx FOR SIZE ALONE, on MapBranchHistory.tsx's
// precedent and with its bargain: it owns NO CSS prefix of its own, every class
// here is `.mbr-*` from `map-branch.css`, and the registry needs no new entry.
// `.mbr-detail` is the one name here that carries no rule and is not meant to —
// it is an IDENTITY, the twin of `.mbr-history`, so a test can slice the
// rendered panel at this band. Every other `.mbr-*` name below has a rule.
//
// ── TWO PROPS, AND THE SECOND ONE IS NOT LAZINESS ──────────────────────────
//
// `nodeId` is the map-node id (`entityIdOf(node)`, so the mount and the stats
// band cannot disagree about which node is focused). `kindName` is
// `MindNode.entityType` handed straight through — model.ts's comment says why
// it is carried on the node at all: a second lookup keyed on `bucketKey` in this
// component is a second chance to disagree with the tree about what a node is.
//
// NOTHING HERE BRANCHES ON THE KIND, and nothing ever should. What a Phase shows
// and what an Organization shows is CONFIGURATION — the kind is rendered as a
// caption and is never read as a condition. The moment this file says
// `kindName === 'Organization'`, renaming a kind in the admin screen silently
// empties a band.
//
// ── HOW IT DEGRADES, IN TWO DIFFERENT DIRECTIONS ───────────────────────────
//
// A node whose kind declares no fields renders NO BAND AT ALL — a fourth empty
// section above the stats teaches nothing and costs a screenful on a phone. In
// v1 that is every node that is not an entity (a track, a status bucket, the
// root), which is what `nodeId === null` means here, plus an entity whose row
// has not landed in `store/config` yet.
//
// A node WITH fields and no values renders the names against an em-dash.
// "Account manager: —" is a fact Aziz wants to see: it is the difference between
// "nobody is accountable for this organization" and "this panel does not do
// account managers", and only one of those is worth a phone call.
//
// ── THREE NUMBERS, THREE UNITS, AND THIS BAND OWNS EXACTLY ONE ─────────────
//
// MapBranch.tsx:22-37 already requires every number on this panel to name its
// scope. With progress there are three and they are in three different units:
//
//   `6 of 9 live`      CAPABILITIES, scoped to this organization — this band.
//   `12 open`          ITEMS, scoped to the branch — the stats band's tiles.
//   the history band   EVENTS, scoped to a date window the reader chose.
//
// So "outstanding issues" is NOT a field on this band. It is the stats band's
// `open` tile, and rendering `6 of 9` as a tile beside `12 open` would put two
// units in one row of numbers with nothing to tell them apart. The heading of
// the matrix is where progress belongs, because that is the one place where the
// unit is written directly above it.
//
// ── THE COUNTS ARE CLIENT-SIDE, AND THE CLAMP IS SOMEBODY'S TO SURFACE ─────
//
// Every number on this band is computed here from rows already in hand, never
// from a server rollup: a rollup cannot know the reader's `FilterState`, and
// model.ts's rule is that a branch labelled 12 showing 3 is the worst thing this
// map can do. The capability numbers are immune to PostgREST's 1000-row clamp
// by construction — `listNodeUseCases(nodeId)` returns at most one row per
// capability for one node. The ITEM count is not immune, which is exactly why it
// stays on the stats band, whose `track.statsPartial` note already says so when
// `useEntriesTruncated()` is true.
//
// READ-ONLY IN v1, deliberately. `map_node_use_cases` is member-writable and
// `setNodeUseCase` exists, but the plan puts per-use-case editing in the admin
// catalogue screen; a second place to write the same cell is a second place for
// the two to disagree about what was saved.
//
// ══════════════════════════════════════════════════════════════════════════
//
// ── THE SECOND BAND: WHAT THIS BRANCH PROMISED (0027) ──────────────────────
//
// `MapBranchGoals` is the other half of the same sentence and the reason this
// file now holds two bands rather than one. The detail band says what a node IS
// and how far it has got; the goal band says where it was SUPPOSED to have got
// to, and by when. They hang off the same gate — a map node — they are read in
// that order, and splitting them across two files would put one paragraph's
// worth of shared reasoning in two places.
//
// STILL ZERO NEW `PanelSubject` AND ZERO NEW `MapLens`. Both bands ride the
// `branch` subject exactly as the header above describes: MapBranch.tsx mounts
// them one after the other and the panel's band order becomes Breadcrumb →
// DETAIL → GOALS → stats → work → history.
//
// THE TWO PERMISSIONS ARE OPPOSITE AND THE BAND IS SHAPED BY IT. A goal is a
// commitment about a department, so 0027 gates every write on
// `has_perm('structure.edit')` — the two Associate Directors. The three account
// managers are members: they READ the promise their organizations are measured
// against and they cannot edit it. So the add/edit/delete controls are ABSENT
// for them rather than disabled — a disabled control is a promise the app has to
// keep, and "you may not do this" is not a thing an AM needs told on every open.
//
// ⚠ MOUNTED ONLY FOR A NODE, BY THE CALLER. Unlike `MapBranchDetail`, which
//   decides internally and returns null, MapBranch.tsx renders this band only
//   when `entityIdOf(node)` is non-null. That is not a style difference: the
//   band FETCHES on mount, and a component that opens a request for every track
//   and every status bucket the reader focuses is a request per focus change
//   that can never return a row, since goals hang off map nodes and nothing
//   else has one.

import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import {
  createGoal,
  deleteGoal,
  listGoals,
  updateGoal,
  GOAL_LABEL_MAX,
  type MapNodeGoal,
  type MapNodeGoalInput,
} from '../../api/goals'
import { listNodeUseCases } from '../../api/map'
import { confirm } from '../Confirm'
import { EmptyState } from '../shared'
import { toast } from '../toast'
import { isolate } from '../../lib/bidi'
import { diffDays, formatDate, parseIsoDate, todayIso, type IsoDate } from '../../lib/dates'
import { t, useLocale, type Locale } from '../../lib/i18n'
import { useStageLabel } from '../../lib/labels'
// ALIASED, AND NOT AS A STYLE CHOICE. `useCaseProgress` is a pure function whose
// name begins with `use` + a capital, which is exactly the shape oxlint's
// `react/rules-of-hooks` uses to recognise a Hook — calling it inside a
// `useMemo` callback is an ERROR under that rule, and calling it from a test's
// `it()` body is another. The name is lib/mapNodes.ts's published contract and
// stays; the alias is the one-line fence at every call site that is not a hook
// position. Renaming the import does not rename the export.
import { useCaseProgress as computeUseCaseProgress, type UseCaseProgress } from '../../lib/mapNodes'
import { useHasPerm } from '../../store/auth'
import { useAllUseCases, useMapNodeMap, useMapNodeStages, useStageMap } from '../../store/config'
import { useMemberMap } from '../../store/members'
import type { Member } from '../../api/members'
import type { MapNode, MapNodeStage, MapNodeUseCase, UseCase, UseCaseStatus } from '../../types'

/* ══════════════════════════ constants ══════════════════════════ */

/**
 * The status that counts as finished — the ONE literal, handed to
 * `useCaseProgress` as its `terminalKey`. lib/mapNodes.ts never compares against
 * a status word of its own, so moving this line moves the arithmetic with it.
 *
 * EXPORTED because the canvas needs the same word: `useMapModel` folds
 * `view.progress` over the whole tree and would otherwise carry a second copy of
 * `'live'`, which is the exact duplication lib/mapNodes.ts's header refuses. One
 * literal, one home, and the home is the band that renders the sentence it
 * belongs to.
 */
export const TERMINAL_STATUS: UseCaseStatus = 'live'

/** A value that is not recorded. Paired with an `.sr-only` word every time. */
const EM_DASH = '—'

/**
 * The status as a standalone badge, and the status INSIDE the heading sentence.
 *
 * Two records for one union, because "Live" is a label and "6 of 9 live" is a
 * sentence, and English capitalises the first and not the second. Written as
 * literals rather than built from a template, because `localeReach.test.ts`
 * scans the source for key-shaped strings and cannot see a key it has to
 * assemble — a template literal here would take four keys out of the gate that
 * proves they exist in both bundles.
 */
const STATUS_PILL: Readonly<Record<UseCaseStatus, string>> = {
  planned: 'mapnode.statusPlanned',
  testing: 'mapnode.statusTesting',
  live: 'mapnode.statusLive',
}

const STATUS_WORD: Readonly<Record<UseCaseStatus, string>> = {
  planned: 'mapnode.wordPlanned',
  testing: 'mapnode.wordTesting',
  live: 'mapnode.wordLive',
}

/** The tone each status wears. Neutral is a real answer, so it is not in here. */
const STATUS_TONE: Readonly<Record<UseCaseStatus, string>> = {
  planned: '',
  testing: ' info',
  live: ' ok',
}

/* ══════════════════════════ pure helpers ══════════════════════════ */

/**
 * A row's name in this locale — `name_ar` when it is not EMPTY, never when it is
 * not null. Both columns are `not null default ''` (0023/0024), and the Arabic
 * names of the capabilities are seeded blank on purpose: everybody in the room
 * says "ADT".
 *
 * Not in lib/labels.ts because this component does not own that file; not in
 * lib/mapNodes.ts because that module is pure of the locale by contract.
 */
export function localName(row: { name: string; name_ar: string }, locale: Locale): string {
  if (locale === 'ar') return row.name_ar.trim() || row.name
  return row.name
}

/**
 * The teammate accountable for this node, as a string, or null for the em-dash.
 *
 * THROUGH THE ROSTER, NEVER AS STORED TEXT: `account_manager_id` is a reference
 * precisely so that renaming a person propagates to every organization they
 * carry instead of leaving forty stale strings behind. An id the roster does not
 * know is NOT the same as no manager — it is a person who has left, or a members
 * store that has not landed yet — and saying "—" for it would report an
 * accountable organization as an unaccountable one.
 */
export function managerLabel(byId: ReadonlyMap<string, Member>, id: string | null): string | null {
  if (id === null) return null
  const named = byId.get(id)?.displayName?.trim()
  return named ? named : t('mapnode.managerGone')
}

/* ══════════════════════════ the connected band ══════════════════════════ */

export interface MapBranchDetailProps {
  /** The map-node id behind the focused branch — `entityIdOf(node)`. */
  nodeId: string | null
  /** `MindNode.entityType`: Programme, Phase, Organization. A caption, never a condition. */
  kindName: string | null
}

export default function MapBranchDetail({ nodeId, kindName }: MapBranchDetailProps): ReactElement | null {
  const locale = useLocale()
  const nodeById = useMapNodeMap()
  const memberById = useMemberMap()
  // The FULL catalogue, hidden rows included: a capability retired this morning
  // is still one this organization integrated, and the denominator must not
  // shrink underneath yesterday's number. lib/mapNodes.ts drops the hidden rows
  // nobody is recorded against.
  const catalogue = useAllUseCases()

  /* ── the links, fetched on open ───────────────────────────────────── */

  const [links, setLinks] = useState<readonly MapNodeUseCase[]>([])
  // Starts true whenever there is something to fetch: starting false paints
  // "nothing recorded" for one frame on an organization that has ten links.
  const [loading, setLoading] = useState(nodeId !== null)
  const [error, setError] = useState<string | null>(null)
  /** Only the newest request may write state — focus moves faster than a fetch. */
  const request = useRef(0)

  useEffect(() => {
    const token = request.current + 1
    request.current = token
    // CLEARED, not kept. MapBranchHistory holds its rows through a reload
    // because they describe the same track; these describe a DIFFERENT
    // organization the moment the id changes, and one frame of the previous
    // one's capabilities under this one's name is a lie nobody would suspect.
    setLinks([])
    setError(null)
    if (nodeId === null) {
      setLoading(false)
      return
    }
    setLoading(true)
    void listNodeUseCases(nodeId).then((result) => {
      if (token !== request.current) return
      setLoading(false)
      if (!result.ok) {
        setError(result.error)
        return
      }
      setLinks(result.data)
    })
  }, [nodeId])

  /**
   * THE POPULATION IS THIS ONE ORGANIZATION, and saying so is what the fourth
   * argument is for. `useCaseProgress` counts the nodes it is HANDED rather than
   * the nodes its links happen to mention, so an organization with no links at
   * all is a column of zeroes here instead of being invisible to the
   * denominator — which is the roll-up's bug, seen at n = 1.
   *
   * Built inside the memo rather than beside it: a fresh `[{ id }]` on every
   * render would defeat the memo it is a dependency of, and `nodeId` is the fact
   * that actually changes.
   */
  const progress = useMemo(
    () =>
      computeUseCaseProgress(
        catalogue,
        links,
        TERMINAL_STATUS,
        nodeId === null ? [] : [{ id: nodeId }],
      ),
    [catalogue, links, nodeId],
  )

  const node: MapNode | undefined = nodeId === null ? undefined : nodeById.get(nodeId)

  // NO BAND, rather than an empty one. Not an entity (a track, a bucket, the
  // root), or an entity whose row has not arrived — the map draws from the same
  // store, so the second case is a cold start, not a missing organization.
  if (node === undefined) return null

  return (
    <DetailBand
      name={localName(node, locale)}
      kindName={kindName}
      manager={managerLabel(memberById, node.account_manager_id)}
      vendor={node.vendor}
      progress={progress}
      labelOf={(useCase) => localName(useCase, locale)}
      loading={loading}
      error={error}
    />
  )
}

/* ══════════════════════════ the render ══════════════════════════ */

export interface DetailBandProps {
  /** The node's own name, already resolved for the locale. */
  name: string
  kindName: string | null
  /** Null renders the em-dash; see managerLabel() for why "gone" is not null. */
  manager: string | null
  /** `''` is "not recorded" — the column is `not null default ''`, never null. */
  vendor: string
  progress: UseCaseProgress
  labelOf: (useCase: UseCase) => string
  loading: boolean
  /** An i18n key from api/map.ts, never a sentence. */
  error: string | null
}

/**
 * The band as markup, split out so it can be rendered without a store or a
 * fetch — `vitest.config.ts` is `environment: 'node'` and effects do not run
 * under `renderToStaticMarkup`, so a test of the connected component alone could
 * only ever prove the loading state.
 */
export function DetailBand({
  name,
  kindName,
  manager,
  vendor,
  progress,
  labelOf,
  loading,
  error,
}: DetailBandProps): ReactElement {
  useLocale()
  const { rows, done, total, linked } = progress
  const settled = !loading && error === null

  return (
    <section className="mbr-band mbr-detail" aria-label={t('mapnode.detail')}>
      <div className="mbr-band-head">
        <h3 className="section-title">{t('mapnode.detail')}</h3>
        {/* The kind, as a caption. Database text: isolated, never translated. */}
        {kindName !== null && kindName !== '' && (
          <span className="pill mbr-band-count">{isolate(kindName)}</span>
        )}
      </div>

      <dl className="mbr-fields">
        <div className="mbr-field">
          <dt className="mbr-field-k">{t('mapnode.accountManager')}</dt>
          <dd className="mbr-field-v">{manager === null ? <NotRecorded /> : isolate(manager)}</dd>
        </div>
        <div className="mbr-field">
          <dt className="mbr-field-k">{t('mapnode.vendor')}</dt>
          <dd className="mbr-field-v">
            {vendor.trim() === '' ? <NotRecorded /> : isolate(vendor)}
          </dd>
        </div>
      </dl>

      {/* THE MATRIX, and it is the visually dominant element on the band: it is
          the answer to "how far has this organization actually got", which is
          the question the panel was asked. */}
      <div className="mbr-uc">
        <h4 className="mbr-sub">{t('mapnode.useCases')}</h4>

        {/* ONE LIVE REGION FOR THE WHOLE ASYNC RESULT, so a reader hears exactly
            one sentence per load rather than a skeleton, a count and a heading
            in three announcements. The visible text is the short form the
            heading gives context to; the announced text names its scope and its
            unit, because a screen reader has no heading four pixels above it. */}
        <p className="mbr-uc-head" role="status">
          {loading ? (
            <span>{t('common.loading')}</span>
          ) : error !== null ? (
            <span className="mbr-note">{t(error)}</span>
          ) : linked === 0 ? (
            /* THE STATE THE OWNER WILL SEE MOST IN THE FIRST WEEK, written as a
               sentence rather than as a dash. Every other em-dash on this panel
               sits in a FIELD or in the status column, where a reader's eye
               already has a label beside it and a dash reads as "this one is
               blank". Here the dash would be standing in for `6 of 9 live` — a
               whole sentence — at the top of a band that is otherwise ten rows
               of dashes, and "the band failed to load" and "nobody has recorded
               anything yet" would look identical. The rows below still render:
               on a brand-new organization they are the CHECKLIST of what there
               is to record, which is the one useful thing this band can say
               before anybody has said anything. */
            <span>{t('mapnode.statusNone')}</span>
          ) : (
            <>
              <span className="tabular" aria-hidden="true">
                {t('mapnode.progress', { done, total, status: t(STATUS_WORD[TERMINAL_STATUS]) })}
              </span>
              <span className="sr-only">
                {t('mapnode.progressLong', {
                  done,
                  total,
                  status: t(STATUS_WORD[TERMINAL_STATUS]),
                  name,
                })}
              </span>
            </>
          )}
        </p>

        {/* The rows render whenever the catalogue has anything on the table,
            settled or not — a capability nobody has recorded is a zero, and the
            zeroes are half of what the reader came to see. */}
        {settled && rows.length > 0 && (
          <ul className="mbr-uc-list" aria-label={t('mapnode.useCasesFor', { name })}>
            {rows.map((row) => (
              <li
                key={row.useCase.id}
                className="mbr-uc-row"
                data-status={row.status ?? undefined}
                data-retired={row.retired ? 'true' : undefined}
              >
                {/* Database text: isolated so a Latin capability name beside an
                    Arabic status does not drag the row's punctuation across. */}
                <span className="mbr-uc-name">{isolate(labelOf(row.useCase))}</span>
                {/* Retired from the catalogue, still recorded here. Marked
                    rather than hidden: hiding it would shrink the denominator
                    and rewrite yesterday's number. */}
                {row.retired && (
                  <span className="pill mbr-retired" title={t('mapnode.retiredHint')}>
                    {t('mapnode.retired')}
                  </span>
                )}
                {row.status === null ? (
                  <span className="mbr-uc-status">
                    <span aria-hidden="true">{EM_DASH}</span>
                    <span className="sr-only">{t('mapnode.statusNone')}</span>
                  </span>
                ) : (
                  <span className={`pill mbr-uc-status${STATUS_TONE[row.status]}`}>
                    {t(STATUS_PILL[row.status])}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}

/**
 * A field with nothing in it.
 *
 * The dash is what Aziz reads and the word is what a screen reader says; an
 * `aria-label` on a plain <span> would be neither, because ARIA 1.2 prohibits
 * naming a generic element and assistive technology is free to drop it.
 */
function NotRecorded(): ReactElement {
  return (
    <>
      <span aria-hidden="true">{EM_DASH}</span>
      <span className="sr-only">{t('mapnode.notRecorded')}</span>
    </>
  )
}

/* ══════════════════ the goal band — what was promised (0027) ══════════════ */

/**
 * The one error key this band swallows on purpose.
 *
 * `map_node_goals` does not exist in the live database until the owner runs
 * 0027, so every read answers PostgREST's `PGRST205` until he does, on every
 * open, for every node. api/goals.ts's header states the contract and this is
 * the line that keeps it: a table that does not exist holds no goals, which is
 * indistinguishable from a node nobody has made a promise about, and the empty
 * state already says the right thing for both. Every OTHER error is shown — a
 * read refused by RLS or dropped by the network is a fact the reader needs.
 */
const MISSING_TABLE = 'common.errMissingTable'

/**
 * How far a goal has actually got — the sibling unit's fold, when it lands.
 *
 * ⚠ THIS IS A SEAM AND IT IS DELIBERATELY THE NARROW HALF OF ONE.
 *   `goalProgress(goal, node, descendants, stages, today)` in lib/mapNodes.ts is
 *   the pure fold that computes this; it answers six fields and this band reads
 *   two, so the fold's own `GoalProgress` satisfies this interface structurally
 *   and the integrator passes it through `readings` with no adapter. Declaring
 *   the two fields here rather than importing the type is what lets this band
 *   ship and render BEFORE that fold exists — and lib/** may not import api/**,
 *   so the type could not have travelled the other way in any case.
 *
 * NO READING IS NOT ZERO. A goal with no entry in `readings` renders its
 * `reached` as an em-dash: nothing has been folded, which is a different fact
 * from "none of them have arrived" and the one that must not be printed as a
 * number in front of an AD.
 *
 * `daysLeft` is NOT read from here even though the fold computes one. The band
 * owns the clock — see `goalClock` — because "how many days" is a question about
 * TODAY rather than about the ladder, and two subtractions of the same two dates
 * cannot disagree only if exactly one of them is on screen.
 */
export interface GoalReading {
  /** Descendants at or beyond the goal's rung (a terminal rung when it names none). */
  reached: number
  /** Descendants nobody has staged. The clause that stops "0 of 40" being a lie. */
  unstaged: number
}

/** Past its date · due today · still ahead. Drives the row's tone, nothing else. */
export type GoalTone = 'over' | 'due' | 'ahead'

/** The clock sentence for one goal: which key, with which number, in which tone. */
export interface GoalClock {
  key: string
  count: number
  tone: GoalTone
}

/**
 * How the days-left chip reads, from a signed day count.
 *
 * THREE ARMS, NOT TWO, AND THE MIDDLE ONE IS THE POINT. Zero is neither "0 days
 * left" nor "0 days overdue" — both of those are sentences a person reads as
 * "nothing is happening" on the single day when the opposite is true. It is
 * "Due today", which is the only day of the goal's life anybody can still act on
 * it and hit the date.
 *
 * The sign is the whole state: negative is overdue and the count is flipped, so
 * no caller ever renders a minus sign at a reader. Pure and exported so the
 * arithmetic can be pinned at a fixed instant rather than on a machine whose
 * wall clock happens to be in the right week — lib/lifecycle.ts's contract, one
 * level up from the same question.
 */
export function goalClock(daysLeft: number): GoalClock {
  if (daysLeft < 0) return { key: 'mapnode.goalOverdue', count: -daysLeft, tone: 'over' }
  if (daysLeft === 0) return { key: 'mapnode.goalDue', count: 0, tone: 'due' }
  return { key: 'mapnode.goalLeft', count: daysLeft, tone: 'ahead' }
}

/**
 * Which of the four sentences a goal is, as LITERAL keys.
 *
 * Written out rather than assembled, `STATUS_PILL`'s reason twenty lines up:
 * `localeReach.test.ts` scans the source for key-shaped strings and cannot see a
 * key it has to build, so a template literal here would take four keys out of the
 * gate that proves they exist in both bundles.
 *
 * The four ARE 0027's four rows — the table in `MapNodeGoal`'s comment — and
 * there is deliberately no fifth: a goal has a stage or it does not, and a count
 * or it does not, and nothing in the schema can say anything else.
 */
const GOAL_SENTENCE = {
  countStage: 'mapnode.goalCountStage',
  count: 'mapnode.goalCount',
  stage: 'mapnode.goalStage',
  date: 'mapnode.goalDate',
} as const

/**
 * A goal's name in this locale, or the sentence that stands in for an unnamed one.
 *
 * `''` IS A LEGAL LABEL AND A GOOD GOAL — 0027 says so, because the date and the
 * target already say what it is. But a confirmation reading "Delete  ?" and an
 * aria-label reading "Edit" are not options, so the fallback names the goal the
 * way a person would: "the goal due 31/12/2026".
 */
function goalName(goal: MapNodeGoal, locale: Locale): string {
  const label = locale === 'ar' ? goal.label_ar.trim() || goal.label : goal.label
  if (label.trim() !== '') return label
  return t('mapnode.goalUnnamed', { date: formatDate(goal.target_date, locale) })
}

/**
 * The read's own order, kept after every optimistic write.
 *
 * `target_date` then `id`, which is exactly what `listGoals` asks the server for
 * — so an edited goal lands where a reload would put it rather than where it
 * happened to be, and the next read cannot reshuffle a list the reader is
 * looking at.
 */
function sortGoals(rows: readonly MapNodeGoal[]): MapNodeGoal[] {
  return [...rows].sort((a, b) =>
    a.target_date === b.target_date
      ? a.id.localeCompare(b.id)
      : a.target_date.localeCompare(b.target_date),
  )
}

/* ── the connected band ────────────────────────────────────────────────── */

export interface MapBranchGoalsProps {
  /** The map-node id behind the focused branch — `entityIdOf(node)`, never null. */
  nodeId: string
  /**
   * goal id → how far it has got. Absent today, and NOT for want of a read:
   * `goalProgress` runs off the stage ladder and the descendant walk, both of
   * which store/config holds at boot. What is missing is a caller that holds the
   * GOALS — this band fetches its own, and `readings` is keyed by goal id — so
   * the fold lands with the portfolio's whole-table goal read (wave 4). Until
   * then every goal renders its promise with an em-dash where the number goes.
   * See `GoalReading`.
   */
  readings?: ReadonlyMap<string, GoalReading>
}

export function MapBranchGoals({ nodeId, readings }: MapBranchGoalsProps): ReactElement {
  const locale = useLocale()
  const nodeById = useMapNodeMap()
  const stageById = useStageMap()
  const stages = useMapNodeStages()
  const stageLabelOf = useStageLabel()
  // THE PERMISSION, NOT THE ROLE. `structure.edit` is the key 0027's policies
  // name; a test against `profile.role === 'admin'` would disagree with the
  // database the moment Aziz gives a custom role that key (0025).
  const canEdit = useHasPerm('structure.edit')

  const [rows, setRows] = useState<readonly MapNodeGoal[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  /** Only the newest request may write state — focus moves faster than a fetch. */
  const request = useRef(0)
  /** False after unmount, so a resolved write cannot set state on a dead band. */
  const alive = useRef(true)

  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])

  useEffect(() => {
    const token = request.current + 1
    request.current = token
    // CLEARED, not kept: these are a DIFFERENT branch's commitments the moment
    // the id changes, and one frame of the previous department's promises under
    // this one's name is a lie nobody would suspect.
    setRows([])
    setError(null)
    setLoading(true)
    // ONE NODE'S GOALS, through the chunked list rather than a second query:
    // `listGoals([nodeId])` makes exactly one request for one id, and having a
    // single read path means the panel and the portfolio cannot drift about what
    // a goal row contains.
    //
    // `truncated` is not rendered and that is a judgement rather than an
    // oversight: this read is capped at 5,000 rows for ONE node, and a node with
    // 5,000 commitments on it is not a workspace this sentence could help. The
    // read where truncation is a real question is the portfolio's `listGoals()`
    // over every node, and that caller owes the banner.
    void listGoals([nodeId]).then((result) => {
      if (token !== request.current || !alive.current) return
      setLoading(false)
      if (!result.ok) {
        setError(result.error)
        return
      }
      setRows(sortGoals(result.data.rows))
    })
  }, [nodeId])

  const node: MapNode | undefined = nodeById.get(nodeId)
  const name = node === undefined ? '' : localName(node, locale)

  /**
   * The rung a goal names, resolved for the reader — or null for the terminal
   * reading, which is what a NULL `stage_id` means and the commonest goal there
   * is.
   *
   * AN UNRESOLVED ID IS NOT THE TERMINAL READING. A goal whose rung the store
   * cannot resolve (0026 unapplied, or a ladder that has not loaded) still says
   * "at some rung or beyond", and falling back to "arrived by" would silently
   * show a DIFFERENT promise than the one that was made. `managerLabel`'s rule,
   * one field over: an id the roster does not know is a person who left, not
   * nobody.
   */
  const stageNameOf = useCallback(
    (stageId: string | null): string | null => {
      if (stageId === null) return null
      const stage: MapNodeStage | undefined = stageById.get(stageId)
      return stage === undefined ? t('mapnode.goalStageGone') : stageLabelOf(stage)
    },
    [stageById, stageLabelOf],
  )

  /**
   * The rungs the editor offers.
   *
   * HIDDEN RUNGS ARE OUT OF THE PICKER — `use_cases.hidden`'s contract — EXCEPT
   * the one this goal already names, which has to stay on the list or opening
   * the editor would silently rewrite the promise as soon as anything else is
   * saved.
   */
  const pickable = useCallback(
    (current: string | null): MapNodeStage[] =>
      stages.filter((stage) => !stage.hidden || stage.id === current),
    [stages],
  )

  const save = useCallback(
    async (id: string | null, input: MapNodeGoalInput): Promise<boolean> => {
      if (busy) return false
      setBusy(true)

      // CREATE IS NOT OPTIMISTIC, and the reason is that there is nothing honest
      // to be optimistic WITH: a new goal has no id until the server gives it
      // one, and a fabricated key is a row the next reconciliation cannot match.
      // The edit and delete paths below ARE optimistic, because both act on a row
      // that already exists and can be put back exactly as it was.
      if (id === null) {
        const result = await createGoal(input)
        if (!alive.current) return false
        setBusy(false)
        if (!result.ok) {
          toast(t(result.error), { tone: 'error' })
          return false
        }
        setRows((current) => sortGoals([...current, result.data]))
        toast(t('mapnode.goalAdded', { goal: goalName(result.data, locale) }), { tone: 'success' })
        return true
      }

      const before = rows
      const previous = before.find((row) => row.id === id)
      if (previous === undefined) {
        setBusy(false)
        return false
      }
      // The row as the server will hold it, applied before the round trip.
      const optimistic: MapNodeGoal = {
        ...previous,
        label: input.label,
        label_ar: input.labelAr,
        stage_id: input.stageId,
        target: input.target,
        target_date: input.targetDate,
      }
      setRows(sortGoals(before.map((row) => (row.id === id ? optimistic : row))))

      const result = await updateGoal(id, input)
      if (!alive.current) return true
      setBusy(false)
      if (!result.ok) {
        // ROLLED BACK TO THE EXACT LIST, not to a re-fetch: the reader is looking
        // at the row, and a refusal that left the new date on screen would be the
        // app agreeing to a promise the database refused.
        setRows(before)
        toast(t(result.error), { tone: 'error' })
        return false
      }
      setRows((current) => sortGoals(current.map((row) => (row.id === id ? result.data : row))))
      toast(t('mapnode.goalSaved', { goal: goalName(result.data, locale) }), { tone: 'success' })
      return true
    },
    [busy, locale, rows],
  )

  const remove = useCallback(
    async (goal: MapNodeGoal): Promise<void> => {
      if (busy) return
      const label = goalName(goal, locale)
      // THE CONFIRMATION NAMES THE GOAL. Several goals sit on one node by design
      // — one ramp at two altitudes — so "Delete this goal?" alone is a dialog
      // the reader cannot answer without counting rows.
      const ok = await confirm({
        title: t('mapnode.goalDeleteTitle'),
        body: t('mapnode.goalDeleteBody', { goal: label }),
        confirmLabel: t('common.delete'),
        cancelLabel: t('common.cancel'),
        danger: true,
      })
      if (!ok || !alive.current) return

      setBusy(true)
      const before = rows
      setRows(before.filter((row) => row.id !== goal.id))
      const result = await deleteGoal(goal.id)
      if (!alive.current) return
      setBusy(false)
      if (!result.ok) {
        setRows(before)
        toast(t(result.error), { tone: 'error' })
        return
      }
      toast(t('mapnode.goalDeleted', { goal: label }), { tone: 'success' })
    },
    [busy, locale, rows],
  )

  return (
    <GoalBand
      nodeId={nodeId}
      name={name}
      goals={rows}
      readings={readings}
      stageNameOf={stageNameOf}
      pickable={pickable}
      canEdit={canEdit}
      busy={busy}
      loading={loading}
      error={error}
      onSave={save}
      onDelete={remove}
    />
  )
}

/* ── the render ────────────────────────────────────────────────────────── */

export interface GoalBandProps {
  nodeId: string
  /** The branch's own name, already resolved for the locale. */
  name: string
  goals: readonly MapNodeGoal[]
  readings?: ReadonlyMap<string, GoalReading>
  /** Null is the terminal reading; see `stageNameOf` for why it is not a miss. */
  stageNameOf: (stageId: string | null) => string | null
  pickable: (current: string | null) => MapNodeStage[]
  canEdit: boolean
  busy: boolean
  loading: boolean
  /** An i18n key from api/goals.ts, never a sentence. */
  error: string | null
  onSave: (id: string | null, input: MapNodeGoalInput) => Promise<boolean>
  onDelete: (goal: MapNodeGoal) => Promise<void>
  /** Today, injectable so the days-left arithmetic can be pinned in a test. */
  now?: Date
}

/**
 * The band as markup, split out on `DetailBand`'s precedent and for its reason:
 * `vitest.config.ts` is `environment: 'node'`, effects do not run under
 * `renderToStaticMarkup`, and a test of the connected component alone could only
 * ever prove the loading state.
 *
 * IT HOLDS THE EDITOR'S OPEN/CLOSED STATE AND NOTHING ELSE. Which goal is being
 * edited is a fact about this piece of glass; the rows, the permission and the
 * writes all arrive as props, so nothing here can disagree with the store about
 * what was saved.
 */
export function GoalBand({
  nodeId,
  name,
  goals,
  readings,
  stageNameOf,
  pickable,
  canEdit,
  busy,
  loading,
  error,
  onSave,
  onDelete,
  now,
}: GoalBandProps): ReactElement {
  const locale = useLocale()
  const [editing, setEditing] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)

  // THE CLOCK IS READ ONCE PER RENDER, at the top, and handed down. A row that
  // asked for `todayIso()` itself would let a list rendered across midnight
  // count two different days, which is the one way "3 days left" and "2 days
  // left" can appear in one band about one date.
  const today = todayIso(now ?? new Date())

  // A missing table is the pre-migration state, not a fault: it renders as the
  // empty band. Every other error is shown. See MISSING_TABLE.
  const shown = error === MISSING_TABLE ? null : error
  const settled = !loading && shown === null

  return (
    <section className="mbr-band mbr-goals" aria-label={t('mapnode.goals')}>
      <div className="mbr-band-head">
        <h3 className="section-title">{t('mapnode.goals')}</h3>
        {/* ABSENT FOR A MEMBER, never disabled. The three account managers read
            this band; the two Associate Directors write it. */}
        {canEdit && !adding && (
          <button
            type="button"
            className="btn btn-sm btn-ghost mbr-goal-add tap-44"
            disabled={busy}
            onClick={() => {
              setAdding(true)
              setEditing(null)
            }}
          >
            {t('mapnode.goalAdd')}
          </button>
        )}
      </div>

      {/* ONE LIVE REGION FOR THE WHOLE ASYNC RESULT, `.mbr-uc-head`'s rule one
          band up: a reader hears one sentence per load rather than a skeleton and
          a heading in two announcements. */}
      {!settled && (
        <p className="mbr-goal-head" role="status">
          {loading ? (
            <span>{t('common.loading')}</span>
          ) : (
            <span className="mbr-note">{t(shown as string)}</span>
          )}
        </p>
      )}

      {adding && (
        <GoalEditor
          nodeId={nodeId}
          goal={null}
          pickable={pickable}
          busy={busy}
          onCancel={() => setAdding(false)}
          onSave={async (id, input) => {
            const ok = await onSave(id, input)
            if (ok) setAdding(false)
            return ok
          }}
        />
      )}

      {goals.length > 0 && (
        <ul className="mbr-goal-list" aria-label={t('mapnode.goalsFor', { name })}>
          {goals.map((goal) =>
            editing === goal.id ? (
              <li key={goal.id} className="mbr-goal mbr-goal-editing">
                <GoalEditor
                  nodeId={nodeId}
                  goal={goal}
                  pickable={pickable}
                  busy={busy}
                  onCancel={() => setEditing(null)}
                  onSave={async (id, input) => {
                    const ok = await onSave(id, input)
                    if (ok) setEditing(null)
                    return ok
                  }}
                />
              </li>
            ) : (
              <GoalRow
                key={goal.id}
                goal={goal}
                reading={readings?.get(goal.id)}
                stageName={stageNameOf(goal.stage_id)}
                today={today}
                locale={locale}
                canEdit={canEdit}
                busy={busy}
                onEdit={() => {
                  setEditing(goal.id)
                  setAdding(false)
                }}
                onDelete={() => void onDelete(goal)}
              />
            ),
          )}
        </ul>
      )}

      {/* THE STATE EVERY NODE IS IN ON THE DAY 0027 APPLIES, and it names itself
          rather than showing a dash: a band that is empty because nobody has
          promised anything and a band that is empty because the read failed must
          not look alike. */}
      {settled && goals.length === 0 && !adding && (
        <EmptyState title={t('mapnode.goalsNone')} description={t('mapnode.goalsNoneHint')} />
      )}
    </section>
  )
}

/* ── one goal ──────────────────────────────────────────────────────────── */

interface GoalRowProps {
  goal: MapNodeGoal
  reading: GoalReading | undefined
  stageName: string | null
  today: IsoDate
  locale: Locale
  canEdit: boolean
  busy: boolean
  onEdit: () => void
  onDelete: () => void
}

function GoalRow({
  goal,
  reading,
  stageName,
  today,
  locale,
  canEdit,
  busy,
  onEdit,
  onDelete,
}: GoalRowProps): ReactElement {
  const date = formatDate(goal.target_date, locale)
  const label = goalName(goal, locale)
  // `diffDays(a, b)` is `b - a`, so this is "the date minus today" — positive
  // ahead, negative past. The clamp and the wording are goalClock's.
  const clock = goalClock(diffDays(today, goal.target_date))

  const behind =
    reading !== undefined && goal.target !== null ? Math.max(0, goal.target - reading.reached) : 0

  /**
   * The promise, with whatever stands in for the number that has been reached.
   *
   * ONE FUNCTION AND FOUR KEYS, because the sentence is rendered TWICE when the
   * number is not known — once for the eye and once for the ear — and two copies
   * of a four-way branch is where the two sentences start disagreeing.
   */
  const sentenceWith = (reached: string): string =>
    goal.target !== null
      ? stageName !== null
        ? t(GOAL_SENTENCE.countStage, { reached, target: goal.target, stage: stageName, date })
        : t(GOAL_SENTENCE.count, { reached, target: goal.target, date })
      : stageName !== null
        ? t(GOAL_SENTENCE.stage, { stage: stageName, date })
        : t(GOAL_SENTENCE.date, { date })

  // THE EM-DASH IS FOR NO-DATA AND NEVER FOR ZERO. Nothing has folded the
  // descendants yet, and "0 of 40" would report forty organizations as having
  // got nowhere on the strength of an arithmetic that has not run.
  //
  // The dash is what Aziz reads and the WORD is what a screen reader says —
  // `NotRecorded`'s rule, applied to a dash that sits inside an interpolation
  // and so cannot carry an `.sr-only` sibling of its own. A dash is announced as
  // nothing by most screen readers, which would turn this into "of 40 arrived
  // by 31 December": a sentence with a hole where its subject was.
  const sentence = reading === undefined ? sentenceWith(EM_DASH) : sentenceWith(String(reading.reached))
  const spoken = reading === undefined ? sentenceWith(t('mapnode.notRecorded')) : null

  return (
    <li className="mbr-goal" data-tone={clock.tone}>
      <div className="mbr-goal-main">
        {/* Database text, isolated: an Arabic goal name beside a Latin rung name
            must not drag the row's punctuation across. An unnamed goal renders no
            heading at all — the sentence below already says what it is. */}
        {goal.label.trim() !== '' || goal.label_ar.trim() !== '' ? (
          <p className="mbr-goal-name">{isolate(label)}</p>
        ) : null}
        <p className="mbr-goal-say">
          {spoken === null ? (
            <span>{sentence}</span>
          ) : (
            <>
              <span aria-hidden="true">{sentence}</span>
              <span className="sr-only">{spoken}</span>
            </>
          )}
          {behind > 0 && (
            <>
              {/* A SEPARATOR, hidden from the reader who is being read to: the
                  two clauses are announced as two, which is what they are. */}
              <span aria-hidden="true"> {EM_DASH} </span>
              <span className="mbr-goal-behind">{t('mapnode.goalBehind', { count: behind })}</span>
            </>
          )}
        </p>
        {/* "0 of 40" alone is a number the AD would chase the wrong thing about;
            "380 with no stage recorded" is the actionable half of the same fact. */}
        {reading !== undefined && reading.unstaged > 0 && (
          <p className="mbr-goal-unstaged">
            {t('mapnode.goalUnstaged', { count: reading.unstaged })}
          </p>
        )}
      </div>

      <span className="pill mbr-goal-clock tabular" data-tone={clock.tone}>
        {t(clock.key, { count: clock.count })}
      </span>

      {canEdit && (
        <div className="mbr-goal-acts">
          {/* NAMED, both of them: several goals sit on one node, so "Edit" alone
              is a control a screen-reader user cannot tell from the next one. */}
          <button
            type="button"
            className="btn btn-sm btn-ghost tap-44"
            disabled={busy}
            aria-label={t('mapnode.goalEditOne', { goal: label })}
            onClick={onEdit}
          >
            {t('common.edit')}
          </button>
          <button
            type="button"
            className="btn btn-sm btn-ghost tap-44"
            disabled={busy}
            aria-label={t('mapnode.goalDeleteOne', { goal: label })}
            onClick={onDelete}
          >
            {t('common.delete')}
          </button>
        </div>
      )}
    </li>
  )
}

/* ── the editor ────────────────────────────────────────────────────────── */

/** The form's own state: every field a string, because that is what an input holds. */
interface GoalDraft {
  label: string
  labelAr: string
  /** `''` is the terminal reading — the goal names no rung. */
  stageId: string
  /** `''` is a date goal about the branch itself, NOT a target of zero. */
  target: string
  targetDate: string
}

function draftOf(goal: MapNodeGoal | null): GoalDraft {
  if (goal === null) return { label: '', labelAr: '', stageId: '', target: '', targetDate: '' }
  return {
    label: goal.label,
    labelAr: goal.label_ar,
    stageId: goal.stage_id ?? '',
    target: goal.target === null ? '' : String(goal.target),
    targetDate: goal.target_date,
  }
}

/**
 * What the form refuses before the round trip — field → error key.
 *
 * THE KEYS ARE api/goals.ts's AND lib/pgError.ts's, not new ones, so the sentence
 * an AD reads is the same whether the client caught it or the database did. That
 * is the whole reason `GOAL_LABEL_MAX` is exported from the api module: two
 * numbers that must agree, in one place, with the CHECK constraint's own value
 * written beside it there.
 */
function validate(draft: GoalDraft): Partial<Record<keyof GoalDraft, string>> {
  const problems: Partial<Record<keyof GoalDraft, string>> = {}
  if (draft.label.length > GOAL_LABEL_MAX) problems.label = 'mapadmin.errGoalLabelLength'
  if (draft.labelAr.length > GOAL_LABEL_MAX) problems.labelAr = 'mapadmin.errGoalLabelArLength'
  // THROUGH lib/dates, never `new Date(value)`: an `<input type="date">` hands
  // back `''` when it is empty and an out-of-range year when somebody types one,
  // and `parseIsoDate` is the repo's one answer to both.
  if (parseIsoDate(draft.targetDate) === null) problems.targetDate = 'mapnode.goalErrDate'
  const target = draft.target.trim()
  if (target !== '') {
    const n = Number(target)
    // A goal of 0 reads as permanently met and a fraction is not a count of
    // organizations. 0027 refuses both; this says so without a round trip.
    if (!Number.isInteger(n) || n <= 0) problems.target = 'mapadmin.errGoalTarget'
  }
  return problems
}

interface GoalEditorProps {
  nodeId: string
  /** Null adds; a row edits it. */
  goal: MapNodeGoal | null
  pickable: (current: string | null) => MapNodeStage[]
  busy: boolean
  onCancel: () => void
  onSave: (id: string | null, input: MapNodeGoalInput) => Promise<boolean>
}

function GoalEditor({
  nodeId,
  goal,
  pickable,
  busy,
  onCancel,
  onSave,
}: GoalEditorProps): ReactElement {
  // Subscribed, not read: the rung names in the select and every label around
  // them are `t()`'d at render, so this form has to re-render when the language
  // changes. `DetailBand` opens with the same line for the same reason.
  useLocale()
  const stageLabelOf = useStageLabel()
  const [draft, setDraft] = useState<GoalDraft>(() => draftOf(goal))
  // Errors appear on submit rather than on the first keystroke: a form that turns
  // red while somebody is still typing the first character of a date is a form
  // that reads as broken.
  const [submitted, setSubmitted] = useState(false)
  const problems = useMemo(() => validate(draft), [draft])
  const id = `mbr-goal-${goal?.id ?? 'new'}`
  const options = pickable(goal?.stage_id ?? null)

  function submit(): void {
    setSubmitted(true)
    if (Object.keys(problems).length > 0) return
    void onSave(goal?.id ?? null, {
      nodeId,
      label: draft.label,
      labelAr: draft.labelAr,
      // `''` OUT, null IN. The select's empty option is the terminal reading and
      // the number field's empty string is a date goal — both are meanings, and
      // both would arrive at PostgREST as the literal empty string if this line
      // were not here.
      stageId: draft.stageId === '' ? null : draft.stageId,
      target: draft.target.trim() === '' ? null : Number(draft.target),
      targetDate: draft.targetDate,
    })
  }

  return (
    <form
      className="mbr-goal-form"
      onSubmit={(e) => {
        e.preventDefault()
        submit()
      }}
    >
      <div className="field">
        <label className="field-label" htmlFor={`${id}-label`}>
          {t('mapnode.goalLabelField')}
        </label>
        <input
          id={`${id}-label`}
          className="input"
          type="text"
          value={draft.label}
          maxLength={GOAL_LABEL_MAX}
          onChange={(e) => setDraft((d) => ({ ...d, label: e.target.value }))}
        />
        {submitted && problems.label !== undefined && (
          <p className="field-error">{t(problems.label)}</p>
        )}
      </div>

      <div className="field">
        <label className="field-label" htmlFor={`${id}-label-ar`}>
          {t('mapnode.goalLabelArField')}
        </label>
        <input
          id={`${id}-label-ar`}
          className="input"
          type="text"
          dir="rtl"
          value={draft.labelAr}
          maxLength={GOAL_LABEL_MAX}
          onChange={(e) => setDraft((d) => ({ ...d, labelAr: e.target.value }))}
        />
        {submitted && problems.labelAr !== undefined && (
          <p className="field-error">{t(problems.labelAr)}</p>
        )}
      </div>

      <div className="field">
        <label className="field-label" htmlFor={`${id}-stage`}>
          {t('mapnode.goalStageField')}
        </label>
        <select
          id={`${id}-stage`}
          className="select"
          value={draft.stageId}
          onChange={(e) => setDraft((d) => ({ ...d, stageId: e.target.value }))}
        >
          {/* THE EMPTY OPTION IS A MEANING, not a placeholder: "any rung that
              counts as arrived" is the commonest goal there is, and 0027 stores
              it as a NULL `stage_id`. */}
          <option value="">{t('mapnode.goalStageAny')}</option>
          {options.map((stage) => (
            <option key={stage.id} value={stage.id}>
              {stageLabelOf(stage)}
            </option>
          ))}
        </select>
      </div>

      <div className="field">
        <label className="field-label" htmlFor={`${id}-target`}>
          {t('mapnode.goalTargetField')}
        </label>
        <input
          id={`${id}-target`}
          className="input tabular"
          type="number"
          inputMode="numeric"
          min={1}
          step={1}
          value={draft.target}
          onChange={(e) => setDraft((d) => ({ ...d, target: e.target.value }))}
        />
        {submitted && problems.target !== undefined ? (
          <p className="field-error">{t(problems.target)}</p>
        ) : (
          <p className="mbr-hint">{t('mapnode.goalTargetHint')}</p>
        )}
      </div>

      <div className="field">
        <label className="field-label" htmlFor={`${id}-date`}>
          {t('mapnode.goalDateField')}
        </label>
        <input
          id={`${id}-date`}
          className="input"
          type="date"
          value={draft.targetDate}
          onChange={(e) => setDraft((d) => ({ ...d, targetDate: e.target.value }))}
        />
        {submitted && problems.targetDate !== undefined && (
          <p className="field-error">{t(problems.targetDate)}</p>
        )}
      </div>

      <div className="mbr-goal-form-acts">
        <button type="submit" className="btn btn-sm btn-primary tap-44" disabled={busy}>
          {t('common.save')}
        </button>
        <button
          type="button"
          className="btn btn-sm btn-ghost tap-44"
          disabled={busy}
          onClick={onCancel}
        >
          {t('common.cancel')}
        </button>
      </div>
    </form>
  )
}
