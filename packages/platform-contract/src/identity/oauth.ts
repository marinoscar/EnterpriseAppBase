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
 * RFC 7009, RFC 8707 `invalid_target`, RFC 7591 `invalid_redirect_uri` and `invalid_client_metadata`), plus `temporarily_unavailable`
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
  'invalid_redirect_uri',
  'invalid_client_metadata',
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
 * Why a grant was revoked (`oauth_grants.revoked_reason`). `admin` is an administrator's `DELETE /api/admin/oauth/grants/:id`.
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

/**
 * The `application_type` values of dynamic registration (RFC 7591).
 *
 * @stability experimental
 */
export const OAUTH_APPLICATION_TYPES = ['web', 'native'] as const;

/**
 * The entries of {@link OAUTH_APPLICATION_TYPES} as an object type.
 *
 * @stability experimental
 */
export type OAuthApplicationTypeEnum = { [K in (typeof OAUTH_APPLICATION_TYPES)[number]]: K };

/**
 * The entries of {@link OAUTH_GRANT_REVOKED_REASONS} as an object type.
 *
 * @stability experimental
 */
export type OAuthGrantRevokedReasonEnum = { [K in (typeof OAUTH_GRANT_REVOKED_REASONS)[number]]: K };

/**
 * The query-string booleans `'true'` and `'false'` as an object type.
 *
 * @stability experimental
 */
export type OAuthQueryBooleanEnum = {
  /** The query value `true`. */
  true: 'true';
  /** The query value `false`. */
  false: 'false';
};

// Factories, not shared instances: every field gets its own enum.
const revokedReasonSchema = (): z.ZodEnum<OAuthGrantRevokedReasonEnum> => z.enum(OAUTH_GRANT_REVOKED_REASONS);
const queryBooleanSchema = (): z.ZodEnum<OAuthQueryBooleanEnum> => z.enum(['true', 'false']);
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
    /**
     * `true` when the client first appeared less than 24 hours ago OR no other
     * user on this deployment holds an active grant with it: the consent page
     * then warns that nobody here has connected it before.
     */
    isNewToDeployment: z.boolean(),
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

// ---- client identity (PP-15.5, #1183) -------------------------------------------------------

/**
 * The client authentication methods a client may have.
 *
 * @stability experimental
 */
export const OAUTH_CLIENT_AUTH_METHODS = ['none', 'client_secret_post', 'client_secret_basic'] as const;

/**
 * The entries of {@link OAUTH_CLIENT_AUTH_METHODS} as an object type.
 *
 * @stability experimental
 */
export type OAuthClientAuthMethodEnum = { [K in (typeof OAUTH_CLIENT_AUTH_METHODS)[number]]: K };

const applicationTypeSchema = (): z.ZodEnum<OAuthApplicationTypeEnum> => z.enum(OAUTH_APPLICATION_TYPES);
const authMethodSchema = (): z.ZodEnum<OAuthClientAuthMethodEnum> => z.enum(OAUTH_CLIENT_AUTH_METHODS);

/**
 * The body of `POST /api/oauth/register` (RFC 7591). Unknown fields are ignored.
 * Documented for OpenAPI and clients; the endpoint parses it itself so that its
 * errors are RFC 7591 JSON.
 *
 * @stability experimental
 */
export const oauthRegistrationRequestSchema = z.object({
  /** Redirect URIs (at most 10, each at most 2,000 characters). */
  redirect_uris: z.array(z.string().max(2000)).min(1).max(10),
  /** Display name (at most 200 characters). */
  client_name: z.string().max(200).optional(),
  /** The client's home page. */
  client_uri: z.string().max(2000).optional(),
  /** The client's logo (shown only when `https:` and on the client's host). */
  logo_uri: z.string().max(2000).optional(),
  /** `none` (default) or a secret-based method (a secret is issued). */
  token_endpoint_auth_method: authMethodSchema().optional(),
  /** Must include `authorization_code`. */
  grant_types: z.array(z.string()).optional(),
  /** Must be `code`. */
  response_types: z.array(z.string()).optional(),
  /** `native` permits loopback and reverse-domain redirect URIs. */
  application_type: applicationTypeSchema().optional(),
  /** Requested scopes (informational). */
  scope: z.string().max(2000).optional(),
});

