import {
  BadRequestException,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import type { AuthCredentialInfo } from '../identity/index';
import { NODE_ROUTE_REQUEST_KEY } from './current-node.decorator';
import { NODE_ROUTE_METADATA, type NodeRouteCredential, type ResolvedNodeRouteOptions } from './node-route.options';
import { NodeOwnershipService } from './node-ownership';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface NodeRouteRequest {
  user?: { id?: string };
  requestUser?: { id?: string };
  authCredential?: AuthCredentialInfo;
  params?: Record<string, string | undefined>;
  [NODE_ROUTE_REQUEST_KEY]?: unknown;
}

const KIND: Record<AuthCredentialInfo['kind'], NodeRouteCredential> = { node: 'nod', pat: 'pat', jwt: 'jwt' };

/**
 * Applied by `@NodeRoute()`, after `JwtAuthGuard`: refuses a credential kind
 * the route did not admit (403), then, when the route names a node, loads it
 * and proves the caller owns it (404 missing, 403 not yours; the packaged
 * control plane's own semantics) and hands it to `@CurrentNode()`.
 *
 * @stability experimental
 */
@Injectable()
export class NodeRouteGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly ownership: NodeOwnershipService,
  ) {}

  /**
   * @param context - the execution context.
   * @returns `true` to admit; throws 400, 403 or 404 otherwise.
   */
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const options = this.reflector.getAllAndOverride<ResolvedNodeRouteOptions | undefined>(NODE_ROUTE_METADATA, [
      context.getHandler(),
      context.getClass(),
    ]);
    // Unreachable through the decorator; fail closed rather than admit.
    if (!options) throw new ForbiddenException('Route is not a declared node route.');

    const request = context.switchToHttp().getRequest<NodeRouteRequest>();
    const credential = request.authCredential ? KIND[request.authCredential.kind] : undefined;
    if (!credential || !options.credentials.includes(credential)) {
      throw new ForbiddenException({
        message: 'This credential kind is not accepted on this route.',
        details: { accepted: [...options.credentials] },
      });
    }

    if (options.nodeParam === false) return true;

    const userId = (request.requestUser ?? request.user)?.id;
    if (!userId) throw new ForbiddenException('No user in request');

    const nodeId = request.params?.[options.nodeParam];
    if (!nodeId || !UUID.test(nodeId)) {
      throw new BadRequestException({ message: `Route parameter "${options.nodeParam}" must be a node id (uuid).` });
    }

    request[NODE_ROUTE_REQUEST_KEY] = await this.ownership.assertOwnership(userId, nodeId);
    return true;
  }
}
