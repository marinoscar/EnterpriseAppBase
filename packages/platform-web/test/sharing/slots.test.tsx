// The sharing pages' and the share dialog's slots (PP-14.25). The markup with
// NO slot is pinned by SharingPages.builtin-dom.test.tsx.

import { screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { GroupDetailPage, GroupsPage, PublicLinkPage, ShareDialog } from '../../src/sharing/ui/index.js';
import type { TestApiResponse } from '../../src/testing/index.js';
import { ANA, GROUP_ID, RESOURCE_ID, group, invite, member, myInvite, page, userGrant } from './fixtures.js';
import { makeHost, renderRoute } from './harness.js';

const BASE = `/groups/${GROUP_ID}`;
const ROLES = [
  { value: 'viewer', label: 'Can view' },
  { value: 'editor', label: 'Can edit' },
];

const after = (a: Element, b: Element) => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);

function detail(overrides: Record<string, TestApiResponse> = {}): Record<string, TestApiResponse> {
  return {
    [`GET ${BASE}`]: group(),
    [`GET ${BASE}/members`]: page([member(), member({ userId: ANA, role: 'viewer', email: 'ana@example.com', displayName: 'Ana' })]),
    [`GET ${BASE}/invites`]: page([invite()]),
    ...overrides,
  };
}

function renderDetail(slots: Parameters<typeof GroupDetailPage>[0]['slots'], permissions?: readonly string[]) {
  return renderRoute(makeHost(detail(), permissions), <GroupDetailPage slots={slots} />, `/settings/groups/${GROUP_ID}`, '/settings/groups/:id');
}

describe('GroupsPage slots', () => {
  it('draws the contract slots around the lists and passes the header the page words', async () => {
    const host = makeHost({ 'GET /groups': page([group()]), 'GET /groups/invites/mine': { items: [myInvite()] } });
    renderRoute(
      host,
      <GroupsPage
        slots={{
          Header: ({ title, description }) => <h1 data-testid="h">{title} - {description}</h1>,
          BeforeContent: () => <p data-testid="b">before</p>,
          Sections: ({ position }) => <p data-testid={`s-${position}`}>section</p>,
          AfterContent: () => <p data-testid="a">after</p>,
        }}
      />,
      '/settings/groups',
      '/settings/groups',
    );
    const list = await screen.findByRole('list', { name: 'Your groups' });
    expect(screen.getByTestId('h')).toHaveTextContent('Groups -');
    const order = ['h', 'b', 's-top'].map((id) => screen.getByTestId(id));
    expect(after(order[0]!, order[1]!)).toBe(true);
    expect(after(order[1]!, order[2]!)).toBe(true);
    expect(after(order[2]!, list)).toBe(true);
    expect(after(list, screen.getByTestId('s-bottom'))).toBe(true);
    expect(after(screen.getByTestId('s-bottom'), screen.getByTestId('a'))).toBe(true);
  });

  it('still accepts a Header written against the old props', async () => {
    const OldHeader = ({ title }: { title: string; description: string }) => <h1>old: {title}</h1>;
    renderRoute(makeHost({ 'GET /groups': page([]), 'GET /groups/invites/mine': { items: [] } }), <GroupsPage slots={{ Header: OldHeader }} />, '/settings/groups', '/settings/groups');
    expect(await screen.findByRole('heading', { name: 'old: Groups' })).toBeInTheDocument();
  });
});

