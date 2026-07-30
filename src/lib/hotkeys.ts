// What a key MEANS, and — more importantly — who already owns it.
//
// The desktop keyboard layer is one document listener and one pure function.
// Everything hard about it is arbitration, so the arbitration is the part that
// is testable: resolveHotkey() takes a plain record and returns an intent or
// null, and the listener below is the thin thing that builds that record from a
// real KeyboardEvent and calls whoever the intent names.
//
// ── THE FOUR RULES THAT KEEP THIS LAYER OUT OF EVERYONE ELSE'S WAY ──────────
//
// 1. BUBBLE PHASE, AND BAIL ON defaultPrevented. Exactly lib/overlayStack.ts's
//    reasoning, for exactly its reason: React binds its listeners to the root
//    container and to each portal container, both strictly below `document`, so
//    a capture-phase listener here would run BEFORE any component could see the
//    key. On the bubble phase every JSX onKeyDown in the app has already had
//    its turn, and `defaultPrevented` is the flag that says one of them took
//    it. pages/Board.tsx calls preventDefault() on every arrow and digit it
//    acts on; this layer therefore cannot double-fire on a board move, and no
//    edit to Board.tsx was needed to arrange that.
//
// 2. A BARE KEY NEVER FIRES WHILE TYPING; A Cmd/Ctrl CHORD MAY. `c` inside the
//    capture box is the letter c. Cmd+K inside the capture box is still the
//    palette — that is what every app with a palette has trained people to
//    expect, and a chord cannot be mistaken for text. isTypingTarget() is the
//    test, and it is structural (tag name + contenteditable + the ARIA text
//    roles) so a node test can drive it with a plain object.
//
// 3. THIS LAYER BINDS NO ARROW KEYS AT ALL. Board owns ArrowLeft/ArrowRight
//    over its cards and the pickers own Up/Down over their options. J and K are
//    in the spec precisely because they collide with nothing, and adding arrows
//    "for convenience" is how a global layer starts eating other people's keys.
//
// 4. THE DIGITS ACT ONLY ON AN OPEN ENTRY. Board binds 1–9 to "move this card
//    to column N" whenever focus is inside one of its cards. Rather than
//    guessing which surface a focused card belongs to — the only DOM signal is
//    `[data-entry-id]`, which Board publishes and other list surfaces do not —
//    the rule is drawn where it is unambiguous: 1–4 set the status of the entry
//    the DETAIL SURFACE is showing. On the board you press E first (or Enter,
//    which Board already binds), and then the digits mean what the cheatsheet
//    says they mean. Two keys instead of one, and zero chance of a card both
//    changing column and changing status from a single press.
//
// ── WHAT THIS FILE MAY TOUCH ───────────────────────────────────────────────
//
// Two DOM contracts, both READ and never styled (cmd.css owns `.cmd-*` and
// nothing else):
//
//   `[data-entry-id]`      — Board's per-card wrapper. The only place in the app
//                            where an entry id is legible from the DOM.
//   `button.entry-title`   — the focusable control that OPENS an entry, on every
//                            list surface. EntryRow and EntryCard both render it
//                            (`.entry-title` is global.css's typography
//                            primitive, per the §1.0.7 carve-out), so J/K and E
//                            work on follow-ups, the board, the timeline and the
//                            dashboard without any of those files knowing this
//                            layer exists.
//   `.upd-compose-input`   — the update composer, for U. Preferred over "the
//                            first textarea in the surface" because the
//                            description's inline editor is also a textarea and
//                            sits above it.
//
// Activating the opener rather than calling openEntry() ourselves is deliberate:
// each surface passes its OWN sibling list to openEntry (store/entrySheet.ts's
// header explains why a board column's order is not the store's order), so
// clicking their button preserves a walk this module has no way to reconstruct.
//
// This module imports nothing from store/ or api/ — the §1.0 lib rule. The
// handlers are injected by the component that mounts the layer.

import type { EntryStatus } from '../types'
import { overlayDepth } from './overlayStack'
import { foldKey, isSubsequence, normalizeSearch, stemArabic } from './text'

/* ────────────────────────────── the intents ────────────────────────────── */

export type HotkeyId =
  | 'capture'
  | 'search'
  | 'palette'
  | 'help'
  | 'next'
  | 'prev'
  | 'edit'
  | 'addUpdate'
  | 'status'

export interface HotkeyHit {
  id: HotkeyId
  /** `status` only — which status the digit named. */
  status?: EntryStatus
}

