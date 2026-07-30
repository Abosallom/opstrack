/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

// Injected by the `define` block in vite.config.ts — the real version string
// from package.json. Two consumers, and they are the whole list: the About card
// at the foot of Settings renders it through `t('settings.version')`, and
// lib/export.ts stamps it into every export's metadata so a file taken off the
// app can be traced back to the build that wrote it.
//
// The wording of this comment used to promise a card that no component
// rendered — the keys existed in both bundles, nothing asked for them, and the
// reach gate cannot see a key that is merely absent from every call site. Fixed
// at the v1.0.0 cut by building the card, not by softening the sentence.
declare const __APP_VERSION__: string

// vite/client types `import.meta.env` with an index signature, which under
// `strict` hands back `any` for every VITE_* read. Declaring the two we care
// about keeps the Supabase bootstrap honest about them being possibly absent —
// the client is nullable precisely because a credential-less build must run.
interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string
  readonly VITE_SUPABASE_ANON_KEY?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
