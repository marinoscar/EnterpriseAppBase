import { screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ShareDialog } from '../../src/sharing/ui/index.js';
import { createTestApiError } from '../../src/testing/index.js';
import type { TestApiRequest, TestApiResponse } from '../../src/testing/index.js';
import { RESOURCE_ID, TOKEN, group, groupGrant, linkGrant, page, userGrant } from './fixtures.js';
import { makeHost, renderRoute } from './harness.js';

const RESOURCE = { type: 'transcript', id: RESOURCE_ID };
const ROLES = [
  { value: 'viewer', label: 'Can view' },
  { value: 'editor', label: 'Can edit' },
];

function baseResponses(overrides: Record<string, TestApiResponse> = {}): Record<string, TestApiResponse> {
  return {
    'GET /grants': page([userGrant(), groupGrant()]),
    'GET /groups': page([group()]),
    'POST /grants': (request: TestApiRequest) => userGrant({ id: '00000000-0000-4000-8000-0000000000f3', ...(request.body as object) }),
    [`PATCH /grants/${userGrant().id}`]: userGrant({ role: 'editor' }),
    [`DELETE /grants/${userGrant().id}`]: undefined,
    'GET /grants/links': [linkGrant()],
    'POST /grants/links': { grant: linkGrant({ id: '00000000-0000-4000-8000-0000000000a8' }), url: `https://app.example.com/s#${TOKEN}`, token: TOKEN },
    [`DELETE /grants/${linkGrant().id}`]: undefined,
    ...overrides,
  };
}

function renderDialog(responses: Record<string, TestApiResponse>, props: Partial<Parameters<typeof ShareDialog>[0]> = {}) {
  const host = makeHost(responses);
  const onChanged = vi.fn();
  renderRoute(
    host,
    <ShareDialog open onClose={() => undefined} resource={RESOURCE} resourceTitle="Quarterly review" roles={ROLES} onChanged={onChanged} {...props} />,
  );
  return { host, onChanged };
}

const status = () => screen.getByTestId('share-dialog-status');