/**
 * Digit → status, in the order the spec lists them (`1-4`).
 *
 * Four of the six, and these four: `waiting_on` and `cancelled` are the two a
 * person reaches for from a menu after thinking about it, while these are the
 * ones a triage pass cycles through. The cheatsheet renders the current
 * vocabulary LABEL for each — an admin can rename `blocked`, and a printed
 * "Blocked" in a locale file would then be wrong (0003 renames labels, never
 * keys, which is what makes the mapping here safe to hardcode).
 */
export const STATUS_DIGITS: readonly EntryStatus[] = ['new', 'in_progress', 'blocked', 'done']

/**
 * '1'–'4' → the status it names, or null. Mirrors lib/dnd.ts's indexFromDigit.
 *
 * Takes the TOKEN, not `event.key`: on the macOS Arabic layout the digit row
 * emits Arabic-Indic `١٢٣٤`, which fails this ASCII range check outright.
 * token() has already resolved those back to Latin digits via `event.code`.
 */
function statusForDigit(key: string): EntryStatus | null {
  if (key.length !== 1 || key < '1' || key > '9') return null
  return STATUS_DIGITS[key.charCodeAt(0) - '1'.charCodeAt(0)] ?? null
}

/* ─────────────────────────────── resolution ────────────────────────────── */

/**
 * Everything resolveHotkey() is allowed to know. A plain record, so the whole
 * decision table is drivable from a node test with no DOM and no React.
 */
export interface KeyProbe {
  key: string
  /**
   * `KeyboardEvent.code` — the PHYSICAL key, independent of the layout.
   *
   * The layer's fallback for a non-Latin layout, and only for that. See token().
   * '' is a legal value: synthetic events and a few input paths report no code,
   * and the fallback is skipped rather than guessed at.
   */
  code: string
  ctrlKey: boolean
  metaKey: boolean
  altKey: boolean
  shiftKey: boolean
  /** A held key auto-repeats. One press must mean one action. */
  repeat: boolean
  /** Somebody below already handled this key — see rule 1. */
  defaultPrevented: boolean
  /** The keystroke landed in a field, a select, or a contenteditable. */
  typing: boolean
  /** lib/overlayStack.overlayDepth() at the moment of the press. */
  overlayDepth: number
  /** The entry the detail surface is showing, or null. */
  openEntryId: string | null
  /** Does the keyboard sit on an entry in a LIST (a card or a title button)? */
  onListEntry: boolean
  /**
   * Are there any entries on screen at all?
   *
   * The distinction J/K need and E/U must not have. Stepping a list is
   * meaningful before anything in it is focused — "J from the top of the page"
   * has to reach the first row, or the walk can only ever be STARTED with the
   * mouse or a Tab, which is the opposite of what a keyboard layer is for. E and
   * U are the other case: with nothing highlighted, "edit" has no subject, and
   * silently picking the first row is a write aimed at whatever happens to sort
   * first. Found in the browser pass — `stepFocusedEntry()` had handled the
   * from-nowhere case all along and `resolveHotkey` never let it be reached.
   */
  hasListEntries: boolean
}

/**
 * The two intents that may fire with a modal already up.
 *
 * Both stack correctly — each pushes its own overlay and Escape unwinds them in
 * order — and both are things a person legitimately wants while reading an
 * entry: jump somewhere else, or check what a key does. Everything else stands
 * down, because navigating or focusing a field BEHIND a scrim is never what the
 * press meant.
 */
const MODAL_SAFE: ReadonlySet<HotkeyId> = new Set<HotkeyId>(['palette', 'help'])

/**
 * The physical keys the layer binds → the token each one stands for.
 *
 * `Slash` is absent because it is the one entry that depends on Shift: the same
 * physical key is `/` and `?`, and which one was meant is `shiftKey`, not the
 * character the layout printed. token() handles it directly.
 */
const CODE_TOKENS: Readonly<Record<string, string>> = {
  KeyC: 'c',
  KeyJ: 'j',
  KeyK: 'k',
  KeyE: 'e',
  KeyU: 'u',
  Digit1: '1',
  Digit2: '2',
  Digit3: '3',
  Digit4: '4',
}