/**
 * The dynamic registration request.
 *
 * @stability experimental
 */
export type OAuthRegistrationRequest = z.infer<typeof oauthRegistrationRequestSchema>;

/**
 * The `201` body of `POST /api/oauth/register` (RFC 7591 §3.2.1).
 *
 * @stability experimental
 */
export const oauthRegistrationResponseSchema = z.object({
  /** The generated `oc_...` client id. */
  client_id: z.string(),
  /** The secret, once, for a confidential client only. */
  client_secret: z.string().optional(),
  /** Seconds since the epoch. */
  client_id_issued_at: z.number().int(),
  /** Always `0`: the secret does not expire. */
  client_secret_expires_at: z.literal(0).optional(),
  /** The stored metadata. */
  redirect_uris: z.array(z.string()),
  /** The stored name. */
  client_name: z.string(),
  /** The stored authentication method. */
  token_endpoint_auth_method: authMethodSchema(),
  /** `authorization_code`. */
  grant_types: z.array(z.string()),
  /** `code`. */
  response_types: z.array(z.string()),
  /** `web` or `native`. */
  application_type: applicationTypeSchema(),
  /** The stored home page. */
  client_uri: z.string().optional(),
  /** The stored logo. */
  logo_uri: z.string().optional(),
});

/**
 * The dynamic registration response.
 *
 * @stability experimental
 */
export type OAuthRegistrationResponse = z.infer<typeof oauthRegistrationResponseSchema>;

/**
 * One OAuth client in the admin list. Never a secret or its hash.
 *
 * @stability experimental
 */
export const oauthClientViewSchema = z.object({
  /** The row id (`/api/admin/oauth/clients/:id`). */
  id: z.string().uuid(),
  /** The public `client_id`. */
  clientId: z.string(),
  /** How the client came to exist. */
  kind: clientKindSchema(),
  /** The (self-asserted for cimd and dynamic) name. */
  name: z.string(),
  /** The host the trust policy uses. */
  host: z.string(),
  /** The registered redirect URIs. */
  redirectUris: z.array(z.string()),
  /** The authentication method. */
  tokenEndpointAuthMethod: authMethodSchema(),
  /** Active (not revoked) grants. */
  activeGrantCount: z.number().int().nonnegative(),
  /** When the client was last used to complete an authorization, or `null`. */
  lastUsedAt: z.string().datetime().nullable(),
  /** When it was disabled, or `null`. */
  disabledAt: z.string().datetime().nullable(),
  /** Whether it is disabled. */
  disabled: z.boolean(),
  /** When the client first appeared. */
  createdAt: z.string().datetime(),
});

/**
 * An OAuth client in the admin list.
 *
 * @stability experimental
 */
export type OAuthClientView = z.infer<typeof oauthClientViewSchema>;

/**
 * The query of `GET /api/admin/oauth/clients`.
 *
 * @stability experimental
 */
export const oauthClientsQuerySchema = z.object({
  /** 1-based page. */
  page: z.coerce.number().int().min(1).default(1),
  /** Page size. */
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  /** Filter by kind. */
  kind: clientKindSchema().optional(),
  /** Substring of the name or host. */
  search: z.string().max(200).optional(),
});

/**
 * The admin client list query.
 *
 * @stability experimental
 */
export type OAuthClientsQuery = z.infer<typeof oauthClientsQuerySchema>;

/**
 * The body of `POST /api/admin/oauth/clients`: pre-register a client.
 *
 * @stability experimental
 */
export const oauthClientCreateRequestSchema = z.object({
  /** Display name. */
  name: z.string().trim().min(1).max(200),
  /** Redirect URIs: `https:` or loopback `http:`, no fragment, one shared host. */
  redirectUris: z.array(z.string().max(2000)).min(1).max(10),
  /** `none` (public) or a secret-based method (a secret is returned once). */
  tokenEndpointAuthMethod: authMethodSchema().default('none'),
});

/**
 * The pre-registration body.
 *
 * @stability experimental
 */
export type OAuthClientCreateRequest = z.infer<typeof oauthClientCreateRequestSchema>;

/**
 * The response of create and rotate-secret: the client and, once, its secret.
 *
 * @stability experimental
 */
export const oauthClientWithSecretSchema = oauthClientViewSchema.extend({
  /** The secret, shown once; absent for a public client. */
  clientSecret: z.string().optional(),
});

