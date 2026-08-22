// THE SCREEN THE APP OPENS ON, and the reason it exists.
//
// ── WHAT IT REPLACES ──────────────────────────────────────────────────────
//
// Everyone used to land on the map with the `needs-me` lens open, which is a
// follow-up list over ENTRIES. The live workspace holds ten entries and a
// hundred and four organizations, so the Executive Director this tool is for
// arrived at a near-empty list beside a canvas of unlabelled cards, and the
// question he actually opens it to ask — how much of the capability set is
// live — was not answerable on any screen.
//
// This page answers exactly that question and then gets out of the way. It is
// deliberately NOT a dashboard: no filters, no controls, no configuration, four
// blocks in one column. Everything else is one tap away through the header.
//
// ── PHONE FIRST, AND THAT IS A DESIGN CONSTRAINT NOT A MEDIA QUERY ────────
//
// The owner said the phone is the main device. So this file has NO width
// branch: it is a single column that grows a max-inline-size on a wide screen
// and is otherwise identical. There is nothing here that a 375px viewport has
// to be protected from, because nothing was designed for 1600 and then shrunk.
// That is why the bars below are CSS boxes rather than SVG — an SVG chart needs
// a measured width, and a measured width is the thing that breaks on a phone.
//
// ── THE HONESTY RULE, WHICH THIS SCREEN IS THE MOST EXPOSED TO ────────────
//
// Every number on this page is a proportion, and a proportion is the easiest
// place in an application to tell a lie by rounding. Two rules hold:
//
//   1. NO BARE PERCENTAGE ANYWHERE. Always "82 of 406", never "20%". A
//      percentage hides its denominator, and the denominator is the honest
//      part — `MapBranchDetail` states this rule for the org panel and this is
//      the same rule on the same data.
//   2. A CAPABILITY NOBODY RECORDED SAYS SO. `recorded === 0` prints a
//      sentence, never a zero bar. `lib/home/summary.ts` carries `recorded`
//      beside the three counts for exactly this line.

import { useEffect, useMemo, type ReactElement } from 'react'
import { Link } from 'react-router-dom'
import { t } from '../lib/i18n'
import { useNodeLabel, useStageLabel, useCapabilityLabel } from '../lib/labels'
import { programmeSummary, recentMoves, type CapabilityRow } from '../lib/home/summary'
import {
  loadConfig,
  useAllUseCases,
  useMapNodes,
  useNodeProgress,
  useStageMap,
} from '../store/config'
import { loadPortfolio, usePortfolioLinks } from '../store/portfolio'
import { mergeProgress, usePendingStages } from '../store/stageOverlay'
import { EmptyState } from '../components/shared'
import './home.css'

/**
 * The organizations this page is about.
 *
 * ⚠ LEAVES, NOT EVERY NODE. `map_nodes` holds the programme root and any phases
 *   above the organizations; counting those into `organizations` would inflate
 *   the population by rows that can never carry a capability. A node with no
 *   children is the same test `entityIdOf` makes from the other side.
 */
function useOrganizations(): ReturnType<typeof useMapNodes> {
  const nodes = useMapNodes()
  return useMemo(() => {
    const parents = new Set<string>()
    for (const node of nodes) if (node.parent_id !== null) parents.add(node.parent_id)
    return nodes.filter((node) => !parents.has(node.id) && !node.archived)
  }, [nodes])
}

