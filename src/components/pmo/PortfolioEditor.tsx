// FILLING IN THE PMO PORTFOLIO FROM THE APP, INSTEAD OF FROM THE SQL EDITOR.
//
// ── WHY THIS EXISTS ───────────────────────────────────────────────────────
//
// 0031 created eight tables, `api/pmo.ts` gave each of them create/update/
// remove, and `Portfolio.tsx` drew four sections that could read every one of
// them — and there was no way to put a single row in any of them without
// opening a database console. A portfolio a director cannot edit is a portfolio
// somebody else keeps in a spreadsheet, and then the two disagree.
//
// So the forms go where the cards already are: an "add" control at the head of
// each section and an "edit" control on each row, on the same screen, in the
// same tab, with no second route to find the row in again. `components/map/
// NodeEditor.tsx` made this argument for organizations and this file is its
// shape, applied seven times.
//
// ── THE PERMISSION IS ABSENT, NOT DISABLED ────────────────────────────────
//
// 0031's header states the sentence this file obeys:
//
//   What the programme IS, is the Directors'. How it is GOING, is the team's.
//
//   `structure.edit`  projects, initiatives, revenue, objectives, key results
//   `capture.write`   actions and risks
//
// A reader without the key sees the section exactly as it was — facts, no
// controls — rather than a row of greyed-out buttons explaining a screen they
// will never use. Absence is honest; a disabled control is a promise.
//
// ⚠ DELETE IS `structure.edit` EVEN ON THE TWO FIELDWORK TABLES, and that is
//   0031's policy loop verbatim, not an oversight: "a member may raise a risk,
//   grade it, mitigate it and close it; removing the row so that nobody can see
//   it was ever raised is a different act, and it is the one the register
//   exists to prevent." So a member with `capture.write` gets Save on an action
//   and no Delete, which is exactly what the database would enforce anyway —
//   offering a button that RLS refuses would be a lie the client tells first.
//
// ── AN EMPTY BOX IS `null` ────────────────────────────────────────────────
//
// Every nullable column here goes through `lib/pmo/forms.ts`, whose header
// explains at length why `Number('') === 0` is the failure this whole schema
// was shaped to avoid. Nothing in this file coerces a blank into a number, and
// nothing drops a cleared field from the patch — dropping it means "do not
// touch", which is the opposite of what clearing it said.
//
// ── ONE SHELL, SEVEN FORMS ────────────────────────────────────────────────
//
// `api/pmo.ts` refused to write thirty-two near-identical functions and this
// file refuses to write seven near-identical components. What every form shares
// — the permission gate, the closed/open states, the unmount guard, the save,
// the delete, the toast, the invalidate — is `<Editor>`. What each form does
// DIFFERENTLY is its fields and its `build()`, stated once each and nowhere
// else.
//
// ── WHAT IS DELIBERATELY NOT HERE ─────────────────────────────────────────
//
//  · MILESTONES. `pmo_milestones` has no read surface on this page yet, and a
//    form for rows nobody can see is a write-only screen. It is the one table
//    of the eight this file leaves to SQL, and adding it is a section plus a
//    form rather than a change to anything below.
//  · CURRENCY. 0031 defaults it to 'SAR' on both money tables and the source
//    dashboard is a Saudi programme. A picker holding one option is a control
//    that cannot do anything; the day a second currency exists it is a field
//    here and a column already in the database.
//  · THE JIRA URL. It is computed from the key by `browseUrlFor()`, never
//    stored — 0031 is emphatic, and the form offers the key alone for the same
//    reason the table has one column and not two.

import { useEffect, useRef, useState, type ReactElement, type ReactNode } from 'react'
import { confirm } from '../Confirm'
import { toast } from '../toast'
import { t } from '../../lib/i18n'
import {
  blankToNull,
  dateValue,
  doneStamp,
  jiraPatch,
  jiraValue,
  parseNumber,
  parseRequiredNumber,
  trimmed,
} from '../../lib/pmo/forms'
import { useHasPerm } from '../../store/auth'
import { useMembers } from '../../store/members'
import { invalidatePmo, usePmo } from '../../store/pmo'
import * as pmoApi from '../../api/pmo'
import type { ApiResult } from '../../api/result'
import type {
  PmoAction,
  PmoInitiative,
  PmoKeyResult,
  PmoObjective,
  PmoProject,
  PmoRevenueLine,
  PmoRisk,
} from '../../types'
import {
  GRADES,
  GRADE_LABEL,
  INITIATIVE_STEPS,
  KINDS,
  KIND_LABEL,
  OBJECTIVE_STATUSES,
  PHASE_LABEL,
  PROJECT_STEPS,
  REGISTERS,
  REGISTER_LABEL,
  RISK_STATUSES,
  STATUS_LABEL,
} from './vocab'

/** Matches nothing in the database — 0031 sets no length cap — but a name that
 *  does not fit a card is a name nobody reads. The cards truncate at roughly
 *  this. */
const NAME_MAX = 120

/* ═══════════════════════════════ the shell ══════════════════════════════ */

/** The two keys 0031 splits this family on. No third one exists — see its §0. */
type PmoPerm = 'structure.edit' | 'capture.write'

/**
 * The slice of `api/pmo.ts`'s factory this file uses. Declared structurally
 * rather than imported, because `TableApi` is not exported and widening it to
 * export a type only this file names would be a second definition of the same
 * four verbs.
 */
