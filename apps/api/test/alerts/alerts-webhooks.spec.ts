// The app binds the alerts webhook port to the webhooks slice (#1047, #1046): a
// fired and a resolved incident reach WebhooksService.emit as system events.
import { ALERT_WEBHOOK_EVENTS } from '@marinoscar/platform-contract/alerts';
import { AlertsDispatchService, AlertsMetrics, type AlertIncidentRow } from '@marinoscar/platform-api/alerts';
import { createInMemoryAlertsPrisma } from '@marinoscar/platform-api/alerts/testing';
import { findWebhookEvent, type WebhooksService } from '@marinoscar/platform-api/webhooks';

import { AlertsWebhookAdapter, registerAlertWebhookEvents } from '../../src/platform/alerts/alerts-webhooks.adapter';

describe('alerts -> webhooks binding', () => {
  const emit = jest.fn().mockResolvedValue({ matched: 1, queued: 1, eventId: 'e' });
  const adapter = new AlertsWebhookAdapter({ emit } as unknown as WebhooksService);

  beforeAll(() => registerAlertWebhookEvents());
  beforeEach(() => emit.mockClear());

  it('registers both events as system events behind system_webhooks:read', () => {
    for (const key of Object.values(ALERT_WEBHOOK_EVENTS)) {
      expect(findWebhookEvent(key)).toMatchObject({ audience: 'system', permission: 'system_webhooks:read', group: 'Alerts' });
    }
  });

  it('a fired and a resolved incident emit with the system audience', async () => {
    const prisma = createInMemoryAlertsPrisma();
    const rule = prisma.addRule({ kind: 'example', name: 'Rule A', webhook: true });
    const dispatch = new AlertsDispatchService(new AlertsMetrics(prisma), undefined, adapter);
    const incident: AlertIncidentRow = {
      id: 'incident-1', ruleId: rule.id, labelsKey: '', labels: {}, state: 'firing', severity: 'warning', pendingSince: null,
      firedAt: new Date('2026-11-01T10:00:00Z'), resolvedAt: null, lastValue: 3, lastSeenAt: new Date(), summary: 'Rule A is firing',
      acknowledgedAt: null, acknowledgedById: null, createdAt: new Date(),
    };

    await dispatch.dispatch('fired', rule, incident, true);
    await dispatch.dispatch('resolved', rule, { ...incident, state: 'resolved', resolvedAt: new Date('2026-11-01T10:30:00Z') }, true);

    expect(emit).toHaveBeenNthCalledWith(1, ALERT_WEBHOOK_EVENTS.FIRED, expect.objectContaining({ incidentId: incident.id, summary: 'Rule A is firing' }), { orgId: null });
    expect(emit).toHaveBeenNthCalledWith(2, ALERT_WEBHOOK_EVENTS.RESOLVED, expect.objectContaining({ resolvedAt: '2026-11-01T10:30:00.000Z' }), { orgId: null });
  });
});
