// =============================================================================
// The invitee's routes: /api/groups/invites/* (issue #728, PP-7.1)
// =============================================================================
//
// ROUTE ORDER. These static paths share the `/api/groups` prefix with the
// `:id` routes of `groups.controller.ts`. `SharingModule.forRoot` registers
// THIS controller first, so `invites/mine` is declared before `:id` (the
// hazard `jobs/job-admin.controller.ts` documents); the mocked integration
// spec proves both are reachable.
//
// `groups:read` on every route: answering your own invitation needs nothing
// more. The invite must name the caller's own (verified) e-mail address.
// =============================================================================

import { Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Type } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';

import type { Principal } from '../../core/index';
import { GroupMembershipResponseDto, MyGroupInviteListResponseDto } from '../dto/groups.dto';
import { SHARING_PERMISSIONS } from '../permissions';
import type { ResolvedSharingModuleOptions } from '../sharing.options';
import { GroupInvitesService } from './group-invites.service';
import { createSharingPrincipalDecorator } from './sharing-principal.decorator';

/**
 * Creates the `GroupInvitesController` class for one set of module options,
 * its routes guarded by the app's access decorators. `SharingModule.forRoot()`
 * calls it.
 *
 * @param options - the resolved module options.
 * @returns the controller class.
 *
 * @stability experimental
 */
export function createGroupInvitesController(options: ResolvedSharingModuleOptions): Type<unknown> {
  const access = options.host.access;
  const CurrentPrincipal = createSharingPrincipalDecorator(options.principal);

  @ApiTags('Groups')
  @Controller('groups/invites')
  class GroupInvitesController {
    constructor(private readonly invites: GroupInvitesService) {}

    @Get('mine')
    @(access.requirePermissions([SHARING_PERMISSIONS.GROUPS_READ]))
    @ApiOperation({
      summary: 'List my pending group invitations',
      description:
        'Pending, unexpired invitations to your own e-mail address, in every organization you belong to, newest ' +
        'first. Accept or decline one by its `id`. Requires `groups:read`.',
    })
    @ApiResponse({ status: 200, type: MyGroupInviteListResponseDto })
    mine(@CurrentPrincipal() principal: Principal) {
      return this.invites.mine(principal);
    }

    @Post(':inviteId/accept')
    @HttpCode(HttpStatus.OK)
    @(access.requirePermissions([SHARING_PERMISSIONS.GROUPS_READ]))
    @ApiParam({ name: 'inviteId', format: 'uuid' })
    @ApiOperation({
      summary: 'Accept a group invitation',
      description:
        'Joins the group with the role the invitation grants (an existing member keeps their role). The invitation ' +
        'must be addressed to your e-mail: any other invitation, an unknown one, or one already accepted, declined ' +
        'or revoked answers **404**. An EXPIRED invitation answers **410** with `details.reason: INVITE_EXPIRED`. ' +
        '409 `GROUP_FULL` when the group is at its member limit. Requires `groups:read`.',
    })
    @ApiResponse({ status: 200, type: GroupMembershipResponseDto })
    @ApiResponse({ status: 404, description: 'No such invitation for your address' })
    @ApiResponse({ status: 410, description: 'The invitation expired (`INVITE_EXPIRED`)' })
    accept(
      @CurrentPrincipal() principal: Principal,
      @Param('inviteId', new ParseUUIDPipe()) inviteId: string,
    ) {
      return this.invites.accept(principal, inviteId);
    }

    @Post(':inviteId/decline')
    @HttpCode(HttpStatus.NO_CONTENT)
    @(access.requirePermissions([SHARING_PERMISSIONS.GROUPS_READ]))
    @ApiParam({ name: 'inviteId', format: 'uuid' })
    @ApiOperation({
      summary: 'Decline a group invitation',
      description:
        'Marks the invitation declined; the address can be invited again. Same refusals as accept: **404** for an ' +
        'invitation that is not yours or no longer pending, **410** `INVITE_EXPIRED`. Requires `groups:read`.',
    })
    @ApiResponse({ status: 204, description: 'Declined' })
    @ApiResponse({ status: 404, description: 'No such invitation for your address' })
    @ApiResponse({ status: 410, description: 'The invitation expired (`INVITE_EXPIRED`)' })
    async decline(
      @CurrentPrincipal() principal: Principal,
      @Param('inviteId', new ParseUUIDPipe()) inviteId: string,
    ): Promise<void> {
      await this.invites.decline(principal, inviteId);
    }
  }

  return GroupInvitesController;
}
