// Settings › Catalogue (/settings/catalogue) — the three short lists the map
// hierarchy is built out of.
//
// THREE SECTIONS ON ONE PAGE, and that is the product decision rather than a
// layout convenience. `use_cases` holds ten rows, `map_node_kinds` holds three
// and `map_node_stages` (0026) holds seven; a man with two interns should not
// navigate three levels to add a use case, and three screens holding twenty
// rows between them would be three back buttons, three loading states and three
// places to look for the same kind of edit.
// Settings › Structure edits the TREE (which organization sits under which
// phase); this screen edits the VOCABULARY that tree is described with.
//
// WHY THIS SCREEN HAS ADD AND DELETE WHEN Settings › Vocabulary REFUSES THEM.
// The difference is real and the header says it in one sentence, because
// without that sentence the next reader assumes one of the two screens is
// wrong. `vocab_options` is frozen because an entry's STATUS KEY is written
// into `entry_updates`, which is append-only: merging two options would rewrite
// finished work with no undo, so api/config.ts does not offer the verbs.
// Nothing in this catalogue has that property — a capability is referenced by
// `map_node_use_cases.use_case_id`, a real foreign key — so add and delete are
// safe, and the one delete that WOULD lose something is refused by the database
// rather than by a rule written in TypeScript.
//
// THE THREE LISTS ARE NOT SYMMETRICAL, and the asymmetry is the schema's, not a
// half-finished screen:
//
//   * USE CASES have `hidden` (0024) and therefore a Hide control, and they
//     have NO reorder RPC — 0023 ships `reorder_map_nodes` and
//     `reorder_map_node_kinds`, 0024 ships no counterpart, and api/map.ts's own
//     header records the gap and names `reorder_use_cases(p_ids uuid[])` in the
//     handoff. Up/down buttons are therefore NOT rendered here. A reorder
//     written as N PATCHes would contradict the argument every reorder in this
//     codebase rests on (a half-applied reorder leaves two rows sharing a
//     position, and only a single statement is atomic under PostgREST), and a
//     disabled pair of chevrons would be a control that explains nothing. The
//     list says instead that the order is the seeded one and cannot be changed
//     from here yet. When the RPC lands, `onMove` on the row renderer is the
//     one line that turns them on.
//   * NODE KINDS have `sort_order` with an RPC and therefore up/down, and they
//     have NO `hidden` column and therefore no Hide. Deleting one is not
//     refused: `map_nodes.kind_id` is `on delete set null`, so the nodes that
//     used it lose their kind and stay on the map.
//   * STAGES (0026) have both — `hidden` with use_cases' contract verbatim, and
//     `reorder_map_node_stages(p_ids uuid[])` — plus three columns neither
//     neighbour has: `terminal`, `paused` and `expected_days`.
//
// ── WHY THE STAGE LADDER'S ORDER IS NOT LIKE THE KINDS' ────────────────────
//
// Dragging a kind re-draws a list. Dragging a RUNG restates every goal in the
// workspace that was written as a count, because 0027 evaluates "at Go-live
// ready or beyond" as `sort_order >= that rung's` — so a drag changes which
// organizations meet a commitment nobody edited, retroactively, with no audit
// row against any goal. `reorder_map_node_stages`' own comment says the admin
// screen must say so BEFORE the drag is committed, and this screen says it
// twice: as a standing note under the section head, and as a confirmation the
// FIRST time a rung moves in a visit. Once, not every click — three clicks to
// move a rung three places is one intention, and a dialog on each would train
// the reader to dismiss the sentence it exists to make them read.
//
// ── THE THREE COLUMNS, AND WHERE EACH ONE IS EDITED ────────────────────────
//
// `hidden` is a two-state VERB and stays a row button, like a use case's.
// `terminal`, `paused` and `expected_days` are CONFIGURATION with consequences
// a sentence has to explain, so they live inside the row's editor where a
// deliberate Save commits them. The screen enforces nothing about how many
// rungs carry `terminal` or `paused` — neither does 0026, and two terminal
// rungs ("Live" and "Live with caveats") is a legal and meaningful ladder.
//
// ── AND WHY A MISSING TABLE IS NOT AN ERROR HERE ───────────────────────────
//
// 0026 is applied by hand, AFTER this code ships. Until it is, every read of
// `map_node_stages` comes back as PostgREST's "table not in the schema cache",
// which api/map.ts maps to `common.errMissingTable`. That is a SUPPORTED state,
// not a fault: the section renders the same "not configured yet" empty state it
// renders for a real, applied, empty table, and the two lists above it are
// untouched. store/auth.ts's loadPermissions is the house pattern — the feature
// whose table has not landed keeps a working default and says so, rather than
// failing the screen around it.
//
// HIDING IS NOT DELETING, AND THE UI SAYS SO IN BOTH DIRECTIONS. Hiding removes
// a capability from the pickers and never hides the links that already name it;
// deleting is refused by the database while any organization is still recorded
// against it (`on delete restrict`). That refusal must reach the admin as a
// sentence naming HOW MANY organizations still have it, not as a raw 23503 —
// so this screen counts the links on load and, where the count is non-zero,
// replaces the Delete button with the sentence and the Hide advice. The server
// error (`mapadmin.errUseCaseInUse`) is still mapped and still rendered: it is
// the backstop for the delete that raced another session between the count and
// the click, not the ordinary path.
//
// THE BLANK ARABIC NAME IS A JOB, NOT A BUG. All ten seeded capabilities ship
// with `name_ar = ''` on purpose (0024, types.ts) — this screen is where Aziz
// fills them in. So a blank Arabic name is announced as a badge on the row and
// counted once at the top of the section ("4 capabilities still have no Arabic
// name"), rather than rendering as an empty field that looks like a failed
// read.
//
// READS THROUGH api/map DIRECTLY, not through store/config, for the reason
// TracksAdmin and GroupsAdmin both give: this screen must see HIDDEN rows and
// must see its own writes on the next paint. Every mutation still calls
// invalidateConfig() so the rest of the app re-reads on its next render.

import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { IconArrowStart, IconChevronEnd } from '../../components/icons'
import { EmptyState, Skeleton } from '../../components/shared'
import { confirm } from '../../components/Confirm'
import { toast } from '../../components/toast'
import {
  createMapNodeKind,
  createMapNodeStage,
  createUseCase,
  deleteMapNodeKind,
  deleteMapNodeStage,
  deleteUseCase,
  getMapNodeStageUsage,
  listMapNodeKinds,
  listMapNodeStages,
  listMapNodes,
  listNodeUseCasesFor,
  listUseCases,
  reorderMapNodeKinds,
  reorderMapNodeStages,
  setMapNodeStageHidden,
  updateMapNodeKind,
  updateMapNodeStage,
  updateUseCase,
} from '../../api/map'
import { t, useLocale, type Locale } from '../../lib/i18n'
import { invalidateConfig } from '../../store/config'
import { useHasPerm } from '../../store/auth'
import type { MapNodeKind, MapNodeStage, MapNodeStageInput, UseCase } from '../../types'
import './catalogue.css'

/**
 * `use_cases_name_len_chk` (1..60), `map_node_kinds_name_len_chk` (1..40) and
 * `map_node_stages_name_len_chk` (1..40), mirrored rather than owned. The
 * server is still the authority; these three only stop a round trip that would
 * come back as a CHECK violation with no field named.
 *
 * STAGE_NAME_MAX is 40 and not 60 for `map_node_kinds`' reason, which 0026
 * repeats beside the constraint: a stage name is a word the admin chooses,
 * unlike an organization name chosen by a hospital.
 */
const USE_CASE_NAME_MAX = 60
const KIND_NAME_MAX = 40
const STAGE_NAME_MAX = 40

/**
 * `map_node_stages_expected_days_chk` — `expected_days is null or between 1 and
 * 3650`. 3650 is `vocab_options.sla_days`' bound and its reason: "10 years" is
 * a legitimate way to say "effectively none, but written down".
 */
const EXPECTED_DAYS_MAX = 3650

/**
 * The expected-days field's text as a value the API can take.
 *
 * THREE ANSWERS, NOT TWO, and the third is the point: `null` is "no threshold",
 * which is a real instruction the write path must send (api/map.ts:181's
 * lesson — a truthiness test turns every clearing into a silent no-op), while
 * `'bad'` is "the reader typed something the database would refuse". Collapsing
 * an unparseable value to null would silently erase a threshold somebody had
 * set, on a typo.
 */