export default function Home(): ReactElement {
  const organizations = useOrganizations()
  const catalogue = useAllUseCases()
  const links = usePortfolioLinks()
  const stageById = useStageMap()
  const recorded = useNodeProgress()
  const pending = usePendingStages()
  const nodeLabel = useNodeLabel()
  const stageLabel = useStageLabel()

  /**
   * The ladder as a list. `store/config` publishes it as a Map keyed by id and
   * there is no list hook; the sort into `sort_order` is `programmeSummary`'s
   * own job, so this hands over the values and lets it order them.
   */
  const stages = useMemo(() => [...stageById.values()], [stageById])

  // `loadConfig` dedupes internally and does not throw, so it is safe to fire
  // unawaited — the idiom Pmo.tsx uses and states. This page must be right on
  // ARRIVAL, because it is the landing route: a reader gets here before the
  // shell's own warm has settled, every time.
  useEffect(() => {
    void loadConfig()
  }, [])

  /**
   * ⚠ THE LINKS READ IS SCOPED TO THE NODES, so it cannot run until they exist.
   *
   * `loadPortfolio([])` returns immediately without fetching (portfolio.ts:197),
   * and on the first render `organizations` is empty because `loadConfig` above
   * has not resolved. Firing this on mount would therefore fetch NOTHING and
   * mark the store loaded, and the page would sit at "nothing recorded yet"
   * over a workspace holding four hundred links.
   *
   * Keyed on the ids rather than the array so a config refresh that returns an
   * identical roster does not refetch; the store dedupes as well, and this is
   * the cheaper of the two guards.
   */
  const orgIds = useMemo(() => organizations.map((n) => n.id), [organizations])
  useEffect(() => {
    if (orgIds.length === 0) return
    void loadPortfolio(orgIds)
  }, [orgIds])

  /**
   * The optimistic overlay, folded in the same order the map folds it.
   *
   * A stage changed on the map and not yet acknowledged by the server is a real
   * change the reader just made; showing the server's older answer here would
   * make the home screen disagree with the map they came from.
   */
  const progress = useMemo(() => mergeProgress(recorded, pending), [recorded, pending])

  const summary = useMemo(
    () =>
      programmeSummary({
        nodes: organizations,
        catalogue,
        links: links ?? [],
        stages,
        progress: progress.values(),
      }),
    [organizations, catalogue, links, stages, progress],
  )

  // ONE `Date` PER RENDER, not one per row: `recentMoves` takes the clock as an
  // argument precisely so that every row on the screen is measured against the
  // same instant. A `new Date()` inside the map would drift across a long list.
  const moves = useMemo(
    () => recentMoves(progress.values(), organizations, new Date(), 6),
    [progress, organizations],
  )

  /**
   * "Nothing recorded" is a CLAIM, and it must not be made while a read is in
   * flight. `links === null` means nobody has looked yet — distinct from an
   * empty array, which means somebody looked and found none. Printing the empty
   * state during the first fetch would tell an Executive Director his programme
   * is untouched, for as long as the network takes.
   */
  const nothingYet = links !== null && summary.links === 0 && summary.staged === 0

  return (
    <div className="home">
      <h1 className="home-title">{t('home.title')}</h1>

      {nothingYet ? (
        <EmptyState
          title={t('home.nothingRecorded')}
          description={t('home.nothingRecordedHint')}
        />
      ) : (
        <>
          {/* ── the headline ──────────────────────────────────────────────
              The one sentence the owner named. It is a sentence and not a
              tile, because "82 of 406 capabilities live" survives being read
              aloud in a meeting and a tile reading "20%" does not. */}
          <section className="home-head" aria-labelledby="home-live">
            <p className="home-big" id="home-live">
              {summary.live > 0
                ? t('home.liveHeadline', { live: summary.live, total: summary.links })
                : t('home.liveNone')}
            </p>
            <p className="home-sub">{t('home.orgsCounted', { count: summary.organizations })}</p>
            <Bar planned={summary.planned} testing={summary.testing} live={summary.live} />
            <Key />
          </section>

          {/* ── by capability ─────────────────────────────────────────── */}
          <Block title={t('home.byCapability')} hint={t('home.byCapabilityHint')}>
            <ul className="home-rows">
              {summary.capabilities.map((row) => (
                <CapabilityLine key={row.useCase.id} row={row} />
              ))}
            </ul>
          </Block>

          {/* ── by stage ──────────────────────────────────────────────── */}
          <Block title={t('home.byStage')} hint={t('home.byStageHint')}>
            <ul className="home-rows">
              {summary.stages.map(({ stage, count }) => (
                <li className="home-row" key={stage.id}>
                  <span className="home-row-name">{stageLabel(stage)}</span>
                  <span className="home-row-fig">
                    {count > 0 ? (
                      <span className="tabular">{count}</span>
                    ) : (
                      <span className="home-quiet">{t('home.stageNobody')}</span>
                    )}
                  </span>
                  {/* Proportional to the STAGED population, not to every
                      organization: the unstaged ones stand on no rung, so
                      including them would leave every bar short by the same
                      amount and imply a rung that is not on the ladder. */}
                  <span
                    className="home-row-bar"
                    aria-hidden="true"
                    style={{ '--w': pct(count, summary.staged) } as React.CSSProperties}
                  />
                </li>
              ))}
            </ul>
            {summary.unstaged > 0 && (
              <p className="home-note">
                {t('home.unstaged', { count: summary.unstaged })} — {t('home.unstagedHint')}
              </p>
            )}
          </Block>

          {/* ── what moved ────────────────────────────────────────────── */}
          <Block title={t('home.recent')} hint={t('home.recentHint')}>
            {moves.length === 0 ? (
              <p className="home-quiet">{t('home.recentNone')}</p>
            ) : (
              <ul className="home-moves">
                {moves.map((move) => {
                  const node = organizations.find((n) => n.id === move.nodeId)
                  const stage = stageById.get(move.stageId)
                  return (
                    <li className="home-move" key={`${move.nodeId}:${move.changedAt}`}>
                      <span className="home-move-name">{node ? nodeLabel(node) : move.nodeId}</span>
                      <span className="home-move-stage">{stage ? stageLabel(stage) : ''}</span>
                      <span className="home-move-when">
                        {move.daysAgo === 0
                          ? t('home.recentToday')
                          : t('home.recentDays', { count: move.daysAgo })}
                      </span>
                    </li>
                  )
                })}
              </ul>
            )}
          </Block>
        </>
      )}

      {/* The two ways on. Full-width tap targets, because this is the last
          thing on a phone screen and the thumb is already at the bottom. */}
      <nav className="home-go" aria-label={t('home.title')}>
        <Link className="btn btn-block home-go-btn" to="/mindtree">
          {t('home.openMap')}
        </Link>
        <Link className="btn btn-block home-go-btn" to="/pmo">
          {t('home.openPmo')}
        </Link>
      </nav>
    </div>
  )
}

