/**
 * PP-14.16. The grantee-picker example (../../../platform-extensions/sharing/
 * TeamGranteePicker.example.tsx) in the real `ShareDialog` on the reference
 * app's platform host, against the API's wire shapes (msw): the dialog lists the
 * kinds from `GET /sharing/grantee-kinds`, renders the registered picker for a
 * `custom` kind, a text field for a `text` kind, and is unchanged when the API
 * lists only the built-ins.
 */

import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import type { GranteeKindDescriptor } from '@marinoscar/platform-contract/sharing';
import { GranteePickerRegistry } from '@marinoscar/platform-web/sharing/headless';
import { ShareDialog } from '@marinoscar/platform-web/sharing/ui';

import { registerAppGranteePickers } from '../../../platform/granteePickers';
import { TeamGranteePicker } from '../../../platform-extensions/sharing/TeamGranteePicker.example';
import { server } from '../../mocks/server';
import { mockUser, renderWithProviders } from '../../utils/test-utils';
import { NOTE_ID, SHARING_PERMISSIONS, group, page, userGrant } from './fixtures';

const BUILTINS: GranteeKindDescriptor[] = [
  { kind: 'user', label: 'Person', description: null, input: 'user-search', builtin: true, persisted: true },
  { kind: 'group', label: 'Group', description: null, input: 'group-select', builtin: true, persisted: true },
  { kind: 'link', label: 'Link', description: null, input: 'none', builtin: true, persisted: true },
];
const TEAM: GranteeKindDescriptor = { kind: 'team', label: 'Team', description: 'Everyone on one team.', input: 'custom', builtin: false, persisted: true };
const DOMAIN: GranteeKindDescriptor = { kind: 'email-domain', label: 'Email domain', description: null, input: 'text', builtin: false, persisted: true };

const user = { ...mockUser, permissions: [...mockUser.permissions, ...SHARING_PERMISSIONS] };

function serve(extra: GranteeKindDescriptor[], posts: unknown[] = []) {
  server.use(
    http.get('*/api/sharing/grantee-kinds', () => HttpResponse.json({ data: { items: [...BUILTINS, ...extra] } })),
    http.get('*/api/grants', () => HttpResponse.json({ data: page([userGrant()]) })),
    http.get('*/api/groups', () => HttpResponse.json({ data: page([group()]) })),
    http.post('*/api/grants', async ({ request }) => {
      const body = (await request.json()) as Record<string, unknown>;
      posts.push(body);
      return HttpResponse.json({ data: userGrant({ id: '00000000-0000-4000-8000-0000000000f3', role: body.role as string }) });
    }),
  );
}

const roles = [{ value: 'viewer', label: 'Can view' }, { value: 'editor', label: 'Can edit' }];

describe('grantee picker example (PP-14.16)', () => {
  it('renders the registered picker for a custom kind and sends the grantee it reports', async () => {
    const posts: unknown[] = [];
    serve([TEAM], posts);
    const pickers = new GranteePickerRegistry();
    pickers.register('team', TeamGranteePicker);
    const actor = userEvent.setup();
    renderWithProviders(<ShareDialog open onClose={() => undefined} resource={{ type: 'example_note', id: NOTE_ID }} roles={roles} granteePickers={pickers} />, {
      wrapperOptions: { user },
    });
    const dialog = await screen.findByRole('dialog');
    await within(dialog).findByRole('list', { name: 'Shared with' });
    await actor.click(await within(dialog).findByRole('button', { name: 'Team' }));
    await actor.click(within(dialog).getByRole('combobox', { name: 'Team' }));
    await actor.click(await screen.findByRole('option', { name: 'Platform' }));
    await actor.click(within(dialog).getByRole('button', { name: /^share$/i }));
    await waitFor(() =>
      expect(posts).toContainEqual({
        resourceType: 'example_note',
        resourceId: NOTE_ID,
        grantee: { kind: 'custom', granteeKind: 'team', ref: 'team-platform' },
        role: 'viewer',
      }),
    );
  });

  it('offers a text kind as a plain field, and a custom kind with no picker not at all', async () => {
    serve([DOMAIN, TEAM]);
    renderWithProviders(
      <ShareDialog open onClose={() => undefined} resource={{ type: 'example_note', id: NOTE_ID }} roles={roles} granteePickers={new GranteePickerRegistry()} />,
      { wrapperOptions: { user } },
    );
    const dialog = await screen.findByRole('dialog');
    await within(dialog).findByRole('button', { name: 'Email domain' });
    expect(within(dialog).queryByRole('button', { name: 'Team' })).toBeNull();
  });

  it('shows only A person and A group when the API lists the built-ins', async () => {
    serve([]);
    renderWithProviders(<ShareDialog open onClose={() => undefined} resource={{ type: 'example_note', id: NOTE_ID }} roles={roles} />, { wrapperOptions: { user } });
    const dialog = await screen.findByRole('dialog');
    await within(dialog).findByRole('list', { name: 'Shared with' });
    expect(within(dialog).getAllByRole('button').filter((b) => b.getAttribute('aria-pressed') !== null).map((b) => b.textContent)).toEqual(['A person', 'A group']);
  });

  it('freezes the app registry at start-up: a late registration is refused', async () => {
    registerAppGranteePickers();
    const { registerGranteePicker } = await import('@marinoscar/platform-web/sharing/headless');
    expect(() => registerGranteePicker('team', TeamGranteePicker)).toThrow(/frozen/i);
  });
});
