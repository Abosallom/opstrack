// The field primitives, as one import path.
//
// Types are re-exported with `export type` because tsconfig.app.json sets
// `verbatimModuleSyntax` — a plain `export { FieldProps }` emits a runtime
// re-export of a name that does not exist at runtime, and the build fails at
// the bundler rather than at the type checker.

export { Field, FieldRow } from './Field'
export type { FieldProps, FieldRowProps } from './Field'

export { TextField, TextAreaField } from './TextField'
export type { TextFieldProps, TextAreaFieldProps } from './TextField'

export { InlineText } from './InlineText'
export type { InlineTextProps } from './InlineText'

export { DateField } from './DateField'
export type { DateFieldProps } from './DateField'

export { TagsField } from './TagsField'
export type { TagsFieldProps } from './TagsField'

export { LinksField } from './LinksField'
export type { LinksFieldProps } from './LinksField'

// Stand-ins until components/icons.tsx publishes them; see glyphs.tsx's header.
export { IconCheck, IconChevronDown, IconClose, IconPlus } from './glyphs'
export type { GlyphProps } from './glyphs'
