import { z } from 'zod';

import { withTemporaryEntries } from '../../src/core/index';
import { notificationChannelRegistry, notificationEventRegistry } from '../../src/notifications/index';
import {
  WEBHOOKS_APP_METRICS,
  WebhookFanoutHandler,
  allWebhookEvents,
  catalogFor,
  eventGroupOf,
  isSubscribed,
  resolveWebhookEvent,
  subscriptionMatches,
  webhookEventRegistry,
  type WebhookEventDef,
} from '../../src/webhooks/index';
import { KIT_ORG_ID, KIT_USER_A, KIT_USER_B, createWebhooksTestKit, makeWebhookOwner } from '../../src/webhooks/testing/index';

const NODE_OFFLINE = { nodeId: 'n1', nodeName: 'builder-1', lastHeartbeatAt: null, markedOfflineAt: '2026-11-01T10:00:00.000Z', staleAfterMinutes: 5 };
const SYSTEM_READ = 'system_webhooks:read';

const ORG_EVENT: WebhookEventDef = {
  key: 'invoices.invoice.paid',
  label: 'Invoice paid',
  description: 'An invoice was paid.',
  group: 'Invoices',
  audience: 'org',
  permission: 'org_webhooks:read',
  payloadSchema: z.object({ invoiceId: z.string() }),
  source: 'test',
};

describe('subscription matching', () => {
  it('matches exact keys, group wildcards and *', () => {
    expect(subscriptionMatches('*', 'nodes.node.offline')).toBe(true);
    expect(subscriptionMatches('nodes.*', 'nodes.node.offline')).toBe(true);
    expect(subscriptionMatches('nodes.node.*', 'nodes.node.offline')).toBe(true);
    expect(subscriptionMatches('nodes.node.offline', 'nodes.node.offline')).toBe(true);
    expect(subscriptionMatches('nodes.*', 'nodesx.node.offline')).toBe(false);
    expect(subscriptionMatches('jobs.*', 'nodes.node.offline')).toBe(false);
    expect(subscriptionMatches('nodes.node', 'nodes.node.offline')).toBe(false);
    expect(isSubscribed(['jobs.*', 'nodes.node.offline'], 'nodes.node.offline')).toBe(true);
    expect(isSubscribed([], 'nodes.node.offline')).toBe(false);
  });
});

describe('the event registry and catalog', () => {
  it('holds the platform events, in order', () => {
    createWebhooksTestKit();
    expect(webhookEventRegistry.ids().slice(0, 4)).toEqual(['webhooks.ping', 'nodes.node.offline', 'nodes.node.event', 'jobs.job.failed']);
  });

  it('is open: an app registers its own event, and a conflicting key is refused', async () => {
    createWebhooksTestKit();
    await withTemporaryEntries(webhookEventRegistry, [ORG_EVENT], () => {
      expect(resolveWebhookEvent('invoices.invoice.paid')).toBe(ORG_EVENT);
      expect(catalogFor('org').map((entry) => entry.key)).toContain('invoices.invoice.paid');
      expect(catalogFor('org').find((entry) => entry.key === 'invoices.invoice.paid')!.jsonSchema).toMatchObject({ type: 'object', properties: { invoiceId: { type: 'string' } } });
      expect(() => webhookEventRegistry.register({ ...ORG_EVENT, source: 'someone else' })).toThrow(/already registered by "test"/);
    });
    expect(resolveWebhookEvent('invoices.invoice.paid')).toBeUndefined();
  });

  it.each([['Bad.Key'], ['one'], ['a..b'], ['a.b-c']])('refuses the malformed key %s', (key) => {
    expect(() => webhookEventRegistry.register({ ...ORG_EVENT, key })).toThrow();
  });

  it('bridges every notification event as notification.<key>, audience user, with a fixed payload', async () => {
    createWebhooksTestKit();
    await withTemporaryEntries(notificationChannelRegistry, [{ id: 'browser', label: 'Browser', description: 'In the app.' }, { id: 'webhook', label: 'Webhooks', description: 'Your endpoints.' }], async () => {
      await withTemporaryEntries(
        notificationEventRegistry,
        [{ key: 'example.thing_happened', label: 'Thing happened', description: 'A thing happened.', channels: ['browser', 'webhook'], defaultEnabled: true }],
        () => {
          const event = resolveWebhookEvent('notification.example.thing_happened')!;
          expect(event).toMatchObject({ audience: 'user', group: 'Notifications', source: 'notifications' });
          expect(event.payloadSchema.safeParse({ event: { key: 'k', label: 'l', description: 'd' }, title: 't', body: 'b', link: null, fields: null }).success).toBe(true);
          expect(event.payloadSchema.safeParse({ title: 't' }).success).toBe(false);
          expect(allWebhookEvents().map((e) => e.key)).toContain('notification.example.thing_happened');
          expect(catalogFor('user').map((e) => e.key)).toEqual(['notification.example.thing_happened']);
          expect(catalogFor('system').map((e) => e.key)).not.toContain('notification.example.thing_happened');
          expect(resolveWebhookEvent('notification.nothing.here')).toBeUndefined();
        },
      );
      await withTemporaryEntries(
        notificationEventRegistry,
        [{ key: 'example.browser_only', label: 'Browser only', description: 'Only in the bell.', channels: ['browser'], defaultEnabled: true }],
        () => {
          expect(resolveWebhookEvent('notification.example.browser_only')).toBeUndefined();
        },
      );
    });
  });

  it('bounds the event_group metric label to registered groups', () => {
    createWebhooksTestKit();
    expect(eventGroupOf('nodes.node.offline')).toBe('nodes');
    expect(eventGroupOf('notification.user.welcome')).toBe('notification');
    expect(eventGroupOf('webhooks.ping')).toBe('webhooks');
    expect(eventGroupOf('random.thing.happened')).toBe('other');
    const attrs = WEBHOOKS_APP_METRICS.find((m) => m.key === 'webhookDeliveries')!.attributes!;
    expect(attrs.outcome).toEqual({ kind: 'enum', values: ['succeeded', 'failed', 'dead', 'blocked'] });
  });
});

