// Scope availability (#1215) at the consent page (readRequest), the decision (decide), and across the whole
// flow: authorize -> readRequest -> decide -> resolve. Mocked Prisma; the OAuthTokenService exchange is
// covered elsewhere, so the cross-flow builds the access-token row from what decide granted.
import { ConfigService } from '@nestjs/config';
import { BadRequestException } from '@nestjs/common';

import { withTemporaryEntries } from '../../../src/core/index';
import {
  OAuthTokenResolver,
  oauthResourceRegistry,
  oauthScopeRegistry,
  recordTenancyMode,
  type OAuthScopeDefinition,
} from '../../../src/identity/index';
import { OAuthAuthorizationService } from '../../../src/identity/oauth-server/oauth-authorization.service';
import { OAuthServerContext } from '../../../src/identity/oauth-server/oauth-server-context';
import { createOAuthTestPkce } from '../../../src/identity/testing/oauth';
import { APP_URL, NOTES_RESOURCE, tokenRow, userGraph } from './support';

const ORG_A = '00000000-0000-4000-8000-0000000000aa';
const ORG_B = '00000000-0000-4000-8000-0000000000bb';
const REQUEST_ID = '11111111-1111-4111-8111-111111111111';
const REDIRECT = 'https://client.example.test/cb';
const USER_ID = 'user-1';

const scope = (id: string, over: Partial<OAuthScopeDefinition> = {}): OAuthScopeDefinition => ({
  id,
  title: `Title ${id}`,
  description: `Description ${id}`,
  permissions: ['notes:read'],
  risk: 'low',
  ...over,
});
const RESOURCE = { ...NOTES_RESOURCE, scopes: ['notes:read', 'notes:write'] };

/** Registers notes:read (default) and notes:write with these predicates around `fn`. */
const withScopes = <T>(read: OAuthScopeDefinition['available'], write: OAuthScopeDefinition['available'], fn: () => Promise<T>) =>
  withTemporaryEntries(oauthScopeRegistry, [scope('notes:read', { default: true, available: read }), scope('notes:write', { available: write })], () =>
    withTemporaryEntries(oauthResourceRegistry, [RESOURCE], fn),
  ) as Promise<T>;

const principal = (over: Record<string, unknown> = {}) =>
  ({
    kind: 'user',
    userId: USER_ID,
    email: 'user-1@example.test',
    credential: 'session',
    roles: [],
    permissions: ['notes:read', 'notes:write'],
    activeOrgId: ORG_A,
    memberships: [
      { orgId: ORG_A, status: 'active' },
      { orgId: ORG_B, status: 'active' },
    ],
    ...over,
  }) as never;

function requestRow(scopeText: string, over: Record<string, unknown> = {}) {
  return {
    id: REQUEST_ID,
    userId: USER_ID,
    status: 'pending',
    expiresAt: new Date(Date.now() + 600_000),
    clientId: 'client-row-1',
    client: { id: 'client-row-1', name: 'Client Alpha', host: 'client.example.test', logoUri: null, kind: 'registered', createdAt: new Date('2026-01-01T00:00:00Z'), disabledAt: null },
    resource: `${APP_URL}/api/notes-agent`,
    scope: scopeText,
    redirectUri: REDIRECT,
    state: 'st-1',
    codeChallenge: 'challenge',
    ...over,
  };
}

function build(row: ReturnType<typeof requestRow>) {
  const grantCreates: Array<Record<string, unknown>> = [];
  const codeCreates: Array<Record<string, unknown>> = [];
  const tx = {
    oAuthAuthorizationRequest: { updateMany: jest.fn(async () => ({ count: 1 })) },
    oAuthGrant: {
      findFirst: jest.fn(async () => null),
      update: jest.fn(),
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        grantCreates.push(data);
        return { id: 'grant-1' };
      }),
    },
    oAuthAuthorizationCode: { create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => (codeCreates.push(data), {})) },
    oAuthClient: { update: jest.fn(async () => ({})) },
  };
  const prisma = {
    oAuthAuthorizationRequest: { findUnique: jest.fn(async () => row), updateMany: jest.fn(async () => ({ count: 1 })) },
    oAuthGrant: { findFirst: jest.fn(async () => null) },
    organization: { findMany: jest.fn(async () => []) },
    user: { findUnique: jest.fn(async () => userGraph(['notes:read', 'notes:write'], { orgId: ORG_B })) },
    $transaction: jest.fn(async (fn: (client: typeof tx) => unknown) => fn(tx)),
  };
  const grants = { audit: jest.fn(async () => undefined), emitCreated: jest.fn() };
  const context = new OAuthServerContext({ get: (key: string) => (key === 'appUrl' ? APP_URL : undefined) } as never);
  const service = new OAuthAuthorizationService(prisma as never, { resolveForAuthorization: jest.fn(), resolveStored: jest.fn() } as never, { isEnabled: async () => true, read: async () => ({}) } as never, context, grants as never);
  return { service, prisma, tx, grantCreates, codeCreates };
}

