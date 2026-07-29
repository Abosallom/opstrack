// Hand-rolled i18n. Two languages and a flat dot-path key space do not justify
// pulling in i18next and its React bindings, so this module is the whole thing:
// lookup, {var} interpolation, persistence, and a subscribable locale.
//
// Missing-key behaviour is deliberate: Arabic falls back to the English string
// (a readable sentence in the wrong language beats an empty label), and an
// unknown key falls back to the key itself so the gap is obvious in review
// instead of rendering as blank space.

import { useSyncExternalStore } from 'react'
import en from '../locales/en.json'
import ar from '../locales/ar.json'

export type Locale = 'en' | 'ar'

const KEY = 'opstrack_locale'

/** A locale bundle: nested objects bottoming out in strings. */
interface Tree {
  [k: string]: string | Tree
}

const BUNDLES: Record<Locale, Tree> = { en, ar }

const RTL_LOCALES: readonly Locale[] = ['ar']

function readStored(): Locale {
  const v = localStorage.getItem(KEY)
  return v === 'ar' || v === 'en' ? v : 'en'
}

// Cached so getSnapshot() below stays cheap and returns a stable value —
// useSyncExternalStore calls it on every render.
let current: Locale = readStored()

const listeners = new Set<() => void>()

export function getLocale(): Locale {
  return current
}

export function setLocale(l: Locale): void {
  if (l === current) return
  current = l
  localStorage.setItem(KEY, l)
  applyLocale()
  for (const fn of listeners) fn()
}

/**
 * Push the locale onto <html>. `dir` drives every CSS logical property in the
 * app, so this must run before first paint (main.tsx) — flipping it later
 * causes a visible layout mirror.
 */
export function applyLocale(): void {
  const el = document.documentElement
  el.lang = current
  el.dir = RTL_LOCALES.includes(current) ? 'rtl' : 'ltr'
}

function lookup(tree: Tree, key: string): string | undefined {
  let node: string | Tree | undefined = tree
  for (const part of key.split('.')) {
    if (typeof node !== 'object') return undefined
    node = node[part]
  }
  return typeof node === 'string' ? node : undefined
}

function interpolate(template: string, vars: Record<string, string | number>): string {
  // Unknown placeholders are left verbatim rather than blanked, so a missing
  // variable reads as `{count}` in the UI and gets caught.
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in vars ? String(vars[name]) : match,
  )
}

export function t(key: string, vars?: Record<string, string | number>): string {
  const raw = lookup(BUNDLES[current], key) ?? lookup(BUNDLES.en, key) ?? key
  return vars ? interpolate(raw, vars) : raw
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

/**
 * Re-renders the calling component when the language changes. Components that
 * call t() need this — t() is a plain function and React has no way to know a
 * language switch invalidated its output otherwise.
 */
export function useLocale(): Locale {
  return useSyncExternalStore(subscribe, getLocale, getLocale)
}
