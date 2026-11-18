// =============================================================================
// EXAMPLE: add a webhook event of the app's own (issue #1046)
// =============================================================================
//
// Rung 2 of the extension ladder: `registerWebhookEvent` adds an event to the
// catalog without editing a package file. An app calls it at import time from
// its registrations (before `WebhooksModule.forRoot()` composes); this spec does
// it inside `withTemporaryEntries` so the example leaves the process-wide
// catalog as it found it. The pieces:
//
//   1. the event: a permanent key (`area.entity.action`), who may subscribe
//      (`audience`), the permission its owner must still hold when it fans out,
//      and a zod schema for `data` (served as JSON Schema by the catalog route);
//   2. an endpoint of that audience subscribes to the key (exactly, or with
//      `invoices.*`);
//   3. the code that raises it calls `WebhooksService.emit` AFTER its own write
//      commits and outside any transaction; delivery is a queue job, never inline.
//
// The test kit (`@marinoscar/platform-api/webhooks/testing`) runs the real
// services over in-memory ports, so none of this needs a database or a network.
// =============================================================================

import { z } from 'zod';

import { withTemporaryEntries } from '@marinoscar/platform-api/core';
import { registerWebhookEvent, webhookEventRegistry, type WebhookEventDef } from '@marinoscar/platform-api/webhooks';
import { KIT_ORG_ID, KIT_USER_A, createWebhooksTestKit, makeWebhookOwner } from '@marinoscar/platform-api/webhooks/testing';

const INVOICE_PAID: WebhookEventDef = {
  key: 'invoices.invoice.paid',
  label: 'Invoice paid',
  description: 'An invoice of the organization was paid.',
  group: 'Invoices',
  audience: 'org',
  permission: 'org_webhooks:read',
  payloadSchema: z.object({ invoiceId: z.string(), amountCents: z.number().int() }),
  example: { invoiceId: 'inv_100', amountCents: 4200 },
  source: 'invoices',
};

describe('registering a webhook event of the app\'s own', () => {
  it('shows it in the catalog, fans it out to subscribed organization endpoints and signs the delivery', async () => {
    const kit = createWebhooksTestKit();
    await withTemporaryEntries(webhookEventRegistry, [], async () => {
      registerWebhookEvent(INVOICE_PAID);

      const ctx = kit.context('org');
      expect(kit.endpoints.catalog(ctx).map((entry) => entry.key)).toContain('invoices.invoice.paid');

      const created = await kit.endpoints.create(ctx, { name: 'accounting', url: 'https://receiver.example.test/hooks', eventKeys: ['invoices.*'], enabled: true });
      kit.repository.setOwner(makeWebhookOwner({ id: KIT_USER_A, orgId: KIT_ORG_ID, permissions: ['org_webhooks:read'] }));

      // The caller's own write has committed; now the event.
      const result = await kit.webhooks.emit('invoices.invoice.paid', { invoiceId: 'inv_7', amountCents: 1999 }, { orgId: KIT_ORG_ID });
      expect(result).toMatchObject({ matched: 1, queued: 1 });

      const [delivery] = [...kit.repository.deliveries.values()];
      expect(delivery).toMatchObject({ endpointId: created.endpoint.id, eventKey: 'invoices.invoice.paid' });
      await kit.runDeliveryJob(delivery!.id);
      expect(JSON.parse(kit.receiver.requests[0]!.body)).toMatchObject({ type: 'invoices.invoice.paid', org: { id: KIT_ORG_ID }, data: { invoiceId: 'inv_7', amountCents: 1999 } });
    });
  });

  it('drops data that does not match the schema instead of sending it', async () => {
    const kit = createWebhooksTestKit();
    await withTemporaryEntries(webhookEventRegistry, [], async () => {
      registerWebhookEvent(INVOICE_PAID);
      await kit.seedEndpoint({ scope: 'org', eventKeys: ['invoices.*'] });
      expect((await kit.webhooks.emit('invoices.invoice.paid', { invoiceId: 7 }, { orgId: KIT_ORG_ID })).queued).toBe(0);
    });
  });
});
