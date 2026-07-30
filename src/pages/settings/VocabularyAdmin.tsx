// Vocabulary admin (/settings/vocabulary) — the workspace's own words for the
// three frozen kinds: statuses, priorities and types.
//
// WHAT AN ADMIN CAN DO HERE, and nothing else: rename in both languages,
// recolour, reorder, hide, reset — plus, on priority rows, the two day counts
// (`stale_after_days` and the DEFAULT `sla_days`). THERE IS NO ADD AND NO
// REMOVE, and that is the feature rather than a missing one: `entries.status`
// stores the KEY, so a merged option would silently rewrite finished work with
// no undo. api/config.ts refuses to offer the verbs and `FROZEN_KEYS` is what an
// audit checks this file against.
//
// RENAMING COSTS ZERO WRITES TO ENTRY DATA. Every screen resolves a label at
// render through store/vocab, so renaming `waiting_on` to "Awaiting vendor"
// re-labels the whole history — including the transition rows in an update
// thread — without touching a single entry row. That is the Wave-2 gate (g).
//
// READS api/config DIRECTLY, like TracksAdmin: this screen is the only one that
// needs the RAW override strings (store/vocab hands out RESOLVED labels, which
// is the opposite of what an editor needs) and it must see its own writes on the
// next paint. Every mutation still calls invalidateVocab() so the rest of the
// app re-reads on its next render.
//
// THE PREVIEW NEVER RE-IMPLEMENTS THE RESOLUTION ORDER. It calls store/vocab's
// own vocabLabel() with a SYNTHETIC snapshot built from the row being edited, so
// what this screen shows and what a status pill will show come out of one
// function. That matters most for the rule people get wrong: a blank Arabic
// label falls through to the built-in Arabic, NEVER to the English override, and
// the preview demonstrates that rather than describing it.
//
// THE LAST-VISIBLE GUARD IS NOT PRE-EMPTED CLIENT-SIDE. Hiding the final visible
// option of a kind raises 23514/`last_visible_option`, which pgErrorKey() maps
// to vocabadmin.errLastVisible. Checking it here first would test a snapshot
// another admin can invalidate between the read and the write, and would put the
// rule in two places. The button always tries; the row shows the server's answer.
//
// THE POST-SAVE EFFECT REPORT is why the two day counts are worth a screen at
// all. Every other edit here shows its own result — a renamed pill is renamed on
// screen — but changing a threshold silently reclassifies work that is nowhere
// in view. So a save that touches `stale_after_days` or `sla_days` measures
// `v_entry_health` either side of the write and reports the delta:
// "Open entries now quiet: 12 (was 8) · past their deadline: 3 (was 0)". The
// label:value shape rather than a sentence is deliberate — t() has no plural
// machinery, and "1 open entries are now quiet" is the kind of copy defect that
// only ever shows up in front of the person who set the threshold to 1.
// Honest caveat: the view is computed live against now(), and another session
// may write between the two reads, so the report describes the workspace a
// moment ago versus now — it is not a proof of causation. The window is one
// round trip, and the alternative (a number nobody sees until tomorrow's digest)
// is worse.
//
// ARMING AN SLA IS A DELIBERATE MOMENT. `sla_days` ships NULL on all four
// priorities (0005 / WAVE1-ADDENDUM §2.2) precisely so nothing is retroactively
// "breached" against a target nobody set. Turning one on is therefore the single
// edit on this screen with a retroactive reach, so it gets inline copy saying
// what it does and a confirmation that says it again with the number in it.
// Clearing it back to empty needs no ceremony: it turns measurement off, and no
// item was ever written to.
//
// SLA RESOLUTION ORDER, stated on screen in one sentence and again here:
// `track_slas` row → `vocab_options.sla_days` (this screen) → no deadline
// (WAVE2-NOTES / migration 0006). The per-track half lives in the track editors,
// and this screen links to them rather than growing a second copy of the control.

import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { IconArrowStart, IconChevronEnd } from '../../components/icons'
import { Skeleton } from '../../components/shared'
import { confirm } from '../../components/Confirm'
import { toast } from '../../components/toast'
import { listVocab, reorderVocab, resetVocab, updateVocab, type VocabPatch } from '../../api/config'
import { listHealth } from '../../api/entries'
import { rovingTabIndex, useRadioGroupKeys } from '../../lib/radioGroup'
import { vocabVars } from '../../lib/vocabStyle'
import { t, useLocale } from '../../lib/i18n'
import {
  DEFAULT_STALE_DAYS,
  FROZEN_KEYS,
  invalidateVocab,
  vocabLabel,
  type VocabSnapshot,
} from '../../store/vocab'
import { useAuth } from '../../store/auth'
import type { VocabKind, VocabRow } from '../../types'
import './vocab.css'

/** The three kinds, in the order they are edited — also the render order. */
const KINDS: readonly VocabKind[] = ['status', 'priority', 'type']

const KIND_TITLE: Readonly<Record<VocabKind, string>> = {
  status: 'vocabadmin.kindStatus',
  priority: 'vocabadmin.kindPriority',
  type: 'vocabadmin.kindType',
}

const KIND_HINT: Readonly<Record<VocabKind, string>> = {
  status: 'vocabadmin.kindStatusHint',
  priority: 'vocabadmin.kindPriorityHint',
  type: 'vocabadmin.kindTypeHint',
}

/** Mirrors 0003's CHECK constraints. The server is still the authority. */
const HEX = /^#[0-9a-fA-F]{6}$/
const LABEL_MAX = 40
const STALE_MIN = 1
const STALE_MAX = 365
const SLA_MIN = 1
const SLA_MAX = 3650

/**
 * A snapshot with no rows at all: vocabLabel() then lands on the built-in
 * wording for whichever locale it is handed, which is exactly what the two label
 * placeholders have to show. Reusing the store's resolver rather than reading
 * the locale bundles here keeps ONE implementation of the resolution order.
 */
const EMPTY_SNAPSHOT: VocabSnapshot = { rows: [], loadedAt: null }

