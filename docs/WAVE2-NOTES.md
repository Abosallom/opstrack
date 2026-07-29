# Wave 2 spec deltas (discovered live, 2026-07-29)

## Sign-in: free tier cannot put the OTP code in the email

Supabase free tier + default email provider **rejects email-template changes**
(`Email template modification is not available for free tier projects…`), so the sign-in email
always contains a **magic link**, never a visible `{{ .Token }}` code. The current SignIn screen
promises "a 6-digit code" the user can never receive — a live copy/flow mismatch.

Binding changes for the W2-SIGNIN worker:

1. **Email accounts sign in by magic link, not code.** After `sendOtp`, the screen says
   "Check your email and open the link" (EN/AR), with a resend affordance. Drop the code-entry
   step for email accounts. Keep `verifyOtp` wired behind an "enter code instead" disclosure —
   it becomes useful the day custom SMTP is configured, and costs nothing.
2. **Username accounts are untouched** — password + claim flow per WAVE1-ADDENDUM (no email
   involved at all).
3. Auth config already applied live: `site_url = https://abosallom.github.io/opstrack/`,
   `uri_allow_list` covers the Pages origin + localhost:5197, `mailer_otp_exp = 600`.
   The magic-link redirect carries tokens in the URL hash; supabase-js parses and strips them at
   module init (before React Router rewrites the hash) — do not add manual hash handling.
4. If custom SMTP is ever configured (Settings → Auth → SMTP), the template can show the code
   and the disclosure in (1) becomes the primary path again. Note this in ADMIN.md.

## SLA is a track × priority matrix (owner decision, 2026-07-29)

Aziz upgraded the SLA requirement: per-priority defaults (0003's `vocab_options.sla_days`,
already in Wave 1) **plus per-track overrides**. Binding design:

- **Migration `0005_track_slas.sql`** (the reserved slot — this is exactly the "a wave proves it
  needs schema" case): `track_slas (track_id uuid fk on delete cascade, priority text check
  (same frozen list), sla_days int not null check > 0, primary key (track_id, priority))`,
  member-select / admin-write RLS, audited like tracks.
- **Resolution order in `v_entry_health`** (and mirrored in `lib/health.ts` + its parity test):
  `track_slas` row → `vocab_options.sla_days` → null (no SLA). The view join must not change the
  row count.
- **UI:** VocabularyAdmin priority rows carry the *default* SLA field; **TrackEditor gains an
  "SLA overrides" section** — one row per priority, empty input = inherit default, with the
  resolved effective value shown greyed. Both screens state the resolution rule in one sentence.
- Dashboard/digest SLA compliance uses the resolved value — never the default alone.

## "Refine all the app" — polish mandate (owner directive, 2026-07-29)

Standing instruction for every remaining wave: beyond correctness, each screen verifier and the
wave audit include a **refinement pass** — spacing/alignment rhythm on the 4px grid, consistent
empty/loading/error states, motion (150–200ms ease, reduced-motion honoured), hover/active/focus
states on every control, typographic hierarchy, and RTL mirror-quality equal to LTR. Findings are
filed like defects, not suggestions.
