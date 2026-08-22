// THE CLOSED VOCABULARIES 0031 FROZE, AND THE ONE PLACE THEY ARE SPELLED.
//
// Six of this family's columns are `check (x in (…))` constraints rather than
// lookup tables — the two phase ladders, the initiative kind, the register, the
// grades and the statuses. 0031 argues that at length: unlike the onboarding
// ladder, which the owner renames and reorders through Terminology, these are
// fixed lifecycles, and "the WORDS are i18n keys … the four steps are not data".
//
// This module exists because the words are now read in TWO places rather than
// one. `Portfolio.tsx` draws them on a card; `PortfolioEditor.tsx` offers them
// in a `<select>`. A second copy of either table is a screen that can render a
// phase the form cannot set, or a form that can write a phase the card renders
// as blank — and neither failure shows up until somebody picks the odd one out.
// It is deliberately NOT inside either component: the editor imports the cards'
// file today only for this, and taking that import out is what keeps the two
// from becoming a cycle.
//
// ⚠ THE KEYS ARE LITERALS, NOT A TEMPLATE. `lib/localeReach.test.ts` scans
//   source for quoted dotted strings and asserts each resolves in BOTH bundles;
//   a `t(`pmo.phase.${step}`)` is invisible to it and ships missing in one
//   language. `lens.ts` states the same rule about its own key tables.

import { t } from '../../lib/i18n'

/** Every phase word either ladder can show. One table, because the two share three. */
export const PHASE_LABEL: Readonly<Record<string, () => string>> = {
  start: () => t('pmo.phase.start'),
  planning: () => t('pmo.phase.planning'),
  execution: () => t('pmo.phase.execution'),
  closure: () => t('pmo.phase.closure'),
  evaluation: () => t('pmo.phase.evaluation'),
  dissemination: () => t('pmo.phase.dissemination'),
}

/**
 * ⚠ TWO LADDERS, AND THEY ARE NOT THE SAME FOUR STEPS. This is the whole
 *   reason 0031 gives an initiative its own table rather than a `kind` column
 *   on `pmo_projects`: one check constraint holding eight values, of which four
 *   are illegal for each row, "cannot state the rule it exists for".
 */
export const PROJECT_STEPS = ['start', 'planning', 'execution', 'closure'] as const
export const INITIATIVE_STEPS = ['planning', 'execution', 'evaluation', 'dissemination'] as const

/** Internal or external — where a project carries a budget. */
export const KIND_LABEL: Readonly<Record<string, () => string>> = {
  internal: () => t('pmo.kind.internal'),
  external: () => t('pmo.kind.external'),
}

export const KINDS = ['internal', 'external'] as const

/**
 * The one word that separates the source dashboard's two registers. 0031 keeps
 * them in one table because "two tables would mean two sets of policies, two
 * triggers and two of every query, to express a difference that is a single
 * word" — and this is that word, offered as a choice.
 */
export const REGISTER_LABEL: Readonly<Record<string, () => string>> = {
  risk: () => t('pmo.register.risk'),
  challenge: () => t('pmo.register.challenge'),
}

export const REGISTERS = ['risk', 'challenge'] as const

/** How bad, and how likely it is to matter. Both nullable — see 0031. */
export const GRADE_LABEL: Readonly<Record<string, () => string>> = {
  low: () => t('pmo.grade.low'),
  medium: () => t('pmo.grade.medium'),
  high: () => t('pmo.grade.high'),
}

export const GRADES = ['low', 'medium', 'high'] as const

/**
 * ONE STATUS TABLE FOR TWO COLUMNS, and that is not laziness.
 *
 * `pmo_risks.status` is open/watching/closed and `pmo_objectives.status` is
 * active/closed. "Closed" is the same word in both, so a second key holding a
 * second "Closed" would put two indistinguishable rows in front of the owner in
 * Settings ▸ Terminology — the exact collision `labelSections.test.ts` fails on,
 * and the reason its header calls a duplicate "this module failing at its stated
 * job". Four words, one table, and each column offers the subset it allows.
 */
export const STATUS_LABEL: Readonly<Record<string, () => string>> = {
  open: () => t('pmo.status.open'),
  watching: () => t('pmo.status.watching'),
  closed: () => t('pmo.status.closed'),
  active: () => t('pmo.status.active'),
}

export const RISK_STATUSES = ['open', 'watching', 'closed'] as const
export const OBJECTIVE_STATUSES = ['active', 'closed'] as const
