// =============================================================================
// The group routes: /api/groups (issue #728, PP-7.1)
// =============================================================================
//
// Every route declares its permission through the app's access decorators
// (there is no global guard); the GROUP rule (member, group admin, the
// `groups:admin` override) is the services' decision, inside the request's
// org-scoped transaction:
//
//   GET    /groups                        groups:read (scope=all: + groups:admin)
//   POST   /groups                        groups:write
//   GET    /groups/:id                    groups:read   member or groups:admin, else 404
//   PATCH  /groups/:id                    groups:write  group admin or groups:admin
//   DELETE /groups/:id                    groups:write  group admin or groups:admin
//   GET    /groups/:id/members            groups:read   member or groups:admin
//   POST   /groups/:id/members            groups:write  group admin
//   PATCH  /groups/:id/members/:userId    groups:write  group admin
//   DELETE /groups/:id/members/:userId    groups:read   self; others need groups:write + group admin
//   GET    /groups/:id/invites            groups:read   group admin
//   POST   /groups/:id/invites            groups:write  group admin
//   DELETE /groups/:id/invites/:inviteId  groups:write  group admin
// =============================================================================

import { Body, Controller, Delete, Get, Headers, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Query, Type } from '@nestjs/common';
import { ApiHeader, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';

import type { Principal } from '../../core/index';
import {
  AddGroupMemberDto,
  CreateGroupDto,
  CreateGroupInviteDto,
  GroupInviteListQueryDto,
  GroupInviteListResponseDto,
  GroupInviteResponseDto,
  GroupListQueryDto,
  GroupListResponseDto,
  GroupMemberListResponseDto,
  GroupMemberResponseDto,
  GroupResponseDto,
  PageQueryDto,
  UpdateGroupDto,
  UpdateGroupMemberDto,
} from '../dto/groups.dto';
import { SHARING_PERMISSIONS } from '../permissions';
import type { ResolvedSharingModuleOptions } from '../sharing.options';
import { parseIfMatch } from './group-common';
import { GroupInvitesService } from './group-invites.service';
import { GroupMembershipService } from './group-membership.service';
import { GroupsService } from './groups.service';
import { createSharingPrincipalDecorator } from './sharing-principal.decorator';

const NOT_FOUND = 'The group does not exist in your organization, or you are not a member (never 403: an id discloses nothing)';

/**
 * Creates the `GroupsController` class for one set of module options, its
 * routes guarded by the app's access decorators. `SharingModule.forRoot()`
 * calls it.
 *
 * @param options - the resolved module options.
 * @returns the controller class.
 *
 * @stability experimental
 */
export function createGroupsController(options: ResolvedSharingModuleOptions): Type<unknown> {
  const access = options.host.access;
  const CurrentPrincipal = createSharingPrincipalDecorator(options.principal);
  const READ = access.requirePermissions([SHARING_PERMISSIONS.GROUPS_READ]);
  const WRITE = access.requirePermissions([SHARING_PERMISSIONS.GROUPS_WRITE]);

  @ApiTags('Groups')
  @Controller('groups')
  class GroupsController {
    constructor(
      private readonly groups: GroupsService,
      private readonly members: GroupMembershipService,
      private readonly invites: GroupInvitesService,
    ) {}

    // ---- groups -----------------------------------------------------------------

    @Get()
    @READ
    @ApiOperation({
      summary: 'List groups',
      description:
        '`scope=mine` (default): the groups of your active organization you belong to. `scope=all`: every group ' +
        'of the organization, which also needs `groups:admin` (403 otherwise). Flat pagination, by name.',
    })
    @ApiResponse({ status: 200, type: GroupListResponseDto })
    list(@CurrentPrincipal() principal: Principal, @Query() query: GroupListQueryDto) {
      return this.groups.list(principal, query);
    }

    @Post()
    @WRITE
    @ApiOperation({
      summary: 'Create a group',
      description:
        'Creates a group in your active organization and makes you its `admin`, in one transaction. 409 ' +
        '`GROUP_LIMIT_REACHED` past the per-creator limit. Requires `groups:write`.',
    })
    @ApiResponse({ status: 201, type: GroupResponseDto })
    create(@CurrentPrincipal() principal: Principal, @Body() body: CreateGroupDto) {
      return this.groups.create(principal, body);
    }

    @Get(':id')
    @READ
    @ApiParam({ name: 'id', format: 'uuid' })
    @ApiOperation({
      summary: 'Get a group',
      description: 'For a member of the group or a `groups:admin` holder. Anyone else gets 404, never 403. Requires `groups:read`.',
    })
    @ApiResponse({ status: 200, type: GroupResponseDto })
    @ApiResponse({ status: 404, description: NOT_FOUND })
    get(@CurrentPrincipal() principal: Principal, @Param('id', new ParseUUIDPipe()) id: string) {
      return this.groups.get(principal, id);
    }

    @Patch(':id')
    @WRITE
    @ApiParam({ name: 'id', format: 'uuid' })
    @ApiHeader({ name: 'If-Match', required: false, description: "The group's `version`; a stale one answers 409 `VERSION_CONFLICT`." })
    @ApiOperation({
      summary: 'Update a group',
      description:
        'Name, description or metadata. For a group `admin` or a `groups:admin` holder (a member with another role ' +
        'gets 403, anyone else 404). Send the `version` in `If-Match`. Requires `groups:write`.',
    })
    @ApiResponse({ status: 200, type: GroupResponseDto })
    update(
      @CurrentPrincipal() principal: Principal,
      @Param('id', new ParseUUIDPipe()) id: string,
      @Body() body: UpdateGroupDto,
      @Headers('if-match') ifMatch?: string,
    ) {
      return this.groups.update(principal, id, body, parseIfMatch(ifMatch));
    }

    @Delete(':id')
    @WRITE
    @HttpCode(HttpStatus.NO_CONTENT)
    @ApiParam({ name: 'id', format: 'uuid' })
    @ApiOperation({
      summary: 'Delete a group',
      description:
        'Removes the group with its members and invitations. Refused with 409 `GROUP_OWNS_RESOURCES` (and ' +
        '`details.counts`, per resource type) while the group still owns resources. For a group `admin` or a ' +
        '`groups:admin` holder. Requires `groups:write`.',
    })
    @ApiResponse({ status: 204, description: 'Deleted' })
    @ApiResponse({ status: 409, description: '`GROUP_OWNS_RESOURCES`, with `details.counts`' })
    async delete(@CurrentPrincipal() principal: Principal, @Param('id', new ParseUUIDPipe()) id: string): Promise<void> {
      await this.groups.delete(principal, id);
    }

    // ---- members ----------------------------------------------------------------

    @Get(':id/members')
    @READ
    @ApiParam({ name: 'id', format: 'uuid' })
    @ApiOperation({ summary: 'List the members of a group', description: 'Admins first. For a member or a `groups:admin` holder. Requires `groups:read`.' })
    @ApiResponse({ status: 200, type: GroupMemberListResponseDto })
    listMembers(@CurrentPrincipal() principal: Principal, @Param('id', new ParseUUIDPipe()) id: string, @Query() query: PageQueryDto) {
      return this.members.list(principal, id, query);
    }

    @Post(':id/members')
    @WRITE
    @ApiParam({ name: 'id', format: 'uuid' })
    @ApiOperation({
      summary: 'Add a member to a group',
      description:
        'By `userId` or `email`; the person must be an active member of the organization (422 `NOT_AN_ORG_MEMBER` ' +
        'otherwise, for an unknown address too). Failed lookups by e-mail are throttled per account (10 per 10 ' +
        'minutes, approximate across replicas): past that, 429 `LOOKUP_THROTTLED` with `details.retryAfterMs` and ' +
        '`Retry-After`. 409 `ALREADY_A_MEMBER` or `GROUP_FULL`. For a group `admin`. Requires `groups:write`.',
    })
    @ApiResponse({ status: 201, type: GroupMemberResponseDto })
    @ApiResponse({ status: 422, description: '`NOT_AN_ORG_MEMBER`' })
    @ApiResponse({ status: 429, description: '`LOOKUP_THROTTLED`' })
    addMember(@CurrentPrincipal() principal: Principal, @Param('id', new ParseUUIDPipe()) id: string, @Body() body: AddGroupMemberDto) {
      return this.members.add(principal, id, body);
    }

    @Patch(':id/members/:userId')
    @WRITE
    @ApiParam({ name: 'id', format: 'uuid' })
    @ApiParam({ name: 'userId', format: 'uuid' })
    @ApiOperation({
      summary: "Change a member's role",
      description:
        'The last `admin` cannot be demoted: 409 `LAST_GROUP_ADMIN` (promote another member first). For a group ' +
        '`admin`. Requires `groups:write`.',
    })
    @ApiResponse({ status: 200, type: GroupMemberResponseDto })
    @ApiResponse({ status: 409, description: '`LAST_GROUP_ADMIN`' })
    changeRole(
      @CurrentPrincipal() principal: Principal,
      @Param('id', new ParseUUIDPipe()) id: string,
      @Param('userId', new ParseUUIDPipe()) userId: string,
      @Body() body: UpdateGroupMemberDto,
    ) {
      return this.members.changeRole(principal, id, userId, body.role);
    }

    @Delete(':id/members/:userId')
    @READ
    @HttpCode(HttpStatus.NO_CONTENT)
    @ApiParam({ name: 'id', format: 'uuid' })
    @ApiParam({ name: 'userId', format: 'uuid' })
    @ApiOperation({
      summary: 'Leave a group, or remove a member',
      description:
        'With your own `userId`: leave the group (`groups:read` is enough). Anyone else: needs `groups:write` (403 ' +
        'otherwise) and the group `admin` role. The last `admin` cannot leave: 409 `LAST_GROUP_ADMIN`.',
    })
    @ApiResponse({ status: 204, description: 'Removed' })
    @ApiResponse({ status: 409, description: '`LAST_GROUP_ADMIN`' })
    async removeMember(
      @CurrentPrincipal() principal: Principal,
      @Param('id', new ParseUUIDPipe()) id: string,
      @Param('userId', new ParseUUIDPipe()) userId: string,
    ): Promise<void> {
      await this.members.remove(principal, id, userId);
    }

    // ---- invites ----------------------------------------------------------------

    @Get(':id/invites')
    @READ
    @ApiParam({ name: 'id', format: 'uuid' })
    @ApiOperation({ summary: "List a group's invitations", description: '`status=pending` (default) or `all`, newest first. For a group `admin`. Requires `groups:read`.' })
    @ApiResponse({ status: 200, type: GroupInviteListResponseDto })
    listInvites(@CurrentPrincipal() principal: Principal, @Param('id', new ParseUUIDPipe()) id: string, @Query() query: GroupInviteListQueryDto) {
      return this.invites.list(principal, id, query);
    }

    @Post(':id/invites')
    @WRITE
    @ApiParam({ name: 'id', format: 'uuid' })
    @ApiOperation({
      summary: 'Invite an address to a group',
      description:
        'One pending invitation per address (409 `INVITE_PENDING`); a declined or revoked address can be invited ' +
        'again. In a multi-organization deployment the address must belong to a member of the organization or ' +
        'have a pending invitation to it (422 `NOT_AN_ORG_MEMBER`). The invitee is notified (`groups.invitation`). ' +
        'For a group `admin`. Requires `groups:write`.',
    })
    @ApiResponse({ status: 201, type: GroupInviteResponseDto })
    @ApiResponse({ status: 409, description: '`INVITE_PENDING` or `ALREADY_A_MEMBER`' })
    createInvite(@CurrentPrincipal() principal: Principal, @Param('id', new ParseUUIDPipe()) id: string, @Body() body: CreateGroupInviteDto) {
      return this.invites.create(principal, id, body);
    }

    @Delete(':id/invites/:inviteId')
    @WRITE
    @HttpCode(HttpStatus.NO_CONTENT)
    @ApiParam({ name: 'id', format: 'uuid' })
    @ApiParam({ name: 'inviteId', format: 'uuid' })
    @ApiOperation({ summary: 'Revoke a group invitation', description: '409 `INVITE_NOT_PENDING` once answered. For a group `admin`. Requires `groups:write`.' })
    @ApiResponse({ status: 204, description: 'Revoked' })
    async revokeInvite(
      @CurrentPrincipal() principal: Principal,
      @Param('id', new ParseUUIDPipe()) id: string,
      @Param('inviteId', new ParseUUIDPipe()) inviteId: string,
    ): Promise<void> {
      await this.invites.revoke(principal, id, inviteId);
    }
  }

  return GroupsController;
}
