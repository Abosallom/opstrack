// Terminology admin (/settings/terminology) — the owner's own words for every
// string in the product, in both languages, without a deploy.
//
// WHY THIS SCREEN EXISTS, in one sentence, because every decision below is
// judged against it: the owner was handed a PDF worksheet to write new field
// names into and replied "put it in the app". So a wording change has to be
// self-service, live for everyone, in EN and AR, with no developer in the loop.
//
// WHAT IT IS NOT: a key dump. 1,665 keys is not a UI. The way in is SEARCH,
// backed by seven sections a person recognises (lib/labelSections.ts's curated
// map) which start COLLAPSED — see the render budget below.
//
// ── THE SLOT IS THE UNIT, NOT THE ROW ──────────────────────────────────────
//
// A `label_overrides` row is `(key, en, ar)`. For a plain key that IS the UI
// row, and the screen reads exactly as the spec describes: two inputs under one
// key, one Save, one Reset. For a PLURAL key it is not — `board.total` is six
// Arabic forms and two English ones, each stored at `board.total.<category>`
// (lib/labelOverrides.ts's overrideKey(), the ONE place that format is written).
//
// So the render unit is a SLOT: one override key, with the English cell and the
// Arabic cell that key can carry. slotsFor() below expands one catalogue entry
// into its slots, and Save/Reset hang off the slot. That is what makes the two
// mutations map 1:1 onto store/labels.ts's saveOverride(key, en, ar) and
// resetOverride(key) with nothing in between to get the key wrong — the silent
// failure this feature has, because an override stored under a key nothing reads
// is indistinguishable from a save that did not work.
//
// A LANGUAGE MAY BE PLAIN WHERE THE OTHER IS PLURAL, and the screen has to draw
// both at once. `board.total` is a plural node in English and an invariant
// string in Arabic (lib/plural.ts's header explains why the bundles are allowed
// to disagree about a key's SHAPE). slotsFor() answers that by emitting a
// base-key slot carrying ONLY the plain language, plus per-form slots carrying
// only the plural one. A cell is `null` where that language has no such form,
// and a null cell saves `null` — which is correct rather than lossy: English
// genuinely has no `few`.
//
// PLURALS ARE EDITABLE, NOT READ-ONLY, and the spec offered the choice. Read-only
// would have been the cheap answer, and it fails the sentence at the top: the
// counted strings are the ones an ops lead most wants to reword ("3 items need
// you" → "3 actions need you"), and freezing them would send exactly that change
// back to the developer this screen replaces. What made it safe is that no rule
// lives here — lib/labelOverrides.ts's validateOverride() enforces `{count}` in a
// range category and lets an exact one omit it, from lib/plural.ts's own
// EXACT_CATEGORIES, and selectableCategories() decides which fields exist so the
// owner is never offered an English `few` box no reader could ever be shown.
//
// ── VALIDATION IS LIVE, AND IT NAMES THE TOKEN ─────────────────────────────
//
// Checked on every keystroke against the SHIPPED string, not on submit: this is
// a text box wired to every label in the product, and finding out after the save
// that `{name}` is gone is finding out from the app, in production, in front of
// everyone. Save is disabled while a cell is invalid and the message says WHICH
// placeholder — "invalid placeholder" is not something an ops lead can act on.
//
// THE VALIDATOR ALSO REWRITES. validateOverride() returns the value to store,
// with the bidi isolates re-applied the way the shipped string applies them, so
// nobody is asked to type U+2068. The screen stores `check.value`, never the raw
// input — the one place that could quietly reintroduce the RTL reordering bug
// src/lib/bidi.test.ts gates the whole tree on.
//
// ── THE RENDER BUDGET ──────────────────────────────────────────────────────
//
// 1,665 keys × 2 inputs is ~3,300 controlled inputs, and no virtualiser is
// available (no new dependencies). Three limits keep the DOM small without ever
// hiding a key from the person looking for it:
//   · sections are collapsed until opened, so a cold load renders seven headers;
//   · an open section renders PAGE_SIZE rows with an explicit "show more";
//   · a search auto-opens the sections that match, because a hit inside a
//     collapsed section is a hit nobody can see.
// The catalogue and the slot expansion are built ONCE at module level
// (buildRows), never per keystroke — 1,665 keys re-walked on every character is
// the one performance mistake this screen can make.
//
// ── DEGRADATION IS THE SAFETY NET, NOT A GAP ───────────────────────────────
//
// The catalogue comes from the BUNDLES, not the database, so this screen renders
// in full with migration 0016 unapplied: every default is visible and searchable
// and only saving fails. store/labels.ts swallows a failed load on purpose (the
// app runs on the shipped wording), which is why there is no load-error banner
// here — there is no failure for one to describe. A SAVE that fails says so, and
// a generic failure adds the "0016 is not applied" line, because that is the one
// realistic cause and it is a supported state rather than a fault.
//
// THE ESCAPE HATCH IS A CONTROL, NOT A FOOTNOTE. "Reset every change" sits in
// the header beside the count, permanently, confirm()-guarded. Someone reaching
// for it has already made the app hard to read and possibly hard to navigate;
// requiring them to find a collapsed section first would be the failure mode the
// spec's rule 4 exists to prevent.

