// =============================================================================
// /api/admin/oauth/clients (PP-15.5, docs/specs/oauth-server.md §2.8)
// =============================================================================
//
// Ordinary platform routes (`{ data }` envelope, standard errors). Reads need
// `oauth_clients:read`, every write `oauth_clients:write`. Available whether or
// not the OAuth server is switched on: this is where an administrator prepares it.
// =============================================================================

import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';

import { ApiDataResponse } from '../../../core/index';
import { Auth } from '../../auth/decorators/auth.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { PERMISSIONS } from '../../identity.constants';
import { OAuthClientCreateRequestDto, OAuthClientPatchRequestDto, OAuthClientViewDto, OAuthClientWithSecretDto, OAuthClientsQueryDto } from '../oauth.dto';
import { OAuthClientsAdminService } from './oauth-clients-admin.service';

/**
 * The admin API of OAuth clients.
 *
 * @stability experimental
 */
@ApiTags('OAuth clients')
@Controller('admin/oauth/clients')
export class OAuthClientsAdminController {
  constructor(private readonly clients: OAuthClientsAdminService) {}

  @Get()
  @Auth({ permissions: [PERMISSIONS.OAUTH_CLIENTS_READ] })
  @ApiOperation({ summary: 'List OAuth clients (Admin only)', description: 'Paged: kind, name, host, redirect URIs, active grant count, last used and disabled state. Never a secret.' })
  @ApiDataResponse(OAuthClientViewDto, { pagination: 'flat', description: 'A page of clients' })
  list(@Query() query: OAuthClientsQueryDto) {
    return this.clients.list(query);
  }

  @Post()
  @Auth({ permissions: [PERMISSIONS.OAUTH_CLIENTS_WRITE] })
  @ApiOperation({ summary: 'Pre-register an OAuth client (Admin only)', description: 'Returns the client id and, for a confidential client, its secret ONCE.' })
  @ApiDataResponse(OAuthClientWithSecretDto, { status: 201, description: 'The client and its one-time secret' })
  @ApiResponse({ status: 400, description: 'A redirect URI rule was violated.' })
  create(@Body() dto: OAuthClientCreateRequestDto, @CurrentUser('id') adminUserId: string) {
    return this.clients.create(dto, adminUserId);
  }

  @Patch(':id')
  @Auth({ permissions: [PERMISSIONS.OAUTH_CLIENTS_WRITE] })
  @ApiOperation({
    summary: 'Disable, enable or edit an OAuth client (Admin only)',
    description: '`disabled` for any client (disabling revokes its grants with reason `client_disabled`, so its tokens fail on the next call); name and redirect URIs for the `registered` kind only.',
  })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @ApiDataResponse(OAuthClientViewDto, { description: 'The updated client' })
  @ApiResponse({ status: 404, description: 'Client not found' })
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: OAuthClientPatchRequestDto, @CurrentUser('id') adminUserId: string) {
    return this.clients.update(id, dto, adminUserId);
  }

  @Post(':id/rotate-secret')
  @Auth({ permissions: [PERMISSIONS.OAUTH_CLIENTS_WRITE] })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Rotate a client secret (Admin only)', description: 'Returns the new secret ONCE; the old one stops working at once.' })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @ApiDataResponse(OAuthClientWithSecretDto, { description: 'The client and its new secret' })
  @ApiResponse({ status: 400, description: 'A public client has no secret.' })
  @ApiResponse({ status: 404, description: 'Client not found' })
  rotateSecret(@Param('id', ParseUUIDPipe) id: string, @CurrentUser('id') adminUserId: string) {
    return this.clients.rotateSecret(id, adminUserId);
  }

  @Delete(':id')
  @Auth({ permissions: [PERMISSIONS.OAUTH_CLIENTS_WRITE] })
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete an OAuth client (Admin only)', description: 'Its grants, codes, tokens and pending requests are deleted with it.' })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @ApiResponse({ status: 204, description: 'Client deleted' })
  @ApiResponse({ status: 404, description: 'Client not found' })
  async remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser('id') adminUserId: string) {
    await this.clients.remove(id, adminUserId);
  }
}
