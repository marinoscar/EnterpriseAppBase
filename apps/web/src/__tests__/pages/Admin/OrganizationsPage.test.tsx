/**
 * `pages/Admin/OrganizationsPage` (#726): the deployment's organizations.
 * Create and rename are disabled without `organizations:write`; creating
 * sends the name, the slug and the first administrator's email.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { render, mockAdminUser, type MockUser } from '../../utils/test-utils';
import OrganizationsPage from '../../../pages/Admin/OrganizationsPage';
import * as service from '../../../services/organizations';

vi.mock('../../../services/organizations', async () => {
  const actual = await vi.importActual<typeof import('../../../services/organizations')>(
    '../../../services/organizations',
  );
  return { ...actual, getOrganizations: vi.fn(), createOrganization: vi.fn(), renameOrganization: vi.fn() };
});

const orgs: service.Organization[] = [
  { id: 'org-default', name: 'Default organization', slug: 'default', isDefault: true, memberCount: 3, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' },
  { id: 'org-b', name: 'Beta', slug: 'beta', isDefault: false, memberCount: 1, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' },
];

function operator(permissions: string[]): MockUser {
  return { ...mockAdminUser, permissions, tenancyMode: 'multi' };
}

describe('OrganizationsPage (#726)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(service.getOrganizations).mockResolvedValue({ items: orgs, total: 2, page: 1, pageSize: 100, totalPages: 1 });
    vi.mocked(service.createOrganization).mockResolvedValue(orgs[1]);
    vi.mocked(service.renameOrganization).mockResolvedValue(orgs[1]);
  });

  it('lists organizations with member counts and the default marked', async () => {
    render(<OrganizationsPage />, { wrapperOptions: { user: operator(['organizations:read', 'organizations:write']) } });

    const row = await screen.findByTestId('org-org-default');
    expect(within(row).getByText('Default')).toBeInTheDocument();
    expect(within(row).getByText(/3 members/)).toBeInTheDocument();
    expect(within(screen.getByTestId('org-org-b')).getByText(/1 member$/)).toBeInTheDocument();
  });

  it('creates an organization, suggesting the slug from the name', async () => {
    const user = userEvent.setup();
    render(<OrganizationsPage />, { wrapperOptions: { user: operator(['organizations:read', 'organizations:write']) } });

    await user.click(await screen.findByRole('button', { name: 'Create organization' }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText(/^Name/), 'Gamma Corp');
    expect(within(dialog).getByLabelText(/^Slug/)).toHaveValue('gamma-corp');
    await user.type(within(dialog).getByLabelText(/First administrator/), 'boss@gamma.example');
    await user.click(within(dialog).getByRole('button', { name: 'Create' }));

    await waitFor(() =>
      expect(service.createOrganization).toHaveBeenCalledWith({
        name: 'Gamma Corp',
        slug: 'gamma-corp',
        firstAdminEmail: 'boss@gamma.example',
      }),
    );
  });

  it('renames an organization', async () => {
    const user = userEvent.setup();
    render(<OrganizationsPage />, { wrapperOptions: { user: operator(['organizations:read', 'organizations:write']) } });

    await user.click(within(await screen.findByTestId('org-org-b')).getByRole('button', { name: 'Rename' }));
    const dialog = await screen.findByRole('dialog');
    const name = within(dialog).getByLabelText(/^Name/);
    await user.clear(name);
    await user.type(name, 'Beta Inc');
    await user.click(within(dialog).getByRole('button', { name: 'Rename' }));

    await waitFor(() => expect(service.renameOrganization).toHaveBeenCalledWith('org-b', 'Beta Inc'));
  });

  it('disables create and rename without organizations:write', async () => {
    render(<OrganizationsPage />, { wrapperOptions: { user: operator(['organizations:read']) } });

    const row = await screen.findByTestId('org-org-b');
    expect(screen.getByRole('button', { name: 'Create organization' })).toBeDisabled();
    expect(within(row).getByRole('button', { name: 'Rename' })).toBeDisabled();
  });

  it("shows the API's refusal in the create dialog", async () => {
    const user = userEvent.setup();
    vi.mocked(service.createOrganization).mockRejectedValue(new Error('An organization with the slug "beta" already exists'));
    render(<OrganizationsPage />, { wrapperOptions: { user: operator(['organizations:read', 'organizations:write']) } });

    await user.click(await screen.findByRole('button', { name: 'Create organization' }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText(/^Name/), 'Beta');
    await user.type(within(dialog).getByLabelText(/First administrator/), 'x@example.com');
    await user.click(within(dialog).getByRole('button', { name: 'Create' }));

    expect(await within(dialog).findByText(/already exists/)).toBeInTheDocument();
  });
});
