// =============================================================================
// The `webhooks` conformance suite (issue #1046)
// =============================================================================
//
// Importing `@marinoscar/platform-api/webhooks/testing` registers it with
// `runPlatformConformance`. It drives the REAL services over the in-memory
// ports (`./kit.ts`), so an app proves the invariants the slice promises
// without a database or a network:
//
//   routes   every route of the three controllers is authenticated and enforces
//            exactly its tier's permission string (read for GET, write for the rest);
//   signing  a delivery's signature verifies with the contract's
//            `verifyWebhookSignature`; during a rotation overlap it carries two;
//   egress   loopback, private, link-local (metadata), CGNAT, multicast and
//            IPv4-mapped targets are refused at create AND at send, and a name
//            that resolves to a public address at create time but a private one
//            at send time (DNS rebinding) is refused at send;
//   secrecy  the signing secret appears in no response but create and rotate,
//            and in no delivery row, audit row or log line;
//   queue    no route and no listener makes an outbound request: create, test,
//            redeliver and emit produce rows and jobs only, and only the slice's
//            transport touches `node:http`/`node:https`;
//   authz    an endpoint is invisible (404) across owners, scopes and
//            organizations, and an owner who lost the permission has the
//            endpoint switched off at the next event.
// =============================================================================

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { Type } from '@nestjs/common';
import { Logger, RequestMethod } from '@nestjs/common';
import { GUARDS_METADATA, METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { WEBHOOK_HEADERS, WEBHOOK_PERMISSIONS, verifyWebhookSignature } from '@marinoscar/platform-contract/webhooks';

import { IS_PUBLIC_KEY, PERMISSIONS_KEY } from '../../identity/index';
import { conformanceSuites } from '../../testing/index';
import type { ConformanceAppSuite, ConformanceTestApi } from '../../testing/index';
import { AdminWebhooksController } from '../http/admin-webhooks.controller';
import { OrgWebhooksController } from '../http/org-webhooks.controller';
import { WebhooksController } from '../http/webhooks.controller';
import { toDeliveryDetail, toEndpointView } from '../webhook-views';
import { WebhookNotFoundError } from '../webhooks.errors';
import { KIT_OTHER_ORG_ID, KIT_ORG_ID, KIT_USER_A, KIT_USER_B, createWebhooksTestKit } from './kit';
import { makeWebhookOwner } from './in-memory';

declare module '../../testing/index' {
  interface PlatformConformanceSuiteOptions {
    /** The webhooks slice's suite: its options (an empty object runs it), or a skip with a reason. Registered by importing `@marinoscar/platform-api/webhooks/testing`. */
    webhooks?: WebhooksConformanceOptions | false;
  }
}

/**
 * What the `webhooks` suite takes.
 *
 * @stability experimental
 */
export interface WebhooksConformanceOptions {
  /** Extra addresses the egress case must also see refused (an app's own internal ranges). */
  readonly extraBlockedAddresses?: readonly string[];
}

/** One route, as the suite sees it. @stability experimental */
export interface WebhookRoute {
  /** `Controller#handler`. */
  readonly id: string;
  /** The HTTP method. */
  readonly method: string;
  /** Whether it is `@Public()`. */
  readonly isPublic: boolean;
  /** Whether a guard protects it. */
  readonly authenticated: boolean;
  /** The permissions it requires. */
  readonly permissions: readonly string[];
}

/** One route with the pair of permission strings its tier enforces. @stability experimental */
export interface WebhookControllerRoute extends WebhookRoute {
  /** The permission a `GET` of the tier requires. */
  readonly read: string;
  /** The permission every other method of the tier requires. */
  readonly write: string;
}

const BLOCKED_ADDRESSES = [
  '127.0.0.1',
  '10.0.0.5',
  '172.16.0.1',
  '172.31.255.254',
  '192.168.1.1',
  '169.254.169.254',
  '100.64.0.1',
  '0.0.0.0',
  '224.0.0.1',
  '255.255.255.255',
  '::1',
  '::',
  'fe80::1',
  'fd00::1',
  'fc00::1',
  'ff02::1',
  '::ffff:10.0.0.1',
  '::ffff:127.0.0.1',
  '::ffff:169.254.169.254',
  '64:ff9b::a00:1',
  '2002:a00:1::1',
];

const CONTROLLERS: ReadonlyArray<{ controller: Type<unknown>; read: string; write: string }> = [
  { controller: WebhooksController, read: WEBHOOK_PERMISSIONS.READ, write: WEBHOOK_PERMISSIONS.WRITE },
  { controller: OrgWebhooksController, read: WEBHOOK_PERMISSIONS.ORG_READ, write: WEBHOOK_PERMISSIONS.ORG_WRITE },
  { controller: AdminWebhooksController, read: WEBHOOK_PERMISSIONS.SYSTEM_READ, write: WEBHOOK_PERMISSIONS.SYSTEM_WRITE },
];

/**
 * The routes of the three controllers, read from their metadata.
 *
 * @returns every handler, with the tier it belongs to.
 *
 * @stability experimental
 */
export function discoverWebhookRoutes(): WebhookControllerRoute[] {
  const routes: WebhookControllerRoute[] = [];
  for (const { controller, read, write } of CONTROLLERS) {
    const prototype = controller.prototype as Record<string, unknown>;
    for (const name of Object.getOwnPropertyNames(prototype)) {
      const handler = prototype[name];
      if (name === 'constructor' || typeof handler !== 'function') continue;
      const method = Reflect.getMetadata(METHOD_METADATA, handler) as RequestMethod | undefined;
      if (method === undefined || Reflect.getMetadata(PATH_METADATA, handler) === undefined) continue;
      const guards = [...((Reflect.getMetadata(GUARDS_METADATA, controller) ?? []) as unknown[]), ...((Reflect.getMetadata(GUARDS_METADATA, handler) ?? []) as unknown[])];
      routes.push({
        id: `${controller.name}#${name}`,
        method: RequestMethod[method] ?? String(method),
        isPublic: Reflect.getMetadata(IS_PUBLIC_KEY, handler) === true || Reflect.getMetadata(IS_PUBLIC_KEY, controller) === true,
        authenticated: guards.length > 0,
        permissions: [...((Reflect.getMetadata(PERMISSIONS_KEY, handler) ?? []) as string[])],
        read,
        write,
      });
    }
  }
  return routes;
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return entry === 'testing' ? [] : sourceFiles(full);
    return /\.(ts|js)$/.test(entry) && !/\.(d\.ts|spec\.ts)$/.test(entry) ? [full] : [];
  });
}

