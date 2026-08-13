// The one filter control, over the one filter model.
//
// It owns no state. `FilterState` comes in, a new `FilterState` goes out, and
// the screen decides whether that lives in a URL, in a store or in a useState —
// which is what lets follow-ups, the board, the timeline and the dashboard
// share this component without agreeing on anything else. lib/entryFilter.ts is
// the only import path for the shape; a second filter type would mean two URL
// round-trips and two definitions of "mine".
//
// SEARCH IS NOT DEBOUNCED, on purpose. Filtering is client-side over one
// working-set fetch (EXECUTION-PLAN §2.3) — a few thousand rows through
// selectEntries, memoised on filterKey — so a keystroke costs a pass over an
// array already in memory. A debounce would buy nothing measurable and would
// cost the property that makes this control feel instant, plus it would need a
// local draft that then has to be reconciled with a filter arriving from a
// deep link.
//
// FACETS ARE OPT-IN PER SCREEN. The board owns its own status columns, so it
// passes a facet list without `status`; the dashboard has no scope switch. A
// component that decided this for itself would be wrong on at least one screen.
//
// ── GROUP (0018) ───────────────────────────────────────────────────────────
//
// The group facet is FIRST-CLASS, not a shortcut that expands into track ids.
// Expanding was the tempting version — it would have needed no model change at
// all — and it is wrong in three ways that only show up later: the URL would
// read `track=a,b,c` so a shared link could not say "Technical"; picking a track
// after a group would silently clear the group chip, because both controls would
// be writing one field; and a group that gained a track would leave every saved
// link filtering to yesterday's membership. So `FilterState.groupIds` is its own
// array, matched in lib/entryFilter through the track→group map in
// FilterContext, and this control is the only thing that writes it.
//
// SINGLE-SELECT OVER AN ARRAY, exactly like `track` and for the same reason: one
// group is what every screen asks for, and the array shape is what makes adding
// a multi-select later a component change rather than a model change. With two
// groups in the workspace, selecting both is the same as selecting neither.
//
// THERE IS NO "no group" OPTION, and that is not an omission. A track with no
// group is an admin state that Settings › Groups surfaces and fixes; offering it
// as a filter here would put a permanent third choice in front of every user for
// a condition that should never last more than a minute.
//
// ── BRANCH AND VENDOR (0023) ───────────────────────────────────────────────
//
// Two more first-class dimensions, for the group facet's three reasons one
// level down the tree — lib/entryFilter's `mapNodeIds` and `vendors` carry the
// argument in full. What is decided HERE is what each control looks like, and
// the two answers are deliberately different:
//
//   VENDOR is a picker. The integrators are a short flat list read off the
//   nodes, they are exactly what Aziz asked to filter by, and choosing one is
//   the whole interaction. There is no "no vendor" option, for the reason the
//   group facet gives one paragraph up and one more besides: most of the tree —
//   every programme and every phase — legitimately has no integrator, so the
//   option would return the work filed on structure rather than on an
//   organization, which is not a question anybody has.
//
// ── ACCOUNT MANAGER (0023), AND FINDING AN ORGANIZATION BY NAME ────────────
//
// THE MANAGER FACET is the fourth first-class dimension and it is modelled on
// VENDOR, not on `owner`: both are attributes of a PLACE that must answer for
// entries filed anywhere beneath it, which is why lib/entryFilter resolves them
// through a map built in the store's one tree walk. `owner` is a different
// question — who is chasing this one item — and the two are routinely different
// people. It is rendered ONLY when the workspace has a roster, on the group and
// vendor facets' rule: a heading over a lone "Any account manager" chip is a
// control that looks broken.
//
// AN OptionGroup, NOT A <select>, and this is the one place this component
// departs from the wave's design note. Two reasons, both structural rather than
// stylistic. First, a departed manager: a link saying `manager=<uuid>` after
// that person handed the book over has to stay VISIBLE and REMOVABLE, which is
// the orphan-option contract `owner` and `vendor` already implement here and
// which a native <select> cannot express — it would show its first option under
// an active filter, the exact "1 filter over a list nobody can explain" failure
// this file's BRANCH paragraph is about. Second, `filters.css` owns the `.flt-*`
// prefix and has no rule for a <select>; styling one to 44px in both languages
// is new CSS for a control the panel already has a better version of.
//
// ── THE ORGANIZATION TYPE-AHEAD ─────────────────────────────────────────────
//
// The search box already narrows ENTRIES by text. Over four hundred
// organizations it also has to be the way you REACH one — typing four letters of
// a hospital's name and tapping it, in either language, is the budget — so the
// same field now offers matching map nodes as their own group above the rail's
// result count. Folded through lib/text.normalizeSearch, so Arabic diacritics,
// hamza carriers and Arabic-Indic digits all match the way the rest of the app
// matches; matched over `name` AND `name_ar`, so an English speaker can find an
// organization whose only real name is Arabic and vice versa.
//
// WHAT A PICK DOES IS THE SCREEN'S DECISION, not this component's — `onPickNode`.
// On the map the answer is to fly the camera there; on a table it is to narrow
// to that organization's rows. With no handler supplied the fallback is the
// honest one this component can do alone: narrow `mapNodeIds` to it, which is
// what every screen that owns no camera means by "take me to Org1".
//
//   BRANCH IS A READOUT, and it renders ONLY when something is already
//   selected. The map is the branch picker — a reader points at UHR › OB › Org1
//   by drilling into it, and reproducing forty organizations as a flat chip row
//   inside a disclosure panel would be a worse version of the surface behind it.
//   What this facet owes the reader is the other half: a filter that arrived in
//   a pasted link has to be VISIBLE and REMOVABLE, or the badge says "1 filter"
//   over a list nobody can explain. That is `owner`'s orphan-option precedent
//   two facets down, and it is why the chips are toggles rather than a
//   radiogroup: a link may carry several branches and a single-select control
//   would show one of them and silently keep filtering on the rest.

