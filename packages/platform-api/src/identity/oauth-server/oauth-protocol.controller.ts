// =============================================================================
// The OAuth protocol endpoints (PP-15.4, docs/specs/oauth-server.md §2.8)
// =============================================================================
//
// Metadata, authorize, token and revoke. Every route here is `@Public()` ON
// PURPOSE: a third-party client calls them with no session, and each one
// authenticates the caller itself (client authentication at `/token` and
// `/revoke`; the signed-in user at the consent page, which is a different route).
//
// Wire formats are the RFCs', not the platform's: `@RawResponse()` keeps the
// `{ data }` envelope off the success bodies, and `OAuthProtocolExceptionFilter`
// answers `{ error, error_description }`. While the server is not enabled every
// route is a `404`, except `/authorize`, which sends the person to the web error
// page (somebody is looking at it).
// =============================================================================

import { Controller, Get, Header, Headers, HttpCode, HttpStatus, NotFoundException, Options, Post, Query, Req, Res, UseFilters, Body } from '@nestjs/common';
import { ApiBody, ApiConsumes, ApiExcludeEndpoint, ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { FastifyReply, FastifyRequest } from 'fastify';

import { RawResponse } from '../../core/index';
import { Public } from '../auth/decorators/public.decorator';
import { OAuthAuthorizationService } from './oauth-authorization.service';
import { ClientRegistrationService } from './clients/client-registration.service';
import { buildAuthorizationServerMetadata } from './oauth-metadata';
import { availableScopes, oauthScopeRegistry } from './oauth-scope.registry';
import { OAuthErrorResponseDto, OAuthRegistrationRequestDto, OAuthRegistrationResponseDto, OAuthTokenRequestDto, OAuthTokenResponseDto } from './oauth.dto';
import { oauthError, rateLimited } from './oauth-protocol.error';
import { OAuthProtocolExceptionFilter } from './oauth-protocol.filter';
import { OAuthRateLimitService } from './oauth-rate-limiter';
import { OAUTH_RATE_LIMITS } from './oauth-server.constants';
import { OAuthServerContext, OAuthServerFeatures } from './oauth-server-context';
import { OAuthServerSettingsReader } from './oauth-server-settings.reader';
import { OAuthTokenService, parseOAuthForm } from './oauth-token.service';

const FORM = 'application/x-www-form-urlencoded';

/** The `/token` and `/revoke` requests must be form-encoded: anything else is `400 invalid_request`. */
function requireFormBody(request: FastifyRequest): void {
  const contentType = String(request.headers['content-type'] ?? '').toLowerCase();
  if (!contentType.startsWith(FORM)) throw oauthError('invalid_request', 'The request body must be application/x-www-form-urlencoded.');
}

/**
 * Metadata, authorize, token and revoke.
 *
 * @stability experimental
 */
@ApiTags('OAuth server')
@Controller('oauth')
@UseFilters(OAuthProtocolExceptionFilter)
export class OAuthProtocolController {
  constructor(
    private readonly authorization: OAuthAuthorizationService,
    private readonly tokens: OAuthTokenService,
    private readonly settings: OAuthServerSettingsReader,
    private readonly context: OAuthServerContext,
    private readonly features: OAuthServerFeatures,
    private readonly limiter: OAuthRateLimitService,
    private readonly registration: ClientRegistrationService,
  ) {}

  private async requireEnabled(): Promise<void> {
    if (!(await this.settings.isEnabled())) throw new NotFoundException();
  }

  // PUBLIC: RFC 8414 discovery. A client has no credential before it has read this document.
  @Public()
  @Get('.well-known/authorization-server')
  @RawResponse()
  @Header('Cache-Control', 'public, max-age=300')
  @Header('Access-Control-Allow-Origin', '*')
  @ApiOperation({
    summary: 'Authorization server metadata',
    description:
      'The RFC 8414 document. Published at the root as `/.well-known/oauth-authorization-server` by the nginx fragment. `issuer` is `APP_URL` without a trailing slash; ' +
      '`registration_endpoint` and `client_id_metadata_document_supported` appear only while their setting is on and a route serves them. 404 while the server is disabled.',
  })
  @ApiResponse({ status: 200, description: 'The metadata document (not enveloped).' })
  @ApiResponse({ status: 404, description: 'The OAuth server is not enabled.' })
  async metadata() {
    await this.requireEnabled();
    return buildAuthorizationServerMetadata({
      issuer: this.context.issuer(),
      settings: await this.settings.read(),
      hasDynamicClientRegistration: this.features.hasDynamicClientRegistration,
      hasClientIdMetadataDocuments: this.features.hasClientIdMetadataDocuments,
      availableScopeIds: await availableScopes(oauthScopeRegistry.ids(), {}),
    });
  }

  // PUBLIC: the entry point of the authorization code flow. A browser arrives here from a third-party client
  // with no session; the session is needed only at the consent page that this route redirects to.
  @Public()
  @Get('authorize')
  @ApiOperation({
    summary: 'Start an authorization (OAuth 2.1 authorization code with PKCE)',
    description:
      'Validates the request in this order: server enabled, client, redirect URI, `response_type=code`, PKCE `S256`, `resource`, scopes. ' +
      'A disabled server, an unknown client or a bad redirect URI is a 302 to the web error page `/oauth/error?code=...` and NEVER a redirect to `redirect_uri`. ' +
      'From the `response_type` check on, an error is a 302 to `redirect_uri` with `error`, `error_description`, `state` and `iss`. ' +
      'On success: a pending request (10 minutes) and a 302 to `/oauth/consent?request=<id>`. Rate limited per source address (30 per minute).',
  })
  @ApiQuery({ name: 'response_type', required: true, description: 'Must be `code`.' })
  @ApiQuery({ name: 'client_id', required: true })
  @ApiQuery({ name: 'redirect_uri', required: true, description: 'Must match a registered redirect URI (loopback ports are ignored).' })
  @ApiQuery({ name: 'scope', required: false, description: 'Space-separated scope ids; none means the resource\'s default scopes.' })
  @ApiQuery({ name: 'state', required: false })
  @ApiQuery({ name: 'code_challenge', required: true, description: 'PKCE challenge: BASE64URL(SHA256(verifier)).' })
  @ApiQuery({ name: 'code_challenge_method', required: true, description: 'Must be `S256`.' })
  @ApiQuery({ name: 'resource', required: true, description: 'RFC 8707: the identifier of a registered protected resource.' })
  @ApiResponse({ status: 302, description: 'Redirect to the consent page, the web error page, or the client\'s redirect URI with an error.' })
  @ApiResponse({ status: 429, description: 'Rate limited.', type: OAuthErrorResponseDto })
  async authorize(@Query() query: Record<string, unknown>, @Req() request: FastifyRequest, @Res() reply: FastifyReply): Promise<void> {
    const spec = OAUTH_RATE_LIMITS.authorizePerAddress;
    const verdict = await this.limiter.consume(`oauth:authorize:${request.ip}`, spec.limit, spec.windowMs);
    if (!verdict.allowed) throw rateLimited(verdict.retryAfterSeconds);
    const location = await this.authorization.authorize(query);
    // The Referrer-Policy keeps the (opaque) request id and any code out of third-party referrers.
    void reply.status(HttpStatus.FOUND).header('location', location).header('cache-control', 'no-store').header('referrer-policy', 'no-referrer').send();
  }

  // PUBLIC: RFC 6749 §3.2. The client authenticates INSIDE the handler (none, client_secret_post or client_secret_basic).
  @Public()
  @Post('token')
  @HttpCode(HttpStatus.OK)
  @RawResponse()
  @Header('Cache-Control', 'no-store')
  @Header('Pragma', 'no-cache')
  @Header('Access-Control-Allow-Origin', '*')
  @ApiOperation({
    summary: 'Token endpoint',
    description:
      'Exchanges an authorization code (`grant_type=authorization_code` with `code`, `redirect_uri`, `code_verifier`, `client_id`, optional `resource`) ' +
      'or rotates a refresh token (`grant_type=refresh_token` with `refresh_token`, `client_id`, optional narrower `scope`). The body is ' +
      '`application/x-www-form-urlencoded` ONLY (JSON is `400 invalid_request`), at most 16 KiB. A confidential client authenticates by `client_secret_post` ' +
      'or `client_secret_basic`, per its registration; a failure is `401 invalid_client` with `WWW-Authenticate: Basic`. A refresh token presented again after its rotation ' +
      'is reuse and revokes the grant, except for a 10-second grace window that answers a client retrying a lost response with a new pair. ' +
      'Errors are RFC 6749 JSON, not the platform error body. Rate limited per client id (60 per minute): 429 `temporarily_unavailable` with `Retry-After`.',
  })
  @ApiConsumes(FORM)
  @ApiBody({ type: OAuthTokenRequestDto })
  @ApiResponse({ status: 200, description: 'The tokens (RFC 6749 §5.1), not enveloped. `Cache-Control: no-store`.', type: OAuthTokenResponseDto })
  @ApiResponse({ status: 400, description: '`invalid_request`, `invalid_grant`, `unsupported_grant_type` or `invalid_scope`.', type: OAuthErrorResponseDto })
  @ApiResponse({ status: 401, description: '`invalid_client`.', type: OAuthErrorResponseDto })
  @ApiResponse({ status: 404, description: 'The OAuth server is not enabled.' })
  @ApiResponse({ status: 429, description: '`temporarily_unavailable`.', type: OAuthErrorResponseDto })
  async token(@Body() body: unknown, @Headers('authorization') authorization: string | undefined, @Req() request: FastifyRequest) {
    await this.requireEnabled();
    requireFormBody(request);
    return this.tokens.token(parseOAuthForm(body), authorization);
  }

  // PUBLIC: RFC 7591. Anyone may try to register, so the trust policy and a per-address rate limit decide.
  @Public()
  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  @RawResponse()
  @Header('Cache-Control', 'no-store')
  @Header('Pragma', 'no-cache')
  @Header('Access-Control-Allow-Origin', '*')
  @ApiOperation({
    summary: 'Dynamic client registration (RFC 7591)',
    description:
      'JSON body with `redirect_uris` (required, at most 10), `client_name`, `client_uri`, `logo_uri`, `token_endpoint_auth_method` (`none` default, `client_secret_post`, `client_secret_basic`), ' +
      '`grant_types`, `response_types`, `application_type` (`web` or `native`) and `scope`; unknown fields are ignored. Redirect URIs are `https:` or loopback `http:` with no fragment and share one host; ' +
      'a custom scheme needs `application_type: native` and a reverse-domain scheme. The host trust policy runs here: a host that is not allowed is `403 invalid_client_metadata`. ' +
      'A public client that registers again with exactly the same redirect URIs, name and host gets the existing client back. `404` while dynamic registration is off or the server is disabled. ' +
      'Rate limited: 10 per hour per source address (`429`). The `client_secret` of a confidential client is returned once and stored hashed.',
  })
  @ApiBody({ type: OAuthRegistrationRequestDto })
  @ApiResponse({ status: 201, description: 'The registered client (RFC 7591 §3.2.1), not enveloped.', type: OAuthRegistrationResponseDto })
  @ApiResponse({ status: 400, description: '`invalid_redirect_uri` or `invalid_client_metadata`.', type: OAuthErrorResponseDto })
  @ApiResponse({ status: 403, description: '`invalid_client_metadata`: the host is not allowed on this deployment.', type: OAuthErrorResponseDto })
  @ApiResponse({ status: 404, description: 'Dynamic registration is off, or the OAuth server is not enabled.' })
  @ApiResponse({ status: 429, description: '`temporarily_unavailable`.', type: OAuthErrorResponseDto })
  async register(@Body() body: unknown, @Req() request: FastifyRequest) {
    await this.requireEnabled();
    if (!(await this.settings.read()).dynamicClientRegistration) throw new NotFoundException();
    const spec = OAUTH_RATE_LIMITS.registerPerAddress;
    const verdict = await this.limiter.consume(`oauth:register:${request.ip}`, spec.limit, spec.windowMs);
    if (!verdict.allowed) throw rateLimited(verdict.retryAfterSeconds);
    const contentType = String(request.headers['content-type'] ?? '').toLowerCase();
    if (!contentType.startsWith('application/json')) throw oauthError('invalid_client_metadata', 'The request body must be application/json.');
    return this.registration.register(body);
  }

  // PUBLIC: RFC 7009. Client authentication happens in the handler, as for the token endpoint.
  @Public()
  @Post('revoke')
  @HttpCode(HttpStatus.OK)
  @RawResponse()
  @Header('Cache-Control', 'no-store')
  @Header('Access-Control-Allow-Origin', '*')
  @ApiOperation({
    summary: 'Revoke a token (RFC 7009)',
    description:
      'Form fields `token`, optional `token_type_hint`, and client authentication as for the token endpoint. Revoking a refresh token revokes its grant; ' +
      'revoking an access token revokes that token. Always `200` with an empty body, including for an unknown token; `401 invalid_client` when a confidential client fails authentication. ' +
      'Rate limited per client id (60 per minute).',
  })
  @ApiConsumes(FORM)
  @ApiBody({
    schema: {
      type: 'object',
      required: ['token'],
      properties: {
        token: { type: 'string' },
        token_type_hint: { type: 'string', enum: ['access_token', 'refresh_token'] },
        client_id: { type: 'string' },
        client_secret: { type: 'string' },
      },
    },
  })
  @ApiResponse({ status: 200, description: 'Revoked, or nothing to revoke. Empty body.' })
  @ApiResponse({ status: 401, description: '`invalid_client`.', type: OAuthErrorResponseDto })
  @ApiResponse({ status: 404, description: 'The OAuth server is not enabled.' })
  @ApiResponse({ status: 429, description: '`temporarily_unavailable`.', type: OAuthErrorResponseDto })
  async revoke(@Body() body: unknown, @Headers('authorization') authorization: string | undefined, @Req() request: FastifyRequest): Promise<void> {
    await this.requireEnabled();
    requireFormBody(request);
    await this.tokens.revoke(parseOAuthForm(body), authorization);
  }

  // PUBLIC: CORS preflight of a browser-based client. The endpoints take no cookie, so the wildcard is safe (spec §3).
  @Public()
  @Options('token')
  @RawResponse()
  @HttpCode(HttpStatus.NO_CONTENT)
  @Header('Access-Control-Allow-Origin', '*')
  @Header('Access-Control-Allow-Methods', 'POST, OPTIONS')
  @Header('Access-Control-Allow-Headers', 'content-type, authorization')
  @Header('Access-Control-Max-Age', '600')
  @ApiExcludeEndpoint()
  preflightToken(): void {
    // Headers only.
  }

  // PUBLIC: CORS preflight of `/register`, as above.
  @Public()
  @Options('register')
  @RawResponse()
  @HttpCode(HttpStatus.NO_CONTENT)
  @Header('Access-Control-Allow-Origin', '*')
  @Header('Access-Control-Allow-Methods', 'POST, OPTIONS')
  @Header('Access-Control-Allow-Headers', 'content-type, authorization')
  @Header('Access-Control-Max-Age', '600')
  @ApiExcludeEndpoint()
  preflightRegister(): void {
    // Headers only.
  }

  // PUBLIC: CORS preflight, as above.
  @Public()
  @Options('revoke')
  @RawResponse()
  @HttpCode(HttpStatus.NO_CONTENT)
  @Header('Access-Control-Allow-Origin', '*')
  @Header('Access-Control-Allow-Methods', 'POST, OPTIONS')
  @Header('Access-Control-Allow-Headers', 'content-type, authorization')
  @Header('Access-Control-Max-Age', '600')
  @ApiExcludeEndpoint()
  preflightRevoke(): void {
    // Headers only.
  }
}
