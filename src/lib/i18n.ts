// Hand-rolled i18n. Two languages and a flat dot-path key space do not justify
// pulling in i18next and its React bindings, so this module is the whole thing:
// lookup, {var} interpolation, CLDR plural selection, persistence, and a
// subscribable locale.
//
// Missing-key behaviour is deliberate: Arabic falls back to the English string
// (a readable sentence in the wrong language beats an empty label), and an
// unknown key falls back to the key itself so the gap is obvious in review
// instead of rendering as blank space.
//
// ── the override layer (Settings › Terminology) ────────────────────────────
//
// Above the bundles sits a map the admin screen writes, so that renaming a field
// costs a save rather than a deploy. Resolution becomes:
//
//   override[locale][key] → bundle[locale][key] → bundle.en[key] → key
//
// WHY AN OVERRIDE LAYER RATHER THAN EDITING THE BUNDLES: the bundles ship in the
// build, so editing them means a deploy for every wording change — the exact
// round trip the feature exists to delete. Overrides are data. It also makes
// "reset to default" trivially correct: drop the entry and the shipped string
// returns, with no copy of it kept anywhere to go stale.
//
// THIS MODULE MUST NOT IMPORT A STORE. store/labels.ts loads the rows at
// sign-in and PUSHES them in through setOverrides(); i18n never pulls. That is
// the same layering rule lib/ lives under everywhere else, and it is what keeps
// the resolution below synchronous and t()'s signature unchanged.

import { useSyncExternalStore } from 'react'
import { writeRawCache } from './cache'
// Imported for its module-scope side effect as much as for the function. This
// module resolves the locale AT MODULE SCOPE (`current`, below), so the
// `opstrack_` → `nphiescore_` copy has to have completed by the time that line
// runs — and an import is the only thing that is guaranteed to. See
// lib/storageMigration.ts, decision 1.
import { readWithLegacyFallback } from './storageMigration'
// One file per namespace under locales/{en,ar}/, merged there. The two
// monolithic bundles this used to import were the build's worst contention
// point; the key space and everything below is unchanged by the split.
import { ar, en } from '../locales'
import { isBlankLabel, overrideKey } from './labelOverrides'
import { PLURAL_CATEGORIES, isPluralNode, selectPlural, type PluralNode } from './plural'
// Type-only, so there is no runtime edge and no layering violation:
// src/types.ts is declarations and nothing else, and lib/labels.ts imports
// `Track` from it for the same reason.
import type { LabelOverrideMap } from '../types'

export type Locale = 'en' | 'ar'

const KEY = 'nphiescore_locale'

/** A locale bundle: nested objects bottoming out in strings. */
interface Tree {
  [k: string]: string | Tree
}

const BUNDLES: Record<Locale, Tree> = { en, ar }

const RTL_LOCALES: readonly Locale[] = ['ar']

function readStored(): Locale {
  // Raw, not JSON: the value is the bare word `ar`, written that way since Wave
  // 1. The try/catch this function used to carry now lives inside lib/cache.ts,
  // which answers null for no web storage at all — vitest's `node` environment,
  // which this module acquired a suite in when the override layer landed — and
  // for a private-mode restriction, and English is the right answer for both.
  // The legacy fallback is the second half of the prefix rename: this line runs
  // at module scope, and it must not be possible for it to open the app in
  // English for an Arabic reader because a copy was refused.
  const v = readWithLegacyFallback(KEY)
  return v === 'ar' || v === 'en' ? v : 'en'
}

// Cached so getSnapshot() below stays cheap and returns a stable value —
// useSyncExternalStore calls it on every render.
let current: Locale = readStored()

const listeners = new Set<() => void>()

/**
 * Bumped by anything that changes what t() answers: a language switch, and a new
 * override set.
 *
 * THIS IS THE SNAPSHOT useLocale() SUBSCRIBES TO, and it is a counter rather
 * than the locale itself for one reason. useSyncExternalStore re-renders only
 * when the snapshot changes by Object.is, so a store whose snapshot were
 * `current` would fire every listener on setOverrides() and then bail out of
 * every single re-render, because the language did not change. Every label in
 * the app would keep its old wording until something else happened to re-render
 * it — half the screen renamed and half not, which is the exact failure
 * lib/labels.ts's header describes for components that call t() without
 * subscribing.
 */
let revision = 0

/** The one way anything in this module tells its subscribers to re-read. */
function notify(): void {
  revision += 1
  for (const fn of listeners) fn()
}

export function getLocale(): Locale {
  return current
}

export function setLocale(l: Locale): void {
  if (l === current) return
  current = l
  // Quota, private mode, or no storage at all are all handled inside
  // writeRawCache, which falls back to a process-lifetime map rather than
  // throwing: the switch always applies for this session, and only its survival
  // across a reload is at risk.
  writeRawCache(KEY, l)
  applyLocale()
  notify()
}

