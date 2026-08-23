// CAPABILITY CARDS — one organization, one card, and the card has to survive
// being screenshotted on its own.
//
// This is the view that answers "what does THIS hospital look like". The table
// answers it too, but a table row is only legible inside its header: a person
// who crops one line out of it and sends it to a colleague sends four numbers
// with no nouns attached. So every fact on a card is written beside its own
// label, in the card, and the card is the unit that travels.
//
// ── THE STRIP IS THE POINT, AND IT IS POSITIONAL ───────────────────────────
//
// Fifteen marks, one per capability, IN CATALOGUE ORDER — so mark 7 is the same
// capability on every card and two cards side by side can be compared by shape
// alone. That is why the strip is driven off `catalogue` with the progress rows
// looked up by id, rather than off `progress.rows` directly: the rows are in
// catalogue order today (lib/mapNodes.ts sorts them by `sort_order`) and are the
// same length for every organization, but `useCaseProgress` DROPS a hidden
// capability nobody has linked — so an organization that happens to link a
// retired one has a longer row list than its neighbour, and index 7 stops
// meaning the same thing on the two cards. Iterating the catalogue makes the
// invariant structural instead of inherited.
//
// ── FOUR STATES, AND THE FOURTH IS THE COMMON ONE ──────────────────────────
//
// 161 organizations × 15 capabilities is 2,415 cells and 1,700 of them are
// EMPTY. The mean organization records about four. So the state this strip
// spends most of its ink on is `status === null` — NOBODY HAS SAID — and it is
// not `planned`. Planned means a person looked at this capability, at this
// organization, and said "we intend to"; null means the question has never been
// put. house law 1 gives the idiom for a dense mark: the container's own ground
// plus a hairline. `planned` is therefore a SOLID rounded square in
// `var(--border)` and unrecorded is a HOLLOW CIRCLE — the card's own surface
// showing through a 1px ring of the same token. Fill-versus-socket is a
// difference in FORM, and square-versus-round is a difference in SHAPE; neither
// is a hue, which is what keeps the pair legible to a reader who cannot separate
// the three colours at all (WCAG 1.4.1). Every mark carries its capability's
// name and its state as an `.sr-only` sentence besides, so the drawing is
// decoration over a fact that is already written — `portfolio.css`'s rule,
// fifteen times per card.
//
// A FIFTH THING IS NOT ONE OF THE FOUR. `row.progress === null` means the links
// store has not landed — nobody has LOOKED, as against nobody having SAID.
// Drawing that as fifteen empty sockets would report fifteen unasked questions
// per card on every mount, which is a measurement nobody took (house law 3, one
// layer up). It gets a quiet line of its own where the strip would be.
//
// ── THE COUNTS ARE COUNTED OFF THE MARKS THAT WERE DRAWN ───────────────────
//
// "4 recorded · 2 live" is a CAPTION on the strip above it, and a caption that
// can disagree with its own picture is worse than a second fold. So `recorded`
// and `live` are counted from the very array the marks are rendered from rather
// than read off `progress.linked` / `progress.done`. Per organization the two
// agree by construction — `map_node_use_cases` is keyed `(node_id,
// use_case_id)`, so a capability is linked at most once and `status === null` is
// exactly `linked === 0` — and the day that stops being true, the number under
// the strip will still be the number of marks in it.
//
// NO BARE PERCENTAGE and no "0 of 15" (house laws 2 and 3). Where nothing is
// recorded the card says so in a sentence: printing a zero for a question nobody
// asked is printing a measurement nobody took.
//
// ── BUCKETS GET THE SAME CARD, A COARSER SUBJECT ───────────────────────────
//
// `showsRows === false` is the `?by=` roll-up, and a bucket has no per-capability
// reading to draw — `PortfolioGroupRow` carries sums, not rows. It gets the same
// frame, the same fact list and the same words, with `done of total` where the
// strip would be. It gets NO open button: `onOpenNode` takes a map-node id and a
// bucket key is a stage id, a manager id or a folded vendor string — passing one
// to it is the `entityIdOf` mistake lib/mapNodes.ts exists to prevent. The drill
// into a bucket belongs to the chip row that owns `?by=`, not to this card.
//
// ── LAYOUT ─────────────────────────────────────────────────────────────────
//
// `repeat(auto-fit, minmax(280px, 1fr))` — pmo.css's precedent and its stated
// reason, "auto-fit picks the moment rather than a breakpoint that has to be
// kept in step". At 375px that is ONE column and every card is the full width;
// nothing is dropped and nothing needs to pan. The wrapper is still a named
// `role="region"` tab stop with `overflow-x: auto` (house law 5) because a card
// whose organization name is one 40-character unbroken token is a card wider
// than its column, and the reader who meets one must be able to reach the end of
// it without a pointer.