describe('GroupDetailPage slots', () => {
  it('passes the header the group as title and description, with the back path', async () => {
    renderDetail({
      Header: ({ title, description, group: g, backPath }) => (
        <h1 data-testid="h">
          {String(title)} | {String(description)} | {g.id === GROUP_ID ? 'group' : '?'} | {backPath}
        </h1>
      ),
    });
    expect(await screen.findByTestId('h')).toHaveTextContent('Design team | People who review mockups | group | /settings/groups');
  });

  it('draws the page slots in order, with Sections around the members and invitations', async () => {
    renderDetail({
      BeforeContent: () => <p data-testid="b">before</p>,
      Sections: ({ position }) => <p data-testid={`s-${position}`}>section</p>,
      AfterContent: () => <p data-testid="a">after</p>,
    });
    const members = await screen.findByRole('table', { name: 'Members' });
    expect(after(screen.getByTestId('b'), screen.getByTestId('s-top'))).toBe(true);
    expect(after(screen.getByTestId('s-top'), members)).toBe(true);
    expect(after(members, screen.getByTestId('s-bottom'))).toBe(true);
    expect(after(screen.getByTestId('s-bottom'), screen.getByTestId('a'))).toBe(true);
  });

  it('adds member row actions, for a manager and for a plain member', async () => {
    const seen: string[] = [];
    const slots = {
      MemberRowActions: ({ member: m, isSelf, canManage }: { member: { email: string }; isSelf: boolean; canManage: boolean }) => {
        seen.push(`${m.email}:${isSelf}:${canManage}`);
        return <button type="button">Message {m.email}</button>;
      },
    };
    const first = renderDetail(slots);
    const table = await screen.findByRole('table', { name: 'Members' });
    expect(within(table).getByRole('button', { name: 'Message ana@example.com' })).toBeInTheDocument();
    // The built-in remove button is still there for the other member.
    expect(within(table).getByRole('button', { name: 'Remove Ana' })).toBeInTheDocument();
    expect(seen).toContain('ana@example.com:false:true');
    expect(seen).toContain('me@example.com:true:true');
    first.unmount();

    // A viewer cannot manage the group but still gets the app's row action.
    renderRoute(
      makeHost({ ...detail(), [`GET ${BASE}`]: group({ myRole: 'viewer' }) }, ['groups:read', 'sharing:read']),
      <GroupDetailPage slots={slots} />,
      `/settings/groups/${GROUP_ID}`,
      '/settings/groups/:id',
    );
    const readerTable = await screen.findByRole('table', { name: 'Members' });
    expect(within(readerTable).getByRole('button', { name: 'Message ana@example.com' })).toBeInTheDocument();
    expect(within(readerTable).queryByRole('button', { name: 'Remove Ana' })).toBeNull();
  });

  it('turns members and invitations into tabs when the app adds a tab, and keeps them stacked otherwise', async () => {
    const Activity = ({ group: g }: { group: { name: string } }) => <p>activity of {g.name}</p>;
    const tabbed = renderDetail({ Tabs: [{ id: 'activity', label: 'Activity', Panel: Activity }] });
    const tabs = await screen.findAllByRole('tab');
    expect(tabs.map((tab) => tab.textContent)).toEqual(['Members', 'Invitations', 'Activity']);
    expect(await screen.findByRole('table', { name: 'Members' })).toBeInTheDocument();
    expect(screen.queryByRole('table', { name: 'Pending invitations' })).toBeNull();
    await userEvent.click(screen.getByRole('tab', { name: 'Invitations' }));
    expect(await screen.findByRole('table', { name: 'Pending invitations' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('tab', { name: 'Activity' }));
    expect(await screen.findByText('activity of Design team')).toBeInTheDocument();
    tabbed.unmount();

    renderDetail({ Tabs: [] });
    expect(await screen.findByRole('table', { name: 'Members' })).toBeInTheDocument();
    expect(screen.queryAllByRole('tab')).toHaveLength(0);
  });

  it('offers no Invitations tab to someone who is not a group admin', async () => {
    const Activity = () => <p>activity</p>;
    renderRoute(
      makeHost({ ...detail(), [`GET ${BASE}`]: group({ myRole: 'viewer' }) }, ['groups:read', 'sharing:read']),
      <GroupDetailPage slots={{ Tabs: [{ id: 'activity', label: 'Activity', Panel: Activity }] }} />,
      `/settings/groups/${GROUP_ID}`,
      '/settings/groups/:id',
    );
    const tabs = await screen.findAllByRole('tab');
    expect(tabs.map((tab) => tab.textContent)).toEqual(['Members', 'Activity']);
  });
});

describe('ShareDialog slots', () => {
  const responses = { 'GET /grants': page([userGrant()]), 'GET /groups': page([group()]) };

  it('draws Sections at both ends of the body with the record, and Footer before Done', async () => {
    let closed = 0;
    renderRoute(
      makeHost(responses),
      <ShareDialog
        open
        onClose={() => {
          closed += 1;
        }}
        resource={{ type: 'transcript', id: RESOURCE_ID }}
        resourceTitle="Quarterly review"
        roles={ROLES}
        slots={{
          Sections: ({ position, resource, canWrite, resourceTitle }) =>
            position === 'top' ? (
              <section aria-label="Expiry policy">
                <h3>Expiry policy for {resource.type} ({String(canWrite)}) {resourceTitle}</h3>
              </section>
            ) : (
              <section aria-label="Audit">
                <h3>Audit</h3>
              </section>
            ),
          Footer: ({ onClose }) => (
            <button type="button" onClick={onClose}>
              Copy summary
            </button>
          ),
        }}
      />,
    );
    const dialog = await screen.findByRole('dialog', { name: 'Share "Quarterly review"' });
    await within(dialog).findByRole('list', { name: 'Shared with' });
    const top = within(dialog).getByRole('region', { name: 'Expiry policy' });
    const people = within(dialog).getByRole('heading', { name: 'People and groups' });
    const bottom = within(dialog).getByRole('region', { name: 'Audit' });
    expect(top).toHaveTextContent('Expiry policy for transcript (true) Quarterly review');
    expect(after(top, people)).toBe(true);
    expect(after(people, bottom)).toBe(true);
    // Footer sits in the action row before "Done".
    const copy = within(dialog).getByRole('button', { name: 'Copy summary' });
    const done = within(dialog).getByRole('button', { name: 'Done' });
    expect(after(copy, done)).toBe(true);
    await userEvent.click(copy);
    await waitFor(() => expect(closed).toBe(1));
  });

  it('draws nothing extra when a Sections slot returns null for a position', async () => {
    renderRoute(
      makeHost(responses),
      <ShareDialog
        open
        onClose={() => undefined}
        resource={{ type: 'transcript', id: RESOURCE_ID }}
        roles={ROLES}
        slots={{ Sections: ({ position }) => (position === 'bottom' ? <p>only at the bottom</p> : null) }}
      />,
    );
    await screen.findByRole('list', { name: 'Shared with' });
    expect(screen.getAllByText('only at the bottom')).toHaveLength(1);
  });
});

describe('PublicLinkPage slots', () => {
  it('draws the page slots around the neutral message inside the frame', async () => {
    renderRoute(
      makeHost({}),
      <PublicLinkPage
        slots={{
          Header: ({ title }) => <h2 data-testid="h">{String(title)}</h2>,
          BeforeContent: () => <p data-testid="b">before</p>,
          Sections: ({ position }) => <p data-testid={`s-${position}`}>s</p>,
          AfterContent: () => <p data-testid="a">after</p>,
        }}
      />,
      '/s',
      '/s',
    );
    const message = await screen.findByTestId('public-link-unavailable');
    expect(screen.getByTestId('h')).toHaveTextContent('Shared with you');
    expect(after(screen.getByTestId('b'), screen.getByTestId('s-top'))).toBe(true);
    expect(after(screen.getByTestId('s-top'), message)).toBe(true);
    expect(after(message, screen.getByTestId('s-bottom'))).toBe(true);
    expect(after(screen.getByTestId('s-bottom'), screen.getByTestId('a'))).toBe(true);
  });
});
