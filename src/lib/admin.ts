// Intentionally empty — the admin email allow-list used to live here.
//
// There is now exactly ONE copy of it, in supabase/functions/admin-members/index.ts,
// and it is a BOOTSTRAP ALLOW-LIST FOR MEMBER PROVISIONING ONLY: it decides who
// the edge function will let call it with the service-role client. It is never
// a UI gate.
//
// Why the UI copy had to go: the app's admin gate is `profiles.role`, because
// that is what RLS reads (`is_admin()` in 0001). ORing an email list into the
// role made the two disagree — the browser would render the admin screens for
// an address on the list while every insert/update it issued came back 42501.
// A gate that shows you a form the server will always reject is worse than no
// gate. Migration 0002 promotes the first admin's `profiles.role` directly, so
// the single source of truth is the row, in the UI and in RLS alike.
//
// The reference codebase (showtrackr) already paid for the two-list version of
// this: its copies drifted, and the symptom was an admin-only button that did
// nothing for one of the two admins.
//
// This file is kept as a marker rather than deleted so the next person to reach
// for `isAdminEmail()` finds this note instead of re-adding it.

export {}