import { type ReactElement, type ReactNode } from 'react'
import { EmptyState } from '../shared'
import { isolate } from '../../lib/bidi'
import { t } from '../../lib/i18n'
import { useCapabilityLabel } from '../../lib/labels'
import type { UseCaseProgress } from '../../lib/mapNodes'
import type { PortfolioGroupRow, PortfolioRow } from '../../lib/portfolio/rows'
import type { UseCase, UseCaseStatus } from '../../types'
import './portfolio-cards.css'

/** A value nobody has recorded. Never a `0`; always paired with an `.sr-only`
 *  word — `Blank()` in PortfolioStage.tsx and `NotRecorded()` in
 *  MapBranchDetail.tsx, which is the app's one absence idiom. */
const EM_DASH = '—'

/**
 * The word each recorded state wears, as LITERAL keys.
 *
 * Literal because `localeReach.test.ts` scans source for quoted dotted strings
 * and cannot see a key that has to be assembled: `t(\`mapnode.status${s}\`)`
 * would take all three out of the gate and ship missing in one language.
 *
 * They are `mapnode.*` and not new `mindtree.portfolioCards*` strings on
 * purpose. MapBranchDetail renders these exact words in the panel that opens
 * beside this stage, off the same `UseCaseStatus` union; a second spelling would
 * let a workspace read "Live" on the card and something else four inches away.
 */
const STATE_WORD: Readonly<Record<UseCaseStatus, string>> = {
  planned: 'mapnode.statusPlanned',
  testing: 'mapnode.statusTesting',
  live: 'mapnode.statusLive',
}

/** The `data-state` a mark wears. The fourth is the ground, never a colour. */
const NOT_RECORDED = 'none'

interface Props {
  rows: readonly PortfolioRow[]
  groups: readonly PortfolioGroupRow[]
  showsRows: boolean
  catalogue: readonly UseCase[]
  compact: boolean
  managerNameOf: (id: string | null) => string | null
  onOpenNode: (nodeId: string) => void
  captionId: string
}

export function PortfolioCards({
  rows,
  groups,
  showsRows,
  catalogue,
  compact,
  managerNameOf,
  onOpenNode,
  captionId,
}: Props): ReactElement {
  const capabilityLabel = useCapabilityLabel()
  const empty = showsRows ? rows.length === 0 : groups.length === 0

  return (
    <div
      className="pfc"
      role="region"
      aria-labelledby={captionId}
      tabIndex={0}
      /* The one thing `compact` decides. It does NOT decide what is on a card:
         "columns are NEVER dropped on a phone" (house law 5) applies to a card's
         facts as much as to a table's columns — a phone reader is not asking a
         smaller question. It buys back the padding those facts need instead. */
      data-compact={compact ? 'true' : undefined}
    >
      {empty ? (
        <div className="pfc-blank">
          <EmptyState
            title={t('mindtree.portfolioEmpty')}
            description={t('mindtree.portfolioEmptyHint')}
          />
        </div>
      ) : (
        <>
          <MarkKey />
          <ul className="pfc-grid">
            {showsRows
              ? rows.map((row) => (
                  <OrgCard
                    key={row.key}
                    row={row}
                    catalogue={catalogue}
                    labelOf={capabilityLabel}
                    managerNameOf={managerNameOf}
                    onOpenNode={onOpenNode}
                  />
                ))
              : groups.map((group) => <BucketCard key={group.key} group={group} />)}
          </ul>
        </>
      )}
    </div>
  )
}

/**
 * What the four marks mean, once, above the grid.
 *
 * A single card carries its own counts in words, which is what makes it legible
 * cropped out of the page; this key is what makes the SHAPES readable the first
 * time somebody meets them. It is a list rather than a paragraph so the marks
 * sit beside their words at any width, and every swatch is `aria-hidden` — the
 * word beside it is the fact.
 */
function MarkKey(): ReactElement {
  return (
    <ul className="pfc-key" aria-label={t('mindtree.portfolioCardsKey')}>
      {(['live', 'testing', 'planned'] as const).map((state) => (
        <li className="pfc-key-item" key={state}>
          <span className="pfc-mark" data-state={state} aria-hidden="true" />
          {t(STATE_WORD[state])}
        </li>
      ))}
      <li className="pfc-key-item">
        <span className="pfc-mark" data-state={NOT_RECORDED} aria-hidden="true" />
        {t('mapnode.notRecorded')}
      </li>
    </ul>
  )
}

/* ══════════════════════════ one organization ══════════════════════════ */

