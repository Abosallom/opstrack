# Terminology admin — spec (owner request, 2026-07-31)

> "Instead of giving you feedback in the file, make a configuration page in admin settings."

Replaces the PDF worksheet round-trip. The owner renames anything a person reads, in both
languages, himself — and it takes effect for everyone without a deploy.

## What already exists (do not rebuild)

- **Vocabulary values** (status / priority / type) — already admin-editable in
  `Settings › Vocabulary` via `vocab_options`. Untouched by this feature.
- **Track names** — already editable in `Settings › Tracks`.

This feature covers everything else: entry field labels, navigation, screen titles, health states,
section headings, button copy, empty states — the ~1,600-key locale surface.

## Architecture: an override layer over `t()`, not an edit of the bundles

A new table `label_overrides (key, en, ar, updated_by, updated_at)`, admin-write / member-read.
Resolution order inside `lib/i18n.ts`:

```
override[locale][key]  →  bundle[locale][key]  →  bundle.en[key]  →  key
```

**Why an override layer rather than editing the JSON bundles:** the bundles ship in the build, so
editing them means a deploy for every wording change — the exact round-trip this feature exists to
delete. Overrides are data, load once at sign-in, and apply live. It also makes **Reset to default**
trivially correct: delete the row and the shipped string returns.

**Load path.** Overrides are fetched with config/vocab at sign-in and cached in `localStorage`
alongside them, then injected via a new `setOverrides(map)` in `lib/i18n.ts` which bumps the
existing listener set — so every `useLocale()` subscriber re-renders exactly as it does on a
language switch. `t()` stays synchronous and its signature does not change.

**`lib/i18n.ts` must not import a store** (the layering rule). The store pushes overrides *into*
i18n; i18n never pulls.

## The hard parts, and the rules for each

1. **Placeholders are load-bearing.** `entry.createdBy` is `Created by ⁨{name}⁩`. An override that
   drops `{name}` silently deletes information; one that invents `{foo}` renders the literal
   braces. **Validation is not optional**: an override must carry exactly the same placeholder set
   as the shipped string. Reject on save with a clear message naming the missing token.
2. **Plural nodes.** Keys whose value is a CLDR plural object (Arabic has up to six forms) are
   **not editable as a single string**. Either edit every form the locale selects, or mark the key
   read-only in v1 with an explanatory note. Prefer: expose the forms individually for the current
   locale, using the same `EXACT_CATEGORIES` rule that `lib/plural.ts` already enforces — `{count}`
   required in range categories, optional in exact ones. Reuse that validator; do not write a second.
3. **Bidi.** Arabic overrides interpolating a name, a number or a Latin word need isolates. Apply
   `lib/bidi.ts` automatically on save rather than asking the owner to type control characters, and
   say so in the UI.
4. **The escape hatch must be obvious.** Any single row resets to default; a global
   **Reset all overrides** exists and is `confirm()`-guarded. It must be impossible to render the
   app unusable and be unable to get back — including if someone blanks a nav label.
5. **Blank means default**, never an empty label. An empty input clears the override.

## The screen: `Settings › Terminology` (admin only)

Route `/settings/terminology`. Not a raw key dump — 1,600 keys is not a UI. Structure:

- **Grouped by the sections a person recognises**, in this order: Entry fields · Navigation ·
  Screen titles · Health states · Buttons & actions · Empty states · Messages & errors. The
  grouping is a curated map from key prefixes, kept in one exported constant so it is reviewable.
- **Search** across key, English, Arabic and the section name — the primary way in.
- **A row per key**: the shipped English and Arabic shown as muted "default" text, with two inputs
  beneath. Changed rows carry a dot and a Reset. Save is per-row and optimistic, with rollback.
- **"Show only changed"** toggle, and a count of active overrides in the header.
- **Preview where it appears**: each row names its screen, from the same curated map.
- Export / import the override set as JSON — so a wording pass can be drafted offline and applied
  in one go, and so it can be carried to the NphiesCore workspace later.

## Migration

`0015_label_overrides.sql`, re-runnable:

```sql
create table if not exists public.label_overrides (
  key        text primary key,
  en         text,
  ar         text,
  updated_by uuid references public.profiles (id) on delete set null,
  updated_at timestamptz not null default now()
);
-- member read (everyone renders the labels), admin write.
-- config_audit'ed like tracks and vocab, so a confusing rename has a trail.
```

Both `en` and `ar` nullable: overriding one language only is a real case.

## Non-negotiables

TS strict · no new deps · logical CSS only, prefix `.term-` (register it) · the page itself is
translated through `t()` (and yes, its own labels are overridable — do not special-case them) ·
admin-gated route with a member redirect · 44px targets · the validator is shared with
`lib/plural.ts`, not duplicated · tests for the resolution order, placeholder validation, plural
forms, reset, and that a blank override never renders an empty label.
