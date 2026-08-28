// The COC queue — OPERATING-MODEL §11.7, and the first write path in this
// product that somebody would use every day.
//
// ── WHY THIS SCREEN EXISTS AND NOT ANOTHER READING OF THE SAME ROWS ───────
//
// The diagnosis behind the whole exercise: the product has eight ways to look
// at data and almost no way to change any of it. `setNodeUseCase` shipped with
// zero call sites, and "nobody has ever hand-edited anything" was a consequence
// of that rather than a habit. §11.7 picks COC as the first daily write path
// for one reason worth restating — **the person who needs it is the person
// asking for it.** COC is the one rung this office works.
//
// ── FOUR FIELDS, ALL CONFIRMED WITH THE OWNER ─────────────────────────────
//
//   coc_submitted_on  the day the evidence went to CHI — without it the age of
//                     the wait is unknowable, and the age is the entire reason
//                     to chase
//   coc_contact       the named person at CHI holding it — this is what turns
//                     "waiting on CHI" into "waiting on a person"
//   coc_reference     CHI's own reference, so a follow-up can quote it and a
//                     signed certificate can be matched back to this exact pair
//   coc_signed_on     the day it came back signed
//
// ⚠ `coc_contact` IS A NAME AND NOTHING ELSE — no email, no phone. Checked by
//   `cocContactProblem` BEFORE the save, so the refusal arrives while the
//   person is still looking at what they typed. The rule is not squeamishness:
//   this workspace holds no staff emails by design and its privacy page is
//   written from what the schema actually contains, so a person OUTSIDE the
//   organization is a higher bar, not a lower one.
//
// ── THERE IS NO PERMISSION GATE HERE, AND THAT IS DELIBERATE ──────────────
//
// `map_node_use_cases` is MEMBER-WRITE by design — 0024 asserts it positively
// in probe 3 precisely because a reviewer would "fix" it to match every other
// table, and its own comment says gating it would "turn the one admin into the
// data-entry bottleneck for the data his interns collect". So every member sees
// the form. Adding a stricter gate in the client than RLS enforces would be a
// lie the client tells first — `PortfolioEditor.tsx`'s phrase, applied the
// other way round.
//
// ── THE CHASE THREAD IS NOT HERE, AND NOT BECAUSE IT WAS FORGOTTEN ────────
//
// §11.7 wants a short line per chase — *"chased 12 Aug, promised this week"* —
// and is explicit that it must NOT become a fifth column: `entry_updates` is
// already an append-only, authored, timestamped trail, and `coc_notes` would be
// a second thread implementation whose entries could not be attributed. That
// needs a work item per pair to hang the thread on, which this table does not
// have yet. Recorded in docs/NEXT.md rather than half-built here.

import { useEffect, useRef, useState, type ReactElement } from 'react'
import { toast } from '../toast'
import { t, useLocale } from '../../lib/i18n'
import { formatDate } from '../../lib/dates'
import { blankToNull, dateValue, trimmed } from '../../lib/pmo/forms'
import { cocContactProblem, type CocEntry, type CocQueue } from '../../lib/pmo/cocQueue'
import { applyPortfolioLink } from '../../store/portfolio'
import { setUseCaseCoc } from '../../api/map'

interface Props {
  queue: CocQueue
  /**
   * A capability's displayed name, by id — the page owns the label rules.
   *
   * NAMED `labelOf`, NOT `useCaseNameOf`: `use` plus a capital is oxlint's Hook
   * heuristic, so the obvious name is a `react/rules-of-hooks` ERROR the moment
   * it is called inside the row map. `ObStrips` takes the same prop under the
   * same name, and `obMonitor.test.ts` hit the same wall naming a fixture.
   */
  labelOf: (id: string) => string
  /** An account manager's name, or null when nobody holds the organization. */
  managerNameOf: (id: string | null) => string | null
}

