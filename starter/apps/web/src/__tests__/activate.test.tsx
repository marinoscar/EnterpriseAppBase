// `<cli> login` (and the Android app) send people to /activate?code=…
// (#1170, #1172). This renders the REAL app root and the REAL platform device
// approval page; only the sign-in gate and the network are stubbed. The page
// sits outside the shell, so its API client must come from the root: without
// it the page threw "useIdentityApi: no identity client" and rendered blank.
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Outlet } from 'react-router-dom';
import { vi } from 'vitest';

vi.mock('@marinoscar/platform-web/identity/headless', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  RequireAuth: () => <Outlet />,
}));

import App from '../App';

describe('/activate', () => {
  it('renders the platform device approval page with its API client', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 401, headers: { 'content-type': 'application/json' } })));
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { container } = render(
      <MemoryRouter initialEntries={['/activate?code=B3JD-VPSB']}>
        <App />
      </MemoryRouter>,
    );
    expect(await screen.findByRole('heading')).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/no identity client/);
    expect(errors.mock.calls.flat().map(String).join(' ')).not.toMatch(/no identity client/);
    errors.mockRestore();
    vi.unstubAllGlobals();
  });
});