function parseDays(raw: string): number | null | 'bad' {
  const text = raw.trim()
  if (text === '') return null
  // Digits only, so `12e3`, `+7`, `1.5` and ` 7 ` all fail here rather than at
  // the CHECK. Number('') is 0, which is why the empty case is answered first.
  if (!/^\d+$/.test(text)) return 'bad'
  const days = Number(text)
  if (days < 1 || days > EXPECTED_DAYS_MAX) return 'bad'
  return days
}

/**
 * A row's name in the given locale.
 *
 * `name_ar` is `not null default ''` on BOTH tables, so the test is for EMPTY
 * and never for null — `lib/labels.trackLabel`'s rule, and the reason the ten
 * seeded capabilities render their English names rather than a blank chip.
 */
function nameIn(row: { name: string; name_ar: string }, locale: Locale): string {
  if (locale === 'ar') return row.name_ar.trim() || row.name
  return row.name
}

/** One row's edit state, and the add form's. Strings: an empty field is a value. */
interface Draft {
  name: string
  nameAr: string
  /**
   * STAGES ONLY. Carried on every draft so one Draft type, one dirty check and
   * one Save path serve all three lists; the other two never render them and
   * never send them, so their values here are inert.
   */
  terminal: boolean
  paused: boolean
  /**
   * The RAW field text, not a number: '' is "no threshold", which is a VALUE
   * and not a missing one, and a `number | null` state could not hold the
   * half-typed "36" a reader is in the middle of.
   */
  expectedDays: string
}

const EMPTY_DRAFT: Draft = { name: '', nameAr: '', terminal: false, paused: false, expectedDays: '' }

type DraftErrors = Partial<Record<keyof Draft, string>>

/**
 * i18n KEYS, not sentences — the caller renders them through t().
 *
 * `stage` gates the day check rather than the caller doing it: the field is not
 * rendered for the other two lists, so an inert '' on their drafts must not
 * produce an error nobody can see or clear.
 */
function validate(draft: Draft, max: number, stage: boolean): DraftErrors {
  const errors: DraftErrors = {}
  const name = draft.name.trim()
  if (name === '') errors.name = 'catalogue.errNameRequired'
  else if (name.length > max) errors.name = 'catalogue.errNameLong'
  if (draft.nameAr.trim().length > max) errors.nameAr = 'catalogue.errNameLong'
  if (stage && parseDays(draft.expectedDays) === 'bad') {
    errors.expectedDays = 'catalogue.errExpectedDays'
  }
  return errors
}

/**
 * A row's draft. The three stage columns are optional in the parameter type so
 * a `UseCase` and a `MapNodeKind` — which have none of them — satisfy it and
 * land on the inert defaults.
 */
function draftFrom(row: {
  name: string
  name_ar: string
  terminal?: boolean
  paused?: boolean
  expected_days?: number | null
}): Draft {
  return {
    name: row.name,
    nameAr: row.name_ar,
    terminal: row.terminal ?? false,
    paused: row.paused ?? false,
    // `?? null` before String(): `expected_days` is nullable and null is the
    // seeded state on all seven rungs, so this is the ordinary path.
    expectedDays: (row.expected_days ?? null) === null ? '' : String(row.expected_days),
  }
}

/** Move `index` by `delta`, returning a new array. Out of range is a no-op. */
function moved<T>(rows: readonly T[], index: number, delta: number): readonly T[] {
  const target = index + delta
  if (target < 0 || target >= rows.length) return rows
  const next = rows.slice()
  const [row] = next.splice(index, 1)
  next.splice(target, 0, row)
  return next
}

/** Which list a row belongs to. Flattened into the open-editor id. */
type ListId = 'uc' | 'kind' | 'stage'

/**
 * The name bound for a list, in ONE place: it is asked for four times — the row
 * editor's `maxLength`, its validator, the add form's `maxLength` and its
 * validator — and a ternary repeated four times is four chances for the stage
 * list to inherit the use case's 60.
 */
function nameMax(list: ListId): number {
  if (list === 'uc') return USE_CASE_NAME_MAX
  if (list === 'kind') return KIND_NAME_MAX
  return STAGE_NAME_MAX
}

