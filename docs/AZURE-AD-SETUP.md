# Microsoft Entra ID (Azure AD) sign-in — setup for IT

**Who this is for:** whoever administers the company's Microsoft 365 / Entra tenant.
**What it gets you:** OpsTrack members sign in with their work account instead of a
username and password.
**Time:** about 15 minutes in the Azure portal, plus 2 minutes in Supabase.
**What it does NOT need:** any change to on-prem Active Directory, any firewall
rule, any server inside the network. See §7.

Nothing in the app changes until step 5 is done. Until then the Microsoft button
does not appear at all — OpsTrack asks the project whether the provider is enabled
and renders nothing if it is not — so this can be prepared and abandoned with no
visible effect.

---

## 0. The facts you will need

| Thing | Value |
|---|---|
| Application name | `OpsTrack` |
| App URL | `https://abosallom.github.io/opstrack/` |
| Supabase project ref | `lrysgpbkmuqgzsjesfkr` |
| **Redirect URI to register in Azure** | `https://lrysgpbkmuqgzsjesfkr.supabase.co/auth/v1/callback` |
| Token type | OpenID Connect (v2.0) |
| Required delegated permissions | `openid`, `profile`, `email`, `offline_access` |

**The redirect URI is Supabase's, not the app's.** This is the single most common
mistake: Entra sends the browser back to Supabase, Supabase mints the session and
*then* sends the browser on to OpsTrack. Registering the GitHub Pages URL in Azure
produces `AADSTS50011: The redirect URI specified in the request does not match`.

---

## 1. Register the application

Azure portal → **Microsoft Entra ID** → **App registrations** → **New registration**.

1. **Name:** `OpsTrack`
2. **Supported account types:** *Accounts in this organizational directory only
   (single tenant)*.
   Pick single tenant unless OpsTrack is deliberately being opened to guests from
   other tenants. Multi-tenant means any Microsoft work account anywhere can
   complete a sign-in; OpsTrack would then refuse them at the door (§6), but the
   refusal is a worse gate than never letting them knock.
3. **Redirect URI:** platform **Web**, value
   `https://lrysgpbkmuqgzsjesfkr.supabase.co/auth/v1/callback`
4. **Register.**

From the overview page, copy:

- **Application (client) ID** → this is the *Client ID*
- **Directory (tenant) ID** → needed in step 4

---

## 2. Create a client secret

**Certificates & secrets** → **Client secrets** → **New client secret**.

- Description: `OpsTrack Supabase`
- Expires: 24 months (the maximum the portal offers)

Copy the **Value** immediately — the portal shows it exactly once. That value is
the *Client Secret*.

> **Diary the expiry.** When this secret expires, Microsoft sign-in stops working
> for everyone with no warning and no error the app can explain. Username
> sign-in keeps working, which is the fallback, but put the renewal date in a
> calendar now. Renewing is: new secret here, paste into Supabase, done — no
> code change and no deploy.

---

## 3. Permissions

**API permissions** → the default `User.Read` (Microsoft Graph, delegated) is
enough. Confirm `openid`, `profile`, `email` and `offline_access` are listed as
delegated permissions; add them if they are not.

**Grant admin consent** for the directory, so members are not each asked to
consent on first sign-in.

OpsTrack reads nothing from Graph. It uses the ID token's `email` claim and
nothing else — no directory browsing, no group membership, no calendar, no mail.
`email` is the one claim that must be present: without it Supabase stores a user
with a blank address and OpsTrack cannot match them to a member.

---

## 4. Hand these three values over

Send to Aziz (the OpsTrack owner) **through something other than email if you can**
— the secret is a credential:

1. Application (client) ID
2. Client secret **Value**
3. Directory (tenant) ID

---

## 5. Owner's half — Supabase (2 minutes, not IT's job)

Supabase Dashboard → project `lrysgpbkmuqgzsjesfkr` → **Authentication** →
**Sign In / Providers** → **Azure**:

1. **Enable** the provider.
2. **Application (client) ID** — from step 1.
3. **Secret Value** — from step 2.
4. **Azure Tenant URL** — `https://login.microsoftonline.com/<TENANT_ID>` for a
   single-tenant app. Leaving this blank means the `common` endpoint, which
   accepts *any* Microsoft tenant and undoes the single-tenant choice in §1.
5. Save.

Then **Authentication → URL Configuration → Redirect URLs**, add both:

```
https://abosallom.github.io/opstrack/
http://localhost:5173/
```