/**
 * The colour presets, as SINGLE hexes — one value serving both themes, which is
 * the shape `vocab_options.color` has and lib/vocabStyle.ts's stated design: a
 * status pill derives its ink AND its 18% fill from one custom property, so
 * there is no light/dark pair to store.
 *
 * That constraint has a measurable ceiling, and these values sit on it. A colour
 * readable on the dark theme's worst surface (#212932) has to be light; one
 * readable on the light theme's worst surface (#e9edf1) has to be dark; the best
 * any single hex can do against BOTH is ~3.5:1, at a relative luminance of about
 * 0.20. Each hex below was solved for that optimum within its own hue and
 * measures 3.51–3.56:1 on each theme's worst surface — past the 3:1 WCAG 1.4.11
 * asks of a meaningful non-text graphic, short of the 4.5:1 small text wants.
 *
 * RESOLVED IN W5, AND NOT BY MOVING THESE HEXES — the ceiling above is real and
 * no single hex clears it. The pill stopped asking one hex to be both the mark
 * and the ink: the hue still fills and outlines the badge at full strength (a
 * graphic, 3:1, which these clear), and the INK is now `--vocab-ink` in
 * global.css — this hex mixed 35% into the theme's own --text, so the theme
 * dictates luminance and the admin dictates hue. Measured in Chrome on all
 * three elevations in both themes: 9.56–11.25:1 for the eight presets, worst
 * case 4.70:1 for ANY hex the free field accepts. Read that block before
 * touching either half. "Default colour" stays the first option and the seeded
 * state; it now means --text-dim rather than "the only safe choice".
 *
 * `labelKey` is not decoration. These are icon-only controls, so the accessible
 * name is the ONLY name, and a screen reader spells a hex out one character at a
 * time — which names nothing an admin can act on, in either language.
 */
const SWATCHES: readonly { hex: string | null; labelKey: string }[] = [
  { hex: null, labelKey: 'vocabadmin.colorDefault' },
  { hex: '#707d8f', labelKey: 'vocabadmin.colorSlate' }, // 3.51 dark / 3.56 light
  { hex: '#377ed0', labelKey: 'vocabadmin.colorBlue' }, // 3.55 / 3.52
  { hex: '#208a87', labelKey: 'vocabadmin.colorTeal' }, // 3.55 / 3.52
  { hex: '#218f46', labelKey: 'vocabadmin.colorGreen' }, // 3.54 / 3.53
  { hex: '#977823', labelKey: 'vocabadmin.colorAmber' }, // 3.52 / 3.55
  { hex: '#bc662c', labelKey: 'vocabadmin.colorOrange' }, // 3.54 / 3.53
  { hex: '#d44973', labelKey: 'vocabadmin.colorRose' }, // 3.51 / 3.56
  { hex: '#9960da', labelKey: 'vocabadmin.colorViolet' }, // 3.52 / 3.55
]

/**
 * The view's fallback for a priority whose threshold is null, keyed loosely so
 * this file never has to assert that a row's key belongs to the frozen priority
 * union. Copied into a string-keyed object rather than cast, so an unknown key
 * reads as `undefined` instead of lying about a number.
 */
const STALE_FALLBACK: Readonly<Record<string, number | undefined>> = { ...DEFAULT_STALE_DAYS }

/** The composite primary key of vocab_options, flattened for React keys and ids. */
function idOf(kind: VocabKind, key: string): string {
  return `${kind}:${key}`
}

/**
 * Cosmetic admin gate — the same one TracksAdmin documents. The real authority
 * is `is_admin()` in 0003's RLS policies: every write on this screen fails with
 * 42501 for a member whatever this returns, and hiding the screen only avoids
 * offering an action that cannot succeed.
 *
 * `?shell` mirrors App.tsx's dev-only preview flag, so the layout and the RTL
 * mirror stay reviewable in a build with no Supabase project.
 * `import.meta.env.DEV` is the literal `false` in a production build, so Vite
 * drops the whole expression and this cannot become a way in.
 */
function useIsAdmin(): boolean {
  const { profile } = useAuth()
  if (profile?.role === 'admin') return true
  return import.meta.env.DEV && new URLSearchParams(window.location.search).has('shell')
}

/** One row's edit state. Strings throughout — an empty field is a real value. */
interface Draft {
  label: string
  labelAr: string
  /** '' means "no override"; the patch sends null. */
  color: string
  staleDays: string
  slaDays: string
}

type DraftErrors = Partial<Record<keyof Draft, string>>

function draftOf(row: VocabRow): Draft {
  return {
    label: row.label,
    labelAr: row.label_ar,
    color: row.color ?? '',
    staleDays: row.stale_after_days === null ? '' : String(row.stale_after_days),
    slaDays: row.sla_days === null ? '' : String(row.sla_days),
  }
}

/**
 * '' → null (a real value: "no threshold"), digits → the number, anything else →
 * 'bad'. Kept separate from the range test so the two failures can say different
 * things later without this function growing an opinion.
 */
function parseCount(raw: string): number | null | 'bad' {
  const text = raw.trim()
  if (text === '') return null
  if (!/^\d+$/.test(text)) return 'bad'
  const value = Number(text)
  return Number.isSafeInteger(value) ? value : 'bad'
}

function outOfRange(value: number | null | 'bad', min: number, max: number): boolean {
  if (value === 'bad') return true
  if (value === null) return false
  return value < min || value > max
}

/** i18n KEYS, not sentences — the caller renders them through t(). */
function validate(draft: Draft, kind: VocabKind): DraftErrors {
  const errors: DraftErrors = {}
  if (draft.label.trim().length > LABEL_MAX) errors.label = 'vocabadmin.errLabelLong'
  if (draft.labelAr.trim().length > LABEL_MAX) errors.labelAr = 'vocabadmin.errLabelLong'
  const color = draft.color.trim()
  if (color !== '' && !HEX.test(color)) errors.color = 'vocabadmin.errColor'
  // Both day counts carry a CHECK keeping them null on status and type rows, so
  // the two fields exist — and are validated — only here.
  if (kind === 'priority') {
    if (outOfRange(parseCount(draft.staleDays), STALE_MIN, STALE_MAX)) {
      errors.staleDays = 'vocabadmin.errStaleRange'
    }
    if (outOfRange(parseCount(draft.slaDays), SLA_MIN, SLA_MAX)) {
      errors.slaDays = 'vocabadmin.errSlaRange'
    }
  }
  return errors
}

/**
 * The display order of one kind: sort_order, then the frozen declaration order
 * as the tiebreak.
 *
 * Built by walking FROZEN_KEYS and enriching from whatever rows exist, exactly
 * as store/vocab's buildItems() does — a missing, empty or partially seeded
 * table then degrades to the frozen order instead of an empty list, which is the
 * supported state an unapplied 0003 leaves behind. Ties are real: sort_order
 * defaults to 0 and reorder_vocab only rewrites the keys it was handed.
 */
