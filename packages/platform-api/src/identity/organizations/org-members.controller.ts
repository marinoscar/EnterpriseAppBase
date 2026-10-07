import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiParam, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Principal } from '../../core/index';

import { Auth } from '../auth/decorators/auth.decorator';
import { CurrentPrincipal } from '../auth/decorators/current-principal.decorator';
import { ApiDataResponse } from '../../core/index';
import { PERMISSIONS } from '../identity.constants';
import { OrgMembersService } from './org-members.service';
import { requireActiveOrgId } from './org-admin.common';
import {
  OrgMemberListQueryDto,
  OrgMemberResponseDto,
  UpdateOrgMemberDto,
} from './dto/org-member.dto';

/**
 * The members of the caller's ACTIVE organization (#726, PP-6.7).
 *
 * Every route acts on `principal.activeOrgId`, the org the presented
 * credential is bound to; no route takes an org id. The permissions are ORG
 * permissions, held through the `org_admin` membership role: the settings
 * card `Organization` (`/admin/settings/organization`) declares exactly
 * `org_members:read`.
 */
@ApiTags('Organizations')
@Controller('org/members')
export class OrgMembersController {
  constructor(private readonly members: OrgMembersService) {}

  @Get()
  @Auth({ permissions: [PERMISSIONS.ORG_MEMBERS_READ] })
  @ApiOperation({
    summary: "List the active organization's members",
    description:
      'Members of the organization the caller\'s credential is bound to (the `org` claim of the access token), ' +
      'with their org role, status and when they were last active in it.',
  })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'pageSize', required: false, type: Number })
  @ApiQuery({ name: 'search', required: false, type: String })
  @ApiQuery({ name: 'status', required: false, enum: ['all', 'active', 'suspended'] })
  @ApiDataResponse(OrgMemberResponseDto, { pagination: 'flat', description: 'Paginated members' })
  async list(@Query() query: OrgMemberListQueryDto, @CurrentPrincipal() principal: Principal) {
    return this.members.list(requireActiveOrgId(principal), query);
  }

  @Patch(':userId')
  @Auth({ permissions: [PERMISSIONS.ORG_MEMBERS_WRITE] })
  @ApiOperation({
    summary: "Change a member's org role or status",
    description:
      'Sets the org role (`org_admin`, `contributor`, `viewer`) and/or the status (`active`, `suspended`) of a ' +
      'member of the active organization. You cannot change your own role or suspend yourself (403), and the ' +
      'organization always keeps at least one active `org_admin` (409, `details.reason: LAST_ORG_ADMIN`). ' +
      'A role change notifies the member (`security.role_changed`). Writes the `org:member_updated` audit event.',
  })
  @ApiParam({ name: 'userId', type: String, format: 'uuid' })
  @ApiDataResponse(OrgMemberResponseDto, { description: 'The updated member' })
  @ApiResponse({ status: 404, description: 'Not a member of the active organization' })
  @ApiResponse({ status: 409, description: 'Would leave the organization without an active org_admin' })
  async update(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body() dto: UpdateOrgMemberDto,
    @CurrentPrincipal() principal: Principal,
  ) {
    return this.members.update(principal.userId, requireActiveOrgId(principal), userId, dto);
  }

  @Delete(':userId')
  @Auth({ permissions: [PERMISSIONS.ORG_MEMBERS_WRITE] })
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Remove a member from the active organization',
    description:
      'Deletes the membership and revokes the member\'s refresh tokens, personal access tokens and device ' +
      'sessions bound to this organization; an access token already issued stops working within the principal ' +
      'cache TTL. You cannot remove yourself (403), nor the last active `org_admin` (409, ' +
      '`details.reason: LAST_ORG_ADMIN`). Writes the `org:member_removed` audit event.',
  })
  @ApiParam({ name: 'userId', type: String, format: 'uuid' })
  @ApiResponse({ status: 204, description: 'Member removed' })
  @ApiResponse({ status: 404, description: 'Not a member of the active organization' })
  @ApiResponse({ status: 409, description: 'Would leave the organization without an active org_admin' })
  async remove(
    @Param('userId', ParseUUIDPipe) userId: string,
    @CurrentPrincipal() principal: Principal,
  ): Promise<void> {
    await this.members.remove(principal.userId, requireActiveOrgId(principal), userId);
  }
}
