// =============================================================================
// AI platform permissions (issue #676, PP-1.4)
// =============================================================================
//
// Pure data: this module's permissions and their default role grants. Imports
// only types and has no side effect; `common/permissions/permission.manifest.ts`
// registers it, and `common/constants/roles.constants.ts` derives `PERMISSIONS`
// from it. After a change, run `npm run catalog:permissions --workspace=api` and
// commit the regenerated `prisma/catalog/permissions.json`.
// Recipe: common/permissions/README.md.
// =============================================================================

import type { PermissionDeclarationMap } from '../common/permissions/permission.types';

export const AI_PERMISSIONS = {
  // AI platform (issue #423, epic #419, umbrella #418).
  //
  // THREE PERMISSIONS, NOT TWO, and the split matters: `ai_config:*` and
  // `ai:use` answer completely different questions, at completely different
  // blast radii.
  //
  // `ai_config:read`/`ai_config:write` gate the DEPLOYMENT-WIDE policy — the
  // `ai` system-settings namespace: whether AI is enabled at all, the key
  // policy, per-provider configuration and the caps every call is bound by.
  // Same reasoning as `storage_config:*`, `push:*`, `broadcasts:*` and
  // `nodes:*` above, none of which are folded into `system_settings:*`: a
  // wrong or malicious change here reaches every user of the deployment at
  // once (turning AI on/off for everyone, redirecting every call to a
  // different `baseUrl`), which is a materially different act from an
  // ordinary settings edit and gets its own controller-enforced permission
  // rather than mirroring one nothing in that controller checks.
  //
  // `ai:use` is the OPPOSITE axis: may THIS CALLER invoke AI at all, using
  // THEIR OWN saved key (`UserAiKey`)? It changes nothing about anyone else's
  // access, touches no deployment-wide configuration, and costs this
  // deployment nothing it did not already agree to when the caller saved
  // their own key — the same shape `storage:read`/`storage:write` grant
  // ordinary object access while `storage_config:*` gates who may repoint the
  // whole bucket. A Contributor or a Viewer holding `ai:use` can call a model
  // with their own credential; neither can touch whether AI is enabled for
  // anyone else, or under which policy.
  //
  // Folding `ai:use` into `ai_config:read` (or granting it alongside) would
  // hand every ordinary user of this application a policy-reading permission
  // gated Admin-only everywhere else in this file; folding `ai_config:*` into
  // `ai:use` would let every user who may call AI with their own key also
  // flip the switch for the entire deployment. Neither substitution is safe,
  // which is exactly why `storage:*`/`storage_config:*` refused it first.
  //
  // #423, epic #419 — ADMIN gets all three AI permissions: the two
  // deployment-wide config ones (same "narrow, operational surface" posture
  // as `storage_config:*`/`push:*`/`broadcasts:*`/`nodes:*` above) AND
  // `ai:use`, since an administrator should not need a second grant to use
  // a capability they can also configure.
  AI_CONFIG_READ: {
    id: 'ai_config:read',
    description: 'View the deployment-wide AI platform policy',
    scope: 'system',
    defaultGrants: ['admin'],
  },
  AI_CONFIG_WRITE: {
    id: 'ai_config:write',
    description:
      'Change whether AI is enabled, the key policy, per-provider configuration and the deployment-wide defaults',
    scope: 'system',
    defaultGrants: ['admin'],
  },
  AI_USE: {
    id: 'ai:use',
    description: 'Call AI models using a saved key',
    scope: 'org',
    defaultGrants: [
      // Issue #723: `ai:use` is ORG scope, so the organization administrator
      // holds it, not the system `admin` role. A system administrator keeps it
      // through the `org_admin` role on their membership (the migration moves
      // the grant), so nobody loses it.
      'org_admin',
      // #423, epic #419 — `ai:use` only, never `ai_config:*`: a Contributor may
      // call AI with their own saved key, and has no say over whether AI is
      // enabled for anyone else or under which policy.
      'contributor',
      // #499 — deliberately NO `'viewer'` here, unlike Contributor above. Viewer
      // is the DEFAULT role every new user lands in (see `ROLES` above and
      // `AuthService`'s allowlist-driven bootstrap), so seeding `ai:use` onto
      // it meant every fresh signup could call AI with no explicit grant. That
      // is fine under `byok` (no key, no calls succeed) but wrong under
      // `byok_with_org_fallback`: a brand-new Viewer would silently spend the
      // deployment's own org key the first time they touched an AI surface,
      // with no administrator having decided that person should be able to.
      // An administrator who wants a specific Viewer (or all of them) to use
      // AI grants it back explicitly — a `role_permissions` row for
      // `('viewer', 'ai:use')` — or promotes the account to Contributor, which
      // already carries the grant.
    ],
  },
} as const satisfies PermissionDeclarationMap;