/**
 * The key, as a comparable token.
 *
 * Single characters are lowercased so Caps Lock does not silently disable the
 * whole layer; the cost is that Shift+C is Capture too, which is the trade every
 * app with letter shortcuts makes.
 *
 * ── WHY `event.code` IS CONSULTED, AND WHY ONLY SOMETIMES ───────────────────
 *
 * `event.key` is the character the LAYOUT produced. On the Arabic layout this
 * app half exists for, the seven keys the spec binds emit ؤ ظ ؟ ت ن ث ع, the
 * digit row emits ١٢٣٤ on macOS, and every case below misses. The whole desktop
 * keyboard layer was therefore dead for an Arabic-layout user — including `?`,
 * the one key that would have told them the others existed. `event.code` names
 * the PHYSICAL key and is immune to all of it.
 *
 * The fallback is deliberately NOT unconditional, because `code` is the wrong
 * answer on plenty of Latin layouts: French AZERTY puts `&` on the physical
 * `Digit1` and `é` on `Digit2`, so a code-first layer would set a status from a
 * key that prints an ampersand. THE TEST IS THE SCRIPT, not ASCII — `é` is as
 * Latin as `e` is, and a layout printing it is a layout whose own answer stands.
 * Only a key that prints a character outside the Latin script at all — Arabic,
 * Cyrillic, Greek, Arabic-Indic digits — is a layout that cannot possibly have
 * meant a binding literally, and only there does `code` decide.
 *
 * On every Latin layout this function is therefore byte-identical to the
 * `key.toLowerCase()` it replaced.
 *
 * Multi-character keys ('Escape', 'ArrowDown', 'Process' during IME
 * composition) pass through untouched and match nothing, which is what they did
 * before.
 */
const LATIN_KEY = /[\p{ASCII}\p{Script=Latin}]/u

function token(key: string, code: string, shiftKey: boolean): string {
  if (key.length !== 1) return key
  const lower = key.toLowerCase()
  // A Latin layout has already given the right answer. Do not second-guess it.
  if (LATIN_KEY.test(key)) return lower
  if (code === 'Slash') return shiftKey ? '?' : '/'
  return CODE_TOKENS[code] ?? lower
}

/**
 * What this keystroke means, or null for "not ours".
 *
 * PURE. No DOM, no stores, no `document`. Every early return below is a case
 * where somebody else has a better claim on the key than we do.
 */
export function resolveHotkey(p: KeyProbe): HotkeyHit | null {
  // Rule 1. A component under us acted.
  if (p.defaultPrevented) return null
  // Auto-repeat from a held key: sixty status writes from one lean on the
  // keyboard is the kind of thing that gets a shortcut layer removed.
  if (p.repeat) return null
  // Alt is the OS's and the IME's. Never ours.
  if (p.altKey) return null

  const k = token(p.key, p.code, p.shiftKey)

  // Rule 2's exception, and the only chord in the layer. Shift+Cmd+K is a
  // different chord and belongs to whoever wants it later.
  if (p.metaKey || p.ctrlKey) {
    return k === 'k' && !p.shiftKey ? { id: 'palette' } : null
  }

  // Rule 2. Everything from here down is a bare key.
  if (p.typing) return null

  const hit = bareKey(k, p)
  if (hit === null) return null
  if (MODAL_SAFE.has(hit.id)) return hit
  return allowedAtDepth(hit, p) ? hit : null
}

function bareKey(k: string, p: KeyProbe): HotkeyHit | null {
  switch (k) {
    case 'c':
      return { id: 'capture' }
    case '/':
      return { id: 'search' }
    case '?':
      return { id: 'help' }
    default:
      break
  }

  // J/K walk a list, so they only need a list. See KeyProbe.hasListEntries.
  if (k === 'j' || k === 'k') {
    if (p.openEntryId === null && !p.onListEntry && !p.hasListEntries) return null
    return { id: k === 'j' ? 'next' : 'prev' }
  }

  // Everything below acts on ONE entry, so there has to be one.
  if (p.openEntryId === null && !p.onListEntry) return null

  switch (k) {
    case 'e':
      return { id: 'edit' }
    case 'u':
      return { id: 'addUpdate' }
    default:
      break
  }

  // Rule 4. Not "the focused card" — the OPEN entry.
  if (p.openEntryId === null) return null
  const status = statusForDigit(k)
  return status === null ? null : { id: 'status', status }
}

/**
 * How many overlays this intent tolerates above it.
 *
 * Zero for the chrome keys: `c` navigates and `/` focuses a field, and doing
 * either behind a scrim moves the page the user cannot see. One for the
 * entry-scoped keys, because when the detail surface is open it IS that one
 * overlay (components/sheet/Sheet.tsx pushes exactly one). A second layer means
 * a confirm or a picker is stacked on top of the entry and owns the keyboard.
 *
 * `/entry/:id` is a page rather than an overlay, so the depth is 0 there and
 * `openEntryId` is still set — which is why the budget is derived from whether
 * the surface is open rather than assumed.
 */
function allowedAtDepth(hit: HotkeyHit, p: KeyProbe): boolean {
  if (hit.id === 'capture' || hit.id === 'search') return p.overlayDepth === 0
  return p.overlayDepth <= (p.openEntryId === null ? 0 : 1)
}

