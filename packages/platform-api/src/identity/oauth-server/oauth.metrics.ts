// =============================================================================
// OAuth server metrics (PP-15.8, #1186)
// =============================================================================
//
// Four counters, declared in the app-metric registry like every other `app.*`
// instrument and emitted through `IDENTITY_METRICS.add(key, 1, attributes)`.
// An app that mounts the OAuth server registers them next to
// `ORGANIZATIONS_APP_METRICS` (`registerPlatformHostAppMetrics`); without that,
// or without an `IDENTITY_METRICS` binding, nothing is recorded and nothing
// fails.
//
// LOW CARDINALITY ONLY. Every label is a closed enumeration. NEVER a client id
// (a metadata-document client's id is a URL anyone can mint), a host, a user, a
// grant, a resource id or an organization: those go on spans and in audit rows.
// =============================================================================

import { OAUTH_ERROR_CODES } from '@marinoscar/platform-contract/identity';

import type { AppMetricAttribute } from '../../otel-core/index';
import type { IdentityAppMetricDef } from '../organizations/organizations.metrics';

const oneOf = (...values: readonly string[]): AppMetricAttribute => ({ kind: 'enum', values });

/**
 * The OAuth server's four counters, as app-metric declarations:
 *
 * | Key | Name | Label |
 * |---|---|---|
 * | `oauthAuthorizations` | `app.oauth.authorizations` | `outcome`: `approved`, `denied`, `error` |
 * | `oauthTokensIssued` | `app.oauth.tokens.issued` | `grant_type`: `authorization_code`, `refresh_token` |
 * | `oauthTokenRefusals` | `app.oauth.token.refusals` | `reason`: an RFC 6749 error code |
 * | `oauthClientRegistrations` | `app.oauth.client.registrations` | `kind`: `dynamic`, `cimd`, `registered` |
 *
 * @stability experimental
 */
export const OAUTH_APP_METRICS: readonly [
  IdentityAppMetricDef<'oauthAuthorizations'>,
  IdentityAppMetricDef<'oauthTokensIssued'>,
  IdentityAppMetricDef<'oauthTokenRefusals'>,
  IdentityAppMetricDef<'oauthClientRegistrations'>,
] = [
  {
    key: 'oauthAuthorizations',
    name: 'app.oauth.authorizations',
    kind: 'counter',
    unit: '{authorization}',
    description: 'OAuth authorization requests by outcome: approved or denied by the user, or refused as an error.',
    attributes: { outcome: oneOf('approved', 'denied', 'error') },
  },
  {
    key: 'oauthTokensIssued',
    name: 'app.oauth.tokens.issued',
    kind: 'counter',
    unit: '{token_response}',
    description: 'OAuth token responses issued, by grant type.',
    attributes: { grant_type: oneOf('authorization_code', 'refresh_token') },
  },
  {
    key: 'oauthTokenRefusals',
    name: 'app.oauth.token.refusals',
    kind: 'counter',
    unit: '{refusal}',
    description: 'OAuth token requests refused, by the RFC 6749 error code.',
    attributes: { reason: oneOf(...OAUTH_ERROR_CODES) },
  },
  {
    key: 'oauthClientRegistrations',
    name: 'app.oauth.client.registrations',
    kind: 'counter',
    unit: '{client}',
    description: 'OAuth clients registered, by kind (dynamic registration, a metadata document first seen, or an administrator).',
    attributes: { kind: oneOf('dynamic', 'cimd', 'registered') },
  },
];