/** A titled block with a line of explanation under it. */
function Block({
  title,
  hint,
  children,
}: {
  title: string
  hint: string
  children: React.ReactNode
}): ReactElement {
  const id = `home-${title.replace(/\W+/g, '-').toLowerCase()}`
  return (
    <section className="home-block" aria-labelledby={id}>
      <h2 className="home-h2" id={id}>
        {title}
      </h2>
      <p className="home-hint">{hint}</p>
      {children}
    </section>
  )
}

/**
 * One capability, as a name, a reading and a bar.
 *
 * `recorded === 0` takes the sentence branch. See this file's header: a zero
 * bar for a capability nobody has recorded is a measurement nobody took.
 */
function CapabilityLine({ row }: { row: CapabilityRow }): ReactElement {
  const label = useCapabilityLabel()
  return (
    <li className="home-row" data-empty={row.recorded === 0 ? '' : undefined}>
      <span className="home-row-name">{label(row.useCase)}</span>
      <span className="home-row-fig">
        {row.recorded === 0 ? (
          <span className="home-quiet">{t('home.capabilityUnrecorded')}</span>
        ) : (
          <span className="tabular">
            {t('home.capabilityOf', { live: row.live, recorded: row.recorded })}
          </span>
        )}
      </span>
      {row.recorded > 0 && (
        <span className="home-row-stack" aria-hidden="true">
          <Bar planned={row.planned} testing={row.testing} live={row.live} />
        </span>
      )}
    </li>
  )
}

/**
 * The three statuses as one stacked bar.
 *
 * ⚠ `aria-hidden`, ALWAYS. Every bar on this page sits beside text that already
 *   states the same numbers — "82 of 406 live". A screen reader that met both
 *   would hear the figure twice, and the second time as a row of meaningless
 *   percentages. The text is the accessible answer; this is decoration for the
 *   eye, and labelling it would make the page worse rather than better.
 */
function Bar({
  planned,
  testing,
  live,
}: {
  planned: number
  testing: number
  live: number
}): ReactElement {
  const total = planned + testing + live
  return (
    <span className="home-bar" aria-hidden="true">
      <span className="home-bar-seg" data-k="live" style={widthOf(live, total)} />
      <span className="home-bar-seg" data-k="testing" style={widthOf(testing, total)} />
      <span className="home-bar-seg" data-k="planned" style={widthOf(planned, total)} />
    </span>
  )
}

function Key(): ReactElement {
  return (
    <ul className="home-key">
      <li className="home-key-item" data-k="live">
        {t('home.live')}
      </li>
      <li className="home-key-item" data-k="testing">
        {t('home.testing')}
      </li>
      <li className="home-key-item" data-k="planned">
        {t('home.planned')}
      </li>
    </ul>
  )
}

/** `0/0` is 0, not NaN — an empty workspace must not paint a bar of `NaN%`. */
function pct(n: number, of: number): string {
  return of <= 0 ? '0%' : `${((n / of) * 100).toFixed(2)}%`
}

function widthOf(n: number, total: number): React.CSSProperties {
  return { inlineSize: pct(n, total) }
}
