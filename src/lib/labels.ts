// Localised display names for database rows.
//
// Every one of these comes in two flavours: a bare function taking an explicit
// locale, and a hook.
//
// COMPONENTS MUST USE THE HOOK. A bare module function reads lib/i18n's module
// state, and React has no way to know a language toggle invalidated its output —
// the component keeps its last render until something else happens to re-render
// it, so half the screen flips language and half does not. i18n.ts documents
// this exact hazard around t(). The hook calls useLocale() internally, which
// subscribes the caller.
//
// The bare functions exist for the code that has no component to hang a
// subscription off: the phase-8 digest generator formats a message in a locale
// it is handed, outside React entirely.

import { useCallback } from 'react'
import { useLocale, type Locale } from './i18n'
import type { MapNode, MapNodeKind, Track } from '../types'

/**
 * A track's name in the given locale.
 *
 * name_ar is `not null default ''`, so the fallback tests for EMPTY, not null —
 * a track created before anyone typed an Arabic name shows its English name
 * rather than a blank chip.
 */
export function trackLabel(track: Track, locale: Locale): string {
  if (locale === 'ar') return track.name_ar.trim() || track.name
  return track.name
}

/** The supported way for a component to label a track. Re-renders on language change. */
export function useTrackLabel(): (track: Track) => string {
  const locale = useLocale()
  // Memoised on locale so passing this into a memo'd list row does not
  // invalidate it on every parent render.
  return useCallback((track: Track) => trackLabel(track, locale), [locale])
}

/**
 * A hierarchy node's name — `trackLabel`'s rule one level down, fallback and all.
 *
 * It takes a `Pick` rather than a whole `MapNode` because both call sites hold a
 * different shape of the same two columns: the map builds its view model from
 * store rows, and the admin screen labels a draft that has no id yet.
 */
export function nodeLabel(node: Pick<MapNode, 'name' | 'name_ar'>, locale: Locale): string {
  if (locale === 'ar') return node.name_ar.trim() || node.name
  return node.name
}

/** The supported way for a component to label a node. Re-renders on language change. */
export function useNodeLabel(): (node: Pick<MapNode, 'name' | 'name_ar'>) => string {
  const locale = useLocale()
  return useCallback((node: Pick<MapNode, 'name' | 'name_ar'>) => nodeLabel(node, locale), [locale])
}

/**
 * A node KIND's name — "Organization", "Phase".
 *
 * A CAPTION AND NEVER A CONDITION. Three files say so at length (model.ts's
 * `entityType`, useMapKeyboard's dive test, MapBranchDetail's header): the moment
 * anything compares this string to a literal, renaming a kind in the admin screen
 * silently changes behaviour somewhere nobody was looking. It is resolved for the
 * locale precisely because it is display text — a condition would then depend on
 * the reader's language, which is the tell.
 */
export function kindLabel(kind: Pick<MapNodeKind, 'name' | 'name_ar'>, locale: Locale): string {
  if (locale === 'ar') return kind.name_ar.trim() || kind.name
  return kind.name
}

/** The supported way for a component to label a node kind. */
export function useKindLabel(): (kind: Pick<MapNodeKind, 'name' | 'name_ar'>) => string {
  const locale = useLocale()
  return useCallback((kind: Pick<MapNodeKind, 'name' | 'name_ar'>) => kindLabel(kind, locale), [locale])
}
