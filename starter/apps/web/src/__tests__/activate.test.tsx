// `<cli> login` (and the Android app) send people to /activate?code=…:
// the route must render the platform's device approval page for a signed-in
// user, not fall through to the catch-all redirect home.
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Outlet } from 'react-router-dom';
import { vi } from 'vitest';

vi.mock('@marinoscar/platform-web/identity/headless', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  RequireAuth: () => <Outlet />,
}));
vi.mock('@marinoscar/platform-web/identity/ui', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  ActivateDevicePage: () => <h1>Approve this device</h1>,
}));

import { AppRoutes } from '../App';

describe('/activate', () => {
  it('renders the device approval page with the code from the CLI', () => {
    render(
      <MemoryRouter initialEntries={['/activate?code=B3JD-VPSB']}>
        <AppRoutes />
      </MemoryRouter>,
    );
    expect(screen.getByRole('heading', { name: 'Approve this device' })).toBeInTheDocument();
  });
});