import { useCallback, useMemo, useRef, useState, type ReactElement } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { IconArrowStart, IconChevronEnd } from '../../components/icons'
import { confirm } from '../../components/Confirm'
import LabelIO from '../../components/settings/LabelIO'
import { toast } from '../../components/toast'
import { t, useLocale } from '../../lib/i18n'
import { overrideErrorText } from '../../lib/labelErrors'
import {
  FORM_LABEL_KEYS,
  overrideKey,
  selectableCategories,
  validateOverride,
} from '../../lib/labelOverrides'
import {
  LABEL_SECTIONS,
  labelMatches,
  listLabels,
  searchable,
  type LabelDescriptor,
  type LabelSectionId,
} from '../../lib/labelSections'
import {
  EXACT_CATEGORIES,
  PLURAL_CATEGORIES,
  isPluralNode,
  type PluralCategory,
  type PluralNode,
} from '../../lib/plural'
import { useAuth } from '../../store/auth'
import {
  resetAllOverrides,
  resetOverride,
  saveOverride,
  useLabelOverrideCount,
  useLabelOverrideMap,
} from '../../store/labels'
import './terminology.css'

/** Rows drawn per section before the "show more" button. */
const PAGE_SIZE = 25

/**
 * The longest label the table will store — 0016's `label_overrides_text_len`.
 *
 * Named here as well as there because the two have to agree: the constraint is
 * what keeps the localStorage cache from becoming a quota failure, and an input
 * without this attribute turns a paste into a 23514 the owner cannot act on.
 */
const MAX_LABEL_LENGTH = 4000

/** How many more each press of "show more" adds. */
const PAGE_STEP = 50

/**
 * Cosmetic admin gate — the same one VocabularyAdmin and TracksAdmin document.
 * The real authority is `is_admin()` in 0016's RLS policies: every write here
 * fails with 42501 for a member whatever this returns, and hiding the screen
 * only avoids offering an action that cannot succeed.
 *
 * `?shell` mirrors App.tsx's dev-only preview flag so the layout and the RTL
 * mirror stay reviewable in a build with no Supabase project.
 * `import.meta.env.DEV` is the literal `false` in a production build, so Vite
 * drops the whole expression and this cannot become a way in.
 */
function useIsAdmin(): boolean {
  const { profile } = useAuth()
  if (profile?.role === 'admin') return true
  return import.meta.env.DEV && new URLSearchParams(window.location.search).has('shell')
}

/**
 * One language's half of a slot: what the app ships, and what to validate
 * against.
 *
 * `shipped` is the WHOLE node for a plural key, not the one form, because that
 * is what validateOverride() takes — it reads the category off the key and
 * measures the candidate against the node's `other`. `display` is the form's own
 * text, which is what the reader needs to see above the input.
 */
interface SlotCell {
  readonly shipped: string | PluralNode
  readonly display: string
}

/** One `label_overrides` row, as this screen draws and saves it. */
interface Slot {
  /** The stored key: the dot path, or `path.category` for one plural form. */
  readonly key: string
  /** `t()` key naming the plural form, or null for a plain slot. */
  readonly formKey: string | null
  /** An exact category may omit `{count}`; a range one may not. Drives the hint. */
  readonly exact: boolean
  /** null where this language has no such form — English has no `few`. */
  readonly en: SlotCell | null
  readonly ar: SlotCell | null
}

/**
 * The form's own string, falling back to `other` for a category the node does
 * not carry.
 *
 * The fallback is not a fudge: selectPlural() resolves an absent form to `other`
 * at render, so this shows what a reader would actually be shown today — and
 * adding the form is a legitimate edit (an Arabic node that never needed `zero`
 * and now does), which is exactly why the field is offered at all.
 */
function formText(node: PluralNode, category: PluralCategory): string {
  return node[category] ?? node.other
}

/**
 * Expand one catalogue entry into the override rows it is edited through.
 *
 * A plain key yields exactly one slot carrying both languages, which is the
 * overwhelmingly common case and the one the spec describes. Anything plural in
 * EITHER language yields a slot per selectable form, plus — when the other
 * language is a plain string — one base-key slot carrying only that side.
 */
