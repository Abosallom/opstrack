// Settings › Terminology — take the wording out, bring a wording pass back.
//
// WHAT THIS IS FOR. The row editor above it is the right tool for renaming three
// things. Going through the app's whole vocabulary is a different job: it is done
// sitting down, offline, over more than one evening, and it is done in a text
// editor because that is where a person can see fifty strings at once. This
// component is the two ends of that trip — a file out, a file back — and the
// second one is the dangerous direction, so almost everything below is about it.
//
// THE PROMISE IT KEEPS. A file the owner loads either applies COMPLETELY or does
// nothing at all. lib/labelIO.ts decides that (its `planLabelImport` returns an
// empty apply list the moment anything is rejected, so this component could not
// half-apply a file even by forgetting to check), and what is left here is the
// part a person needs: say what would happen, say what is wrong with the file and
// WHICH line, and put a number in front of them before anything changes.
//
// NOTHING IS WRITTEN WITHOUT TWO DELIBERATE ACTS. Picking a file only reads and
// reports it; the second tap opens a confirmation that names how many labels
// change. That is not ceremony — this one control can reword every screen in the
// product for everyone at once, and the file was written in another application
// where nothing checked it.
//
// THE DOM AND THE CLOCK LIVE HERE, and nothing else does. The envelope, the
// ordering, the parsing, the validation and the diff are all in lib/labelIO.ts,
// where vitest's `node` environment can reach them. What is left in this file is
// a file picker, an anchor, `new Date()` and the state machine between them —
// the same split lib/export.ts and pages/settings/Export.tsx made, for the same
// reason.
//
// EVERY STRING GOES THROUGH t(), INCLUDING THE ONES ABOUT OVERRIDES. This screen
// is not special-cased: `terminology.importApply` is overridable like any other
// key, so an admin can rename the button that loads the file that renames the
// buttons. That is deliberate — the spec says the page's own labels are
// overridable — and it is survivable because Reset all overrides exists.

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ChangeEvent,
  type ReactElement,
} from 'react'
import { confirm } from '../Confirm'
import { toast } from '../toast'
import { shippedNode, t, useLocale } from '../../lib/i18n'
import { overrideErrorText } from '../../lib/labelErrors'
import {
  LABEL_FILE_MAX_BYTES,
  buildLabelFile,
  labelFileMimeType,
  labelFileName,
  planLabelImport,
  serializeLabelFile,
  type LabelImportPlan,
  type LabelImportRejection,
} from '../../lib/labelIO'
import {
  importOverrides,
  invalidateLabels,
  useLabelOverrideCount,
  useLabelOverrides,
} from '../../store/labels'
import './labelio.css'

/**
 * Rejections rendered before the list stops and counts the rest.
 *
 * A real wording pass gets a handful wrong; a file that is not a wording pass at
 * all can produce one rejection per line, and thirty thousand list items on a
 * phone is a hung tab rather than a report. The lead sentence above the list
 * always carries the TRUE total, and `importRejectedMore` says how many are not
 * shown — the point of the list is to let someone start fixing, not to be a
 * complete transcript of a file they are about to rewrite anyway.
 */
const MAX_SHOWN = 25

/**
 * The whole state, as a union rather than four booleans.
 *
 * Every combination a boolean soup would admit — reading AND ready, applying
 * AND failed — is a bug, and the file name has to survive from the pick to the
 * report to the toast, so it rides along rather than sitting in its own slot
 * that can go stale.
 */
type IOState =
  | { kind: 'idle' }
  | { kind: 'reading'; name: string }
  | { kind: 'ready'; name: string; plan: LabelImportPlan }
  | { kind: 'applying'; name: string; plan: LabelImportPlan }
  /**
   * Nothing was written. `errorKey` is a `t()` key, resolved at render.
   *
   * `stage` decides what is said around it. A file that could not be READ has
   * already explained itself — `errImportParse` is a whole sentence — while a
   * write that failed needs the sentence that says nothing changed, with the
   * api layer's reason under it.
   */
  | { kind: 'failed'; name: string; errorKey: string; stage: 'read' | 'apply' }

export interface LabelIOProps {
  /**
   * Turn both actions off — the page passes true when `label_overrides` is not
   * installed or the reader is not an admin.
   *
   * A disabled control that says why beats a section that vanishes: the owner
   * who came here to download the wording needs to be told the table is missing,
   * not shown a screen with a hole where the feature was.
   */
  readonly disabled?: boolean
}

/**
 * Hand the browser a file.
 *
 * The same nine lines as `download()` in pages/settings/Export.tsx, and the
 * reasons are that file's: `appendChild` before the click because Firefox
 * ignores a synthetic click on a detached anchor, and a deferred revoke because
 * Safari has aborted downloads that revoked the object URL in the click's own
 * tick. It is duplicated rather than shared because the only honest home for a
 * shared copy is a new `lib/download.ts`, which means editing a shipped page in
 * a feature branch to use it; recorded in the handoff as a dedupe candidate.
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

/** `en` / `ar` under the same names the row editor gives its two boxes. */
function fieldLabel(locale: 'en' | 'ar' | null): string {
  return locale === 'ar' ? t('terminology.fieldAr') : t('terminology.fieldEn')
}