export function CocQueueSection({ queue, labelOf, managerNameOf }: Props): ReactElement {
  if (queue.entries.length === 0) {
    return (
      <div className="pmo-coc-queue">
        {/* ⚠ TRUE TODAY, AND THE SCREEN SAYS SO RATHER THAN LOOKING BROKEN. All
            nothing has reached COC yet — 1,029 of the 1,540 pairs are at
            intake, 300 at STG/TEST and 211 at PROD, and NONE at COC — so this
            queue is empty on the day it ships. An empty worklist that explains
            itself is honest; a blank panel reads as a bug and gets reported as
            one.

            ⚠ THOSE NUMBERS ARE A MEASUREMENT, NOT AN ASSUMPTION, and they
            replace a wrong one: an earlier note here said the whole estate was
            at intake, which came from reading three rows and generalising. The
            distribution above was counted with an exact count per rung. */}
        <p className="mbr-note">{t('pmo.cocQueueEmpty')}</p>
      </div>
    )
  }

  return (
    <div className="pmo-coc-queue">
      <p className="mbr-note">
        {t('pmo.cocQueueCounts', {
          waiting: queue.waiting,
          unsubmitted: queue.unsubmitted,
          signed: queue.signed,
        })}
      </p>
      {/* The one number this office would put in front of CHI. Absent rather
          than zero when nothing has been submitted — see `oldestWait`. */}
      {queue.oldestWait !== null && (
        <p className="mbr-note pmo-coc-oldest">{t('pmo.cocOldest', { count: queue.oldestWait })}</p>
      )}
      {queue.untraceable > 0 && (
        <p className="mbr-note pmo-coc-warn">{t('pmo.cocUntraceable', { count: queue.untraceable })}</p>
      )}
      <ul className="pmo-coc-list">
        {queue.entries.map((entry) => (
          <CocRow
            key={`${entry.nodeId}:${entry.useCaseId}`}
            entry={entry}
            useCaseName={labelOf(entry.useCaseId)}
            managerName={managerNameOf(entry.managerId)}
          />
        ))}
      </ul>
    </div>
  )
}

interface Form {
  submittedOn: string
  contact: string
  reference: string
  signedOn: string
}

function formOf(entry: CocEntry): Form {
  return {
    submittedOn: dateValue(entry.submittedOn),
    contact: entry.contact,
    reference: entry.reference,
    signedOn: dateValue(entry.signedOn),
  }
}

