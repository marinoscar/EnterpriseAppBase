// The webhooks UI (issue #1046): the list with status in words, the create
// flow that shows the secret exactly once, the event picker's wildcards, the
// deliveries table with the drawer and Redeliver, rotate and delete behind a
// confirmation, the read-only view, and the cards as data.
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { WebhookEventPicker, WebhooksPage, webhooksAdminSections, webhooksUserSettingsSections } from '../../src/webhooks/ui/index.js';
import { groupWebhookEventCatalog } from '../../src/webhooks/headless/index.js';
import { CATALOG, DELIVERY_ID, ENDPOINT_ID, SECRET, delivery, deliveryDetail, endpoint, hostWith, renderWith } from './fixtures.js';
import { render } from '@testing-library/react';
import { useState } from 'react';

import { setViewportWidth } from '../viewport.js';

const LIST = 'GET /webhooks';
const ONE = `GET /webhooks/${ENDPOINT_ID}`;
const DELIVERIES = `GET /webhooks/${ENDPOINT_ID}/deliveries`;
const PAGE = { items: [delivery()], total: 1, page: 1, pageSize: 20, totalPages: 1 };

/** On a phone a row's actions sit behind its "Row actions" menu. */
async function viewDelivery() {
  fireEvent.click((await screen.findAllByRole('button', { name: /^Row actions/ }))[0]!);
  fireEvent.click(await screen.findByRole('menuitem', { name: /View delivery/ }));
}

async function openEndpoint() {
  fireEvent.click(await screen.findByRole('button', { name: 'Receiver for Org Alpha' }));
  await screen.findByRole('heading', { name: 'Receiver for Org Alpha', level: 2 });
}