/** The error a call rejects with, or `undefined` when it resolved. */
async function rejection(fn: () => Promise<unknown>): Promise<unknown> {
  try {
    await fn();
    return undefined;
  } catch (error) {
    return error;
  }
}

async function withCapturedLogs<R>(fn: () => Promise<R>): Promise<{ result: R; logs: string[] }> {
  const logs: string[] = [];
  const proto = Logger.prototype as unknown as Record<string, (...args: unknown[]) => void>;
  const names = ['log', 'warn', 'error', 'debug', 'verbose', 'fatal'];
  const originals = names.map((name) => proto[name]);
  for (const name of names) proto[name] = (...args: unknown[]) => void logs.push(args.map((arg) => (typeof arg === 'string' ? arg : JSON.stringify(arg))).join(' '));
  try {
    return { result: await fn(), logs };
  } finally {
    names.forEach((name, index) => (proto[name] = originals[index] as (...args: unknown[]) => void));
  }
}

/**
 * Registers the suite's cases with the test API.
 *
 * @param api - the runner's test API.
 * @param options - the suite's options.
 *
 * @stability experimental
 */
export function registerWebhooksConformance(api: ConformanceTestApi, options: WebhooksConformanceOptions): void {
  const { describe, it, expect } = api;
  const url = 'https://receiver.example.test/hooks/in?token=abc';
  const eventKeys = ['nodes.*'];

  describe('webhooks slice conformance (#1046)', () => {
    it('routes: every route is authenticated and enforces exactly its tier permission', () => {
      const routes = discoverWebhookRoutes();
      expect(routes.length).toBeGreaterThanOrEqual(30);
      const problems: string[] = [];
      for (const route of routes) {
        if (route.isPublic) problems.push(`${route.id} is public`);
        if (!route.authenticated) problems.push(`${route.id} declares no @Auth(...)`);
        const wanted = route.method === 'GET' ? route.read : route.write;
        if (route.permissions.length !== 1 || route.permissions[0] !== wanted) problems.push(`${route.id} must require exactly ${wanted} (got ${route.permissions.join(', ') || 'none'})`);
      }
      expect(problems).toEqual([]);
    });

    it('signing: a delivery verifies with verifyWebhookSignature, and a rotation overlap signs twice', async () => {
      const kit = createWebhooksTestKit();
      const ctx = kit.context('system');
      const created = await kit.endpoints.create(ctx, { name: 'sig', url, eventKeys, enabled: true });
      const send = async () => {
        const { deliveryId } = await kit.endpoints.test(ctx, created.endpoint.id);
        await kit.runDeliveryJob(deliveryId, null);
        const request = kit.receiver.requests[kit.receiver.requests.length - 1]!;
        return { request, deliveryId };
      };

      const first = await send();
      const header = first.request.headers[WEBHOOK_HEADERS.SIGNATURE] as string;
      expect(header.split(' ').length).toEqual(1);
      expect(
        await verifyWebhookSignature({ secret: created.secret, id: first.request.headers[WEBHOOK_HEADERS.ID]!, timestamp: first.request.headers[WEBHOOK_HEADERS.TIMESTAMP]!, body: first.request.body, signatureHeader: header }),
      ).toEqual(true);

      const rotated = await kit.endpoints.rotateSecret(ctx, created.endpoint.id);
      const second = await send();
      const both = second.request.headers[WEBHOOK_HEADERS.SIGNATURE] as string;
      expect(both.split(' ').length).toEqual(2);
      for (const secret of [created.secret, rotated.secret]) {
        expect(
          await verifyWebhookSignature({ secret, id: second.request.headers[WEBHOOK_HEADERS.ID]!, timestamp: second.request.headers[WEBHOOK_HEADERS.TIMESTAMP]!, body: second.request.body, signatureHeader: both }),
        ).toEqual(true);
      }
    });

    it('egress: private, loopback, link-local and metadata targets are refused at create and at send; DNS rebinding is caught at send', async () => {
      const kit = createWebhooksTestKit();
      const ctx = kit.context('system');
      const refused: string[] = [];
      for (const address of [...BLOCKED_ADDRESSES, ...(options.extraBlockedAddresses ?? [])]) {
        kit.resolver.set('bad.example.test', address);
        try {
          await kit.endpoints.create(ctx, { name: 'bad', url: 'https://bad.example.test/x', eventKeys, enabled: true });
          refused.push(`${address} was accepted at create`);
        } catch (error) {
          if (!(error instanceof Error) || (error as { getStatus?: () => number }).getStatus?.() !== 422) refused.push(`${address} failed with ${String(error)}`);
        }
      }
      for (const literal of ['https://127.0.0.1/x', 'https://[::1]/x', 'https://169.254.169.254/latest', 'http://receiver.example.test/x', 'https://user:pw@receiver.example.test/x', 'https://receiver.example.test:22/x']) {
        try {
          await kit.endpoints.create(ctx, { name: 'bad', url: literal, eventKeys, enabled: true });
          refused.push(`${literal} was accepted at create`);
        } catch {
          // refused, as required
        }
      }
      expect(refused).toEqual([]);

      const created = await kit.endpoints.create(ctx, { name: 'ok', url, eventKeys, enabled: true });
      kit.resolver.set('receiver.example.test', '10.1.2.3');
      const { deliveryId } = await kit.endpoints.test(ctx, created.endpoint.id);
      await kit.runDeliveryJob(deliveryId, null);
      expect(kit.receiver.requests.length).toEqual(0);
      expect((await kit.repository.deliveries.get(deliveryId))?.errorCode).toEqual('ssrf_blocked');
    });

    it('secrecy: the signing secret appears only in the create and rotate responses', async () => {
      const kit = createWebhooksTestKit();
      const ctx = kit.context('system');
      const { result, logs } = await withCapturedLogs(async () => {
        const created = await kit.endpoints.create(ctx, { name: 'secret', url, eventKeys, enabled: true });
        const rotated = await kit.endpoints.rotateSecret(ctx, created.endpoint.id);
        const { deliveryId } = await kit.endpoints.test(ctx, created.endpoint.id);
        await kit.runDeliveryJob(deliveryId, null);
        return { created, rotated, deliveryId };
      });
      const secrets = [result.created.secret, result.rotated.secret];
      const exposed = JSON.stringify([
        await kit.endpoints.list(ctx),
        await kit.endpoints.get(ctx, result.created.endpoint.id),
        await kit.endpoints.listDeliveries(ctx, result.created.endpoint.id, { page: 1, pageSize: 20 }),
        await kit.endpoints.getDelivery(ctx, result.deliveryId),
        toEndpointView([...kit.repository.endpoints.values()][0]!),
        toDeliveryDetail(kit.repository.deliveries.get(result.deliveryId)!, 'x'),
        [...kit.repository.deliveries.values()],
        kit.audit,
        logs,
      ]);
      for (const secret of secrets) expect(exposed.includes(secret)).toEqual(false);
      expect(exposed.includes('webhook-signature')).toEqual(false);
      // The URL is the owner's own data (the API returns it); the logs and the audit trail carry the host only.
      expect(JSON.stringify([logs, kit.audit]).includes('token=abc')).toEqual(false);
      expect(JSON.stringify([logs, kit.audit]).includes('/hooks/in')).toEqual(false);
    });

    it('queue: creating, testing, redelivering and emitting make no request; only the transport touches node:http', async () => {
      const kit = createWebhooksTestKit();
      const ctx = kit.context('system');
      const created = await kit.endpoints.create(ctx, { name: 'queue', url, eventKeys: ['nodes.*'], enabled: true });
      const { deliveryId } = await kit.endpoints.test(ctx, created.endpoint.id);
      kit.repository.setOwner(makeWebhookOwner({ id: KIT_USER_A, permissions: [], systemPermissions: [WEBHOOK_PERMISSIONS.SYSTEM_READ] }));
      const emitted = await kit.webhooks.emit('nodes.node.offline', { nodeId: 'n', nodeName: 'n', lastHeartbeatAt: null, markedOfflineAt: new Date().toISOString(), staleAfterMinutes: 5 }, { orgId: null });
      expect(emitted.queued).toEqual(1);
      expect(kit.receiver.requests.length).toEqual(0);
      await kit.runDeliveryJob(deliveryId, null);
      await kit.endpoints.redeliver(ctx, deliveryId);
      expect(kit.receiver.requests.length).toEqual(1);

      const offenders: string[] = [];
      const root = join(__dirname, '..');
      for (const file of sourceFiles(root)) {
        const text = readFileSync(file, 'utf8');
        const isTransport = /egress[\\/]transport\.(ts|js)$/.test(file);
        if (!isTransport && /node:https?['"]|require\(['"]https?['"]\)|\bfetch\(|undici/.test(text)) offenders.push(file.slice(root.length + 1));
      }
      expect(offenders).toEqual([]);
    });

    it('authz: endpoints are invisible across owners, scopes and organizations; a lost permission disables the endpoint', async () => {
      const kit = createWebhooksTestKit();
      const { endpoint } = await kit.seedEndpoint({ scope: 'user', ownerUserId: KIT_USER_A, eventKeys: ['webhooks.ping'] });

      const crossings = [
        () => kit.endpoints.get(kit.context('user', KIT_USER_B), endpoint.id),
        () => kit.endpoints.get(kit.context('user', KIT_USER_A, undefined, KIT_OTHER_ORG_ID), endpoint.id),
        () => kit.endpoints.get(kit.context('org', KIT_USER_A), endpoint.id),
        () => kit.endpoints.get(kit.context('system', KIT_USER_A), endpoint.id),
        () => kit.endpoints.update(kit.context('user', KIT_USER_B), endpoint.id, { name: 'x' }),
        () => kit.endpoints.remove(kit.context('user', KIT_USER_B), endpoint.id),
        () => kit.endpoints.rotateSecret(kit.context('user', KIT_USER_B), endpoint.id),
        () => kit.endpoints.test(kit.context('user', KIT_USER_B), endpoint.id),
      ];
      for (const attempt of crossings) expect((await rejection(attempt)) instanceof WebhookNotFoundError).toEqual(true);
      expect((await kit.endpoints.list(kit.context('user', KIT_USER_B))).length).toEqual(0);
      expect((await kit.endpoints.list(kit.context('user', KIT_USER_A))).length).toEqual(1);

      const ping = { message: 'm', endpointId: endpoint.id };
      kit.repository.setOwner(makeWebhookOwner({ id: KIT_USER_A, orgId: KIT_ORG_ID, permissions: [WEBHOOK_PERMISSIONS.READ] }));
      const allowed = await kit.webhooks.emit('webhooks.ping', ping, { orgId: KIT_ORG_ID, userId: KIT_USER_A });
      expect(allowed.queued).toEqual(1);

      kit.repository.setOwner(makeWebhookOwner({ id: KIT_USER_A, orgId: KIT_ORG_ID, permissions: [] }));
      const lost = await kit.webhooks.emit('webhooks.ping', ping, { orgId: KIT_ORG_ID, userId: KIT_USER_A });
      expect(lost.queued).toEqual(0);
      expect(kit.repository.endpoints.get(endpoint.id)?.enabled).toEqual(false);
      expect(kit.repository.endpoints.get(endpoint.id)?.disabledReason).toEqual('owner_lost_access');
    });
  });
}

/**
 * The `webhooks` conformance suite.
 *
 * @extensionPoint registry
 * @stability experimental
 */
export const webhooksConformanceSuite: ConformanceAppSuite<WebhooksConformanceOptions> = {
  id: 'webhooks',
  title: 'the webhooks slice keeps its invariants',
  description:
    'Routes enforce exact permissions, signatures verify and rotate, private targets are refused at create and send (including DNS rebinding), secrets stay out of responses, rows, audit and logs, nothing sends inline, and endpoints are invisible across owners and organizations.',
  register(api, _context, options) {
    registerWebhooksConformance(api, options);
  },
};

if (!conformanceSuites.has(webhooksConformanceSuite.id)) conformanceSuites.register(webhooksConformanceSuite);