describe('WebhooksService.emit', () => {
  async function systemKit() {
    const kit = createWebhooksTestKit();
    const ctx = kit.context('system');
    const all = await kit.endpoints.create(ctx, { name: 'nodes', url: 'https://receiver.example.test/a', eventKeys: ['nodes.*'], enabled: true });
    const jobs = await kit.endpoints.create(ctx, { name: 'jobs', url: 'https://receiver.example.test/b', eventKeys: ['jobs.job.failed'], enabled: true });
    kit.repository.setOwner(makeWebhookOwner({ id: KIT_USER_A, permissions: [], systemPermissions: [SYSTEM_READ] }));
    return { kit, all, jobs };
  }

  it('creates one delivery and one job per subscribed endpoint, with the envelope as the stored body', async () => {
    const { kit, all } = await systemKit();
    const result = await kit.webhooks.emit('nodes.node.offline', NODE_OFFLINE, { orgId: null, eventId: '55555555-5555-4555-8555-555555555555', occurredAt: new Date('2026-11-01T10:00:00Z') });
    expect(result).toEqual({ matched: 1, queued: 1, eventId: '55555555-5555-4555-8555-555555555555' });
    const rows = [...kit.repository.deliveries.values()];
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ endpointId: all.endpoint.id, eventKey: 'nodes.node.offline', eventId: result.eventId, status: 'pending', orgId: null });
    expect(rows[0]!.payload).toEqual({ id: result.eventId, type: 'nodes.node.offline', createdAt: '2026-11-01T10:00:00.000Z', apiVersion: '2026-11-01', org: null, data: NODE_OFFLINE });
    expect(kit.repository.enqueued).toEqual([{ deliveryId: rows[0]!.id, orgId: null, reason: 'upload', scheduledFor: null }]);
    expect(kit.receiver.requests).toHaveLength(0);
  });

  it('is idempotent per endpoint and event id: a replayed fan-out inserts nothing', async () => {
    const { kit } = await systemKit();
    const eventId = '66666666-6666-4666-8666-666666666666';
    expect((await kit.webhooks.emit('nodes.node.offline', NODE_OFFLINE, { orgId: null, eventId })).queued).toBe(1);
    expect((await kit.webhooks.emit('nodes.node.offline', NODE_OFFLINE, { orgId: null, eventId })).queued).toBe(0);
    expect((await kit.webhooks.emit('nodes.node.offline', NODE_OFFLINE, { orgId: null })).queued).toBe(1);
    expect(kit.repository.deliveries.size).toBe(2);
  });

  it('skips disabled endpoints and strips unknown fields from the data', async () => {
    const { kit, all } = await systemKit();
    kit.repository.endpoints.get(all.endpoint.id)!.enabled = false;
    expect((await kit.webhooks.emit('nodes.node.offline', NODE_OFFLINE, { orgId: null })).queued).toBe(0);
    kit.repository.endpoints.get(all.endpoint.id)!.enabled = true;
    await kit.webhooks.emit('nodes.node.offline', { ...NODE_OFFLINE, apiKey: 'leak' }, { orgId: null });
    expect(JSON.stringify([...kit.repository.deliveries.values()])).not.toContain('leak');
  });

  it('never throws for an unknown event, invalid data or a user event without a user, and counts them', async () => {
    const { kit } = await systemKit();
    const counts: unknown[][] = [];
    const service = new (kit.webhooks.constructor as new (...args: unknown[]) => typeof kit.webhooks)(kit.repository, kit.jobs, { organization: { findFirst: async () => ({ id: KIT_ORG_ID }) } }, { record: async () => undefined }, { add: (...args: unknown[]) => counts.push(args) });
    await expect(service.emit('no.such.event', {}, { orgId: null })).resolves.toMatchObject({ matched: 0, queued: 0 });
    await expect(service.emit('nodes.node.offline', { nodeId: 1 }, { orgId: null })).resolves.toMatchObject({ queued: 0 });
    await expect(service.emit('webhooks.ping', { message: 'm', endpointId: 'e' }, { orgId: KIT_ORG_ID })).resolves.toMatchObject({ queued: 0 });
    expect(counts.map((c) => (c[2] as { outcome: string }).outcome)).toEqual(['unknown', 'invalid', 'invalid']);
    expect(kit.repository.deliveries.size).toBe(0);
  });

  describe('owner permission re-check', () => {
    it.each([
      ['lost the permission', makeWebhookOwner({ id: KIT_USER_A, permissions: [], systemPermissions: [] })],
      ['was deactivated', makeWebhookOwner({ id: KIT_USER_A, permissions: [], systemPermissions: [SYSTEM_READ], isActive: false })],
      ['holds only the base permission, not the event\'s', makeWebhookOwner({ id: KIT_USER_A, permissions: [], systemPermissions: ['system_webhooks:write'] })],
      ['no longer exists', null],
    ])('disables the endpoint of an owner who %s, once, and audits it', async (_label, owner) => {
      const { kit, all, jobs } = await systemKit();
      if (owner) kit.repository.setOwner(owner);
      else kit.repository.owners.clear();
      const result = await kit.webhooks.emit('nodes.node.offline', NODE_OFFLINE, { orgId: null });
      expect(result.queued).toBe(0);
      expect(kit.repository.endpoints.get(all.endpoint.id)).toMatchObject({ enabled: false, disabledReason: 'owner_lost_access' });
      // The other endpoint does not subscribe to this event, so it was never examined.
      expect(kit.repository.endpoints.get(jobs.endpoint.id)!.enabled).toBe(true);
      expect(kit.audit.filter((e) => e.action === 'webhook.endpoint.disable')).toEqual([
        expect.objectContaining({ actorUserId: null, targetId: all.endpoint.id, meta: { scope: 'system', reason: 'owner_lost_access' } }),
      ]);
      await kit.webhooks.emit('nodes.node.offline', NODE_OFFLINE, { orgId: null });
      expect(kit.audit.filter((e) => e.action === 'webhook.endpoint.disable')).toHaveLength(1);
    });

    it('does not carry a system permission into an organization endpoint, and rechecks the event permission per event', async () => {
      const kit = createWebhooksTestKit();
      await withTemporaryEntries(webhookEventRegistry, [ORG_EVENT, { ...ORG_EVENT, key: 'invoices.invoice.void', permission: 'org_webhooks:write' }], async () => {
        const created = await kit.endpoints.create(kit.context('org', KIT_USER_A), { name: 'org', url: 'https://receiver.example.test/o', eventKeys: ['invoices.*'], enabled: true });
        kit.repository.setOwner(makeWebhookOwner({ id: KIT_USER_A, orgId: KIT_ORG_ID, permissions: ['org_webhooks:read'] }));
        expect((await kit.webhooks.emit('invoices.invoice.paid', { invoiceId: 'i1' }, { orgId: KIT_ORG_ID })).queued).toBe(1);
        // The owner may read but the void event needs write: this event is skipped and the endpoint is switched off.
        expect((await kit.webhooks.emit('invoices.invoice.void', { invoiceId: 'i1' }, { orgId: KIT_ORG_ID })).queued).toBe(0);
        expect(kit.repository.endpoints.get(created.endpoint.id)!.disabledReason).toBe('owner_lost_access');
        // An organization event never reaches another organization's endpoint or a user endpoint.
        expect((await kit.webhooks.emit('invoices.invoice.paid', { invoiceId: 'i2' }, { orgId: '22222222-2222-4222-8222-222222222222' })).matched).toBe(0);
      });
    });

    it('delivers a user event only to the user\'s own endpoints', async () => {
      const kit = createWebhooksTestKit();
      const mine = await kit.seedEndpoint({ scope: 'user', ownerUserId: KIT_USER_A, eventKeys: ['webhooks.ping'] });
      const theirs = await kit.seedEndpoint({ scope: 'user', ownerUserId: KIT_USER_B, eventKeys: ['webhooks.ping'] });
      kit.repository.setOwner(makeWebhookOwner({ id: KIT_USER_A, orgId: KIT_ORG_ID, permissions: ['webhooks:read'] }));
      kit.repository.setOwner(makeWebhookOwner({ id: KIT_USER_B, orgId: KIT_ORG_ID, permissions: ['webhooks:read'] }));
      const result = await kit.webhooks.emitForUser(KIT_USER_A, 'webhooks.ping', { message: 'm', endpointId: mine.endpoint.id }, { orgId: KIT_ORG_ID });
      expect(result.queued).toBe(1);
      const [row] = [...kit.repository.deliveries.values()];
      expect(row!.endpointId).toBe(mine.endpoint.id);
      expect(row!.endpointId).not.toBe(theirs.endpoint.id);
      expect(row!.orgId).toBe(KIT_ORG_ID);
      expect((row!.payload as { org: unknown }).org).toEqual({ id: KIT_ORG_ID });
    });
  });
});