interface PmoTable {
  create: (input: Record<string, unknown>) => Promise<ApiResult<unknown>>
  update: (id: string, input: Partial<Record<string, unknown>>) => Promise<ApiResult<unknown>>
  remove: (id: string) => Promise<ApiResult<void>>
}

/**
 * What a form's fields add up to — either the patch, or the KEY of the sentence
 * saying why not.
 *
 * ONE FUNCTION RATHER THAN `validate()` + `toInput()`. The two would read the
 * same fields twice and could disagree about which of them is empty; the parse
 * IS the validation here, because `lib/pmo/forms.ts` already answers "not a
 * number" and "nobody has said" as different things.
 */
type Built = { ok: true; input: Record<string, unknown> } | { ok: false; error: string }

interface EditorProps<F> {
  perm: PmoPerm
  /** `null` is the add control at the head of a section; an id is a row's own. */
  rowId: string | null
  /** What the add button says. Each section names its own object. */
  addLabel: string
  /** The blank form, or the row's current values. Read when the form opens. */
  initial: () => F
  build: (form: F) => Built
  api: PmoTable
  /** Named in the delete confirmation, so nobody removes the wrong row. */
  deleteName?: string
  fields: (form: F, set: (patch: Partial<F>) => void) => ReactNode
}

function Editor<F>({
  perm,
  rowId,
  addLabel,
  initial,
  build,
  api,
  deleteName,
  fields,
}: EditorProps<F>): ReactElement | null {
  const canWrite = useHasPerm(perm)
  // NOT `perm`. See this file's header: 0031 gates delete on `structure.edit`
  // for all eight tables, including the two a member may write.
  const canDelete = useHasPerm('structure.edit')

  const [form, setForm] = useState<F | null>(null)
  const [busy, setBusy] = useState(false)

  // The unmount guard every write path in this app carries: a request that
  // resolves after the section closed must not call setState on a dead tree.
  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])

  if (!canWrite) return null

  const close = (): void => setForm(null)

  const save = async (): Promise<void> => {
    if (form === null) return
    const built = build(form)
    if (!built.ok) {
      toast(t(built.error), { tone: 'error' })
      return
    }
    setBusy(true)
    const result =
      rowId === null ? await api.create(built.input) : await api.update(rowId, built.input)
    if (!alive.current) return
    setBusy(false)
    if (!result.ok) {
      // `result.error` is an i18n KEY from `pgErrorKey`, never a constraint
      // name — `api/pmo.ts`'s header refuses to put "pmo_revenue_project_id_
      // year_quarter_key" on a director's screen.
      toast(t(result.error), { tone: 'error' })
      return
    }
    close()
    void invalidatePmo()
    toast(t('common.saved'))
  }

  const remove = async (): Promise<void> => {
    if (rowId === null) return
    const ok = await confirm({
      title: t('pmo.deleteTitle', { name: deleteName ?? '' }),
      body: t('pmo.deleteBody'),
      confirmLabel: t('common.delete'),
      cancelLabel: t('common.cancel'),
      danger: true,
    })
    if (!ok || !alive.current) return
    setBusy(true)
    const result = await api.remove(rowId)
    if (!alive.current) return
    setBusy(false)
    if (!result.ok) {
      toast(t(result.error), { tone: 'error' })
      return
    }
    close()
    void invalidatePmo()
    toast(t('common.saved'))
  }

  if (form === null) {
    return (
      <div className="pmo-edit-row">
        <button type="button" className="btn btn-sm" onClick={() => setForm(initial())}>
          {rowId === null ? addLabel : t('common.edit')}
        </button>
      </div>
    )
  }

  const set = (patch: Partial<F>): void => setForm((f) => (f === null ? f : { ...f, ...patch }))

  return (
    <form
      className="pmo-form"
      onSubmit={(e) => {
        e.preventDefault()
        void save()
      }}
    >
      <div className="pmo-form-grid">{fields(form, set)}</div>
      <div className="pmo-form-actions">
        <button type="submit" className="btn btn-primary btn-sm" disabled={busy}>
          {t('common.save')}
        </button>
        <button type="button" className="btn btn-sm btn-ghost" onClick={close} disabled={busy}>
          {t('common.cancel')}
        </button>
        {/* Last, separated, and only for somebody who could actually carry it
            out. See the header on why this key is not `perm`. */}
        {rowId !== null && canDelete && (
          <button
            type="button"
            className="btn btn-sm btn-danger pmo-form-delete"
            onClick={() => void remove()}
            disabled={busy}
          >
            {t('common.delete')}
          </button>
        )}
      </div>
    </form>
  )
}

/* ══════════════════════════════ the fields ══════════════════════════════ */

function Text({
  label,
  value,
  onChange,
  ar = false,
  required = false,
  hint,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  ar?: boolean
  required?: boolean
  hint?: string
}): ReactElement {
  return (
    <label className="field pmo-field">
      <span className="field-label">{label}</span>
      <input
        className="input"
        value={value}
        maxLength={NAME_MAX}
        // The Arabic half of a bilingual pair types right-to-left whatever the
        // reader's own language is; `lang` is what a screen reader needs to
        // pronounce it.
        lang={ar ? 'ar' : undefined}
        dir={ar ? 'rtl' : undefined}
        required={required}
        onChange={(e) => onChange(e.target.value)}
      />
      {hint !== undefined && <small className="pmo-form-hint">{hint}</small>}
    </label>
  )
}