function OrgCard({
  row,
  catalogue,
  labelOf,
  managerNameOf,
  onOpenNode,
}: {
  row: PortfolioRow
  catalogue: readonly UseCase[]
  labelOf: (cap: UseCase) => string
  managerNameOf: (id: string | null) => string | null
  onOpenNode: (nodeId: string) => void
}): ReactElement {
  const owner = managerNameOf(row.managerId)
  return (
    <li className="pfc-card">
      <div className="pfc-head">
        <h3 className="pfc-name">
          {/* The whole name is the target, and the accessible name is the
              sentence rather than the bare noun — `portfolioOpenOrg` is the
              table's own key, so the row and the card promise the same thing.
              It CONTAINS the visible text, which is what SC 2.5.3 asks of a
              label that says more than the glyphs do. */}
          <button
            type="button"
            className="pfc-open tap-44"
            aria-label={t('mindtree.portfolioOpenOrg', { name: row.name })}
            onClick={() => onOpenNode(row.nodeId)}
          >
            {isolate(row.name)}
          </button>
        </h3>
        {/* Archived anywhere up the path. MARKED, never dropped: an organization
            that has left the programme still recorded what it recorded, and
            hiding it would rewrite yesterday's numbers. */}
        {row.retired && <span className="pill pfc-retired">{t('mapnode.retired')}</span>}
      </div>

      {row.trailParts.length > 0 && (
        <p className="pfc-trail">
          {row.trailParts.map((part, i) => (
            <span key={`${i}-${part}`}>
              {/* The separator is the LOCALE's comma and belongs to the line's
                  direction, not to either label — useMapModel's `trail()` rule.
                  Each part is isolated on its own so a Latin phase name inside
                  an Arabic trail cannot drag the comma across. */}
              {i > 0 && t('mindtree.listSep')}
              {isolate(part)}
            </span>
          ))}
        </p>
      )}

      <dl className="pfc-facts">
        <Fact label={t('mindtree.colManager')}>
          {/* "Unassigned" is a SENTENCE, not a dash: an organization with nobody
              accountable for it is the finding, and 42 of the 161 are in that
              state. `portfolioNoManager` is the table's word for it. */}
          {owner === null ? t('mindtree.portfolioNoManager') : isolate(owner)}
        </Fact>
        <Fact label={t('mindtree.colStage')}>
          {row.stageName === null ? t('mindtree.portfolioUnstaged') : isolate(row.stageName)}
        </Fact>
        <Fact label={t('mindtree.colInStage')}>
          {row.daysInStage === null ? (
            <NotRecorded />
          ) : (
            t('mindtree.portfolioDays', { count: row.daysInStage })
          )}
        </Fact>
        {/* NO VERDICT WITHOUT A CLOCK — MapBranchDetail's rule. "Inside its stage
            time" about an organization nobody has staged is a reassurance
            nobody earned. */}
        <Fact label={t('mindtree.colRisk')} risk={row.daysInStage !== null && row.atRisk}>
          {row.daysInStage === null ? (
            <NotRecorded />
          ) : (
            t(row.atRisk ? 'mindtree.portfolioAtRisk' : 'mindtree.portfolioOnTrack')
          )}
        </Fact>
      </dl>

      <Strip name={row.name} progress={row.progress} catalogue={catalogue} labelOf={labelOf} />
    </li>
  )
}

/**
 * Fifteen marks and the sentence under them.
 *
 * The `<ul>` is named for its organization, because a card can be reached by a
 * screen reader out of order and "Use cases" alone names fifteen marks belonging
 * to nobody in particular. Each mark's own name is its capability and its state,
 * which is the fact the colour is decorating.
 */
function Strip({
  name,
  progress,
  catalogue,
  labelOf,
}: {
  name: string
  progress: UseCaseProgress | null
  catalogue: readonly UseCase[]
  labelOf: (cap: UseCase) => string
}): ReactElement {
  // NOBODY HAS LOOKED — the links store has not landed. Not the fourth state,
  // and not an empty strip: both of those would claim a reading that has not
  // been taken. See the header.
  if (progress === null) return <p className="pfc-wait">{t('common.loading')}</p>

  const byId = new Map(progress.rows.map((r) => [r.useCase.id, r]))
  const marks = catalogue.map((useCase) => ({
    useCase,
    status: byId.get(useCase.id)?.status ?? null,
  }))
  const recorded = marks.filter((m) => m.status !== null).length
  const live = marks.filter((m) => m.status === 'live').length

  return (
    <div className="pfc-caps">
      {marks.length > 0 && (
        <ul className="pfc-strip" aria-label={t('mapnode.useCasesFor', { name })}>
          {marks.map(({ useCase, status }) => {
            const word = t(status === null ? 'mapnode.statusNone' : STATE_WORD[status])
            const said = t('mindtree.portfolioCardsMark', { name: labelOf(useCase), status: word })
            return (
              <li
                className="pfc-mark"
                key={useCase.id}
                data-state={status ?? NOT_RECORDED}
                /* The pointer's half of the same sentence. The `.sr-only` span
                   below is the mark's accessible NAME (its contents); this is
                   what a mouse reader gets for the identical fact. */
                title={said}
              >
                <span className="sr-only">{said}</span>
              </li>
            )
          })}
        </ul>
      )}
      <p className="pfc-counts">
        {recorded === 0 ? (
          t('mindtree.portfolioCardsEmpty')
        ) : (
          <span className="tabular">
            {t('mindtree.portfolioCardsCounts', { recorded, live })}
          </span>
        )}
      </p>
    </div>
  )
}