describe('the fan-out job', () => {
  it('queues one webhooks.fanout job per event with a stable subject, and the handler emits it under the same event id', async () => {
    const kit = createWebhooksTestKit();
    const ctx = kit.context('system');
    await kit.endpoints.create(ctx, { name: 'nodes', url: 'https://receiver.example.test/a', eventKeys: ['nodes.*'], enabled: true });
    kit.repository.setOwner(makeWebhookOwner({ id: KIT_USER_A, permissions: [], systemPermissions: [SYSTEM_READ] }));

    const eventId = await kit.webhooks.enqueueFanout('nodes.node.offline', NODE_OFFLINE, { orgId: null });
    expect(kit.jobs.enqueued).toHaveLength(1);
    expect(kit.jobs.enqueued[0]).toMatchObject({ type: 'webhooks.fanout', subjectId: eventId, orgId: null, payload: { eventKey: 'nodes.node.offline', eventId, data: NODE_OFFLINE, orgId: null } });
    expect(kit.receiver.requests).toHaveLength(0);

    const job = { id: 'j1', payload: kit.jobs.enqueued[0]!.payload, orgId: null } as never;
    await kit.fanout.process(job);
    await kit.fanout.process(job); // a retried job
    expect(kit.repository.deliveries.size).toBe(1);
    expect([...kit.repository.deliveries.values()][0]!.eventId).toBe(eventId);
  });

  it('is a server-only handler', () => {
    const kit = createWebhooksTestKit();
    expect(kit.fanout).toBeInstanceOf(WebhookFanoutHandler);
    expect(kit.fanout.type).toBe('webhooks.fanout');
    expect((kit.fanout as unknown as Record<string, unknown>).nodeResultSchema).toBeUndefined();
    expect((kit.fanout as unknown as Record<string, unknown>).persistNodeResult).toBeUndefined();
  });

  it('fails a job with no event', async () => {
    const kit = createWebhooksTestKit();
    await expect(kit.fanout.process({ id: 'j', payload: null } as never)).rejects.toThrow('no webhook event');
  });
});