/* ─────────────────────────── the typing test ───────────────────────────── */

/**
 * The shape isTypingTarget() needs. Structural rather than `HTMLElement` so the
 * test can hand it a three-property object — vitest.config.ts is
 * `environment: 'node'` and there is no jsdom in the dependency budget.
 */
export interface TypingTargetLike {
  tagName: string
  isContentEditable: boolean
  getAttribute: (name: string) => string | null
}

/**
 * ARIA roles that make a non-input element a text field. A composer built out
 * of a contenteditable div usually carries one, and `isContentEditable` is
 * false on a div whose ancestor holds the attribute in some engines.
 */
const TEXT_ROLES: ReadonlySet<string> = new Set(['textbox', 'searchbox', 'combobox', 'spinbutton'])

/**
 * Is a keystroke on this element text rather than a command?
 *
 * pages/Board.tsx:419 has the same test for its own delegated handler, minus
 * the roles. Not shared with it — Board is another worker's file and the §1.0.4
 * extension slot says a gap goes to the integrator, not into someone else's
 * module. Duplicating four lines is the cheaper of the two mistakes; the note
 * in the handoff asks for the promotion.
 */
export function isTypingTarget(el: TypingTargetLike | null): boolean {
  if (el === null) return false
  const tag = el.tagName.toUpperCase()
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true
  if (el.isContentEditable) return true
  const role = el.getAttribute('role')
  return role !== null && TEXT_ROLES.has(role)
}

/* ────────────────────────────── the DOM half ───────────────────────────── */

/** Board's per-card wrapper — the only DOM-legible entry id in the app. */
const ENTRY_HOST = '[data-entry-id]'

/** The focusable control that opens an entry. EntryRow and EntryCard both render it. */
const ENTRY_OPENER = 'button.entry-title'

/** Either DOM signal that says "the keyboard is on an entry". */
const ENTRY_ANCHOR = `${ENTRY_HOST}, ${ENTRY_OPENER}`

function activeElement(): HTMLElement | null {
  if (typeof document === 'undefined') return null
  const el = document.activeElement
  return el instanceof HTMLElement ? el : null
}

/** Is this element rendered? `display: none` subtrees are not navigable. */
function visible(el: HTMLElement): boolean {
  return el.offsetParent !== null || el === activeElement()
}

/** The entry anchor the keyboard is inside, or null. */
function focusedEntryAnchor(): HTMLElement | null {
  return activeElement()?.closest<HTMLElement>(ENTRY_ANCHOR) ?? null
}

/** Every entry opener on screen, in document order. */
function openers(): HTMLElement[] {
  if (typeof document === 'undefined') return []
  return [...document.querySelectorAll<HTMLElement>(ENTRY_OPENER)].filter(visible)
}

/**
 * Is there at least one entry on screen? The cheap form of openers().length > 0.
 *
 * querySelector, not querySelectorAll: this runs on the keydown path and stops
 * at the first match, where the full list would walk a sixty-card board to
 * answer a yes/no question.
 */
function hasEntryOpener(): boolean {
  if (typeof document === 'undefined') return false
  const first = document.querySelector<HTMLElement>(ENTRY_OPENER)
  return first !== null && visible(first)
}

/**
 * J / K when no detail surface is open: walk the entries this screen is
 * showing.
 *
 * Document order, which on the board reads down a column and then into the next
 * one — the same order Tab already takes, so the two navigations agree. CLAMPED,
 * not wrapped, for lib/dnd.ts's moveIndex() reason: a list is a position
 * somebody is reading through, and jumping from the last row back to the first
 * reads as a bug.
 *
 * Returns false when there was nothing to move to, so the caller can leave the
 * key unclaimed.
 */
export function stepFocusedEntry(dir: 1 | -1): boolean {
  const items = openers()
  if (items.length === 0) return false
  const anchor = focusedEntryAnchor()
  const from = anchor === null ? -1 : items.findIndex((el) => el === anchor || anchor.contains(el))
  // Nothing focused yet: J starts at the top and K at the bottom.
  const to = from < 0 ? (dir === 1 ? 0 : items.length - 1) : from + dir
  const next = items[to < 0 ? 0 : to > items.length - 1 ? items.length - 1 : to]
  if (next === undefined || next === items[from]) return false
  next.focus()
  next.scrollIntoView({ block: 'nearest' })
  return true
}

/**
 * E / U with nothing open: activate the entry the keyboard is on.
 *
 * A synthetic click on the surface's OWN opener, never openEntry() from here —
 * see the file header. Board's cards are `tabIndex={-1}` wrappers whose opener
 * is nested inside, hence the descendant lookup.
 */
