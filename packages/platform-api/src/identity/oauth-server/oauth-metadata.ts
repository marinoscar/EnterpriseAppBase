// =============================================================================
// The authorization server metadata document (RFC 8414, PP-15.4)
// =============================================================================
//
// docs/specs/oauth-server.md §2.9: the document has no field beyond these. In
// particular no `jwks_uri` (tokens are opaque) and no OpenID fields.
// `registration_endpoint` and `client_id_metadata_document_supported` appear
// only while their setting is on AND something serves them (PP-15.5 declares it
// through `OAuthServerFeatures`).
// =============================================================================

import type { OAuthServerSettingsValue } from './oauth-server-settings.schemas';
import { oauthScopeRegistry, OFFLINE_ACCESS_SCOPE } from './oauth-scope.registry';

/**
 * The metadata document as served.
 *
 * @stability experimental
 */
export interface OAuthAuthorizationServerMetadata {
  /** The issuer: `APP_URL` with no trailing slash. */
  issuer: string;
  /** `GET /api/oauth/authorize`. */
  authorization_endpoint: string;
  /** `POST /api/oauth/token`. */
  token_endpoint: string;
  /** `POST /api/oauth/register`; only while dynamic registration is on and served. */
  registration_endpoint?: string;
  /** `POST /api/oauth/revoke`. */
  revocation_endpoint: string;
  /** Every registered scope id, plus `offline_access`. */
  scopes_supported: string[];
  /** Always `code`. */
  response_types_supported: ['code'];
  /** `authorization_code` and `refresh_token`. */
  grant_types_supported: ['authorization_code', 'refresh_token'];
  /** The three client authentication methods; `none` is always listed. */
  token_endpoint_auth_methods_supported: ['none', 'client_secret_post', 'client_secret_basic'];
  /** Always `S256`; `plain` is never listed. */
  code_challenge_methods_supported: ['S256'];
  /** Only while metadata document clients are on and served. */
  client_id_metadata_document_supported?: true;
  /** Always `true`: every authorization response carries `iss` (RFC 9207). */
  authorization_response_iss_parameter_supported: true;
}

/**
 * Builds the metadata document.
 *
 * @param input - the issuer (`APP_URL` without a trailing slash), the settings and which optional features have a route.
 * @returns the document.
 *
 * @stability experimental
 */
export function buildAuthorizationServerMetadata(input: {
  issuer: string;
  settings: Pick<OAuthServerSettingsValue, 'dynamicClientRegistration' | 'clientIdMetadataDocuments'>;
  hasDynamicClientRegistration: boolean;
  hasClientIdMetadataDocuments: boolean;
  /** When given, `scopes_supported` lists only these ids (`offline_access` is always kept). Compute it with `availableScopes(ids, {})`. */
  availableScopeIds?: readonly string[];
}): OAuthAuthorizationServerMetadata {
  const { issuer } = input;
  const allowed = input.availableScopeIds ? new Set(input.availableScopeIds) : undefined;
  const scopes = [...new Set([...oauthScopeRegistry.ids(), OFFLINE_ACCESS_SCOPE])].filter(
    (id) => id === OFFLINE_ACCESS_SCOPE || !allowed || allowed.has(id),
  );
  return {
    issuer,
    authorization_endpoint: `${issuer}/api/oauth/authorize`,
    token_endpoint: `${issuer}/api/oauth/token`,
    ...(input.settings.dynamicClientRegistration && input.hasDynamicClientRegistration ? { registration_endpoint: `${issuer}/api/oauth/register` } : {}),
    revocation_endpoint: `${issuer}/api/oauth/revoke`,
    scopes_supported: scopes,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    token_endpoint_auth_methods_supported: ['none', 'client_secret_post', 'client_secret_basic'],
    code_challenge_methods_supported: ['S256'],
    ...(input.settings.clientIdMetadataDocuments && input.hasClientIdMetadataDocuments ? { client_id_metadata_document_supported: true as const } : {}),
    authorization_response_iss_parameter_supported: true,
  };
}