beforeAll(() => recordTenancyMode('multi'));
afterAll(() => recordTenancyMode('single'));

describe('readRequest with scope availability', () => {
  it('hides an unavailable scope and passes { userId, orgId: activeOrgId } to the predicate', async () => {
    const write = jest.fn(() => false);
    const read = jest.fn(() => true);
    await withScopes(read, write, async () => {
      const { service } = build(requestRow('notes:read notes:write offline_access'));
      const view = await service.readRequest(REQUEST_ID, principal());
      expect(view.scopes.map((s) => s.id)).toEqual(['notes:read']);
      expect(view.offlineAccess).toBe(true);
      expect(read).toHaveBeenCalledWith({ userId: USER_ID, orgId: ORG_A });
      expect(write).toHaveBeenCalledWith({ userId: USER_ID, orgId: ORG_A });
    });
  });

  it('passes orgId null when the principal has no active organization', async () => {
    const read = jest.fn(() => true);
    await withScopes(read, () => true, async () => {
      const { service } = build(requestRow('notes:read'));
      await service.readRequest(REQUEST_ID, principal({ activeOrgId: undefined }));
      expect(read).toHaveBeenCalledWith({ userId: USER_ID, orgId: null });
    });
  });

  it('shows every scope when none has a predicate', async () => {
    await withScopes(undefined, undefined, async () => {
      const { service } = build(requestRow('notes:read notes:write'));
      expect((await service.readRequest(REQUEST_ID, principal())).scopes.map((s) => s.id)).toEqual(['notes:read', 'notes:write']);
    });
  });

  it('hides a scope whose predicate throws', async () => {
    await withScopes(() => true, () => { throw new Error('boom'); }, async () => {
      const { service } = build(requestRow('notes:read notes:write'));
      expect((await service.readRequest(REQUEST_ID, principal())).scopes.map((s) => s.id)).toEqual(['notes:read']);
    });
  });
});

describe('decide with scope availability', () => {
  it('never grants an unavailable ticked scope', async () => {
    await withScopes(() => true, () => false, async () => {
      const { service, grantCreates, codeCreates } = build(requestRow('notes:read notes:write'));
      await service.decide(REQUEST_ID, { decision: 'approve', scopes: ['notes:read', 'notes:write'] } as never, principal());
      expect(grantCreates[0]!.scopes).toEqual(['notes:read']);
      expect(codeCreates[0]!.scope).toBe('notes:read');
    });
  });

  it('never grants an unavailable scope when scopes are not given (all requested)', async () => {
    await withScopes(() => true, () => false, async () => {
      const { service, grantCreates } = build(requestRow('notes:read notes:write offline_access'));
      await service.decide(REQUEST_ID, { decision: 'approve' } as never, principal());
      expect(grantCreates[0]!.scopes).toEqual(['notes:read', 'offline_access']);
    });
  });

  it('does not require an unavailable default: unticking it is accepted when another scope is granted', async () => {
    await withScopes(() => false, () => true, async () => {
      const { service, grantCreates } = build(requestRow('notes:read notes:write'));
      await service.decide(REQUEST_ID, { decision: 'approve', scopes: ['notes:write'] } as never, principal());
      expect(grantCreates[0]!.scopes).toEqual(['notes:write']);
    });
  });

  it('still requires an available default (control for the test above)', async () => {
    await withScopes(() => true, () => true, async () => {
      const { service } = build(requestRow('notes:read notes:write'));
      await expect(service.decide(REQUEST_ID, { decision: 'approve', scopes: ['notes:write'] } as never, principal())).rejects.toThrow('A required scope cannot be unticked');
    });
  });

  it('answers BadRequest when nothing grantable is left', async () => {
    await withScopes(() => false, () => false, async () => {
      const { service, tx } = build(requestRow('notes:read notes:write'));
      await expect(service.decide(REQUEST_ID, { decision: 'approve', scopes: ['notes:read', 'notes:write'] } as never, principal())).rejects.toBeInstanceOf(BadRequestException);
      await expect(service.decide(REQUEST_ID, { decision: 'approve', scopes: ['notes:read', 'notes:write'] } as never, principal())).rejects.toThrow('None of the requested scopes can be granted');
      expect(tx.oAuthGrant.create).not.toHaveBeenCalled();
    });
  });

  it('judges availability in the body orgId: true for org A, false for org B', async () => {
    const write = jest.fn((ctx: { orgId?: string | null }) => ctx.orgId === ORG_A);
    await withScopes(() => true, write, async () => {
      const inA = build(requestRow('notes:read notes:write'));
      await inA.service.decide(REQUEST_ID, { decision: 'approve', orgId: ORG_A } as never, principal());
      expect(inA.grantCreates[0]!.scopes).toEqual(['notes:read', 'notes:write']);
      expect(write).toHaveBeenLastCalledWith({ userId: USER_ID, orgId: ORG_A });

      const inB = build(requestRow('notes:read notes:write'));
      await inB.service.decide(REQUEST_ID, { decision: 'approve', orgId: ORG_B } as never, principal());
      expect(inB.grantCreates[0]!.scopes).toEqual(['notes:read']);
      expect(inB.grantCreates[0]!.orgId).toBe(ORG_B);
      expect(write).toHaveBeenLastCalledWith({ userId: USER_ID, orgId: ORG_B });
    });
  });

  it('falls back to the active org when the body names none', async () => {
    const read = jest.fn(() => true);
    await withScopes(read, () => true, async () => {
      const { service } = build(requestRow('notes:read'));
      await service.decide(REQUEST_ID, { decision: 'approve' } as never, principal());
      expect(read).toHaveBeenLastCalledWith({ userId: USER_ID, orgId: ORG_A });
    });
  });

  it('a deny is unaffected', async () => {
    const read = jest.fn(() => false);
    await withScopes(read, () => false, async () => {
      const { service } = build(requestRow('notes:read'));
      const { redirectTo } = await service.decide(REQUEST_ID, { decision: 'deny' } as never, principal());
      expect(redirectTo).toContain('error=access_denied');
      expect(read).not.toHaveBeenCalled();
    });
  });
});