export function openFocusedEntry(): boolean {
  const anchor = focusedEntryAnchor()
  if (anchor === null) return false
  const opener = anchor.matches(ENTRY_OPENER)
    ? anchor
    : anchor.querySelector<HTMLElement>(ENTRY_OPENER)
  if (opener === null) return false
  opener.click()
  return true
}

/**
 * The element the detail surface is currently rendered into.
 *
 * Two shapes, because the app has two: an overlay (`role="dialog"`, portalled
 * to <body> by components/sheet/Sheet.tsx) and the `/entry/:id` page, which is
 * just the route's `<main id="main">`. The dialog is looked for first — on the
 * page route a dialog can still be up, and it is then the thing on top.
 */
function entrySurface(): HTMLElement | null {
  if (typeof document === 'undefined') return null
  const dialogs = [...document.querySelectorAll<HTMLElement>('[role="dialog"]')].filter(visible)
  return dialogs[dialogs.length - 1] ?? document.getElementById('main')
}

/**
 * Anything a keyboard can land on. Mirrors the list Sheet.tsx traps Tab
 * against; kept local rather than imported because that constant is not
 * exported and this file may not add an export to another worker's module.
 */
const FOCUSABLE =
  'a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])'

/**
 * E with the surface open: put the keyboard on its first control.
 *
 * Which is the title's inline-edit trigger — Sheet.tsx's own focus effect says
 * so, and says why it does NOT auto-focus it on open (a screen reader would
 * announce "edit title" before naming the entry). Pressing E is the user asking
 * for exactly that, so this is the deliberate version of the move that effect
 * declines to make.
 */
export function focusSurfaceStart(): boolean {
  const root = entrySurface()
  const first = root?.querySelector<HTMLElement>(FOCUSABLE) ?? null
  if (first === null) return false
  first.focus()
  return true
}

/**
 * U with the surface open: put the keyboard in the update composer.
 *
 * TWO QUERIES, IN PRIORITY ORDER, because a comma-separated selector does not
 * express a preference — `querySelector('a, b')` returns whichever matches first
 * in DOCUMENT order, not the first selector's match.
 *
 * `.upd-compose-input` is the composer exactly (entry.css owns the `.upd-*`
 * prefix; this reads it and never styles it). The structural fallback exists
 * because the class is another worker's and could be renamed — but it is second,
 * not first, since the surface can contain a SECOND textarea: an InlineText in
 * multiline edit mode renders one for the description, and it sits above the
 * thread in document order.
 */
export function focusUpdateComposer(): boolean {
  const root = entrySurface()
  const box =
    root?.querySelector<HTMLTextAreaElement>('.upd-compose-input') ??
    root?.querySelector<HTMLTextAreaElement>('textarea:not(:disabled)') ??
    null
  if (box === null) return false
  box.focus()
  box.scrollIntoView({ block: 'nearest' })
  return true
}

/**
 * `/` — the screen's own search box, if it has one.
 *
 * components/FilterBar.tsx renders `input.flt-search[type=search]` on every
 * list screen that filters. Matched on the TYPE, not the class: the type is the
 * semantic and the class belongs to filters.css. Returns false when the screen
 * has no search field, which is the caller's cue to open the palette instead —
 * "/" should never be a key that does nothing.
 */
export function focusSearchField(): boolean {
  if (typeof document === 'undefined') return false
  const field = [...document.querySelectorAll<HTMLInputElement>('input[type="search"]')].find(
    (el) => visible(el) && !el.disabled,
  )
  if (field === undefined) return false
  field.focus()
  field.select()
  return true
}

/* ─────────────────────────────── the listener ──────────────────────────── */

export interface HotkeyHandlers {
  /** Read fresh on every keystroke — the layer asks its store here. */
  openEntryId: () => string | null
  run: (hit: HotkeyHit) => void
}

/**
 * A real KeyboardEvent → the record resolveHotkey() decides on.
 *
 * The two DOM walks are SKIPPED for a keystroke that cannot possibly need them —
 * one inside a text field, or one carrying a modifier. That covers the hot path
 * by a wide margin: this listener sees every character typed into the capture
 * box, and neither `onListEntry` nor `hasListEntries` can change the answer for
 * any of them (rule 2 bails before either is read, and the one chord in the layer
 * is entry-independent). resolveHotkey() stays a total function over the record;
 * this is the only place that knows some of it is sometimes unnecessary.
 */
