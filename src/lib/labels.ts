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
import type { Track } from '../types'

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