export default function CatalogueAdmin(): ReactElement {
  const locale = useLocale()
  // COSMETIC GATE, ASKING FOR `vocab.edit`. The real authority is 0023/0024's
  // RLS policies; every write here fails with 42501 for anyone without the key
  // whatever this returns. This file held the seventh byte-identical
  // `useIsAdmin`, which read `profiles.role` — a column 0025 keeps derived from
  // the SYSTEM roles only, so no custom role was visible to it. store/auth's
  // `useHasPerm` reads the grants, falls back to that column when 0025 is
  // unapplied, and carries the dev-only `?shell` flag this file used to repeat.
  //
  // ⚠ THIS IS THE ONE SCREEN 0025 SPLITS DOWN THE MIDDLE, and the split is
  //   recorded rather than designed around. `use_cases` — the ten-row half this
  //   screen is named for — takes `vocab.edit`. `map_node_kinds`, the three-row
  //   half below it, takes `structure.edit`, and so does
  //   `reorder_map_node_kinds()`. One key has to gate the route (App.tsx) and
  //   the screen, and `vocab.edit` is the one the larger half needs.
  //
  //   Nobody is affected today, which is why the second half is not separately
  //   withheld: Admin and Director both hold BOTH keys and no other role holds
  //   either, so nobody who can open this screen can be refused by half of it.
  //   IF A VOCAB-ONLY ROLE IS EVER MINTED, this is the file to come back to:
  //   gate the kinds <section> and its Add button on a second `useHasPerm`, the
  //   way TrackEditor.tsx withholds the SLA matrix. That costs no new strings.
  const canEdit = useHasPerm('vocab.edit')

  const [useCases, setUseCases] = useState<readonly UseCase[] | null>(null)
  const [kinds, setKinds] = useState<readonly MapNodeKind[] | null>(null)
  const [stages, setStages] = useState<readonly MapNodeStage[] | null>(null)
  /**
   * The stage read's own failure, kept OUT of the page-level `errorKey`.
   *
   * Two facts, two places. `errorKey` means "this screen could not load" and
   * replaces both lists with a retry card; a stage read that fails must not do
   * that, because until 0026 is applied by hand it fails on EVERY load and the
   * two lists above are perfectly fine. Null while the table is simply missing:
   * `common.errMissingTable` is routed to the empty state instead, so a project
   * without 0026 and a project with an empty ladder read identically.
   */
  const [stagesErrorKey, setStagesErrorKey] = useState<string | null>(null)
  /**
   * use_case_id → how many organizations are recorded against it, and
   * kind_id → how many nodes carry it.
   *
   * NULL MEANS "NOT COUNTED", NEVER ZERO, and the distinction is the whole
   * value of these two maps. A failed count that degraded to 0 would offer a
   * Delete button on a capability twelve hospitals are recorded against, and
   * the admin would meet the refusal as a red banner after the click instead of
   * as a sentence before it. When the count is unknown the screen says so once,
   * offers the delete anyway, and lets the database answer.
   */
  const [useCaseUsage, setUseCaseUsage] = useState<ReadonlyMap<string, number> | null>(null)
  const [kindUsage, setKindUsage] = useState<ReadonlyMap<string, number> | null>(null)
  const [errorKey, setErrorKey] = useState<string | null>(null)

  /** `uc:<id>` or `kind:<id>` — the row whose editor is open. One at a time. */
  const [openId, setOpenId] = useState<string | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [baseline, setBaseline] = useState<Draft | null>(null)
  const [submitted, setSubmitted] = useState(false)

  /** Which add form is open, and its draft. Also one at a time. */
  const [adding, setAdding] = useState<ListId | null>(null)
  const [addDraft, setAddDraft] = useState<Draft>(EMPTY_DRAFT)
  const [addSubmitted, setAddSubmitted] = useState(false)
  const [addBusy, setAddBusy] = useState(false)

  const [saving, setSaving] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  /** The one row currently showing a server error, and the i18n key it showed. */
  const [rowError, setRowError] = useState<{ id: string; key: string } | null>(null)
  const [liveMessage, setLiveMessage] = useState('')

  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])

  const load = useCallback(async () => {
    setErrorKey(null)
    setStagesErrorKey(null)
    // Four reads in parallel: none depends on another, and the screen is
    // unusable without the first two. The stage read is INDEPENDENTLY
    // survivable (see the header) and the node read is ADVISORY — it produces
    // the counts the delete confirmations name — so a failure in either sets
    // its own state rather than failing the screen.
    const [useCaseResult, kindResult, stageResult, nodeResult] = await Promise.all([
      listUseCases(true),
      listMapNodeKinds(),
      // No `includeHidden` argument, and that is api/map.ts's decision rather
      // than an omission: this read ALWAYS carries the hidden rungs, because
      // the admin cannot restore a rung it cannot see. The pickers derive their
      // visible slice from the same rows.
      listMapNodeStages(),
      listMapNodes(true),
    ])
    if (!alive.current) return

    // The ladder is settled FIRST, and unconditionally, so that the two early
    // returns below — a screen that failed on its own two lists — still leave
    // `stages` non-null. A null there would hold the loading skeleton up
    // forever behind an error card that has its own retry.
    if (stageResult.ok) {
      setStages(stageResult.data.rows)
    } else {
      setStages([])
      // 0026 not applied here yet. NOT AN ERROR: the empty state below names
      // the state and names the fix, and it is the same empty state an applied
      // but empty table gets. Anything else — a network failure, a policy
      // refusal — is a fact worth showing, so it keeps its sentence.
      if (stageResult.error !== 'common.errMissingTable') setStagesErrorKey(stageResult.error)
    }

    if (!useCaseResult.ok) {
      setErrorKey(useCaseResult.error)
      setUseCases([])
      setKinds(kindResult.ok ? kindResult.data.rows : [])
      return
    }
    if (!kindResult.ok) {
      setErrorKey(kindResult.error)
      setUseCases(useCaseResult.data.rows)
      setKinds([])
      return
    }
    setUseCases(useCaseResult.data.rows)
    setKinds(kindResult.data.rows)

    // THE LINK READ MOVED BELOW THE NODE READ, and the serial round trip is the
    // price of a read that can no longer be unbounded: listNodeUseCases lost its
    // optional argument (api/map.ts), so the bulk form names the nodes it is
    // about. It is asked for exactly the nodes counted above, which also makes
    // the count's denominator explicit instead of implied. Advisory, like the
    // node read: a failure sets the usage map to null rather than failing the
    // screen. `alive` is re-checked because this await is a second chance to
    // land after the screen has gone.
    const linkResult = await listNodeUseCasesFor(
      nodeResult.ok ? nodeResult.data.rows.map((n) => n.id) : [],
    )
    if (!alive.current) return

    if (linkResult.ok) {
      // DISTINCT NODES, not rows: the pair is the primary key, so one
      // organization contributes exactly one row per capability and a plain row
      // count is already the organization count. Counted through a Set anyway,
      // so the sentence stays true if the join ever grows a third key column.
      const seen = new Map<string, Set<string>>()
      for (const link of linkResult.data.rows) {
        const nodes = seen.get(link.use_case_id) ?? new Set<string>()
        nodes.add(link.node_id)
        seen.set(link.use_case_id, nodes)
      }
      setUseCaseUsage(new Map([...seen].map(([id, nodes]) => [id, nodes.size])))
    } else {
      setUseCaseUsage(null)
    }

    if (nodeResult.ok) {
      // INCLUDING ARCHIVED nodes, which is why listMapNodes is called with
      // true: deleting a kind nulls `kind_id` on an archived node exactly as it
      // does on a live one, and a count that quietly skipped them would
      // under-report what the delete is about to touch.
      const counts = new Map<string, number>()
      for (const node of nodeResult.data.rows) {
        if (node.kind_id === null) continue
        counts.set(node.kind_id, (counts.get(node.kind_id) ?? 0) + 1)
      }
      setKindUsage(counts)
    } else {
      setKindUsage(null)
    }
  }, [])

  useEffect(() => {
    if (canEdit) void load()
  }, [canEdit, load])

  // ---- focus choreography -------------------------------------------------
  // Two maps rather than one: a reorder returns focus to a move button, a
  // closed editor returns it to the Edit button that opened it. Both live
  // inside a list React re-keys freely, so the refs are collected by callback.
  const moveButtons = useRef(new Map<string, HTMLButtonElement>())
  const editButtons = useRef(new Map<string, HTMLButtonElement>())
  const firstField = useRef<HTMLInputElement>(null)
  const addFirstField = useRef<HTMLInputElement>(null)
  /** `${id}:up|down` — which move button to focus after the next paint. */
  const focusAfterMove = useRef<string | null>(null)
  /** The id of the Edit button to focus once an editor closes. */
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

  useEffect(() => {
    if (adding) addFirstField.current?.focus()
  }, [adding])

  // ---- shared plumbing ----------------------------------------------------

  const dirty =
    draft !== null &&
    baseline !== null &&
    (draft.name !== baseline.name ||
      draft.nameAr !== baseline.nameAr ||
      // The three stage columns are compared for every list, not only for
      // stages: they are seeded identically from the row on both sides, so the
      // comparison is false by construction for a use case or a kind, and a
      // list-aware check here would be a branch that can only ever answer one
      // way.
      draft.terminal !== baseline.terminal ||
      draft.paused !== baseline.paused ||
      draft.expectedDays !== baseline.expectedDays)

  /**
   * pgErrorKey's catch-all says less than this screen's own headline; anything
   * more specific — `mapadmin.errUseCaseInUse`, `mapadmin.errUseCaseNameTaken`,
   * `admin.errForbidden`, `common.errMissingTable` — is worth showing verbatim.
   */
  function saveErrorKey(key: string): string {
    return key === 'common.error' ? 'catalogue.errSave' : key
  }

  function failRow(id: string, key: string): void {
    const shown = saveErrorKey(key)
    setRowError({ id, key: shown })
    toast(t(shown), { tone: 'error' })
  }

  function clearEditor(): void {
    setOpenId(null)
    setDraft(null)
    setBaseline(null)
    setSubmitted(false)
  }

  /** The unsaved-work guard. Resolves true when it is safe to drop the draft. */
  async function confirmDiscard(): Promise<boolean> {
    if (!dirty) return true
    const ok = await confirm({
      title: t('catalogue.discardTitle'),
      body: t('catalogue.discardBody'),
      confirmLabel: t('catalogue.discard'),
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
  async function toggleEdit(id: string, row: UseCase | MapNodeKind | MapNodeStage): Promise<void> {
    if (openId === id) {
      await closeEditor(id)
      return
    }
    if (!(await confirmDiscard())) return
    // draftFrom(), not a two-field literal: a stage's three columns have to
    // arrive in the draft AND in the baseline, or the dirty check reads every
    // freshly opened rung as already edited.
    const next: Draft = draftFrom(row)
    setOpenId(id)
    setDraft(next)
    setBaseline(next)
    setSubmitted(false)
    setRowError(null)
  }

  // ---- reorder (node kinds and stages — use cases have no RPC) -------------

  /**
   * A person moving a row three places clicks three times in under a second, so
   * a stale reply must not report a failure the newer write already fixed.
   *
   * ONE SEQUENCE PER LIST, not one for the screen: the two counters are compared
   * only against replies from their own RPC, and a shared counter would let a
   * kind's reply cancel a stage's — the two lists are moved by the same thumb
   * seconds apart while the first request is still in flight.
   */
  const kindOrderSeq = useRef(0)
  const stageOrderSeq = useRef(0)

  const persistKindOrder = useCallback(
    async (next: readonly MapNodeKind[]) => {
      const seq = (kindOrderSeq.current += 1)
      const result = await reorderMapNodeKinds(next.map((row) => row.id))
      if (!alive.current || seq !== kindOrderSeq.current) return
      if (!result.ok) {
        toast(t(saveErrorKey(result.error)), { tone: 'error' })
        // Re-read rather than restore a captured array: after several rapid
        // moves the captured one is itself stale, and the server's order is the
        // only description of the list that is certainly true.
        void load()
        return
      }
      invalidateConfig()
      // The move is already visible; what the toast adds is that it PERSISTED.
      // Without it a rejected write and an accepted one look identical.
      toast(t('catalogue.reordered'))
    },
    [load],
  )

  const persistStageOrder = useCallback(
    async (next: readonly MapNodeStage[]) => {
      const seq = (stageOrderSeq.current += 1)
      const result = await reorderMapNodeStages(next.map((row) => row.id))
      if (!alive.current || seq !== stageOrderSeq.current) return
      if (!result.ok) {
        // `mapadmin.errStageReorderDenied` arrives here when the account holds
        // `vocab.edit` but not `structure.edit` — the split this file's gate
        // comment records. Without 0026's token that refusal would be a silent
        // zero-row update reported to the reader as a successful drag.
        toast(t(saveErrorKey(result.error)), { tone: 'error' })
        void load()
        return
      }
      invalidateConfig()
      toast(t('catalogue.reordered'))
    },
    [load],
  )

  /**
   * The half of a move that is identical for both reorderable lists: the live
   * region carries the new POSITION, and focus follows the ROW.
   *
   * Shared rather than copied, because the copy is where `kind:` gets left in
   * the stage list's focus key — which drops focus onto the document on every
   * drag and shows up in no test that does not press a key twice.
   */
  function announceMove(
    list: ListId,
    row: { id: string; name: string; name_ar: string },
    landed: number,
    total: number,
    delta: number,
  ): void {
    setLiveMessage(
      t('catalogue.movedTo', { name: nameIn(row, locale), position: landed + 1, total }),
    )
    const pressed = delta < 0 ? 'up' : 'down'
    // Focus follows the row, not the position: the pressed button goes disabled
    // once the row reaches the end of the list, so focus lands on its twin
    // instead of being dropped back onto the document.
    const stillEnabled = delta < 0 ? landed > 0 : landed < total - 1
    const twin = pressed === 'up' ? 'down' : 'up'
    focusAfterMove.current = `${list}:${row.id}:${stillEnabled ? pressed : twin}`
  }

  function moveKind(index: number, delta: number): void {
    if (!kinds) return
    const next = moved(kinds, index, delta)
    if (next === kinds) return
    announceMove('kind', kinds[index], index + delta, next.length, delta)
    setKinds(next)
    void persistKindOrder(next)
  }

  /**
   * Whether this visit has already been told what reordering the ladder does.
   *
   * ONCE A VISIT, NOT ONCE A CLICK. Moving a rung three places is one intention
   * and three clicks; a dialog on each would train the reader to dismiss the
   * sentence it exists to make them read. A ref rather than state because
   * nothing renders from it — flipping it must not repaint the list mid-drag.
   */
  const reorderWarned = useRef(false)

  /**
   * ⚠ THE CONFIRMATION IS THE POINT, not the reorder. `reorder_map_node_stages`'
   *   own comment says the admin screen must say BEFORE the drag is committed
   *   that a goal reading "40 organizations at Go-live ready or beyond" is
   *   evaluated as `sort_order >= that rung's`, so moving a rung changes which
   *   organizations meet commitments nobody edited, retroactively, with no audit
   *   row against any goal. The RPC cannot detect that afterwards.
   */
  async function moveStage(index: number, delta: number): Promise<void> {
    if (!stages) return
    const next = moved(stages, index, delta)
    if (next === stages) return
    const row = stages[index]
    const landed = index + delta

    if (!reorderWarned.current) {
      const ok = await confirm({
        title: t('catalogue.reorderStagesTitle'),
        body: t('catalogue.reorderStagesBody'),
        confirmLabel: t('catalogue.reorderStagesConfirm'),
        cancelLabel: t('common.cancel'),
      })
      if (!ok || !alive.current) return
      reorderWarned.current = true
    }

    announceMove('stage', row, landed, next.length, delta)
    setStages(next)
    void persistStageOrder(next)
  }

  // ---- save ---------------------------------------------------------------

  async function saveRow(
    list: ListId,
    id: string,
    row: UseCase | MapNodeKind | MapNodeStage,
  ): Promise<void> {
    if (!draft) return
    setSubmitted(true)
    setRowError(null)
    const max = nameMax(list)
    if (Object.keys(validate(draft, max, list === 'stage')).length > 0) return

    const rowId = `${list}:${id}`
    const name = draft.name.trim()
    const nameAr = draft.nameAr.trim()
    // Only the fields that actually changed: `undefined` means "leave alone" in
    // all three patch types, and a blanket overwrite would clobber a column
    // another admin edited while this editor sat open.
    //
    // Typed as the stage input because it is the widest of the three — the two
    // narrower calls below take it because the stage-only keys are added only
    // under `list === 'stage'`, so a use case's patch is never carrying one.
    const patch: Partial<MapNodeStageInput> = {}
    if (name !== row.name) patch.name = name
    if (nameAr !== row.name_ar) patch.nameAr = nameAr
    if (list === 'stage') {
      const stage = row as MapNodeStage
      if (draft.terminal !== stage.terminal) patch.terminal = draft.terminal
      if (draft.paused !== stage.paused) patch.paused = draft.paused
      const days = parseDays(draft.expectedDays)
      // `days` cannot be 'bad' here — validate() returned above on that — but
      // the test is written rather than asserted: narrowing it any other way
      // would need a cast, and a cast is what stops being true when the field
      // grows a third answer.
      //
      // `!== undefined` is what api/map.ts sends, so `null` reaches the column
      // as "this rung has no expectation". A truthiness test here would turn
      // every clearing into a silent no-op.
      if (days !== 'bad' && days !== (stage.expected_days ?? null)) patch.expectedDays = days
    }

    if (Object.keys(patch).length === 0) {
      // Nothing to write. Closing is the honest answer — a PATCH of no columns
      // would round-trip to report that nothing happened.
      focusAfterClose.current = rowId
      clearEditor()
      return
    }

    setBusyId(rowId)
    setSaving(true)
    const result =
      list === 'uc'
        ? await updateUseCase(id, patch)
        : list === 'kind'
          ? await updateMapNodeKind(id, patch)
          : await updateMapNodeStage(id, patch)
    if (!alive.current) return
    setSaving(false)
    setBusyId(null)
    if (!result.ok) {
      failRow(rowId, result.error)
      return
    }
    if (list === 'uc') {
      const saved = result.data as UseCase
      setUseCases((current) => current?.map((r) => (r.id === id ? saved : r)) ?? current)
    } else if (list === 'kind') {
      const saved = result.data as MapNodeKind
      setKinds((current) => current?.map((r) => (r.id === id ? saved : r)) ?? current)
    } else {
      const saved = result.data as MapNodeStage
      setStages((current) => current?.map((r) => (r.id === id ? saved : r)) ?? current)
    }
    invalidateConfig()
    focusAfterClose.current = rowId
    clearEditor()
    toast(t('catalogue.saved', { name: nameIn(result.data, locale) }))
  }

  // ---- hide / show (use cases and stages — kinds have no such column) ------

  /**
   * Retire a rung from the pickers, or bring it back.
   *
   * `setMapNodeStageHidden` rather than `updateMapNodeStage(id, { hidden })`,
   * which would do the same thing: api/map.ts gives hiding its own function so
   * the two operations are distinguishable at the call site, and this is the
   * call site.
   *
   * NOTHING IS UN-STAGED. `use_cases.hidden`'s contract verbatim: the rung
   * leaves the pickers and the organizations standing on it keep standing on it,
   * which is why this is offered as the better verb in the delete dialog.
   */
  async function toggleStageHidden(row: MapNodeStage): Promise<void> {
    const id = `stage:${row.id}`
    setBusyId(id)
    setRowError(null)
    const result = await setMapNodeStageHidden(row.id, !row.hidden)
    if (!alive.current) return
    setBusyId(null)
    if (!result.ok) {
      failRow(id, result.error)
      return
    }
    const saved = result.data
    setStages((current) => current?.map((r) => (r.id === row.id ? saved : r)) ?? current)
    invalidateConfig()
    toast(t('catalogue.saved', { name: nameIn(saved, locale) }))
  }

  async function toggleHidden(row: UseCase): Promise<void> {
    const id = `uc:${row.id}`
    setBusyId(id)
    setRowError(null)
    const result = await updateUseCase(row.id, { hidden: !row.hidden })
    if (!alive.current) return
    setBusyId(null)
    if (!result.ok) {
      failRow(id, result.error)
      return
    }
    const saved = result.data
    setUseCases((current) => current?.map((r) => (r.id === row.id ? saved : r)) ?? current)
    invalidateConfig()
    toast(t('catalogue.saved', { name: nameIn(saved, locale) }))
  }

  // ---- delete -------------------------------------------------------------

  async function removeUseCase(row: UseCase): Promise<void> {
    const label = nameIn(row, locale)
    const ok = await confirm({
      title: t('catalogue.deleteUseCaseTitle', { name: label }),
      body: t('catalogue.deleteUseCaseBody'),
      confirmLabel: t('catalogue.deleteConfirm'),
      cancelLabel: t('common.cancel'),
      danger: true,
    })
    if (!ok || !alive.current) return
    const id = `uc:${row.id}`
    setBusyId(id)
    setRowError(null)
    const result = await deleteUseCase(row.id)
    if (!alive.current) return
    setBusyId(null)
    if (!result.ok) {
      // The backstop, not the ordinary path: the count above normally replaces
      // the button with a sentence. This is the delete that raced another
      // session, and `mapadmin.errUseCaseInUse` is the sentence for it.
      failRow(id, result.error)
      return
    }
    if (openId === id) clearEditor()
    setUseCases((current) => current?.filter((r) => r.id !== row.id) ?? current)
    invalidateConfig()
    setLiveMessage(t('catalogue.deleted', { name: label }))
    toast(t('catalogue.deleted', { name: label }))
  }

  async function removeKind(row: MapNodeKind): Promise<void> {
    const label = nameIn(row, locale)
    const used = kindUsage?.get(row.id) ?? 0
    const ok = await confirm({
      title: t('catalogue.deleteKindTitle', { name: label }),
      // The count leads, because it is the part nobody would think to ask for:
      // `map_nodes.kind_id` is `on delete set null`, so this delete SUCCEEDS and
      // quietly un-kinds however many nodes carried it.
      body:
        kindUsage === null
          ? t('catalogue.deleteKindBody')
          : `${t('catalogue.kindUsage', { count: used })} — ${t('catalogue.deleteKindBody')}`,
      confirmLabel: t('catalogue.deleteConfirm'),
      cancelLabel: t('common.cancel'),
      danger: true,
    })
    if (!ok || !alive.current) return
    const id = `kind:${row.id}`
    setBusyId(id)
    setRowError(null)
    const result = await deleteMapNodeKind(row.id)
    if (!alive.current) return
    setBusyId(null)
    if (!result.ok) {
      failRow(id, result.error)
      return
    }
    if (openId === id) clearEditor()
    setKinds((current) => current?.filter((r) => r.id !== row.id) ?? current)
    invalidateConfig()
    setLiveMessage(t('catalogue.deleted', { name: label }))
    toast(t('catalogue.deleted', { name: label }))
  }

  /**
   * Retire a rung.
   *
   * ⚠ THE COUNTS ARE READ FIRST AND THE DIALOG NAMES THEM, because nothing
   *   refuses this delete. `map_node_progress.stage_id` and
   *   `map_node_goals.stage_id` are BOTH `on delete set null`: deleting
   *   Testing/UAT un-stages the twelve organizations standing on it and blanks
   *   the rung out of every goal that named it, silently and with no error to
   *   render afterwards. That is the opposite of a use case, where an
   *   `on delete restrict` refuses on the admin's behalf — here the sentence IS
   *   the guard, and it has to be true before the click rather than discovered
   *   after it.
   *
   * A failed count says so rather than reading as two zeros: "0 organizations
   * sit at this stage" on a rung twelve are standing on is the one sentence
   * worse than saying nothing.
   */
  async function removeStage(row: MapNodeStage): Promise<void> {
    const label = nameIn(row, locale)
    const id = `stage:${row.id}`
    setBusyId(id)
    setRowError(null)
    const usage = await getMapNodeStageUsage(row.id)
    if (!alive.current) return
    setBusyId(null)
    const counted = usage.ok
      ? `${t('catalogue.stageUsageNodes', { count: usage.data.progress })} ${t('catalogue.stageUsageGoals', { count: usage.data.goals })}`
      : t('catalogue.stageUsageUnknown')
    const ok = await confirm({
      title: t('catalogue.deleteStageTitle', { name: label }),
      body: `${counted} ${t('catalogue.deleteStageBody')}`,
      confirmLabel: t('catalogue.deleteConfirm'),
      cancelLabel: t('common.cancel'),
      danger: true,
    })
    if (!ok || !alive.current) return
    setBusyId(id)
    const result = await deleteMapNodeStage(row.id)
    if (!alive.current) return
    setBusyId(null)
    if (!result.ok) {
      failRow(id, result.error)
      return
    }
    if (openId === id) clearEditor()
    setStages((current) => current?.filter((r) => r.id !== row.id) ?? current)
    invalidateConfig()
    setLiveMessage(t('catalogue.deleted', { name: label }))
    toast(t('catalogue.deleted', { name: label }))
  }

  // ---- add ----------------------------------------------------------------

  function openAdd(list: ListId): void {
    setAdding((current) => (current === list ? null : list))
    setAddDraft(EMPTY_DRAFT)
    setAddSubmitted(false)
  }

  async function submitAdd(list: ListId): Promise<void> {
    setAddSubmitted(true)
    const max = nameMax(list)
    if (Object.keys(validate(addDraft, max, list === 'stage')).length > 0) return
    setAddBusy(true)
    const input = { name: addDraft.name.trim(), nameAr: addDraft.nameAr.trim() }
    const days = parseDays(addDraft.expectedDays)
    const result =
      list === 'uc'
        ? await createUseCase({ ...input, hidden: false })
        : list === 'kind'
          ? await createMapNodeKind(input)
          : // A new rung carries its flags and its threshold from the form it
            // was typed into rather than from the column defaults, so a rung
            // added as terminal is terminal on its first paint. `days` is 'bad'
            // only on a path validate() already returned on.
            await createMapNodeStage({
              ...input,
              hidden: false,
              terminal: addDraft.terminal,
              paused: addDraft.paused,
              expectedDays: days === 'bad' ? null : days,
            })
    if (!alive.current) return
    setAddBusy(false)
    if (!result.ok) {
      toast(t(saveErrorKey(result.error)), { tone: 'error' })
      return
    }
    if (list === 'uc') {
      const created = result.data as UseCase
      setUseCases((current) => (current ? [...current, created] : [created]))
    } else if (list === 'kind') {
      const created = result.data as MapNodeKind
      setKinds((current) => (current ? [...current, created] : [created]))
    } else {
      // Appended, because `nextSortOrder` puts it at the end of the ladder —
      // which is what the add form's hint says, and the reason the reorder
      // controls are the next thing the admin reaches for.
      const created = result.data as MapNodeStage
      setStages((current) => (current ? [...current, created] : [created]))
    }
    invalidateConfig()
    setAdding(null)
    setAddDraft(EMPTY_DRAFT)
    setAddSubmitted(false)
    const label = nameIn(result.data, locale)
    setLiveMessage(t('catalogue.added', { name: label }))
    toast(t('catalogue.added', { name: label }))
  }

  // ---- derived ------------------------------------------------------------

  /**
   * How many capabilities are still untranslated. Counted over the WHOLE list,
   * hidden rows included: a hidden capability still appears on every screen
   * that shows what an organization already integrated, so it still needs its
   * Arabic name.
   */
  const arabicPending = useMemo(
    () => (useCases ?? []).filter((row) => row.name_ar.trim() === '').length,
    [useCases],
  )

  /**
   * The same job for the ladder, and it is the same seeded state: 0026 ships all
   * seven rungs with `name_ar = ''` on purpose, because those seven words are
   * the programme's own vocabulary. Counted over the hidden rungs too — a hidden
   * rung still names where an organization stood.
   */
  const stagesArabicPending = useMemo(
    () => (stages ?? []).filter((row) => row.name_ar.trim() === '').length,
    [stages],
  )

  /**
   * Whether ANY rung carries a threshold. While none does, nothing anywhere in
   * the app is counted as stalled — which is 0026's deliberate shipped state and
   * therefore a fact to NAME rather than a blank to leave the reader to infer.
   * `expected_days` is null on every seeded rung.
   */
  const anyThreshold = useMemo(
    () => (stages ?? []).some((row) => row.expected_days !== null),
    [stages],
  )

  if (!canEdit) return <Navigate to="/settings" replace />

  // `stages` is in the loading test even though its read is independently
  // survivable, and load() settles it FIRST for exactly that reason: on the path
  // where the two lists above failed, a null here would hold this skeleton up
  // forever behind an error card that has its own retry.
  const loading = useCases === null || kinds === null || stages === null
  const openList: ListId | null = openId ? (openId.split(':')[0] as ListId) : null
  const errors: DraftErrors = draft
    ? validate(draft, nameMax(openList ?? 'uc'), openList === 'stage')
    : {}
  const addErrors: DraftErrors = validate(
    addDraft,
    nameMax(adding ?? 'uc'),
    adding === 'stage',
  )

  /**
   * The three stage-only fields, rendered into both the row editor and the add
   * form from one place.
   *
   * ONE COPY, because the two copies would drift on the sentence rather than on
   * the control: `terminal` and `paused` are not labels, they are claims about
   * what a rung MEANS to every count in the app, and the version of that
   * sentence a reader meets must not depend on whether they are adding a rung or
   * editing one.
   */
  const renderStageFields = (
    prefix: string,
    value: Draft,
    onChange: (next: Draft) => void,
    fieldErrors: DraftErrors,
    showErrors: boolean,
  ): ReactElement => (
    <>
      <div className="cat-flags">
        {/* role="switch" over global.css's `.switch`, NotificationPrefs' pattern:
            the whole row is the control so the sentence is part of the 44px
            target, and `aria-checked` is repeated on the visual span because
            that attribute IS the primitive's styling contract. The span is
            aria-hidden, so only the button is announced. */}
        <button
          type="button"
          className="cat-toggle"
          role="switch"
          aria-checked={value.terminal}
          aria-describedby={`${prefix}-terminal-hint`}
          onClick={() => onChange({ ...value, terminal: !value.terminal })}
        >
          <span className="cat-toggle-text">
            <span className="cat-toggle-label">{t('catalogue.terminalLabel')}</span>
            <span className="cat-hint" id={`${prefix}-terminal-hint`}>
              {t('catalogue.terminalHint')}
            </span>
          </span>
          <span className="switch" aria-hidden="true" aria-checked={value.terminal} />
        </button>
        <button
          type="button"
          className="cat-toggle"
          role="switch"
          aria-checked={value.paused}
          aria-describedby={`${prefix}-paused-hint`}
          onClick={() => onChange({ ...value, paused: !value.paused })}
        >
          <span className="cat-toggle-text">
            <span className="cat-toggle-label">{t('catalogue.pausedLabel')}</span>
            <span className="cat-hint" id={`${prefix}-paused-hint`}>
              {t('catalogue.pausedHint')}
            </span>
          </span>
          <span className="switch" aria-hidden="true" aria-checked={value.paused} />
        </button>
      </div>

      <div className="field">
        <label className="field-label" htmlFor={`${prefix}-days`}>
          {t('catalogue.expectedDaysLabel')}
        </label>
        {/* inputMode + pattern rather than type="number": a spinner on a field
            whose empty state is a MEANING ("no threshold") invites a scroll
            wheel to invent a 1, and Safari's number input silently drops a
            value it cannot parse — which would erase a threshold on a typo.
            The digits keyboard is what the phone actually needs. */}
        <input
          id={`${prefix}-days`}
          className="input cat-days tabular"
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          maxLength={4}
          autoComplete="off"
          value={value.expectedDays}
          aria-invalid={showErrors && fieldErrors.expectedDays ? true : undefined}
          aria-describedby={`${prefix}-days-hint`}
          onChange={(e) => onChange({ ...value, expectedDays: e.target.value })}
        />
        {showErrors && fieldErrors.expectedDays ? (
          <p className="field-error" id={`${prefix}-days-hint`}>
            {t(fieldErrors.expectedDays, { max: EXPECTED_DAYS_MAX })}
          </p>
        ) : (
          // The empty state is NAMED here rather than left to be discovered:
          // blank means this rung has no threshold and nothing standing on it is
          // ever flagged, which is the shipped state of all seven rungs.
          <p className="cat-hint" id={`${prefix}-days-hint`}>
            {t('catalogue.expectedDaysHint', { max: EXPECTED_DAYS_MAX })}
          </p>
        )}
      </div>
    </>
  )

  /** One catalogue row, for any of the three lists. `onMove` null means "no reorder here". */
  const renderRow = (spec: {
    list: ListId
    row: UseCase | MapNodeKind | MapNodeStage
    index: number
    total: number
    max: number
    hidden: boolean
    badges: ReactElement[]
    blocked: string | null
    onMove: ((delta: number) => void) | null
    onHide: (() => void) | null
    onDelete: () => void
  }): ReactElement => {
    const { list, row, index, total, max, hidden, badges, blocked, onMove, onHide, onDelete } = spec
    const id = `${list}:${row.id}`
    const label = nameIn(row, locale)
    const open = openId === id
    const busy = busyId === id
    // Always the OTHER language, never a repeat of the primary line: in Arabic
    // nameIn() already returns name_ar, so keying this to name_ar
    // unconditionally would print the same name twice.
    const altLang: Locale = locale === 'ar' ? 'en' : 'ar'
    const alt = (locale === 'ar' ? row.name : row.name_ar).trim()
    const secondary = alt && alt !== label ? alt : ''

    return (
      // Variants ride on data-* attributes rather than modifier classes: §1.0.7
      // grants this sheet the `.cat-*` names and nothing else, so `.is-open`
      // would be an unregistered global.
      <li
        key={row.id}
        className="cat-row"
        data-hidden={hidden ? 'true' : undefined}
        data-open={open ? 'true' : undefined}
      >
        <div className="cat-row-head">
          {onMove && (
            <div className="cat-moves" role="group" aria-label={t('catalogue.order')}>
              <button
                type="button"
                className="btn btn-sm btn-icon cat-move"
                aria-label={t('catalogue.moveUp', { name: label })}
                disabled={index === 0}
                ref={(el) => {
                  if (el) moveButtons.current.set(`${id}:up`, el)
                  else moveButtons.current.delete(`${id}:up`)
                }}
                onClick={() => onMove(-1)}
              >
                {/* One chevron glyph, rotated in CSS. Up and down are
                    axis-neutral, so this deliberately does NOT carry
                    .icon-directional — mirroring it in Arabic would point it
                    sideways. */}
                <IconChevronEnd className="cat-move-icon cat-move-up" size={16} />
              </button>
              <button
                type="button"
                className="btn btn-sm btn-icon cat-move"
                aria-label={t('catalogue.moveDown', { name: label })}
                disabled={index === total - 1}
                ref={(el) => {
                  if (el) moveButtons.current.set(`${id}:down`, el)
                  else moveButtons.current.delete(`${id}:down`)
                }}
                onClick={() => onMove(1)}
              >
                <IconChevronEnd className="cat-move-icon cat-move-down" size={16} />
              </button>
            </div>
          )}

          <div className="cat-row-main">
            <p className="cat-name">{label}</p>
            {/* The other language always shows beneath the current one: an
                admin filling in Arabic names needs both halves of the pair at
                once, and `lang` gives the Arabic line an Arabic face while the
                UI is English. */}
            {secondary && (
              <p className="cat-alt" lang={altLang} dir={altLang === 'ar' ? 'rtl' : 'ltr'}>
                {secondary}
              </p>
            )}
            {badges.length > 0 && <div className="cat-badges">{badges}</div>}
          </div>

          <div className="cat-row-actions">
            <button
              type="button"
              className="btn btn-sm"
              aria-expanded={open}
              aria-label={t(open ? 'catalogue.closeRow' : 'catalogue.editRow', { name: label })}
              disabled={busy}
              ref={(el) => {
                if (el) editButtons.current.set(id, el)
                else editButtons.current.delete(id)
              }}
              onClick={() => void toggleEdit(id, row)}
            >
              {t(open ? 'common.close' : 'common.edit')}
            </button>
            {onHide && (
              <button
                type="button"
                className="btn btn-sm"
                aria-label={t(hidden ? 'catalogue.showRow' : 'catalogue.hideRow', { name: label })}
                disabled={busy}
                onClick={onHide}
              >
                {t(hidden ? 'catalogue.show' : 'catalogue.hide')}
              </button>
            )}
            {blocked === null ? (
              <button
                type="button"
                className="btn btn-sm btn-ghost"
                aria-label={t('catalogue.deleteRow', { name: label })}
                disabled={busy}
                onClick={onDelete}
              >
                {t('catalogue.delete')}
              </button>
            ) : (
              // The sentence REPLACES the button rather than sitting beside a
              // disabled one: the database will refuse this delete, and a
              // disabled control with no explanation reads as a bug.
              <p className="cat-blocked">{blocked}</p>
            )}
          </div>
        </div>

        {rowError?.id === id && (
          <p className="field-error" role="alert">
            {t(rowError.key)}
          </p>
        )}

        {open && draft && (
          <form
            className="cat-editor"
            onSubmit={(e) => {
              e.preventDefault()
              void saveRow(list, row.id, row)
            }}
          >
            <div className="cat-fields">
              <div className="field">
                <label className="field-label" htmlFor={`${id}-name`}>
                  {t('catalogue.nameEn')}
                </label>
                <input
                  id={`${id}-name`}
                  ref={firstField}
                  className="input"
                  lang="en"
                  dir="ltr"
                  maxLength={max}
                  autoComplete="off"
                  value={draft.name}
                  aria-invalid={submitted && errors.name ? true : undefined}
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                />
                {submitted && errors.name && (
                  <p className="field-error">{t(errors.name, { max })}</p>
                )}
              </div>
              <div className="field">
                <label className="field-label" htmlFor={`${id}-name-ar`}>
                  {t('catalogue.nameAr')}
                </label>
                {/* lang + dir on the CONTROL: an Arabic name typed into an
                    otherwise English page has its punctuation resolved against
                    the wrong paragraph direction while it is being typed, which
                    is the one place the user can see the bug and not the
                    cause. */}
                <input
                  id={`${id}-name-ar`}
                  className="input"
                  lang="ar"
                  dir="rtl"
                  maxLength={max}
                  autoComplete="off"
                  value={draft.nameAr}
                  aria-invalid={submitted && errors.nameAr ? true : undefined}
                  onChange={(e) => setDraft({ ...draft, nameAr: e.target.value })}
                />
                {submitted && errors.nameAr ? (
                  <p className="field-error">{t(errors.nameAr, { max })}</p>
                ) : (
                  <p className="cat-hint">{t('catalogue.nameArHint')}</p>
                )}
              </div>
            </div>

            {/* `terminal`, `paused` and `expected_days` are CONFIGURATION with
                consequences a sentence has to explain, so they live behind a
                deliberate Save rather than beside Hide as one-tap row buttons.
                `hidden` is a two-state verb and stays where it is. */}
            {list === 'stage' &&
              renderStageFields(id, draft, (next) => setDraft(next), errors, submitted)}

            <div className="cat-editor-actions">
              {/* The badge is what makes Cancel legible: "Cancel" with nothing
                  changed is a control with no referent. */}
              {dirty && <span className="pill warn">{t('catalogue.unsaved')}</span>}
              <button
                type="submit"
                className="btn btn-primary btn-sm"
                disabled={saving || busy || !dirty}
              >
                {saving ? t('catalogue.saving') : t('catalogue.save')}
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
  }

  /** The add form, shared by all three sections. */
  const renderAdd = (
    list: ListId,
    max: number,
    hintKey: string,
    titleKey: string,
  ): ReactElement => (
    // aria-label rather than a visible heading: the section already has an h2
    // and a button that says what this form is for, so a third copy of the
    // words would be noise in the outline — but the form still needs a name of
    // its own, because on a phone it opens below the fold and a screen reader
    // meets it with no context.
    <form
      className="cat-editor"
      aria-label={t(titleKey)}
      onSubmit={(e) => {
        e.preventDefault()
        void submitAdd(list)
      }}
    >
      <p className="cat-hint">{t(hintKey)}</p>
      <div className="cat-fields">
        <div className="field">
          <label className="field-label" htmlFor={`cat-add-${list}-name`}>
            {t('catalogue.nameEn')}
          </label>
          <input
            id={`cat-add-${list}-name`}
            ref={addFirstField}
            className="input"
            lang="en"
            dir="ltr"
            maxLength={max}
            autoComplete="off"
            value={addDraft.name}
            aria-invalid={addSubmitted && addErrors.name ? true : undefined}
            onChange={(e) => setAddDraft({ ...addDraft, name: e.target.value })}
          />
          {addSubmitted && addErrors.name && (
            <p className="field-error">{t(addErrors.name, { max })}</p>
          )}
        </div>
        <div className="field">
          <label className="field-label" htmlFor={`cat-add-${list}-name-ar`}>
            {t('catalogue.nameAr')}
          </label>
          <input
            id={`cat-add-${list}-name-ar`}
            className="input"
            lang="ar"
            dir="rtl"
            maxLength={max}
            autoComplete="off"
            value={addDraft.nameAr}
            aria-invalid={addSubmitted && addErrors.nameAr ? true : undefined}
            onChange={(e) => setAddDraft({ ...addDraft, nameAr: e.target.value })}
          />
          {addSubmitted && addErrors.nameAr ? (
            <p className="field-error">{t(addErrors.nameAr, { max })}</p>
          ) : (
            <p className="cat-hint">{t('catalogue.nameArHint')}</p>
          )}
        </div>
      </div>

      {/* The same three fields the row editor shows, so a rung can be added
          terminal instead of being added and then edited — createMapNodeStage
          sends all three explicitly. */}
      {list === 'stage' &&
        renderStageFields(`cat-add-${list}`, addDraft, setAddDraft, addErrors, addSubmitted)}

      <div className="cat-editor-actions">
        <button type="submit" className="btn btn-primary btn-sm" disabled={addBusy}>
          {addBusy ? t('catalogue.adding') : t('catalogue.addSubmit')}
        </button>
        <button
          type="button"
          className="btn btn-sm btn-ghost"
          disabled={addBusy}
          onClick={() => setAdding(null)}
        >
          {t('catalogue.cancelAdd')}
        </button>
      </div>
    </form>
  )

  return (
    <div className="cat">
      <div className="cat-bar">
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
      <div className="cat-intro">
        <p className="cat-intro-lead">{t('catalogue.subtitle')}</p>
        {/* WHY this screen may add and delete when Vocabulary may not. Without
            this paragraph the next reader assumes one of the two screens is
            wrong — see this file's header. */}
        <p className="cat-why">{t('catalogue.whyEditable')}</p>
        <p className="cat-note">{t('catalogue.hideVsDelete')}</p>
      </div>

      {/* Polite, not assertive: every message here follows an action the admin
          just took deliberately, so it should queue behind whatever is being
          read rather than interrupt it. */}
      <p className="sr-only" role="status" aria-live="polite">
        {liveMessage}
      </p>

      {loading && <Skeleton height={96} count={3} />}

      {!loading && errorKey && (
        <div className="card cat-error" role="alert">
          <div className="cat-error-text">
            <p>{t(errorKey === 'common.error' ? 'catalogue.loadFailed' : errorKey)}</p>
            {/* The realistic cause of the generic failure is 0023/0024 never
                having been applied to this project, which is a SUPPORTED state
                rather than a fault. Say so, instead of leaving a bare
                "couldn't load". */}
            {(errorKey === 'common.error' || errorKey === 'common.errMissingTable') && (
              <p className="cat-note">{t('catalogue.notInstalled')}</p>
            )}
          </div>
          <button type="button" className="btn btn-sm" onClick={() => void load()}>
            {t('common.retry')}
          </button>
        </div>
      )}

      {/* Said ONCE for the page rather than on every row that lost its count:
          "we could not count" is one fact about this load, and repeating it
          thirteen times would bury the rows it is explaining. */}
      {!loading && !errorKey && (useCaseUsage === null || kindUsage === null) && (
        <p className="card cat-note" role="status">
          {t('catalogue.usageUnknown')}
        </p>
      )}

      {!loading && !errorKey && (
        <section className="card cat-section" aria-labelledby="cat-h-uc">
          <div className="cat-section-head">
            <h2 className="cat-section-title" id="cat-h-uc">
              {t('catalogue.useCasesTitle')}
            </h2>
            <button
              type="button"
              className="btn btn-sm"
              aria-expanded={adding === 'uc'}
              onClick={() => openAdd('uc')}
            >
              {adding === 'uc' ? t('catalogue.cancelAdd') : t('catalogue.addUseCase')}
            </button>
          </div>
          <p className="cat-section-hint">{t('catalogue.useCasesHint')}</p>
          <p className="cat-note">{t('catalogue.useCasesOrderNote')}</p>

          {adding === 'uc' &&
            renderAdd(
              'uc',
              USE_CASE_NAME_MAX,
              'catalogue.addUseCaseHint',
              'catalogue.addUseCaseTitle',
            )}

          {/* The seeded blank Arabic names, counted once and explained once —
              an empty field here is a job, not a failed read. */}
          {arabicPending > 0 && (
            <div className="cat-todo">
              <p>{t('catalogue.arabicPending', { count: arabicPending })}</p>
              <p>{t('catalogue.needsArabicHint')}</p>
            </div>
          )}

          {useCases.length === 0 ? (
            <EmptyState
              title={t('catalogue.useCasesEmpty')}
              description={t('catalogue.useCasesEmptyHint')}
            />
          ) : (
            <ul className="cat-list" aria-label={t('catalogue.useCasesTitle')}>
              {useCases.map((row, index) => {
                const used = useCaseUsage?.get(row.id) ?? null
                const badges: ReactElement[] = []
                if (row.hidden) {
                  badges.push(
                    <span className="pill warn" key="hidden">
                      {t('catalogue.hidden')}
                    </span>,
                  )
                }
                if (row.name_ar.trim() === '') {
                  badges.push(
                    <span className="pill" key="ar">
                      {t('catalogue.needsArabic')}
                    </span>,
                  )
                }
                if (used !== null && used > 0) {
                  badges.push(
                    <span className="pill info tabular" key="used">
                      {t('catalogue.inUse', { count: used })}
                    </span>,
                  )
                }
                return renderRow({
                  list: 'uc',
                  row,
                  index,
                  total: useCases.length,
                  max: USE_CASE_NAME_MAX,
                  hidden: row.hidden,
                  badges,
                  // Non-zero means the FK will refuse; the sentence names the
                  // count instead of letting a 23503 arrive after the click.
                  blocked: used !== null && used > 0 ? t('catalogue.inUseBlocks') : null,
                  // No reorder RPC for this table — see this file's header.
                  onMove: null,
                  onHide: () => void toggleHidden(row),
                  onDelete: () => void removeUseCase(row),
                })
              })}
            </ul>
          )}
        </section>
      )}

      {!loading && !errorKey && (
        <section className="card cat-section" aria-labelledby="cat-h-kind">
          <div className="cat-section-head">
            <h2 className="cat-section-title" id="cat-h-kind">
              {t('catalogue.kindsTitle')}
            </h2>
            <button
              type="button"
              className="btn btn-sm"
              aria-expanded={adding === 'kind'}
              onClick={() => openAdd('kind')}
            >
              {adding === 'kind' ? t('catalogue.cancelAdd') : t('catalogue.addKind')}
            </button>
          </div>
          <p className="cat-section-hint">{t('catalogue.kindsHint')}</p>
          <p className="cat-note">{t('catalogue.kindsNoHide')}</p>

          {adding === 'kind' &&
            renderAdd('kind', KIND_NAME_MAX, 'catalogue.addKindHint', 'catalogue.addKindTitle')}

          {kinds.length === 0 ? (
            <EmptyState
              title={t('catalogue.kindsEmpty')}
              description={t('catalogue.kindsEmptyHint')}
            />
          ) : (
            <ul className="cat-list" aria-label={t('catalogue.kindsTitle')}>
              {kinds.map((row, index) => {
                const used = kindUsage?.get(row.id) ?? null
                const badges: ReactElement[] = []
                if (row.name_ar.trim() === '') {
                  badges.push(
                    <span className="pill" key="ar">
                      {t('catalogue.needsArabic')}
                    </span>,
                  )
                }
                if (used !== null) {
                  badges.push(
                    <span className="pill tabular" key="used">
                      {used === 0 ? t('catalogue.kindUsageNone') : t('catalogue.kindUsage', { count: used })}
                    </span>,
                  )
                }
                return renderRow({
                  list: 'kind',
                  row,
                  index,
                  total: kinds.length,
                  max: KIND_NAME_MAX,
                  hidden: false,
                  badges,
                  // Never blocked: `map_nodes.kind_id` is `on delete set null`,
                  // so the delete succeeds and the confirmation carries the
                  // count of what it will un-kind.
                  blocked: null,
                  onMove: (delta) => moveKind(index, delta),
                  // No `hidden` column on this table.
                  onHide: null,
                  onDelete: () => void removeKind(row),
                })
              })}
            </ul>
          )}
        </section>
      )}

      {!loading && !errorKey && (
        <section className="card cat-section" aria-labelledby="cat-h-stage">
          <div className="cat-section-head">
            <h2 className="cat-section-title" id="cat-h-stage">
              {t('catalogue.stagesTitle')}
            </h2>
            <button
              type="button"
              className="btn btn-sm"
              aria-expanded={adding === 'stage'}
              onClick={() => openAdd('stage')}
            >
              {adding === 'stage' ? t('catalogue.cancelAdd') : t('catalogue.addStage')}
            </button>
          </div>
          <p className="cat-section-hint">{t('catalogue.stagesHint')}</p>
          {/* THE STANDING NOTE, and the dialog on the first move is the other
              half. `reorder_map_node_stages`' own comment requires the sentence
              before the drag is committed; a reader who has already read it here
              meets the dialog as a confirmation rather than as news. */}
          <p className="cat-note">{t('catalogue.stagesOrderNote')}</p>

          {/* The stage read's OWN failure, never the page-level error card: the
              two lists above are fine, and until 0026 is applied by hand this
              read fails on every load. `common.errMissingTable` never gets here
              — load() routes it to the empty state, so a project without the
              migration and a project with an empty ladder read identically. */}
          {stagesErrorKey && (
            <p className="cat-note" role="alert">
              {t(stagesErrorKey === 'common.error' ? 'catalogue.stagesLoadFailed' : stagesErrorKey)}
            </p>
          )}

          {adding === 'stage' &&
            renderAdd('stage', STAGE_NAME_MAX, 'catalogue.addStageHint', 'catalogue.addStageTitle')}

          {stagesArabicPending > 0 && (
            <div className="cat-todo">
              <p>{t('catalogue.stagesArabicPending', { count: stagesArabicPending })}</p>
              <p>{t('catalogue.needsArabicHint')}</p>
            </div>
          )}

          {/* Named rather than left blank, and only once there is a ladder to
              say it about: "no rung has a threshold" is the shipped state of all
              seven rungs and it means the stalled lens is off everywhere. An
              empty list says its own thing below. */}
          {stages.length > 0 && !anyThreshold && (
            <p className="cat-note">{t('catalogue.stagesNoThresholds')}</p>
          )}

          {stages.length === 0 ? (
            // ONE EMPTY STATE FOR TWO CAUSES, deliberately: a table 0026 has not
            // created yet and an applied table somebody emptied are the same
            // fact to the reader — there are no rungs — and the hint names both
            // ways out. The alternative is a red boot-time error on every
            // project that has not run the migration.
            <EmptyState
              title={t('catalogue.stagesEmpty')}
              description={t('catalogue.stagesEmptyHint')}
            />
          ) : (
            <ul className="cat-list" aria-label={t('catalogue.stagesTitle')}>
              {stages.map((row, index) => {
                const badges: ReactElement[] = []
                if (row.hidden) {
                  badges.push(
                    <span className="pill warn" key="hidden">
                      {t('catalogue.hidden')}
                    </span>,
                  )
                }
                if (row.name_ar.trim() === '') {
                  badges.push(
                    <span className="pill" key="ar">
                      {t('catalogue.needsArabic')}
                    </span>,
                  )
                }
                // The two flags are read off the ROW, not off the ladder's
                // shape: nothing here counts how many rungs carry either, and
                // 0026 counts nothing either — two terminal rungs ("Live" and
                // "Live with caveats") is a legal and meaningful ladder.
                if (row.terminal) {
                  badges.push(
                    <span className="pill ok" key="terminal">
                      {t('catalogue.stageTerminal')}
                    </span>,
                  )
                }
                if (row.paused) {
                  badges.push(
                    <span className="pill warn" key="paused">
                      {t('catalogue.stagePaused')}
                    </span>,
                  )
                }
                if (row.expected_days !== null) {
                  badges.push(
                    <span className="pill info tabular" key="days">
                      {t('catalogue.stageExpected', { count: row.expected_days })}
                    </span>,
                  )
                }
                return renderRow({
                  list: 'stage',
                  row,
                  index,
                  total: stages.length,
                  max: STAGE_NAME_MAX,
                  hidden: row.hidden,
                  badges,
                  // Never blocked, and that is the difference from a use case
                  // rather than an oversight: both columns that point at a rung
                  // are `on delete set null`, so nothing refuses this delete and
                  // the counts have to be said in the dialog instead.
                  blocked: null,
                  onMove: (delta) => void moveStage(index, delta),
                  onHide: () => void toggleStageHidden(row),
                  onDelete: () => void removeStage(row),
                })
              })}
            </ul>
          )}
        </section>
      )}
    </div>
  )
}
