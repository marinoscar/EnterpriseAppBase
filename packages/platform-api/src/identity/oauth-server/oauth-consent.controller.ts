// =============================================================================
// The consent API and the grants API (PP-15.4, docs/specs/oauth-server.md §2.8)
// =============================================================================
//
// Ordinary platform routes (`{ data }` envelope, standard errors) used by the
// web pages of PP-15.7. The consent routes are SESSION ONLY: a person decides
// what a third party may do. The grants routes refuse an `oauth` credential.
// =============================================================================

import { Body, Controller, Delete, Get, HttpCode, HttpStatus, NotFoundException, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';

import type { Principal } from '../../core/index';
import { Auth } from '../auth/decorators/auth.decorator';
import { AuthCredential, type AuthCredentialInfo } from '../auth/decorators/auth-credential.decorator';
import { CurrentPrincipal } from '../auth/decorators/current-principal.decorator';
import { refuseOAuthCredential } from '../auth/refuse-oauth';
import { OAuthAuthorizationService } from './oauth-authorization.service';
import { OAuthGrantService } from './oauth-grant.service';
import { OAuthConsentRequestDto, OAuthDecisionRequestDto, OAuthDecisionResponseDto, OAuthGrantViewDto } from './oauth.dto';
import { OAuthServerSettingsReader } from './oauth-server-settings.reader';
import { requireSessionCredential } from './session-only';

/**
 * The consent page's two calls.
 *
 * @stability experimental
 */
@ApiTags('OAuth server')
@Controller('oauth/requests')
export class OAuthConsentController {
  constructor(private readonly authorization: OAuthAuthorizationService) {}

  @Get(':id')
  @Auth()
  @ApiOperation({
    summary: 'Read a pending authorization request (consent page)',
    description:
      'Session credential ONLY (a personal access token, device credential, node credential or OAuth token is 403). Binds the request to the caller on first read; ' +
      'another user later gets 404. Returns the client (host first), the redirect host, the resource, the requested scopes with `grantable`, `required` and `alreadyGranted`, ' +
      'and the organizations the grant may act in (multi-organization mode). 410 when expired or already decided; 404 while the OAuth server is disabled.',
  })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @ApiResponse({ status: 200, description: 'What the consent page shows.', type: OAuthConsentRequestDto })
  @ApiResponse({ status: 403, description: 'Not a session credential.' })
  @ApiResponse({ status: 404, description: 'Unknown, another user\'s, or the server is disabled.' })
  @ApiResponse({ status: 410, description: 'Expired or already decided.' })
  async read(@Param('id') id: string, @CurrentPrincipal() principal: Principal, @AuthCredential() credential?: AuthCredentialInfo | null) {
    requireSessionCredential(principal, credential);
    return this.authorization.readRequest(id, principal);
  }

  @Post(':id/decision')
  @Auth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Approve or deny a pending authorization request',
    description:
      'Session credential ONLY. `approve` grants the ticked scopes (a subset of the requested ones; a scope the user lacks every permission for is not granted) ' +
      'for the chosen organization (an active membership; default the session\'s), in one transaction: upsert the active grant, insert the authorization code (60 s), mark the request approved. ' +
      '`deny` marks it denied. The response carries `redirectTo`: the client\'s redirect URI with `code`, `state` and `iss`, or with `error=access_denied`.',
  })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Where the page navigates next.', type: OAuthDecisionResponseDto })
  @ApiResponse({ status: 400, description: 'A scope that was not requested, a required scope unticked, or nothing grantable.' })
  @ApiResponse({ status: 403, description: 'Not a session credential, or an organization that is not an active membership.' })
  @ApiResponse({ status: 404, description: 'Unknown, another user\'s, or the server is disabled.' })
  @ApiResponse({ status: 410, description: 'Expired or already decided.' })
  async decide(
    @Param('id') id: string,
    @Body() body: OAuthDecisionRequestDto,
    @CurrentPrincipal() principal: Principal,
    @AuthCredential() credential?: AuthCredentialInfo | null,
  ) {
    requireSessionCredential(principal, credential);
    return this.authorization.decide(id, body, principal);
  }
}

/**
 * Connected apps: the caller's own grants.
 *
 * @stability experimental
 */
@ApiTags('OAuth server')
@Controller('oauth/grants')
export class OAuthGrantsController {
  constructor(
    private readonly grants: OAuthGrantService,
    private readonly settings: OAuthServerSettingsReader,
  ) {}

  @Get()
  @Auth()
  @ApiOperation({
    summary: 'List the apps the caller connected',
    description: 'The caller\'s active grants: client name, host and logo, resource, scopes with titles, dates. Never a token. An OAuth access token is refused (403). 404 while the server is disabled.',
  })
  @ApiResponse({ status: 200, description: 'The active grants.', type: [OAuthGrantViewDto] })
  @ApiResponse({ status: 403, description: 'An OAuth access token cannot list grants.' })
  @ApiResponse({ status: 404, description: 'The OAuth server is not enabled.' })
  async list(@CurrentPrincipal() principal: Principal, @AuthCredential() credential?: AuthCredentialInfo | null) {
    refuseOAuthCredential(credential);
    if (!(await this.settings.isEnabled())) throw new NotFoundException();
    return this.grants.listForUser(principal.userId);
  }

  @Delete(':id')
  @Auth()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Disconnect an app',
    description: 'Revokes the grant and every token of it (`revoked_reason: user`); takes effect on the next request. Audited; emits `identity.oauth.grant.revoked`. 404 for an id that is not the caller\'s.',
  })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @ApiResponse({ status: 204, description: 'Revoked.' })
  @ApiResponse({ status: 403, description: 'An OAuth access token cannot revoke grants.' })
  @ApiResponse({ status: 404, description: 'Not the caller\'s grant, or the server is disabled.' })
  async revoke(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentPrincipal() principal: Principal,
    @AuthCredential() credential?: AuthCredentialInfo | null,
  ): Promise<void> {
    refuseOAuthCredential(credential);
    if (!(await this.settings.isEnabled())) throw new NotFoundException();
    await this.grants.revokeForUser(principal.userId, id);
  }
}