describe('scope availability across the flow', () => {
  it('authorize -> readRequest -> decide -> resolve, with a toggled predicate', async () => {
    let betaOn = true;
    const pkce = createOAuthTestPkce();
    await withScopes(() => true, () => betaOn, async () => {
      // 1. authorize (store the request)
      let stored: Record<string, unknown> | undefined;
      const client = { id: 'client-row-1', clientId: 'oc_test', kind: 'registered', name: 'Client Alpha', logoUri: null, redirectUris: [REDIRECT], tokenEndpointAuthMethod: 'none', secretHash: null, host: 'client.example.test', disabledAt: null, createdAt: new Date('2026-01-01T00:00:00Z') };
      const authPrisma = { oAuthAuthorizationRequest: { create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ((stored = data), { id: REQUEST_ID })) } };
      const context = new OAuthServerContext({ get: (key: string) => (key === 'appUrl' ? APP_URL : undefined) } as never);
      const authorizer = new OAuthAuthorizationService(
        authPrisma as never,
        { resolveForAuthorization: jest.fn(async () => ({ ok: true, client })), resolveStored: jest.fn() } as never,
        { isEnabled: async () => true, read: async () => ({}) } as never,
        context,
        {} as never,
      );
      const location = await authorizer.authorize({
        response_type: 'code',
        client_id: 'oc_test',
        redirect_uri: REDIRECT,
        scope: 'notes:read notes:write',
        state: 'st-1',
        code_challenge: pkce.challenge,
        code_challenge_method: 'S256',
        resource: `${APP_URL}/api/notes-agent`,
      });
      expect(location).toContain('/oauth/consent');
      expect(stored!.scope).toBe('notes:read notes:write');

      // 2. consent page and 3. decision, with the predicate on
      const flow = build(requestRow(String(stored!.scope)));
      expect((await flow.service.readRequest(REQUEST_ID, principal())).scopes.map((s) => s.id)).toEqual(['notes:read', 'notes:write']);
      await flow.service.decide(REQUEST_ID, { decision: 'approve' } as never, principal());
      const grantedScopes = flow.grantCreates[0]!.scopes as string[];
      expect(grantedScopes).toEqual(['notes:read', 'notes:write']);

      // 4. the access token the exchange would mint carries the granted scopes; resolve it
      const prisma = { oAuthToken: { findUnique: jest.fn(async () => tokenRow({ scopes: grantedScopes }, { orgId: ORG_A, scopes: grantedScopes })), update: jest.fn(async () => ({})) }, oAuthGrant: { update: jest.fn(async () => ({})) } };
      const resolver = new OAuthTokenResolver(prisma as never, new ConfigService({ appUrl: APP_URL }));
      expect((await resolver.resolve('oat_x'))!.scopes).toEqual(['notes:read', 'notes:write']);

      // 5. the predicate turns off: the token loses the scope, the grant row is untouched
      betaOn = false;
      const off = (await resolver.resolve('oat_x'))!;
      expect(off.scopes).toEqual(['notes:read']);
      expect(prisma.oAuthGrant.update).not.toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ scopes: expect.anything() }) }));
      // ...and the consent page and a fresh decision no longer offer it
      expect((await build(requestRow('notes:read notes:write')).service.readRequest(REQUEST_ID, principal())).scopes.map((s) => s.id)).toEqual(['notes:read']);

      // 6. back on: the scope returns without any grant change
      betaOn = true;
      expect((await resolver.resolve('oat_x'))!.scopes).toEqual(['notes:read', 'notes:write']);
    });
  });
});