function probe(event: KeyboardEvent, openEntryId: string | null): KeyProbe {
  const target = event.target
  const typing = isTypingTarget(target instanceof HTMLElement ? target : null)
  const skipDom = typing || event.metaKey || event.ctrlKey || event.altKey
  return {
    key: event.key,
    code: event.code,
    ctrlKey: event.ctrlKey,
    metaKey: event.metaKey,
    altKey: event.altKey,
    shiftKey: event.shiftKey,
    repeat: event.repeat,
    defaultPrevented: event.defaultPrevented,
    typing,
    overlayDepth: overlayDepth(),
    openEntryId,
    onListEntry: skipDom ? false : focusedEntryAnchor() !== null,
    hasListEntries: skipDom ? false : hasEntryOpener(),
  }
}

/**
 * Bind the layer. Returns its own removal, so an effect can return it directly.
 *
 * Unlike lib/overlayStack.ts this DOES unbind: that module's listener is inert
 * while its stack is empty, whereas this one closes over handlers that hold a
 * navigate() from one particular render of the router.
 *
 * preventDefault() on every hit, because the browser has its own plans for
 * several of these: Firefox's quick-find opens on `/`, and Cmd+K focuses the
 * omnibox in Chrome. NOT stopPropagation — nothing below has a claim left by
 * the time a key reaches here, and marking the event handled is enough.
 */
export function installHotkeys(h: HotkeyHandlers): () => void {
  if (typeof document === 'undefined') return () => {}
  const onKeyDown = (event: KeyboardEvent): void => {
    const hit = resolveHotkey(probe(event, h.openEntryId()))
    if (hit === null) return
    event.preventDefault()
    h.run(hit)
  }
  document.addEventListener('keydown', onKeyDown)
  return () => {
    document.removeEventListener('keydown', onKeyDown)
  }
}

/* ───────────────────────────── the cheatsheet ──────────────────────────── */

/**
 * Escape is documented here and resolved nowhere in this file: lib/overlayStack
 * owns it, for every overlay in the app at once. It still has to appear in the
 * cheatsheet — a shortcut list that omits the way out is the list people need
 * most.
 */
export type ShortcutId = HotkeyId | 'escape'

export interface ShortcutDoc {
  id: ShortcutId
  /**
   * The keys as printed, one chip each. `mod` is substituted with ⌘ or Ctrl at
   * render time; everything else is literal.
   *
   * The status row spells all four digits out rather than printing a `1–4`
   * range, so the cheatsheet can put each digit next to the status LABEL it
   * sets. A range would have needed a second rendering mode for one row.
   */
  keys: readonly string[]
  /** `global` works anywhere; `entry` needs the detail surface open. */
  group: 'global' | 'entry'
  /** cmd.json path for the one-line description. */
  labelKey: string
}

/**
 * The single source of truth for what the layer does.
 *
 * hotkeys.test.ts drives resolveHotkey() with one probe per row and asserts the
 * two sets match in BOTH directions, so a binding with no cheatsheet row and a
 * cheatsheet row with no binding are each a failing test rather than a support
 * question. Acceptance gate (d) — "every spec shortcut works, and is listed in
 * the cheatsheet" — is that assertion.
 */
export const SHORTCUTS: readonly ShortcutDoc[] = [
  { id: 'capture', keys: ['C'], group: 'global', labelKey: 'cmd.keyCapture' },
  { id: 'palette', keys: ['mod', 'K'], group: 'global', labelKey: 'cmd.keyPalette' },
  { id: 'search', keys: ['/'], group: 'global', labelKey: 'cmd.keySearch' },
  { id: 'help', keys: ['?'], group: 'global', labelKey: 'cmd.keyHelp' },
  { id: 'escape', keys: ['Esc'], group: 'global', labelKey: 'cmd.keyEscape' },
  { id: 'next', keys: ['J'], group: 'entry', labelKey: 'cmd.keyNext' },
  { id: 'prev', keys: ['K'], group: 'entry', labelKey: 'cmd.keyPrev' },
  { id: 'edit', keys: ['E'], group: 'entry', labelKey: 'cmd.keyEdit' },
  { id: 'addUpdate', keys: ['U'], group: 'entry', labelKey: 'cmd.keyUpdate' },
  { id: 'status', keys: ['1', '2', '3', '4'], group: 'entry', labelKey: 'cmd.keyStatus' },
]

/**
 * ⌘ or Ctrl.
 *
 * `navigator.platform` is deprecated and `userAgentData` is Chromium-only, so
 * both are read and either answer is accepted. Getting this wrong prints the
 * wrong glyph in a help sheet; it does not change what the chord does, which is
 * why a UA sniff is acceptable here and nowhere else in the app.
 */
export function modLabel(): string {
  if (typeof navigator === 'undefined') return 'Ctrl'
  const ua = `${navigator.userAgent} ${navigator.platform ?? ''}`
  return /Mac|iPhone|iPad|iPod/i.test(ua) ? '⌘' : 'Ctrl'
}

