// InProcessDelegation (PP-15.3, #1181): `Bearer ipd_<id>.<mac>`, usable only from
// `inject` in this process, only while the originating request is live and for
// at most 60 s; the delegated request keeps the principal, credential kind and
// narrowed permissions and skips route confinement. Works for session and PAT
// principals too.
import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { HttpAdapterHost, Reflector } from '@nestjs/core';
import fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';

import { JwtAuthGuard } from '../../../src/identity/auth/guards/jwt-auth.guard';
import { stampCredential, stampOAuthNarrowing } from '../../../src/identity/auth/credential-binding';
import { principalFactory } from '../../../src/identity/auth/principal.factory';
import { IPD_TTL_MS, InProcessDelegation } from '../../../src/identity/oauth-server/in-process-delegation.service';
import { ORG_ID, userGraph } from './support';

function oauthRequest(): Record<string, unknown> {
  const user = stampCredential(userGraph(['notes:read', 'notes:write']) as never, { activeOrgId: ORG_ID, tokenKind: 'oauth' });
  stampOAuthNarrowing(user, { permissions: ['notes:read'], info: { clientId: 'c1', grantId: 'g1', resourceId: 'notes', scopes: ['notes:read'] } });
  return {
    user,
    principal: principalFactory.forUser(user as never, 'oauth'),
    authCredential: { kind: 'oauth', tokenId: 't1', grantId: 'g1', clientId: 'c1', resourceId: 'notes', scopes: ['notes:read'] },
  };
}

describe('InProcessDelegation (service)', () => {
  let svc: InProcessDelegation;
  beforeEach(() => {
    svc = new InProcessDelegation();
  });
  afterEach(() => jest.useRealTimers());

  it('issues Bearer ipd_<id>.<mac> that redeems to the originating principal', () => {
    const request = oauthRequest();
    const header = svc.headerFor(request);
    expect(header).toMatch(/^Bearer ipd_[0-9a-f]{32}\.[A-Za-z0-9_-]{43}$/);
    const entry = svc.redeem(header);
    expect(entry?.principal).toBe(request.principal);
    expect(entry?.user).toBe(request.user);
    expect(entry?.authCredential).toEqual(request.authCredential);
  });

  it('each header is distinct and a forged or altered MAC, id or shape is refused', () => {
    const request = oauthRequest();
    const header = svc.headerFor(request);
    expect(svc.headerFor(request)).not.toBe(header);
    const [id, mac] = header.slice('Bearer ipd_'.length).split('.');
    for (const bad of [
      `Bearer ipd_${id}.${'A'.repeat(43)}`,
      `Bearer ipd_${id}.`,
      `Bearer ipd_${id}`,
      `Bearer ipd_.${mac}`,
      `Bearer ipd_${'0'.repeat(32)}.${mac}`,
      `Bearer ipd_${id}.${mac}x`,
      `Bearer ipd_${id}.${mac!.slice(1)}`,
    ]) {
      expect(svc.redeem(bad)).toBeNull();
    }
    // another process's key (a second instance) cannot redeem it
    expect(new InProcessDelegation().redeem(header)).toBeNull();
  });

  it('is dropped after 60 s', () => {
    jest.useFakeTimers({ now: Date.now() });
    const header = svc.headerFor(oauthRequest());
    jest.advanceTimersByTime(IPD_TTL_MS - 1);
    expect(svc.redeem(header)).not.toBeNull();
    jest.advanceTimersByTime(2);
    expect(svc.redeem(header)).toBeNull();
    expect(svc.size()).toBe(0);
  });

  it('is dropped when the originating request ends', () => {
    const request = oauthRequest();
    const other = oauthRequest();
    const header = svc.headerFor(request);
    const otherHeader = svc.headerFor(other);
    svc.dropFor(request);
    expect(svc.redeem(header)).toBeNull();
    expect(svc.redeem(otherHeader)).not.toBeNull(); // another request's delegation lives on
  });

  it('refuses an unauthenticated originating request', () => {
    expect(() => svc.headerFor({})).toThrow(/authenticated request/);
    expect(() => svc.headerFor({ user: {}, principal: {} })).toThrow();
  });

  it('works for a session and a PAT principal (one code path)', () => {
    for (const kind of ['session', 'pat'] as const) {
      const user = stampCredential(userGraph(['notes:read']) as never, { activeOrgId: ORG_ID, tokenKind: kind });
      const request = { user, principal: principalFactory.forUser(user as never, kind), authCredential: kind === 'pat' ? { kind: 'pat', tokenId: 'p' } : { kind: 'jwt' } };
      const entry = svc.redeem(svc.headerFor(request));
      expect(entry?.principal).toMatchObject({ credential: kind, permissions: ['notes:read'] });
    }
  });

  it('never exposes the key: not in JSON, not in the header, not in a log line', () => {
    const logs: string[] = [];
    const spies = (['log', 'warn', 'error', 'debug', 'verbose'] as const).map((m) =>
      jest.spyOn(require('@nestjs/common').Logger.prototype, m).mockImplementation((...a: unknown[]) => void logs.push(JSON.stringify(a))),
    );
    try {
      const header = svc.headerFor(oauthRequest());
      svc.warnNetworkAttempt();
      const key = ((svc as unknown) as { key: Buffer }).key;
      expect(JSON.stringify(svc)).not.toContain(key.toString('hex'));
      expect(header).not.toContain(key.toString('base64url'));
      expect(logs.join('\n')).not.toContain(header);
      expect(logs.join('\n')).not.toContain(key.toString('hex'));
      expect(logs.join('\n')).not.toContain('ipd_');
    } finally {
      spies.forEach((s) => s.mockRestore());
    }
  });
});