function slotsFor(d: LabelDescriptor): readonly Slot[] {
  const enNode = d.en
  const arNode = d.ar
  const enPlural = isPluralNode(enNode)
  const arPlural = isPluralNode(arNode)

  if (!enPlural && !arPlural) {
    return [
      {
        key: d.key,
        formKey: null,
        exact: false,
        en: { shipped: enNode, display: enNode },
        ar: { shipped: arNode, display: arNode },
      },
    ]
  }

  const slots: Slot[] = []
  // The plain side of a mixed key keeps the BASE key, because that is where a
  // plain string's override is read from. Only the plural side is per-form.
  if (!enPlural || !arPlural) {
    slots.push({
      key: d.key,
      formKey: null,
      exact: false,
      en: enPlural ? null : { shipped: enNode, display: enNode },
      ar: arPlural ? null : { shipped: arNode, display: arNode },
    })
  }

  const enForms = selectableCategories('en')
  const arForms = selectableCategories('ar')
  for (const category of PLURAL_CATEGORIES) {
    const enHas = enPlural && enForms.includes(category)
    const arHas = arPlural && arForms.includes(category)
    // Neither language can select this form, so an input for it would collect a
    // string no reader is ever shown — what localeParity.test.ts refuses in the
    // shipped tree, and what errUnreachableCategory refuses on save.
    if (!enHas && !arHas) continue
    slots.push({
      key: overrideKey(d.key, category),
      formKey: FORM_LABEL_KEYS[category],
      exact: EXACT_CATEGORIES.includes(category),
      en: enHas && enPlural ? { shipped: enNode, display: formText(enNode, category) } : null,
      ar: arHas && arPlural ? { shipped: arNode, display: formText(arNode, category) } : null,
    })
  }
  return slots
}

/** Every string of a key, flattened — the search haystack's raw material. */
function allText(node: string | PluralNode): string {
  return isPluralNode(node) ? Object.values(node).join(' ') : node
}

/** One catalogue entry, with its slots and its search text resolved once. */
interface Row {
  readonly d: LabelDescriptor
  readonly slots: readonly Slot[]
  /** Lowercased key + both languages, isolates stripped. */
  readonly hay: string
}

let rows: readonly Row[] | undefined

/**
 * The whole screen's data, built once.
 *
 * `hay` is the BUILT-IN half of the match only — the key and the two shipped
 * languages — because that half is frozen at module load and the other half is
 * not. What the owner has stored changes on every save, so it is folded in at
 * filter time from `byKey` (see `ownerText` below); caching it here is what made
 * the search find only the wording the app shipped with.
 *
 * searchable() strips the invisible controls because they are invisible: an
 * owner searching for "Created by name" is typing what they can SEE, and the
 * shipped string is `Created by ⁨{name}⁩` with two control characters in it that
 * would otherwise make the phrase unmatchable.
 */
function buildRows(): readonly Row[] {
  rows ??= listLabels().map((d) => ({
    d,
    slots: slotsFor(d),
    hay: searchable(`${d.key} ${allText(d.en)} ${allText(d.ar)}`),
  }))
  return rows
}

/** Frozen so the overwhelming majority of rows share one empty array. */
const NO_OWNER_TEXT: readonly string[] = []

/** What is typed into one slot. Strings throughout — blank is a real value. */
interface Draft {
  en: string
  ar: string
}

/** The stored override as a draft: null and blank are the same empty box. */
function draftOf(en: string | null | undefined, ar: string | null | undefined): Draft {
  return { en: en ?? '', ar: ar ?? '' }
}