/* ──────────────────────────────── the matcher ──────────────────────────── */
//
// The palette searches four kinds of thing at once — entries, tracks, screens,
// actions — and the ONLY reason it can rank them against each other is that
// every candidate is reduced to the same thing first: a list of folded strings.
// lib/text.ts does the folding, so `الشبكات` matches `#الشبكة` here for the same
// reason it does in the capture parser: THE QUERY carries both its surface fold
// and its stem, and the haystack keeps its surface form. See searchNeedles() and
// foldField() for why the stem may never move to the haystack side.

/** Exact hit. `network` → `network`. */
export const TIER_EXACT = 0
/** The candidate starts with the query. `net` → `network ops`. */
export const TIER_PREFIX = 1
/** A WORD of the candidate starts with it. `ops` → `network ops`. */
export const TIER_WORD = 2
/** It appears somewhere inside. `etwo` → `network ops`. */
export const TIER_SUBSTRING = 3
/** Its letters appear in order. `nops` → `network ops`. */
export const TIER_SUBSEQUENCE = 4

/**
 * Score = field × 10000 + tier × 1000 + position, lower first.
 *
 * An ordinal packed into one number rather than a comparator returning a tuple,
 * because the caller sorts thousands of rows on every keystroke and a numeric
 * compare is the cheap version. The steps are wide enough that no position can
 * ever out-rank a tier and no tier can out-rank a field: a label match at the
 * worst tier and the worst position (4999) still beats a keyword match at the
 * best (10000).
 */
const TIER_STEP = 1_000
const FIELD_STEP = 10_000
const MAX_POSITION = TIER_STEP - 1

export interface TextMatch {
  tier: number
  /** Where the match starts, for ranking `ops` above `network ops` on ties. */
  at: number
}

/**
 * Does `needle` match `hay`, and how well?
 *
 * BOTH ARGUMENTS MUST ALREADY BE FOLDED — lib/text.isSubsequence's contract, for
 * its reason: the caller folds one query against a whole list, and folding
 * inside the loop is the thing that makes a palette feel slow on a big
 * workspace. searchNeedles() and foldField() below are the two folds to use.
 *
 * An empty needle matches everything at rank zero, so an untouched palette
 * shows its rows in the order the caller assembled them.
 */
export function matchText(needle: string, hay: string): TextMatch | null {
  if (needle === '') return { tier: TIER_EXACT, at: 0 }
  if (hay === '') return null
  if (hay === needle) return { tier: TIER_EXACT, at: 0 }
  if (hay.startsWith(needle)) return { tier: TIER_PREFIX, at: 0 }
  const at = hay.indexOf(needle)
  // Word boundary: normalizeSearch() collapses whitespace to single spaces and
  // keeps them precisely so this test is possible. foldKey() would have glued
  // the words together and lost it.
  if (at > 0) return { tier: hay[at - 1] === ' ' ? TIER_WORD : TIER_SUBSTRING, at }
  if (!isSubsequence(needle, hay)) return null
  // The first letter's position is a good-enough proxy for where a scattered
  // match "is". Computing the real span costs a second pass to break ties
  // nobody can see.
  return { tier: TIER_SUBSEQUENCE, at: Math.max(hay.indexOf(needle[0] ?? ''), 0) }
}

/**
 * The best score any needle scores against any field, or null for no match.
 *
 * Several needles because one query has more than one legitimate folding (see
 * searchNeedles); several fields because a row is matched on its label first
 * and its keywords second, and the field's INDEX is its weight.
 */
export function matchScore(
  needles: readonly string[],
  fields: readonly string[],
): number | null {
  let best: number | null = null
  for (let f = 0; f < fields.length; f++) {
    const hay = fields[f] ?? ''
    for (const needle of needles) {
      const m = matchText(needle, hay)
      if (m === null) continue
      const score = f * FIELD_STEP + m.tier * TIER_STEP + Math.min(m.at, MAX_POSITION)
      if (best === null || score < best) best = score
    }
  }
  return best
}

/**
 * lib/text.stemArabic(), applied PER WORD.
 *
 * stemArabic strips one trailing suffix from a whole string, which is right for
 * a single `#track` token and wrong for a title. Splitting first is what makes
 * the stem usable on prose — and the split is on the single spaces
 * normalizeSearch() has already collapsed everything down to.
 *
 * IT IS A NO-OP ON LATIN TEXT, and that is load-bearing rather than incidental:
 * every suffix in STEM_SUFFIXES is Arabic (`ات ين ون ه`), so folding an English
 * query through this changes nothing at all. Which is why searchNeedles() can
 * stem unconditionally instead of guessing at a script — the extra needle it
 * produces for `network` is `network`, and the dedupe drops it.
 */