function Area({
  label,
  value,
  onChange,
  ar = false,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  ar?: boolean
}): ReactElement {
  return (
    <label className="field pmo-field pmo-field-wide">
      <span className="field-label">{label}</span>
      <textarea
        className="input"
        value={value}
        lang={ar ? 'ar' : undefined}
        dir={ar ? 'rtl' : undefined}
        rows={2}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  )
}

/**
 * A number box that is allowed to be empty.
 *
 * ⚠ NO `value={n ?? 0}` ANYWHERE. The form holds the raw string the reader
 *   typed and `lib/pmo/forms.ts` turns it into `null` at save time — which is
 *   the only shape in which "cleared this" survives the trip. The hint says so
 *   on the glass, because a blank box that means something is worth a sentence.
 */
function Num({
  label,
  value,
  onChange,
  hint,
  min,
  max,
  step,
  required = false,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  hint?: string
  min?: number
  max?: number
  step?: string
  required?: boolean
}): ReactElement {
  return (
    <label className="field pmo-field">
      <span className="field-label">{label}</span>
      <input
        className="input tabular"
        type="number"
        inputMode="decimal"
        value={value}
        min={min}
        max={max}
        step={step}
        required={required}
        onChange={(e) => onChange(e.target.value)}
      />
      {hint !== undefined && <small className="pmo-form-hint">{hint}</small>}
    </label>
  )
}

function DateBox({
  label,
  value,
  onChange,
  required = false,
  hint,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  required?: boolean
  hint?: string
}): ReactElement {
  return (
    <label className="field pmo-field">
      <span className="field-label">{label}</span>
      <input
        className="input"
        type="date"
        value={value}
        required={required}
        onChange={(e) => onChange(e.target.value)}
      />
      {hint !== undefined && <small className="pmo-form-hint">{hint}</small>}
    </label>
  )
}

interface Option {
  value: string
  label: string
}

/**
 * A closed choice. `none` present means the column is nullable and an empty
 * option is offered — which must map to `null` at save time and not be dropped,
 * or clearing a manager would silently do nothing (`NodeEditor.tsx` states the
 * same hazard about the same column family).
 */
function Pick({
  label,
  value,
  onChange,
  options,
  none,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  options: readonly Option[]
  none?: string
}): ReactElement {
  return (
    <label className="field pmo-field">
      <span className="field-label">{label}</span>
      <select className="select" value={value} onChange={(e) => onChange(e.target.value)}>
        {none !== undefined && <option value="">{none}</option>}
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  )
}

function Check({
  label,
  checked,
  onChange,
}: {
  label: string
  checked: boolean
  onChange: (v: boolean) => void
}): ReactElement {
  return (
    <label className="pmo-field pmo-check">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}</span>
    </label>
  )
}

/**
 * THE FIELD EVERY FORM IN THIS FILE CARRIES, and it is a requirement rather
 * than a convenience: the owner asked that everything in the portfolio be
 * referenceable from Jira, and 0031's probe 3 checks all eight tables can.
 *
 * Setting it moves `source` to 'jira'; clearing it moves `source` back to
 * 'local' AND nulls the key. Both halves together — see `jiraPatch`.
 */
function Jira({ value, onChange }: { value: string; onChange: (v: string) => void }): ReactElement {
  return (
    <label className="field pmo-field">
      <span className="field-label">{t('pmo.jiraKey')}</span>
      <input
        className="input"
        value={value}
        // The key is Latin whatever the reader's language is, and typing it into
        // an RTL paragraph without this puts the hyphen on the wrong side.
        dir="ltr"
        placeholder="NPH-123"
        onChange={(e) => onChange(e.target.value)}
      />
      <small className="pmo-form-hint">{t('pmo.jiraKeyHint')}</small>
    </label>
  )
}

/* ═════════════════════════════ shared options ═══════════════════════════ */

function useMemberOptions(): Option[] {
  return useMembers().map((m) => ({ value: m.id, label: m.displayName }))
}

/** Projects and initiatives, for the two tables that may hang off either. */
function useScopeOptions(): { projects: Option[]; initiatives: Option[] } {
  const data = usePmo()
  return {
    projects: (data?.projects ?? []).map((p) => ({ value: p.id, label: p.name })),
    initiatives: (data?.initiatives ?? []).map((i) => ({ value: i.id, label: i.name })),
  }
}

function labelOptions(
  keys: readonly string[],
  table: Readonly<Record<string, () => string>>,
): Option[] {
  return keys.map((k) => ({ value: k, label: table[k]() }))
}

/** The sentence every nullable box carries, said once. */
function blankHint(): string {
  return t('pmo.blankIsNobody')
}

/* ═══════════════════════════════ 1. projects ════════════════════════════ */

interface ProjectForm {
  name: string
  nameAr: string
  managerId: string
  budget: string
  startDate: string
  endDate: string
  phase: string
  actual: string
  planned: string
  note: string
  noteAr: string
  jira: string
}

