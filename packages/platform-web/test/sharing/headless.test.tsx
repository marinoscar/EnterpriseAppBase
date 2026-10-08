import { render, renderHook, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';

import { PlatformHostProvider } from '../../src/core/index.js';
import {
  createSharingClient,
  describeRetryAfter,
  toSharingError,
  useGroups,
  useSharedWithMe,
} from '../../src/sharing/headless/index.js';
import { SharedWithMeList } from '../../src/sharing/ui/index.js';
import { createTestApiError, createTestPlatformHost } from '../../src/testing/index.js';
import { RESOURCE_ID, group, linkGrant, page, sharedItem } from './fixtures.js';

describe('toSharingError (#731)', () => {
  it('keeps the API message and reads details.reason', () => {
    const error = toSharingError(createTestApiError(409, 'No admin left', 'CONFLICT', { reason: 'LAST_GROUP_ADMIN' }));
    expect(error).toMatchObject({ message: 'No admin left', status: 409, reason: 'LAST_GROUP_ADMIN', retryAfterSeconds: null });
  });

  it('turns a 429 into its wait in plain language', () => {
    const error = toSharingError(createTestApiError(429, 'Throttled', undefined, { reason: 'LOOKUP_THROTTLED', retryAfterMs: 90_000 }));
    expect(error.retryAfterSeconds).toBe(90);
    expect(error.message).toBe('Too many attempts. Try again in about 2 minutes.');
    expect(toSharingError(createTestApiError(429, 'Throttled')).message).toBe('Too many attempts. Wait a little, then try again.');
  });

  it('gives a network failure the fallback and no status', () => {
    expect(toSharingError(new TypeError('Failed to fetch'), 'Could not share.')).toMatchObject({ message: 'Could not share.', status: null });
  });

  it('describes waits', () => {
    expect(describeRetryAfter(5)).toBe('a few seconds');
    expect(describeRetryAfter(60)).toBe('about a minute');
    expect(describeRetryAfter(600)).toBe('about 10 minutes');
    expect(describeRetryAfter(7200)).toBe('about 2 hours');
  });
});

describe('createSharingClient (#731)', () => {
  it('builds the contract paths, encodes ids and moves with custom paths', async () => {
    const host = createTestPlatformHost({
      responses: {
        'GET /g/x%2Fy': group(),
        'GET /share': page([]),
        'GET /share/links': { items: [linkGrant(), linkGrant({ id: 'revoked', revokedAt: '2026-10-02T00:00:00.000Z' })] },
        'POST /share/links': linkGrant(),
      },
    });
    const client = createSharingClient(host.api, { groups: '/g', grants: '/share' });
    await client.getGroup('x/y');
    await client.listGrants({ type: 'transcript', id: RESOURCE_ID });
    expect(host.requests[1]?.path).toBe(`/share?resourceType=transcript&resourceId=${RESOURCE_ID}`);

    // A link list as a page or an array; only active links.
    const links = await client.listLinkGrants({ type: 'transcript', id: RESOURCE_ID });
    expect(links.map((link) => link.id)).toEqual([linkGrant().id]);

    // A create response that is the view itself.
    const issued = await client.createLinkGrant({ type: 'transcript', id: RESOURCE_ID });
    expect(issued.url).toBe(linkGrant().url);
    expect(issued.token).toBeNull();
  });
});

describe('read hooks (#731)', () => {
  it('useGroups loads, refreshes and reports a failure as a SharingError', async () => {
    let fail = true;
    const host = createTestPlatformHost({
      responses: {
        'GET /groups': () => {
          if (fail) throw createTestApiError(403, 'Missing permission: groups:admin');
          return page([group()]);
        },
      },
    });
    const { result } = renderHook(() => useGroups('all'), {
      wrapper: ({ children }) => <PlatformHostProvider host={host}>{children}</PlatformHostProvider>,
    });
    await waitFor(() => expect(result.current.error?.status).toBe(403));
    expect(host.requests[0]?.path).toBe('/groups?scope=all&page=1&pageSize=100');
    fail = false;
    await result.current.refresh();
    await waitFor(() => expect(result.current.data?.items).toHaveLength(1));
    expect(result.current.error).toBeNull();
  });

  it('useSharedWithMe filters by type', async () => {
    const host = createTestPlatformHost({ responses: { 'GET /grants/shared-with-me': page([sharedItem()]) } });
    const { result } = renderHook(() => useSharedWithMe('transcript'), {
      wrapper: ({ children }) => <PlatformHostProvider host={host}>{children}</PlatformHostProvider>,
    });
    await waitFor(() => expect(result.current.data?.items).toHaveLength(1));
    expect(host.requests[0]?.path).toBe('/grants/shared-with-me?resourceType=transcript&page=1&pageSize=100');
  });

  it('throws a clear error without a host or a client', () => {
    expect(() => renderHook(() => useGroups())).toThrow(/PlatformHostProvider/);
  });
});

describe('SharedWithMeList (#731)', () => {
  it('groups items by resource type, with the describe titles and app paths', async () => {
    const host = createTestPlatformHost({
      responses: {
        'GET /grants/shared-with-me': page([
          sharedItem(),
          sharedItem({ grantId: 'g2', resourceType: 'album', title: null, path: null, via: 'group_grant', resourceId: '12345678-0000-4000-8000-000000000000' }),
        ]),
      },
    });
    render(
      <MemoryRouter>
        <PlatformHostProvider host={host}>
          <SharedWithMeList
            typeLabels={{ transcript: 'Transcripts' }}
            roleLabels={{ viewer: 'Can view' }}
            resolvePath={(type, id) => (type === 'album' ? `/albums/${id}` : `/t/${id}`)}
          />
        </PlatformHostProvider>
      </MemoryRouter>,
    );
    const transcripts = await screen.findByRole('list', { name: 'Transcripts' });
    expect(within(transcripts).getByRole('link', { name: /Quarterly review/ }).getAttribute('href')).toBe(`/t/${RESOURCE_ID}`);
    expect(within(transcripts).getByText(/Can view/)).toBeTruthy();
    const albums = screen.getByRole('list', { name: 'Album' });
    expect(within(albums).getByRole('link', { name: /Album 12345678/ }).getAttribute('href')).toBe('/albums/12345678-0000-4000-8000-000000000000');
    expect(within(albums).getByText(/through a group/)).toBeTruthy();
  });

  it('says when nothing is shared', async () => {
    const host = createTestPlatformHost({ responses: { 'GET /grants/shared-with-me': page([]) } });
    render(
      <MemoryRouter>
        <PlatformHostProvider host={host}>
          <SharedWithMeList />
        </PlatformHostProvider>
      </MemoryRouter>,
    );
    expect(await screen.findByText('Nothing is shared with you yet.')).toBeTruthy();
  });
});