describe('WebhooksPage: the list', () => {
  it('shows each endpoint with its host, events and status, including why the platform paused it', async () => {
    const host = hostWith({
      [LIST]: {
        items: [
          endpoint(),
          endpoint({ id: 'b', name: 'Paused receiver', enabled: false, disabledReason: 'circuit_open', eventKeys: ['*'] }),
          endpoint({ id: 'c', name: 'Gone receiver', enabled: false, disabledReason: 'gone' }),
          endpoint({ id: 'd', name: 'Orphaned receiver', enabled: false, disabledReason: 'owner_lost_access' }),
        ],
      },
    });
    renderWith(host, <WebhooksPage scope="user" />);
    expect(await screen.findByText('Paused after repeated failures')).toBeInTheDocument();
    expect(screen.getByText('Endpoint gone')).toBeInTheDocument();
    expect(screen.getByText('Owner lost access')).toBeInTheDocument();
    expect(screen.getAllByText('receiver.example.test').length).toBeGreaterThan(0);
    expect(screen.getByText('All events')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Webhooks', level: 1 })).toBeInTheDocument();
    expect(screen.getByText('Verifying signatures')).toBeInTheDocument();
  });

  it('reads the scope routes it was given', async () => {
    const host = hostWith({ 'GET /admin/webhooks': { items: [] } }, ['system_webhooks:read']);
    renderWith(host, <WebhooksPage scope="system" />);
    expect(await screen.findByText(/No endpoints yet/)).toBeInTheDocument();
    // (The table's own layout preference read, `GET /user-settings`, is the datatable slice's.)
    expect(host.requests.filter((r) => r.path !== '/user-settings').map((r) => `${r.method} ${r.path}`)).toEqual(['GET /admin/webhooks']);
  });
});

describe('WebhooksPage: create shows the secret once', () => {
  it('creates the endpoint from the form, shows the secret with a copy button, and forgets it on Done', async () => {
    const created = endpoint({ eventKeys: ['nodes.*'] });
    let listed: unknown[] = [];
    const host = hostWith({
      [LIST]: () => ({ items: listed }),
      'GET /webhooks/events': { items: CATALOG },
      'POST /webhooks': () => {
        listed = [created];
        return { endpoint: created, secret: SECRET };
      },
      [ONE]: created,
      [DELIVERIES]: { items: [], total: 0, page: 1, pageSize: 20, totalPages: 0 },
    });
    renderWith(host, <WebhooksPage scope="user" />);

    fireEvent.click(await screen.findByRole('button', { name: 'New endpoint' }));
    const dialog = await screen.findByRole('dialog', { name: 'New endpoint' });
    fireEvent.change(within(dialog).getByLabelText(/^Name/), { target: { value: 'Receiver for Org Alpha' } });
    fireEvent.change(within(dialog).getByLabelText(/^URL/), { target: { value: 'https://receiver.example.test/hook' } });
    fireEvent.click(await within(dialog).findByRole('checkbox', { name: /All Nodes events/ }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create endpoint' }));

    const reveal = await screen.findByRole('dialog', { name: 'Endpoint created' });
    expect(within(reveal).getByDisplayValue(SECRET)).toBeInTheDocument();
    expect(within(reveal).getByText(/You won.t see it again/)).toBeInTheDocument();
    expect(within(reveal).getByRole('button', { name: 'Copy signing secret' })).toBeInTheDocument();
    expect(host.requests.find((r) => r.method === 'POST')?.body).toEqual({
      name: 'Receiver for Org Alpha',
      url: 'https://receiver.example.test/hook',
      description: null,
      enabled: true,
      eventKeys: ['nodes.*'],
    });

    fireEvent.click(within(reveal).getByRole('button', { name: 'Done' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Endpoint created' })).toBeNull());
    expect(screen.queryByDisplayValue(SECRET)).toBeNull();
    // The new endpoint is open, and nothing on the page carries the secret any more.
    expect(await screen.findByRole('heading', { name: 'Receiver for Org Alpha', level: 2 })).toBeInTheDocument();
    expect(document.body.textContent).not.toContain(SECRET);
  });

  it('keeps the dialog open with the API refusal in words', async () => {
    const { createTestApiError } = await import('../../src/testing/index.js');
    const host = hostWith({
      [LIST]: { items: [] },
      'GET /webhooks/events': { items: CATALOG },
      'POST /webhooks': () => {
        throw createTestApiError(422, 'nope', 'WEBHOOK_URL_FORBIDDEN');
      },
    });
    renderWith(host, <WebhooksPage scope="user" />);
    fireEvent.click(await screen.findByRole('button', { name: 'New endpoint' }));
    const dialog = await screen.findByRole('dialog', { name: 'New endpoint' });
    fireEvent.change(within(dialog).getByLabelText(/^Name/), { target: { value: 'Internal' } });
    fireEvent.change(within(dialog).getByLabelText(/^URL/), { target: { value: 'https://receiver.example.test/hook' } });
    fireEvent.click(await within(dialog).findByRole('checkbox', { name: /^All events/ }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create endpoint' }));
    expect(await within(dialog).findByText(/private or internal address/)).toBeInTheDocument();
  });
});

describe('WebhookEventPicker', () => {
  const groups = groupWebhookEventCatalog(CATALOG);
  function Harness({ initial }: { initial: string[] }) {
    const [value, setValue] = useState<string[]>(initial);
    return (
      <>
        <WebhookEventPicker groups={groups} value={value} onChange={setValue} />
        <output aria-label="value">{JSON.stringify(value)}</output>
      </>
    );
  }
  const value = () => JSON.parse(screen.getByLabelText('value').textContent ?? '[]') as string[];

  it('selects a group as group.*, and expands it when one event is unticked', () => {
    render(<Harness initial={[]} />);
    fireEvent.click(screen.getByRole('checkbox', { name: /All Nodes events \(nodes\.\*\)/ }));
    expect(value()).toEqual(['nodes.*']);
    expect(screen.getByRole('checkbox', { name: 'Node went offline' })).toBeChecked();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Node went offline' }));
    expect(value()).toEqual(['nodes.node.event']);
  });

  it('writes * for every event and disables the rest while it is on', () => {
    render(<Harness initial={['jobs.job.failed']} />);
    fireEvent.click(screen.getByRole('checkbox', { name: /^All events/ }));
    expect(value()).toEqual(['*']);
    expect(screen.getByRole('checkbox', { name: 'Job failed' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Job failed' })).toBeDisabled();
  });

  it('filters by search and lists subscriptions the catalog does not know', () => {
    render(<Harness initial={['billing.invoice.paid']} />);
    expect(screen.getByText('billing.invoice.paid')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Search events'), { target: { value: 'ping' } });
    expect(screen.getByRole('checkbox', { name: 'Test ping' })).toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: 'Job failed' })).toBeNull();
  });
});

describe('WebhooksPage: an endpoint, at phone width', () => {
  // A phone: the deliveries table draws its card list (the drawer is full width).
  beforeEach(() => setViewportWidth(375));

  function detailHost(permissions?: readonly string[]) {
    return hostWith(
      {
        [LIST]: { items: [endpoint()] },
        [ONE]: endpoint(),
        [DELIVERIES]: PAGE,
        [`GET /webhooks/deliveries/${DELIVERY_ID}`]: deliveryDetail(),
        [`POST /webhooks/deliveries/${DELIVERY_ID}/redeliver`]: undefined,
        [`POST /webhooks/${ENDPOINT_ID}/test`]: { deliveryId: DELIVERY_ID },
        [`POST /webhooks/${ENDPOINT_ID}/rotate-secret`]: {
          secret: SECRET,
          secretVersion: 2,
          previousSecretValidUntil: '2026-11-02T09:00:00.000Z',
        },
        [`DELETE /webhooks/${ENDPOINT_ID}`]: undefined,
      },
      permissions,
    );
  }

  it('lists deliveries, opens one in the drawer and redelivers it', async () => {
    const host = detailHost();
    renderWith(host, <WebhooksPage scope="user" />);
    await openEndpoint();
    expect(await screen.findByText('nodes.node.offline')).toBeInTheDocument();
    expect(screen.getByText('Failed')).toBeInTheDocument();
    expect(screen.getByText('500')).toBeInTheDocument();

    await viewDelivery();
    const drawer = await screen.findByRole('dialog', { name: 'Delivery details' });
    expect(await within(drawer).findByLabelText('Payload')).toHaveTextContent('"nodeName": "Node P1"');
    expect(within(drawer).getByText('upstream unavailable')).toBeInTheDocument();
    expect(within(drawer).getByText('webhook-id')).toBeInTheDocument();

    fireEvent.click(within(drawer).getByRole('button', { name: 'Redeliver' }));
    await waitFor(() =>
      expect(host.requests.some((r) => r.method === 'POST' && r.path === `/webhooks/deliveries/${DELIVERY_ID}/redeliver`)).toBe(true),
    );
    // The table reloads after the redelivery.
    await waitFor(() => expect(host.requests.filter((r) => r.path.startsWith(`/webhooks/${ENDPOINT_ID}/deliveries`)).length).toBeGreaterThan(1));
  });

  it('sends a test event and says so', async () => {
    const host = detailHost();
    renderWith(host, <WebhooksPage scope="user" />);
    await openEndpoint();
    fireEvent.click(screen.getByRole('button', { name: 'Send test event' }));
    expect(await screen.findByText(/Test event queued/)).toBeInTheDocument();
  });

  it('rotates the secret only after a confirmation that explains the 24 hour overlap, then shows it once', async () => {
    const host = detailHost();
    renderWith(host, <WebhooksPage scope="user" />);
    await openEndpoint();
    fireEvent.click(screen.getByRole('button', { name: 'Rotate secret' }));
    const confirm = await screen.findByRole('dialog', { name: 'Rotate the signing secret?' });
    expect(confirm).toHaveTextContent('24 hours');
    expect(host.requests.some((r) => r.path.endsWith('/rotate-secret'))).toBe(false);
    fireEvent.click(within(confirm).getByRole('button', { name: 'Rotate secret' }));
    const reveal = await screen.findByRole('dialog', { name: 'Secret rotated' });
    expect(within(reveal).getByDisplayValue(SECRET)).toBeInTheDocument();
  });

  it('deletes only after a confirmation', async () => {
    const host = detailHost();
    renderWith(host, <WebhooksPage scope="user" />);
    await openEndpoint();
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    const confirm = await screen.findByRole('dialog', { name: 'Delete this endpoint?' });
    fireEvent.click(within(confirm).getByRole('button', { name: 'Delete endpoint' }));
    expect(await screen.findByText('Endpoint deleted.')).toBeInTheDocument();
    expect(host.requests.some((r) => r.method === 'DELETE' && r.path === `/webhooks/${ENDPOINT_ID}`)).toBe(true);
  });

  it('is read-only without the write permission: no create, test, edit, rotate, delete or redeliver', async () => {
    const host = detailHost(['webhooks:read']);
    renderWith(host, <WebhooksPage scope="user" />);
    expect(await screen.findByRole('heading', { name: 'Webhooks (read-only)', level: 1 })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'New endpoint' })).toBeNull();
    await openEndpoint();
    for (const name of ['Send test event', 'Edit', 'Rotate secret', 'Delete']) {
      expect(screen.queryByRole('button', { name })).toBeNull();
    }
    await viewDelivery();
    const drawer = await screen.findByRole('dialog', { name: 'Delivery details' });
    await within(drawer).findByLabelText('Payload');
    expect(within(drawer).queryByRole('button', { name: 'Redeliver' })).toBeNull();
    // The catalog is never fetched for a viewer who cannot edit.
    expect(host.requests.some((r) => r.path.endsWith('/events'))).toBe(false);
  });

  it('checks the org scope against org_webhooks:write', async () => {
    const host = hostWith({ 'GET /org/webhooks': { items: [] } }, ['org_webhooks:read', 'webhooks:write']);
    renderWith(host, <WebhooksPage scope="org" />);
    expect(await screen.findByRole('heading', { name: 'Organization webhooks (read-only)', level: 1 })).toBeInTheDocument();
  });
});

describe('the webhooks cards as data', () => {
  it('declares the exact permission strings and the org feature gate', () => {
    expect(webhooksUserSettingsSections.integrations.map(({ title, path, permission, feature }) => ({ title, path, permission, feature }))).toEqual([
      { title: 'Webhooks', path: '/settings/webhooks', permission: 'webhooks:read', feature: undefined },
    ]);
    expect(webhooksAdminSections.operations.map(({ path, permission, feature }) => ({ path, permission, feature }))).toEqual([
      { path: '/admin/settings/webhooks', permission: 'system_webhooks:read', feature: undefined },
    ]);
    expect(webhooksAdminSections.organizations.map(({ path, permission, feature }) => ({ path, permission, feature }))).toEqual([
      { path: '/admin/settings/organization-webhooks', permission: 'org_webhooks:read', feature: 'orgs' },
    ]);
  });
});