function CocRow({
  entry,
  useCaseName,
  managerName,
}: {
  entry: CocEntry
  useCaseName: string
  managerName: string | null
}): ReactElement {
  const locale = useLocale()
  const [form, setForm] = useState<Form | null>(null)
  const [busy, setBusy] = useState(false)

  // The unmount guard every write path in this app carries: a request that
  // resolves after the row closed must not call setState on a dead tree.
  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])

  const save = async (): Promise<void> => {
    if (form === null) return

    const problem = cocContactProblem(form.contact)
    if (problem !== null) {
      // Refused here rather than by the database, because no constraint says
      // this — it is a rule about what this workspace keeps, and the person
      // needs to hear it while they are still looking at what they typed.
      toast(t(problem === 'email' ? 'pmo.cocContactEmail' : 'pmo.cocContactPhone'), { tone: 'error' })
      return
    }

    setBusy(true)
    // EVERY FIELD IS SENT, INCLUDING THE CLEARED ONES. `lib/pmo/forms.ts`'s
    // rule: omitting a key means "do not touch", which is the opposite of what
    // clearing the box said, and it is how a wrong CHI reference outlives its
    // correction.
    const result = await setUseCaseCoc(entry.nodeId, entry.useCaseId, {
      coc_submitted_on: blankToNull(form.submittedOn),
      coc_contact: trimmed(form.contact),
      coc_reference: trimmed(form.reference),
      coc_signed_on: blankToNull(form.signedOn),
    })
    if (!alive.current) return
    setBusy(false)

    if (!result.ok) {
      // An i18n KEY from `pgErrorKey`, never a raw Postgres string.
      toast(t(result.error), { tone: 'error' })
      return
    }
    if (result.data === null) {
      // The pair matched nothing: somebody moved it off COC while this form was
      // open. That is not an error to apologise for — it is news.
      toast(t('pmo.cocGone'), { tone: 'error' })
      setForm(null)
      return
    }
    // The row the DATABASE returned, never the form's own idea of it: 0035
    // computes `overrides` in the trigger and the touch trigger owns
    // `updated_at`, so a client-assembled row would put values in the store
    // that no table holds.
    applyPortfolioLink(result.data)
    setForm(null)
    toast(t('common.saved'))
  }

  const set = (patch: Partial<Form>): void => setForm((f) => (f === null ? f : { ...f, ...patch }))

  return (
    <li className="pmo-coc-row" data-state={entry.state}>
      <div className="pmo-coc-head">
        <span className="pmo-coc-org">{entry.nodeName}</span>
        <span className="pmo-coc-case">{useCaseName}</span>
        <CocAge entry={entry} />
      </div>
      <p className="pmo-coc-meta">
        {/* The named person is the point of the field, so it is the line's own
            sentence rather than a column somebody has to go looking for. */}
        {entry.contact.trim() === '' ? (
          <span className="muted">{t('pmo.cocNoContact')}</span>
        ) : (
          <span>{t('pmo.cocWith', { name: entry.contact })}</span>
        )}
        {entry.reference.trim() !== '' && <span className="pmo-coc-ref">{entry.reference}</span>}
        {entry.signedOn !== null && (
          <span className="pmo-coc-signed">
            {t('pmo.cocSignedOn', { date: formatDate(entry.signedOn, locale) })}
          </span>
        )}
        {managerName !== null && <span className="muted">{managerName}</span>}
      </p>

      {form === null ? (
        <div className="pmo-edit-row">
          <button type="button" className="btn btn-sm" onClick={() => setForm(formOf(entry))}>
            {t('pmo.cocRecord')}
          </button>
        </div>
      ) : (
        <form
          className="pmo-form"
          onSubmit={(e) => {
            e.preventDefault()
            void save()
          }}
        >
          <div className="pmo-form-grid">
            <label className="field pmo-field">
              <span className="field-label">{t('pmo.cocSubmittedOn')}</span>
              <input
                className="input"
                type="date"
                value={form.submittedOn}
                onChange={(e) => set({ submittedOn: e.target.value })}
              />
            </label>
            <label className="field pmo-field">
              <span className="field-label">{t('pmo.cocContact')}</span>
              <input
                className="input"
                value={form.contact}
                maxLength={80}
                onChange={(e) => set({ contact: e.target.value })}
              />
              <small className="pmo-form-hint">{t('pmo.cocContactHint')}</small>
            </label>
            <label className="field pmo-field">
              <span className="field-label">{t('pmo.cocReference')}</span>
              <input
                className="input"
                value={form.reference}
                maxLength={80}
                onChange={(e) => set({ reference: e.target.value })}
              />
            </label>
            <label className="field pmo-field">
              <span className="field-label">{t('pmo.cocSignedOnField')}</span>
              <input
                className="input"
                type="date"
                value={form.signedOn}
                onChange={(e) => set({ signedOn: e.target.value })}
              />
              <small className="pmo-form-hint">{t('pmo.cocSignedHint')}</small>
            </label>
          </div>
          <div className="pmo-form-actions">
            <button type="submit" className="btn btn-primary btn-sm" disabled={busy}>
              {t('common.save')}
            </button>
            <button
              type="button"
              className="btn btn-sm btn-ghost"
              onClick={() => setForm(null)}
              disabled={busy}
            >
              {t('common.cancel')}
            </button>
          </div>
        </form>
      )}
    </li>
  )
}

/**
 * The age, or the reason there is not one.
 *
 * ⚠ A PAIR WITH NO SUBMISSION DATE PRINTS A SENTENCE, NOT "0 days". Zero days
 *   would read as "submitted this morning" when it means "nobody has started".
 *   The same refusal `obMonitor` makes about the rung clock, for the same
 *   reason, one screen over.
 */
function CocAge({ entry }: { entry: CocEntry }): ReactElement {
  if (entry.state === 'signed') return <span className="pmo-coc-age">{t('pmo.cocStateSigned')}</span>
  if (entry.waitingDays === null) {
    return <span className="pmo-coc-age muted">{t('pmo.cocStateUnsubmitted')}</span>
  }
  return <span className="pmo-coc-age">{t('pmo.cocWaiting', { count: entry.waitingDays })}</span>
}
