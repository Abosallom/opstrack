// The brand gate.
//
// WHAT WENT WRONG WITHOUT IT. The OpsTrack → CoreTrack rename shipped in two
// halves. The first commit did `app.name`, `index.html` and the PWA manifest and
// stopped there, so the sign-in screen rendered its own brand row from
// `t('app.name')` as **CoreTrack** and its `<h2>` from `signin.heading` as
// **"Sign in to OpsTrack"** — two different product names, eight pixels apart, on
// the first screen anyone sees. Eleven more strings were stranded the same way
// across `push`, `digest` and `sso`, in both languages. (`sso` no longer exists:
// WAVE5-NOTES §2 cancelled the Microsoft Entra path in the same wave, and its four
// stranded strings left with the namespace rather than being fixed twice. The
// other seven are why the two `it.each(FORBIDDEN)` cases below are worth having.)
//
// Nothing reported it. localeParity compares the two trees to each other and both
// were wrong identically; localeReach compares keys to call sites and every key
// was reached; bidi.test.ts reads direction, not words. A rename is invisible to
// every gate that inspects STRUCTURE, because a half-renamed tree is structurally
// perfect. Only a check that reads the VALUES can see it, which is this file.
//
// WHY IT IS PERMANENT rather than a one-off script. It has now caught the SECOND
// rename as well. docs/WAVE5-NOTES.md §1 deferred the launch name (NphiesCore) to
// a later cut; that cut has landed for everything a person READS — `app.name`,
// `index.html`, the PWA manifest, the sign-in heading, the push and digest
// strings, and the download filenames below. What it deliberately did NOT move is
// the identifier half of §1's list: the Pages base path (it moves with a Supabase
// redirect-allow-list step, so moving it here breaks sign-in), the `opstrack_*`
// storage keys, the `opstrack-live` channel, the CSS prefixes, the bundle id, the
// applied migrations, and the two format tags pinned at the bottom of this file.
// `@opstrack.internal` is not even deferred — it is PERMANENT: those are real
// rows in `auth.users`, and renaming the domain locks every member out of their
// own account.
//
// So the repo now holds two live spellings on purpose, which is exactly the state
// in which a well-meaning sweep does damage. This file is what makes the split
// legible: everything it asserts as NphiesCore is read by a person, and
// everything it asserts as an older slug is matched on by a parser.
//
// SCOPE: every string a user can read. That is the shipped locale trees, and —
// added after the v1.0.0 critic pass found them stranded — the names of the files
// the app puts in someone's Downloads folder. A filename is read by more people
// than most strings in the tree: it is what an export or a digest is called when
// it travels onward as an email attachment, long after it left the app. Both had
// kept the retired slug through the whole rename because the first sweep read
// locale bundles and nothing else, and because a template literal in a `.ts` file
// does not look like a user-visible string until you watch one land on a desktop.
//
// The old slugs survive on purpose in identifiers that are NOT strings a user
// reads — `opstrack_*` cache keys, the `opstrack-live` realtime channel, the
// export envelope's `format`, the terminology file's `format`, the `opstrack`
// notification tag, applied migrations. Those are deliberately out of scope; see
// §1 of the notes for why each one waits. The two `format` tags are pinned below
// rather than merely skipped, because each one is now spelled differently from
// the FILENAME of the very file it sits inside:
//
//   nphiescore-export-<stamp>.json       contains  "format": "opstrack-export"
//   nphiescore-terminology-<stamp>.json  contains  "format": "coretrack-terminology"
//
// That reads like a job someone left half-done, and it is not. A reader
// IDENTIFIES the file by matching the tag — `readLabels()` in lib/labelIO.ts
// refuses outright on a mismatch — so renaming a tag makes every file exported
// before that build unreadable by the app that wrote it, silently, with no
// migration to undo it. A filename is matched on by nobody and read by everybody,
// so it moves with the brand. Same-looking strings, opposite obligations.