/**
 * Push the locale onto <html>. `dir` drives every CSS logical property in the
 * app, so this must run before first paint (main.tsx) — flipping it later
 * causes a visible layout mirror.
 */
export function applyLocale(): void {
  // Guarded for the same reason readStored() is: the pure suites run under
  // vitest's `node` environment, where there is no document to write to.
  if (typeof document === 'undefined') return
  const el = document.documentElement
  el.lang = current
  el.dir = RTL_LOCALES.includes(current) ? 'rtl' : 'ltr'
}

// ── overrides ──────────────────────────────────────────────────────────────
//
// The layer is `LabelOverrideMap` from src/types.ts: one flat `key → string`
// record PER LANGUAGE. That is the shape the feature is specified in
// (`override[locale][key]`) and it costs one record index per lookup, on a path
// t() takes for every string on every screen. It is declared in types.ts
// because api/labels.ts reads the rows, store/labels.ts projects them into the
// map and this module resolves against it, and only types.ts sits below all
// three — `src/lib/**` may not import from `src/store/**`.

const NO_OVERRIDES: LabelOverrideMap = { en: {}, ar: {} }

let overrides: LabelOverrideMap = NO_OVERRIDES

/**
 * Base keys carrying at least one per-form override — `board.total` when
 * `board.total.few` is overridden.
 *
 * Precomputed at install time so the plural path costs ONE Set lookup on the
 * overwhelmingly common miss, instead of six string concatenations and six
 * record lookups on every counted string the app renders. Same reasoning as
 * store/config.ts's derived views: build it once where the data changes, never
 * inside the read.
 */
let pluralBases: ReadonlySet<string> = new Set()

/**
 * Install the override layer and re-render every subscriber, exactly as a
 * language switch does.
 *
 * Called by store/labels.ts from its localStorage cache at module load, after
 * the sign-in fetch, and after every mutation. Synchronous and total: there is
 * no failure branch, because a wording change that could half-apply would be
 * worse than one that does not apply at all.
 *
 * The map is held by reference, not copied: store/labels.ts rebuilds it from
 * the rows on every apply rather than patching it, so there is nothing here to
 * defend against a later mutation of the object handed over.
 */
export function setOverrides(map: LabelOverrideMap): void {
  overrides = map
  const bases = new Set<string>()
  for (const key of [...Object.keys(map.en), ...Object.keys(map.ar)]) {
    const dot = key.lastIndexOf('.')
    if (dot <= 0) continue
    // The same lexical rule lib/labelOverrides.ts's categoryOf() applies, so the
    // validator and the resolver cannot read one row differently.
    if ((PLURAL_CATEGORIES as readonly string[]).includes(key.slice(dot + 1))) {
      bases.add(key.slice(0, dot))
    }
  }
  pluralBases = bases
  notify()
}

// THERE IS NO clearOverrides() HERE, AND THAT IS THE POINT. An earlier cut of
// this module exported one, documented as "called by Reset all overrides and on
// sign-out". Neither was true, and neither could be:
//
//   · "Reset every change" goes through store/labels.resetAllOverrides(), which
//     is OPTIMISTIC — it pushes an empty row list through the store's single
//     writer so that a refused delete can roll every string back. A second door
//     into this layer would empty it while the store still believed it held
//     rows, and the next optimistic save would push them all back.
//   · Sign-out must NOT clear it. These overrides are workspace-wide data, like
//     config and vocab (which are likewise not reset), and the localStorage
//     cache behind them exists so the SIGN-IN SCREEN is already in the owner's
//     wording. Clearing on sign-out would strip it off exactly the screen that
//     proves the feature works.
//
// A caller that genuinely wants the shipped strings back calls setOverrides()
// with an empty map, through the store, like everything else.

function overrideFor(key: string, locale: Locale): string | undefined {
  // Read as `unknown` on purpose. The record is built from JSON and carries
  // Object.prototype, so `t('toString')` would otherwise be answered by an
  // inherited function; the typeof guard turns that back into a miss. It is
  // also the last backstop for spec rule 5 — store/labels.ts's buildMap() drops
  // null and blank on the way in, and a row hand-edited past it in the SQL
  // editor still must not blank a nav label on somebody's phone. isBlankLabel()
  // rather than trim(), so "blank" means the same thing here as it does in the
  // validator, the api layer and the trigger; a row holding one zero-width space
  // used to pass all four and render as nothing.
  const value: unknown = overrides[locale][key]
  return typeof value === 'string' && !isBlankLabel(value) ? value : undefined
}

/**
 * The node with each overridden form swapped in.
 *
 * Returns the SHIPPED node itself when nothing is overridden, so the common case
 * allocates nothing. A category the shipped node does not carry may be added —
 * an Arabic node that never needed `zero` and now does is a real edit, and
 * selectPlural() already falls back to `other` for anything absent.
 */
