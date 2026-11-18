// =============================================================================
// The OAuth authorization server's wire shapes (PP-15.4, #1182)
// =============================================================================
//
// docs/specs/oauth-server.md §2.8. Only the shapes the WEB APP and clients of the
// platform routes see: the consent API (`GET /api/oauth/requests/:id`,
// `POST /api/oauth/requests/:id/decision`) and the grants API
// (`GET /api/oauth/grants`). The protocol endpoints (token, revoke, metadata)
// follow RFC 6749, 7009 and 8414 and are described by the OpenAPI document.
//
// `@marinoscar/platform-api/identity` wraps the REQUEST schemas as nestjs-zod DTOs;
// the response schemas describe the same payloads for the web app.
// =============================================================================

import { z } from 'zod';

/**
 * The OAuth error codes the authorization server answers with (RFC 6749 §5.2,
 * RFC 7009, RFC 8707 `invalid_target`, RFC 7591), plus `temporarily_unavailable`
 * for the rate limit. A client treats `invalid_grant` as "reconnect".
 *
 * @stability experimental
 */
export const OAUTH_ERROR_CODES = [
  'invalid_request',
  'invalid_client',
  'invalid_grant',
  'unauthorized_client',
  'unsupported_grant_type',
  'unsupported_response_type',
  'invalid_scope',
  'invalid_target',
  'access_denied',
  'server_error',
  'temporarily_unavailable',
] as const;

/**
 * An OAuth error code.
 *
 * @stability experimental
 */
export type OAuthErrorCode = (typeof OAUTH_ERROR_CODES)[number];

/**
 * The codes of the web error page `/oauth/error?code=...`: shown to the person,
 * never sent to a client's redirect URI.
 *
 * @stability experimental
 */
export const OAUTH_ERROR_PAGE_CODES = [
  'server_disabled',
  'unknown_client',
  'client_not_allowed',
  'client_metadata_unavailable',
  'invalid_redirect_uri',
] as const;

/**
 * A code of the web error page.
 *
 * @stability experimental
 */
export type OAuthErrorPageCode = (typeof OAUTH_ERROR_PAGE_CODES)[number];

/**
 * Why a grant was revoked (`oauth_grants.revoked_reason`). `admin` is reserved.
 *
 * @stability experimental
 */
export const OAUTH_GRANT_REVOKED_REASONS = ['user', 'admin', 'reuse_detected', 'client_disabled', 'offboarding'] as const;

/**
 * A grant revocation reason.
 *
 * @stability experimental
 */
export type OAuthGrantRevokedReason = (typeof OAUTH_GRANT_REVOKED_REASONS)[number];

/**
 * How the consent page groups and warns about a scope.
 *
 * @stability experimental
 */
export const OAUTH_SCOPE_RISKS = ['low', 'elevated', 'high'] as const;

/**
 * The kind of an OAuth client.
 *
 * @stability experimental
 */
export const OAUTH_CLIENT_KINDS = ['cimd', 'dynamic', 'registered'] as const;

/**
 * The decisions of `POST /api/oauth/requests/:id/decision`.
 *
 * @stability experimental
 */
export const OAUTH_DECISIONS = ['approve', 'deny'] as const;

/**
 * The grant types of the token endpoint.
 *
 * @stability experimental
 */
export const OAUTH_GRANT_TYPES = ['authorization_code', 'refresh_token'] as const;

/**
 * The entries of {@link OAUTH_ERROR_CODES} as an object type (the shape `z.enum` infers).
 *
 * @stability experimental
 */
export type OAuthErrorCodeEnum = { [K in (typeof OAUTH_ERROR_CODES)[number]]: K };

/**
 * The entries of {@link OAUTH_SCOPE_RISKS} as an object type.
 *
 * @stability experimental
 */
export type OAuthScopeRiskEnum = { [K in (typeof OAUTH_SCOPE_RISKS)[number]]: K };

/**
 * The entries of {@link OAUTH_CLIENT_KINDS} as an object type.
 *
 * @stability experimental
 */
export type OAuthClientKindEnum = { [K in (typeof OAUTH_CLIENT_KINDS)[number]]: K };

/**
 * The entries of {@link OAUTH_DECISIONS} as an object type.
 *
 * @stability experimental
 */
export type OAuthDecisionEnum = { [K in (typeof OAUTH_DECISIONS)[number]]: K };

/**
 * The entries of {@link OAUTH_GRANT_TYPES} as an object type.
 *
 * @stability experimental
 */
