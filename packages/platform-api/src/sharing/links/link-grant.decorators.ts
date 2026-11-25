// =============================================================================
// The public-route decorators of link shares (issue #730)
// =============================================================================
//
//   @LinkGrantResource(type, { action })   what a `LinkGrantGuard` route accepts
//   @CurrentLinkGrant()                    the resolved link, in the handler
//
// See ./link-grant.guard.ts for the pattern.
// =============================================================================

import { createParamDecorator, NotFoundException, SetMetadata, type ExecutionContext } from '@nestjs/common';

import { ANY_LINK_RESOURCE_TYPE, type LinkResolutionExpectation, type ResolvedLinkGrant } from './link-grants.service';

/**
 * The metadata key `@LinkGrantResource` writes and `LinkGrantGuard` reads.
 *
 * @stability experimental
 */
export const LINK_GRANT_RESOURCE_KEY = 'sharing:link-grant-resource';

/**
 * The request property `LinkGrantGuard` sets to the resolved link.
 *
 * @stability experimental
 */
export const LINK_GRANT_REQUEST_KEY = 'linkGrant';

/**
 * Declares which links a `LinkGrantGuard` route accepts: links to records of
 * `resourceType` whose role reaches the minimum role of `action`. A route
 * behind the guard without it fails closed (500: a programming error).
 *
 * @param resourceType - the registered resource type the route serves.
 * @param options - `action`: the type's action the route performs (default `read`;
 *   none for the platform's any-type route).
 * @returns the method (or class) decorator.
 *
 * @example
 * ```ts
 * @Get()
 * @LinkGrantResource('media_item', { action: 'read' })
 * get(@CurrentLinkGrant() link: ResolvedLinkGrant) { ... }
 * ```
 *
 * @extensionPoint hook
 * @stability experimental
 */
export function LinkGrantResource(resourceType: string, options: { action?: string } = {}): MethodDecorator & ClassDecorator {
  if (typeof resourceType !== 'string' || resourceType.length === 0) throw new Error('@LinkGrantResource(type): the resource type is required.');
  // The platform's own any-type route checks no action; an app route defaults to `read`.
  const action = options.action ?? (resourceType === ANY_LINK_RESOURCE_TYPE ? undefined : 'read');
  const expectation: LinkResolutionExpectation = action === undefined ? { resourceType } : { resourceType, action };
  return SetMetadata(LINK_GRANT_RESOURCE_KEY, Object.freeze(expectation));
}

/**
 * The link `LinkGrantGuard` resolved for this request. Outside a guarded
 * route there is none, and the handler answers the same 404 as a bad link.
 *
 * @returns the parameter decorator.
 *
 * @extensionPoint hook
 * @stability experimental
 */
export const CurrentLinkGrant: () => ParameterDecorator = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): ResolvedLinkGrant => {
    const link = (ctx.switchToHttp().getRequest() as Record<string, unknown>)[LINK_GRANT_REQUEST_KEY] as ResolvedLinkGrant | undefined;
    if (!link) throw new NotFoundException('Link not found');
    return link;
  },
);