function overlay(node: PluralNode, key: string, locale: Locale): PluralNode {
  if (!pluralBases.has(key)) return node
  let out: PluralNode | undefined
  for (const category of PLURAL_CATEGORIES) {
    const value = overrideFor(overrideKey(key, category), locale)
    if (value === undefined) continue
    out ??= { ...node }
    out[category] = value
  }
  return out ?? node
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
 * One locale's answer for a key: the override, the string, or the plural form
 * `count` selects.
 *
 * A plural node with NO count still resolves — to `other` — rather than falling
 * through to the key. A caller that forgot the variable gets a readable
 * sentence with a literal `{count}` in it, which is the same failure interpolate()
 * already chose for a missing variable, instead of a dot path.
 *
 * A PLURAL KEY IGNORES A BARE-KEY OVERRIDE. Its forms are overridden one at a
 * time, at `key.category`; a single string stored against the base key would
 * freeze one grammatical number for every count, which is the defect
 * lib/plural.ts exists to have removed. lib/labelOverrides.ts refuses to produce
 * such a row, and this is the second half of that guarantee — a row hand-edited
 * into the table cannot reach a reader.
 *
 * An override for a key the locale's bundle LACKS still resolves, which is why
 * the override is not conditioned on the node being present: the ar tree and the
 * en tree are held at parity by a test, not by the type system, and an override
 * the admin can see on the screen must be the one that renders.
 */
function resolve(
  tree: Tree,
  key: string,
  locale: Locale,
  vars: Record<string, string | number> | undefined,
): string | undefined {
  const node = lookupNode(tree, key)
  if (isPluralNode(node)) return selectPlural(overlay(node, key, locale), locale, vars?.count)
  const override = overrideFor(key, locale)
  if (override !== undefined) return override
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
  // The English fallback resolves against the ENGLISH plural rules, not the
  // current locale's: the form being read is an English sentence, so asking for
  // its `few` would be asking a bundle a question it was never written to
  // answer. It resolves the ENGLISH OVERRIDE too — a key the ar tree happens
  // not to carry should fall back to what the workspace calls the thing, not to
  // the name it was shipped with and has since been renamed away from.
  const raw =
    resolve(BUNDLES[current], key, current, vars) ?? resolve(BUNDLES.en, key, 'en', vars) ?? key
  return vars ? interpolate(raw, vars) : raw
}

/**
 * Subscribe to "something t() depends on has changed" — a language switch or a
 * new override set. Returns the unsubscribe.
 *
 * Exported for the same reason store/vocab.ts exports getVocabSnapshot(): not
 * everything that reads t() is a component. useLocale() below is this plus the
 * revision.
 */
export function subscribeLocale(fn: () => void): () => void {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

/**
 * The value useLocale() hands useSyncExternalStore.
 *
 * Exported so a test can prove the snapshot actually MOVES when overrides are
 * installed. A listener that fires while the snapshot compares equal does not
 * re-render anything, and that failure is invisible in a unit test that only
 * counts listener calls.
 */
export function getLabelRevision(): number {
  return revision
}

/**
 * Re-renders the calling component when the language changes OR the overrides
 * do. Components that call t() need this — t() is a plain function and React has
 * no way to know a rename invalidated its output otherwise.
 */
export function useLocale(): Locale {
  // Subscribed to the revision, not to `current`: see the comment on `revision`.
  // The locale is then read directly, because that is what the caller wants and
  // it is written before notify() every time.
  useSyncExternalStore(subscribeLocale, getLabelRevision, getLabelRevision)
  return current
}

/**
 * What the app SHIPS for a key in a locale, overrides excluded — the "default"
 * line the admin screen shows above each input, and the `shipped` argument
 * lib/labelOverrides.ts validates against.
 *
 * Returns the plural NODE rather than a form, because the shape is the question
 * the screen has to answer: a plural key gets one input per selectable category
 * and a plain key gets one. The shape is per locale on purpose — `board.total`
 * is `{one, other}` in English and an invariant string in Arabic, and both are
 * correct (see lib/plural.ts's header).
 */
export function shippedNode(key: string, locale: Locale): string | PluralNode | undefined {
  const node = lookupNode(BUNDLES[locale], key)
  if (typeof node === 'string') return node
  return isPluralNode(node) ? node : undefined
}

// THERE IS NO shippedKeys() HERE EITHER. An earlier cut exported one — every
// overridable key, walked out of the English bundle — and nothing ever called
// it: the admin screen's catalogue comes from lib/labelSections.ts, which walks
// the SAME bundles and has to, because it also answers where each key is read
// and which section it belongs to. Two walkers over one tree is the second thing
// to drift, and this module's job ends at resolving a key it is handed.
