import { ForbiddenException } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { WEBHOOK_PERMISSIONS } from '@marinoscar/platform-contract/webhooks';

import { PERMISSIONS_KEY } from '../../src/identity/index';
import { AdminWebhooksController, OrgWebhooksController, WebhooksController, WebhookEndpointsService } from '../../src/webhooks/index';
import { webhookScopeContext } from '../../src/webhooks/http/scope-context';
import { discoverWebhookRoutes } from '../../src/webhooks/testing/index';
import type { Principal } from '../../src/core/index';

const USER_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ORG_ID = '11111111-1111-4111-8111-111111111111';
const ID = '33333333-3333-4333-8333-333333333333';

const principal = (overrides: Record<string, unknown> = {}) => ({ kind: 'user', userId: USER_ID, permissions: ['webhooks:read'], activeOrgId: ORG_ID, ...overrides }) as unknown as Principal;

describe('webhookScopeContext', () => {
  it('builds the context from the principal', () => {
    expect(webhookScopeContext(principal(), 'user')).toEqual({ scope: 'user', userId: USER_ID, orgId: ORG_ID, permissions: ['webhooks:read'] });
    expect(webhookScopeContext(principal(), 'org')).toMatchObject({ scope: 'org', orgId: ORG_ID });
  });

  it('is deployment-wide for the system scope, which needs no active organization', () => {
    expect(webhookScopeContext(principal({ activeOrgId: undefined }), 'system')).toMatchObject({ scope: 'system', orgId: null });
    expect(webhookScopeContext(principal(), 'system').orgId).toBeNull();
  });

  it('refuses a missing principal, a worker node and an organization scope without an active organization', () => {
    expect(() => webhookScopeContext(undefined, 'user')).toThrow(ForbiddenException);
    expect(() => webhookScopeContext({ kind: 'node', userId: USER_ID, permissions: [] } as unknown as Principal, 'system')).toThrow(ForbiddenException);
    expect(() => webhookScopeContext(principal({ activeOrgId: undefined }), 'user')).toThrow('no active organization');
    expect(() => webhookScopeContext(principal({ activeOrgId: null }), 'org')).toThrow(ForbiddenException);
  });
});

describe('the three controllers', () => {
  const tiers = [
    { controller: WebhooksController, path: 'webhooks', scope: 'user', read: WEBHOOK_PERMISSIONS.READ, write: WEBHOOK_PERMISSIONS.WRITE },
    { controller: OrgWebhooksController, path: 'org/webhooks', scope: 'org', read: WEBHOOK_PERMISSIONS.ORG_READ, write: WEBHOOK_PERMISSIONS.ORG_WRITE },
    { controller: AdminWebhooksController, path: 'admin/webhooks', scope: 'system', read: WEBHOOK_PERMISSIONS.SYSTEM_READ, write: WEBHOOK_PERMISSIONS.SYSTEM_WRITE },
  ] as const;

  it('mounts at /api/webhooks, /api/org/webhooks and /api/admin/webhooks', () => {
    for (const { controller, path } of tiers) expect(Reflect.getMetadata('path', controller)).toBe(path);
  });

  it('declares eleven routes each, every one behind @Auth with its tier\'s exact permission (read for GET, write otherwise)', () => {
    const routes = discoverWebhookRoutes();
    expect(routes).toHaveLength(33);
    for (const { controller, read, write } of tiers) {
      const own = routes.filter((route) => route.id.startsWith(`${controller.name}#`));
      expect(own).toHaveLength(11);
      for (const route of own) {
        expect(route.isPublic).toBe(false);
        expect(route.authenticated).toBe(true);
        expect(route.permissions).toEqual([route.method === 'GET' ? read : write]);
      }
      expect(own.filter((route) => route.method === 'GET')).toHaveLength(5);
    }
  });

  it('guards each handler with the three RBAC guards and no class-level shortcut', () => {
    for (const { controller } of tiers) {
      expect(Reflect.getMetadata(GUARDS_METADATA, controller)).toBeUndefined();
      expect(Reflect.getMetadata(PERMISSIONS_KEY, controller.prototype.list)).toBeDefined();
      expect((Reflect.getMetadata(GUARDS_METADATA, controller.prototype.list) as unknown[]).length).toBe(3);
    }
  });

  it.each(tiers)('$controller.name passes the caller\'s scope, owner and permissions to the service on every route', async ({ controller, scope }) => {
    const calls: unknown[] = [];
    const record = (name: string) => async (...args: unknown[]) => (calls.push([name, ...args]), name === 'list' ? [] : ({ ok: name }));
    const service = Object.fromEntries(['list', 'get', 'create', 'update', 'remove', 'rotateSecret', 'test', 'listDeliveries', 'getDelivery', 'redeliver'].map((name) => [name, record(name)]));
    (service as Record<string, unknown>).catalog = (...args: unknown[]) => (calls.push(['catalog', ...args]), []);
    const instance = new (controller as new (s: WebhookEndpointsService) => WebhooksController)(service as unknown as WebhookEndpointsService);
    const caller = principal({ permissions: ['x:y'] });

    await instance.list(caller);
    await instance.get(caller, ID);
    await instance.create(caller, { name: 'n' } as never);
    await instance.update(caller, ID, { name: 'n' } as never);
    await instance.remove(caller, ID);
    await instance.rotate(caller, ID);
    await instance.test(caller, ID);
    await instance.deliveries(caller, ID, { page: 1, pageSize: 20 } as never);
    await instance.getDelivery(caller, ID);
    await instance.redeliver(caller, ID);
    instance.events(caller);

    expect(calls).toHaveLength(11);
    for (const [, ctx] of calls as Array<[string, { scope: string; userId: string; orgId: string | null; permissions: string[] }]>) {
      expect(ctx).toEqual({ scope, userId: USER_ID, orgId: scope === 'system' ? null : ORG_ID, permissions: ['x:y'] });
    }
  });

  it('answers 403 before touching the service when the credential is not a signed-in user', async () => {
    const service = { list: jest.fn() };
    const instance = new WebhooksController(service as never);
    await expect(instance.list({ kind: 'node' } as never)).rejects.toThrow(ForbiddenException);
    await expect(instance.list(undefined)).rejects.toThrow(ForbiddenException);
    expect(service.list).not.toHaveBeenCalled();
  });
});
