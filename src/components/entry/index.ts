// The entry kit's public surface — fifteen exports and their prop types.
//
// Contracts rule 1: ONE IMPORT PATH PER CONCEPT. Every screen imports entry
// components from `components/entry`, never from a file inside it. That is what
// lets Wave 2 transfer EntrySheet and UpdateThread to W2-DETAIL, and Wave 5
// split atoms.tsx if it grows, without touching a single call site.
//
// Types are re-exported with `export type { … }` because `verbatimModuleSyntax`
// is on: a plain re-export of a type would emit a runtime import of a binding
// that does not exist and break the build.
//
// Every module below imports './entry.css' for itself; Vite dedupes, so the
// stylesheet lands once however few of these a screen actually uses.

export {
  AgePill,
  DueLabel,
  HealthPill,
  OwnerBadge,
  PriorityDot,
  StatusPill,
  TagChip,
  TrackDot,
} from './atoms'
export type {
  AgePillProps,
  DueLabelProps,
  HealthPillProps,
  OwnerBadgeProps,
  PriorityDotProps,
  StatusPillProps,
  TagChipProps,
  TrackDotProps,
} from './atoms'

export { default as LinkList } from './LinkList'
export type { LinkListProps } from './LinkList'

export { default as EntryRow } from './EntryRow'
export type { EntryRowProps, EntryRowShow } from './EntryRow'

export { default as EntryCard } from './EntryCard'
export type { EntryCardProps } from './EntryCard'

export { default as EntrySection } from './EntrySection'
export type { EntrySectionProps } from './EntrySection'

export { default as EntrySheet } from './EntrySheet'
export type { EntrySheetProps } from './EntrySheet'

export { default as UpdateThread } from './UpdateThread'
export type { UpdateThreadProps } from './UpdateThread'

export { useSwipeActions } from './useSwipeActions'
export type { SwipeActions, SwipeHandlers } from './useSwipeActions'
