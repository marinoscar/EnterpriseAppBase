# Runbook: Running in Multi-Organization Mode

This runbook takes a deployment from one organization to several: switching
`TENANCY_MODE` to `multi`, creating the first customer organization, inviting
its administrator, and the day-to-day work that organization's administrator
then does. It does not cover the design; see
[`docs/specs/platform-packages.md`](../specs/platform-packages.md#tenancy-and-access-model)
for the tenancy model and [`docs/API.md`](../API.md#organization-routes-act-on-the-active-organization)
for the routes.

Source of truth for every claim below:

- `packages/platform-api/src/identity/organizations/tenancy-mode.ts`: how `TENANCY_MODE` is parsed.
- `apps/api/src/auth/auth.service.ts` (`handleGoogleLogin`): what a sign-in
  does in each mode, including the invitation claim.
- `apps/api/src/organizations/`: the organization, member and invitation
  services and controllers.
- `apps/web/src/config/adminSections.tsx`: the `Organization` and
  `Organizations` cards (`feature: 'orgs'`).

**Deployments ship in single-organization mode.** With `TENANCY_MODE` unset
(or `single`) everyone is a member of the default organization, organization
management is hidden in the web app, and creating an organization is refused
(`409 TENANCY_SINGLE_ORG`).

---

## 1. Before you start

- **Multi mode changes who can sign in.** In `multi`, a user who belongs to no
  organization is refused at sign-in (`no_organization`), and nobody joins the
  default organization automatically except the `INITIAL_ADMIN_EMAIL`
  account. Existing users keep their default-organization memberships, so they
  keep signing in.
- **Have a system administrator account ready.** Creating an organization
  needs the system permission `organizations:write`, which the system `admin`
  role holds. The `INITIAL_ADMIN_EMAIL` account is one.
- **Take a backup** (Console → Database Backup) before the switch, as for any
  change of deployment-wide behaviour.

## 2. Switch the deployment to multi mode

1. In the deployment's `infra/compose/.env`, set `TENANCY_MODE` to `multi`.
2. Restart the API container (the mode is read once, at startup; an invalid
   value stops the API rather than guessing).
3. Sign in again as a system administrator and open Console → Doctor. The
   `tenancy.mode` row should read `ok` for `multi`.
4. `GET /api/auth/me` now reports `"tenancyMode": "multi"`, and the Console
   shows an **Organizations** group with two cards: **Organization** (the
   current organization's people) and **Organizations** (every organization).

To go back, set `TENANCY_MODE` to `single` and restart. The `tenancy.mode`
check then fails while more than one organization exists: running several
organizations in single mode is unsupported.

## 3. Create the first customer organization

1. Console → **Organizations** → **Create organization**.
2. Enter the name, the slug (lower-case letters, digits and hyphens; it cannot
   be changed later) and the **first administrator's email**.
3. Create. The API writes the organization, a pending invitation with the
   `org_admin` role for that address (valid for 14 days) and, when the address
   is not on the allowlist yet, an allowlist entry; then it emails the
   invitation (`org.invitation`). Audit events: `org:created`,
   `allowlist:add`, `org:invite_created`.

If the email does not arrive, check Console → Email; the invitation still
works without it, because signing in is the acceptance.

## 4. The invited administrator signs in

The invitee signs in with Google **using the invited address**. At sign-in
the API claims every pending, unexpired invitation to that address: the
membership is created with the invitation's role (or an existing membership
is upgraded, never downgraded) and the invitation is marked `accepted`. The
session opens in the newly joined organization.

They now see Console → **Organization** (and only that card, unless they are
also a deployment operator), with two tabs:

- **Members**: change a member's role (`org_admin`, `contributor`, `viewer`),
  suspend or reactivate, remove. Nobody can change their own role, suspend or
  remove themselves, and the organization always keeps at least one active
  `org_admin` (`409 LAST_ORG_ADMIN`). Removing a member revokes their
  sessions, personal access tokens and device sign-ins **for this
  organization** at once.
- **Invites**: invite an address with a role, revoke a pending invitation, and
  see accepted, revoked and expired ones.

A user who belongs to several organizations switches between them with the
organization button in the top bar.

## 5. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| The Organizations group is missing from the Console | The deployment is still in single mode, or the API was not restarted | Check `tenancyMode` on `GET /api/auth/me`; set `TENANCY_MODE=multi` and restart the API |
| Creating an organization answers `409 TENANCY_SINGLE_ORG` | Single mode | As above |
| Creating answers `409 SLUG_TAKEN` | The slug is in use | Choose another slug |
| The invitee is told `no_organization` | They signed in with another address, or the invitation expired or was revoked | Check the Invites tab; re-invite (it renews the invitation) and have them sign in with exactly the invited address |
| The invitee is told `not_allowlisted` | The allowlist entry was removed after the invitation | Re-invite, or add the address on Console → Users & Allowlist |
| An administrator cannot demote or remove a colleague (`LAST_ORG_ADMIN`) | That colleague is the last active `org_admin` | Make another member an `org_admin` first |
