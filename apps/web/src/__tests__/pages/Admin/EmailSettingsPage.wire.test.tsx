/**
 * `/admin/settings/email` — the blank-password WIRE contract (issue #124,
 * epic #109, restating #115; secrets by transport since PP-14.8).
 *
 * A typed secret goes out as `secrets.<transport>.<name>` (the SMTP password
 * is `secrets.smtp.password`); a blank one is not sent at all, so blank
 * PRESERVES the stored one.
 *
 * Deliberately NOT mocking `useEmailSettings`: the key-omission behaviour
 * lives in the page's own `toInput()`, which the hook just forwards
 * unchanged. Asserting it therefore means capturing the ACTUAL HTTP request
 * body a real save produces — `usePermissions` and `useAuth` are real too
 * (via `mockAdminUser`), and only the network is faked, with MSW.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { render, mockAdminUser } from '../../utils/test-utils';
import { server } from '../../mocks/server';
import { withTransportFields } from '../../mocks/fixtures/email';
import EmailSettingsPage from '@marinoscar/platform-web/email/ui';
import type { EmailSettings } from '@marinoscar/platform-web/email/headless';

const storedSettings: EmailSettings = withTransportFields({
  provider: 'smtp',
  enabled: true,
  fromAddress: 'no-reply@example.com',
  fromName: 'Example App',
  smtpHost: 'smtp.example.com',
  smtpPort: 587,
  smtpUsername: 'relay-user',
  smtpUseTls: true,
  smtpPasswordStatus: {
    configured: true,
    hint: '••••ab12',
    updatedAt: '2024-01-01T00:00:00.000Z',
    updatedByUserId: 'admin-user-id',
  },
  settingsError: null,
  version: 3,
  updatedAt: '2024-01-01T00:00:00.000Z',
  updatedBy: { id: 'admin-user-id', email: 'admin@example.com' },
});

function mockGet() {
  server.use(
    http.get('*/api/email-settings', () => HttpResponse.json({ data: storedSettings })),
  );
}

function mockPut(onBody: (body: Record<string, unknown>) => void) {
  server.use(
    http.put('*/api/email-settings', async ({ request }) => {
      const body = (await request.json()) as Record<string, unknown>;
      onBody(body);
      return HttpResponse.json({
        data: { ...storedSettings, ...body, version: storedSettings.version + 1 },
      });
    }),
  );
}

describe('EmailSettingsPage — save request wire contract', () => {
  beforeEach(() => {
    server.resetHandlers();
    mockGet();
  });

  it('submitting with the password field left empty omits the secret from the request body entirely', async () => {
    let capturedBody: Record<string, unknown> | null = null;
    mockPut((body) => {
      capturedBody = body;
    });

    const user = userEvent.setup();
    render(<EmailSettingsPage />, { wrapperOptions: { user: mockAdminUser } });

    // Wait for the real hook's initial GET to land and the form to mount.
    await screen.findByLabelText(/from name/i);

    // Dirty the form WITHOUT touching the password field.
    await user.type(screen.getByLabelText(/from name/i), ' Edited');

    await user.click(screen.getByRole('button', { name: /save changes/i }));

    await waitFor(() => expect(capturedBody).not.toBeNull());
    expect(capturedBody).not.toBeNull();
    expect(Object.prototype.hasOwnProperty.call(capturedBody as object, 'secrets')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(capturedBody as object, 'smtpPassword')).toBe(false);
    expect(JSON.stringify(capturedBody)).not.toContain('password');
  });

  it('typing a new password DOES include it, under secrets.smtp.password, with the typed value', async () => {
    let capturedBody: Record<string, unknown> | null = null;
    mockPut((body) => {
      capturedBody = body;
    });

    const user = userEvent.setup();
    render(<EmailSettingsPage />, { wrapperOptions: { user: mockAdminUser } });

    await screen.findByLabelText(/^password$/i);

    await user.type(screen.getByLabelText(/^password$/i), 'a-freshly-typed-password');
    await user.click(screen.getByRole('button', { name: /save changes/i }));

    await waitFor(() => expect(capturedBody).not.toBeNull());
    expect((capturedBody as unknown as { secrets?: unknown })?.secrets).toEqual({
      smtp: { password: 'a-freshly-typed-password' },
    });
  });

  it('saves { provider, enabled, from*, transports: { <selected>: settings } }: only the selected transport', async () => {
    let capturedBody: Record<string, unknown> | null = null;
    mockPut((body) => {
      capturedBody = body;
    });

    const user = userEvent.setup();
    render(<EmailSettingsPage />, { wrapperOptions: { user: mockAdminUser } });
    await screen.findByLabelText(/from name/i);

    await user.type(screen.getByLabelText(/from name/i), ' Edited');
    await user.click(screen.getByRole('button', { name: /save changes/i }));

    await waitFor(() => expect(capturedBody).not.toBeNull());
    expect(capturedBody).toEqual({
      provider: 'smtp',
      enabled: true,
      fromAddress: 'no-reply@example.com',
      fromName: 'Example App Edited',
      transports: { smtp: { host: 'smtp.example.com', port: 587, useTls: true, username: 'relay-user' } },
    });
  });
});
