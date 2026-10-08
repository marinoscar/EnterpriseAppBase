// =============================================================================
// LinkGrantGuard: the public-route pattern of link shares (issue #730)
// =============================================================================
//
// A public request has no principal and therefore no organization. The guard
// makes one link token the request's whole authority, for one route:
//
//   @Controller('public/media')                  // app code
//   @Public()                                    // deliberately public: the guard authenticates
//   @UseGuards(LinkGrantGuard)
//   export class PublicMediaController {
//     @Get()
//     @LinkGrantResource('media_item', { action: 'read' })
//     get(@CurrentLinkGrant() link: ResolvedLinkGrant) {
//       return this.links.withLinkScope(link, (tx) => this.media.publicView(tx, link.resourceId));
//     }
//   }
//
// THE ORDER:
//   0. `Cache-Control: no-store` and `Referrer-Policy: no-referrer` on the
//      reply, before anything can refuse (guards run before interceptors).
//   1. A client address over its miss budget: 429 (`Retry-After`), even
//      with a valid token.
//   2. The token from the `X-Link-Token` HEADER only. A token in the path or
//      the query string is never read (docs/API.md: tokens in the query
//      string are not accepted); a browser keeps it in the URL fragment.
//   3. `LinkGrantsService.resolve`: format, the one bypass lookup by hash,
//      revoked, expired, the route's type, the type still granting the role
//      to links, the action's minimum role, the record still in the grant's
//      organization.
//   4. Any failure: ONE miss for the address and the SAME 404 (`Link not
//      found`) whatever the reason. Success: `request.linkGrant`.
//
// LOGS AND SPANS: a failure logs the reason enum and a keyed hash prefix of
// the address, nothing else; never the token, its hash or the address. The
// span carries `sharing.link.grant_id` on success only.
// =============================================================================

import { createHmac, randomBytes } from 'node:crypto';

import { Injectable, Logger, Optional, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { trace } from '@opentelemetry/api';
import { LINK_TOKEN_HEADER } from '@marinoscar/platform-contract/sharing';

import { MetricsHostService } from '../../otel-core/index';
import { linkNotFound, linkResolutionThrottled } from '../errors';
import { SHARING_LINK_RESOLUTIONS_METRIC, type SharingLinkResolutionOutcome } from '../metrics';
import { LINK_GRANT_REQUEST_KEY, LINK_GRANT_RESOURCE_KEY } from './link-grant.decorators';
import { ANY_LINK_RESOURCE_TYPE, LinkGrantsService, linkFailureOutcome, type LinkResolutionExpectation } from './link-grants.service';
import { LinkMissThrottle } from './link-miss-throttle';
import { setPublicLinkHeaders } from './public-link.interceptor';

/** The span attribute set on a successful resolution. */
export const LINK_GRANT_SPAN_ATTRIBUTE = 'sharing.link.grant_id';

/** The per-process key of the address tags in log lines: tags correlate within a process, and reveal nothing. */
const ADDRESS_TAG_KEY = randomBytes(32);

/**
 * A short, keyed, non-reversible tag of a client address for a log line.
 *
 * @param address - the client address.
 * @returns 12 hex characters.
 */
export function addressTag(address: string): string {
  return createHmac('sha256', ADDRESS_TAG_KEY).update(address).digest('hex').slice(0, 12);
}

/** The request fields the guard reads, structurally (Fastify's request). */
interface LinkRequest {
  ip?: string;
  headers?: Record<string, string | string[] | undefined>;
  [LINK_GRANT_REQUEST_KEY]?: unknown;
}

/**
 * Authenticates a public route by the link token in `X-Link-Token`, for the
 * resource type its `@LinkGrantResource` names, and hands the handler the
 * resolved link (`@CurrentLinkGrant()`). Every failure is the same 404;
 * repeated failures from one address become 429.
 *
 * @stability experimental
 * @extensionPoint hook
 */
@Injectable()
export class LinkGrantGuard implements CanActivate {
  private readonly logger = new Logger('LinkGrantGuard');

  constructor(
    private readonly reflector: Reflector,
    private readonly links: LinkGrantsService,
    private readonly throttle: LinkMissThrottle,
    @Optional() private readonly metrics?: MetricsHostService,
  ) {}

  /**
   * @param context - the route's execution context.
   * @returns `true` with `request.linkGrant` set.
   * @throws NotFoundException 404 (`Link not found`) for every invalid link.
   * @throws HttpException 429 `LINK_RESOLUTION_THROTTLED` for an address over its miss budget.
   * @throws Error when the route declares no `@LinkGrantResource` (a programming error).
   */
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const http = context.switchToHttp();
    const request = http.getRequest<LinkRequest>();
    setPublicLinkHeaders(http.getResponse());

    const expect = this.reflector.getAllAndOverride<LinkResolutionExpectation | undefined>(LINK_GRANT_RESOURCE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!expect) {
      throw new Error(`LinkGrantGuard: ${context.getClass().name}#${context.getHandler().name} declares no @LinkGrantResource(type).`);
    }
    const routeType = expect.resourceType === ANY_LINK_RESOURCE_TYPE ? 'none' : expect.resourceType;
    const address = request.ip ?? 'unknown';

    const wait = this.throttle.retryAfterMs(address);
    if (wait > 0) {
      this.count('throttled', routeType);
      this.logger.debug(`Link resolution refused: reason=throttled address=${addressTag(address)}`);
      throw linkResolutionThrottled(wait);
    }

    // The header only: never a path segment, never a query parameter.
    const result = await this.links.resolve(request.headers?.[LINK_TOKEN_HEADER], expect);
    if (!result.ok) {
      this.throttle.recordMiss(address);
      this.count(linkFailureOutcome(result.failure), result.resourceType ?? routeType);
      this.logger.debug(`Link resolution refused: reason=${result.failure} address=${addressTag(address)}`);
      throw linkNotFound();
    }

    trace.getActiveSpan()?.setAttribute(LINK_GRANT_SPAN_ATTRIBUTE, result.link.grantId);
    this.count('ok', result.link.resourceType);
    request[LINK_GRANT_REQUEST_KEY] = result.link;
    return true;
  }

  private count(outcome: SharingLinkResolutionOutcome, resourceType: string): void {
    try {
      this.metrics?.add(SHARING_LINK_RESOLUTIONS_METRIC, 1, { outcome, resource_type: resourceType });
    } catch {
      // Metrics never fail a request.
    }
  }
}