**Trailing slash included, and no `#` anywhere.** OpsTrack is a hash-routed app;
`src/lib/sso.ts` explains at length why a redirect target carrying a fragment
produces a sign-in that succeeds at Microsoft and then silently yields no session.
The URL above is what the app actually sends, and a value not in this list is
silently replaced by the project's Site URL.

Reload the OpsTrack sign-in page. The Microsoft button appears within a second of
load, with no deploy — the app reads `/auth/v1/settings` on every mount of that
screen precisely so that enabling the provider is the only step.

---

## 6. What happens to someone who is in Entra but not in OpsTrack

They complete the Microsoft sign-in, and OpsTrack immediately signs them back out
with:

> **This Microsoft account has no OpsTrack access.**
> You signed in to Microsoft successfully, but `name@company.com` is not a member
> of this workspace, so you have been signed out again. Ask your admin to add you,
> then sign in with Microsoft again.

This is deliberate and it is enforced in two places at once:

- **The app** (`installSsoGuard` in `src/lib/sso.ts`) checks for a `profiles` row
  and ends the session if there is none. That is what produces the message.
- **The database** (row-level security, every table) returns nothing to a session
  with no `profiles` row, whatever the app does. Even if the guard were removed
  tomorrow, a non-member would see an empty application, never someone else's data.

**Adding a member is still an OpsTrack action, not an Entra action.** Being in the
directory is authentication ("you are who you say"); being in `profiles` is
authorisation ("you work on this"). The admin adds people from OpsTrack's own
Members screen; there is no group in Entra that grants access, by design — the
workspace roster is small, deliberate, and owned by the person running the
operation rather than by directory membership.

**Order of operations for a new joiner:** the admin creates them in OpsTrack
first, using the email address that matches their work account exactly. Then
Microsoft sign-in works on their first try.

---

## 7. Why this is Entra and not on-prem AD (read this if you were expecting LDAP)

The original request was "sign in with Active Directory". What is being delivered
is **Entra ID SSO**, and the difference is not a shortcut:

- OpsTrack is a static web app. There is no server-side component of it inside
  the network — the browser talks to Supabase, and Supabase is a hosted service on
  the public internet.
- An LDAP bind needs a listener reachable from wherever the code runs, plus a
  service account credential held by that code. Neither exists here, and creating
  them would mean exposing a domain controller to the internet or standing up a
  VPN'd bridge service — a larger and riskier piece of infrastructure than the
  application it would serve.
- Entra ID is the same directory, and for a Microsoft 365 tenant the accounts are
  already synchronised into it. Users sign in with the same credential they use
  for Outlook, subject to the same conditional-access and MFA policies, which is
  what "sign in with AD" is actually asking for.

Conditional access, MFA, device compliance and sign-in risk policies all apply to
this flow automatically, because the sign-in happens on Microsoft's page and not
in OpsTrack. That is a security *gain* over the username-and-password path, which
OpsTrack itself has to police.

---

## 8. Verifying it, and undoing it

**Verify** (owner, 1 minute):

1. Open `https://abosallom.github.io/opstrack/` signed out. The Microsoft button
   is visible.
2. Click it. Microsoft asks which account (OpsTrack requests
   `prompt=select_account`, so it always asks — shared laptops must not silently
   sign in as the last person).
3. Sign in as an existing OpsTrack member → lands on Follow-ups.
4. Sign in as somebody who is in the tenant but not in OpsTrack → bounced back
   with the §6 message.

**Undo:** disable the Azure provider in Supabase. The button disappears on the
next page load. Nobody is locked out — every member still has their username and
password, and the owner still has email sign-in. Nothing about the app's data
changes.

---

## 9. Troubleshooting

| Symptom | Cause |
|---|---|
| `AADSTS50011` redirect URI mismatch | The Azure app registration has the OpsTrack URL instead of `https://lrysgpbkmuqgzsjesfkr.supabase.co/auth/v1/callback` (§0). |
| `AADSTS700016` application not found in directory | Single-tenant app, but Supabase's Azure Tenant URL is missing or points at `common` (§5.4). |
| Signed in at Microsoft, then dumped back on the OpsTrack sign-in page with no message | The redirect URL is not in Supabase's allow-list, or it was entered with a `#` fragment (§5). |
| `Unsupported provider: provider is not enabled` | The provider was not enabled in Supabase (§5.1) — but then the button should not have rendered; a stale tab from before it was disabled will do this. |
| Everybody gets the §6 "no access" message | Their OpsTrack member records were created with a different address than their work account. The match is on the exact email. |
| The button never appears | Supabase's `/auth/v1/settings` still reports `azure: false`. Check §5.1 was saved, then hard-reload. |