import { describe, expect, it } from 'vitest'
import { AR_NAMESPACES, EN_NAMESPACES, type LocaleTree } from '../locales'
import { buildDigestModel, digestFilename, DIGEST_FORMATS, type DigestFormat } from './digest'
import { options, rows } from './digest/fixtures'
import { buildEnvelope, exportFilename } from './export'
import { LABEL_FILE_FORMAT, buildLabelFile, labelFileName } from './labelIO'
import { mindtreeFilename } from './mindtree/export'
import { isPluralNode } from './plural'

/** The name the product ships under today. */
const BRAND = 'NphiesCore'

/**
 * Names that must not appear in any user-visible string.
 *
 * Both are retired now — `OpsTrack` by the first rename, `CoreTrack` by the
 * launch cut that made `BRAND` above what it is. Neither is dropped from this
 * list once it stops being current: the failure this file exists to catch is a
 * rename that lands in one tree and not the other, and the only way to see that
 * is to keep asserting the absence of every name the product has ever had.
 *
 * Matched case-insensitively so a stylisation (`Coretrack`, `CORETRACK`, the
 * `coretrack` of a filename) cannot slip past. That is also why neither entry
 * can be relaxed into a word-boundary match.
 */
const FORBIDDEN: readonly string[] = ['OpsTrack', 'CoreTrack']

/**
 * The one context where a retired name is still CORRECT, and why it is stripped
 * rather than allow-listed by key.
 *
 * `username@opstrack.internal` is the synthetic email domain every
 * admin-provisioned account authenticates as (`store/auth.ts`). Those addresses
 * are real rows in `auth.users`: renaming the domain locks every member out of
 * their own account, so it is frozen forever regardless of what the product is
 * called — the same class of value as `format: 'opstrack-export'` below. The
 * privacy policy has to state it accurately, so the string legitimately appears
 * in a user-visible tree.
 *
 * Stripped as an EXACT literal rather than relaxed into a word boundary or an
 * exempted key, so that a stray "OpsTrack" elsewhere in the very same string is
 * still caught.
 */
const FROZEN_IDENTIFIERS: readonly string[] = ['opstrack.internal']

/** A string with the frozen identifiers removed, ready to search for a brand. */
function withoutFrozen(value: string): string {
  return FROZEN_IDENTIFIERS.reduce((s, id) => s.split(id).join(''), value.toLowerCase())
}

/** Every leaf string in a namespace, as `key → value`, plural forms included. */
function strings(tree: LocaleTree, prefix = '', out: [string, string][] = []): [string, string][] {
  for (const [k, v] of Object.entries(tree)) {
    const path = prefix ? `${prefix}.${k}` : k
    if (typeof v === 'string') out.push([path, v])
    else if (isPluralNode(v)) for (const [c, form] of Object.entries(v)) out.push([`${path}.${c}`, form])
    else strings(v, path, out)
  }
  return out
}

function flatten(namespaces: Readonly<Record<string, LocaleTree>>): [string, string][] {
  return Object.values(namespaces).flatMap((tree) => strings(tree))
}

const AR_STRINGS = flatten(AR_NAMESPACES)
const EN_STRINGS = flatten(EN_NAMESPACES)

const TREES = [
  ['ar', AR_STRINGS],
  ['en', EN_STRINGS],
] as const

/**
 * One key's value, or `undefined` if it does not resolve.
 *
 * Read out of the flattened list rather than off the imported bundle, because
 * `LocaleTree` is `string | LocaleTree` at every level and `en.app.name` does
 * not typecheck without a cast. A cast here would be a cast around the exact
 * thing this file is asserting.
 */
function valueAt(strings: readonly [string, string][], key: string): string | undefined {
  return strings.find(([k]) => k === key)?.[1]
}

