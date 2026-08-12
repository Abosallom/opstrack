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
import { countActiveFacets, EMPTY_FILTER, type FilterState } from '../lib/entryFilter'
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
  className?: string
}

export default function FilterBar({
  value,
  onChange,
  facets = DEFAULT_FACETS,
  tags,
  resultLabel,
  count,
  tagHint,
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
   * DEDUPED BY THE FOLDED SPELLING, KEYED BY A REAL ONE. lib/entryFilter matches
   * vendors folded, so 'Acme' on one organization and 'acme ' on the next are
   * one integrator and must not be two chips that select identical rows; the
   * label and the stored key are the first spelling seen, because that is what
   * somebody typed and what a shared URL should read.
   *
   * ARCHIVED NODES ARE SKIPPED. A vendor that survives only on organizations
   * somebody put away is not a choice the workspace still has, and offering it
   * would put a chip in front of every reader that selects nothing they can see.
   * The filter itself is unaffected — `vendorOfNode` is built over every node,
   * so a link naming that vendor still resolves.
   */
  const vendorOptions = useMemo<PickerOption[]>(() => {
    const byFold = new Map<string, string>()
    for (const node of mapNodes) {
      if (node.archived) continue
      const vendor = node.vendor.trim()
      if (vendor === '') continue
      const fold = normalizeSearch(vendor)
      // A vendor that folds to nothing — punctuation alone — would be a chip
      // with no label that matches every other such row.
      if (fold === '' || byFold.has(fold)) continue
      byFold.set(fold, vendor)
    }
    // Sorted on the FOLDED key and compared by code point, never through
    // localeCompare: lib/entryFilter's `title` sort gives the reason — the order
    // has to be identical in the test runner and in the browser, and folding is
    // what makes code-point order sane in both languages.
    return [...byFold.entries()]
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([, vendor]) => ({ key: vendor, label: vendor }))
  }, [mapNodes])

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