function projectForm(row: PmoProject | null): ProjectForm {
  return {
    name: row?.name ?? '',
    nameAr: row?.name_ar ?? '',
    managerId: row?.manager_id ?? '',
    budget: row?.budget ?? '',
    startDate: dateValue(row?.start_date ?? null),
    endDate: dateValue(row?.end_date ?? null),
    phase: row?.phase ?? 'start',
    // `?? ''` AND NOT `?? 0`. Null is "nobody has said" and the box has to come
    // up empty, or opening the form on an unmeasured project and saving it
    // would invent a zero nobody typed.
    actual: row?.actual_pct === null || row?.actual_pct === undefined ? '' : String(row.actual_pct),
    planned:
      row?.planned_pct === null || row?.planned_pct === undefined ? '' : String(row.planned_pct),
    note: row?.note ?? '',
    noteAr: row?.note_ar ?? '',
    jira: jiraValue(row?.external_ref ?? null),
  }
}

function buildProject(f: ProjectForm): Built {
  const name = trimmed(f.name)
  if (name === '') return { ok: false, error: 'pmo.errName' }
  const budget = parseNumber(f.budget, { min: 0 })
  if (!budget.ok) return { ok: false, error: 'pmo.errMoney' }
  const actual = parseNumber(f.actual, { min: 0, max: 100, integer: true })
  const planned = parseNumber(f.planned, { min: 0, max: 100, integer: true })
  if (!actual.ok || !planned.ok) return { ok: false, error: 'pmo.errPct' }
  return {
    ok: true,
    input: {
      name,
      name_ar: trimmed(f.nameAr),
      manager_id: blankToNull(f.managerId),
      budget: budget.value,
      start_date: blankToNull(f.startDate),
      end_date: blankToNull(f.endDate),
      phase: f.phase,
      actual_pct: actual.value,
      planned_pct: planned.value,
      note: trimmed(f.note),
      note_ar: trimmed(f.noteAr),
      ...jiraPatch(f.jira),
    },
  }
}

export function ProjectEditor({ project }: { project?: PmoProject }): ReactElement | null {
  const managers = useMemberOptions()
  return (
    <Editor<ProjectForm>
      perm="structure.edit"
      rowId={project?.id ?? null}
      addLabel={t('pmo.addProject')}
      deleteName={project?.name}
      initial={() => projectForm(project ?? null)}
      build={buildProject}
      api={pmoApi.projects}
      fields={(f, set) => (
        <>
          <Text label={t('pmo.fieldName')} value={f.name} onChange={(v) => set({ name: v })} required />
          <Text label={t('pmo.fieldNameAr')} value={f.nameAr} onChange={(v) => set({ nameAr: v })} ar />
          <Pick
            label={t('pmo.manager')}
            value={f.managerId}
            onChange={(v) => set({ managerId: v })}
            options={managers}
            none={t('common.none')}
          />
          <Num
            label={t('pmo.budget')}
            value={f.budget}
            onChange={(v) => set({ budget: v })}
            min={0}
            step="0.01"
            hint={blankHint()}
          />
          <DateBox label={t('pmo.startDate')} value={f.startDate} onChange={(v) => set({ startDate: v })} />
          <DateBox label={t('pmo.endDate')} value={f.endDate} onChange={(v) => set({ endDate: v })} />
          <Pick
            label={t('pmo.phaseLabel')}
            value={f.phase}
            onChange={(v) => set({ phase: v })}
            options={labelOptions(PROJECT_STEPS, PHASE_LABEL)}
          />
          <Num
            label={t('pmo.actual')}
            value={f.actual}
            onChange={(v) => set({ actual: v })}
            min={0}
            max={100}
            step="1"
            hint={blankHint()}
          />
          <Num
            label={t('pmo.planned')}
            value={f.planned}
            onChange={(v) => set({ planned: v })}
            min={0}
            max={100}
            step="1"
            hint={blankHint()}
          />
          <Area label={t('pmo.noteTasks')} value={f.note} onChange={(v) => set({ note: v })} />
          <Area label={t('pmo.noteTasksAr')} value={f.noteAr} onChange={(v) => set({ noteAr: v })} ar />
          <Jira value={f.jira} onChange={(v) => set({ jira: v })} />
        </>
      )}
    />
  )
}

/* ══════════════════════════════ 2. initiatives ══════════════════════════ */

interface InitiativeForm {
  name: string
  nameAr: string
  managerId: string
  phase: string
  kind: string
  startDate: string
  endDate: string
  actual: string
  planned: string
  note: string
  noteAr: string
  jira: string
}

function initiativeForm(row: PmoInitiative | null): InitiativeForm {
  return {
    name: row?.name ?? '',
    nameAr: row?.name_ar ?? '',
    managerId: row?.manager_id ?? '',
    phase: row?.phase ?? 'planning',
    kind: row?.kind ?? 'internal',
    startDate: dateValue(row?.start_date ?? null),
    endDate: dateValue(row?.end_date ?? null),
    actual: row?.actual_pct === null || row?.actual_pct === undefined ? '' : String(row.actual_pct),
    planned:
      row?.planned_pct === null || row?.planned_pct === undefined ? '' : String(row.planned_pct),
    note: row?.note ?? '',
    noteAr: row?.note_ar ?? '',
    jira: jiraValue(row?.external_ref ?? null),
  }
}

