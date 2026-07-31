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

import { useId, useMemo, useState, type ReactElement } from 'react'
import {
  ChipToggles,
  OptionGroup,
  TagPicker,
  TrackPicker,
  type PickerOption,
} from './pickers'
import { IconChevronDown } from './fields/glyphs'
import { t, useLocale } from '../lib/i18n'
import { countActiveFacets, EMPTY_FILTER, type FilterState } from '../lib/entryFilter'
import { useMembers } from '../store/members'
import { useVocab } from '../store/vocab'
import type { EntryPriority, EntryStatus, EntryType, HealthLevel } from '../types'
import './filters.css'

export type FilterFacet =
  | 'search'
  | 'scope'
  | 'mine'
  | 'track'
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
  'track',
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
  useLocale()
  const [open, setOpen] = useState(false)
  const panelId = useId()
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

  const ownerOptions = useMemo<PickerOption[]>(() => {
    const items: PickerOption[] = [{ key: OWNER_UNASSIGNED, label: t('filter.unassigned') }]
    for (const m of members) items.push({ key: m.id, label: m.displayName })
    // A filter restored from a URL can name an owner who is not in the member
    // list — a free-text vendor, or `me` before the profile resolved. It renders
    // as its own quiet option so the user can see what is filtering their list
    // and switch it off; dropping it would leave a facet applied with no
    // control showing it.
    if (value.owner.kind === 'name') {
      items.push({ key: OWNER_OTHER, label: value.owner.name, retired: true })
    } else if (value.owner.kind === 'me') {
      items.push({ key: OWNER_OTHER, label: t('common.mine'), retired: true })
    }
    return items
  }, [members, value.owner])

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

        {has('mine') && (
          <button
            type="button"
            className="chip flt-mine"
            aria-pressed={value.mine}
            onClick={() => set('mine', !value.mine)}
          >
            {t('filter.mine')}
          </button>
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
