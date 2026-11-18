// The OAuth server's headless side (PP-15.7, #1185): the client's routes, the
// status probe behind the `oauthServer` settings feature, and the hooks.

import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';

import { PlatformHostProvider } from '../../src/core/index.js';
import {
  AuthContext,
  OAuthServerStatusProvider,
  createOAuthServerApi,
  useOAuthClients,
  useOAuthGrants,
  useOAuthRequest,
  useOAuthServerFeature,
  useOAuthServerStatus,
} from '../../src/identity/headless/index.js';
import type { AuthUser } from '../../src/identity/headless/index.js';
import { createTestApiError, createTestPlatformHost } from '../../src/testing/index.js';
import type { TestApiResponse } from '../../src/testing/index.js';
import { USER, authValue } from './harness.js';
import { REQUEST_ID, client, consentRequest, grant } from './oauth-fixtures.js';

function wrapper(responses: Record<string, TestApiResponse>, user: AuthUser | null = USER, withStatus = false) {
  const host = createTestPlatformHost({ responses });
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <AuthContext.Provider value={authValue({ user })}>
        <PlatformHostProvider host={host}>
          {withStatus ? <OAuthServerStatusProvider>{children}</OAuthServerStatusProvider> : children}
        </PlatformHostProvider>
      </AuthContext.Provider>
    );
  }
  return { host, Wrapper };
}

describe('createOAuthServerApi', () => {
  it('calls the documented routes', async () => {
    const host = createTestPlatformHost({
      responses: {
        [`GET /oauth/requests/${REQUEST_ID}`]: consentRequest(),
        [`POST /oauth/requests/${REQUEST_ID}/decision`]: { redirectTo: 'https://callback.example.test/cb' },
        'GET /oauth/grants': [],
        'DELETE /oauth/grants/g1': undefined,
        'GET /oauth/.well-known/authorization-server': { issuer: 'https://app.example.test' },
        'GET /admin/oauth/clients': { items: [], total: 0, page: 1, pageSize: 20, totalPages: 0 },
        'POST /admin/oauth/clients': client(),
        'PATCH /admin/oauth/clients/c1': client(),
        'POST /admin/oauth/clients/c1/rotate-secret': client(),
        'DELETE /admin/oauth/clients/c1': undefined,
        'GET /system-settings': { oauthServer: { enabled: true }, version: 3 },
        'PATCH /system-settings': { oauthServer: { enabled: false }, version: 4 },
      },
    });
    const oauth = createOAuthServerApi(host.api);
    await oauth.getRequest(REQUEST_ID);
    await oauth.approveRequest(REQUEST_ID, { scopes: ['a'], orgId: 'o1' });
    await oauth.denyRequest(REQUEST_ID);
    await oauth.listGrants();
    await oauth.revokeGrant('g1');
    await oauth.getServerMetadata();
    await oauth.listClients({ page: 2, pageSize: 10, kind: 'cimd', search: 'desk' });
    await oauth.createClient({ name: 'n', redirectUris: ['https://x.example.test/cb'], tokenEndpointAuthMethod: 'none' });
    await oauth.setClientDisabled('c1', true);
    await oauth.rotateClientSecret('c1');
    await oauth.deleteClient('c1');
    expect(await oauth.getServerSettings()).toEqual({ settings: { enabled: true }, version: 3 });
    expect(await oauth.updateServerSettings({ enabled: false }, 3)).toEqual({ settings: { enabled: false }, version: 4 });
    expect(host.requests.map((r) => `${r.method} ${r.path}`)).toEqual([
      `GET /oauth/requests/${REQUEST_ID}`,
      `POST /oauth/requests/${REQUEST_ID}/decision`,
      `POST /oauth/requests/${REQUEST_ID}/decision`,
      'GET /oauth/grants',
      'DELETE /oauth/grants/g1',
      'GET /oauth/.well-known/authorization-server',
      'GET /admin/oauth/clients?page=2&pageSize=10&kind=cimd&search=desk',
      'POST /admin/oauth/clients',
      'PATCH /admin/oauth/clients/c1',
      'POST /admin/oauth/clients/c1/rotate-secret',
      'DELETE /admin/oauth/clients/c1',
      'GET /system-settings',
      'PATCH /system-settings',
    ]);
    expect(host.requests[1]?.body).toEqual({ decision: 'approve', scopes: ['a'], orgId: 'o1' });
    expect(host.requests[2]?.body).toEqual({ decision: 'deny' });
    expect(host.requests[8]?.body).toEqual({ disabled: true });
    expect(host.requests[12]).toMatchObject({ body: { oauthServer: { enabled: false } }, ifMatch: '3' });
  });
});