function orderFor(kind: VocabKind, rows: readonly VocabRow[]): string[] {
  const frozen = FROZEN_KEYS[kind]
  const sortOf = new Map<string, number>()
  for (const row of rows) if (row.kind === kind) sortOf.set(row.key, row.sort_order)
  return [...frozen].sort(
    (a, b) =>
      (sortOf.get(a) ?? frozen.indexOf(a)) - (sortOf.get(b) ?? frozen.indexOf(b)) ||
      frozen.indexOf(a) - frozen.indexOf(b),
  )
}

/** Move `index` by `delta`, returning a new array. Out of range is a no-op. */
function moved(keys: string[], index: number, delta: number): string[] {
  const target = index + delta
  if (target < 0 || target >= keys.length) return keys
  const next = keys.slice()
  const [key] = next.splice(index, 1)
  next.splice(target, 0, key)
  return next
}

/** What the effect report compares. Both counts are over OPEN entries only. */
interface HealthCounts {
  /**
   * `health = 'stale'` as the view classifies it — NOT "silent for N days".
   * Overdue outranks stale in v_entry_health, so an item that is both is
   * reported as overdue, and this count therefore says exactly what the badges
   * on the follow-ups screen say.
   */
  quiet: number
  breached: number
}

/** null when the view could not be read; the caller falls back to a plain toast. */
async function measureHealth(): Promise<HealthCounts | null> {
  const result = await listHealth()
  if (!result.ok) return null
  let quiet = 0
  let breached = 0
  // `.rows`, because the read is clipped at PostgREST's ceiling and says so.
  // The counts are a "here is what arming this will do" preview, so a window of
  // the open rows is an acceptable answer where a wrong total would not be —
  // and the truncation is reported by the entries store on the screens that
  // show these numbers as facts.
  for (const row of result.data.rows) {
    if (row.health === 'stale') quiet += 1
    if (row.sla_breached) breached += 1
  }
  return { quiet, breached }
}

