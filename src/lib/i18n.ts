// Hand-rolled i18n. Two languages and a flat dot-path key space do not justify
// pulling in i18next and its React bindings, so this module is the whole thing:
// lookup, {var} interpolation, CLDR plural selection, persistence, and a
// subscribable locale.
//
// Missing-key behaviour is deliberate: Arabic falls back to the English string
// (a readable sentence in the wrong language beats an empty label), and an
// unknown key falls back to the key itself so the gap is obvious in review
// instead of rendering as blank space.

import { useSyncExternalStore } from 'react'
// One file per namespace under locales/{en,ar}/, merged there. The two
// monolithic bundles this used to import were the build's worst contention
// point; the key space and everything below is unchanged by the split.
import { ar, en } from '../locales'
import { isPluralNode, selectPlural } from './plural'

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

// ── plurals ────────────────────────────────────────────────────────────────
//
// The CLDR table itself lives in lib/plural.ts, because lib/dates.ts needs the
// same one and cannot import this module — see that file's header. Everything
// below is the lookup half: finding the node, then asking plural.ts which of
// its forms `{count}` selects.

/** Walk the dot path. Returns the node, whatever it is — string, tree or absent. */
function lookupNode(tree: Tree, key: string): string | Tree | undefined {
  let node: string | Tree | undefined = tree
  for (const part of key.split('.')) {
    if (typeof node !== 'object') return undefined
    node = node[part]
  }
  return node
}

/**
 * One bundle's answer for a key: the string, or the plural form `count` selects.
 *
 * A plural node with NO count still resolves — to `other` — rather than falling
 * through to the key. A caller that forgot the variable gets a readable
 * sentence with a literal `{count}` in it, which is the same failure interpolate()
 * already chose for a missing variable, instead of a dot path.
 */
function resolve(
  tree: Tree,
  key: string,
  locale: Locale,
  vars: Record<string, string | number> | undefined,
): string | undefined {
  const node = lookupNode(tree, key)
  if (typeof node === 'string') return node
  if (!isPluralNode(node)) return undefined
  return selectPlural(node, locale, vars?.count)
}

function interpolate(template: string, vars: Record<string, string | number>): string {
  // Unknown placeholders are left verbatim rather than blanked, so a missing
  // variable reads as `{count}` in the UI and gets caught.
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in vars ? String(vars[name]) : match,
  )
}

export function t(key: string, vars?: Record<string, string | number>): string {
  // The English fallback resolves against the ENGLISH plural rules, not the
  // current locale's: the form being read is an English sentence, so asking for
  // its `few` would be asking a bundle a question it was never written to
  // answer.
  const raw =
    resolve(BUNDLES[current], key, current, vars) ?? resolve(BUNDLES.en, key, 'en', vars) ?? key
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
