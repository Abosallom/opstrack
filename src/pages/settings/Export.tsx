// Export (/settings/export) — take the workspace away in one tap.
//
// TWO BUTTONS AND A PROGRESS LINE. Everything interesting is in lib/export.ts,
// which is pure and tested; this file is the three things that module must not
// contain — the Supabase reads, React state, and the Blob download. The seam is
// `ExportPageReader`: a closure over the client that lib/export.ts calls once
// per page and never has to know about.
//
// WHY THE READS ARE HERE AND NOT IN api/. Two reasons, and the first is
// ownership: `src/api/**` belongs to no one this wave and the extension-slot
// rule (EXECUTION-PLAN §1.0.4) says a worker short an api function records the
// gap rather than editing another's file. The second is that there is no api
// function to write. Every existing loader in `api/` returns a TYPED domain
// object — `Entry[]`, `Meeting[]` — because a screen renders fields. An export
// wants the opposite: whatever columns the table has today, untyped and
// unmapped, so a column added next month lands in the file without a code
// change. A `listEverythingRaw()` in api/ would be a function with exactly one
// caller and no type to return. The handoff note offers it to the integrator as
// a move, if they would rather have the boundary.
//
// NOT ADMIN-GATED, DELIBERATELY. Every other screen under /settings/ is, and
// this one is not, because the thing being protected is already protected: RLS
// decides what SELECT returns, and it returns a member's own notifications and
// nobody else's. Gating the button would withhold from a member a copy of data
// the app already shows them on five other screens, which is theatre rather
// than a control. The row on the Settings page is wired accordingly — see the
// handoff note; the integrator can move it inside the admin block if the
// workspace owner disagrees, and nothing here changes.

import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react'
import { Link } from 'react-router-dom'
import { IconArrowStart, IconColumns, IconDatabase } from '../../components/icons'
import { toast } from '../../components/toast'
import { isConfigured, supabase } from '../../api/supabase'
import { t, useLocale } from '../../lib/i18n'
import { useTrackLabel } from '../../lib/labels'
import { pgErrorKey } from '../../lib/pgError'
import {
  EXPORT_TABLES,
  bundleEntries,
  buildEnvelope,
  collectExport,
  entriesCsv,
  exportFilename,
  exportMimeType,
  serializeExport,
  type EntryCsvContext,
  type ExportPageReader,
  type ExportProgress,
  type ExportTableKey,
  type ExportTableSpec,
} from '../../lib/export'
import { loadConfig, useTrackMap } from '../../store/config'
import { loadMembers, useMemberMap } from '../../store/members'
import './export.css'

/** Which file the user asked for. */
type ExportFormat = 'json' | 'csv'

/**
 * The screen's whole state.
 *
 * A discriminated union rather than five independent booleans, because the
 * combinations that a boolean soup admits — running AND done, error AND
 * running — are all bugs, and the ones it forbids are all real.
 */
type PageState =
  | { kind: 'idle' }
  | { kind: 'running'; format: ExportFormat; progress: ExportProgress }
  | {
      kind: 'done'
      format: ExportFormat
      filename: string
      rows: number
      truncated: readonly ExportTableKey[]
    }
  /** Nothing was saved. `format` is kept so Retry can repeat the same request. */
  | { kind: 'error'; format: ExportFormat; errorKey: string }
  /** A CSV was asked for and there is nothing to put in it. */
  | { kind: 'empty' }

/** The CSV reads one relation; the JSON reads all of them. */
const ENTRIES_ONLY: readonly ExportTableSpec[] = EXPORT_TABLES.filter((s) => s.key === 'entries')

/**
 * Hand the browser a file.
 *
 * `document.body.appendChild` before the click is not superstition — Firefox
 * ignores a synthetic click on an anchor that is not in the document. The
 * revoke is deferred to the next task because Safari has aborted downloads that
 * revoked their object URL in the same tick as the click.
 *
 * A DOM call, which is why it lives in this file and not in lib/export.ts:
 * vitest's `node` environment has no `document`, and a module that touched one
 * could not carry the CSV escaping tests.
 */
function download(text: string, filename: string, mime: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: mime }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.rel = 'noopener'
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 0)
}

/**
 * One page of one relation, straight off PostgREST.
 *
 * `select('*')` on purpose: this is the one read in the app that must NOT name
 * its columns. A narrow selector is right everywhere a screen renders fields —
 * it is the difference between a 2 KB row and a 40 KB one — and it is wrong
 * here, where the contract is "everything this table holds" and a column added
 * by a future migration has to appear in the file without anyone remembering to
 * add it.
 *
 * The order clauses come from the spec and are applied in sequence, which is
 * what makes the paging below total; see ExportTableSpec.order.
 */