function buildInitiative(f: InitiativeForm): Built {
  const name = trimmed(f.name)
  if (name === '') return { ok: false, error: 'pmo.errName' }
  const actual = parseNumber(f.actual, { min: 0, max: 100, integer: true })
  const planned = parseNumber(f.planned, { min: 0, max: 100, integer: true })
  if (!actual.ok || !planned.ok) return { ok: false, error: 'pmo.errPct' }
  return {
    ok: true,
    input: {
      name,
      name_ar: trimmed(f.nameAr),
      manager_id: blankToNull(f.managerId),
      phase: f.phase,
      kind: f.kind,
      start_date: blankToNull(f.startDate),
      end_date: blankToNull(f.endDate),
      actual_pct: actual.value,
      planned_pct: planned.value,
      note: trimmed(f.note),
      note_ar: trimmed(f.noteAr),
      ...jiraPatch(f.jira),
    },
  }
}

export function InitiativeEditor({
  initiative,
}: {
  initiative?: PmoInitiative
}): ReactElement | null {
  const managers = useMemberOptions()
  return (
    <Editor<InitiativeForm>
      perm="structure.edit"
      rowId={initiative?.id ?? null}
      addLabel={t('pmo.addInitiative')}
      deleteName={initiative?.name}
      initial={() => initiativeForm(initiative ?? null)}
      build={buildInitiative}
      api={pmoApi.initiatives}
      fields={(f, set) => (
        <>
          <Text label={t('pmo.fieldName')} value={f.name} onChange={(v) => set({ name: v })} required />
          <Text label={t('pmo.fieldNameAr')} value={f.nameAr} onChange={(v) => set({ nameAr: v })} ar />
          <Pick
            label={t('pmo.manager')}
            value={f.managerId}
            onChange={(v) => set({ managerId: v })}
            options={managers}
            none={t('common.none')}
          />
          {/* ⚠ THE INITIATIVE LADDER, NOT THE PROJECT ONE. They share three
              words and differ in the fourth, which is exactly the confusion
              0031 gave initiatives their own table to prevent. */}
          <Pick
            label={t('pmo.phaseLabel')}
            value={f.phase}
            onChange={(v) => set({ phase: v })}
            options={labelOptions(INITIATIVE_STEPS, PHASE_LABEL)}
          />
          <Pick
            label={t('pmo.kindLabel')}
            value={f.kind}
            onChange={(v) => set({ kind: v })}
            options={labelOptions(KINDS, KIND_LABEL)}
          />
          <DateBox label={t('pmo.startDate')} value={f.startDate} onChange={(v) => set({ startDate: v })} />
          <DateBox label={t('pmo.endDate')} value={f.endDate} onChange={(v) => set({ endDate: v })} />
          <Num
            label={t('pmo.actual')}
            value={f.actual}
            onChange={(v) => set({ actual: v })}
            min={0}
            max={100}
            step="1"
            hint={blankHint()}
          />
          <Num
            label={t('pmo.planned')}
            value={f.planned}
            onChange={(v) => set({ planned: v })}
            min={0}
            max={100}
            step="1"
            hint={blankHint()}
          />
          <Area label={t('pmo.noteGoal')} value={f.note} onChange={(v) => set({ note: v })} />
          <Area label={t('pmo.noteGoalAr')} value={f.noteAr} onChange={(v) => set({ noteAr: v })} ar />
          <Jira value={f.jira} onChange={(v) => set({ jira: v })} />
        </>
      )}
    />
  )
}

/* ════════════════════════════════ 3. actions ════════════════════════════ */

interface ActionForm {
  title: string
  detail: string
  ownerId: string
  owner2Id: string
  projectId: string
  initiativeId: string
  dueDate: string
  done: boolean
  /** The stamp the row arrived with, so re-saving a closed action keeps it. */
  doneAt: string | null
  jira: string
}

function actionForm(row: PmoAction | null): ActionForm {
  return {
    title: row?.title ?? '',
    detail: row?.detail ?? '',
    ownerId: row?.owner_id ?? '',
    owner2Id: row?.owner2_id ?? '',
    projectId: row?.project_id ?? '',
    initiativeId: row?.initiative_id ?? '',
    dueDate: dateValue(row?.due_date ?? null),
    done: (row?.done_at ?? null) !== null,
    doneAt: row?.done_at ?? null,
    jira: jiraValue(row?.external_ref ?? null),
  }
}

function buildAction(f: ActionForm, now: string): Built {
  const title = trimmed(f.title)
  if (title === '') return { ok: false, error: 'pmo.errTitle' }
  return {
    ok: true,
    input: {
      title,
      detail: trimmed(f.detail),
      owner_id: blankToNull(f.ownerId),
      owner2_id: blankToNull(f.owner2Id),
      project_id: blankToNull(f.projectId),
      initiative_id: blankToNull(f.initiativeId),
      due_date: blankToNull(f.dueDate),
      done_at: doneStamp(f.done, f.doneAt, now),
      ...jiraPatch(f.jira),
    },
  }
}