function stemFolded(folded: string): string {
  return folded.split(' ').map(stemArabic).join(' ')
}

/**
 * The foldings of one query, best first.
 *
 * UP TO FOUR, from two independent doublings.
 *
 * The first is the pair lib/text.ts already ships for the capture parser:
 * `#it-ops` and `#itops` are one intent and the two folds disagree about it —
 * normalizeSearch keeps the hyphen (so word boundaries survive for prose) and
 * foldKey drops it (so identifiers match).
 *
 * The second is the STEM, and it lives HERE — on the query — rather than on the
 * haystack, which is the whole of what makes prefix-as-you-type survive an
 * Arabic plural. stemArabic is destructive: it truncates, it never expands. So a
 * needle derived from a stem is always a prefix/substring/subsequence of the
 * unstemmed surface form it came from, and adding it can only ever ADD matches.
 * Stemming the haystack instead deletes those final letters from the only copy
 * there is, and a query that has typed them has nowhere left to match — see
 * foldField().
 *
 * Empty for a blank query — rankQuery() reads that as "no filter".
 */
export function searchNeedles(query: string): string[] {
  const out: string[] = []
  const push = (needle: string): void => {
    if (needle !== '' && !out.includes(needle)) out.push(needle)
  }
  for (const folded of [normalizeSearch(query), foldKey(query)]) {
    push(folded)
    push(stemFolded(folded))
  }
  return out
}

/**
 * The fold every haystack goes through. Named so no call site has to choose.
 *
 * NOT STEMMED, and that is the correction Wave 4b's audit made to this file.
 *
 * The problem EXECUTION-PLAN §680 records is real: migration 0001 seeds the
 * Network track under its Arabic PLURAL (`الشبكات`) and people type the singular
 * (`الشبكة`). Under the `ة→ه` fold those two share no match tier at all — not
 * exact, not prefix in either direction, and not even subsequence, because the
 * singular's final haa does not appear in the plural. A stem is what closes it.
 *
 * But the parser puts that stem on ONE SIDE ONLY (parse.ts's matchTrackTiers
 * keeps the raw `forms` and asks `f.startsWith(needle) || stemArabic(f) === stem`
 * — the surface form is still there to be prefix-matched), and this file used to
 * put it on BOTH. With `الشبكات` folded down to `الشبك` on the haystack side, the
 * letters `ا` and `ت` existed nowhere in the index, so the palette dropped the
 * row on the second-to-last keystroke of the track's own name and brought it
 * back on the last:
 *
 *     الشبك   → exact        الشبكا  → NO MATCH        الشبكات → exact
 *
 * A search box that blinks out mid-word is worse than one that never matched,
 * because the user reads it as "not there" and stops typing. So the haystack
 * keeps every letter it has and searchNeedles() carries the stem instead.
 *
 * The cost the parser accepts is still accepted here: two Arabic names differing
 * only by a plural suffix collide, via the stemmed needle. For a search box that
 * ranks rather than resolves, a collision shows both rows. What changes is that
 * the plural now ranks one tier lower than exact for a singular query (PREFIX,
 * not EXACT) — the correct ordering, since a row whose name IS the query should
 * outrank one that merely stems to it.
 *
 * IT IS BYTE-IDENTICAL TO THE OLD FOLD FOR LATIN TEXT: every suffix in
 * STEM_SUFFIXES is Arabic, so stemFolded() was a no-op on an English title and
 * removing it changes no English score anywhere.
 */
export function foldField(value: string): string {
  return normalizeSearch(value)
}

export interface RankRow<T> {
  item: T
  /** Folded with foldField(), most significant first. */
  fields: readonly string[]
}

/**
 * Filter and order one group of palette rows.
 *
 * Ties break on the caller's own order — for entries that is `last_activity_at`
 * descending, so an empty or weakly-discriminating query surfaces what somebody
 * touched this morning rather than an alphabetical accident.
 */
export function rankQuery<T>(
  needles: readonly string[],
  rows: readonly RankRow<T>[],
  limit: number,
): T[] {
  if (limit <= 0) return []
  if (needles.length === 0) return rows.slice(0, limit).map((r) => r.item)
  const scored: { item: T; score: number; at: number }[] = []
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]
    if (row === undefined) continue
    const score = matchScore(needles, row.fields)
    if (score !== null) scored.push({ item: row.item, score, at: i })
  }
  scored.sort((a, b) => a.score - b.score || a.at - b.at)
  return scored.slice(0, limit).map((s) => s.item)
}