describe.each(TREES)('%s locale tree', (_locale, STRINGS) => {
  it('reads a plausible number of strings', () => {
    // A flattener that silently returned nothing would make the assertions below
    // vacuously true — the failure mode that would let a half-renamed tree ship
    // behind a green gate, which is the exact thing this file exists to stop.
    expect(STRINGS.length).toBeGreaterThan(500)
  })

  it.each(FORBIDDEN)('never says %s', (name) => {
    const needle = name.toLowerCase()
    const found = STRINGS.filter(([, v]) => withoutFrozen(v).includes(needle)).map(
      ([k, v]) => `${k} :: ${v}`,
    )
    expect(found.sort()).toEqual([])
  })

  it('still spells the frozen login domain, so a brand sweep cannot quietly fix it', () => {
    // The mirror of the strip above. Without this, a future rename pass could
    // "tidy" `@opstrack.internal` out of the privacy policy, the brand gate
    // would go green, and the policy would then describe an authentication
    // scheme the app does not use — to an App Store reviewer, in writing.
    const names = STRINGS.filter(([, v]) => v.includes('opstrack.internal'))
    expect(names.length).toBeGreaterThan(0)
  })

  it(`says ${BRAND} wherever it names the product at all`, () => {
    // The mirror of the check above, and not redundant with it: a rename that
    // DELETED the product name instead of replacing it would pass "never says
    // OpsTrack" while leaving `signin.heading` as a bare "Sign in". At least the
    // sign-in heading, the push subtitle and the digest footer name the product,
    // and those three are the surfaces the split rename actually stranded.
    const named = STRINGS.filter(([, v]) => v.includes(BRAND)).map(([k]) => k)
    expect(named).toContain('signin.heading')
    expect(named).toContain('push.subtitle')
    expect(named).toContain('digest.footer')
  })
})

/* ────────────────────────── the files that leave ─────────────────────────── */

/** Lowercased brand, as it appears in a filename. Filenames are not Title Case. */
const SLUG = BRAND.toLowerCase()

/**
 * Every filename the app can hand to a download, built through the REAL path.
 *
 * The digest model comes out of `buildDigestModel` rather than a literal so this
 * cannot pass against a fixture that stopped resembling production, and it is
 * built in both locales because `digestFilename` takes the model — a future
 * "helpful" localisation of the filename would land here and nowhere else.
 */
function generatedFilenames(): string[] {
  const at = new Date(2026, 6, 30, 14, 32)
  const digests = (['en', 'ar'] as const).flatMap((locale) => {
    const model = buildDigestModel(rows(), options({ locale }))
    return DIGEST_FORMATS.map((f: DigestFormat) => digestFilename(model, f))
  })
  return [
    exportFilename('json', at),
    exportFilename('csv', at),
    // The Mindtree puts two more names in someone's Downloads folder, and the
    // whole argument of this file is that a filename is a user-visible string.
    mindtreeFilename('svg', at),
    mindtreeFilename('png', at),
    // The terminology export is the kind most likely to TRAVEL: a wording pass
    // is drafted offline and carried to another workspace. Here so the next
    // rename sweep cannot strand it the way it stranded the export and digest.
    labelFileName(at),
    ...digests,
  ]
}

describe('generated filenames', () => {
  it('produces one name per export kind and per digest format', () => {
    // Same guard as the string-count check above, for the same reason: an empty
    // list would make every assertion below vacuously true, and this list is
    // built by a helper rather than written down.
    // Two data exports, two map exports, one terminology export, and one per
    // digest format per locale.
    expect(generatedFilenames()).toHaveLength(5 + 2 * DIGEST_FORMATS.length)
  })

  it.each(FORBIDDEN)('never says %s', (name) => {
    const needle = name.toLowerCase()
    expect(generatedFilenames().filter((f) => f.toLowerCase().includes(needle))).toEqual([])
  })

  it('names every file for the product', () => {
    // The mirror, and not redundant: a rename that dropped the prefix instead of
    // replacing it would pass the check above and leave a Downloads folder full
    // of `-2026-07-30-1432.json`, which is worse than the wrong brand.
    for (const f of generatedFilenames()) expect(f.startsWith(`${SLUG}-`)).toBe(true)
  })

  it('carries no localised text, in either direction', () => {
    // A filename travels to people who do not read the language it was written
    // in, and an Arabic run inside a filename is mangled by half the tools that
    // will touch it. ASCII, digits and the three separators — nothing else.
    for (const f of generatedFilenames()) expect(f).toMatch(/^[a-z0-9._-]+$/)
  })
})