export function ActionEditor({ action }: { action?: PmoAction }): ReactElement | null {
  const members = useMemberOptions()
  const scope = useScopeOptions()
  return (
    <Editor<ActionForm>
      // ⚠ `capture.write`, NOT `structure.edit`. 0031: "day-to-day fieldwork,
      //   the register a huddle edits live".
      perm="capture.write"
      rowId={action?.id ?? null}
      addLabel={t('pmo.addAction')}
      deleteName={action?.title}
      initial={() => actionForm(action ?? null)}
      build={(f) => buildAction(f, new Date().toISOString())}
      api={pmoApi.actions}
      fields={(f, set) => (
        <>
          <Text label={t('pmo.fieldTitle')} value={f.title} onChange={(v) => set({ title: v })} required />
          <Area label={t('pmo.detail')} value={f.detail} onChange={(v) => set({ detail: v })} />
          <Pick
            label={t('pmo.colOwner')}
            value={f.ownerId}
            onChange={(v) => set({ ownerId: v })}
            options={members}
            none={t('common.none')}
          />
          {/* TWO OWNERS, NAMED SEPARATELY — 0031's shape, not an array. */}
          <Pick
            label={t('pmo.owner2')}
            value={f.owner2Id}
            onChange={(v) => set({ owner2Id: v })}
            options={members}
            none={t('common.none')}
          />
          <Pick
            label={t('pmo.colProject')}
            value={f.projectId}
            onChange={(v) => set({ projectId: v })}
            options={scope.projects}
            none={t('common.none')}
          />
          <Pick
            label={t('pmo.initiativeOne')}
            value={f.initiativeId}
            onChange={(v) => set({ initiativeId: v })}
            options={scope.initiatives}
            none={t('common.none')}
          />
          <DateBox
            label={t('pmo.colDue')}
            value={f.dueDate}
            onChange={(v) => set({ dueDate: v })}
            hint={blankHint()}
          />
          <Check label={t('pmo.markDone')} checked={f.done} onChange={(v) => set({ done: v })} />
          <Jira value={f.jira} onChange={(v) => set({ jira: v })} />
        </>
      )}
    />
  )
}

/* ══════════════════════════ 4. risks and challenges ═════════════════════ */

interface RiskForm {
  register: string
  projectId: string
  initiativeId: string
  summary: string
  level: string
  impact: string
  mitigation: string
  status: string
  jira: string
}

function riskForm(row: PmoRisk | null): RiskForm {
  return {
    register: row?.register ?? 'risk',
    projectId: row?.project_id ?? '',
    initiativeId: row?.initiative_id ?? '',
    summary: row?.summary ?? '',
    level: row?.level ?? '',
    impact: row?.impact ?? '',
    mitigation: row?.mitigation ?? '',
    status: row?.status ?? 'open',
    jira: jiraValue(row?.external_ref ?? null),
  }
}

function buildRisk(f: RiskForm): Built {
  const summary = trimmed(f.summary)
  if (summary === '') return { ok: false, error: 'pmo.errSummary' }
  return {
    ok: true,
    input: {
      register: f.register,
      project_id: blankToNull(f.projectId),
      initiative_id: blankToNull(f.initiativeId),
      summary,
      // UNGRADED IS A REAL STATE ON A FRESH REGISTER — 0031. An empty select
      // is null, never 'low'.
      level: blankToNull(f.level),
      impact: blankToNull(f.impact),
      mitigation: trimmed(f.mitigation),
      status: f.status,
      ...jiraPatch(f.jira),
    },
  }
}

export function RiskEditor({ risk }: { risk?: PmoRisk }): ReactElement | null {
  const scope = useScopeOptions()
  return (
    <Editor<RiskForm>
      perm="capture.write"
      rowId={risk?.id ?? null}
      addLabel={t('pmo.addRisk')}
      deleteName={risk?.summary}
      initial={() => riskForm(risk ?? null)}
      build={buildRisk}
      api={pmoApi.risks}
      fields={(f, set) => (
        <>
          <Pick
            label={t('pmo.registerLabel')}
            value={f.register}
            onChange={(v) => set({ register: v })}
            options={labelOptions(REGISTERS, REGISTER_LABEL)}
          />
          <Text
            label={t('pmo.summaryLabel')}
            value={f.summary}
            onChange={(v) => set({ summary: v })}
            required
          />
          <Pick
            label={t('pmo.colProject')}
            value={f.projectId}
            onChange={(v) => set({ projectId: v })}
            options={scope.projects}
            none={t('common.none')}
          />
          <Pick
            label={t('pmo.initiativeOne')}
            value={f.initiativeId}
            onChange={(v) => set({ initiativeId: v })}
            options={scope.initiatives}
            none={t('common.none')}
          />
          <Pick
            label={t('pmo.level')}
            value={f.level}
            onChange={(v) => set({ level: v })}
            options={labelOptions(GRADES, GRADE_LABEL)}
            none={t('pmo.notGraded')}
          />
          <Pick
            label={t('pmo.impact')}
            value={f.impact}
            onChange={(v) => set({ impact: v })}
            options={labelOptions(GRADES, GRADE_LABEL)}
            none={t('pmo.notGraded')}
          />
          <Area
            label={t('pmo.mitigation')}
            value={f.mitigation}
            onChange={(v) => set({ mitigation: v })}
          />
          <Pick
            label={t('pmo.colStatus')}
            value={f.status}
            onChange={(v) => set({ status: v })}
            options={labelOptions(RISK_STATUSES, STATUS_LABEL)}
          />
          <Jira value={f.jira} onChange={(v) => set({ jira: v })} />
        </>
      )}
    />
  )
}

/* ═══════════════════════════════ 5. revenue ═════════════════════════════ */

interface RevenueForm {
  projectId: string
  year: string
  quarter: string
  planned: string
  achieved: string
  jira: string
}

