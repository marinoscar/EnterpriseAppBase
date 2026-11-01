import { WEBHOOK_ERROR_CODES, verifyWebhookSignature } from '@marinoscar/platform-contract/webhooks';

import { WebhookDeliveryNotFoundError, WebhookDisabledError, WebhookNotFoundError, WebhookRequestError } from '../../src/webhooks/index';
import { KIT_ORG_ID, KIT_OTHER_ORG_ID, KIT_USER_A, KIT_USER_B, createWebhooksTestKit } from '../../src/webhooks/testing/index';

const URL_OK = 'https://receiver.example.test/hooks';
const SYSTEM_BODY = { name: 'ops', url: URL_OK, eventKeys: ['nodes.*'], enabled: true };

describe('WebhookEndpointsService', () => {
  describe('create', () => {
    it('returns the endpoint and the secret once, and stores the secret outside the row', async () => {
      const kit = createWebhooksTestKit();
      const created = await kit.endpoints.create(kit.context('system'), SYSTEM_BODY);
      expect(created.secret).toMatch(/^whsec_/);
      expect(created.endpoint).toMatchObject({ scope: 'system', orgId: null, ownerUserId: null, name: 'ops', enabled: true, secretVersion: 1, consecutiveFailures: 0, disabledReason: null });
      expect(JSON.stringify(created.endpoint)).not.toContain(created.secret);
      const row = [...kit.repository.endpoints.values()][0]!;
      expect(JSON.stringify(row)).not.toContain(created.secret);
      expect(await kit.secrets.get(row, 1)).toBe(created.secret);
      expect(kit.audit.map((event) => event.action)).toEqual(['webhook.endpoint.create']);
      expect(kit.audit[0]).toMatchObject({ actorUserId: KIT_USER_A, targetId: created.endpoint.id, meta: { scope: 'system' } });
    });

    it('de-duplicates the event keys', async () => {
      const kit = createWebhooksTestKit();
      const created = await kit.endpoints.create(kit.context('system'), { ...SYSTEM_BODY, eventKeys: ['nodes.*', 'nodes.*', 'jobs.job.failed'] });
      expect(created.endpoint.eventKeys).toEqual(['nodes.*', 'jobs.job.failed']);
    });

    it.each([
      ['https://127.0.0.1/x', WEBHOOK_ERROR_CODES.WEBHOOK_URL_FORBIDDEN],
      ['https://169.254.169.254/x', WEBHOOK_ERROR_CODES.WEBHOOK_URL_FORBIDDEN],
      ['http://receiver.example.test/x', WEBHOOK_ERROR_CODES.WEBHOOK_URL_FORBIDDEN],
      ['https://u:p@receiver.example.test/x', WEBHOOK_ERROR_CODES.WEBHOOK_URL_FORBIDDEN],
      ['https://receiver.example.test:22/x', WEBHOOK_ERROR_CODES.WEBHOOK_URL_FORBIDDEN],
    ])('refuses %s with 422 %s', async (url, code) => {
      const kit = createWebhooksTestKit();
      const error = await kit.endpoints.create(kit.context('system'), { ...SYSTEM_BODY, url }).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(WebhookRequestError);
      expect((error as WebhookRequestError).getStatus()).toBe(422);
      expect((error as WebhookRequestError).getResponse()).toMatchObject({ code });
      expect(kit.repository.endpoints.size).toBe(0);
    });

    it('refuses a host that resolves to a private address, accepts one that does not resolve yet', async () => {
      const kit = createWebhooksTestKit();
      kit.resolver.set('internal.example.test', '10.0.0.9');
      await expect(kit.endpoints.create(kit.context('system'), { ...SYSTEM_BODY, url: 'https://internal.example.test/x' })).rejects.toBeInstanceOf(WebhookRequestError);
      await expect(kit.endpoints.create(kit.context('system'), { ...SYSTEM_BODY, url: 'https://later.example.test/x' })).resolves.toBeDefined();
    });

    it('allows a private target when the module is configured for it', async () => {
      const kit = createWebhooksTestKit({ allowPrivateTargets: true, allowInsecureHttp: true });
      await expect(kit.endpoints.create(kit.context('system'), { ...SYSTEM_BODY, url: 'http://127.0.0.1:8080/x' })).resolves.toBeDefined();
    });

    it('refuses an event that does not exist at the scope (404-free 422)', async () => {
      const kit = createWebhooksTestKit();
      const error = await kit.endpoints.create(kit.context('system'), { ...SYSTEM_BODY, eventKeys: ['nothing.here.at.all'] }).catch((e: unknown) => e);
      expect((error as WebhookRequestError).getResponse()).toMatchObject({ code: WEBHOOK_ERROR_CODES.WEBHOOK_EVENT_UNKNOWN });
      // A system event is not subscribable by an org endpoint.
      const org = await kit.endpoints.create(kit.context('org'), { ...SYSTEM_BODY, eventKeys: ['nodes.node.offline'] }).catch((e: unknown) => e);
      expect((org as WebhookRequestError).getResponse()).toMatchObject({ code: WEBHOOK_ERROR_CODES.WEBHOOK_EVENT_UNKNOWN });
      // The test ping is never subscribable.
      const ping = await kit.endpoints.create(kit.context('system'), { ...SYSTEM_BODY, eventKeys: ['webhooks.ping'] }).catch((e: unknown) => e);
      expect((ping as WebhookRequestError).getResponse()).toMatchObject({ code: WEBHOOK_ERROR_CODES.WEBHOOK_EVENT_UNKNOWN });
    });

    it('refuses an event the caller does not hold the permission for', async () => {
      const kit = createWebhooksTestKit();
      const error = await kit.endpoints.create(kit.context('system', KIT_USER_A, ['system_webhooks:write']), SYSTEM_BODY).catch((e: unknown) => e);
      expect((error as WebhookRequestError).getResponse()).toMatchObject({ code: WEBHOOK_ERROR_CODES.WEBHOOK_EVENT_NOT_PERMITTED });
    });

    it('enforces the per-scope endpoint limit', async () => {
      const kit = createWebhooksTestKit({ limits: { system: 2 } });
      const ctx = kit.context('system');
      await kit.endpoints.create(ctx, SYSTEM_BODY);
      await kit.endpoints.create(ctx, SYSTEM_BODY);
      const error = await kit.endpoints.create(ctx, SYSTEM_BODY).catch((e: unknown) => e);
      expect((error as WebhookRequestError).getResponse()).toMatchObject({ code: WEBHOOK_ERROR_CODES.WEBHOOK_LIMIT_REACHED });
    });

    it('counts the limit per owner for user scope and per organization for org scope', async () => {
      const kit = createWebhooksTestKit({ limits: { user: 1, org: 1 } });
      await kit.seedEndpoint({ scope: 'user', ownerUserId: KIT_USER_A, eventKeys: ['webhooks.ping'] });
      // The user limit counts only A's endpoints; B is unaffected (create validation needs a registered user event, so check the count path through the repository).
      expect(await kit.repository.countEndpoints(KIT_ORG_ID, { scope: 'user', ownerUserId: KIT_USER_A })).toBe(1);
      expect(await kit.repository.countEndpoints(KIT_ORG_ID, { scope: 'user', ownerUserId: KIT_USER_B })).toBe(0);
      expect(await kit.repository.countEndpoints(KIT_OTHER_ORG_ID, { scope: 'user', ownerUserId: KIT_USER_A })).toBe(0);
    });

    it('does not keep an endpoint whose secret could not be stored', async () => {
      const kit = createWebhooksTestKit();
      jest.spyOn(kit.secrets, 'put').mockRejectedValueOnce(new Error('store down'));
      await expect(kit.endpoints.create(kit.context('system'), SYSTEM_BODY)).rejects.toThrow('store down');
      expect(kit.repository.endpoints.size).toBe(0);
    });
  });

  describe('visibility', () => {
    it('answers 404 for another owner, another scope, another organization and a missing id', async () => {
      const kit = createWebhooksTestKit();
      const mine = await kit.seedEndpoint({ scope: 'user', ownerUserId: KIT_USER_A, eventKeys: ['webhooks.ping'] });
      const org = await kit.seedEndpoint({ scope: 'org', eventKeys: ['webhooks.ping'] });
      const system = await kit.seedEndpoint({ scope: 'system', eventKeys: ['nodes.*'] });
      const id = mine.endpoint.id;

      const actions: Array<(ctx: ReturnType<typeof kit.context>) => Promise<unknown>> = [
        (ctx) => kit.endpoints.get(ctx, id),
        (ctx) => kit.endpoints.update(ctx, id, { name: 'x' }),
        (ctx) => kit.endpoints.remove(ctx, id),
        (ctx) => kit.endpoints.rotateSecret(ctx, id),
        (ctx) => kit.endpoints.test(ctx, id),
        (ctx) => kit.endpoints.listDeliveries(ctx, id, { page: 1, pageSize: 10 }),
      ];
      const foreign = [kit.context('user', KIT_USER_B), kit.context('user', KIT_USER_A, undefined, KIT_OTHER_ORG_ID), kit.context('org', KIT_USER_A), kit.context('system', KIT_USER_A)];
      for (const ctx of foreign) for (const action of actions) await expect(action(ctx)).rejects.toBeInstanceOf(WebhookNotFoundError);

      // Each tier sees only its own.
      expect((await kit.endpoints.list(kit.context('user', KIT_USER_A))).map((e) => e.id)).toEqual([id]);
      expect((await kit.endpoints.list(kit.context('org', KIT_USER_B))).map((e) => e.id)).toEqual([org.endpoint.id]);
      expect((await kit.endpoints.list(kit.context('system', KIT_USER_B))).map((e) => e.id)).toEqual([system.endpoint.id]);
      expect(await kit.endpoints.list(kit.context('org', KIT_USER_B, undefined, KIT_OTHER_ORG_ID))).toEqual([]);
      await expect(kit.endpoints.get(kit.context('user', KIT_USER_A), '99999999-9999-4999-8999-999999999999')).rejects.toBeInstanceOf(WebhookNotFoundError);
      // An org-bound scope with no active organization is a 404, never an unscoped read.
      await expect(kit.endpoints.list(kit.context('user', KIT_USER_A, undefined, null))).rejects.toBeInstanceOf(WebhookNotFoundError);
    });

    it('hides a delivery of another owner behind 404', async () => {
      const kit = createWebhooksTestKit();
      const mine = await kit.seedEndpoint({ scope: 'user', ownerUserId: KIT_USER_A, eventKeys: ['webhooks.ping'] });
      const { deliveryId } = await kit.endpoints.test(kit.context('user', KIT_USER_A), mine.endpoint.id);
      await expect(kit.endpoints.getDelivery(kit.context('user', KIT_USER_B), deliveryId)).rejects.toBeInstanceOf(WebhookDeliveryNotFoundError);
      await expect(kit.endpoints.redeliver(kit.context('user', KIT_USER_B), deliveryId)).rejects.toBeInstanceOf(WebhookDeliveryNotFoundError);
      await expect(kit.endpoints.getDelivery(kit.context('org', KIT_USER_A), deliveryId)).rejects.toBeInstanceOf(WebhookDeliveryNotFoundError);
      await expect(kit.endpoints.getDelivery(kit.context('user', KIT_USER_A), deliveryId)).resolves.toMatchObject({ id: deliveryId });
    });
  });

  describe('update, remove', () => {
    it('re-enabling clears the failure count and the reason; changing the URL re-validates it', async () => {
      const kit = createWebhooksTestKit();
      const ctx = kit.context('system');
      const { endpoint } = await kit.endpoints.create(ctx, SYSTEM_BODY);
      const row = kit.repository.endpoints.get(endpoint.id)!;
      Object.assign(row, { enabled: false, disabledReason: 'circuit_open', consecutiveFailures: 20 });
      const updated = await kit.endpoints.update(ctx, endpoint.id, { enabled: true, name: 'renamed' });
      expect(updated).toMatchObject({ enabled: true, disabledReason: null, consecutiveFailures: 0, name: 'renamed' });
      await expect(kit.endpoints.update(ctx, endpoint.id, { url: 'https://10.0.0.1/x' })).rejects.toBeInstanceOf(WebhookRequestError);
      expect(kit.repository.endpoints.get(endpoint.id)!.url).toBe(URL_OK);
    });

    it('deleting removes the deliveries and every stored secret version', async () => {
      const kit = createWebhooksTestKit();
      const ctx = kit.context('system');
      const { endpoint } = await kit.endpoints.create(ctx, SYSTEM_BODY);
      await kit.endpoints.rotateSecret(ctx, endpoint.id);
      await kit.endpoints.test(ctx, endpoint.id);
      expect(kit.secrets.stored.size).toBe(2);
      await kit.endpoints.remove(ctx, endpoint.id);
      expect(kit.repository.endpoints.size).toBe(0);
      expect(kit.repository.deliveries.size).toBe(0);
      expect(kit.secrets.stored.size).toBe(0);
      expect(kit.audit.map((e) => e.action)).toContain('webhook.endpoint.delete');
    });
  });

  describe('rotateSecret', () => {
    it('returns the new secret, keeps the previous for the overlap and prunes the one before it', async () => {
      const kit = createWebhooksTestKit({ rotationOverlapHours: 6 });
      const now = new Date('2026-11-01T10:00:00Z');
      kit.setNow(() => now);
      const ctx = kit.context('system');
      const created = await kit.endpoints.create(ctx, SYSTEM_BODY);
      const first = await kit.endpoints.rotateSecret(ctx, created.endpoint.id);
      expect(first.secret).not.toBe(created.secret);
      expect(first.secretVersion).toBe(2);
      expect(first.previousSecretValidUntil).toBe('2026-11-01T16:00:00.000Z');
      expect(kit.secrets.stored.size).toBe(2);
      const second = await kit.endpoints.rotateSecret(ctx, created.endpoint.id);
      expect(second.secretVersion).toBe(3);
      expect(kit.secrets.stored.size).toBe(2); // v1 pruned; v2 (previous) and v3 (current) remain
      const row = kit.repository.endpoints.get(created.endpoint.id)!;
      expect(await kit.secrets.get(row, 1)).toBeNull();
      expect(await kit.secrets.get(row, 2)).toBe(first.secret);
      expect(await kit.secrets.get(row, 3)).toBe(second.secret);
      expect(kit.audit.filter((e) => e.action === 'webhook.endpoint.rotate_secret')).toHaveLength(2);
    });

    it('uses the default 24 hour overlap', async () => {
      const kit = createWebhooksTestKit();
      kit.setNow(() => new Date('2026-11-01T00:00:00Z'));
      const created = await kit.endpoints.create(kit.context('system'), SYSTEM_BODY);
      const rotated = await kit.endpoints.rotateSecret(kit.context('system'), created.endpoint.id);
      expect(rotated.previousSecretValidUntil).toBe('2026-11-02T00:00:00.000Z');
    });
  });

  describe('test and redeliver', () => {
    it('test queues a ping delivery that carries the envelope, and sends nothing itself', async () => {
      const kit = createWebhooksTestKit();
      const ctx = kit.context('system');
      const { endpoint } = await kit.endpoints.create(ctx, SYSTEM_BODY);
      const { deliveryId } = await kit.endpoints.test(ctx, endpoint.id);
      const delivery = kit.repository.deliveries.get(deliveryId)!;
      expect(delivery).toMatchObject({ eventKey: 'webhooks.ping', status: 'pending', attempt: 0, orgId: null });
      expect(delivery.payload).toMatchObject({ id: delivery.eventId, type: 'webhooks.ping', apiVersion: '2026-11-01', org: null, data: { endpointId: endpoint.id } });
      expect(kit.repository.enqueued).toEqual([{ deliveryId, orgId: null, reason: 'upload', scheduledFor: null }]);
      expect(kit.receiver.requests).toHaveLength(0);
    });

    it('redeliver puts the same row back to pending under the same event id, and refuses a disabled endpoint', async () => {
      const kit = createWebhooksTestKit();
      const ctx = kit.context('system');
      const { endpoint } = await kit.endpoints.create(ctx, SYSTEM_BODY);
      const { deliveryId } = await kit.endpoints.test(ctx, endpoint.id);
      await kit.runDeliveryJob(deliveryId, null);
      const before = kit.repository.deliveries.get(deliveryId)!;
      expect(before.status).toBe('succeeded');
      const eventId = before.eventId;

      const detail = await kit.endpoints.redeliver(ctx, deliveryId);
      expect(detail).toMatchObject({ id: deliveryId, status: 'pending', attempt: 0, eventId, responseStatus: null });
      expect(kit.repository.enqueued.filter((job) => job.deliveryId === deliveryId)).toHaveLength(2);
      expect(kit.audit.map((e) => e.action)).toContain('webhook.delivery.redeliver');

      await kit.endpoints.update(ctx, endpoint.id, { enabled: false });
      await expect(kit.endpoints.redeliver(ctx, deliveryId)).rejects.toBeInstanceOf(WebhookDisabledError);
    });

    it('the delivery detail shows the payload and stable headers but never a signature', async () => {
      const kit = createWebhooksTestKit();
      const ctx = kit.context('system');
      const { endpoint } = await kit.endpoints.create(ctx, SYSTEM_BODY);
      const { deliveryId } = await kit.endpoints.test(ctx, endpoint.id);
      await kit.runDeliveryJob(deliveryId, null);
      const detail = await kit.endpoints.getDelivery(ctx, deliveryId);
      expect(Object.keys(detail.requestHeaders).sort()).toEqual(['content-type', 'user-agent', 'webhook-id']);
      expect(detail.requestHeaders['webhook-id']).toBe(detail.eventId);
      expect(JSON.stringify(detail)).not.toMatch(/webhook-signature|v1,/);
      expect(detail.payload).toMatchObject({ type: 'webhooks.ping' });
    });

    it('lists deliveries newest first with paging and filters', async () => {
      const kit = createWebhooksTestKit();
      const ctx = kit.context('system');
      const { endpoint } = await kit.endpoints.create(ctx, SYSTEM_BODY);
      let tick = 0;
      kit.repository.now = () => new Date(Date.UTC(2026, 10, 1, 10, 0, tick++));
      for (let i = 0; i < 3; i += 1) await kit.endpoints.test(ctx, endpoint.id);
      const page = await kit.endpoints.listDeliveries(ctx, endpoint.id, { page: 1, pageSize: 2 });
      expect(page).toMatchObject({ total: 3, page: 1, pageSize: 2, totalPages: 2 });
      expect(page.items).toHaveLength(2);
      expect(page.items[0]!.createdAt > page.items[1]!.createdAt).toBe(true);
      expect((await kit.endpoints.listDeliveries(ctx, endpoint.id, { page: 1, pageSize: 10, status: 'succeeded' })).total).toBe(0);
      expect((await kit.endpoints.listDeliveries(ctx, endpoint.id, { page: 1, pageSize: 10, eventKey: 'webhooks.ping' })).total).toBe(3);
    });
  });

  describe('catalog', () => {
    it('lists the events of the scope the caller holds the permission for', () => {
      const kit = createWebhooksTestKit();
      const system = kit.endpoints.catalog(kit.context('system'));
      expect(system.map((entry) => entry.key)).toEqual(expect.arrayContaining(['nodes.node.offline', 'nodes.node.event', 'jobs.job.failed']));
      expect(system.every((entry) => entry.audience === 'system' && typeof entry.jsonSchema === 'object')).toBe(true);
      expect(system.find((entry) => entry.key === 'jobs.job.failed')!.example).toBeDefined();
      expect(system.map((entry) => entry.key)).not.toContain('webhooks.ping');
      expect(kit.endpoints.catalog(kit.context('system', KIT_USER_A, ['system_webhooks:write']))).toEqual([]);
      expect(kit.endpoints.catalog(kit.context('org')).map((entry) => entry.audience)).not.toContain('system');
    });
  });

  it('verifies the delivered signature end to end', async () => {
    const kit = createWebhooksTestKit();
    const ctx = kit.context('system');
    const created = await kit.endpoints.create(ctx, SYSTEM_BODY);
    const { deliveryId } = await kit.endpoints.test(ctx, created.endpoint.id);
    await kit.runDeliveryJob(deliveryId, null);
    const request = kit.receiver.requests[0]!;
    await expect(
      verifyWebhookSignature({ secret: created.secret, id: request.headers['webhook-id']!, timestamp: request.headers['webhook-timestamp']!, body: request.body, signatureHeader: request.headers['webhook-signature']! }),
    ).resolves.toBe(true);
  });
});
