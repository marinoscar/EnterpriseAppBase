// LinkGrantGuard, LinkMissThrottle, PublicLinkInterceptor and the link
// decorators (issue #730): every failure is the SAME 404 and one miss; the
// token is read from the X-Link-Token header only (never the path or the
// query); an address over its budget gets 429 even with a valid token; the
// reply carries no-store / no-referrer before anything can refuse; a failure
// logs the reason enum and a keyed address tag, never the token, its hash or
// the address; the counter carries bounded labels.

import { createHash } from 'node:crypto';

import { HttpException, Logger, NotFoundException, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { of } from 'rxjs';

import {
  CurrentLinkGrant,
  LINK_GRANT_REQUEST_KEY,
  LINK_GRANT_RESOURCE_KEY,
  LinkGrantGuard,
  LinkGrantResource,
  LinkMissThrottle,
  PublicLinkInterceptor,
  SHARING_LINK_RESOLUTIONS_METRIC,
  type LinkGrantsService,
  type LinkResolution,
} from '../../src/sharing/index';
import { addressTag } from '../../src/sharing/links/link-grant.guard';

const TOKEN = `lnk_${'Q'.repeat(43)}`;
const IP = '203.0.113.7';
const LINK = { grantId: 'g-1', orgId: 'o-1', resourceType: 'test_doc', resourceId: 'r-1', role: 'viewer', expiresAt: null };

class Route {
  @LinkGrantResource('test_doc', { action: 'read' })
  handler() {}
  bare() {}
}

function context(request: Record<string, unknown>, handler: 'handler' | 'bare' = 'handler') {
  const headers: Record<string, string> = {};
  const reply = { header: jest.fn((name: string, value: string) => (headers[name] = value)) };
  const ctx = {
    switchToHttp: () => ({ getRequest: () => request, getResponse: () => reply }),
    getHandler: () => Route.prototype[handler],
    getClass: () => Route,
  } as unknown as ExecutionContext;
  return { ctx, reply, headers };
}

function guardWith(results: LinkResolution | ((token: unknown) => LinkResolution), throttle = new LinkMissThrottle()) {
  const resolve = jest.fn(async (token: unknown) => (typeof results === 'function' ? results(token) : results));
  const metrics = { add: jest.fn() };
  const guard = new LinkGrantGuard(new Reflector(), { resolve } as unknown as LinkGrantsService, throttle, metrics as never);
  return { guard, resolve, metrics, throttle };
}

const fail = (failure: string, resourceType: string | null = null): LinkResolution => ({ ok: false, failure, resourceType }) as LinkResolution;

async function refusal(promise: Promise<unknown>): Promise<HttpException> {
  try {
    await promise;
  } catch (error) {
    return error as HttpException;
  }
  throw new Error('expected a refusal');
}

describe('LinkGrantGuard', () => {
  it('attaches the resolved link, counts ok, and passes the route expectation', async () => {
    const { guard, resolve, metrics } = guardWith({ ok: true, link: LINK });
    const request: Record<string, unknown> = { ip: IP, headers: { 'x-link-token': TOKEN } };
    await expect(guard.canActivate(context(request).ctx)).resolves.toBe(true);
    expect(request[LINK_GRANT_REQUEST_KEY]).toBe(LINK);
    expect(resolve).toHaveBeenCalledWith(TOKEN, { resourceType: 'test_doc', action: 'read' });
    expect(metrics.add).toHaveBeenCalledWith(SHARING_LINK_RESOLUTIONS_METRIC, 1, { outcome: 'ok', resource_type: 'test_doc' });
  });

  it.each(['missing', 'malformed', 'unknown', 'revoked', 'expired', 'wrong_type', 'links_off', 'insufficient_role', 'resource_gone'])(
    'answers %s with the one generic 404 and records one miss',
    async (failure) => {
      const { guard, throttle } = guardWith(fail(failure, failure === 'wrong_type' ? 'album' : null));
      const error = await refusal(guard.canActivate(context({ ip: IP, headers: { 'x-link-token': TOKEN } }).ctx));
      expect(error).toBeInstanceOf(NotFoundException);
      expect(error.getResponse()).toEqual(new NotFoundException('Link not found').getResponse());
      expect(throttle.size()).toBe(1);
    },
  );

  it('maps failures to bounded outcomes, labelled with the grant type when one was found', async () => {
    const { guard, metrics } = guardWith(fail('wrong_type', 'album'));
    await refusal(guard.canActivate(context({ ip: IP, headers: { 'x-link-token': TOKEN } }).ctx));
    expect(metrics.add).toHaveBeenLastCalledWith(SHARING_LINK_RESOLUTIONS_METRIC, 1, { outcome: 'wrong_type', resource_type: 'album' });
    const malformed = guardWith(fail('malformed'));
    await refusal(malformed.guard.canActivate(context({ ip: IP, headers: {} }).ctx));
    expect(malformed.metrics.add).toHaveBeenLastCalledWith(SHARING_LINK_RESOLUTIONS_METRIC, 1, { outcome: 'not_found', resource_type: 'test_doc' });
  });

  it('reads the X-Link-Token header ONLY: a token in the path or the query string is never passed on', async () => {
    const { guard, resolve } = guardWith((token) => (token === TOKEN ? { ok: true, link: LINK } : fail('missing')));
    const request = { ip: IP, headers: {}, params: { token: TOKEN }, query: { token: TOKEN, 'x-link-token': TOKEN }, url: `/api/public/links/${TOKEN}?token=${TOKEN}` };
    await expect(refusal(guard.canActivate(context(request).ctx))).resolves.toBeInstanceOf(NotFoundException);
    expect(resolve).toHaveBeenCalledWith(undefined, expect.anything());
  });

  it('sets Cache-Control: no-store and Referrer-Policy: no-referrer before refusing', async () => {
    const { guard } = guardWith(fail('unknown'));
    const { ctx, headers } = context({ ip: IP, headers: { 'x-link-token': TOKEN } });
    await refusal(guard.canActivate(ctx));
    expect(headers).toEqual({ 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' });
  });

  it('answers 429 with retryAfterMs once an address reaches its miss budget, even with a valid token', async () => {
    let clock = 1_000_000;
    const throttle = new LinkMissThrottle({ maxMisses: 3, windowMs: 60_000, now: () => clock });
    const { guard, resolve } = guardWith((token) => (token === TOKEN ? { ok: true, link: LINK } : fail('unknown')), throttle);
    const bad = () => context({ ip: IP, headers: { 'x-link-token': `lnk_${'z'.repeat(43)}` } }).ctx;
    for (let i = 0; i < 3; i += 1) expect(await refusal(guard.canActivate(bad()))).toBeInstanceOf(NotFoundException);
    const throttled = await refusal(guard.canActivate(context({ ip: IP, headers: { 'x-link-token': TOKEN } }).ctx));
    expect(throttled.getStatus()).toBe(429);
    expect(throttled.getResponse()).toMatchObject({ details: { reason: 'LINK_RESOLUTION_THROTTLED', retryAfterMs: 60_000 } });
    expect(resolve).toHaveBeenCalledTimes(3);
    // Another address is unaffected; the window frees this one.
    await expect(guard.canActivate(context({ ip: '198.51.100.1', headers: { 'x-link-token': TOKEN } }).ctx)).resolves.toBe(true);
    clock += 60_001;
    await expect(guard.canActivate(context({ ip: IP, headers: { 'x-link-token': TOKEN } }).ctx)).resolves.toBe(true);
  });

  it('logs only the reason enum and a keyed address tag: never the token, its hash or the address', async () => {
    const lines: string[] = [];
    const spies = (['log', 'warn', 'error', 'debug', 'verbose'] as const).map((method) =>
      jest.spyOn(Logger.prototype, method).mockImplementation((...args: unknown[]) => void lines.push(args.map(String).join(' '))),
    );
    try {
      for (const failure of ['unknown', 'revoked', 'expired', 'wrong_type']) {
        const { guard } = guardWith(fail(failure, 'test_doc'));
        await refusal(guard.canActivate(context({ ip: IP, headers: { 'x-link-token': TOKEN } }).ctx));
      }
    } finally {
      for (const spy of spies) spy.mockRestore();
    }
    expect(lines).toHaveLength(4);
    const hash = createHash('sha256').update(TOKEN).digest('hex');
    for (const line of lines) {
      expect(line).toMatch(/^Link resolution refused: reason=[a-z_]+ address=[0-9a-f]{12}$/);
      expect(line).not.toContain(TOKEN);
      expect(line).not.toContain(hash.slice(0, 12));
      expect(line).not.toContain(IP);
    }
    expect(lines[0]).toContain(`address=${addressTag(IP)}`);
  });

  it('fails closed on a route without @LinkGrantResource (a programming error, not a 404)', async () => {
    const { guard } = guardWith({ ok: true, link: LINK });
    await expect(guard.canActivate(context({ ip: IP, headers: { 'x-link-token': TOKEN } }, 'bare').ctx)).rejects.toThrow(/declares no @LinkGrantResource/);
  });
});

describe('LinkMissThrottle', () => {
  it('slides a window per address and stays bounded', () => {
    let clock = 0;
    const throttle = new LinkMissThrottle({ maxMisses: 2, windowMs: 100, maxAccounts: 3, now: () => clock });
    throttle.recordMiss('a');
    throttle.recordMiss('a');
    expect(throttle.retryAfterMs('a')).toBe(100);
    clock = 50;
    expect(throttle.retryAfterMs('a')).toBe(50);
    clock = 101;
    expect(throttle.retryAfterMs('a')).toBe(0);
    for (const address of ['b', 'c', 'd', 'e']) throttle.recordMiss(address);
    expect(throttle.size()).toBe(3);
    throttle.clear();
    expect(throttle.size()).toBe(0);
  });

  it('defaults to 30 misses per 10 minutes', () => {
    const throttle = new LinkMissThrottle({ now: () => 0 });
    for (let i = 0; i < 29; i += 1) throttle.recordMiss('a');
    expect(throttle.retryAfterMs('a')).toBe(0);
    throttle.recordMiss('a');
    expect(throttle.retryAfterMs('a')).toBe(600_000);
  });
});

describe('PublicLinkInterceptor', () => {
  it('sets the no-store and no-referrer headers on a Fastify reply and a Node response', async () => {
    const fastify: Record<string, string> = {};
    const node: Record<string, string> = {};
    for (const [response, sink] of [
      [{ header: (n: string, v: string) => (fastify[n] = v) }, fastify],
      [{ setHeader: (n: string, v: string) => (node[n] = v) }, node],
    ] as const) {
      const ctx = { switchToHttp: () => ({ getResponse: () => response }) } as unknown as ExecutionContext;
      const out = new PublicLinkInterceptor().intercept(ctx, { handle: () => of('body') });
      await expect(new Promise((resolve) => out.subscribe(resolve))).resolves.toBe('body');
      expect(sink).toEqual({ 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' });
    }
  });
});

describe('link decorators', () => {
  it('@LinkGrantResource defaults the action to read, and to none for the any-type route', () => {
    class C {
      @LinkGrantResource('album')
      a() {}
      @LinkGrantResource('*')
      b() {}
    }
    expect(Reflect.getMetadata(LINK_GRANT_RESOURCE_KEY, C.prototype.a)).toEqual({ resourceType: 'album', action: 'read' });
    expect(Reflect.getMetadata(LINK_GRANT_RESOURCE_KEY, C.prototype.b)).toEqual({ resourceType: '*' });
    expect(() => LinkGrantResource('')).toThrow(/resource type is required/);
  });

  it('@CurrentLinkGrant reads request.linkGrant and is a 404 without one', () => {
    // A param decorator's factory, as Nest stores it.
    class C {
      handler(@CurrentLinkGrant() _link: unknown) {}
    }
    const meta = Reflect.getMetadata('__routeArguments__', C, 'handler') as Record<string, { factory: (data: unknown, ctx: ExecutionContext) => unknown }>;
    const factory = Object.values(meta)[0]!.factory;
    const ctxOf = (request: object) => ({ switchToHttp: () => ({ getRequest: () => request }) }) as unknown as ExecutionContext;
    expect(factory(undefined, ctxOf({ [LINK_GRANT_REQUEST_KEY]: LINK }))).toBe(LINK);
    expect(() => factory(undefined, ctxOf({}))).toThrow(NotFoundException);
  });
});