/**
 * One rejection, as a line somebody can act on.
 *
 * The KEY is rendered even though it is a dot path and not a sentence: it is
 * what the owner searches for in the file they are about to fix, and the row
 * editor's search box takes it too. The reason comes from lib/labelOverrides.ts
 * as a `t()` key with its variables, so "you dropped {name}" is resolved HERE
 * and is therefore in the right language after a switch.
 */
function Rejection({ item }: { item: LabelImportRejection }): ReactElement {
  return (
    <li className="lio-reject">
      <p className="lio-reject-head">
        <code className="lio-key">{item.key}</code>
        {item.locale !== null && <span className="lio-lang">{fieldLabel(item.locale)}</span>}
      </p>
      {/* Through the same helper the row editor uses, so a rejected line and a
          refused keystroke say the same sentence — including the plural form's
          NAME rather than its CLDR identifier. */}
      <p className="lio-why">{overrideErrorText(item.error, item.vars)}</p>
    </li>
  )
}

export default function LabelIO({ disabled = false }: LabelIOProps): ReactElement {
  // t() is a plain function; without this the section keeps yesterday's wording
  // after a language switch or after somebody renames one of its own labels.
  useLocale()
  const rows = useLabelOverrides()
  const count = useLabelOverrideCount()
  const [state, setState] = useState<IOState>({ kind: 'idle' })
  const titleId = useId()
  // Names the scrollable rejection list. A focusable region with no accessible
  // name is announced as a bare "list", which tells a screen-reader user
  // nothing about why their Tab landed in it.
  const leadId = useId()

  // A file read and a write are both awaited, and this section can be unmounted
  // by a route change under either. Export.tsx carries the same guard.
  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])

  const busy = state.kind === 'reading' || state.kind === 'applying'

  const onExport = useCallback((): void => {
    const at = new Date()
    const name = labelFileName(at)
    try {
      const file = buildLabelFile(rows, {
        exportedAt: at.toISOString(),
        appVersion: __APP_VERSION__,
      })
      download(serializeLabelFile(file), name, labelFileMimeType())
      toast(t('terminology.exportDone', { name }), { tone: 'success' })
    } catch {
      // A blocked object URL, a full disk, a browser that refused the anchor.
      // Nothing was changed either way, so this is a message and not a state.
      toast(t('terminology.errExport'), { tone: 'error' })
    }
  }, [rows])

  const onPick = useCallback(
    async (event: ChangeEvent<HTMLInputElement>): Promise<void> => {
      const file = event.target.files?.[0]
      // Cleared IMMEDIATELY, and it is not housekeeping: without it the input
      // holds the same file it just read, and picking that file again — after
      // fixing it in the editor, which is the normal way this screen is used —
      // fires no change event at all. The control would look broken.
      event.target.value = ''
      if (!file) return

      const fail = (errorKey: string): void => {
        if (alive.current) setState({ kind: 'failed', name: file.name, errorKey, stage: 'read' })
      }

      // Checked before the read, not after: the point is not to pull 400 MB
      // into a string on a phone and then decide against it.
      if (file.size > LABEL_FILE_MAX_BYTES) {
        fail('terminology.errImportParse')
        return
      }

      setState({ kind: 'reading', name: file.name })
      let source: string
      try {
        source = await file.text()
      } catch {
        fail('terminology.errImportParse')
        return
      }
      if (!alive.current) return

      // `shippedNode` is the lookup; `rows` is what is stored right now, so the
      // plan can report what would actually CHANGE rather than how many lines
      // the file happens to have.
      const result = planLabelImport(source, shippedNode, rows)
      if (!result.ok) {
        fail(result.error)
        return
      }
      setState({ kind: 'ready', name: file.name, plan: result.plan })
    },
    [rows],
  )

  const onApply = useCallback(async (): Promise<void> => {
    if (state.kind !== 'ready') return
    const { name, plan } = state
    if (plan.apply.length === 0) return

    // The last thing between a file written somewhere else and every screen in
    // the product. It names the NUMBER, because "apply this file" is not a fact
    // anyone can weigh and "43 labels change for everyone" is.
    const go = await confirm({
      title: t('terminology.importConfirmTitle'),
      body: t('terminology.importConfirmBody', { count: plan.apply.length }),
      confirmLabel: t('terminology.importApply'),
      cancelLabel: t('common.cancel'),
    })
    if (!go || !alive.current) return

    setState({ kind: 'applying', name, plan })
    const result = await importOverrides(plan.apply)
    if (!alive.current) return
    if (!result.ok) {
      // api/labels.ts's `upsertOverrides` is TWO statements and PostgREST has no
      // transaction across them, so a file that both clears and sets keys can
      // fail with the clears already done. `terminology.errImport` says nothing
      // was changed, which is true for every file that only sets keys and
      // overstates it for the other kind; the refetch is what makes the SCREEN
      // honest either way, and the handoff records the RPC that would make the
      // sentence honest too.
      invalidateLabels()
      setState({ kind: 'failed', name, errorKey: result.error, stage: 'apply' })
      return
    }
    // The count the owner confirmed, not the row count the write reported: a
    // pass that RESETS keys deletes rows, and `importOverrides` resolves with
    // the rows it wrote, so a reset-only file would report "0 changes applied"
    // after changing everything the owner asked it to.
    toast(t('terminology.importDone', { count: plan.apply.length }), { tone: 'success' })
    setState({ kind: 'idle' })
  }, [state])

  // Narrowed once, so the report below can read `report.name` as well as
  // `report.plan` without the two arms of the union being spelled out twice.
  const report = state.kind === 'ready' || state.kind === 'applying' ? state : null
  const blocked = report !== null && report.plan.rejected.length > 0

  return (
    <section className="card lio" aria-labelledby={titleId}>
      <div className="lio-intro">
        <h2 className="lio-title" id={titleId}>
          {t('terminology.ioTitle')}
        </h2>
        <p className="lio-hint">{t('terminology.ioHint')}</p>
      </div>

      <div className="lio-actions">
        <button
          type="button"
          className="btn"
          disabled={disabled || busy || count === 0}
          onClick={onExport}
        >
          {t('terminology.exportAction')}
        </button>

        {/* A real <label> around a real file input, rather than a button that
            clicks a hidden one: the label IS the input's accessible name, the
            keyboard reaches the input itself, and there is no synthetic click to
            be swallowed by a browser that dislikes them. The input is .sr-only
            (clipped, still focusable) — never display:none, which would take it
            out of the tab order entirely — and the label carries the focus ring
            through :focus-within. */}
        <label className="btn lio-pick" aria-disabled={disabled || busy}>
          <span>{t('terminology.importAction')}</span>
          <input
            className="sr-only"
            type="file"
            accept="application/json,.json"
            disabled={disabled || busy}
            onChange={(event) => void onPick(event)}
          />
        </label>
      </div>

      {count === 0 && <p className="lio-note">{t('terminology.exportEmpty')}</p>}

      {/* ONE polite live region for the whole report. The user's own tap put it
          there, so it must not interrupt — and nesting an alert inside it for the
          rejections would announce the same block twice. */}
      <div className="lio-report" role="status" aria-live="polite">
        {state.kind === 'reading' && <p className="lio-note">{t('terminology.loading')}</p>}

        {report !== null && (
          <>
            <p className="lio-file">{report.name}</p>
            <p className="lio-count">
              {t('terminology.importPreview', { count: report.plan.total })}
            </p>

            {report.plan.skipped.length > 0 && (
              <p className="lio-note">
                {t('terminology.importSkipped', { count: report.plan.skipped.length })}
              </p>
            )}

            {blocked && (
              <div className="lio-rejects">
                <p className="lio-rejects-lead" id={leadId}>
                  {t('terminology.importRejected', { count: report.plan.rejected.length })}
                </p>
                {/* Scrollable, and focusable so it can be scrolled without a
                    pointer — a keyboard user must be able to read the rest of a
                    list that does not fit. */}
                <ul className="lio-reject-list" tabIndex={0} aria-labelledby={leadId}>
                  {report.plan.rejected.slice(0, MAX_SHOWN).map((item) => (
                    <Rejection item={item} key={`${item.key}:${item.locale ?? 'row'}`} />
                  ))}
                </ul>
                {report.plan.rejected.length > MAX_SHOWN && (
                  <p className="lio-note">
                    {t('terminology.importRejectedMore', {
                      count: report.plan.rejected.length - MAX_SHOWN,
                    })}
                  </p>
                )}
              </div>
            )}

            {/* No Apply button at all while anything is rejected. The plan's
                apply list is empty in that state anyway (lib/labelIO.ts makes
                all-or-nothing structural); this is the same fact said in the
                one place the owner is looking. */}
            {!blocked && report.plan.apply.length === 0 && (
              <p className="lio-note">{t('terminology.importNoChange')}</p>
            )}

            {!blocked && report.plan.apply.length > 0 && (
              <button
                type="button"
                className="btn btn-primary"
                disabled={disabled || busy}
                onClick={() => void onApply()}
              >
                {state.kind === 'applying'
                  ? t('terminology.importApplying')
                  : t('terminology.importApply')}
              </button>
            )}
          </>
        )}

        {state.kind === 'failed' && (
          <div className="lio-failed">
            <p className="lio-file">{state.name}</p>
            {/* A file that could not be READ has already explained itself in one
                sentence. A WRITE that failed needs the sentence that says
                nothing changed, with the api layer's reason under it — resolved
                here rather than where it was raised, so it is in the right
                language after a switch. */}
            {state.stage === 'apply' && (
              <p className="lio-failed-main">{t('terminology.errImport')}</p>
            )}
            <p className={state.stage === 'apply' ? 'muted' : 'lio-failed-main'}>
              {t(state.errorKey)}
            </p>
          </div>
        )}
      </div>
    </section>
  )
}
