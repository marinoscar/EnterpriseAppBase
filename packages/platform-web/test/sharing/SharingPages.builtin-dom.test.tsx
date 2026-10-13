/**
 * The sharing pages' and the share dialog's markup did not move (PP-14.25).
 *
 * `GroupsPage`, `GroupDetailPage` and `ShareDialog` gained slots (the
 * packaged-page slot contract, `MemberRowActions`, `Tabs`, `Sections`,
 * `Footer`). The snapshot beside this file (`__snapshots__/`) was RECORDED FROM
 * THE COMPONENTS AS THEY WERE BEFORE THAT CHANGE (the same fixtures, rendered by
 * the old ones), so passing means what a person sees with no slot passed is,
 * element for element and class for class, what they had.
 *
 * The only normalisation is React's generated ids (`_r_1f_`), which depend on
 * render order. Re-record only for a deliberate change.
 */
import { act, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { GroupDetailPage, GroupsPage, ShareDialog } from '../../src/sharing/ui/index.js';
import type { TestApiResponse } from '../../src/testing/index.js';
import { ANA, GROUP_ID, RESOURCE_ID, group, groupGrant, invite, linkGrant, member, myInvite, page, userGrant } from './fixtures.js';
import { makeHost, renderRoute } from './harness.js';

const NOW = new Date('2026-10-02T12:00:00.000Z');
const BASE = `/groups/${GROUP_ID}`;
const ROLES = [
  { value: 'viewer', label: 'Can view' },
  { value: 'editor', label: 'Can edit' },
];

const html = (root: Element): string => root.innerHTML.replace(/_r_[0-9a-z]+_/g, '_rX_');

async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 50));
  });
}

describe("the sharing pages' markup is unchanged", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
  });
  afterEach(() => vi.useRealTimers());

  it('the Groups page, an administrator', async () => {
    const host = makeHost(
      {
        'GET /groups': page([group(), group({ id: '00000000-0000-4000-8000-0000000000b9', name: 'Everyone', myRole: null, memberCount: 9, description: null })]),
        'GET /groups/invites/mine': { items: [myInvite()] },
      },
      ['groups:read', 'groups:write', 'groups:admin'],
    );
    const { container } = renderRoute(host, <GroupsPage />, '/settings/groups', '/settings/groups');
    await screen.findByText('Design team', {}, { timeout: 8000 });
    await settle();
    expect(html(container)).toMatchSnapshot();
  });

  it('the Groups page, a reader with no groups', async () => {
    const host = makeHost({ 'GET /groups': page([]), 'GET /groups/invites/mine': { items: [] } }, ['groups:read']);
    const { container } = renderRoute(host, <GroupsPage />, '/settings/groups', '/settings/groups');
    await screen.findByText('You are not in any group yet.', {}, { timeout: 8000 });
    await settle();
    expect(html(container)).toMatchSnapshot();
  });

  const detailResponses = (): Record<string, TestApiResponse> => ({
    [`GET ${BASE}`]: group(),
    [`GET ${BASE}/members`]: page([member(), member({ userId: ANA, role: 'viewer', email: 'ana@example.com', displayName: 'Ana' })]),
    [`GET ${BASE}/invites`]: page([invite()]),
  });

  it('the Group page, a group administrator', async () => {
    const { container } = renderRoute(makeHost(detailResponses()), <GroupDetailPage />, `/settings/groups/${GROUP_ID}`, '/settings/groups/:id');
    await screen.findByText('zoe@example.com', {}, { timeout: 8000 });
    await settle();
    expect(html(container)).toMatchSnapshot();
  });

  it('the Group page, a member who cannot manage it', async () => {
    const responses = detailResponses();
    responses[`GET ${BASE}`] = group({ myRole: 'viewer' });
    const { container } = renderRoute(
      makeHost(responses, ['groups:read', 'sharing:read']),
      <GroupDetailPage />,
      `/settings/groups/${GROUP_ID}`,
      '/settings/groups/:id',
    );
    await screen.findByText('Ana', {}, { timeout: 8000 });
    await settle();
    expect(html(container)).toMatchSnapshot();
  });

  it('the share dialog, people, groups and links', async () => {
    const host = makeHost({
      'GET /grants': page([userGrant(), groupGrant()]),
      'GET /groups': page([group()]),
      'GET /grants/links': [linkGrant()],
    });
    renderRoute(
      host,
      <ShareDialog open onClose={() => undefined} resource={{ type: 'transcript', id: RESOURCE_ID }} resourceTitle="Quarterly review" roles={ROLES} allowLinks />,
    );
    await screen.findByText('Ana', {}, { timeout: 8000 });
    await settle();
    expect(html(document.body)).toMatchSnapshot();
  });

  it('the share dialog, a read-only viewer with nothing shared', async () => {
    const host = makeHost({ 'GET /grants': page([]), 'GET /groups': page([]) }, ['sharing:read']);
    renderRoute(host, <ShareDialog open onClose={() => undefined} resource={{ type: 'transcript', id: RESOURCE_ID }} roles={ROLES} />);
    await screen.findByText('Not shared with anyone yet.', {}, { timeout: 8000 });
    await settle();
    expect(html(document.body)).toMatchSnapshot();
  });
});
