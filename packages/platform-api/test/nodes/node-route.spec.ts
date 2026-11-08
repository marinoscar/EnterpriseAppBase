import { Controller, ForbiddenException, Get, Module, NotFoundException, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { CurrentNode } from '../../src/nodes/current-node.decorator';
import { NodeOwnershipService, assertNodeOwnedBy } from '../../src/nodes/node-ownership';
import { NodeRoute } from '../../src/nodes/node-route.decorator';
import { NodeRouteGuard } from '../../src/nodes/node-route.guard';
import { findNodeRoutePlacementProblems } from '../../src/nodes/node-route.module';
import { RESERVED_NODE_SUBPATHS, controllerRoutes, reservedNodeSubpathOverlap } from '../../src/nodes/node-route.paths';
import { discoverNodeAppRoutes, checkNodeAppRoutes, checkNodeRouteOwnership, nodesConformanceSuite } from '../../src/nodes/testing/index';
import { conformanceSuites } from '../../src/testing/index';
import { NodesController } from '../../src/nodes/nodes.controller';

const OWN = '11111111-1111-4111-8111-111111111111';

@Controller('nodes/:id/reports')
@NodeRoute({ credentials: ['nod'] })
class GoodController {
  @Get('latest')
  latest(@CurrentNode() node: unknown) {
    return node;
  }
}

@Controller('nodes/:id/loose')
class UndeclaredController {
  @Get()
  list() {
    return [];
  }
}

@Controller('nodes/:id/heartbeat')
@NodeRoute()
class ReservedController {
  @Get()
  list() {
    return [];
  }
}

@Controller('reports')
@NodeRoute()
class OffPrefixController {
  @Get()
  list() {
    return [];
  }
}

function context(controller: object, handler: object, request: Record<string, unknown>): ExecutionContext {
  return { getClass: () => controller, getHandler: () => handler, switchToHttp: () => ({ getRequest: () => request }) } as unknown as ExecutionContext;
}

describe('assertNodeOwnedBy', () => {
  const prisma = (row: { id: string; createdById: string } | null) => ({ workerNode: { findUnique: async () => row } }) as never;
  it('404 for a missing node, 403 for another user, the row for the owner', async () => {
    await expect(assertNodeOwnedBy(prisma(null), 'u1', OWN)).rejects.toBeInstanceOf(NotFoundException);
    await expect(assertNodeOwnedBy(prisma({ id: OWN, createdById: 'u2' }), 'u1', OWN)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(assertNodeOwnedBy(prisma({ id: OWN, createdById: 'u1' }), 'u1', OWN)).resolves.toMatchObject({ id: OWN });
  });
});

describe('NodeRouteGuard', () => {
  const owned = { id: OWN, createdById: 'u1' };
  const ownership = { assertOwnership: jest.fn(async () => owned) } as unknown as NodeOwnershipService;
  const guard = new NodeRouteGuard(new Reflector(), ownership);
  const handler = GoodController.prototype.latest;
  const base = (kind: string) => ({ user: { id: 'u1' }, authCredential: { kind, tokenId: 't' }, params: { id: OWN } });

  it('admits the owner with a listed credential and stores the node', async () => {
    const request = base('node') as Record<string, unknown>;
    await expect(guard.canActivate(context(GoodController, handler, request))).resolves.toBe(true);
    expect(request.nodeRouteNode).toBe(owned);
  });

  it('refuses a credential kind the route did not list', async () => {
    await expect(guard.canActivate(context(GoodController, handler, base('pat')))).rejects.toBeInstanceOf(ForbiddenException);
    await expect(guard.canActivate(context(GoodController, handler, base('jwt')))).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejects a non-uuid node id before touching the database', async () => {
    const request = { ...base('node'), params: { id: 'nope' } };
    await expect(guard.canActivate(context(GoodController, handler, request))).rejects.toMatchObject({ status: 400 });
  });

  it('fails closed on a route that is not a node route', async () => {
    class Plain {
      h() {}
    }
    await expect(guard.canActivate(context(Plain, Plain.prototype.h, base('node')))).rejects.toBeInstanceOf(ForbiddenException);
  });
});

describe('reserved sub-paths', () => {
  it('lists the platform routes', () => {
    expect(RESERVED_NODE_SUBPATHS).toEqual(expect.arrayContaining(['register', ':id/claim', ':id/jobs/*', ':id/telemetry']));
  });

  it.each([
    [['register'], 'register'],
    [[':id', 'claim'], ':id/claim'],
    [['x'], ':id'],
    [[':id', 'jobs', ':jobId', 'anything'], ':id/jobs/*'],
    [['models', 'manifest'], 'models/*'],
    [[], ''],
  ])('%j collides with %s', (segments, reserved) => {
    expect(reservedNodeSubpathOverlap(segments)).toBe(reserved);
  });

  it.each([[[':id', 'backup']], [[':id', 'backup', 'changes']], [[':id', 'reports', 'latest']]])('%j is free', (segments) => {
    expect(reservedNodeSubpathOverlap(segments)).toBeNull();
  });

  it('every packaged route overlaps its own reserved entry', () => {
    for (const route of controllerRoutes(NodesController)) {
      expect(route.nodeSegments).not.toBeNull();
      expect(reservedNodeSubpathOverlap(route.nodeSegments as string[])).not.toBeNull();
    }
  });
});

describe('placement problems', () => {
  it('flags a reserved overlap and an off-prefix node route, not a good one', () => {
    expect(findNodeRoutePlacementProblems([GoodController])).toEqual([]);
    expect(findNodeRoutePlacementProblems([ReservedController])[0]).toMatch(/reserved sub-path ":id\/heartbeat"/);
    expect(findNodeRoutePlacementProblems([OffPrefixController])[0]).toMatch(/not under \/api\/nodes/);
    expect(findNodeRoutePlacementProblems([UndeclaredController])).toEqual([]);
  });
});

describe('the nodes conformance suite', () => {
  @Module({ controllers: [NodesController, GoodController] })
  class ConformingModule {}
  @Module({ controllers: [NodesController, GoodController, UndeclaredController, ReservedController] })
  class ViolatingModule {}

  it('registers itself on import', () => {
    expect(conformanceSuites.has('nodes')).toBe(true);
  });

  it('passes an app whose node routes are all declared', async () => {
    const { routes, platformRoutes } = discoverNodeAppRoutes([NodesController, GoodController]);
    expect(platformRoutes).toBeGreaterThan(5);
    expect(routes.map((route) => route.id)).toEqual(['GoodController#latest']);
    expect(checkNodeAppRoutes(routes)).toEqual([]);
    expect(await checkNodeRouteOwnership(routes)).toEqual([]);
    expect(nodesConformanceSuite.check({ sourceRoots: [] }, { rootModule: ConformingModule }).findings).toEqual([]);
  });

  it('fails a node route without @NodeRoute() and one on a reserved path', () => {
    const findings = nodesConformanceSuite.check({ sourceRoots: [] }, { rootModule: ViolatingModule }).findings;
    expect(findings.filter((f) => f.file === 'UndeclaredController#list')[0]?.message).toMatch(/carries no @NodeRoute\(\)/);
    expect(findings.filter((f) => f.file === 'ReservedController#list')).toHaveLength(1);
  });

  it('fails a route whose guard does not enforce ownership', async () => {
    const { routes } = discoverNodeAppRoutes([GoodController]);
    // A route that admits `pat` although it declared `nod` only: simulate a broken declaration.
    const broken = routes.map((route) => ({ ...route, declared: route.declared && { ...route.declared, credentials: ['nod', 'pat'] as const } }));
    const findings = await checkNodeRouteOwnership(broken as never);
    expect(findings.map((finding) => finding.message).join('\n')).toMatch(/pat credential should be admitted/);
  });

  it('runs every case against the conforming module', async () => {
    const report = nodesConformanceSuite.check({ sourceRoots: [] }, { rootModule: ConformingModule });
    for (const testCase of nodesConformanceSuite.cases({ rootModule: ConformingModule })) await testCase.run(report, expect as never);
  });

  it('the ownership service delegates to the shared rule', async () => {
    const service = new NodeOwnershipService({ workerNode: { findUnique: async () => null } } as never);
    await expect(service.assertOwnership('u', OWN)).rejects.toBeInstanceOf(NotFoundException);
  });
});
