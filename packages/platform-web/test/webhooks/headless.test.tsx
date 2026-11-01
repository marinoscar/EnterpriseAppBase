// The webhooks client, hooks and helpers (issue #1046): one route family per
// scope, the delivery query string, errors in words, status in words, and the
// event picker's wildcard model.
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';

import { PlatformHostProvider } from '../../src/core/index.js';
import {
  WEBHOOK_SCOPE_PERMISSIONS,
  createWebhooksApi,
  groupWebhookEventCatalog,
  isWebhookEventSelected,
  searchWebhookEventGroups,
  toggleAllWebhookEvents,
  toggleWebhookEvent,
  toggleWebhookGroup,
  unknownWebhookSubscriptions,
  useWebhookDeliveries,
  useWebhookEndpoints,
  useWebhookEventCatalog,
  useWebhookMutations,
  webhookDeliveryStatusLabel,
  webhookEndpointStatus,
  webhookGroupSelectionState,
  webhookUrlHost,
} from '../../src/webhooks/headless/index.js';
import { createTestApiError } from '../../src/testing/index.js';
import { CATALOG, DELIVERY_ID, ENDPOINT_ID, SECRET, delivery, endpoint, hostWith } from './fixtures.js';

function wrapperFor(host: ReturnType<typeof hostWith>) {
  return ({ children }: { children: ReactNode }) => <PlatformHostProvider host={host}>{children}</PlatformHostProvider>;
}

describe('webhooks client', () => {
  it.each([
    ['user', '/webhooks'],
    ['org', '/org/webhooks'],
    ['system', '/admin/webhooks'],
  ] as const)('addresses the %s scope under %s', async (scope, base) => {
    const host = hostWith({
      [`GET ${base}`]: { items: [] },
      [`GET ${base}/${ENDPOINT_ID}`]: endpoint(),
      [`POST ${base}`]: { endpoint: endpoint(), secret: SECRET },
      [`PATCH ${base}/${ENDPOINT_ID}`]: endpoint(),
      [`DELETE ${base}/${ENDPOINT_ID}`]: undefined,
      [`POST ${base}/${ENDPOINT_ID}/rotate-secret`]: { secret: SECRET, secretVersion: 2, previousSecretValidUntil: null },
      [`POST ${base}/${ENDPOINT_ID}/test`]: { deliveryId: DELIVERY_ID },
      [`GET ${base}/${ENDPOINT_ID}/deliveries`]: { items: [], total: 0, page: 1, pageSize: 20, totalPages: 0 },
      [`GET ${base}/deliveries/${DELIVERY_ID}`]: delivery(),
      [`POST ${base}/deliveries/${DELIVERY_ID}/redeliver`]: undefined,
      [`GET ${base}/events`]: { items: CATALOG },
    });
    const client = createWebhooksApi(host.api, scope);
    await client.list();
    await client.get(ENDPOINT_ID);
    await client.create({ name: 'Receiver', url: 'https://receiver.example.test/hook', eventKeys: ['*'] });
    await client.update(ENDPOINT_ID, { enabled: false });
    await client.remove(ENDPOINT_ID);
    await client.rotateSecret(ENDPOINT_ID);
    await client.sendTest(ENDPOINT_ID);
    await client.listDeliveries(ENDPOINT_ID, { page: 2, pageSize: 50, status: 'dead', eventKey: 'nodes.node.offline' });
    await client.getDelivery(DELIVERY_ID);
    await client.redeliver(DELIVERY_ID);
    await client.eventCatalog();
    expect(host.requests.map((r) => `${r.method} ${r.path}`)).toEqual([
      `GET ${base}`,
      `GET ${base}/${ENDPOINT_ID}`,
      `POST ${base}`,
      `PATCH ${base}/${ENDPOINT_ID}`,
      `DELETE ${base}/${ENDPOINT_ID}`,
      `POST ${base}/${ENDPOINT_ID}/rotate-secret`,
      `POST ${base}/${ENDPOINT_ID}/test`,
      `GET ${base}/${ENDPOINT_ID}/deliveries?page=2&pageSize=50&status=dead&eventKey=nodes.node.offline`,
      `GET ${base}/deliveries/${DELIVERY_ID}`,
      `POST ${base}/deliveries/${DELIVERY_ID}/redeliver`,
      `GET ${base}/events`,
    ]);
  });

  it('names the exact permission strings each scope enforces', () => {
    expect(WEBHOOK_SCOPE_PERMISSIONS).toEqual({
      user: { read: 'webhooks:read', write: 'webhooks:write' },
      org: { read: 'org_webhooks:read', write: 'org_webhooks:write' },
      system: { read: 'system_webhooks:read', write: 'system_webhooks:write' },
    });
  });
});

describe('webhooks status in words', () => {
  it('names the reason the platform disabled an endpoint', () => {
    expect(webhookEndpointStatus({ enabled: true, disabledReason: null }).label).toBe('Active');
    expect(webhookEndpointStatus({ enabled: false, disabledReason: null }).label).toBe('Disabled');
    expect(webhookEndpointStatus({ enabled: false, disabledReason: 'circuit_open' }).label).toBe('Paused after repeated failures');
    expect(webhookEndpointStatus({ enabled: false, disabledReason: 'owner_lost_access' }).label).toBe('Owner lost access');
    expect(webhookEndpointStatus({ enabled: false, disabledReason: 'gone' }).label).toBe('Endpoint gone');
  });

  it('labels delivery statuses and shows only the URL host', () => {
    expect(webhookDeliveryStatusLabel('failed')).toBe('Retrying');
    expect(webhookDeliveryStatusLabel('dead')).toBe('Failed');
    expect(webhookUrlHost('https://receiver.example.test:8443/hook?token=x')).toBe('receiver.example.test:8443');
  });
});