/**
 * A client with its one-time secret.
 *
 * @stability experimental
 */
export type OAuthClientWithSecret = z.infer<typeof oauthClientWithSecretSchema>;

/**
 * The body of `PATCH /api/admin/oauth/clients/:id`.
 *
 * @stability experimental
 */
export const oauthClientPatchRequestSchema = z
  .object({
    /** Disable or re-enable. Disabling revokes the client's grants (`client_disabled`). */
    disabled: z.boolean().optional(),
    /** The `registered` kind only. */
    name: z.string().trim().min(1).max(200).optional(),
    /** The `registered` kind only. */
    redirectUris: z.array(z.string().max(2000)).min(1).max(10).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, { message: 'Send at least one field to change.' });

/**
 * The client patch body.
 *
 * @stability experimental
 */
export type OAuthClientPatchRequest = z.infer<typeof oauthClientPatchRequestSchema>;

/**
 * One client host the trust policy refused, aggregated from the
 * `oauth:client.refused` audit rows (`GET /api/admin/oauth/refused-hosts`).
 *
 * @stability experimental
 */
export const oauthRefusedHostSchema = z.object({
  /** The refused host (lower-case). */
  host: z.string(),
  /** Refusal rows in the window (at most one per host per hour). */
  count: z.number().int().positive(),
  /** ISO 8601 time of the latest refusal. */
  lastSeenAt: z.string().datetime(),
});

/**
 * A refused client host.
 *
 * @stability experimental
 */
export type OAuthRefusedHost = z.infer<typeof oauthRefusedHostSchema>;

/**
 * `GET /api/admin/oauth/policy`: what the app configured for the admin page.
 *
 * @stability experimental
 */
export const oauthPolicySchema = z.object({
  /** The app's `defaultAllowedClientHosts`, offered with "Add" until allowed. */
  suggestedHosts: z.array(z.string()),
});

/**
 * The OAuth admin policy hints.
 *
 * @stability experimental
 */
export type OAuthPolicy = z.infer<typeof oauthPolicySchema>;

/**
 * Query of `GET /api/admin/oauth/grants`.
 *
 * @stability experimental
 */
export const oauthAdminGrantsQuerySchema = z.object({
  /** 1-based page. */
  page: z.coerce.number().int().min(1).default(1),
  /** Page size. */
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  /** Only the grants of this client (the `oauth_clients.id` row id). */
  clientId: z.string().uuid().optional(),
  /** Only the grants of this user. */
  userId: z.string().uuid().optional(),
  /** `true` also lists revoked grants (default: active only). */
  includeRevoked: queryBooleanSchema()
    .default('false')
    .transform((value) => value === 'true'),
});

/**
 * The admin grant list query.
 *
 * @stability experimental
 */
export type OAuthAdminGrantsQuery = z.output<typeof oauthAdminGrantsQuerySchema>;

/**
 * One entry of `GET /api/admin/oauth/grants`: a user's grant to a client. Never a token.
 *
 * @stability experimental
 */
export const oauthAdminGrantViewSchema = z.object({
  /** The grant id (`DELETE /api/admin/oauth/grants/:id`). */
  id: z.string().uuid(),
  /** The consenting user. */
  user: z.object({
    /** The user id. */
    id: z.string().uuid(),
    /** The user's email. */
    email: z.string(),
  }),
  /** The client. */
  client: z.object({
    /** The `oauth_clients.id` row id. */
    id: z.string().uuid(),
    /** The self-asserted name. */
    name: z.string(),
    /** The client's host. */
    host: z.string(),
  }),
  /** The resource it may use. */
  resource: z.object({
    /** The resource id, or `null` when it is no longer registered. */
    id: z.string().nullable(),
    /** The resource's display name. */
    name: z.string(),
  }),
  /** The granted scope ids. */
  scopes: z.array(z.string()),
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
  /** When the grant was revoked, or `null` while active. */
  revokedAt: z.string().datetime().nullable(),
  /** Why it was revoked, or `null` while active. */
  revokedReason: revokedReasonSchema().nullable(),
});

/**
 * A grant as an administrator sees it.
 *
 * @stability experimental
 */
export type OAuthAdminGrantView = z.infer<typeof oauthAdminGrantViewSchema>;
