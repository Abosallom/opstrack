// Who may change a MEETING — the client-side mirror of `meetings_update`.
//
// WHY THIS EXISTS, AND WHY IT IS A COPY OF lib/permissions.ts's DOCTRINE.
// That module's header states the rule the whole app is built on: "the
// permission answer is computed BEFORE the affordance renders … and no request
// is sent". It mirrors `entries_update`. Nothing mirrored `meetings_update`,
// and the meetings screens shipped three controls that ignored it:
//
//   · the triage notes textarea, offered to every attendee. Blur → optimistic
//     apply → PostgREST returns zero rows under RLS → PGRST116 → rollback →
//     the effect that follows the store row overwrites the box with the stored
//     value. The typed paragraph was gone, with a toast where it used to be.
//   · "End meeting", which ran a confirmation dialog, set the state, and then
//     discovered the refusal.
//   · "Resume", on both MeetingLive and MeetingTriage.
//
// A meeting is the one screen where the user cannot simply do it again.
//
// THE POLICY, verbatim from 0001 (and re-read live before this was written —
// no later migration touches it):
//
//   create policy meetings_update on public.meetings
//     for update using (created_by = auth.uid() or public.is_admin())
//     with check (created_by = auth.uid() or public.is_admin());
//
// Note what it does NOT cover: `meeting_lines` update/insert are `is_member()`,
// so capturing, editing, re-stating and triaging LINES stay open to everyone in
// the room. Only the meeting HEADER — title, track, attendees, notes, ended_at
// — is the creator's. That split is the reason this answer is per-control and
// not a page-level gate.
//
// WHERE IT WILL EVENTUALLY LIVE: beside canEditEntry() in lib/permissions.ts,
// as the second mirror. It is here because this fix pass owns `src/pages/**`
// and may not edit that file; see the handoff note.

import type { Meeting, UserRole } from '../../types'

/**
 * `created_by === meId || role === 'admin'`, with a signed-out reader always
 * false.
 *
 * `meId === null` is tested first for the reason canEditEntry() gives: every
 * write policy keys off `auth.uid()`, so a null id can only ever produce a
 * rejection — and `created_by` is nullable (the author's profile may be gone),
 * which would make `null === null` answer true for a signed-out visitor.
 */
export function canEditMeeting(
  meeting: Pick<Meeting, 'created_by'> | undefined,
  meId: string | null,
  role: UserRole,
): boolean {
  if (meId === null || meeting === undefined) return false
  return meeting.created_by === meId || role === 'admin'
}
