import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiParam, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Principal } from '../../core/index';

import { Auth } from '../auth/decorators/auth.decorator';
import { CurrentPrincipal } from '../auth/decorators/current-principal.decorator';
import { ApiDataResponse } from '../../core/index';
import { PERMISSIONS } from '../identity.constants';
import { OrgInvitesService } from './org-invites.service';
import { requireActiveOrgId } from './org-admin.common';
import {
  CreateOrgInviteDto,
  OrgInviteListQueryDto,
  OrgInviteResponseDto,
} from './dto/org-invite.dto';

/**
 * Invitations to the caller's ACTIVE organization (#726, PP-6.7). Every
 * route acts on `principal.activeOrgId`; no route takes an org id.
 */
@ApiTags('Organizations')
@Controller('org/invites')
export class OrgInvitesController {
  constructor(private readonly invites: OrgInvitesService) {}

  @Get()
  @Auth({ permissions: [PERMISSIONS.ORG_INVITES_READ] })
  @ApiOperation({
    summary: "List the active organization's invitations",
    description:
      'Pending, accepted, revoked and expired invitations, newest first. Pending invitations past their ' +
      'expiry are marked `expired` when this list is read.',
  })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'pageSize', required: false, type: Number })
  @ApiQuery({ name: 'status', required: false, enum: ['all', 'pending', 'accepted', 'revoked', 'expired'] })
  @ApiDataResponse(OrgInviteResponseDto, { pagination: 'flat', description: 'Paginated invitations' })
  async list(@Query() query: OrgInviteListQueryDto, @CurrentPrincipal() principal: Principal) {
    return this.invites.list(requireActiveOrgId(principal), query);
  }

  @Post()
  @Auth({ permissions: [PERMISSIONS.ORG_INVITES_WRITE] })
  @ApiOperation({
    summary: 'Invite someone to the active organization',
    description:
      'Creates (or renews) a pending invitation with an org role, valid for 14 days, and adds the address to ' +
      'the allowlist so the invitee can sign in. Signing in with that address accepts it. The `org.invitation` ' +
      'email goes to the invitee after the write commits; the notes are never sent. Re-inviting a pending ' +
      'address updates its role; an address that already accepted, or is already a member, is a 409. Writes ' +
      'the `org:invite_created` audit event.',
  })
  @ApiDataResponse(OrgInviteResponseDto, { status: 201, description: 'The invitation' })
  @ApiResponse({ status: 409, description: 'Already a member, or the invitation was already accepted' })
  async create(@Body() dto: CreateOrgInviteDto, @CurrentPrincipal() principal: Principal) {
    return this.invites.create(principal.userId, requireActiveOrgId(principal), dto);
  }

  @Delete(':id')
  @Auth({ permissions: [PERMISSIONS.ORG_INVITES_WRITE] })
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Revoke an invitation',
    description:
      'Marks a pending invitation of the active organization `revoked` (a no-op for a revoked or expired ' +
      'one). An accepted invitation cannot be revoked (409): remove the member instead. Writes the ' +
      '`org:invite_revoked` audit event.',
  })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @ApiResponse({ status: 204, description: 'Invitation revoked' })
  @ApiResponse({ status: 404, description: 'No such invitation in the active organization' })
  @ApiResponse({ status: 409, description: 'The invitation was already accepted' })
  async revoke(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentPrincipal() principal: Principal,
  ): Promise<void> {
    await this.invites.revoke(principal.userId, requireActiveOrgId(principal), id);
  }
}
