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

import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import { listNodeUseCases } from '../../api/map'
import { isolate } from '../../lib/bidi'
import { t, useLocale, type Locale } from '../../lib/i18n'
// ALIASED, AND NOT AS A STYLE CHOICE. `useCaseProgress` is a pure function whose
// name begins with `use` + a capital, which is exactly the shape oxlint's
// `react/rules-of-hooks` uses to recognise a Hook — calling it inside a
// `useMemo` callback is an ERROR under that rule, and calling it from a test's
// `it()` body is another. The name is lib/mapNodes.ts's published contract and
// stays; the alias is the one-line fence at every call site that is not a hook
// position. Renaming the import does not rename the export.
import { useCaseProgress as computeUseCaseProgress, type UseCaseProgress } from '../../lib/mapNodes'
import { useAllUseCases, useMapNodeMap } from '../../store/config'
import { useMemberMap } from '../../store/members'
import type { Member } from '../../api/members'
import type { MapNode, MapNodeUseCase, UseCase, UseCaseStatus } from '../../types'

/* ══════════════════════════ constants ══════════════════════════ */

/**
 * The status that counts as finished — the ONE literal, handed to
 * `useCaseProgress` as its `terminalKey`. lib/mapNodes.ts never compares against
 * a status word of its own, so moving this line moves the arithmetic with it.
 */
const TERMINAL_STATUS: UseCaseStatus = 'live'

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

  const progress = useMemo(
    () => computeUseCaseProgress(catalogue, links, TERMINAL_STATUS),
    [catalogue, links],
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
            <NotRecorded />
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
