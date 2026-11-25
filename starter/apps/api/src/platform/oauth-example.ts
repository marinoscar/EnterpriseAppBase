// =============================================================================
// EXAMPLE: let a third-party client (an AI assistant, an agent) use the notes API
// =============================================================================
//
// THIS FILE IS AN EXAMPLE AN APP DELETES (or replaces with its own resources).
// It registers, at import time and before the app boots:
//
//   * two OAuth scopes: names a user sees on the consent page, each a bundle of
//     the app's OWN permissions (a scope never grants more than the user holds);
//   * one protected resource: the sample `notes` routes, reachable by an `oat_`
//     token whose grant is for `<APP_URL>/api/notes`.
//
// The OAuth server ships OFF. Until an administrator enables it (Admin, OAuth
// clients) nothing here is reachable, and the conformance suite `oauth-server`
// (test/conformance.spec.ts) checks these registrations. To remove OAuth:
// delete this file, its import in ./platform.ts and `oauthServer: {}` in
// `IdentityModule.forRoot`, and the `oauthServer` suite in test/conformance.spec.ts.
// Recipes: docs/specs/oauth-server.md §4 of the platform repository.
// =============================================================================

import { registerPlatformHostAppMetrics } from '@marinoscar/platform-api/host';
import { OAUTH_APP_METRICS, registerOAuthProtectedResource, registerOAuthScope } from '@marinoscar/platform-api/identity';

// The OAuth server's four counters (authorizations, tokens issued, refusals, registrations).
registerPlatformHostAppMetrics(OAUTH_APP_METRICS);

registerOAuthScope({
  id: 'notes:read',
  title: 'Read your notes',
  description: 'See your notes.',
  permissions: ['notes:read'],
  risk: 'low',
  default: true,
});

registerOAuthScope({
  id: 'notes:write',
  title: 'Change your notes',
  description: 'Create, edit and delete your notes.',
  permissions: ['notes:write'],
  risk: 'elevated',
});

registerOAuthProtectedResource({
  id: 'notes',
  path: '/api/notes',
  routePrefixes: ['/api/notes'],
  scopes: ['notes:read', 'notes:write'],
  name: 'Notes',
});