function revenueForm(row: PmoRevenueLine | null, defaultYear: number): RevenueForm {
  return {
    projectId: row?.project_id ?? '',
    year: row === null ? String(defaultYear) : String(row.year),
    quarter: row === null ? '1' : String(row.quarter),
    planned: row?.planned ?? '',
    achieved: row?.achieved ?? '',
    jira: jiraValue(row?.external_ref ?? null),
  }
}

function buildRevenue(f: RevenueForm): Built {
  const projectId = blankToNull(f.projectId)
  // NOT NULL in 0031 — revenue with no project cannot be summed into anything.
  if (projectId === null) return { ok: false, error: 'pmo.errProject' }
  const year = parseRequiredNumber(f.year, { min: 2000, max: 2100, integer: true })
  if (!year.ok) return { ok: false, error: 'pmo.errYear' }
  const quarter = parseRequiredNumber(f.quarter, { min: 1, max: 4, integer: true })
  if (!quarter.ok) return { ok: false, error: 'pmo.errQuarter' }
  const planned = parseNumber(f.planned, { min: 0 })
  const achieved = parseNumber(f.achieved, { min: 0 })
  if (!planned.ok || !achieved.ok) return { ok: false, error: 'pmo.errMoney' }
  return {
    ok: true,
    input: {
      project_id: projectId,
      year: year.value,
      quarter: quarter.value,
      planned: planned.value,
      // ⚠ AN UNREPORTED QUARTER IS null, NOT ZERO. 0031: "different from a
      //   quarter that earned nothing", and `Portfolio.tsx` prints "Nobody has
      //   said" for it rather than a 0 in the Achieved column.
      achieved: achieved.value,
      ...jiraPatch(f.jira),
    },
  }
}

/**
 * Q1..Q4, built AT RENDER TIME rather than at module scope.
 *
 * `t()` reads the current locale when it is called; a `const` array of four
 * translated labels is fixed to whichever language the module happened to be
 * imported in, and would still say "Q1" after the reader switches to Arabic.
 */
function quarterOptions(): Option[] {
  return [1, 2, 3, 4].map((n) => ({ value: String(n), label: t('pmo.quarter', { n }) }))
}

export function RevenueEditor({
  line,
  projects,
  defaultYear,
}: {
  line?: PmoRevenueLine
  projects: readonly Option[]
  defaultYear: number
}): ReactElement | null {
  return (
    <Editor<RevenueForm>
      perm="structure.edit"
      rowId={line?.id ?? null}
      addLabel={t('pmo.addRevenue')}
      deleteName={projects.find((p) => p.value === line?.project_id)?.label}
      initial={() => revenueForm(line ?? null, defaultYear)}
      build={buildRevenue}
      api={pmoApi.revenue}
      fields={(f, set) => (
        <>
          <Pick
            label={t('pmo.colProject')}
            value={f.projectId}
            onChange={(v) => set({ projectId: v })}
            options={projects}
            none={t('common.none')}
          />
          <Num
            label={t('pmo.year')}
            value={f.year}
            onChange={(v) => set({ year: v })}
            min={2000}
            max={2100}
            step="1"
            required
          />
          <Pick
            label={t('pmo.quarterLabel')}
            value={f.quarter}
            onChange={(v) => set({ quarter: v })}
            options={quarterOptions()}
          />
          <Num
            label={t('pmo.planned')}
            value={f.planned}
            onChange={(v) => set({ planned: v })}
            min={0}
            step="0.01"
            hint={blankHint()}
          />
          <Num
            label={t('pmo.achieved')}
            value={f.achieved}
            onChange={(v) => set({ achieved: v })}
            min={0}
            step="0.01"
            hint={blankHint()}
          />
          <Jira value={f.jira} onChange={(v) => set({ jira: v })} />
        </>
      )}
    />
  )
}

/* ═════════════════════════════ 6. objectives ════════════════════════════ */

interface ObjectiveForm {
  name: string
  nameAr: string
  ownerId: string
  period: string
  status: string
  jira: string
}

function objectiveForm(row: PmoObjective | null): ObjectiveForm {
  return {
    name: row?.name ?? '',
    nameAr: row?.name_ar ?? '',
    ownerId: row?.owner_id ?? '',
    period: row?.period ?? '',
    status: row?.status ?? 'active',
    jira: jiraValue(row?.external_ref ?? null),
  }
}

function buildObjective(f: ObjectiveForm): Built {
  const name = trimmed(f.name)
  if (name === '') return { ok: false, error: 'pmo.errName' }
  return {
    ok: true,
    input: {
      name,
      name_ar: trimmed(f.nameAr),
      owner_id: blankToNull(f.ownerId),
      // FREE TEXT, and `''` rather than null: 0031 declares it NOT NULL
      // DEFAULT '' because "every organization names its own periods".
      period: trimmed(f.period),
      status: f.status,
      ...jiraPatch(f.jira),
    },
  }
}

