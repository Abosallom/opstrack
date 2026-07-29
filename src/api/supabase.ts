// Supabase client — Postgres, Auth, Realtime and RLS for the whole app.
//
// The client is NULLABLE on purpose. A build without VITE_SUPABASE_URL /
// VITE_SUPABASE_ANON_KEY (a fresh clone, a preview deploy, CI) must still boot
// and render the shell instead of throwing at import time and showing a white
// screen. Every call site guards on it and returns a friendly "not configured"
// message rather than assuming a live connection.

import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const url = (import.meta.env.VITE_SUPABASE_URL as string | undefined) ?? ''
const anonKey = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined) ?? ''

export const supabase: SupabaseClient | null =
  url && anonKey ? createClient(url, anonKey) : null

/** True when this build shipped Supabase credentials (backend available). */
export function isConfigured(): boolean {
  return supabase !== null
}