export type OAuthGrantTypeEnum = { [K in (typeof OAUTH_GRANT_TYPES)[number]]: K };

// Factories, not shared instances: every field gets its own enum.
const errorCodeSchema = (): z.ZodEnum<OAuthErrorCodeEnum> => z.enum(OAUTH_ERROR_CODES);
const scopeRiskSchema = (): z.ZodEnum<OAuthScopeRiskEnum> => z.enum(OAUTH_SCOPE_RISKS);
const clientKindSchema = (): z.ZodEnum<OAuthClientKindEnum> => z.enum(OAUTH_CLIENT_KINDS);
const decisionSchema = (): z.ZodEnum<OAuthDecisionEnum> => z.enum(OAUTH_DECISIONS);
const grantTypeSchema = (): z.ZodEnum<OAuthGrantTypeEnum> => z.enum(OAUTH_GRANT_TYPES);

/**
 * The body of `POST /api/oauth/requests/:id/decision`.
 *
 * @stability experimental
 */
export const oauthDecisionRequestSchema = z.object({
  /** Approve or deny. */
  decision: decisionSchema().describe('Whether the user allows or refuses the client.'),
  /** The ticked scope ids. */
  scopes: z
    .array(z.string().min(1).max(64))
    .max(64)
    .optional()
    .describe('The scope ids the user left ticked: a subset of the requested ones. Ignored on deny.'),
  /** The organization the grant acts in. */
  orgId: z.string().uuid().optional().describe('The organization the grant acts in: an active membership. Defaults to the session\'s active organization.'),
});

/**
 * The decision body.
 *
 * @stability experimental
 */
export type OAuthDecisionRequest = z.infer<typeof oauthDecisionRequestSchema>;

/**
 * One scope on the consent page.
 *
 * @stability experimental
 */
export const oauthConsentScopeSchema = z.object({
  /** The scope id. */
  id: z.string(),
  /** Shown on the consent page. */
  title: z.string(),
  /** One sentence for the consent page. */
  description: z.string(),
  /** How the page groups and warns about it. */
  risk: scopeRiskSchema(),
  /** Whether the user may grant it. */
  grantable: z.boolean().describe('False when the user holds none of the permissions the scope maps to.'),
  /** A default scope of the resource: it cannot be unticked. */
  required: z.boolean().describe('A default scope of the resource: it cannot be unticked.'),
  /** Whether an active grant already holds it. */
  alreadyGranted: z.boolean().describe('An active grant of this user to this client already holds it.'),
});

/**
 * `GET /api/oauth/requests/:id`: what the consent page shows.
 *
 * @stability experimental
 */
export const oauthConsentRequestSchema = z.object({
  /** The request id. */
  id: z.string().uuid(),
  /** The client asking: its host leads on the page, the name and logo are self-asserted. */
  client: z.object({
    /** The self-asserted name. */
    name: z.string(),
    /** The client's host. */
    host: z.string(),
    /** The self-asserted logo URL, or `null`. */
    logoUri: z.string().nullable(),
    /** How the client came to exist on this deployment. */
    kind: clientKindSchema(),
    /** When the client first appeared. */
    firstSeenAt: z.string().datetime(),
  }),
  /** Where the user goes after deciding. */
  redirectHost: z.string().describe('Where the user goes after deciding.'),
  /** Whether the redirect URI is a loopback address (warn). */
  isLoopbackRedirect: z.boolean(),
  /** The protected resource the grant is for. */
  resource: z.object({
    /** The resource id. */
    id: z.string(),
    /** The resource's display name. */
    name: z.string(),
  }),
  /** The requested scopes (`offline_access` excluded: see `offlineAccess`). */
  scopes: z.array(oauthConsentScopeSchema),
  /** The client asked to stay connected (a refresh token). */
  offlineAccess: z.boolean().describe('The client asked to stay connected (a refresh token).'),
  /** The organizations the grant may act in. */
  organizations: z
    .array(
      z.object({
        /** The organization id. */
        id: z.string().uuid(),
        /** The organization's name. */
        name: z.string(),
        /** Whether it is the session's active organization. */
        isCurrent: z.boolean(),
      }),
    )
    .describe('The active memberships the grant may act in (multi-organization mode); empty in single mode.'),
  /** The end of the 10-minute window. */
  expiresAt: z.string().datetime(),
});

/**
 * The consent page's data.
 *
 * @stability experimental
 */
export type OAuthConsentRequest = z.infer<typeof oauthConsentRequestSchema>;

/**
 * The response of the decision route.
 *
 * @stability experimental
 */
