/**
 * The app's webhooks binding (#1046): the packaged client per scope, the
 * hooks, the page with a slot, and the dialogs and drawer it is built from,
 * against a test platform host shaped like the API. Invented names only.
 */
import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import type { WebhookDelivery, WebhookEndpoint, WebhookEventCatalogEntry } from '@marinoscar/platform-contract/webhooks';
import { PlatformHostProvider } from '@marinoscar/platform-web/core';
import {
  createWebhooksApi,
  groupWebhookEventCatalog,
  useWebhookDeliveries,
  useWebhookDelivery,
  useWebhookEndpoint,
  useWebhookEndpoints,
  useWebhookEventCatalog,
  useWebhookMutations,
} from '@marinoscar/platform-web/webhooks/headless';
import {
  WebhookDeliveryDrawer,
  WebhookEndpointDialog,
  WebhookEventPicker,
  WebhookSecretDialog,
  WebhookSignatureHelp,
  WebhooksPage,
} from '@marinoscar/platform-web/webhooks/ui';
import { createTestPlatformHost } from '@marinoscar/platform-web/testing';
import type { TestApiResponse, TestPlatformHost } from '@marinoscar/platform-web/testing';

const ID = '3f0c8a2e-9b7d-4e61-a1c4-5d2e8f9a0b11';
const DELIVERY = 'a8e2d6c4-1f3b-4a5e-9c7d-0b2e4f6a8c10';
const SECRET = 'whsec_ZXhhbXBsZS1zZWNyZXQtbm90LXJlYWw=';

function endpoint(extra: Partial<WebhookEndpoint> = {}): WebhookEndpoint {
  return {
    id: ID,
    scope: 'org',
    orgId: 'org-alpha',
    ownerUserId: null,
    name: 'Org Alpha receiver',
    description: null,
    url: 'https://receiver.example.test/hook',
    eventKeys: ['*'],
    enabled: true,
    disabledReason: null,
    consecutiveFailures: 0,
    secretVersion: 1,
    previousSecretUntil: null,
    lastDeliveryAt: null,
    lastSuccessAt: null,
    createdAt: '2026-10-01T09:00:00.000Z',
    updatedAt: '2026-10-01T09:00:00.000Z',
    ...extra,
  };
}

const DELIVERY_ROW: WebhookDelivery = {
  id: DELIVERY,
  endpointId: ID,
  eventKey: 'webhooks.ping',
  eventId: 'e0000000-0000-4000-8000-000000000002',
  status: 'succeeded',
  attempt: 1,
  responseStatus: 204,
  responseSnippet: null,
  errorCode: null,
  durationMs: 85,
  nextAttemptAt: null,
  deliveredAt: '2026-10-31T12:00:01.000Z',
  createdAt: '2026-10-31T12:00:00.000Z',
};

const CATALOG: WebhookEventCatalogEntry[] = [
  { key: 'webhooks.ping', group: 'Webhooks', label: 'Test ping', description: 'Sent by Send test event.', audience: 'org', jsonSchema: {} },
];

function hostWith(responses: Record<string, TestApiResponse>, permissions = ['org_webhooks:read', 'org_webhooks:write']): TestPlatformHost {
  return createTestPlatformHost({ permissions, responses: { 'GET /user-settings': {}, ...responses } });
}

function wrap(host: TestPlatformHost) {
  return ({ children }: { children: ReactNode }): ReactElement => <PlatformHostProvider host={host}>{children}</PlatformHostProvider>;
}