/* ───────────────────── the tags INSIDE those files ─────────────────────── */
//
// READ THIS BEFORE "FIXING" THE INCONSISTENCY BELOW. The filenames asserted
// above carry the live brand. The `format` tags asserted here carry retired
// ones, and the mismatch is deliberate in both files:
//
//   nphiescore-export-<stamp>.json       "format": "opstrack-export"
//   nphiescore-terminology-<stamp>.json  "format": "coretrack-terminology"
//
// WHY THE FILENAME MOVED. Nothing reads it but a person. It lands in a Downloads
// folder, it is echoed in a "Saved as …" toast, and it travels onward as an email
// attachment — so it is a user-visible string in the sense this whole file is
// about, and it moves with every rename.
//
// WHY THE TAG DID NOT. It is a handshake with files that ALREADY EXIST. A reader
// identifies the document by matching this exact value — lib/labelIO.ts's
// `readLabels()` returns `undefined` and the import is refused with
// `errImportShape` on any other spelling — so renaming a tag makes every export
// and every wording pass taken before that build unreadable by the app that
// wrote it. Silently: nothing in the UI can say "this is the same format under
// its old name", because by then nothing knows the old name. A tag moves only
// behind a reader that accepts both spellings, which is a migration, not a
// rename.
//
// These two assertions are therefore the OPPOSITE of the `FORBIDDEN` sweeps
// above, and must never be folded into them. Their whole job is to fail the
// well-meaning commit that makes the four strings agree.

describe('the format tags inside those files', () => {
  it('the export envelope stays opstrack-export — a magic value, not a brand', () => {
    // Built through the real envelope path rather than read off a constant, so a
    // literal moved into a helper is still covered.
    const env = buildEnvelope(
      { tables: {}, truncated: [], rows: 0 },
      { exportedAt: '2026-07-30T11:32:00.000Z', locale: 'en', appVersion: '1.0.1' },
    )
    expect(env.format).toBe('opstrack-export')
  })

  it('the terminology file stays coretrack-terminology, one brand behind', () => {
    // The likelier casualty of the two, because its slug is only ONE rename old
    // and therefore still looks current at a glance. Asserted both as the
    // exported constant and as what a written file actually carries — the
    // envelope is what a reader in another workspace matches on, and a constant
    // that stopped being used would pass the first check alone.
    expect(LABEL_FILE_FORMAT).toBe('coretrack-terminology')
    const file = buildLabelFile([{ key: 'nav.map', en: 'Wall', ar: null }], {
      exportedAt: '2026-07-31T18:22:04.123Z',
      appVersion: '1.0.1',
    })
    expect(file.format).toBe('coretrack-terminology')
  })

  it('neither tag tracks the brand its own filename carries', () => {
    // The inconsistency, pinned as a fact rather than left to be inferred from
    // two string literals in different describes. A sweep that renamed both tags
    // to the current brand would fail the two checks above; this one fails the
    // subtler version — a future rename that moves the tags along with it
    // "for consistency" and updates those literals to match.
    const at = new Date(2026, 6, 30, 14, 32)
    const env = buildEnvelope(
      { tables: {}, truncated: [], rows: 0 },
      { exportedAt: '2026-07-30T11:32:00.000Z', locale: 'en', appVersion: '1.0.1' },
    )
    expect(exportFilename('json', at).startsWith(`${SLUG}-`)).toBe(true)
    expect(env.format.startsWith(SLUG)).toBe(false)
    expect(labelFileName(at).startsWith(`${SLUG}-`)).toBe(true)
    expect(LABEL_FILE_FORMAT.startsWith(SLUG)).toBe(false)
  })
})

describe('app.name', () => {
  it(`is ${BRAND} in both bundles`, () => {
    // The one key the whole shell renders its brand row from, pinned by value
    // rather than by parity — parity would be satisfied by both bundles being
    // wrong together, which is how the mixed-brand screen shipped.
    expect(valueAt(EN_STRINGS, 'app.name')).toBe(BRAND)
    expect(valueAt(AR_STRINGS, 'app.name')).toBe(BRAND)
  })

  it('is not translated', () => {
    // A product name is a proper noun. The Arabic bundle transliterating it
    // would give the app two names in one release, which is the failure this
    // whole file is about, arriving through the translation rather than the
    // rename.
    expect(valueAt(AR_STRINGS, 'app.name')).toBe(valueAt(EN_STRINGS, 'app.name'))
  })
})