const readPage: ExportPageReader = async (spec, offset, limit) => {
  // The nullable-client guard every read in this app opens with. A build with
  // no credentials degrades to a readable message rather than a stack trace.
  if (!supabase) return { ok: false, error: 'common.notConfigured' }
  let query = supabase.from(spec.table).select('*')
  for (const clause of spec.order) {
    query = query.order(clause.column, { ascending: clause.ascending })
  }
  const { data, error } = await query.range(offset, offset + limit - 1)
  if (error) return { ok: false, error: pgErrorKey(error) }
  return { ok: true, data: data ?? [] }
}

export default function Export(): ReactElement {
  const locale = useLocale()
  const configured = isConfigured()
  const trackMap = useTrackMap()
  const memberMap = useMemberMap()
  const trackLabel = useTrackLabel()

  const [state, setState] = useState<PageState>({ kind: 'idle' })

  // The two stores that fill the CSV's name columns. Both loaders are
  // idempotent and no-op when the data is already warm — the Shell warms them
  // on mount, and this is the belt for a deep link straight to /settings/export.
  useEffect(() => {
    if (!configured) return
    void loadConfig()
    void loadMembers()
  }, [configured])

  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])

  /**
   * The two denormalised name columns of the CSV.
   *
   * BOTH FALL BACK TO EMPTY, not to a translated word. `useMemberLabel()` ends
   * at `t('entry.unassigned')`, which is exactly right on a screen and wrong in
   * a data column: it would make the file's contents depend on the UI language,
   * and it would turn "no owner" into a value that a spreadsheet filter cannot
   * tell from a person actually called that. A blank cell is what a spreadsheet
   * means by "none", and the `owner_id` / `owner_name` columns beside it carry
   * the raw truth either way.
   */
  const csvContext = useCallback(
    (): EntryCsvContext => ({
      trackName: (trackId) => {
        const track = trackId ? trackMap.get(trackId) : undefined
        return track ? trackLabel(track) : ''
      },
      personName: (ownerId, ownerName) => {
        const named = ownerId ? memberMap.get(ownerId)?.displayName.trim() : ''
        return named || (ownerName?.trim() ?? '')
      },
    }),
    [memberMap, trackLabel, trackMap],
  )

  const run = useCallback(
    async (format: ExportFormat) => {
      setState({
        kind: 'running',
        format,
        progress: { completed: 0, total: 0, table: null, rows: 0 },
      })

      const specs = format === 'csv' ? ENTRIES_ONLY : EXPORT_TABLES
      const result = await collectExport(
        readPage,
        (progress) => {
          // Guarded: a progress tick that lands after the user navigated away
          // would set state on an unmounted component. The read itself keeps
          // going and is then discarded, which is the right trade for a
          // sequence of GETs with no side effects.
          if (alive.current) setState({ kind: 'running', format, progress })
        },
        specs,
      )
      if (!alive.current) return

      if (!result.ok) {
        setState({ kind: 'error', format, errorKey: result.error })
        return
      }

      const now = new Date()
      const filename = exportFilename(format, now)

      if (format === 'csv') {
        const entries = bundleEntries(result.data)
        // A header-only CSV is a legal file and a confusing one. Say so instead.
        if (entries.length === 0) {
          setState({ kind: 'empty' })
          return
        }
        download(entriesCsv(entries, csvContext()), filename, exportMimeType('csv'))
      } else {
        const envelope = buildEnvelope(result.data, {
          exportedAt: now.toISOString(),
          locale,
          appVersion: __APP_VERSION__,
        })
        download(serializeExport(envelope), filename, exportMimeType('json'))
      }

      setState({
        kind: 'done',
        format,
        filename,
        rows: result.data.rows,
        truncated: result.data.truncated,
      })
      // The card below says the same thing, and it can be below the fold on a
      // phone — and on iOS the download itself is silent. One line of
      // confirmation where the thumb already is.
      toast(t('export.downloaded', { name: filename }))
    },
    [csvContext, locale],
  )

  const running = state.kind === 'running'
  const busy = (format: ExportFormat): boolean => running && state.format === format

  return (
    <div className="exp">
      <div className="exp-bar">
        <Link to="/settings" className="btn btn-ghost btn-sm">
          {/* A back arrow points at the reading start, so it mirrors in Arabic. */}
          <IconArrowStart className="icon-directional" size={16} />
          {t('common.back')}
        </Link>
      </div>

      {/* No <h1>: App.tsx's header already renders this route's title as the
          document heading, and a second copy is noise in the outline. */}
      <div className="exp-intro">
        <p className="exp-lead">{t('export.subtitle')}</p>
        <p className="exp-note">{t('export.scope')}</p>
        <p className="exp-note">{t('export.fresh')}</p>
      </div>

      {!configured && (
        <div className="card exp-error" role="status">
          <p>{t('common.notConfigured')}</p>
        </div>
      )}

      <section className="card exp-card" aria-labelledby="exp-json-h">
        <div className="exp-card-head">
          <span className="exp-card-icon" aria-hidden="true">
            <IconDatabase size={18} />
          </span>
          <div className="exp-card-text">
            <h2 className="exp-card-title" id="exp-json-h">
              {t('export.jsonTitle')}
            </h2>
            <p className="exp-card-desc">{t('export.jsonHint')}</p>
          </div>
        </div>

        <h3 className="exp-tables-title">{t('export.includes')}</h3>
        {/* A list, not a paragraph of comma-separated names: the relation labels
            are bilingual and a comma between two of them is a neutral that the
            UBA resolves to the paragraph. Chips sidestep the question. */}
        <ul className="exp-tables">
          {EXPORT_TABLES.map((spec) => (
            <li className="chip" key={spec.key}>
              {t(`export.table.${spec.key}`)}
            </li>
          ))}
        </ul>

        <button
          type="button"
          className="btn btn-primary"
          disabled={!configured || running}
          onClick={() => void run('json')}
        >
          {busy('json') ? t('export.preparing') : t('export.jsonAction')}
        </button>
      </section>

      <section className="card exp-card" aria-labelledby="exp-csv-h">
        <div className="exp-card-head">
          <span className="exp-card-icon" aria-hidden="true">
            <IconColumns size={18} />
          </span>
          <div className="exp-card-text">
            <h2 className="exp-card-title" id="exp-csv-h">
              {t('export.csvTitle')}
            </h2>
            <p className="exp-card-desc">{t('export.csvHint')}</p>
          </div>
        </div>

        <p className="exp-caveat">{t('export.csvCaveats')}</p>

        <button
          type="button"
          className="btn"
          disabled={!configured || running}
          onClick={() => void run('csv')}
        >
          {busy('csv') ? t('export.preparing') : t('export.csvAction')}
        </button>
      </section>

      {/* Polite, and the ONLY live region on the page: it follows the user's own
          deliberate tap, and an assertive one would interrupt the screen reader
          mid-sentence on every page of a nine-relation read. */}
      {running && (
        <div className="card exp-progress" role="status" aria-live="polite">
          {/* Decorative. The two lines under it are the accessible progress;
              a role="progressbar" here would announce the same fact twice. */}
          <div className="exp-progress-track" aria-hidden="true">
            <div
              className="exp-progress-fill"
              style={{
                inlineSize:
                  state.progress.total > 0
                    ? `${Math.round((state.progress.completed / state.progress.total) * 100)}%`
                    : '0%',
              }}
            />
          </div>
          <p className="exp-progress-line">
            {state.progress.table
              ? t('export.reading', { label: t(`export.table.${state.progress.table}`) })
              : t('export.preparing')}
          </p>
          {/* Its own line rather than joined to the one above with a separator:
              a middle dot between an Arabic clause and a Latin-digit count is a
              neutral, and it lands on whichever side the paragraph decides. */}
          <p className="exp-progress-count">{t('export.rowsSoFar', { count: state.progress.rows })}</p>
        </div>
      )}

      {state.kind === 'done' && (
        <div className="card exp-result" role="status">
          <p className="exp-result-main">{t('export.done', { count: state.rows })}</p>
          <p className="exp-result-file">{t('export.downloaded', { name: state.filename })}</p>
          {state.truncated.length > 0 && (
            <div className="exp-warn">
              <p className="exp-warn-title">{t('export.truncatedTitle')}</p>
              <p>
                {t('export.truncatedBody', {
                  // Intl, not a hardcoded ', ' — Arabic joins a list with U+060C
                  // and the word و, and neither is a separator this file should
                  // be spelling out. The locale string fences the whole result.
                  list: new Intl.ListFormat(locale, { type: 'conjunction' }).format(
                    state.truncated.map((key) => t(`export.table.${key}`)),
                  ),
                })}
              </p>
            </div>
          )}
        </div>
      )}

      {state.kind === 'empty' && (
        <div className="card exp-result" role="status">
          <p className="exp-result-main">{t('export.noEntries')}</p>
        </div>
      )}

      {state.kind === 'error' && (
        <div className="card exp-error" role="alert">
          <p className="exp-error-main">{t('export.failed')}</p>
          {/* The api layer's key, resolved here rather than where it was raised,
              so it is in the right language after a locale switch. */}
          <p className="muted">{t(state.errorKey)}</p>
          <button type="button" className="btn btn-sm" onClick={() => void run(state.format)}>
            {t('common.retry')}
          </button>
        </div>
      )}
    </div>
  )
}
