/**
 * The Manage roles dialog offers the roles it is given (PP-14.15): `UserList`
 * hands it what `GET /api/roles` says may be assigned (the system roles, and
 * outside multi-organization mode the org roles too, never `org_admin`, which
 * `admin` implies). The list-level composition is proven through the app's
 * real table in `apps/web/src/__tests__/examples/identity/app-roles.test.tsx`.
 */
import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import type { RoleDescriptor, UserListItem } from '../../src/identity/headless/index.js';
import { ManageRolesDialog } from '../../src/identity/ui/users/ManageRolesDialog.js';
import { render } from './render.js';
import { BUILTIN_ROLES } from './harness.js';

const support: RoleDescriptor = { id: 'support', label: 'Support', description: 'Reads the user list', scope: 'system', assignable: true };
const coach: RoleDescriptor = { id: 'coach', label: 'Coach', description: 'Reviews workouts', scope: 'org', assignable: true };

const USER_ROW: UserListItem = {
  id: 'u1',
  email: 'ada@example.com',
  displayName: 'Ada',
  providerDisplayName: null,
  profileImageUrl: null,
  providerProfileImageUrl: null,
  isActive: true,
  roles: ['viewer'],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

describe('ManageRolesDialog', () => {
  it('offers exactly the roles it is given, labelled, and sends the ids ticked', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn(async () => undefined);
    render(<ManageRolesDialog user={{ ...USER_ROW, roles: ['coach'] }} roles={[...BUILTIN_ROLES.filter((r) => r.id !== 'org_admin'), support, coach]} onClose={() => undefined} onSave={onSave} />);

    const dialog = await screen.findByRole('dialog');
    const labels = within(dialog).getAllByRole('checkbox').map((box) => box.closest('label')?.textContent);
    expect(labels).toEqual(['System administrator', 'Contributor', 'Viewer', 'Support', 'Coach']);
    expect(within(dialog).getByRole('checkbox', { name: 'Coach' })).toBeChecked();

    await user.click(within(dialog).getByRole('checkbox', { name: 'Support' }));
    await user.click(within(dialog).getByRole('button', { name: 'Save roles' }));

    await waitFor(() => expect(onSave).toHaveBeenCalledWith('u1', ['coach', 'support']));
  });

  it('does not carry a held role it does not offer back to the API', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn(async () => undefined);
    render(<ManageRolesDialog user={{ ...USER_ROW, roles: ['admin', 'org_admin', 'bot'] }} roles={[BUILTIN_ROLES[0]!]} onClose={() => undefined} onSave={onSave} />);

    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Save roles' }));

    await waitFor(() => expect(onSave).toHaveBeenCalledWith('u1', ['admin']));
  });
});