/* ══════════════════════════ one bucket ══════════════════════════ */

function BucketCard({ group }: { group: PortfolioGroupRow }): ReactElement {
  return (
    <li className="pfc-card">
      <div className="pfc-head">
        {/* The unnamed bucket's words differ per grouping — "Nobody named", "Not
            under a phase", "No stage recorded" — and this component is not told
            which `?by=` it is under. `mapnode.notRecorded` is the one word that
            is true of all four, and it is the word the panel beside this stage
            already uses for the same absence. */}
        <h3 className="pfc-name">
          {group.unnamed ? t('mapnode.notRecorded') : isolate(group.label)}
        </h3>
      </div>

      <p className="pfc-trail">{t('mindtree.portfolioTotal', { count: group.orgs })}</p>

      <dl className="pfc-facts">
        {/* A zero here is a REAL zero: every organization in the bucket was
            measured and none of them is past its rung. That is not the
            "nobody has said" absence, and it must not print as a dash. */}
        <Fact label={t('mindtree.colRisk')} risk={group.atRisk > 0}>
          <span className="tabular">{group.atRisk}</span>
        </Fact>
        <Fact label={t('mindtree.colOpen')}>
          <span className="tabular">{group.open}</span>
        </Fact>
        <Fact label={t('mindtree.colInStage')}>
          {group.medianDays === null ? (
            <NotRecorded />
          ) : (
            t('mindtree.portfolioDays', { count: group.medianDays })
          )}
        </Fact>
        <Fact label={t('mapnode.useCases')}>
          <BucketProgress group={group} />
        </Fact>
      </dl>

      {/* THE "ONE FIX UNBLOCKS N" LINE. `portfolioBlock` is the table's own key,
          so the bucket says the same sentence in both shapes. Absent when there
          is no non-terminal rung holding anybody — 0 there means "nothing is
          blocked", which is not a finding. */}
      {group.largestBlock > 0 && group.largestBlockLabel !== '' && (
        <p className="pfc-block">
          {t('mindtree.portfolioBlock', {
            count: group.largestBlock,
            stage: group.largestBlockLabel,
          })}
        </p>
      )}
    </li>
  )
}

/**
 * A bucket's capability reading — and the three answers are three different
 * facts.
 *
 * `done === null` is the links store not having landed (nobody has LOOKED);
 * `total === 0` is a catalogue with nothing on the table for these organizations
 * (nobody has SAID); a real pair prints as "82 of 406" and never as a
 * percentage — Pmo.tsx's rule: an organization that linked three capabilities
 * and has all three live is FINISHED, and 33% would tell a director it is a
 * third of the way there.
 */
function BucketProgress({ group }: { group: PortfolioGroupRow }): ReactElement {
  if (group.done === null || group.total === null) return <>{t('common.loading')}</>
  if (group.total === 0) return <>{t('mindtree.portfolioCardsEmpty')}</>
  return (
    <span className="tabular">
      {t('mindtree.portfolioProgress', { done: group.done, total: group.total })}
    </span>
  )
}

/* ══════════════════════════ the two small parts ══════════════════════════ */

/** One labelled fact. The label is always rendered — that is what makes a card
 *  legible cropped out of the page, which a table row is not. */
function Fact({
  label,
  risk,
  children,
}: {
  label: string
  risk?: boolean
  children: ReactNode
}): ReactElement {
  return (
    <div className="pfc-fact">
      <dt className="pfc-k">{label}</dt>
      {/* `data-risk` is DECORATION over a fact already written: the value beside
          it says "Past its stage" in words, so the ink is never the only
          channel (WCAG 1.4.1) — portfolio.css states the same rule for the
          table's cell. */}
      <dd className="pfc-v" data-risk={risk === true ? 'true' : undefined}>
        {children}
      </dd>
    </div>
  )
}

/**
 * A fact nobody has recorded.
 *
 * The dash is what a reader sees and the word is what a screen reader says; an
 * `aria-label` on a plain `<span>` would be neither, because ARIA 1.2 prohibits
 * naming a generic element. MapBranchDetail's `NotRecorded`, exactly.
 */
function NotRecorded(): ReactElement {
  return (
    <>
      <span aria-hidden="true">{EM_DASH}</span>
      <span className="sr-only">{t('mapnode.notRecorded')}</span>
    </>
  )
}