describe('ShareDialog (#731)', () => {
  afterEach(() => vi.restoreAllMocks());

  it('lists who the record is shared with, people and groups, in stacked sections without tabs', async () => {
    renderDialog(baseResponses(), { allowLinks: true });
    const dialog = await screen.findByRole('dialog', { name: 'Share "Quarterly review"' });
    const list = await within(dialog).findByRole('list', { name: 'Shared with' });
    expect(within(list).getByText('Ana')).toBeTruthy();
    expect(within(list).getByText('Design team')).toBeTruthy();
    expect(within(dialog).queryByRole('tab')).toBeNull();
    expect(within(dialog).getByRole('heading', { name: 'People and groups' })).toBeTruthy();
    expect(within(dialog).getByRole('heading', { name: 'Link' })).toBeTruthy();
  });

  it('shares with a person by e-mail with the chosen role, and announces it', async () => {
    const user = userEvent.setup();
    const { host, onChanged } = renderDialog(baseResponses());
    await screen.findByRole('list', { name: 'Shared with' });

    await user.type(screen.getByLabelText('E-mail address'), 'Zoe@Example.com');
    await user.click(screen.getAllByRole('combobox', { name: /role/i })[0]!);
    await user.click(screen.getByRole('option', { name: 'Can edit' }));
    await user.click(screen.getByRole('button', { name: 'Share' }));

    await waitFor(() => expect(host.requests.some((r) => r.method === 'POST' && r.path === '/grants')).toBe(true));
    const post = host.requests.find((r) => r.method === 'POST' && r.path === '/grants')!;
    expect(post.body).toEqual({
      resourceType: 'transcript',
      resourceId: RESOURCE_ID,
      grantee: { kind: 'user', email: 'zoe@example.com' },
      role: 'editor',
    });
    await waitFor(() => expect(status().textContent).toBe('Shared with zoe@example.com.'));
    expect(onChanged).toHaveBeenCalled();
  });

  it('validates the e-mail before sending anything', async () => {
    const user = userEvent.setup();
    const { host } = renderDialog(baseResponses());
    await screen.findByRole('list', { name: 'Shared with' });
    await user.type(screen.getByLabelText('E-mail address'), 'not-an-address');
    await user.click(screen.getByRole('button', { name: 'Share' }));
    expect(await screen.findByText('Enter a valid e-mail address.')).toBeTruthy();
    expect(host.requests.some((r) => r.method === 'POST')).toBe(false);
  });

  it('shares with a group picked from the viewer\'s groups', async () => {
    const user = userEvent.setup();
    const { host } = renderDialog(baseResponses());
    await screen.findByRole('list', { name: 'Shared with' });
    await user.click(screen.getByRole('button', { name: 'A group' }));
    await user.click(screen.getByRole('combobox', { name: /group/i }));
    await user.click(await screen.findByRole('option', { name: 'Design team' }));
    await user.click(screen.getByRole('button', { name: 'Share' }));
    await waitFor(() => expect(host.requests.some((r) => r.method === 'POST' && r.path === '/grants')).toBe(true));
    const post = host.requests.find((r) => r.method === 'POST' && r.path === '/grants')!;
    expect((post.body as { grantee: unknown }).grantee).toEqual({ kind: 'group', groupId: group().id });
  });

  it('changes a role and revokes access', async () => {
    const user = userEvent.setup();
    const { host } = renderDialog(baseResponses());
    const list = await screen.findByRole('list', { name: 'Shared with' });
    const anaRow = within(list).getByText('Ana').closest('li')!;

    await user.click(within(anaRow).getByRole('combobox'));
    await user.click(screen.getByRole('option', { name: 'Can edit' }));
    await waitFor(() => expect(host.requests.some((r) => r.method === 'PATCH')).toBe(true));
    expect(host.requests.find((r) => r.method === 'PATCH')?.body).toEqual({ role: 'editor' });
    await waitFor(() => expect(status().textContent).toBe('Ana now has the role Can edit.'));

    await user.click(within(anaRow).getByRole('button', { name: 'Remove access for Ana' }));
    await waitFor(() => expect(host.requests.some((r) => r.method === 'DELETE' && r.path === `/grants/${userGrant().id}`)).toBe(true));
    await waitFor(() => expect(status().textContent).toBe('Access removed for Ana.'));
  });

  it.each([
    [
      'a recipient that does not exist (404)',
      createTestApiError(404, 'Resource not found'),
      'Resource not found',
    ],
    [
      'an address outside the organization (422)',
      createTestApiError(422, 'That person is not a member of this organization', undefined, { reason: 'NOT_AN_ORG_MEMBER' }),
      'That person is not a member of this organization',
    ],
    [
      'a role the type does not grant (422)',
      createTestApiError(422, 'The role "editor" cannot be granted to a user on this resource type', undefined, {
        reason: 'ROLE_NOT_GRANTABLE',
        grantable: ['viewer'],
      }),
      'The role "editor" cannot be granted to a user on this resource type',
    ],
    [
      'too many failed lookups (429), with the wait in plain language',
      createTestApiError(429, 'Too many lookups of unknown addresses. Try again later.', undefined, {
        reason: 'LOOKUP_THROTTLED',
        retryAfterMs: 180_000,
      }),
      'Too many attempts. Try again in about 3 minutes.',
    ],
  ])('shows the server error for %s', async (_name, error, message) => {
    const user = userEvent.setup();
    renderDialog(
      baseResponses({
        'POST /grants': () => {
          throw error;
        },
      }),
    );
    await screen.findByRole('list', { name: 'Shared with' });
    await user.type(screen.getByLabelText('E-mail address'), 'zoe@example.com');
    await user.click(screen.getByRole('button', { name: 'Share' }));
    expect((await screen.findByTestId('share-error')).textContent).toBe(message);
  });

  it('hides the write controls without sharing:write', async () => {
    const host = makeHost(baseResponses(), ['sharing:read']);
    renderRoute(host, <ShareDialog open onClose={() => undefined} resource={RESOURCE} roles={ROLES} />);
    await screen.findByRole('list', { name: 'Shared with' });
    expect(screen.queryByLabelText('E-mail address')).toBeNull();
    expect(screen.queryByRole('button', { name: /Remove access/ })).toBeNull();
  });

  it('fetches nothing while closed', () => {
    const host = makeHost(baseResponses());
    renderRoute(host, <ShareDialog open={false} onClose={() => undefined} resource={RESOURCE} roles={ROLES} allowLinks />);
    expect(host.requests).toHaveLength(0);
  });

  describe('links', () => {
    it('has no link section without allowLinks', async () => {
      const { host } = renderDialog(baseResponses());
      await screen.findByRole('list', { name: 'Shared with' });
      expect(screen.queryByRole('heading', { name: 'Link' })).toBeNull();
      expect(host.requests.some((r) => r.path.startsWith('/grants/links'))).toBe(false);
    });

    it('lists active links with their expiry and a copyable /s# URL', async () => {
      renderDialog(baseResponses(), { allowLinks: true });
      const links = await screen.findByRole('list', { name: 'Active links' });
      const field = within(links).getByRole('textbox') as HTMLInputElement;
      expect(field.value).toMatch(/\/s#lnk_/);
      expect(field.readOnly).toBe(true);
      expect(within(links).getByText(/Expires/)).toBeTruthy();
    });

    it('creates a link with the chosen expiry and copies it', async () => {
      const user = userEvent.setup();
      const writeText = vi.fn().mockResolvedValue(undefined);
      Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
      const { host } = renderDialog(baseResponses(), { allowLinks: true });
      await screen.findByRole('list', { name: 'Active links' });

      await user.click(screen.getByRole('combobox', { name: /link expires/i }));
      await user.click(screen.getByRole('option', { name: 'Never' }));
      await user.click(screen.getByRole('button', { name: 'Create link' }));

      await waitFor(() => expect(host.requests.some((r) => r.method === 'POST' && r.path === '/grants/links')).toBe(true));
      const post = host.requests.find((r) => r.method === 'POST' && r.path === '/grants/links')!;
      expect(post.body).toEqual({ resourceType: 'transcript', resourceId: RESOURCE_ID, role: 'viewer', expiresAt: null });
      await waitFor(() => expect(writeText).toHaveBeenCalledWith(`https://app.example.com/s#${TOKEN}`));
      await waitFor(() => expect(status().textContent).toBe('Link created and copied to the clipboard.'));
    });

    it('copies an existing link, with a text fallback when the clipboard refuses', async () => {
      const user = userEvent.setup();
      const writeText = vi.fn().mockRejectedValue(new Error('denied'));
      Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
      Object.defineProperty(document, 'execCommand', { value: () => false, configurable: true });
      renderDialog(baseResponses(), { allowLinks: true });
      const links = await screen.findByRole('list', { name: 'Active links' });
      await user.click(within(links).getByRole('button', { name: 'Copy' }));
      expect(await within(links).findByText(/Select the link and copy it/)).toBeTruthy();
      expect(status().textContent).toBe('Could not copy automatically. Select the link and copy it.');
    });

    it('revokes a link', async () => {
      const user = userEvent.setup();
      const { host } = renderDialog(baseResponses(), { allowLinks: true });
      const links = await screen.findByRole('list', { name: 'Active links' });
      await user.click(within(links).getByRole('button', { name: 'Revoke' }));
      await waitFor(() => expect(host.requests.some((r) => r.method === 'DELETE' && r.path === `/grants/${linkGrant().id}`)).toBe(true));
      await waitFor(() => expect(status().textContent).toBe('Link revoked. It no longer works.'));
    });

    it('says links are not available when the links route answers 404', async () => {
      renderDialog(
        baseResponses({
          'GET /grants/links': () => {
            throw createTestApiError(404, 'Cannot GET /api/grants/links');
          },
        }),
        { allowLinks: true },
      );
      expect((await screen.findByTestId('links-unavailable')).textContent).toBe('Links are not available for this item.');
      expect(screen.queryByRole('button', { name: 'Create link' })).toBeNull();
    });
  });
});
