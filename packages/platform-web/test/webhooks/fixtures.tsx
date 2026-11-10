// Fixtures of the webhooks slice tests (issue #1046). Invented names and the
// reserved `.example.test` domain only.
import type {
  WebhookDelivery,
  WebhookDeliveryDetail,
  WebhookEndpoint,
  WebhookEventCatalogEntry,
} from '@marinoscar/platform-contract/webhooks';
import { render } from '@testing-library/react';
import type { ReactElement } from 'react';

import { PlatformHostProvider } from '../../src/core/index.js';
import { createTestPlatformHost } from '../../src/testing/index.js';
import type { TestApiResponse, TestPlatformHost } from '../../src/testing/index.js';

export const ENDPOINT_ID = '3f0c8a2e-9b7d-4e61-a1c4-5d2e8f9a0b11';
export const DELIVERY_ID = 'a8e2d6c4-1f3b-4a5e-9c7d-0b2e4f6a8c10';
// Built at runtime from a plain string: a fixture, not a credential.
export const SECRET = `whsec_${btoa('test-secret-not-real-0123456789')}`;

export function endpoint(extra: Partial<WebhookEndpoint> = {}): WebhookEndpoint {
  return {
    id: ENDPOINT_ID,
    scope: 'user',
    orgId: 'org-alpha',
    ownerUserId: 'person-a',
    name: 'Receiver for Org Alpha',
    description: null,
    url: 'https://receiver.example.test/hook',
    eventKeys: ['nodes.*'],
    enabled: true,
    disabledReason: null,
    consecutiveFailures: 0,
    secretVersion: 1,
    previousSecretUntil: null,
    lastDeliveryAt: null,
    lastSuccessAt: '2026-10-30T09:00:00.000Z',
    createdAt: '2026-10-01T09:00:00.000Z',
    updatedAt: '2026-10-01T09:00:00.000Z',
    ...extra,
  };
}

export function delivery(extra: Partial<WebhookDelivery> = {}): WebhookDelivery {
  return {
    id: DELIVERY_ID,
    endpointId: ENDPOINT_ID,
    eventKey: 'nodes.node.offline',
    eventId: 'e0000000-0000-4000-8000-000000000001',
    status: 'dead',
    attempt: 10,
    responseStatus: 500,
    responseSnippet: 'upstream unavailable',
    errorCode: 'http_5xx',
    durationMs: 240,
    nextAttemptAt: null,
    deliveredAt: null,
    createdAt: '2026-10-31T12:00:00.000Z',
    ...extra,
  };
}

export function deliveryDetail(extra: Partial<WebhookDeliveryDetail> = {}): WebhookDeliveryDetail {
  return {
    ...delivery(),
    payload: { id: 'e0000000-0000-4000-8000-000000000001', type: 'nodes.node.offline', data: { nodeName: 'Node P1' } },
    requestHeaders: { 'webhook-id': 'e0000000-0000-4000-8000-000000000001', 'content-type': 'application/json' },
    ...extra,
  };
}

function entry(key: string, group: string, label: string): WebhookEventCatalogEntry {
  return { key, group, label, description: `${label} (example).`, audience: 'system', jsonSchema: {} };
}

export const CATALOG: WebhookEventCatalogEntry[] = [
  entry('nodes.node.offline', 'Nodes', 'Node went offline'),
  entry('nodes.node.event', 'Nodes', 'Node reported an event'),
  entry('jobs.job.failed', 'Jobs', 'Job failed'),
  entry('webhooks.ping', 'Webhooks', 'Test ping'),
  // Two groups sharing a first segment: neither may use `shared.*`.
  entry('shared.alpha.done', 'Alpha', 'Alpha done'),
  entry('shared.beta.done', 'Beta', 'Beta done'),
];

export function hostWith(
  responses: Record<string, TestApiResponse>,
  permissions: readonly string[] = ['webhooks:read', 'webhooks:write'],
): TestPlatformHost {
  return createTestPlatformHost({ permissions, responses });
}

export function renderWith(host: TestPlatformHost, element: ReactElement) {
  return render(<PlatformHostProvider host={host}>{element}</PlatformHostProvider>);
}
