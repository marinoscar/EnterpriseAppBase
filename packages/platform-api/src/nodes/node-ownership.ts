// =============================================================================
// Node ownership: the one rule, and the narrow provider an app route may use
// =============================================================================
//
// `assertNodeOwnedBy` is the rule `NodesService.assertOwnership` has always
// applied (404 for a node that does not exist, 403 for one that belongs to
// somebody else; the argument for 403 over 404 is in `nodes.service.ts`). It is
// extracted so the packaged control plane and the `@NodeRoute()` guard cannot
// drift into two opinions about who owns a node.
//
// `NodeOwnershipService` exists because `NodesService` is deliberately NOT
// exported from `NodesModule` (a feature module that could inject it could
// claim jobs or settle them outside the terminal chokepoint). This is the
// least-privilege handle: one method, read-only.
// =============================================================================

import { ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';

import { PLATFORM_PRISMA } from '../core/index';
import type { JobsPrisma, WorkerNode } from '../jobs/index';

/**
 * Loads node `nodeId` and proves `userId` owns it.
 *
 * @param prisma - anything with the `workerNode` delegate.
 * @param userId - the authenticated owner.
 * @param nodeId - the node's id.
 * @returns the verified node row.
 * @throws NotFoundException when the node does not exist; ForbiddenException when another user owns it.
 *
 * @stability stable
 */
export async function assertNodeOwnedBy(prisma: Pick<JobsPrisma, 'workerNode'>, userId: string, nodeId: string): Promise<WorkerNode> {
  const node = await prisma.workerNode.findUnique({ where: { id: nodeId } });

  if (!node) {
    throw new NotFoundException({
      message: `Worker node ${nodeId} was not found.`,
      details: { nodeId },
    });
  }

  if (node.createdById !== userId) {
    throw new ForbiddenException({
      message:
        `Worker node ${nodeId} belongs to another user. Check that this credential and ` +
        `this node id came from the same registration.`,
      details: { nodeId },
    });
  }

  return node;
}

/**
 * The ownership check an app's node-plane code may inject: the same rule as
 * the packaged control plane, with none of the rest of `NodesService`. Provided
 * and exported by `NodeRouteModule`.
 *
 * @stability stable
 */
@Injectable()
export class NodeOwnershipService {
  constructor(@Inject(PLATFORM_PRISMA) private readonly prisma: JobsPrisma) {}

  /**
   * Proves `userId` owns node `nodeId`.
   *
   * @param userId - the authenticated owner.
   * @param nodeId - the node's id.
   * @returns the verified node row.
   * @throws NotFoundException (missing node) or ForbiddenException (not yours).
   */
  assertOwnership(userId: string, nodeId: string): Promise<WorkerNode> {
    return assertNodeOwnedBy(this.prisma, userId, nodeId);
  }
}