describe('webhooks binding', () => {
  it('createWebhooksApi addresses each scope under its own base', async () => {
    const host = hostWith({ 'GET /webhooks': { items: [] }, 'GET /org/webhooks': { items: [] }, 'GET /admin/webhooks': { items: [] } });
    await createWebhooksApi(host.api, 'user').list();
    await createWebhooksApi(host.api, 'org').list();
    await createWebhooksApi(host.api, 'system').list();
    expect(host.requests.map((r) => r.path)).toEqual(['/webhooks', '/org/webhooks', '/admin/webhooks']);
  });

  it('the hooks read endpoints, deliveries, a delivery and the catalog, and write through the mutations', async () => {
    const host = hostWith({
      'GET /org/webhooks': { items: [endpoint()] },
      [`GET /org/webhooks/${ID}`]: endpoint(),
      [`GET /org/webhooks/${ID}/deliveries`]: { items: [DELIVERY_ROW], total: 1, page: 1, pageSize: 20, totalPages: 1 },
      [`GET /org/webhooks/deliveries/${DELIVERY}`]: { ...DELIVERY_ROW, payload: {}, requestHeaders: {} },
      'GET /org/webhooks/events': { items: CATALOG },
      [`POST /org/webhooks/${ID}/test`]: { deliveryId: DELIVERY },
    });
    const { result } = renderHook(
      () => ({
        list: useWebhookEndpoints('org'),
        one: useWebhookEndpoint('org', ID),
        deliveries: useWebhookDeliveries('org', ID),
        delivery: useWebhookDelivery('org', DELIVERY),
        catalog: useWebhookEventCatalog('org'),
        mutations: useWebhookMutations('org'),
      }),
      { wrapper: wrap(host) },
    );
    await waitFor(() => expect(result.current.catalog.groups).toHaveLength(1));
    await waitFor(() => expect(result.current.delivery.delivery?.id).toBe(DELIVERY));
    expect(result.current.list.endpoints).toHaveLength(1);
    expect(result.current.one.endpoint?.name).toBe('Org Alpha receiver');
    expect(result.current.deliveries.total).toBe(1);
    let test: unknown;
    await act(async () => {
      test = await result.current.mutations.sendTest(ID);
    });
    expect(test).toEqual({ deliveryId: DELIVERY });
  });

  it('WebhooksPage takes the page slots', async () => {
    const host = hostWith({ 'GET /org/webhooks': { items: [endpoint()] } });
    render(
      <PlatformHostProvider host={host}>
        <WebhooksPage scope="org" slots={{ BeforeContent: () => <p>Receivers must be on the Org Alpha allowlist.</p> }} />
      </PlatformHostProvider>,
    );
    expect(await screen.findByText('Receivers must be on the Org Alpha allowlist.')).toBeInTheDocument();
    expect(await screen.findByText('Org Alpha receiver')).toBeInTheDocument();
  });

  it('the dialogs, the picker, the drawer and the help panel render on their own', async () => {
    const host = hostWith({ [`GET /org/webhooks/deliveries/${DELIVERY}`]: { ...DELIVERY_ROW, payload: { ok: true }, requestHeaders: {} } });
    const groups = groupWebhookEventCatalog(CATALOG);
    const onChange = vi.fn();
    const onSubmit = vi.fn();
    // One at a time: an open modal hides everything else from the accessibility tree.
    const inHost = (element: ReactElement) => render(<PlatformHostProvider host={host}>{element}</PlatformHostProvider>);

    let view = inHost(
      <>
        <WebhookEventPicker groups={groups} value={[]} onChange={onChange} />
        <WebhookSignatureHelp />
      </>,
    );
    fireEvent.click(screen.getByRole('checkbox', { name: 'Test ping' }));
    expect(onChange).toHaveBeenCalledWith(['webhooks.ping']);
    expect(screen.getByText('Verifying signatures')).toBeInTheDocument();
    view.unmount();

    view = inHost(<WebhookEndpointDialog open endpoint={null} groups={groups} onSubmit={onSubmit} onClose={() => undefined} />);
    expect(screen.getByRole('dialog', { name: 'New endpoint' })).toBeInTheDocument();
    view.unmount();

    view = inHost(<WebhookSecretDialog secret={SECRET} reason="created" onClose={() => undefined} />);
    expect(screen.getByDisplayValue(SECRET)).toBeInTheDocument();
    view.unmount();

    inHost(<WebhookDeliveryDrawer scope="org" deliveryId={DELIVERY} canWrite={false} onRedeliver={async () => true} onClose={() => undefined} />);
    expect(await screen.findByLabelText('Payload')).toHaveTextContent('"ok": true');
  });
});