describe('InProcessDelegation over a real Fastify instance and the guard', () => {
  let app: FastifyInstance;
  let svc: InProcessDelegation;
  let guard: JwtAuthGuard;
  let seen: Array<Record<string, unknown>>;
  const ipd = (): string => ((seen.at(-1) as { header: string }).header);

  beforeEach(async () => {
    svc = new InProcessDelegation({ httpAdapter: { getInstance: () => app } } as unknown as HttpAdapterHost);
    guard = new JwtAuthGuard({ getAllAndOverride: () => false } as unknown as Reflector, {} as never, {} as never, undefined, undefined, svc);
    jest.spyOn(Object.getPrototypeOf(JwtAuthGuard.prototype), 'canActivate').mockReturnValue(true);
    seen = [];
    app = fastify();
    svc.onModuleInit();

    const guardCtx = (request: FastifyRequest): ExecutionContext =>
      ({ switchToHttp: () => ({ getRequest: () => request }), getHandler: () => () => undefined, getClass: () => class {} }) as unknown as ExecutionContext;

    // The resource route: authenticated as an oat_ request (set by hand, as the guard would), then it
    // calls an app route in-process.
    app.get('/api/notes-agent/call', async (request) => {
      Object.assign(request, oauthRequest());
      const response = await svc.inject(request, { method: 'GET', url: '/api/users/anything?x=1' });
      return { status: response.statusCode, body: response.json() };
    });
    // An app route OUTSIDE the resource prefix, guarded by the real guard.
    app.get('/api/users/anything', async (request) => {
      await guard.canActivate(guardCtx(request));
      const r = request as unknown as { principal: { permissions: string[]; credential: string; oauth?: unknown }; authCredential: { kind: string } };
      return { permissions: r.principal.permissions, credential: r.principal.credential, kind: r.authCredential.kind, oauth: r.principal.oauth ?? null };
    });
    // A route that hands out a header and leaks it to the test.
    app.get('/api/notes-agent/leak', async (request) => {
      Object.assign(request, oauthRequest());
      seen.push({ header: svc.headerFor(request) });
      return { ok: true };
    });
    app.setErrorHandler((error, _request, reply) => {
      void reply.status(error instanceof UnauthorizedException ? 401 : (error as { statusCode?: number }).statusCode ?? 500).send({ message: error.message });
    });
    await app.ready();
  });
  afterEach(async () => {
    jest.restoreAllMocks();
    await app.close();
  });

  it('an injected sub-request carries the narrowed permissions and the oauth credential, and skips route confinement', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/notes-agent/call' });
    expect(res.json()).toEqual({
      status: 200,
      body: { permissions: ['notes:read'], credential: 'oauth', kind: 'oauth', oauth: { clientId: 'c1', grantId: 'g1', resourceId: 'notes', scopes: ['notes:read'] } },
    });
  });

  it('the same ipd_ header sent over the network is a 401, whatever the headers say', async () => {
    await app.inject({ method: 'GET', url: '/api/notes-agent/leak' });
    const header = ipd();
    // the header is only reachable while the originating request lives; re-issue one for the network attempt
    const live = svc.headerFor(oauthRequest());
    const warn = jest.spyOn(require('@nestjs/common').Logger.prototype, 'warn').mockImplementation(() => undefined);
    for (const remoteAddress of [undefined, '127.0.0.1', '10.1.2.3', 'ipd-0000']) {
      const res = await app.inject({ method: 'GET', url: '/api/users/anything', headers: { authorization: live, 'x-forwarded-for': '127.0.0.1' }, remoteAddress });
      expect(res.statusCode).toBe(401);
    }
    expect(header).toBeDefined();
    expect(warn).toHaveBeenCalled();
    expect(JSON.stringify(warn.mock.calls)).not.toContain('ipd_');
  });

  it('a delegation is unusable after its originating request ended (onResponse hook)', async () => {
    await app.inject({ method: 'GET', url: '/api/notes-agent/leak' });
    const header = ipd();
    // The hook ran when the response ended: the entry is gone, even from an in-process inject.
    const replay = await app.inject({ method: 'GET', url: '/api/users/anything', headers: { authorization: header }, remoteAddress: svc.remoteAddressForInject() });
    expect(replay.statusCode).toBe(401);
    expect(svc.size()).toBe(0);
  });

  it('a delegation is unusable after 60 s even while its request is live', async () => {
    jest.useFakeTimers({ now: Date.now(), doNotFake: ['nextTick', 'setImmediate', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'queueMicrotask'] });
    try {
      const header = svc.headerFor(oauthRequest());
      const ok = await app.inject({ method: 'GET', url: '/api/users/anything', headers: { authorization: header }, remoteAddress: svc.remoteAddressForInject() });
      expect(ok.statusCode).toBe(200);
      jest.setSystemTime(Date.now() + IPD_TTL_MS + 1);
      const late = await app.inject({ method: 'GET', url: '/api/users/anything', headers: { authorization: header }, remoteAddress: svc.remoteAddressForInject() });
      expect(late.statusCode).toBe(401);
    } finally {
      jest.useRealTimers();
    }
  });

  it('inject replaces a caller-supplied authorization header', async () => {
    const calls: unknown[] = [];
    const request = { ...oauthRequest(), server: { inject: async (o: unknown) => (calls.push(o), { statusCode: 200 }) } };
    await svc.inject(request as never, { method: 'GET', url: '/x', headers: { Authorization: 'Bearer oat_forwarded', 'x-keep': '1' } });
    const sent = calls[0] as { headers: Record<string, string>; remoteAddress: string };
    expect(sent.headers.authorization).toMatch(/^Bearer ipd_/);
    expect(JSON.stringify(sent.headers)).not.toContain('oat_forwarded');
    expect(sent.headers['x-keep']).toBe('1');
    expect(sent.remoteAddress).toBe(svc.remoteAddressForInject());
  });

  it('is refused when no delegation service is mounted', async () => {
    const bare = new JwtAuthGuard({ getAllAndOverride: () => false } as unknown as Reflector, {} as never, {} as never);
    const request: any = { headers: { authorization: 'Bearer ipd_abc.def' }, url: '/x', raw: {} };
    const ctx = { switchToHttp: () => ({ getRequest: () => request }), getHandler: () => () => undefined, getClass: () => class {} } as unknown as ExecutionContext;
    await expect(bare.canActivate(ctx)).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
