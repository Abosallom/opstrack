// Settings store: the two preferences that live on <html> — theme and language.
//
// Both are owned by plain modules (lib/theme.ts, lib/i18n.ts) because they must
// be applied before React mounts to avoid a flash of the wrong theme or
// direction. This store is the thin reactive wrapper the Settings UI binds to,
// and the place where a language change is mirrored back to the user's profile.

import { create } from 'zustand'
import { getThemePref, setThemePref, type ThemePref } from '../lib/theme'
import { getLocale, setLocale, useLocale, type Locale } from '../lib/i18n'
import { supabase } from '../api/supabase'

const useThemeStore = create<{ theme: ThemePref }>(() => ({
  theme: getThemePref(),
}))

export function useSettings(): { theme: ThemePref; locale: Locale } {
  const theme = useThemeStore((s) => s.theme)
  // useLocale subscribes to lib/i18n's own store, so a language change made
  // anywhere (header toggle, profile load on sign-in) re-renders settings too.
  const locale = useLocale()
  return { theme, locale }
}

export function setTheme(t: ThemePref): void {
  setThemePref(t)
  useThemeStore.setState({ theme: t })
}

export function setLocaleSetting(l: Locale): void {
  if (l === getLocale()) return
  setLocale(l)

  // Mirror to the profile so the choice follows the user to another device.
  // Best-effort and deliberately not awaited: the UI has already switched, and
  // a failed write must not roll the interface back under the user. Read the
  // session from Supabase rather than the auth store to keep this module free
  // of a dependency on auth's load order.
  const client = supabase
  if (!client) return
  void client.auth.getSession().then(({ data }) => {
    const userId = data.session?.user.id
    if (!userId) return
    void client.from('profiles').update({ locale: l }).eq('id', userId)
  })
}