import { useId, useMemo, useState, type ReactElement } from 'react'
import {
  ChipToggles,
  OptionGroup,
  TagPicker,
  TrackPicker,
  type PickerOption,
} from './pickers'
import { IconChevronDown } from './fields/glyphs'
import { t, useLocale, type Locale } from '../lib/i18n'
import { trackVars } from '../lib/trackStyle'
import { normalizeSearch } from '../lib/text'
import { foldVendors } from '../lib/mapNodes'
import {
  countActiveFacets,
  EMPTY_FILTER,
  MANAGER_NONE,
  type FilterState,
} from '../lib/entryFilter'
import { useGroups, useMapNodeMap, useMapNodes } from '../store/config'
import { useMembers } from '../store/members'
import { useVocab } from '../store/vocab'
import type {
  EntryPriority,
  EntryStatus,
  EntryType,
  HealthLevel,
  MapNode,
  TrackGroup,
} from '../types'
import './filters.css'

/**
 * A group's name in the given locale — `lib/labels.trackLabel` for the level
 * above tracks, fallback rule included: `name_ar` is `not null default ''`, so
 * the test is for EMPTY, not null.
 *
 * LOCAL, AND IT SHOULD NOT STAY THAT WAY — the same note pages/settings/
 * GroupsAdmin.tsx carries over its identical copy. This belongs beside
 * `trackLabel` in src/lib/labels.ts, which is that file's whole subject; it is
 * duplicated because labels.ts is not this worker's file and the group data
 * layer landed without it. The handoff carries the diff that consolidates both.
 */
function groupLabelIn(group: TrackGroup, locale: Locale): string {
  if (locale === 'ar') return group.name_ar.trim() || group.name
  return group.name
}

/**
 * A node's name in the given locale — `groupLabelIn`'s rule for the hierarchy
 * below tracks, and the same fallback for the same reason: `map_nodes.name_ar`
 * is `not null default ''`, so an untranslated organization shows its English
 * name rather than an empty chip.
 *
 * LOCAL FOR NOW, and it belongs in src/lib/labels.ts beside `trackLabel` with
 * `groupLabelIn` above it — the handoff carries that consolidation.
 */
function nodeLabelIn(node: MapNode, locale: Locale): string {
  if (locale === 'ar') return node.name_ar.trim() || node.name
  return node.name
}

export type FilterFacet =
  | 'search'
  | 'scope'
  | 'mine'
  | 'group'
  | 'track'
  | 'branch'
  | 'vendor'
  | 'manager'
  | 'status'
  | 'priority'
  | 'type'
  | 'owner'
  | 'tag'
  | 'health'

const DEFAULT_FACETS: readonly FilterFacet[] = [
  'search',
  'scope',
  'mine',
  // Above `track` in the panel as well as here: group is the coarser cut and the
  // one a person reaches for first ("my half"), and a facet list reads top to
  // bottom in the order it narrows.
  'group',
  'track',
  // Below `track` and above everything else, because the panel reads in the
  // order it narrows and these two are the next cut down the same tree: group →
  // track → branch, then vendor, which is a question about the branches.
  'branch',
  'vendor',
  // After `vendor`, and the pair reads as one sentence in the order it narrows:
  // who is DOING the work, then who is ACCOUNTABLE for it.
  'manager',
  'status',
  'priority',
  'type',
  'owner',
  'tag',
  'health',
]

