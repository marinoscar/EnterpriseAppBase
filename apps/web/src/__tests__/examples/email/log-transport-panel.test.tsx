/**
 * Issue #926 (PP-14.8): an email transport an app registered shows up on the
 * admin email page with no web code.
 *
 * The reference app registers `log`
 * (apps/api/src/platform-extensions/email/log-transport.ts) with
 * `registerEmailTransport`. The API describes it in `GET /api/email-settings`
 * (`descriptors`, `transports`), and the packaged page draws a generated form
 * from that descriptor. Nothing is mocked but the network (MSW), so the test
 * proves the wire: selecting the transport and editing its one setting saves as
 * `{ provider: 'log', transports: { log: { keep } } }`, the optional sink token
 * (a secret) goes out write-only under `secrets.log.sinkToken`, never in the
 * settings and never back in the markup, and a registered panel replaces the
 * generated form (`registerEmailTransportPanel`).
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import EmailSettingsPage from '@marinoscar/platform-web/email/ui';
import { registerEmailTransportPanel } from '@marinoscar/platform-web/email/ui/transport-panels';
import { render, mockAdminUser } from '../../utils/test-utils';
import { server } from '../../mocks/server';
import { emailSettingsWithLogTransport } from '../../mocks/fixtures/email';

const TYPED_SECRET = 'sink-token-asm-example-NEVER-RENDERED-0001';

interface Captured {
  method: string;
  path: string;
  body: Record<string, unknown>;
  ifMatch: string | null;
}

describe('log on the admin email page (#926)', () => {
  let captured: Captured[];
  const settings = emailSettingsWithLogTransport({ version: 4 });

  beforeEach(() => {
    server.resetHandlers();
    captured = [];
    server.use(
      http.get('*/api/email-settings', () => HttpResponse.json({ data: settings })),
      http.put('*/api/email-settings', async ({ request }) => {
        const body = (await request.json()) as Record<string, unknown>;
        captured.push({ method: request.method, path: new URL(request.url).pathname, body, ifMatch: request.headers.get('If-Match') });
        return HttpResponse.json({
          data: {
            ...settings,
            provider: body.provider,
            transports: { ...settings.transports, ...(body.transports as object) },
            // The secret the admin typed is now stored: the response says so, as a status, never a value.
            secretStatuses: { ...settings.secretStatuses, log: { sinkToken: { configured: true, hint: '••••0001', updatedAt: null, updatedByUserId: 'admin-user-id' } } },
            version: 5,
          },
        });
      }),
      http.post('*/api/email-settings/test', () =>
        HttpResponse.json({
          data: {
            success: true,
            sentTo: 'admin@example.com',
            providerKind: 'log',
            messageId: 'log-1',
            error: null,
            attemptedAt: '2026-01-01T00:00:00.000Z',
          },
        }),
      ),
    );
  });

  async function renderPage() {
    const user = userEvent.setup();
    render(<EmailSettingsPage />, { wrapperOptions: { user: mockAdminUser } });
    await screen.findByRole('radio', { name: 'Log (in memory)' });
    return user;
  }

  it('lists the transport beside the built-ins, labelled by the transport', async () => {
    await renderPage();

    const group = screen.getByRole('radiogroup', { name: 'Provider' });
    expect(within(group).getAllByRole('radio').map((el) => el.closest('label')?.textContent)).toEqual(['Amazon SES', 'SMTP', 'Log (in memory)']);
  });

  it('selects the transport, edits its setting and saves { provider, transports } with the loaded version', async () => {
    const user = await renderPage();

    await user.click(screen.getByRole('radio', { name: 'Log (in memory)' }));
    const keep = await screen.findByLabelText('Messages kept');
    expect(screen.getByText(/Nothing leaves this server/)).toBeInTheDocument();
    await user.clear(keep);
    await user.type(keep, '25');
    await user.click(screen.getByRole('button', { name: /save changes/i }));

    await waitFor(() => expect(captured).toHaveLength(1));
    expect(captured[0]).toMatchObject({
      method: 'PUT',
      path: '/api/email-settings',
      ifMatch: '4',
      body: { provider: 'log', enabled: true, transports: { log: { keep: 25 } } },
    });
    expect(captured[0]!.body).not.toHaveProperty('secrets');
  });

  it('takes the sink token write-only under secrets.log.sinkToken, and never renders it back', async () => {
    const user = await renderPage();

    await user.click(screen.getByRole('radio', { name: 'Log (in memory)' }));
    const token = await screen.findByLabelText(/Sink token/);
    expect(token).toHaveAttribute('type', 'password');
    expect(token).toHaveValue('');
    await user.type(token, TYPED_SECRET);
    await user.click(screen.getByRole('button', { name: /save changes/i }));

    await waitFor(() => expect(captured).toHaveLength(1));
    expect(captured[0]!.body).toMatchObject({ provider: 'log', secrets: { log: { sinkToken: TYPED_SECRET } } });
    // The settings never carry it.
    expect(JSON.stringify(captured[0]!.body.transports)).not.toContain(TYPED_SECRET);
    // After the save the box is empty again and the transport shows as saved, not as a value.
    await waitFor(() => expect(screen.getByLabelText(/Sink token/)).toHaveValue(''));
    expect(document.body.innerHTML).not.toContain(TYPED_SECRET);
  });

  it('names the transport in the test result', async () => {
    const user = await renderPage();

    // The test sends with the SAVED configuration: it is offered for the stored (SMTP) one.
    await user.click(screen.getByRole('button', { name: /send test email/i }));

    expect(await screen.findByText('Test email accepted by the provider')).toBeInTheDocument();
    expect(screen.getByText(/via Log \(in memory\)/)).toBeInTheDocument();
  });

  // LAST ON PURPOSE: a registration outlives the test that made it, and every test above draws the generated form.
  it('draws a panel the app registered instead of the generated form', async () => {
    registerEmailTransportPanel('log', ({ descriptor, value }) => (
      <div data-testid="app-log-panel">
        {descriptor.label}: keeping {String(value.keep)} messages
      </div>
    ));
    const user = await renderPage();

    await user.click(screen.getByRole('radio', { name: 'Log (in memory)' }));

    expect(await screen.findByTestId('app-log-panel')).toHaveTextContent('Log (in memory): keeping 100 messages');
    expect(screen.queryByLabelText('Messages kept')).not.toBeInTheDocument();
  });
});