export const oauthDecisionResponseSchema = z.object({
  /** The URL to navigate to. */
  redirectTo: z.string().describe('The client\'s redirect URI with `code`, `state` and `iss` (approve) or `error=access_denied` (deny). The page navigates there.'),
});

/**
 * The decision response.
 *
 * @stability experimental
 */
export type OAuthDecisionResponse = z.infer<typeof oauthDecisionResponseSchema>;

/**
 * One entry of `GET /api/oauth/grants`: an app the caller connected. Never a token.
 *
 * @stability experimental
 */
export const oauthGrantViewSchema = z.object({
  /** The grant id (`DELETE /api/oauth/grants/:id`). */
  id: z.string().uuid(),
  /** The connected client. */
  client: z.object({
    /** The self-asserted name. */
    name: z.string(),
    /** The client's host. */
    host: z.string(),
    /** The self-asserted logo URL, or `null`. */
    logoUri: z.string().nullable(),
  }),
  /** The resource it may use. */
  resource: z.object({
    /** The resource id, or `null` when it is no longer registered. */
    id: z.string().nullable(),
    /** The resource's display name. */
    name: z.string(),
  }),
  /** The granted scopes with their titles. */
  scopes: z.array(
    z.object({
      /** The scope id. */
      id: z.string(),
      /** The scope's title. */
      title: z.string(),
    }),
  ),
  /** The organization the grant acts in, or `null`. */
  organization: z
    .object({
      /** The organization id. */
      id: z.string().uuid(),
      /** The organization's name. */
      name: z.string(),
    })
    .nullable(),
  /** When the user consented. */
  createdAt: z.string().datetime(),
  /** When a token of the grant was last used, or `null`. */
  lastUsedAt: z.string().datetime().nullable(),
});

/**
 * A connected app.
 *
 * @stability experimental
 */
export type OAuthGrantView = z.infer<typeof oauthGrantViewSchema>;

/**
 * The token endpoint's form fields (`application/x-www-form-urlencoded`), for
 * the OpenAPI description and clients.
 *
 * @stability experimental
 */
export const oauthTokenRequestSchema = z.object({
  /** `authorization_code` or `refresh_token`. */
  grant_type: grantTypeSchema(),
  /** The authorization code. */
  code: z.string().optional().describe('authorization_code: the code from the redirect.'),
  /** The authorization request's redirect URI, identical. */
  redirect_uri: z.string().optional().describe('authorization_code: identical to the authorization request\'s.'),
  /** The PKCE verifier. */
  code_verifier: z.string().optional().describe('authorization_code: the PKCE verifier (43 to 128 characters).'),
  /** The refresh token. */
  refresh_token: z.string().optional().describe('refresh_token: the refresh token.'),
  /** A narrower scope list. */
  scope: z.string().optional().describe('refresh_token: a narrower, space-separated scope list.'),
  /** The resource, when sent. */
  resource: z.string().optional().describe('authorization_code: the resource, when sent, must equal the authorization request\'s.'),
  /** The client id. */
  client_id: z.string().optional().describe('The client id (public clients, and client_secret_post).'),
  /** The client secret (`client_secret_post`). */
  client_secret: z.string().optional().describe('client_secret_post: the client secret.'),
});

/**
 * The token endpoint's form.
 *
 * @stability experimental
 */
export type OAuthTokenRequest = z.infer<typeof oauthTokenRequestSchema>;

/**
 * The token endpoint's success body (RFC 6749 §5.1).
 *
 * @stability experimental
 */
export const oauthTokenResponseSchema = z.object({
  /** The `oat_` access token. */
  access_token: z.string(),
  /** Always `Bearer`. */
  token_type: z.literal('Bearer'),
  /** Seconds until the access token expires. */
  expires_in: z.number().int().positive(),
  /** The `ort_` refresh token, when one was issued. */
  refresh_token: z.string().optional(),
  /** The granted scopes, space-separated. */
  scope: z.string(),
});

/**
 * The token response.
 *
 * @stability experimental
 */
export type OAuthTokenResponse = z.infer<typeof oauthTokenResponseSchema>;

/**
 * The body of every protocol error (RFC 6749 §5.2).
 *
 * @stability experimental
 */
export const oauthErrorResponseSchema = z.object({
  /** The error code. */
  error: errorCodeSchema(),
  /** A human sentence, never a secret. */
  error_description: z.string().optional(),
});

/**
 * A protocol error body.
 *
 * @stability experimental
 */
export type OAuthErrorResponse = z.infer<typeof oauthErrorResponseSchema>;