/** The four levels of `v_entry_health`, in escalating order. */
const HEALTH_LEVELS: readonly HealthLevel[] = ['ok', 'stale', 'overdue', 'critical']

const SCOPES = [
  { key: 'open', labelKey: 'filter.scopeOpen' },
  { key: 'closed', labelKey: 'filter.scopeClosed' },
  { key: 'all', labelKey: 'filter.scopeAll' },
] as const

/** Synthetic option keys for the owner facet. Never stored. */
const OWNER_UNASSIGNED = ' unassigned'
const OWNER_OTHER = ' other'

export interface FilterBarProps {
  value: FilterState
  onChange: (next: FilterState) => void
  /** Which facets this screen wants. Defaults to everything except sort. */
  facets?: readonly FilterFacet[]
  /** The tag vocabulary to offer — tags present in the data, plus suggestions. */
  tags?: readonly string[]
  /**
   * The matching-row summary, announced politely when it changes — e.g.
   * `(n) => t('followups.total', { count: n })`.
   *
   * A FUNCTION rather than a number plus a key, because the sentence belongs to
   * the screen's own namespace: follow-ups says "12 items need attention", the
   * board says "12 open items". §4.3 forbids one shared key covering both,
   * which is why each ships its own `total` rather than sharing one here.
   */
  resultLabel?: (count: number) => string
  /** Matching row count. Rendered only when `resultLabel` is supplied too. */
  count?: number
  /** One line under the tag facet explaining its AND semantics, if the screen wants it. */
  tagHint?: string
  /**
   * What to do when the reader picks an organization out of the search
   * type-ahead. The SCREEN's decision, because the answer is different on every
   * surface: a map lens flies the camera to it, a table scrolls its row into
   * view. Omitted, the search narrows `mapNodeIds` to that node instead — the
   * only answer a component with no camera can honestly give.
   *
   * The search box is cleared either way, because the words were how the reader
   * NAMED the place, not a filter they meant to leave on the entry list.
   */
  onPickNode?: (nodeId: string) => void
  className?: string
}

/**
 * How many organizations the type-ahead offers before it stops and says how many
 * more there are.
 *
 * Eight, because the group sits above the panel on a 375px screen and a list
 * that pushes the disclosure off the viewport has replaced one navigation
 * problem with another. The overflow is COUNTED AND STATED rather than silently
 * dropped — a reader who cannot see their hospital needs to know whether to type
 * another letter or to stop looking.
 */
const ORG_MATCH_LIMIT = 8

