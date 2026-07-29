/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

// Injected by the `define` block in vite.config.ts — the real version string
// from package.json. Shown in Settings › About ("OpsTrack vX.Y.Z").
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