export function ObjectiveEditor({ objective }: { objective?: PmoObjective }): ReactElement | null {
  const members = useMemberOptions()
  return (
    <Editor<ObjectiveForm>
      perm="structure.edit"
      rowId={objective?.id ?? null}
      addLabel={t('pmo.addObjective')}
      deleteName={objective?.name}
      initial={() => objectiveForm(objective ?? null)}
      build={buildObjective}
      api={pmoApi.objectives}
      fields={(f, set) => (
        <>
          <Text label={t('pmo.fieldName')} value={f.name} onChange={(v) => set({ name: v })} required />
          <Text label={t('pmo.fieldNameAr')} value={f.nameAr} onChange={(v) => set({ nameAr: v })} ar />
          <Pick
            label={t('pmo.colOwner')}
            value={f.ownerId}
            onChange={(v) => set({ ownerId: v })}
            options={members}
            none={t('common.none')}
          />
          <Text
            label={t('pmo.period')}
            value={f.period}
            onChange={(v) => set({ period: v })}
            hint={t('pmo.periodHint')}
          />
          <Pick
            label={t('pmo.colStatus')}
            value={f.status}
            onChange={(v) => set({ status: v })}
            options={labelOptions(OBJECTIVE_STATUSES, STATUS_LABEL)}
          />
          <Jira value={f.jira} onChange={(v) => set({ jira: v })} />
        </>
      )}
    />
  )
}

/* ════════════════════════════ 7. key results ════════════════════════════ */

interface KeyResultForm {
  name: string
  nameAr: string
  start: string
  target: string
  current: string
  unit: string
  jira: string
}

function keyResultForm(row: PmoKeyResult | null): KeyResultForm {
  return {
    name: row?.name ?? '',
    nameAr: row?.name_ar ?? '',
    start: row?.start_value ?? '0',
    target: row?.target_value ?? '',
    current: row?.current_value ?? '',
    unit: row?.unit ?? '',
    jira: jiraValue(row?.external_ref ?? null),
  }
}

function buildKeyResult(f: KeyResultForm, objectiveId: string): Built {
  const name = trimmed(f.name)
  if (name === '') return { ok: false, error: 'pmo.errName' }
  // NOT NULL in 0031, both of them: "a key result without a number to reach is
  // an objective wearing the wrong hat".
  const start = parseRequiredNumber(f.start)
  const target = parseRequiredNumber(f.target)
  if (!start.ok || !target.ok) return { ok: false, error: 'pmo.errMeasure' }
  // `pmo_key_results_measurable`, checked here so the reader gets a sentence
  // instead of a constraint violation: a target equal to the start is a measure
  // that cannot move, and every percentage derived from it divides by zero.
  if (start.value === target.value) return { ok: false, error: 'pmo.errTarget' }
  // ⚠ AND `current_value` STAYS NULLABLE. Null is "nobody has checked in", and
  //   the roll-up view counts it as 0 progress WITHOUT pretending a reading was
  //   taken. Typing a zero here is a different claim.
  const current = parseNumber(f.current)
  if (!current.ok) return { ok: false, error: 'pmo.errNumber' }
  return {
    ok: true,
    input: {
      objective_id: objectiveId,
      name,
      name_ar: trimmed(f.nameAr),
      start_value: start.value,
      target_value: target.value,
      current_value: current.value,
      unit: trimmed(f.unit),
      ...jiraPatch(f.jira),
    },
  }
}

export function KeyResultEditor({
  objectiveId,
  keyResult,
}: {
  objectiveId: string
  keyResult?: PmoKeyResult
}): ReactElement | null {
  return (
    <Editor<KeyResultForm>
      perm="structure.edit"
      rowId={keyResult?.id ?? null}
      addLabel={t('pmo.addKeyResult')}
      deleteName={keyResult?.name}
      initial={() => keyResultForm(keyResult ?? null)}
      build={(f) => buildKeyResult(f, objectiveId)}
      api={pmoApi.keyResults}
      fields={(f, set) => (
        <>
          <Text label={t('pmo.fieldName')} value={f.name} onChange={(v) => set({ name: v })} required />
          <Text label={t('pmo.fieldNameAr')} value={f.nameAr} onChange={(v) => set({ nameAr: v })} ar />
          <Num
            label={t('pmo.startValue')}
            value={f.start}
            onChange={(v) => set({ start: v })}
            step="0.01"
            required
            hint={t('pmo.startValueHint')}
          />
          <Num
            label={t('pmo.targetValue')}
            value={f.target}
            onChange={(v) => set({ target: v })}
            step="0.01"
            required
          />
          <Num
            label={t('pmo.currentValue')}
            value={f.current}
            onChange={(v) => set({ current: v })}
            step="0.01"
            hint={blankHint()}
          />
          <Text label={t('pmo.unit')} value={f.unit} onChange={(v) => set({ unit: v })} />
          <Jira value={f.jira} onChange={(v) => set({ jira: v })} />
        </>
      )}
    />
  )
}

/* ─────────────────────────── exported for tests ─────────────────────────── */

// The seven `build()` functions are the whole of this file's arithmetic and are
// pure. They are exported so `PortfolioEditor.test.tsx` can assert the null rule
// directly — a node test environment has no DOM and cannot type into a box, so
// asserting it through the component is not available.
export const builders = {
  project: buildProject,
  initiative: buildInitiative,
  action: buildAction,
  risk: buildRisk,
  revenue: buildRevenue,
  objective: buildObjective,
  keyResult: buildKeyResult,
}

export const blanks = {
  project: (): ProjectForm => projectForm(null),
  initiative: (): InitiativeForm => initiativeForm(null),
  action: (): ActionForm => actionForm(null),
  risk: (): RiskForm => riskForm(null),
  revenue: (year: number): RevenueForm => revenueForm(null, year),
  objective: (): ObjectiveForm => objectiveForm(null),
  keyResult: (): KeyResultForm => keyResultForm(null),
}