export default function Terminology(): ReactElement {
  const locale = useLocale()
  const isAdmin = useIsAdmin()
  const byKey = useLabelOverrideMap()
  const count = useLabelOverrideCount()

  const [query, setQuery] = useState('')
  const [onlyChanged, setOnlyChanged] = useState(false)
  /**
   * Explicit open/closed per section. `undefined` means "whatever the default
   * is", which is closed while browsing and OPEN while filtering — a hit inside
   * a collapsed section is a hit nobody can see. Cleared when the filter is,
   * so the defaults come back rather than the last search's shape persisting.
   */
  const [open, setOpen] = useState<Partial<Record<LabelSectionId, boolean>>>({})
  const [shown, setShown] = useState<Partial<Record<LabelSectionId, number>>>({})
  /** Slot key → what is typed. Absent means "showing what is stored". */
  const [drafts, setDrafts] = useState<Record<string, Draft>>({})
  /** Slot keys with a write in flight. */
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set())
  /** Slot key → the i18n key of the SERVER's last refusal for it. */
  const [rowError, setRowError] = useState<Record<string, string>>({})
  const [resetting, setResetting] = useState(false)

  const catalogue = buildRows()

  /**
   * Which catalogue rows carry an override, in either language, on any slot.
   *
   * Computed from `byKey` rather than asked per render inside the list: a plural
   * row has up to seven slots and the section headers need the tally for all
   * 1,665 rows at once, so this is one pass instead of a scan per header.
   */
  const changed = useMemo(() => {
    const out = new Set<string>()
    if (byKey.size === 0) return out
    for (const row of catalogue) {
      if (row.slots.some((slot) => byKey.has(slot.key))) out.add(row.d.key)
    }
    return out
  }, [catalogue, byKey])

  /**
   * Row key → everything the OWNER has stored for it, ready to match against.
   *
   * Built when `byKey` changes rather than per keystroke, and only for the rows
   * that actually carry an override — a few dozen out of 1,665 — so a search
   * costs the same walk it always did and no allocation per row.
   */
  const ownerText = useMemo(() => {
    const out = new Map<string, string[]>()
    if (byKey.size === 0) return out
    for (const row of catalogue) {
      let found: string[] | undefined
      for (const slot of row.slots) {
        const stored = byKey.get(slot.key)
        if (stored === undefined) continue
        found ??= []
        if (stored.en !== null) found.push(searchable(stored.en))
        if (stored.ar !== null) found.push(searchable(stored.ar))
      }
      if (found !== undefined) out.set(row.d.key, found)
    }
    return out
  }, [catalogue, byKey])

  const needle = searchable(query.trim())
  const filtering = needle !== '' || onlyChanged

  /**
   * The rows each section will draw, in catalogue order.
   *
   * THREE THINGS ARE MATCHED, and the third is the one that makes the screen
   * usable twice. The section NAME, so typing "empty" finds the whole Empty
   * states group rather than only the keys whose text happens to contain the
   * word. The BUILT-IN wording, which is what the owner is looking for the first
   * time. And the wording HE HAS ALREADY SET, which is what he is looking for
   * every time after that — rename "Follow-ups" to "My Desk" and "My Desk" is
   * the only name for it he can still see anywhere in the app.
   *
   * Depends on `locale` because the section names come through t(), and on
   * `ownerText` because a save changes what matches.
   */
  const bySection = useMemo(() => {
    const names = new Map<LabelSectionId, string>(
      LABEL_SECTIONS.map((s) => [s.id, searchable(t(s.labelKey))]),
    )
    const out = new Map<LabelSectionId, Row[]>(LABEL_SECTIONS.map((s) => [s.id, []]))
    for (const row of catalogue) {
      if (onlyChanged && !changed.has(row.d.key)) continue
      const section = names.get(row.d.section) ?? ''
      const owner = ownerText.get(row.d.key) ?? NO_OWNER_TEXT
      if (!labelMatches(needle, row.hay, section, owner)) continue
      out.get(row.d.section)?.push(row)
    }
    return out
    // `locale` is read through t() inside, so the memo must follow it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [catalogue, changed, needle, onlyChanged, ownerText, locale])

  const total = useMemo(() => {
    let n = 0
    for (const list of bySection.values()) n += list.length
    return n
  }, [bySection])

  // ---- drafts -------------------------------------------------------------

  const draftFor = useCallback(
    (key: string): Draft => {
      const typed = drafts[key]
      if (typed !== undefined) return typed
      const stored = byKey.get(key)
      return draftOf(stored?.en, stored?.ar)
    },
    [drafts, byKey],
  )

  const setField = useCallback(
    (key: string, field: keyof Draft, value: string, stored: Draft): void => {
      setDrafts((current) => ({ ...current, [key]: { ...(current[key] ?? stored), [field]: value } }))
    },
    [],
  )

  /**
   * Forget a slot's draft so it re-reads from the store.
   *
   * Called after every successful write. Leaving the draft in place would pin
   * the input to what was typed, so a row reset from another device — or the
   * value 0016's trigger normalised — would never show up here.
   */
  const clearDraft = useCallback((key: string): void => {
    setDrafts((current) => {
      if (!(key in current)) return current
      const next = { ...current }
      delete next[key]
      return next
    })
  }, [])

  const mark = useCallback((key: string, on: boolean): void => {
    setBusy((current) => {
      const next = new Set(current)
      if (on) next.add(key)
      else next.delete(key)
      return next
    })
  }, [])

  // ---- writes -------------------------------------------------------------

  /**
   * pgErrorKey's catch-all says less than this screen's own headline; anything
   * more specific (admin.errForbidden, common.notConfigured) is worth showing
   * verbatim. The same shape VocabularyAdmin uses.
   */
  function saveErrorKey(key: string): string {
    return key === 'common.error' ? 'terminology.errSave' : key
  }

  async function save(slot: Slot, checked: { en: string | null; ar: string | null }): Promise<void> {
    mark(slot.key, true)
    setRowError((current) => {
      if (!(slot.key in current)) return current
      const next = { ...current }
      delete next[slot.key]
      return next
    })
    // Optimistic and rolled back inside store/labels.ts — the wording changes at
    // the click, everywhere, and every string goes back together if the write is
    // refused. Not re-implemented here: one override can be showing in the nav,
    // a column heading and a toast at once, so a per-row undo would be wrong.
    const result = await saveOverride(slot.key, checked.en, checked.ar)
    mark(slot.key, false)
    if (!result.ok) {
      const shown = saveErrorKey(result.error)
      setRowError((current) => ({ ...current, [slot.key]: shown }))
      toast(t(shown), { tone: 'error' })
      return
    }
    clearDraft(slot.key)
    toast(t('terminology.savedToast'))
  }

  async function reset(slot: Slot): Promise<void> {
    mark(slot.key, true)
    const result = await resetOverride(slot.key)
    mark(slot.key, false)
    if (!result.ok) {
      const shown = result.error === 'common.error' ? 'terminology.errReset' : result.error
      setRowError((current) => ({ ...current, [slot.key]: shown }))
      toast(t(shown), { tone: 'error' })
      return
    }
    clearDraft(slot.key)
    toast(t('terminology.resetDone'))
  }

  async function resetAll(): Promise<void> {
    const ok = await confirm({
      title: t('terminology.resetAll'),
      body: t('terminology.resetAllConfirm', { count }),
      confirmLabel: t('terminology.resetAll'),
      cancelLabel: t('common.cancel'),
      danger: true,
    })
    if (!ok) return
    setResetting(true)
    const result = await resetAllOverrides()
    setResetting(false)
    if (!result.ok) {
      toast(t(result.error === 'common.error' ? 'terminology.errResetAll' : result.error), {
        tone: 'error',
      })
      return
    }
    // Every draft on screen described a row that no longer exists.
    setDrafts({})
    setRowError({})
    toast(t('terminology.resetAllDone', { count: result.data }))
  }

  // ---- search -------------------------------------------------------------

  const searchRef = useRef<HTMLInputElement>(null)

  function onQuery(value: string): void {
    setQuery(value)
    // A cleared box restores the browsing shape — collapsed sections, first page
    // — rather than leaving the last search's expansion behind.
    if (value.trim() === '') {
      setOpen({})
      setShown({})
    }
  }

  if (!isAdmin) return <Navigate to="/settings" replace />

  const isOpen = (id: LabelSectionId): boolean => open[id] ?? filtering

  return (
    <div className="term">
      <div className="term-bar">
        <Link to="/settings" className="btn btn-ghost btn-sm">
          {/* icon-directional: a back arrow points at the reading start, so it
              mirrors in Arabic. */}
          <IconArrowStart className="icon-directional" size={16} />
          {t('common.back')}
        </Link>
      </div>

      {/* No page heading: App.tsx's header already renders this route's title as
          the document h1. */}
      <div className="term-intro">
        <p className="term-lead">{t('terminology.subtitle')}</p>
        <p className="term-note">{t('terminology.blankMeansDefault')}</p>
        <p className="term-note">{t('terminology.bidiNote')}</p>
      </div>

      {/* THE ESCAPE HATCH, in the header rather than at the bottom of a
          collapsed section — see this file's header. The count beside it is what
          makes the button legible: "Reset every change" with nothing changed is
          a control with no referent. */}
      <div className="card term-status">
        <p className="term-count">
          {count > 0 ? (
            <span className="pill info">{t('terminology.changedCount', { count })}</span>
          ) : (
            <span className="pill">{t('terminology.noChanges')}</span>
          )}
        </p>
        <button
          type="button"
          className="btn btn-sm btn-ghost"
          disabled={count === 0 || resetting}
          onClick={() => void resetAll()}
        >
          {resetting ? t('terminology.resetting') : t('terminology.resetAll')}
        </button>
      </div>

      <div className="card term-controls">
        <div className="field term-search">
          <label className="field-label" htmlFor="term-q">
            {t('terminology.searchLabel')}
          </label>
          <input
            id="term-q"
            ref={searchRef}
            className="input"
            type="search"
            value={query}
            autoComplete="off"
            placeholder={t('terminology.searchPlaceholder')}
            aria-describedby="term-q-hint"
            onChange={(e) => onQuery(e.target.value)}
          />
          <p className="term-note" id="term-q-hint">
            {t('terminology.searchHint')}
          </p>
        </div>

        <div className="term-toggle-row">
          <button
            type="button"
            role="switch"
            aria-checked={onlyChanged}
            className="btn btn-sm term-toggle"
            // The trailing `.switch` span is decorative but still a child, so
            // the name is stated rather than computed. Identical to the visible
            // text; the on/off state is aria-checked's job, not the label's —
            // a switch whose NAME changes with its state is announced as a
            // different control every time it is pressed.
            aria-label={t('terminology.showChanged')}
            onClick={() => setOnlyChanged((v) => !v)}
          >
            <span>{t('terminology.showChanged')}</span>
            {/* aria-hidden: the button above is the only thing announced, and the
                span is a styling hook for global.css's `.switch` primitive. */}
            <span className="switch" aria-hidden="true" aria-checked={onlyChanged} />
          </button>
          {/* Polite: the number follows what is being read rather than
              interrupting a search the person is still typing. */}
          <p className="term-note" role="status" aria-live="polite">
            {t('terminology.resultCount', { count: total })}
          </p>
        </div>
      </div>

      {onlyChanged && count === 0 && (
        <p className="card term-empty" role="status">
          <span className="term-empty-title">{t('terminology.noChanges')}</span>
          <span className="term-note">{t('terminology.noChangesHint')}</span>
        </p>
      )}

      {total === 0 && needle !== '' && (
        <p className="card term-empty" role="status">
          <span className="term-empty-title">{t('terminology.noResults', { value: query })}</span>
          <span className="term-note">{t('terminology.noResultsHint')}</span>
        </p>
      )}

      {LABEL_SECTIONS.map((section) => {
        const list = bySection.get(section.id) ?? []
        // A section with nothing in it is dropped WHILE FILTERING and kept while
        // browsing: an empty group under a search is noise, but the seven
        // headings are the map of the screen when nothing is being searched.
        if (list.length === 0 && filtering) return null
        const opened = isOpen(section.id)
        const limit = shown[section.id] ?? PAGE_SIZE
        const visible = list.slice(0, limit)
        const name = t(section.labelKey)
        const changedHere = list.filter((row) => changed.has(row.d.key)).length

        return (
          <section className="card term-section" key={section.id}>
            <h2 className="term-section-h">
              <button
                type="button"
                className="term-section-btn"
                aria-expanded={opened}
                aria-controls={`term-s-${section.id}`}
                // Named explicitly rather than left to the descendant text: the
                // button also contains the hint and two count pills, so the
                // computed name would be a paragraph ending in "591 labels".
                // The visible section name is a substring of this, which is what
                // WCAG 2.5.3 asks of a control whose label is spoken.
                aria-label={t(
                  opened ? 'terminology.collapseSection' : 'terminology.expandSection',
                  { section: name },
                )}
                onClick={() =>
                  setOpen((current) => ({ ...current, [section.id]: !opened }))
                }
              >
                {/* The state rides on a WRAPPER, not on the icon: IconProps is
                    `{className, size}` and nothing else, so a `data-open` handed
                    to the component is silently dropped and the rotation below
                    would never fire. Found by reading the rendered SVG's
                    attributes in the browser — tsc does not catch it. */}
                <span className="term-caret" data-open={opened ? 'true' : undefined}>
                  <IconChevronEnd size={16} />
                </span>
                <span className="term-section-text">
                  <span className="term-section-title">{name}</span>
                  <span className="term-note">{t(section.hintKey)}</span>
                </span>
                <span className="term-section-tally">
                  {changedHere > 0 && (
                    <span className="pill info">
                      {t('terminology.changedCount', { count: changedHere })}
                    </span>
                  )}
                  <span className="pill tabular">
                    {t('terminology.resultCount', { count: list.length })}
                  </span>
                </span>
              </button>
            </h2>

            {opened && (
              <div id={`term-s-${section.id}`}>
                <ul
                  className="term-list"
                  aria-label={t('terminology.a11ySection', { section: name, count: list.length })}
                >
                  {visible.map((row) => (
                    <LabelRow
                      key={row.d.key}
                      row={row}
                      changed={changed.has(row.d.key)}
                      byKey={byKey}
                      busy={busy}
                      rowError={rowError}
                      draftFor={draftFor}
                      setField={setField}
                      onSave={save}
                      onReset={reset}
                      onDiscard={clearDraft}
                    />
                  ))}
                </ul>
                {list.length > visible.length && (
                  <button
                    type="button"
                    className="btn btn-sm term-more"
                    onClick={() =>
                      setShown((current) => ({
                        ...current,
                        [section.id]: (current[section.id] ?? PAGE_SIZE) + PAGE_STEP,
                      }))
                    }
                  >
                    {t('terminology.resultCount', { count: list.length - visible.length })}
                    <span className="term-caret" data-open="true">
                      <IconChevronEnd size={16} />
                    </span>
                  </button>
                )}
              </div>
            )}
          </section>
        )
      })}

      {/* Download / upload the whole override set, owned by
          components/settings/LabelIO.tsx (`.lio-`). LAST on the page on purpose:
          it is the occasional bulk operation, and with the sections collapsed —
          which is how the page opens — it is still one screen away rather than
          buried under 1,665 rows.

          `disabled` is deliberately NOT passed. Its contract is "true when
          label_overrides is not installed or the reader is not an admin": the
          second is already impossible here (the redirect above), and the first
          is not knowable from this screen — store/labels.ts swallows a failed
          load by design, so there is no install signal to read. See the handoff. */}
      <LabelIO />
    </div>
  )
}

/* ──────────────────────────── one catalogue row ──────────────────────────── */

interface LabelRowProps {
  readonly row: Row
  readonly changed: boolean
  readonly byKey: ReadonlyMap<string, { en: string | null; ar: string | null }>
  readonly busy: ReadonlySet<string>
  readonly rowError: Readonly<Record<string, string>>
  readonly draftFor: (key: string) => Draft
  readonly setField: (key: string, field: keyof Draft, value: string, stored: Draft) => void
  readonly onSave: (slot: Slot, checked: { en: string | null; ar: string | null }) => Promise<void>
  readonly onReset: (slot: Slot) => Promise<void>
  readonly onDiscard: (key: string) => void
}

/**
 * One key: what it is, where it shows up, and a slot per override row.
 *
 * A component rather than a loop body so React can skip the ones whose props did
 * not move — an open section is 25 rows of up to fourteen inputs, and re-running
 * all of them on every keystroke in a neighbouring row is what makes a long list
 * feel broken.
 */
function LabelRow({
  row,
  changed,
  byKey,
  busy,
  rowError,
  draftFor,
  setField,
  onSave,
  onReset,
  onDiscard,
}: LabelRowProps): ReactElement {
  const { d, slots } = row
  const plural = slots.length > 1 || slots[0].formKey !== null

  return (
    <li className="term-row" data-changed={changed ? 'true' : undefined}>
      <div className="term-row-head">
        {/* The stored dot path. dir=ltr because a dotted identifier reads back
            to front inside an RTL paragraph. */}
        <code className="term-key" dir="ltr">
          {d.key}
        </code>
        {changed && <span className="pill info term-dot">{t('terminology.changed')}</span>}
      </div>
      <p className="term-where">
        <span className="term-where-label">{t('terminology.whereLabel')}:</span> {t(d.whereKey)}
      </p>

      {plural && (
        <p className="term-plural-note">
          <span className="term-plural-title">{t('terminology.pluralTitle')}</span>
          <span className="term-note">{t('terminology.pluralHint')}</span>
        </p>
      )}

      {slots.map((slot) => (
        <SlotEditor
          key={slot.key}
          slot={slot}
          stored={byKey.get(slot.key)}
          busy={busy.has(slot.key)}
          errorKey={rowError[slot.key]}
          draftFor={draftFor}
          setField={setField}
          onSave={onSave}
          onReset={onReset}
          onDiscard={onDiscard}
        />
      ))}
    </li>
  )
}

/* ───────────────────────── one override row's editor ─────────────────────── */

interface SlotEditorProps {
  readonly slot: Slot
  readonly stored: { en: string | null; ar: string | null } | undefined
  readonly busy: boolean
  readonly errorKey: string | undefined
  readonly draftFor: (key: string) => Draft
  readonly setField: (key: string, field: keyof Draft, value: string, stored: Draft) => void
  readonly onSave: (slot: Slot, checked: { en: string | null; ar: string | null }) => Promise<void>
  readonly onReset: (slot: Slot) => Promise<void>
  readonly onDiscard: (key: string) => void
}

function SlotEditor({
  slot,
  stored,
  busy,
  errorKey,
  draftFor,
  setField,
  onSave,
  onReset,
  onDiscard,
}: SlotEditorProps): ReactElement {
  const base = draftOf(stored?.en, stored?.ar)
  const draft = draftFor(slot.key)
  const dirty = draft.en !== base.en || draft.ar !== base.ar
  const overridden = stored !== undefined

  // Checked on every render, against the SHIPPED string — see this file's
  // header. `null` for a language this slot does not carry, which is what gets
  // stored: English genuinely has no `few`.
  const enCheck = slot.en ? validateOverride(slot.key, slot.en.shipped, draft.en, 'en') : null
  const arCheck = slot.ar ? validateOverride(slot.key, slot.ar.shipped, draft.ar, 'ar') : null
  const enBad = enCheck && !enCheck.ok ? enCheck : null
  const arBad = arCheck && !arCheck.ok ? arCheck : null
  const valid = enBad === null && arBad === null

  const id = `term-${slot.key.replace(/\./g, '-')}`

  return (
    <div className="term-slot">
      {slot.formKey !== null && (
        <p className="term-form">
          <span className="term-form-name">{t(slot.formKey)}</span>
          <span className="term-note">
            {t(slot.exact ? 'terminology.pluralExactHint' : 'terminology.pluralRangeHint')}
          </span>
        </p>
      )}

      <div className="term-cells">
        {slot.en && (
          <div className="field term-cell">
            <label className="field-label" htmlFor={`${id}-en`}>
              {t('terminology.fieldEn')}
            </label>
            {/* The shipped string, shown as the default it is. Selectable on
                purpose: the likeliest starting point for a rename is the
                original, and validateOverride() is idempotent about the
                invisible isolates a copy carries with it. */}
            <p className="term-default" lang="en" dir="ltr">
              {slot.en.display}
            </p>
            <input
              id={`${id}-en`}
              className="input term-input"
              lang="en"
              dir="ltr"
              value={draft.en}
              autoComplete="off"
              spellCheck={false}
              // 0016's `label_overrides_text_len`, enforced where the owner can
              // still do something about it. A label is a few words; the bound
              // exists because this whole table is cached in localStorage, and
              // a pasted document would be a quota failure several thousand
              // kilometres from where it was caused.
              maxLength={MAX_LABEL_LENGTH}
              placeholder={t('terminology.placeholderDefault')}
              aria-label={t('terminology.a11yEnInput', { key: slot.key })}
              aria-invalid={enBad ? true : undefined}
              disabled={busy}
              onChange={(e) => setField(slot.key, 'en', e.target.value, base)}
            />
            {enBad && (
              <p className="field-error" role="alert">
                {overrideErrorText(enBad.error, enBad.vars)}
              </p>
            )}
          </div>
        )}

        {slot.ar && (
          <div className="field term-cell">
            <label className="field-label" htmlFor={`${id}-ar`}>
              {t('terminology.fieldAr')}
            </label>
            <p className="term-default" lang="ar" dir="rtl">
              {slot.ar.display}
            </p>
            {/* lang + dir on the CONTROL: Arabic is typed into an otherwise
                English page, and without these the caret starts on the wrong
                side and the text gets a Latin face. */}
            <input
              id={`${id}-ar`}
              className="input term-input"
              lang="ar"
              dir="rtl"
              value={draft.ar}
              autoComplete="off"
              spellCheck={false}
              maxLength={MAX_LABEL_LENGTH}
              placeholder={t('terminology.placeholderDefault')}
              aria-label={t('terminology.a11yArInput', { key: slot.key })}
              aria-invalid={arBad ? true : undefined}
              disabled={busy}
              onChange={(e) => setField(slot.key, 'ar', e.target.value, base)}
            />
            {arBad && (
              <p className="field-error" role="alert">
                {overrideErrorText(arBad.error, arBad.vars)}
              </p>
            )}
          </div>
        )}
      </div>

      {errorKey && (
        <p className="field-error" role="alert">
          {t(errorKey)}
          {/* ONLY when the failure actually says the table is missing. This
              note used to hang off the GENERIC save error, so every unmapped
              refusal — an over-long paste, an RLS surprise — told the owner his
              project had no label_overrides table, which after 0016 is applied
              is simply false and sends him to a runbook section about a problem
              he does not have. pgErrorKey() maps PostgREST's PGRST205 for
              exactly this. */}
          {errorKey === 'common.errMissingTable' && (
            <span className="term-note"> {t('terminology.notInstalled')}</span>
          )}
        </p>
      )}

      <div className="row-actions term-actions">
        {dirty && <span className="pill warn">{t('terminology.unsaved')}</span>}
        {!dirty && !overridden && (
          <span className="term-note">{t('terminology.usingDefault')}</span>
        )}
        <button
          type="button"
          className="btn btn-sm btn-primary"
          aria-label={t('terminology.a11ySave', { key: slot.key })}
          disabled={busy || !dirty || !valid}
          onClick={() => {
            // Guarded by `valid`, and re-read here so what is STORED is the
            // validator's rewritten value — never the raw input. That is where
            // the bidi fences are applied.
            if (enCheck?.ok === false || arCheck?.ok === false) return
            void onSave(slot, {
              en: enCheck?.ok ? enCheck.value : null,
              ar: arCheck?.ok ? arCheck.value : null,
            })
          }}
        >
          {busy ? t('terminology.saving') : t('terminology.save')}
        </button>
        {/* One button, two jobs, and the difference is not cosmetic: with no
            stored row there is nothing to delete, so this discards the typing
            locally instead of spending a round trip to remove a row that was
            never written. Both land on the same place — the built-in wording —
            which is why they share a name. */}
        <button
          type="button"
          className="btn btn-sm btn-ghost"
          aria-label={t('terminology.a11yReset', { key: slot.key })}
          disabled={busy || (!overridden && !dirty)}
          onClick={() => (overridden ? void onReset(slot) : onDiscard(slot.key))}
        >
          {t('terminology.reset')}
        </button>
      </div>
    </div>
  )
}
