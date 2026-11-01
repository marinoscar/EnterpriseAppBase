/**
 * The timezone slice as an app uses it (`@marinoscar/platform-web/timezone/*`):
 * the user's saved zone reaches the display-zone store (`UserTimeZoneSync`,
 * mounted in `App.tsx`), the formatters and `useDisplayTimeZone` render in it,
 * and the profile card's time zone row saves a zone picked on the map's dialog.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';

import {
  UserTimeZoneSync,
  formatDateTime,
  getPreferredTimeZone,
  setPreferredTimeZone,
  useDisplayTimeZone,
} from '@marinoscar/platform-web/timezone/headless';
import { TimeZoneMap } from '@marinoscar/platform-web/timezone/ui';
import { UserProfilePage } from '@marinoscar/platform-web/settings/ui';
import { appPlatformApi } from '../../../platform/platformHost';
import { render, mockUser } from '../../utils/test-utils';
import { server } from '../../mocks/server';

const API_BASE = '*/api';
const MOMENT = '2026-01-15T18:30:00.000Z';

const document_ = (profile: Record<string, unknown> = {}) => ({
  theme: 'system',
  profile: { displayName: 'Ada', imageSource: 'none', imageObjectId: null, ...profile },
  updatedAt: '2026-10-10T00:00:00.000Z',
  version: 3,
});

let patches: unknown[];

beforeEach(() => {
  patches = [];
  server.use(
    http.get(`${API_BASE}/user-settings`, () => HttpResponse.json({ data: document_({ timezone: 'America/Costa_Rica' }) })),
    http.patch(`${API_BASE}/user-settings`, async ({ request }) => {
      const body = (await request.json()) as { profile?: Record<string, unknown> };
      patches.push(body);
      return HttpResponse.json({ data: { ...document_(), profile: { ...document_().profile, ...body.profile }, version: 4 } });
    }),
  );
});
afterEach(() => setPreferredTimeZone(null));

function Clock() {
  const zone = useDisplayTimeZone();
  return <p>{`${zone}: ${formatDateTime(MOMENT, { locale: 'en-US' }).replace(/\s/g, ' ')}`}</p>;
}

describe('the display time zone', () => {
  it('loads the signed-in user’s zone and renders times in it', async () => {
    render(
      <>
        <UserTimeZoneSync api={appPlatformApi} />
        <Clock />
      </>,
      { wrapperOptions: { user: mockUser } },
    );
    expect(await screen.findByText('America/Costa_Rica: Jan 15, 2026, 12:30 PM')).toBeInTheDocument();
  });

  it('draws the selected zone on the world map', () => {
    render(<TimeZoneMap value="Asia/Tokyo" />);
    expect(screen.getByRole('img', { name: /Selected: Tokyo, Japan/ })).toBeInTheDocument();
  });
});

describe('the profile card time zone row', () => {
  it('saves a zone picked in the dialog and applies it at once', async () => {
    render(<UserProfilePage />, { wrapperOptions: { user: mockUser, route: '/settings/profile' } });
    await waitFor(() => expect(screen.getByTestId('time-zone-readout')).toHaveTextContent(/^America\/Costa_Rica/));

    await userEvent.click(screen.getByRole('button', { name: 'Change time zone' }));
    const dialog = await screen.findByRole('dialog', { name: 'Select your time zone' });
    await userEvent.type(within(dialog).getByRole('combobox', { name: 'Search time zones' }), 'Tokyo');
    await userEvent.click(await screen.findByRole('option', { name: /Tokyo/ }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    await userEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
    await waitFor(() => expect(patches).toEqual([{ profile: { displayName: 'Ada', timezone: 'Asia/Tokyo' } }]));
    await waitFor(() => expect(getPreferredTimeZone()).toBe('Asia/Tokyo'));
  });
});