export default function VocabularyAdmin(): ReactElement {
  const locale = useLocale()
  const isAdmin = useIsAdmin()

  const [rows, setRows] = useState<VocabRow[] | null>(null)
  const [order, setOrder] = useState<Record<VocabKind, string[]>>(() => ({
    status: [...FROZEN_KEYS.status],
    priority: [...FROZEN_KEYS.priority],
    type: [...FROZEN_KEYS.type],
  }))
  const [errorKey, setErrorKey] = useState<string | null>(null)
  /** `kind:key` of the row whose editor is open. One at a time, deliberately. */
  const [openId, setOpenId] = useState<string | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [baseline, setBaseline] = useState<Draft | null>(null)
  const [touched, setTouched] = useState<Partial<Record<keyof Draft, boolean>>>({})
  const [submitted, setSubmitted] = useState(false)
  const [saving, setSaving] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  /** The one row currently showing a server error, and the i18n key it showed. */
  const [rowError, setRowError] = useState<{ id: string; key: string } | null>(null)
  const [moveMessage, setMoveMessage] = useState('')

  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])

  const load = useCallback(async () => {
    setErrorKey(null)
    const result = await listVocab()
    if (!alive.current) return
    if (!result.ok) {
      setErrorKey(result.error)
      setRows([])
      return
    }
    setRows(result.data)
    setOrder({
      status: orderFor('status', result.data),
      priority: orderFor('priority', result.data),
      type: orderFor('type', result.data),
    })
  }, [])

  useEffect(() => {
    if (isAdmin) void load()
  }, [isAdmin, load])

  /**
   * Rows by composite key, and the snapshot the label resolvers read.
   * `loadedAt: null` is honest — this is this screen's own fetch, not the
   * store's — and vocabLabel() does not read that field.
   */
  const rowMap = useMemo(() => {
    const map = new Map<string, VocabRow>()
    for (const row of rows ?? []) map.set(idOf(row.kind, row.key), row)
    return map
  }, [rows])
  const snapshot = useMemo<VocabSnapshot>(() => ({ rows: rows ?? [], loadedAt: null }), [rows])

  const openRow = openId ? (rowMap.get(openId) ?? null) : null
  const dirty =
    draft !== null && baseline !== null && JSON.stringify(draft) !== JSON.stringify(baseline)
  const errors: DraftErrors = draft && openRow ? validate(draft, openRow.kind) : {}
  const shows = (field: keyof Draft): string | undefined =>
    submitted || touched[field] ? errors[field] : undefined

  // ---- focus choreography -------------------------------------------------
  // Two maps rather than one: a reorder returns focus to a move button, a closed
  // editor returns it to the Edit button that opened it. Both live inside a list
  // React re-keys freely, so the refs are collected by callback.
  const moveButtons = useRef(new Map<string, HTMLButtonElement>())
  const editButtons = useRef(new Map<string, HTMLButtonElement>())
  const firstField = useRef<HTMLInputElement>(null)
  /** `${kind}:${key}:up|down` — which move button to focus after the next paint. */
  const focusAfterMove = useRef<string | null>(null)
  /** `${kind}:${key}` of the Edit button to focus once an editor closes. */
  const focusAfterClose = useRef<string | null>(null)

  useEffect(() => {
    const moveTarget = focusAfterMove.current
    if (moveTarget) {
      focusAfterMove.current = null
      moveButtons.current.get(moveTarget)?.focus()
      return
    }
    const closeTarget = focusAfterClose.current
    if (closeTarget) {
      focusAfterClose.current = null
      editButtons.current.get(closeTarget)?.focus()
    }
  })

  // An opened editor puts focus on its first field: the Edit button is several
  // controls away from the input the admin came to type in, and on a 375px
  // screen the panel opens below the fold.
  useEffect(() => {
    if (openId) firstField.current?.focus()
  }, [openId])

  // ---- reorder ------------------------------------------------------------

  /**
   * A person moving a row three places clicks three times in under a second, so
   * a stale reply must not report a failure the newer write already fixed. One
   * counter per kind — the three lists reorder independently.
   */
  const orderSeq = useRef<Record<VocabKind, number>>({ status: 0, priority: 0, type: 0 })

  const persistOrder = useCallback(
    async (kind: VocabKind, keys: string[]) => {
      const seq = (orderSeq.current[kind] += 1)
      const result = await reorderVocab(kind, keys)
      if (!alive.current || seq !== orderSeq.current[kind]) return
      if (!result.ok) {
        toast(t(result.error), { tone: 'error' })
        // Re-read rather than restore a captured array: after several rapid
        // moves the captured one is itself stale, and the server's order is the
        // only description of the list that is certainly true.
        void load()
        return
      }
      invalidateVocab()
      // The move is already visible; what the toast adds is that it PERSISTED.
      // Without it a rejected write and an accepted one look identical.
      toast(t('vocabadmin.reordered'))
    },
    [load],
  )

  function move(kind: VocabKind, index: number, delta: number): void {
    const keys = order[kind]
    const next = moved(keys, index, delta)
    if (next === keys) return
    const key = keys[index]
    const landed = index + delta
    const label = vocabLabel(snapshot, kind, key, locale)
    // Focus moving with the row says WHICH row is selected but not where it
    // landed, and the order is the one thing this control edits. The live region
    // carries the position.
    setMoveMessage(t('vocabadmin.movedTo', { label, position: landed + 1, total: next.length }))
    const pressed = delta < 0 ? 'up' : 'down'
    // Focus follows the row, not the position: the pressed button goes disabled
    // once the row reaches the end of the list, so focus lands on its twin
    // instead of being dropped back onto the document.
    const stillEnabled = delta < 0 ? landed > 0 : landed < next.length - 1
    const twin = pressed === 'up' ? 'down' : 'up'
    focusAfterMove.current = `${idOf(kind, key)}:${stillEnabled ? pressed : twin}`
    setOrder((current) => ({ ...current, [kind]: next }))
    void persistOrder(kind, next)
  }

  // ---- the effect report --------------------------------------------------

  /**
   * Say what the save did to work that is not on this screen.
   *
   * `before` is null when the edit could not move a health count (a rename, a
   * colour, a hide): the measurement is skipped entirely rather than spending
   * two round trips to print a delta of zero.
   */
  async function reportEffect(before: HealthCounts | null, unchangedKey: string): Promise<void> {
    if (!before) {
      toast(t('vocabadmin.savedToast'))
      return
    }
    const after = await measureHealth()
    if (!alive.current) return
    if (!after) {
      // The write succeeded; only the report failed. Saying so quietly beats an
      // error tone on a save that worked.
      toast(t('vocabadmin.savedToast'))
      return
    }
    const quietMoved = after.quiet !== before.quiet
    const breachMoved = after.breached !== before.breached
    // Longer than the 3.2s default: this is a report to be read, not an
    // acknowledgement to be noticed.
    const options = { duration: 6500 }
    if (quietMoved && breachMoved) {
      toast(
        t('vocabadmin.effectBoth', {
          stale: after.quiet,
          staleWas: before.quiet,
          sla: after.breached,
          slaWas: before.breached,
        }),
        options,
      )
    } else if (quietMoved) {
      toast(t('vocabadmin.effectStale', { count: after.quiet, was: before.quiet }), options)
    } else if (breachMoved) {
      toast(t('vocabadmin.effectSla', { count: after.breached, was: before.breached }), options)
    } else {
      toast(t(unchangedKey))
    }
  }

  // ---- editing ------------------------------------------------------------

  function beginEdit(row: VocabRow): void {
    const next = draftOf(row)
    setOpenId(idOf(row.kind, row.key))
    setDraft(next)
    setBaseline(next)
    setTouched({})
    setSubmitted(false)
    setRowError(null)
  }

  function clearEditor(): void {
    setOpenId(null)
    setDraft(null)
    setBaseline(null)
    setTouched({})
    setSubmitted(false)
  }

  /** The unsaved-work guard. Resolves true when it is safe to drop the draft. */
  async function confirmDiscard(): Promise<boolean> {
    if (!dirty) return true
    const ok = await confirm({
      title: t('vocabadmin.discardTitle'),
      body: t('vocabadmin.discardBody'),
      confirmLabel: t('vocabadmin.discard'),
      cancelLabel: t('common.cancel'),
      danger: true,
    })
    return ok && alive.current
  }

  async function closeEditor(returnFocusTo: string): Promise<void> {
    if (!(await confirmDiscard())) return
    focusAfterClose.current = returnFocusTo
    clearEditor()
  }

  /** The Edit button: open, close, or switch rows — guarding unsaved work each time. */
  async function toggleEdit(row: VocabRow): Promise<void> {
    const id = idOf(row.kind, row.key)
    if (openId === id) {
      await closeEditor(id)
      return
    }
    if (!(await confirmDiscard())) return
    beginEdit(row)
  }

  function setField<K extends keyof Draft>(field: K, value: Draft[K]): void {
    setDraft((current) => (current ? { ...current, [field]: value } : current))
  }

  /** Replace one row in place — every mutation returns the row it wrote. */
  function applyRow(next: VocabRow): void {
    setRows((current) =>
      current
        ? current.map((row) => (row.kind === next.kind && row.key === next.key ? next : row))
        : current,
    )
  }

  /**
   * pgErrorKey's catch-all says less than this screen's own headline; anything
   * more specific (errLastVisible, admin.errForbidden, common.notConfigured) is
   * worth showing verbatim.
   */
  function saveErrorKey(key: string): string {
    return key === 'common.error' ? 'vocabadmin.errSave' : key
  }

  function failRow(id: string, key: string): void {
    const shown = saveErrorKey(key)
    setRowError({ id, key: shown })
    toast(t(shown), { tone: 'error' })
  }

  async function save(row: VocabRow): Promise<void> {
    if (!draft) return
    setSubmitted(true)
    setRowError(null)
    if (Object.keys(validate(draft, row.kind)).length > 0) return

    // Only the fields that actually changed: `undefined` means "leave alone" in
    // VocabPatch, and a blanket overwrite would clobber a column another admin
    // edited while this editor sat open.
    const patch: VocabPatch = {}
    const label = draft.label.trim()
    const labelAr = draft.labelAr.trim()
    const color = draft.color.trim().toLowerCase() || null
    if (label !== row.label) patch.label = label
    if (labelAr !== row.label_ar) patch.labelAr = labelAr
    if (color !== row.color) patch.color = color

    let thresholdsChanged = false
    let arming: number | null = null
    if (row.kind === 'priority') {
      const stale = parseCount(draft.staleDays)
      const sla = parseCount(draft.slaDays)
      if (stale !== 'bad' && stale !== row.stale_after_days) {
        patch.staleAfterDays = stale
        thresholdsChanged = true
      }
      if (sla !== 'bad' && sla !== row.sla_days) {
        patch.slaDays = sla
        thresholdsChanged = true
        // Off → on is the one edit here with a retroactive reach. On → off and
        // on → a different number are not, and get no dialog.
        if (row.sla_days === null && typeof sla === 'number') arming = sla
      }
    }

    if (Object.keys(patch).length === 0) {
      // Nothing to write. Closing is the honest answer — a PATCH of no columns
      // would round-trip to report that nothing happened.
      focusAfterClose.current = idOf(row.kind, row.key)
      clearEditor()
      return
    }

    // Busy from here, not from the write: while the arming dialog is up the Save
    // button was still live, and a second click opened a second dialog behind
    // the first. `saving` stays for the write itself, so the button only reads
    // "Saving…" once something is actually in flight.
    const rowId = idOf(row.kind, row.key)
    setBusyId(rowId)
    if (arming !== null) {
      const ok = await confirm({
        title: t('vocabadmin.armTitle', { label: vocabLabel(snapshot, row.kind, row.key, locale) }),
        body: t('vocabadmin.armBody', { days: arming }),
        confirmLabel: t('vocabadmin.armConfirm'),
        cancelLabel: t('common.cancel'),
      })
      if (!ok || !alive.current) {
        if (alive.current) setBusyId(null)
        return
      }
    }

    setSaving(true)
    // Measured BEFORE the write rather than taken from a number this screen
    // loaded minutes ago: the view moves with the clock as well as with the
    // thresholds, and a "was" that predates the page compares against nothing.
    const before = thresholdsChanged ? await measureHealth() : null
    const result = await updateVocab(row.kind, row.key, patch)
    if (!alive.current) return
    setSaving(false)
    setBusyId(null)
    if (!result.ok) {
      failRow(rowId, result.error)
      return
    }
    applyRow(result.data)
    invalidateVocab()
    focusAfterClose.current = rowId
    clearEditor()
    await reportEffect(before, 'vocabadmin.effectNone')
  }

  // ---- hide / show --------------------------------------------------------

  async function toggleHidden(row: VocabRow): Promise<void> {
    const id = idOf(row.kind, row.key)
    setBusyId(id)
    setRowError(null)
    // No client-side last-visible check, on purpose — see this file's header.
    const result = await updateVocab(row.kind, row.key, { hidden: !row.hidden })
    if (!alive.current) return
    setBusyId(null)
    if (!result.ok) {
      failRow(id, result.error)
      return
    }
    applyRow(result.data)
    invalidateVocab()
    toast(t('vocabadmin.savedToast'))
  }

  // ---- reset --------------------------------------------------------------

  async function resetRow(row: VocabRow): Promise<void> {
    const ok = await confirm({
      title: t('vocabadmin.resetTitle', { label: vocabLabel(snapshot, row.kind, row.key, locale) }),
      body: t('vocabadmin.resetBody'),
      confirmLabel: t('vocabadmin.reset'),
      cancelLabel: t('common.cancel'),
      danger: true,
    })
    if (!ok || !alive.current) return
    const id = idOf(row.kind, row.key)
    setBusyId(id)
    setRowError(null)
    // A priority reset restores the SEEDED thresholds — stale_after_days back to
    // 2/4/8/15 and sla_days back to NULL — so it moves health counts exactly as
    // an edit does, and is reported the same way.
    const before = row.kind === 'priority' ? await measureHealth() : null
    const result = await resetVocab(row.kind, row.key)
    if (!alive.current) return
    setBusyId(null)
    if (!result.ok) {
      failRow(id, result.error)
      return
    }
    if (openId === id) clearEditor()
    // reset_vocab() returns a count, not the row, so the list is re-read.
    await load()
    invalidateVocab()
    await reportEffect(before, 'vocabadmin.resetToast')
  }

  async function resetKind(kind: VocabKind): Promise<void> {
    const ok = await confirm({
      title: t('vocabadmin.resetAllTitle'),
      body: t('vocabadmin.resetAllBody'),
      confirmLabel: t('vocabadmin.resetAll'),
      cancelLabel: t('common.cancel'),
      danger: true,
    })
    if (!ok || !alive.current) return
    setRowError(null)
    const before = kind === 'priority' ? await measureHealth() : null
    const result = await resetVocab(kind)
    if (!alive.current) return
    if (!result.ok) {
      toast(t(saveErrorKey(result.error)), { tone: 'error' })
      return
    }
    if (openId?.startsWith(`${kind}:`)) clearEditor()
    await load()
    invalidateVocab()
    await reportEffect(before, 'vocabadmin.resetToast')
  }

  // ---- colour radiogroup --------------------------------------------------
  //
  // Declared at the top level: hooks may not be called from the row renderer
  // below, and one editor — so one group — is open at a time anyway.

  const swatchIndex = draft
    ? SWATCHES.findIndex((option) =>
        option.hex === null
          ? draft.color.trim() === ''
          : option.hex === draft.color.trim().toLowerCase(),
      )
    : -1

  const selectSwatch = useCallback((index: number): void => {
    const option = SWATCHES[index]
    setDraft((current) => (current ? { ...current, color: option.hex ?? '' } : current))
    setTouched((current) => ({ ...current, color: true }))
  }, [])
  const onSwatchKeyDown = useRadioGroupKeys<HTMLDivElement>(selectSwatch)

  if (!isAdmin) return <Navigate to="/settings" replace />

  const loading = rows === null
  /**
   * The fetch worked and came back empty: 0003's table exists but its seed never
   * ran (or RLS matched nothing). That is one fact about the whole workspace, so
   * it is said once at the top — printing it under all seventeen rows tripled the
   * page height and buried the controls it was explaining. The per-row copy below
   * survives for the case it is actually about: SOME rows exist and this one does
   * not, which is a partial seed rather than a missing install.
   */
  const noRows = rows !== null && rows.length === 0

  // Resolved once so each render site is a plain value rather than two calls TS
  // cannot narrow against each other.
  const labelErr = shows('label')
  const labelArErr = shows('labelAr')
  const colorErr = shows('color')
  const staleErr = shows('staleDays')
  const slaErr = shows('slaDays')

  // What the two label fields will resolve to, in BOTH languages, through the
  // store's own resolver — see this file's header. The synthetic row carries the
  // draft's strings, so the preview updates as the admin types.
  const previewSnapshot: VocabSnapshot | null =
    openRow && draft
      ? {
          rows: [
            {
              ...openRow,
              label: draft.label.trim(),
              label_ar: draft.labelAr.trim(),
              color: draft.color.trim() || null,
            },
          ],
          loadedAt: null,
        }
      : null

  return (
    <div className="vocab">
      <div className="vocab-bar">
        <Link to="/settings" className="btn btn-ghost btn-sm">
          {/* icon-directional: a back arrow points at the reading start, so it
              mirrors in Arabic. */}
          <IconArrowStart className="icon-directional" size={16} />
          {t('common.back')}
        </Link>
      </div>

      {/* No page heading here: App.tsx's header already renders this route's
          title as the document h1, and a second copy of the same word is noise
          in the heading outline. */}
      <div className="vocab-intro">
        <p className="vocab-intro-lead">{t('vocabadmin.subtitle')}</p>
        {/* The two rules that explain the shape of every control below, kept in
            one block so they read as a pair rather than as three unrelated
            paragraphs spaced a section apart. */}
        <p className="vocab-note">{t('vocabadmin.frozenHint')}</p>
        <p className="vocab-note">{t('vocabadmin.hiddenHint')}</p>
      </div>

      {/* Polite, not assertive: a reorder is the user's own deliberate action, so
          it should follow what is being read rather than interrupt it. */}
      <p className="sr-only" role="status" aria-live="polite">
        {moveMessage}
      </p>

      {loading && <Skeleton height={104} count={3} />}

      {!loading && errorKey && (
        <div className="card vocab-error" role="alert">
          <div className="vocab-error-text">
            <p>{t(errorKey === 'common.error' ? 'vocabadmin.errLoad' : errorKey)}</p>
            {/* The realistic cause of the generic failure is 0003 never having
                been applied, which is a SUPPORTED state rather than a fault —
                the app runs on the built-in wording. Say so, instead of leaving
                a bare "couldn't load". */}
            {errorKey === 'common.error' && (
              <p className="vocab-note">{t('vocabadmin.notInstalled')}</p>
            )}
          </div>
          <button type="button" className="btn btn-sm" onClick={() => void load()}>
            {t('common.retry')}
          </button>
        </div>
      )}

      {/* Said once for the workspace, not once per option — see `noRows`. Not
          role="alert": an unseeded table is a supported state the app runs fine
          in, and interrupting a screen reader mid-sentence would rank it above
          the load failure directly above, which is the one that IS a fault. */}
      {!loading && !errorKey && noRows && (
        <p className="card vocab-empty" role="status">
          {t('vocabadmin.notInstalled')}
        </p>
      )}

      {!loading &&
        !errorKey &&
        KINDS.map((kind) => {
          const keys = order[kind]
          // Every priority still on its seeded NULL: SLA is off for the whole
          // workspace, and "no deadline" on four separate rows does not add up
          // to that sentence on its own.
          const slaAllOff =
            kind === 'priority' &&
            keys.every((key) => (rowMap.get(idOf(kind, key))?.sla_days ?? null) === null)

          return (
            <section className="card vocab-section" key={kind} aria-labelledby={`vocab-h-${kind}`}>
              <div className="vocab-section-head">
                <h2 className="vocab-section-title" id={`vocab-h-${kind}`}>
                  {t(KIND_TITLE[kind])}
                </h2>
                <button
                  type="button"
                  className="btn btn-sm btn-ghost"
                  onClick={() => void resetKind(kind)}
                >
                  {t('vocabadmin.resetAll')}
                </button>
              </div>
              <p className="vocab-section-hint">{t(KIND_HINT[kind])}</p>

              {kind === 'priority' && (
                <div className="vocab-sla-note">
                  {slaAllOff && <p className="vocab-sla-off">{t('vocabadmin.slaOffAll')}</p>}
                  {/* The resolution rule in one sentence, beside the control it
                      governs, with the other half of it one tap away. */}
                  <p>
                    {t('vocabadmin.slaResolution')}{' '}
                    <Link to="/settings/tracks" className="vocab-link">
                      {t('vocabadmin.trackOverrides')}
                    </Link>
                  </p>
                  <p className="vocab-note">{t('vocabadmin.slaTrackHint')}</p>
                  <p className="vocab-note">{t('vocabadmin.measuredFrom')}</p>
                </div>
              )}

              <ul className="vocab-list" aria-label={t(KIND_TITLE[kind])}>
                {keys.map((key, index) => {
                  const id = idOf(kind, key)
                  const row = rowMap.get(id) ?? null
                  const label = vocabLabel(snapshot, kind, key, locale)
                  const open = openId === id
                  const busy = busyId === id
                  const hidden = row?.hidden ?? false
                  const edited =
                    row !== null &&
                    (row.label.trim() !== '' || row.label_ar.trim() !== '' || row.color !== null)
                  const staleDays = row?.stale_after_days ?? STALE_FALLBACK[key] ?? null
                  const slaDays = row?.sla_days ?? null
                  const arming =
                    row !== null &&
                    row.sla_days === null &&
                    draft !== null &&
                    open &&
                    typeof parseCount(draft.slaDays) === 'number'

                  return (
                    // Variants ride on data-* attributes rather than modifier
                    // classes: §1.0.7 grants this sheet the `.vocab-*` names and
                    // nothing else, so `.is-open` would be an unregistered
                    // global — the same rule entry.css states for its atoms.
                    <li
                      key={key}
                      className="vocab-row"
                      data-hidden={hidden ? 'true' : undefined}
                      data-open={open ? 'true' : undefined}
                    >
                      <div className="vocab-row-head">
                        <div
                          className="vocab-moves"
                          role="group"
                          aria-label={t('vocabadmin.order')}
                        >
                          <button
                            type="button"
                            className="btn btn-sm btn-icon vocab-move"
                            aria-label={t('vocabadmin.moveUp', { label })}
                            disabled={index === 0}
                            ref={(el) => {
                              if (el) moveButtons.current.set(`${id}:up`, el)
                              else moveButtons.current.delete(`${id}:up`)
                            }}
                            onClick={() => move(kind, index, -1)}
                          >
                            {/* One chevron glyph, rotated in CSS. Up and down are
                                axis-neutral, so this deliberately does NOT carry
                                .icon-directional — mirroring it in Arabic would
                                point it sideways. */}
                            <IconChevronEnd className="vocab-move-icon vocab-move-up" size={16} />
                          </button>
                          <button
                            type="button"
                            className="btn btn-sm btn-icon vocab-move"
                            aria-label={t('vocabadmin.moveDown', { label })}
                            disabled={index === keys.length - 1}
                            ref={(el) => {
                              if (el) moveButtons.current.set(`${id}:down`, el)
                              else moveButtons.current.delete(`${id}:down`)
                            }}
                            onClick={() => move(kind, index, 1)}
                          >
                            <IconChevronEnd className="vocab-move-icon vocab-move-down" size={16} />
                          </button>
                        </div>

                        <div className="vocab-row-main">
                          {/* Pill and key are ONE unit — the key names the pill —
                              so they wrap together and the badges wrap around
                              them rather than pushing every edited row onto two
                              lines. */}
                          <div className="vocab-row-id">
                            {/* The pill as the app draws it — the admin's colour
                                on the admin's label, not a description of it. */}
                            <span className="pill vocab-pill" style={vocabVars(row?.color ?? null)}>
                              {label}
                            </span>
                            {/* The stored value, which is what shows up in SQL and
                                in the parser's aliases. dir=ltr because a
                                snake_case identifier reads back to front inside
                                an RTL paragraph. */}
                            <span className="vocab-key" dir="ltr" title={t('vocabadmin.key')}>
                              {key}
                            </span>
                          </div>
                          <div className="vocab-badges">
                            {hidden && <span className="pill warn">{t('vocabadmin.hidden')}</span>}
                            {edited && <span className="pill">{t('vocabadmin.edited')}</span>}
                            {kind === 'priority' && staleDays !== null && (
                              <span className="pill tabular">
                                {t('vocabadmin.badgeStale', { count: staleDays })}
                              </span>
                            )}
                            {kind === 'priority' &&
                              (slaDays === null ? (
                                <span className="pill">{t('vocabadmin.slaOff')}</span>
                              ) : (
                                <span className="pill info tabular">
                                  {t('vocabadmin.badgeSla', { count: slaDays })}
                                </span>
                              ))}
                          </div>
                        </div>

                        <div className="vocab-row-actions">
                          <button
                            type="button"
                            className="btn btn-sm"
                            aria-expanded={open}
                            aria-label={t(open ? 'vocabadmin.closeRow' : 'vocabadmin.editRow', {
                              label,
                            })}
                            disabled={row === null || busy}
                            ref={(el) => {
                              if (el) editButtons.current.set(id, el)
                              else editButtons.current.delete(id)
                            }}
                            onClick={() => {
                              if (row) void toggleEdit(row)
                            }}
                          >
                            {t(open ? 'common.close' : 'common.edit')}
                          </button>
                          <button
                            type="button"
                            className="btn btn-sm"
                            aria-label={t(hidden ? 'vocabadmin.showRow' : 'vocabadmin.hideRow', {
                              label,
                            })}
                            disabled={row === null || busy}
                            onClick={() => {
                              if (row) void toggleHidden(row)
                            }}
                          >
                            {t(hidden ? 'vocabadmin.show' : 'vocabadmin.hide')}
                          </button>
                          <button
                            type="button"
                            className="btn btn-sm btn-ghost"
                            aria-label={t('vocabadmin.resetRow', { label })}
                            disabled={row === null || busy}
                            onClick={() => {
                              if (row) void resetRow(row)
                            }}
                          >
                            {t('vocabadmin.reset')}
                          </button>
                        </div>
                      </div>

                      {/* A row with no database row behind it while OTHER rows
                          have one: a partial seed, the app is running on the
                          built-in wording for this option, and there is nothing
                          to patch. When no row exists at all the banner at the
                          top has already said so, once. */}
                      {row === null && !noRows && (
                        <p className="vocab-note">{t('vocabadmin.notInstalled')}</p>
                      )}

                      {rowError?.id === id && (
                        <p className="field-error" role="alert">
                          {t(rowError.key)}
                        </p>
                      )}

                      {open && row && draft && previewSnapshot && (
                        <form
                          className="vocab-editor"
                          onSubmit={(e) => {
                            e.preventDefault()
                            void save(row)
                          }}
                        >
                          <div className="vocab-grid">
                            <div className="field">
                              <label className="field-label" htmlFor={`${id}-label`}>
                                {t('vocabadmin.label')}
                              </label>
                              <input
                                id={`${id}-label`}
                                ref={firstField}
                                className="input"
                                lang="en"
                                dir="ltr"
                                value={draft.label}
                                maxLength={LABEL_MAX}
                                autoComplete="off"
                                // The built-in wording, bare. It used to read
                                // "Default: New", and a two-direction sentence
                                // inside a single-direction box always lays out
                                // wrong in one of the two fields — the English
                                // prefix flipped its colon inside the RTL input.
                                // The field's own hint and the preview below
                                // both say what an empty field means.
                                placeholder={vocabLabel(EMPTY_SNAPSHOT, kind, key, 'en')}
                                aria-invalid={labelErr ? true : undefined}
                                onChange={(e) => setField('label', e.target.value)}
                                onBlur={() => setTouched((c) => ({ ...c, label: true }))}
                              />
                              {labelErr ? (
                                <p className="field-error">{t(labelErr, { max: LABEL_MAX })}</p>
                              ) : (
                                <p className="vocab-hint">{t('vocabadmin.labelHint')}</p>
                              )}
                            </div>

                            <div className="field">
                              <label className="field-label" htmlFor={`${id}-label-ar`}>
                                {t('vocabadmin.labelAr')}
                              </label>
                              {/* lang + dir on the CONTROL: the Arabic label is
                                  typed into an otherwise English page, and
                                  without these the caret starts on the wrong
                                  side and the text gets a Latin face. */}
                              <input
                                id={`${id}-label-ar`}
                                className="input"
                                lang="ar"
                                dir="rtl"
                                value={draft.labelAr}
                                maxLength={LABEL_MAX}
                                autoComplete="off"
                                placeholder={vocabLabel(EMPTY_SNAPSHOT, kind, key, 'ar')}
                                aria-invalid={labelArErr ? true : undefined}
                                onChange={(e) => setField('labelAr', e.target.value)}
                                onBlur={() => setTouched((c) => ({ ...c, labelAr: true }))}
                              />
                              {labelArErr ? (
                                <p className="field-error">{t(labelArErr, { max: LABEL_MAX })}</p>
                              ) : (
                                <p className="vocab-hint">{t('vocabadmin.labelArHint')}</p>
                              )}
                            </div>
                          </div>

                          {/* Both languages resolved the way every screen will
                              resolve them, so "empty means the built-in wording"
                              is demonstrated rather than described — including
                              the rule that a blank Arabic label falls through to
                              the built-in Arabic and never to the English one. */}
                          <div className="vocab-resolve">
                            <p className="field-label">{t('vocabadmin.preview')}</p>
                            <div className="row-actions vocab-resolve-line">
                              <span className="vocab-resolve-lang">{t('settings.languageEn')}</span>
                              <span
                                className="pill vocab-pill"
                                lang="en"
                                dir="ltr"
                                style={vocabVars(draft.color.trim() || null)}
                              >
                                {vocabLabel(previewSnapshot, kind, key, 'en')}
                              </span>
                              {draft.label.trim() === '' && (
                                <span className="vocab-note">{t('vocabadmin.usingDefault')}</span>
                              )}
                            </div>
                            <div className="row-actions vocab-resolve-line">
                              <span className="vocab-resolve-lang">{t('settings.languageAr')}</span>
                              <span
                                className="pill vocab-pill"
                                lang="ar"
                                dir="rtl"
                                style={vocabVars(draft.color.trim() || null)}
                              >
                                {vocabLabel(previewSnapshot, kind, key, 'ar')}
                              </span>
                              {draft.labelAr.trim() === '' && (
                                <span className="vocab-note">{t('vocabadmin.usingDefault')}</span>
                              )}
                            </div>
                          </div>

                          <fieldset className="vocab-fieldset">
                            <legend className="field-label">{t('vocabadmin.color')}</legend>
                            <p className="vocab-hint">{t('vocabadmin.colorHint')}</p>
                            {/* role="radiogroup" is a contract: one tab stop,
                                arrows move the selection. See lib/radioGroup.ts. */}
                            <div
                              className="vocab-swatches"
                              role="radiogroup"
                              aria-label={t('vocabadmin.color')}
                              onKeyDown={onSwatchKeyDown}
                            >
                              {SWATCHES.map((option, optionIndex) => {
                                const active = optionIndex === swatchIndex
                                return (
                                  <button
                                    key={option.labelKey}
                                    type="button"
                                    role="radio"
                                    aria-checked={active}
                                    aria-label={t(option.labelKey)}
                                    tabIndex={rovingTabIndex(optionIndex, swatchIndex)}
                                    className="vocab-swatch"
                                    // Selection is drawn off aria-checked, which
                                    // the control already carries — a parallel
                                    // `.is-active` class would be a second
                                    // source of truth for one state.
                                    data-none={option.hex === null ? 'true' : undefined}
                                    style={vocabVars(option.hex)}
                                    onClick={() => selectSwatch(optionIndex)}
                                  >
                                    <span className="vocab-swatch-dot" aria-hidden="true" />
                                  </button>
                                )
                              })}
                            </div>
                            <div className="field">
                              {/* "Hex value", not a second "Colour": the legend
                                  above already names the group, and two controls
                                  under one repeated label is a screen reader
                                  hearing "Colour, Colour". */}
                              <label className="field-label" htmlFor={`${id}-color`}>
                                {t('vocabadmin.colorHex')}
                              </label>
                              {/* dir=ltr on the value: a hex is a Latin token and
                                  reads back to front if the RTL paragraph
                                  direction gets hold of it. */}
                              <input
                                id={`${id}-color`}
                                className="input vocab-hex"
                                dir="ltr"
                                value={draft.color}
                                placeholder={t('vocabadmin.colorDefault')}
                                spellCheck={false}
                                autoCapitalize="none"
                                autoCorrect="off"
                                aria-invalid={colorErr ? true : undefined}
                                onChange={(e) => setField('color', e.target.value)}
                                onBlur={() => setTouched((c) => ({ ...c, color: true }))}
                              />
                              {colorErr && <p className="field-error">{t(colorErr)}</p>}
                            </div>
                          </fieldset>

                          {kind === 'priority' && (
                            <div className="vocab-grid">
                              <div className="field">
                                <label className="field-label" htmlFor={`${id}-stale`}>
                                  {t('vocabadmin.staleDays')}
                                </label>
                                <input
                                  id={`${id}-stale`}
                                  className="input tabular"
                                  type="number"
                                  inputMode="numeric"
                                  dir="ltr"
                                  min={STALE_MIN}
                                  max={STALE_MAX}
                                  step={1}
                                  value={draft.staleDays}
                                  placeholder={t('vocabadmin.staleDaysPlaceholder', {
                                    count: STALE_FALLBACK[key] ?? STALE_MIN,
                                  })}
                                  aria-invalid={staleErr ? true : undefined}
                                  onChange={(e) => setField('staleDays', e.target.value)}
                                  onBlur={() => setTouched((c) => ({ ...c, staleDays: true }))}
                                />
                                {staleErr ? (
                                  <p className="field-error">{t(staleErr)}</p>
                                ) : (
                                  <p className="vocab-hint">{t('vocabadmin.staleHint')}</p>
                                )}
                              </div>

                              <div className="field">
                                <label className="field-label" htmlFor={`${id}-sla`}>
                                  {t('vocabadmin.slaDays')}
                                </label>
                                <input
                                  id={`${id}-sla`}
                                  className="input tabular"
                                  type="number"
                                  inputMode="numeric"
                                  dir="ltr"
                                  min={SLA_MIN}
                                  max={SLA_MAX}
                                  step={1}
                                  value={draft.slaDays}
                                  placeholder={t('vocabadmin.slaDaysPlaceholder')}
                                  aria-invalid={slaErr ? true : undefined}
                                  onChange={(e) => setField('slaDays', e.target.value)}
                                  onBlur={() => setTouched((c) => ({ ...c, slaDays: true }))}
                                />
                                {slaErr ? (
                                  <p className="field-error">{t(slaErr)}</p>
                                ) : (
                                  <p className="vocab-hint">{t('vocabadmin.slaHint')}</p>
                                )}
                              </div>
                            </div>
                          )}

                          {/* The arming moment, said before the dialog says it
                              again: this priority has never been measured and is
                              about to be, retroactively. */}
                          {arming && (
                            <p className="vocab-arm" role="status">
                              {t('vocabadmin.armInline', { label })}
                            </p>
                          )}

                          <div className="row-actions vocab-editor-actions">
                            {dirty && <span className="pill warn">{t('vocabadmin.unsaved')}</span>}
                            <button
                              type="submit"
                              className="btn btn-primary btn-sm"
                              disabled={saving || busy || !dirty}
                            >
                              {saving ? t('vocabadmin.saving') : t('vocabadmin.save')}
                            </button>
                            <button
                              type="button"
                              className="btn btn-sm btn-ghost"
                              disabled={saving || busy}
                              onClick={() => void closeEditor(id)}
                            >
                              {t('common.cancel')}
                            </button>
                          </div>
                        </form>
                      )}
                    </li>
                  )
                })}
              </ul>
            </section>
          )
        })}
    </div>
  )
}
