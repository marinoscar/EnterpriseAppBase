// =============================================================================
// The platform's public link route: GET /api/public/links/current (#730)
// =============================================================================
//
// DELIBERATELY PUBLIC: no `@Auth()`. The caller is authenticated by the link
// token in the `X-Link-Token` header (`LinkGrantGuard`), and the route carries
// the app's `@Public()` marker through `host.access.allowPublic`, so the app's
// route inventory sees it as public on purpose. Without that marker the
// module leaves this route out (the guard and the pattern still work for an
// app's own routes).
//
//   GET /public/links/current   X-Link-Token   200 resolution | 404 (generic) | 429
//
// The SPA's `/s` page reads the token from the URL fragment and calls this
// route to learn what the link opens; app routes behind the same guard serve
// the record itself.
// =============================================================================

import { Controller, Get, Type, UseGuards, UseInterceptors } from '@nestjs/common';
import { ApiHeader, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { PublicLinkResolution } from '@marinoscar/platform-contract/sharing';

import { PublicLinkResolutionResponseDto } from '../dto/link-grants.dto';
import { CurrentLinkGrant, LinkGrantResource } from './link-grant.decorators';
import { LinkGrantGuard } from './link-grant.guard';
import { ANY_LINK_RESOURCE_TYPE, LinkGrantsService, type ResolvedLinkGrant } from './link-grants.service';
import { PublicLinkInterceptor } from './public-link.interceptor';

/**
 * Creates the `PublicLinksController` class, marked public with the host's
 * `allowPublic` decorator. `SharingModule.forRoot()` calls it when the host
 * provides one.
 *
 * @param allowPublic - the host's deliberate-public marker.
 * @returns the controller class.
 *
 * @stability experimental
 */
export function createPublicLinksController(allowPublic: () => MethodDecorator & ClassDecorator): Type<unknown> {
  @ApiTags('Grants')
  @Controller('public/links')
  @UseGuards(LinkGrantGuard)
  @UseInterceptors(PublicLinkInterceptor)
  class PublicLinksController {
    constructor(private readonly links: LinkGrantsService) {}

    @Get('current')
    @(allowPublic())
    @LinkGrantResource(ANY_LINK_RESOURCE_TYPE)
    @ApiHeader({ name: 'X-Link-Token', required: true, description: 'The link token, from the share URL fragment (`/s#lnk_...`). Never sent in a path or a query.' })
    @ApiOperation({
      summary: 'Resolve a share link',
      description:
        'Deliberately public: the `X-Link-Token` header is the only credential. Answers what the link opens (the ' +
        "record's type, id and title, the role, the expiry). An unknown, malformed, revoked, expired or otherwise " +
        'invalid token is the same 404 whatever the reason; a token in the path or the query string is never read. ' +
        'Failed resolutions are limited per client address (default 30 per 10 minutes, approximate across replicas): ' +
        'past it, 429 `LINK_RESOLUTION_THROTTLED` with `Retry-After`. Responses carry `Cache-Control: no-store` and ' +
        '`Referrer-Policy: no-referrer`.',
    })
    @ApiResponse({ status: 200, type: PublicLinkResolutionResponseDto })
    @ApiResponse({ status: 404, description: 'Link not found (every failure)' })
    @ApiResponse({ status: 429, description: '`LINK_RESOLUTION_THROTTLED`' })
    async current(@CurrentLinkGrant() link: ResolvedLinkGrant): Promise<PublicLinkResolution> {
      return {
        resourceType: link.resourceType,
        resourceId: link.resourceId,
        role: link.role,
        expiresAt: link.expiresAt ? link.expiresAt.toISOString() : null,
        title: await this.links.titleOf(link),
      };
    }
  }

  return PublicLinksController;
}