describe('OAuthServerStatusProvider and the oauthServer feature', () => {
  it('is on with the issuer when the metadata document answers', async () => {
    const { Wrapper } = wrapper({ 'GET /oauth/.well-known/authorization-server': { issuer: 'https://app.example.test' } }, USER, true);
    const { result } = renderHook(() => ({ status: useOAuthServerStatus(), on: useOAuthServerFeature() }), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.on).toBe(true));
    expect(result.current.status.issuer).toBe('https://app.example.test');
  });

  it('is off when the document answers 404, and null before the probe', async () => {
    const { Wrapper } = wrapper({}, USER, true);
    const { result } = renderHook(() => useOAuthServerStatus(), { wrapper: Wrapper });
    expect(result.current.enabled).toBeNull();
    await waitFor(() => expect(result.current.enabled).toBe(false));
  });

  it('is off and never probes while signed out', async () => {
    const { Wrapper, host } = wrapper({ 'GET /oauth/.well-known/authorization-server': { issuer: 'x' } }, null, true);
    const { result } = renderHook(() => useOAuthServerFeature(), { wrapper: Wrapper });
    await waitFor(() => expect(result.current).toBe(false));
    expect(host.requests).toEqual([]);
  });

  it('is off without a provider (fail closed)', () => {
    const { Wrapper } = wrapper({});
    const { result } = renderHook(() => useOAuthServerFeature(), { wrapper: Wrapper });
    expect(result.current).toBe(false);
  });
});

describe('the OAuth hooks', () => {
  it('useOAuthRequest reads the request and treats 404 as expired', async () => {
    const ok = wrapper({ [`GET /oauth/requests/${REQUEST_ID}`]: consentRequest() });
    const ready = renderHook(() => useOAuthRequest(REQUEST_ID), { wrapper: ok.Wrapper });
    await waitFor(() => expect(ready.result.current.status).toBe('ready'));
    expect(ready.result.current.request?.client.host).toBe('chat.example.test');

    const gone = wrapper({});
    const expired = renderHook(() => useOAuthRequest(REQUEST_ID), { wrapper: gone.Wrapper });
    await waitFor(() => expect(expired.result.current.status).toBe('expired'));

    const broken = wrapper({
      [`GET /oauth/requests/${REQUEST_ID}`]: () => {
        throw createTestApiError(500, 'Boom');
      },
    });
    const failed = renderHook(() => useOAuthRequest(REQUEST_ID), { wrapper: broken.Wrapper });
    await waitFor(() => expect(failed.result.current.status).toBe('error'));
    expect(failed.result.current.error).toBe('Boom');
  });

  it('useOAuthGrants lists and reports a disabled server', async () => {
    const ok = wrapper({ 'GET /oauth/grants': [grant()] });
    const listed = renderHook(() => useOAuthGrants(), { wrapper: ok.Wrapper });
    await waitFor(() => expect(listed.result.current.grants).toHaveLength(1));
    const off = wrapper({});
    const unavailable = renderHook(() => useOAuthGrants(), { wrapper: off.Wrapper });
    await waitFor(() => expect(unavailable.result.current.unavailable).toBe(true));
  });

  it('useOAuthClients pages one-based and resets to page 1 on a search', async () => {
    const { Wrapper, host } = wrapper({ 'GET /admin/oauth/clients': { items: [client()], total: 1, page: 1, pageSize: 20, totalPages: 1 } });
    const { result } = renderHook(() => useOAuthClients(), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.clients).toHaveLength(1));
    result.current.setPagination({ page: 3, pageSize: 50 });
    await waitFor(() => expect(host.requests.at(-1)?.path).toBe('/admin/oauth/clients?page=3&pageSize=50'));
    result.current.setSearch('desk');
    await waitFor(() => expect(host.requests.at(-1)?.path).toBe('/admin/oauth/clients?page=1&pageSize=50&search=desk'));
  });
});
