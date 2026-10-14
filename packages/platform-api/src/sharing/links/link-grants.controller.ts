// =============================================================================
// The link routes of the sharer: /api/grants/links (issue #730, PP-7.3)
// =============================================================================
//
//   POST /grants/links                        sharing:write  `share_link` (else `share`) on the record
//   GET  /grants/links?resourceType&resourceId sharing:read   the same action, else 404
//
// Changing and revoking a link are the generic `PATCH` / `DELETE
// /api/grants/:id` (grants.controller.ts). This controller is registered
// BEFORE the grants controller, so its static `links` path is matched first.
// =============================================================================

import { Body, Controller, Get, Post, Query, Type } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

import type { Principal } from '../../core/index';
import { CreateLinkGrantDto, IssuedLinkGrantResponseDto, LinkGrantListQueryDto, LinkGrantListResponseDto } from '../dto/link-grants.dto';
import { createSharingPrincipalDecorator } from '../groups/sharing-principal.decorator';
import { SHARING_PERMISSIONS } from '../permissions';
import type { ResolvedSharingModuleOptions } from '../sharing.options';
import { LinkGrantsService } from './link-grants.service';

const NOT_FOUND =
  'The record does not exist in your organization, or you may not share it by link (an id discloses nothing)';

/**
 * Creates the `LinkGrantsController` class for one set of module options, its
 * routes guarded by the app's access decorators. `SharingModule.forRoot()`
 * calls it.
 *
 * @param options - the resolved module options.
 * @returns the controller class.
 *
 * @stability experimental
 */
export function createLinkGrantsController(options: ResolvedSharingModuleOptions): Type<unknown> {
  const access = options.host.access;
  const CurrentPrincipal = createSharingPrincipalDecorator(options.principal);
  const READ = access.requirePermissions([SHARING_PERMISSIONS.SHARING_READ]);
  const WRITE = access.requirePermissions([SHARING_PERMISSIONS.SHARING_WRITE]);

  @ApiTags('Grants')
  @Controller('grants/links')
  class LinkGrantsController {
    constructor(private readonly links: LinkGrantsService) {}

    @Post()
    @WRITE
    @ApiOperation({
      summary: 'Create a share link',
      description:
        'Shares one record with anyone holding the link, with a role its resource type grants to links (`role` ' +
        'absent: the weakest; a type that grants links no role answers 422 `ROLE_NOT_GRANTABLE`). The response ' +
        'carries the link URL (`<APP_URL>/s#lnk_...`: the token rides in the URL fragment, which a browser never ' +
        'sends) and the token ONCE; the API stores only its hash and its ciphertext. `expiresAt` absent: the ' +
        "deployment's default lifetime; `null`: none; either way capped by the maximum lifetime. `reuseActive: true` " +
        'returns your active link with the same role instead of a second one. You must be allowed to share the record ' +
        'by link (its `share_link` action, else `share`); anyone else gets 404. 409 `LINK_LIMIT_REACHED` past the ' +
        'active links per record; 503 `LINKS_UNAVAILABLE` when `SECRETS_ENCRYPTION_KEY` is not configured. ' +
        'Requires `sharing:write`.',
    })
    @ApiResponse({ status: 201, type: IssuedLinkGrantResponseDto })
    @ApiResponse({ status: 404, description: NOT_FOUND })
    @ApiResponse({ status: 409, description: '`LINK_LIMIT_REACHED` or `GRANT_LIMIT_REACHED`' })
    @ApiResponse({ status: 422, description: '`ROLE_NOT_GRANTABLE`' })
    @ApiResponse({ status: 503, description: '`LINKS_UNAVAILABLE`: `SECRETS_ENCRYPTION_KEY` is not configured' })
    create(@CurrentPrincipal() principal: Principal, @Body() body: CreateLinkGrantDto) {
      return this.links.create(principal, body);
    }

    @Get()
    @READ
    @ApiOperation({
      summary: "List a record's share links",
      description:
        'The links of one record that are not revoked (expired ones included), newest first, each with its URL ' +
        're-derived from the stored ciphertext (`null` when it cannot be shown). You must be allowed to share the ' +
        'record by link; anyone else gets 404. Requires `sharing:read`.',
    })
    @ApiResponse({ status: 200, type: LinkGrantListResponseDto })
    @ApiResponse({ status: 404, description: NOT_FOUND })
    list(@CurrentPrincipal() principal: Principal, @Query() query: LinkGrantListQueryDto) {
      return this.links.list(principal, query);
    }
  }

  return LinkGrantsController;
}
