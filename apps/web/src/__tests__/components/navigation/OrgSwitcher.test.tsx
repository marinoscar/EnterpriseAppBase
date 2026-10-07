/**
 * `OrgSwitcher` (#726): shown only in multi-org mode to a user with two or
 * more active memberships; choosing an organization calls
 * `AuthContext.switchOrg` (which posts switch-org and refreshes the user —
 * see `contexts/AuthContext.switchOrg.test.tsx`).
 */
import { describe, it, expect, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { render as rtlRender } from '@testing-library/react';
import type { ContextType } from 'react';
import { AuthContext } from '../../../contexts/AuthContext';
import { OrgSwitcher } from '../../../components/navigation/OrgSwitcher';
import { render, mockUser } from '../../utils/test-utils';

const ALPHA = { orgId: 'org-a', name: 'Alpha', slug: 'alpha', role: 'org_admin' };
const BETA = { orgId: 'org-b', name: 'Beta', slug: 'beta', role: 'viewer' };

function withAuth(overrides: Partial<NonNullable<ContextType<typeof AuthContext>>>, tenancyMode: 'single' | 'multi') {
  const switchOrg = vi.fn().mockResolvedValue(undefined);
  const value = {
    user: { ...mockUser, tenancyMode },
    isLoading: false,
    isAuthenticated: true,
    providers: [],
    sessionExpired: false,
    login: vi.fn(),
    logout: vi.fn(),
    refreshUser: vi.fn(),
    activeOrg: { id: ALPHA.orgId, name: ALPHA.name, slug: ALPHA.slug },
    memberships: [ALPHA, BETA],
    switchOrg,
    ...overrides,
  } as unknown as ContextType<typeof AuthContext>;
  const utils = rtlRender(
    <AuthContext.Provider value={value}>
      <OrgSwitcher />
    </AuthContext.Provider>,
  );
  return { ...utils, switchOrg };
}

describe('OrgSwitcher (#726)', () => {
  it('is absent in single-org mode, whatever the memberships', () => {
    withAuth({}, 'single');
    expect(screen.queryByRole('button', { name: /switch organization/i })).not.toBeInTheDocument();
  });

  it('is absent with a single membership', () => {
    withAuth({ memberships: [ALPHA] }, 'multi');
    expect(screen.queryByRole('button', { name: /switch organization/i })).not.toBeInTheDocument();
  });

  it('is absent with the shared test fixture user (no tenancy mode)', () => {
    render(<OrgSwitcher />);
    expect(screen.queryByRole('button', { name: /switch organization/i })).not.toBeInTheDocument();
  });

  it('lists the memberships, marks the current one, and switches on choice', async () => {
    const user = userEvent.setup();
    const { switchOrg } = withAuth({}, 'multi');

    await user.click(screen.getByRole('button', { name: 'Switch organization (current: Alpha)' }));
    expect(screen.getByRole('menuitem', { name: /Alpha/ })).toHaveClass('Mui-selected');

    await user.click(screen.getByRole('menuitem', { name: /Beta/ }));

    expect(switchOrg).toHaveBeenCalledWith('org-b');
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument());
  });

  it('does not call switch-org for the organization already active', async () => {
    const user = userEvent.setup();
    const { switchOrg } = withAuth({}, 'multi');

    await user.click(screen.getByRole('button', { name: /switch organization/i }));
    await user.click(screen.getByRole('menuitem', { name: /Alpha/ }));

    expect(switchOrg).not.toHaveBeenCalled();
  });

  it("shows the API's refusal and stays open", async () => {
    const user = userEvent.setup();
    const { switchOrg } = withAuth({}, 'multi');
    switchOrg.mockRejectedValueOnce(new Error('Organization not found'));

    await user.click(screen.getByRole('button', { name: /switch organization/i }));
    await user.click(screen.getByRole('menuitem', { name: /Beta/ }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Organization not found');
  });
});