describe('the event picker model', () => {
  const groups = groupWebhookEventCatalog(CATALOG);
  const group = (name: string) => groups.find((g) => g.group === name)!;

  it('gives a group its first-segment wildcard, unless another group shares the segment', () => {
    expect(groups.map((g) => [g.group, g.wildcard])).toEqual([
      ['Nodes', 'nodes.*'],
      ['Jobs', 'jobs.*'],
      ['Webhooks', 'webhooks.*'],
      ['Alpha', null],
      ['Beta', null],
    ]);
  });

  it('selects a whole group as its wildcard, folding its exact keys in', () => {
    const next = toggleWebhookGroup(['nodes.node.event', 'jobs.job.failed'], group('Nodes'), groups);
    expect(next).toEqual(['jobs.job.failed', 'nodes.*']);
    expect(webhookGroupSelectionState(next, group('Nodes'))).toBe('all');
    expect(isWebhookEventSelected(next, 'nodes.node.offline')).toBe(true);
  });

  it('selects a group without a wildcard key by key, never as shared.*', () => {
    expect(toggleWebhookGroup([], group('Alpha'), groups)).toEqual(['shared.alpha.done']);
  });

  it('expands a wildcard when one of its events is deselected', () => {
    expect(toggleWebhookEvent(['nodes.*'], 'nodes.node.offline', groups)).toEqual(['nodes.node.event']);
  });

  it('expands * into the other groups (by wildcard) when an event is deselected', () => {
    expect(toggleWebhookEvent(['*'], 'jobs.job.failed', groups)).toEqual([
      'nodes.*',
      'webhooks.*',
      'shared.alpha.done',
      'shared.beta.done',
    ]);
  });

  it('switches * on (replacing everything) and off', () => {
    expect(toggleAllWebhookEvents(['nodes.*'])).toEqual(['*']);
    expect(toggleAllWebhookEvents(['*'])).toEqual([]);
  });

  it('keeps and reports entries the catalog does not know', () => {
    const selection = ['nodes.*', 'notification.*', 'billing.invoice.paid'];
    expect(unknownWebhookSubscriptions(selection, groups)).toEqual(['notification.*', 'billing.invoice.paid']);
    expect(toggleWebhookGroup(selection, group('Jobs'), groups)).toContain('billing.invoice.paid');
  });

  it('searches keys, labels and descriptions', () => {
    expect(searchWebhookEventGroups(groups, 'offline').map((g) => [g.group, g.entries.map((e) => e.key)])).toEqual([
      ['Nodes', ['nodes.node.offline']],
    ]);
  });
});

describe('webhooks hooks', () => {
  it('useWebhookEndpoints loads the scope list', async () => {
    const host = hostWith({ 'GET /org/webhooks': { items: [endpoint({ scope: 'org' })] } });
    const { result } = renderHook(() => useWebhookEndpoints('org'), { wrapper: wrapperFor(host) });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.endpoints.map((e) => e.scope)).toEqual(['org']);
  });

  it('useWebhookDeliveries sends the one-based page and filters', async () => {
    const host = hostWith({
      [`GET /webhooks/${ENDPOINT_ID}/deliveries`]: { items: [delivery()], total: 41, page: 3, pageSize: 20, totalPages: 3 },
    });
    const { result } = renderHook(() => useWebhookDeliveries('user', ENDPOINT_ID, { page: 3, pageSize: 20, status: 'dead' }), {
      wrapper: wrapperFor(host),
    });
    await waitFor(() => expect(result.current.total).toBe(41));
    expect(host.requests.at(-1)?.path).toBe(`/webhooks/${ENDPOINT_ID}/deliveries?page=3&pageSize=20&status=dead`);
  });

  it('useWebhookEventCatalog groups the catalog and can wait until enabled', async () => {
    const host = hostWith({ 'GET /admin/webhooks/events': { items: CATALOG } });
    const { result, rerender } = renderHook(({ enabled }) => useWebhookEventCatalog('system', { enabled }), {
      wrapper: wrapperFor(host),
      initialProps: { enabled: false },
    });
    expect(host.requests).toHaveLength(0);
    rerender({ enabled: true });
    await waitFor(() => expect(result.current.groups).toHaveLength(5));
  });

  it('useWebhookMutations returns null and an error sentence on a refusal', async () => {
    const host = hostWith({
      'POST /webhooks': () => {
        throw createTestApiError(422, 'forbidden target', 'WEBHOOK_URL_FORBIDDEN');
      },
    });
    const { result } = renderHook(() => useWebhookMutations('user'), { wrapper: wrapperFor(host) });
    let created: unknown;
    await act(async () => {
      created = await result.current.create({ name: 'Receiver', url: 'https://receiver.example.test/hook', eventKeys: ['*'] });
    });
    expect(created).toBeNull();
    expect(result.current.error).toBe('That URL points at a private or internal address, which webhooks may not call.');
    act(() => result.current.reset());
    expect(result.current.error).toBeNull();
  });
});
