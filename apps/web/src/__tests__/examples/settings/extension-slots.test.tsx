/**
 * PP-14.21: an app extends the packaged settings controls with no package edit.
 *
 *   - `profile.timezone` through the profile card's `ExtraFields` slot
 *     (`platform-extensions/settings/TimezoneField.example.tsx`; the API side
 *     is `extendUserProfile`),
 *   - a theme registered with `registerThemePreference`, offered by the
 *     appearance page from the settings document's `themeOptions`,
 *   - an org settings field the page cannot draw, drawn by a registered
 *     renderer (`SlowQueryField.example.tsx`).
 *
 * The REAL packaged pages render over MSW responses. Without the slot, the
 * themes or the renderer, the pages are what they always were.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';

import { OrgSettingsPage, UserAppearancePage, UserProfilePage } from '@marinoscar/platform-web/settings/ui';
import { render, mockAdminUser, mockUser } from '../../utils/test-utils';
import { server } from '../../mocks/server';
import { SlowQueryField, registerSlowQueryField } from '../../../platform-extensions/settings/SlowQueryField.example';
import { TimezoneField } from '../../../platform-extensions/settings/TimezoneField.example';

const API_BASE = '*/api';

const document_ = (extra: Record<string, unknown> = {}, profile: Record<string, unknown> = {}) => ({
  theme: 'system',
  profile: { displayName: 'Ada', imageSource: 'none', imageObjectId: null, ...profile },
  updatedAt: '2026-10-10T00:00:00.000Z',
  version: 3,
  ...extra,
});

let patches: unknown[];

function serveUserSettings(initial: Record<string, unknown>) {
  patches = [];
  server.use(
    http.get(`${API_BASE}/user-settings`, () => HttpResponse.json({ data: initial })),
    http.patch(`${API_BASE}/user-settings`, async ({ request }) => {
      const body = (await request.json()) as { theme?: string; profile?: Record<string, unknown> };
      patches.push(body);
      const profile = { ...(initial.profile as Record<string, unknown>) };
      for (const [key, value] of Object.entries(body.profile ?? {})) {
        if (value === null) delete profile[key];
        else profile[key] = value;
      }
      return HttpResponse.json({ data: { ...initial, theme: body.theme ?? initial.theme, profile, version: 4 } });
    }),
  );
}

describe('the profile card with an app ExtraFields slot (profile.timezone)', () => {
  beforeEach(() => server.resetHandlers());

  it('draws the stored time zone, saves it with the display name and clears it with null', async () => {
    serveUserSettings(document_({}, { timezone: 'Europe/Paris' }));
    render(<UserProfilePage slots={{ ExtraFields: TimezoneField }} />, { wrapperOptions: { user: mockUser, route: '/settings/profile' } });

    const field = await screen.findByLabelText('Time zone');
    expect(field).toHaveValue('Europe/Paris');
    const save = screen.getByRole('button', { name: 'Save Changes' });
    expect(save).toBeDisabled();

    await userEvent.clear(field);
    await userEvent.type(field, 'America/New_York');
    await userEvent.click(save);
    await waitFor(() => expect(patches).toHaveLength(1));
    expect(patches[0]).toEqual({ profile: { displayName: 'Ada', timezone: 'America/New_York' } });

    await waitFor(() => expect(screen.getByLabelText('Time zone')).toHaveValue('America/New_York'));
    await userEvent.clear(screen.getByLabelText('Time zone'));
    await userEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
    await waitFor(() => expect(patches).toHaveLength(2));
    expect(patches[1]).toEqual({ profile: { displayName: 'Ada', timezone: null } });
  });

  it('is the card it always was without the slot', async () => {
    serveUserSettings(document_({}, { timezone: 'Europe/Paris' }));
    render(<UserProfilePage />, { wrapperOptions: { user: mockUser, route: '/settings/profile' } });
    await screen.findByLabelText('Display Name');
    expect(screen.queryByLabelText('Time zone')).not.toBeInTheDocument();
  });
});

describe('the appearance page with a registered theme', () => {
  beforeEach(() => server.resetHandlers());

  it('offers the themes the API lists and saves the chosen id', async () => {
    serveUserSettings(document_({ themeOptions: [{ id: 'high-contrast', label: 'High contrast' }] }));
    render(<UserAppearancePage />, { wrapperOptions: { user: mockUser, route: '/settings/appearance' } });

    await userEvent.click(await screen.findByRole('button', { name: 'High contrast theme' }));
    await waitFor(() => expect(patches).toEqual([{ theme: 'high-contrast' }]));
  });

  it('offers only light, dark and system when the API lists none', async () => {
    serveUserSettings(document_());
    render(<UserAppearancePage />, { wrapperOptions: { user: mockUser, route: '/settings/appearance' } });
    await screen.findByRole('button', { name: 'light mode' });
    expect(screen.getAllByRole('button').map((button) => button.getAttribute('aria-label'))).toEqual(['light mode', 'dark mode', 'system preference']);
  });
});

describe('the organization settings page with a registered field renderer', () => {
  const payload = {
    orgId: '11111111-1111-4111-8111-111111111111',
    value: {},
    effective: { telemetry: { query: { maxRows: 10000, timeoutSeconds: 30, slowQuerySeconds: 10 } } },
    version: 0,
    updatedAt: null,
    namespaces: [
      {
        key: 'telemetry',
        description: 'Telemetry policy.',
        merge: 'tighten',
        writable: true,
        fields: [{ name: 'query', kind: 'other' }],
      },
    ],
  };
  let bodies: unknown[];
  let unregister: (() => void) | undefined;

  beforeEach(() => {
    bodies = [];
    server.use(
      http.get(`${API_BASE}/org-settings`, () => HttpResponse.json({ data: payload })),
      http.patch(`${API_BASE}/org-settings`, async ({ request }) => {
        bodies.push(await request.json());
        return HttpResponse.json({ data: { ...payload, version: 1 } });
      }),
    );
  });
  afterEach(() => unregister?.());

  const orgAdmin = { ...mockAdminUser, permissions: [...mockAdminUser.permissions, 'org_settings:read', 'org_settings:write'] };

  it('says the field is managed elsewhere until the app registers a renderer', async () => {
    render(<OrgSettingsPage />, { wrapperOptions: { user: orgAdmin, route: '/admin/settings/organization-settings' } });
    expect(await screen.findByText(/query: managed by the slice's own settings page/)).toBeInTheDocument();
  });

  it('draws the app control and sends the nested value', async () => {
    unregister = registerSlowQueryField();
    render(<OrgSettingsPage />, { wrapperOptions: { user: orgAdmin, route: '/admin/settings/organization-settings' } });

    const input = await screen.findByLabelText('Slow query threshold (seconds)');
    expect(input).toHaveAttribute('placeholder', '10');
    await userEvent.type(input, '5');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(bodies).toEqual([{ telemetry: { query: { slowQuerySeconds: 5 } } }]));
    expect(SlowQueryField).toBeTypeOf('function');
  });
});