export default function FilterBar({
  value,
  onChange,
  facets = DEFAULT_FACETS,
  tags,
  resultLabel,
  count,
  tagHint,
  onPickNode,
  className,
}: FilterBarProps): ReactElement {
  const locale = useLocale()
  const [open, setOpen] = useState(false)
  const panelId = useId()
  const groups = useGroups()
  const mapNodes = useMapNodes()
  const mapNodeById = useMapNodeMap()
  const members = useMembers()
  const statuses = useVocab('status')
  const priorities = useVocab('priority')
  const types = useVocab('type')

  const active = countActiveFacets(value)
  const has = (f: FilterFacet): boolean => facets.includes(f)

  // One helper rather than eleven inline spreads: every facet produces a whole
  // new FilterState, because the object is a value the caller may be holding in
  // a URL and a partial mutation would desync the two.
  const set = <K extends keyof FilterState>(key: K, next: FilterState[K]): void => {
    onChange({ ...value, [key]: next })
  }

  const groupOptions = useMemo<PickerOption[]>(
    () =>
      groups.map((group) => ({
        key: group.id,
        label: groupLabelIn(group, locale),
        // `.track-dot` with trackVars() — the stored PAIR handed to CSS, never a
        // hex chosen in JavaScript. lib/trackStyle.ts's header has the reason: a
        // JS-picked colour is picked once, at render, and keeps yesterday's hex
        // when the `auto` theme flips at sunset under a mounted page.
        mark: (
          <span
            className="track-dot"
            style={trackVars(group.color, group.color_light)}
            aria-hidden="true"
          />
        ),
      })),
    [groups, locale],
  )

  /**
   * The integrators the workspace actually has, one option each.
   *
   * THE FOLD IS lib/mapNodes.ts's, NOT THIS FILE'S, AND THAT IS THE POINT. It
   * used to be four lines here — dedupe by the folded spelling, keep the first
   * real one, skip archived nodes and vendors that fold to nothing — and wave 3
   * needed the same four lines to COUNT a cohort ("one fix unblocks 9
   * organizations"). Two copies of a rule about free text (0023:359 keeps
   * `vendor` free text on purpose) is how the picker comes to offer "Acme" while
   * the count beside it describes a different set. `foldVendors` is now the only
   * place that decides, and both surfaces read it.
   *
   * The option's KEY is the first spelling seen, because that is what somebody
   * typed and what a shared URL should read; lib/entryFilter matches vendors
   * folded, so any spelling in the cohort selects the same rows.
   *
   * ARCHIVED NODES ARE SKIPPED — see `foldVendorInto`. The filter itself is
   * unaffected: `vendorOfNode` is built over every node, so a link naming an
   * archived organization's vendor still resolves.
   */
  const vendorOptions = useMemo<PickerOption[]>(
    () => foldVendors(mapNodes).map((cohort) => ({ key: cohort.label, label: cohort.label })),
    [mapNodes],
  )

  // The chosen vendor as this control can address it. A filter restored from a
  // URL carries a SPELLING, not an id, so it is matched against the options the
  // way lib/entryFilter matches it against the data — folded. When nothing
  // matches, the value is still shown, as its own quiet option: a vendor whose
  // last organization was archived is exactly the filter a reader needs to see
  // in order to switch it off.
  const chosenVendor = value.vendors[0] ?? null
  const chosenVendorFold = chosenVendor === null ? '' : normalizeSearch(chosenVendor)
  const knownVendor =
    chosenVendorFold === ''
      ? undefined
      : vendorOptions.find((option) => normalizeSearch(option.key) === chosenVendorFold)

  /**
   * The organizations the typed words name, folded, in both languages.
   *
   * MATCHED THE WAY lib/entryFilter MATCHES A SEARCH — every whitespace-separated
   * term must appear somewhere, ANDed — so a second word narrows rather than
   * widens, which is what a person typing one means. `normalizeSearch` on both
   * sides is what makes it work in Arabic at all: tashkeel, the hamza carriers
   * and Arabic-Indic digits are gone before the comparison, so `مستشفى` finds
   * `مُسْتَشْفَى`.
   *
   * BOTH NAMES, ALWAYS. A workspace this size has organizations whose only real
   * name is Arabic and others whose Arabic column was never filled in; matching
   * only the label for the reading language would make half of them unreachable
   * in one of the two languages, which is the failure this exists to fix.
   *
   * ARCHIVED NODES ARE SKIPPED, `foldVendorInto`'s rule: a destination the
   * workspace has put away is not one the reader is trying to reach, and the
   * eight slots belong to the ones they are.
   */
  const orgMatches = useMemo(() => {
    const terms = normalizeSearch(value.search).split(' ').filter(Boolean)
    if (terms.length === 0) return { shown: [], more: 0 }
    const hits: { id: string; label: string; fold: string; lead: boolean }[] = []
    for (const node of mapNodes) {
      if (node.archived) continue
      // One haystack over both names, so a reader may type the English word and
      // the Arabic one in either order and still land on the same organization.
      const hay = normalizeSearch(`${node.name} ${node.name_ar}`)
      if (!terms.every((term) => hay.includes(term))) continue
      const label = nodeLabelIn(node, locale)
      hits.push({
        id: node.id,
        label,
        fold: normalizeSearch(label),
        // A name that STARTS with what was typed goes first. Four letters of a
        // hospital's name should not be outranked by a phase that happens to
        // carry them in the middle.
        lead: hay.startsWith(terms[0] ?? ''),
      })
    }
    hits.sort((a, b) => {
      if (a.lead !== b.lead) return a.lead ? -1 : 1
      // Code point over the FOLDED label, never localeCompare: lib/entryFilter's
      // `title` sort gives the reason — the order has to be identical in the
      // test runner and in the browser.
      return a.fold < b.fold ? -1 : a.fold > b.fold ? 1 : 0
    })
    return { shown: hits.slice(0, ORG_MATCH_LIMIT), more: Math.max(0, hits.length - ORG_MATCH_LIMIT) }
  }, [mapNodes, value.search, locale])

  /**
   * Picking an organization out of the type-ahead.
   *
   * The search is cleared in the same write, for two reasons that point the same
   * way: the words were how the reader NAMED the place rather than a filter they
   * meant to leave on the entry list, and clearing them is what dismisses the
   * suggestion group — a list that stayed open under a completed action is a
   * second thing to put away.
   *
   * THE FALLBACK CLEARS THE COLLIDING FACETS, and the set is
   * `lib/portfolio/rows.filterForOrgRow`'s exactly — track, branch, vendor,
   * manager. "Take me to King Fahad Hospital" has to mean one thing on every
   * surface, and a reader who lands on an empty list because a vendor chip they
   * set ten minutes ago excludes the hospital they just picked has been told a
   * lie by a control that looked like navigation. The two live in two files
   * because that one takes a built row and this one takes an id; they must be
   * changed together.
   */
  const pickOrg = (nodeId: string): void => {
    if (onPickNode === undefined) {
      onChange({
        ...value,
        search: '',
        trackIds: [],
        mapNodeIds: [nodeId],
        vendors: [],
        managerIds: [],
      })
    } else {
      onChange({ ...value, search: '' })
      onPickNode(nodeId)
    }
  }

  // RESOLVED OUTSIDE THE MEMO, and that is a fix rather than a style choice.
  //
  // These two labels used to be called inside `ownerOptions`, which was keyed on
  // `[members, value.owner]`. Neither of those changes when the LANGUAGE does,
  // so switching to Arabic with the panel open re-rendered the component
  // (useLocale subscribes) and the memo handed back the previous language's
  // array: the facet read "أي مسؤول … Unassigned", one English word in an
  // otherwise Arabic control, until something else invalidated it. Found by
  // toggling the language during the group facet's live pass.
  //
  // Depending on the STRINGS rather than on `locale` fixes a second case the
  // narrower fix would have missed: Settings › Terminology renames
  // `filter.unassigned` without the language changing at all, and t() then
  // returns something new while `locale` sits still.
  const unassignedLabel = t('filter.unassigned')
  const mineLabel = t('common.mine')
  const managerNoneLabel = t('filter.managerNone')
  const managerGoneLabel = t('filter.managerGone')

  /**
   * The roster, plus the gap, plus whatever a pasted link is filtering on.
   *
   * RESOLVED THROUGH THE ROSTER, NEVER AS STORED TEXT — `account_manager_id` is
   * a reference precisely so that renaming a person propagates instead of
   * leaving a stale string on forty organizations, and reading a label off
   * anything else here would put that stale string back.
   *
   * "NO ACCOUNT MANAGER" IS PINNED LAST, on lib/aggregate.loadPerOwner's stated
   * reason: it is a gap in the data, not a person, and sorting it into the
   * middle of a roster reads as a teammate. It is a real selection, though —
   * "which organizations has nobody been given" is the question an AD is
   * actually asking — which is why it is an option and not an omission.
   *
   * A MANAGER WHO HAS LEFT still renders, as a quiet option, exactly like the
   * vendor whose last organization was archived one facet up: a link to
   * somebody's book after they handed it over is precisely the filter a reader
   * needs to SEE in order to switch it off.
   */
  const managerOptions = useMemo<PickerOption[]>(() => {
    const items: PickerOption[] = members.map((m) => ({ key: m.id, label: m.displayName }))
    items.push({ key: MANAGER_NONE, label: managerNoneLabel })
    const chosen = value.managerIds[0] ?? null
    if (chosen !== null && chosen !== MANAGER_NONE && !members.some((m) => m.id === chosen)) {
      items.push({ key: chosen, label: managerGoneLabel, retired: true })
    }
    return items
  }, [members, value.managerIds, managerNoneLabel, managerGoneLabel])

  const ownerOptions = useMemo<PickerOption[]>(() => {
    const items: PickerOption[] = [{ key: OWNER_UNASSIGNED, label: unassignedLabel }]
    for (const m of members) items.push({ key: m.id, label: m.displayName })
    // A filter restored from a URL can name an owner who is not in the member
    // list — a free-text vendor, or `me` before the profile resolved. It renders
    // as its own quiet option so the user can see what is filtering their list
    // and switch it off; dropping it would leave a facet applied with no
    // control showing it.
    if (value.owner.kind === 'name') {
      items.push({ key: OWNER_OTHER, label: value.owner.name, retired: true })
    } else if (value.owner.kind === 'me') {
      items.push({ key: OWNER_OTHER, label: mineLabel, retired: true })
    }
    return items
  }, [members, value.owner, unassignedLabel, mineLabel])

  const ownerValue =
    value.owner.kind === 'any'
      ? null
      : value.owner.kind === 'unassigned'
        ? OWNER_UNASSIGNED
        : value.owner.kind === 'id'
          ? value.owner.id
          : OWNER_OTHER

  return (
    <div className={`flt${className ? ` ${className}` : ''}`}>
      <div className="flt-rail">
        {has('search') && (
          <input
            className="input flt-search"
            type="search"
            value={value.search}
            placeholder={t('filter.searchPlaceholder')}
            aria-label={t('filter.search')}
            onChange={(e) => set('search', e.target.value)}
          />
        )}

        {has('scope') && (
          <div className="chip-row flt-scope" role="group" aria-label={t('filter.title')}>
            {SCOPES.map((s) => (
              <button
                key={s.key}
                type="button"
                className="chip"
                aria-pressed={value.scope === s.key}
                onClick={() => set('scope', s.key)}
              >
                {t(s.labelKey)}
              </button>
            ))}
          </div>
        )}

        <button
          type="button"
          className="btn btn-sm flt-toggle"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => setOpen(!open)}
        >
          <IconChevronDown size={16} className={`flt-caret${open ? ' is-open' : ''}`} />
          {t('filter.open')}
          {active > 0 && (
            <span className="pill flt-count" aria-hidden="true">
              {active}
            </span>
          )}
          {/* The badge is decorative for sighted users and a sentence for
              everyone else — "Filter, 3 filters" beats "Filter, 3". */}
          {active > 0 && <span className="sr-only">{t('filter.activeCount', { count: active })}</span>}
        </button>

        {active > 0 && (
          <button
            type="button"
            className="btn btn-sm btn-ghost flt-clear"
            onClick={() => onChange({ ...EMPTY_FILTER })}
          >
            {t('filter.clearAll')}
          </button>
        )}

        {/* polite, not assertive: the count changes on every keystroke of a
            search and an assertive region would interrupt the user typing it.
            The phrasing is the caller's: `resultLabel` is handed the count and
            returns a rendered string, so a screen that has a plural node for it
            (followups.total, board.total) inflects, and one whose Arabic is
            written as an invariant still reads correctly. */}
        {count !== undefined && resultLabel !== undefined && (
          <span className="flt-result tabular" aria-live="polite">
            {resultLabel(count)}
          </span>
        )}
      </div>

      {/* THE ORGANIZATIONS THE TYPED WORDS NAME, above the panel and below the
          box that produced them — never behind the disclosure, because reaching
          one of four hundred organizations by name is the interaction this
          exists for and a disclosure would put a tap in front of it.

          Rendered only when this screen HAS a destination for the pick: either
          the screen supplied `onPickNode`, or it offers the branch facet, which
          is the control that makes the fallback narrowing visible and
          removable. Without one of those the fallback would apply a filter with
          nothing on screen explaining it.

          Plain buttons, not toggles: picking is an ACTION, and `aria-pressed`
          on a control that leaves nothing pressed is a promise the group cannot
          keep. `.chip`'s inline 44 and its ::after overlay make each one a
          thumb target at no cost, and `.chip-row` is the global primitive the
          scope switcher above already uses. */}
      {has('search') && (onPickNode !== undefined || has('branch')) && orgMatches.shown.length > 0 && (
        <div className="chip-row" role="group" aria-label={t('filter.organizations')}>
          {/* Decorative for sighted readers and carried by the group's own
              accessible name for everyone else — MapLensBar's badge recipe, so
              the label is not announced twice. */}
          <span className="flt-facet-title" aria-hidden="true">
            {t('filter.organizations')}
          </span>
          {orgMatches.shown.map((hit) => (
            <button key={hit.id} type="button" className="chip" onClick={() => pickOrg(hit.id)}>
              {hit.label}
            </button>
          ))}
          {/* COUNTED AND STATED. A reader whose hospital is not among the eight
              needs to know whether to type another letter or to stop looking;
              eight matches with nine hidden and no sign of it is the same lie
              as a silently clamped list. */}
          {orgMatches.more > 0 && (
            <span className="flt-hint">{t('filter.orgMore', { count: orgMatches.more })}</span>
          )}
        </div>
      )}

      <div id={panelId} className="flt-panel" hidden={!open}>
        {/* MINE, FIRST, AND INSIDE THE PANEL — it was a chip on the rail.
            Moving it is the difference between twelve persistent targets over
            the map and thirteen, and it costs nothing that matters: it is the
            same `has('mine')` guard, the same `set('mine', …)` write, the same
            pressed state, now sitting with the eleven other facets instead of
            beside a search box. First because it is the coarsest cut in the
            list — "only my work" halves everything below it. */}
        {has('mine') && (
          <section className="flt-facet">
            <h3 className="flt-facet-title">{t('filter.mine')}</h3>
            <button
              type="button"
              className="chip flt-mine"
              aria-pressed={value.mine}
              onClick={() => set('mine', !value.mine)}
            >
              {t('filter.mine')}
            </button>
          </section>
        )}

        {/* Rendered only when the workspace HAS groups. Before 0018 is applied —
            and on a build with no Supabase project at all — `useGroups()` is
            empty, and an empty facet is a heading over a single "Any group"
            chip: a control that looks broken rather than one that is not there.
            The same reasoning `tag` uses two facets down. */}
        {has('group') && groupOptions.length > 0 && (
          <section className="flt-facet">
            <h3 className="flt-facet-title">{t('filter.group')}</h3>
            <OptionGroup
              label={t('filter.group')}
              options={groupOptions}
              value={value.groupIds[0] ?? null}
              clearLabel={t('filter.anyGroup')}
              // The model holds an ARRAY and this control sets one, for the
              // reason the track facet below spells out: a single group is what
              // every screen asks for, and the array is what makes a multi-group
              // chip row a component change rather than a model change.
              onChange={(id) => set('groupIds', id === null ? [] : [id])}
            />
          </section>
        )}

        {has('track') && (
          <section className="flt-facet">
            <h3 className="flt-facet-title">{t('filter.track')}</h3>
            <TrackPicker
              label={t('filter.track')}
              value={value.trackIds[0] ?? null}
              clearLabel={t('common.all')}
              // The model holds an ARRAY of track ids and this control sets one.
              // That is deliberate for now: a single track is what every screen
              // asks for, and a multi-track chip group is a different control
              // whose empty state ("all") and whose two-of-six state read very
              // differently. The array shape is what makes adding it later a
              // component change and not a model change.
              onChange={(id) => set('trackIds', id === null ? [] : [id])}
            />
          </section>
        )}

        {/* Rendered only when a branch is already selected — the map is the
            picker, and this is the readout that makes a pasted link's branch
            visible and removable. See the header. */}
        {has('branch') && value.mapNodeIds.length > 0 && (
          <section className="flt-facet">
            <h3 className="flt-facet-title">{t('filter.branch')}</h3>
            <ChipToggles
              label={t('filter.branch')}
              options={value.mapNodeIds.map((id) => {
                const node = mapNodeById.get(id)
                return {
                  key: id,
                  // `mapNodeById` holds ARCHIVED nodes too, so an organization
                  // somebody put away still reads as itself. Only an id the
                  // workspace has never heard of — a link to something deleted —
                  // falls back, and it falls back to a sentence rather than to a
                  // raw uuid, which tells the reader nothing and cannot be read
                  // aloud.
                  label: node ? nodeLabelIn(node, locale) : t('filter.branchGone'),
                  retired: node === undefined || node.archived,
                }
              })}
              // Every selected branch is pressed, and pressing one removes it.
              // A radiogroup here would show the first of several and keep
              // filtering on the rest invisibly.
              value={value.mapNodeIds}
              onChange={(next) => set('mapNodeIds', next)}
            />
            {/* Descendants surprise people the way AND-ed tags do: choosing OB
                keeps everything filed under every organization inside it. */}
            <p className="flt-hint">{t('filter.branchHint')}</p>
          </section>
        )}

        {/* Rendered only when the workspace records vendors at all — the group
            facet's rule two sections up, for its reason: a heading over a lone
            "Any vendor" chip is a control that looks broken, and before 0023 is
            applied there are no nodes to read them off. */}
        {has('vendor') && vendorOptions.length > 0 && (
          <section className="flt-facet">
            <h3 className="flt-facet-title">{t('filter.vendor')}</h3>
            <OptionGroup
              label={t('filter.vendor')}
              options={
                chosenVendor !== null && knownVendor === undefined
                  ? [...vendorOptions, { key: chosenVendor, label: chosenVendor, retired: true }]
                  : vendorOptions
              }
              // The option's own spelling when one matched, so the control
              // checks the chip it is showing; the filter's spelling otherwise,
              // which is the orphan option just appended.
              value={knownVendor?.key ?? chosenVendor}
              clearLabel={t('filter.anyVendor')}
              // Single-select over an array, exactly like `group` and `track`:
              // one integrator is the question Aziz asked, and the array shape
              // is what makes a multi-vendor chip row a component change rather
              // than a model change.
              onChange={(vendor) => set('vendors', vendor === null ? [] : [vendor])}
            />
          </section>
        )}

        {/* Rendered only when the workspace HAS a roster — the group and vendor
            facets' rule, for its reason. Before anybody has signed in
            `useMembers()` is empty, and a heading over "Any account manager"
            and "No account manager" is a control that looks broken. */}
        {has('manager') && members.length > 0 && (
          <section className="flt-facet">
            <h3 className="flt-facet-title">{t('filter.manager')}</h3>
            <OptionGroup
              label={t('filter.manager')}
              options={managerOptions}
              value={value.managerIds[0] ?? null}
              // `managerAny`, not `anyManager` as the three facets above spell
              // it: every key this facet owns shares one prefix, which is what
              // lets labelSections.ts place them as a family with one rule
              // rather than four.
              clearLabel={t('filter.managerAny')}
              // Single-select over an array, exactly like `group`, `track` and
              // `vendor`: one book is the question — an AM's own, or the one an
              // AD is reviewing — and the array shape is what makes a
              // multi-manager chip row a component change rather than a model
              // change the day two AMs share a programme.
              onChange={(id) => set('managerIds', id === null ? [] : [id])}
            />
          </section>
        )}

        {has('status') && (
          <section className="flt-facet">
            <h3 className="flt-facet-title">{t('filter.status')}</h3>
            {/* The cast is the boundary between a string-keyed store and the
                frozen unions, and it is sound in one direction only: every key
                here came from useVocab(), which walks FROZEN_KEYS.status — the
                same list EntryStatus is declared from. The two cannot drift
                without a types.ts edit and a store edit landing together. */}
            <ChipToggles
              label={t('filter.status')}
              options={statuses.map((s) => ({ key: s.key, label: s.label, color: s.color }))}
              value={value.statuses}
              onChange={(next) => set('statuses', next as EntryStatus[])}
            />
          </section>
        )}

        {has('priority') && (
          <section className="flt-facet">
            <h3 className="flt-facet-title">{t('filter.priority')}</h3>
            <ChipToggles
              label={t('filter.priority')}
              options={priorities.map((p) => ({ key: p.key, label: p.label, color: p.color }))}
              value={value.priorities}
              onChange={(next) => set('priorities', next as EntryPriority[])}
            />
          </section>
        )}

        {has('type') && (
          <section className="flt-facet">
            <h3 className="flt-facet-title">{t('filter.type')}</h3>
            <ChipToggles
              label={t('filter.type')}
              options={types.map((ty) => ({ key: ty.key, label: ty.label, color: ty.color }))}
              value={value.types}
              onChange={(next) => set('types', next as EntryType[])}
            />
          </section>
        )}

        {has('health') && (
          <section className="flt-facet">
            <h3 className="flt-facet-title">{t('filter.health')}</h3>
            <ChipToggles
              label={t('filter.health')}
              // Health is NOT a vocab kind — its four levels are computed by
              // v_entry_health, and making them configurable is one step from
              // configuring the algorithm. The labels are frozen i18n keys.
              options={HEALTH_LEVELS.map((h) => ({ key: h, label: t(`health.${h}`) }))}
              value={value.health}
              onChange={(next) => set('health', next as HealthLevel[])}
            />
          </section>
        )}

        {has('owner') && (
          <section className="flt-facet">
            <h3 className="flt-facet-title">{t('filter.owner')}</h3>
            <OptionGroup
              label={t('filter.owner')}
              options={ownerOptions}
              value={ownerValue}
              clearLabel={t('filter.anyOwner')}
              onChange={(key) => {
                if (key === null) set('owner', { kind: 'any' })
                else if (key === OWNER_UNASSIGNED) set('owner', { kind: 'unassigned' })
                else if (key === OWNER_OTHER) {
                  // Re-selecting the orphan option is a no-op rather than a
                  // reconstruction: it already IS the filter, and rebuilding it
                  // from a label would turn a `me` filter into a name filter
                  // for a person called "Mine".
                } else set('owner', { kind: 'id', id: key })
              }}
            />
          </section>
        )}

        {has('tag') && tags !== undefined && tags.length > 0 && (
          <section className="flt-facet">
            <h3 className="flt-facet-title">{t('filter.tag')}</h3>
            <TagPicker
              label={t('filter.tag')}
              available={tags}
              value={value.tags}
              onChange={(next) => set('tags', next)}
            />
            {/* AND semantics surprise people — a row must carry EVERY listed
                tag. The sentence is the screen's to write, in its namespace. */}
            {tagHint && <p className="flt-hint">{tagHint}</p>}
          </section>
        )}
      </div>
    </div>
  )
}
