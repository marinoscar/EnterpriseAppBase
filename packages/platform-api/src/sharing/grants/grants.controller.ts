// =============================================================================
// The grant routes: /api/grants (issue #729, PP-7.2)
// =============================================================================
//
// Every route declares its permission through the app's access decorators
// (there is no global guard); the SHARING rule (the `share` action on the
// record, the grantee removing their own access) is the service's decision,
// inside the request's org-scoped transaction:
//
//   GET    /grants?resourceType&resourceId   sharing:read   `share` on the record, else 404
//   POST   /grants                           sharing:write  `share` on the record
//   GET    /grants/shared-with-me            sharing:read
//   PATCH  /grants/:id                       sharing:write  `share` on the grant's record
//   DELETE /grants/:id                       sharing:read   self; others need sharing:write + `share`
//
// Link grants (#730) get their own routes; these take user and group grantees.
// =============================================================================

import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Query, Type } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';

import type { Principal } from '../../core/index';
import {
  CreateGrantDto,
  GrantListQueryDto,
  GrantListResponseDto,
  GrantResponseDto,
  SharedWithMeListResponseDto,
  SharedWithMeQueryDto,
  UpdateGrantDto,
} from '../dto/grants.dto';
import { createSharingPrincipalDecorator } from '../groups/sharing-principal.decorator';
import { SHARING_PERMISSIONS } from '../permissions';
import type { ResolvedSharingModuleOptions } from '../sharing.options';
import { GrantsService } from './grants.service';

const NOT_FOUND =
  'The record does not exist in your organization, or you may not share it (never 403 for a type that hides existence: an id discloses nothing)';

/**
 * Creates the `GrantsController` class for one set of module options, its
 * routes guarded by the app's access decorators. `SharingModule.forRoot()`
 * calls it.
 *
 * @param options - the resolved module options.
 * @returns the controller class.
 *
 * @stability experimental
 */
export function createGrantsController(options: ResolvedSharingModuleOptions): Type<unknown> {
  const access = options.host.access;
  const CurrentPrincipal = createSharingPrincipalDecorator(options.principal);
  const READ = access.requirePermissions([SHARING_PERMISSIONS.SHARING_READ]);
  const WRITE = access.requirePermissions([SHARING_PERMISSIONS.SHARING_WRITE]);

  @ApiTags('Grants')
  @Controller('grants')
  class GrantsController {
    constructor(private readonly grants: GrantsService) {}

    @Get('shared-with-me')
    @READ
    @ApiOperation({
      summary: 'List what is shared with me',
      description:
        'Records shared with you through an active, unexpired grant to you or to a group of your active ' +
        'organization, newest first, with their `title` and `path` when the resource type describes its records. ' +
        'Optionally one `resourceType`. Flat pagination. Requires `sharing:read`.',
    })
    @ApiResponse({ status: 200, type: SharedWithMeListResponseDto })
    sharedWithMe(@CurrentPrincipal() principal: Principal, @Query() query: SharedWithMeQueryDto) {
      return this.grants.sharedWithMe(principal, query);
    }

    @Get()
    @READ
    @ApiOperation({
      summary: "List a record's grants",
      description:
        'The active user and group grants of one record, oldest first. You must be allowed to share the record ' +
        '(its owner, a group admin of its owning group, or a `sharing:admin` holder, unless the resource type says ' +
        'otherwise); anyone else gets 404. Requires `sharing:read`.',
    })
    @ApiResponse({ status: 200, type: GrantListResponseDto })
    @ApiResponse({ status: 404, description: NOT_FOUND })
    list(@CurrentPrincipal() principal: Principal, @Query() query: GrantListQueryDto) {
      return this.grants.list(principal, query);
    }

    @Post()
    @WRITE
    @ApiOperation({
      summary: 'Share a record',
      description:
        'With a user (by `userId` or `email`; an active member of the organization, 422 `NOT_AN_ORG_MEMBER` ' +
        'otherwise) or a group of the organization (422 `GROUP_NOT_IN_ORG`). A grantee that already holds an ' +
        'active grant on the record gets the new role: one role per grantee. The role must be grantable to that ' +
        'kind of grantee (422 `ROLE_NOT_GRANTABLE`); sharing with yourself is 400 `SELF_GRANT`; past the ' +
        "type's limit, 409 `GRANT_LIMIT_REACHED`. Failed lookups by e-mail are throttled per account (429 " +
        '`LOOKUP_THROTTLED` with `Retry-After`). The user is notified (`sharing.shared_with_you`) when the share is ' +
        'new or its role changed. Requires `sharing:write`.',
    })
    @ApiResponse({ status: 201, type: GrantResponseDto })
    @ApiResponse({ status: 404, description: NOT_FOUND })
    @ApiResponse({ status: 422, description: '`NOT_AN_ORG_MEMBER`, `GROUP_NOT_IN_ORG` or `ROLE_NOT_GRANTABLE`' })
    @ApiResponse({ status: 429, description: '`LOOKUP_THROTTLED`' })
    create(@CurrentPrincipal() principal: Principal, @Body() body: CreateGrantDto) {
      return this.grants.create(principal, body);
    }

    @Patch(':id')
    @WRITE
    @ApiParam({ name: 'id', format: 'uuid' })
    @ApiOperation({
      summary: 'Change a grant',
      description:
        "Its role and/or expiry (`null` removes it). You must be allowed to share the grant's record; anyone else " +
        'gets 404. Requires `sharing:write`.',
    })
    @ApiResponse({ status: 200, type: GrantResponseDto })
    @ApiResponse({ status: 404, description: 'The grant does not exist, is revoked, or you may not manage it' })
    update(@CurrentPrincipal() principal: Principal, @Param('id', new ParseUUIDPipe()) id: string, @Body() body: UpdateGrantDto) {
      return this.grants.update(principal, id, body);
    }

    @Delete(':id')
    @READ
    @HttpCode(HttpStatus.NO_CONTENT)
    @ApiParam({ name: 'id', format: 'uuid' })
    @ApiOperation({
      summary: 'Revoke a grant, or remove your own access',
      description:
        'A grant to you: remove your own access (`sharing:read` is enough). Any other grant needs `sharing:write` ' +
        "and the right to share its record; otherwise 404. The grant is revoked, not deleted (`revokedAt`), and " +
        'access ends on the next request.',
    })
    @ApiResponse({ status: 204, description: 'Revoked' })
    @ApiResponse({ status: 404, description: 'The grant does not exist, is revoked, or you may not manage it' })
    async revoke(@CurrentPrincipal() principal: Principal, @Param('id', new ParseUUIDPipe()) id: string): Promise<void> {
      await this.grants.revoke(principal, id);
    }
  }

  return GrantsController;
}
