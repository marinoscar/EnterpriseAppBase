// The consent routes' credential rule and the protocol filter (PP-15.4, #1182).
import { ForbiddenException, HttpException, NotFoundException } from '@nestjs/common';

import { OAuthProtocolExceptionFilter } from '../../../src/identity/oauth-server/oauth-protocol.filter';
import { invalidClient, oauthError, rateLimited } from '../../../src/identity/oauth-server/oauth-protocol.error';
import { requireSessionCredential } from '../../../src/identity/oauth-server/session-only';

const principal = (credential: string) => ({ credential }) as never;

describe('requireSessionCredential', () => {
  it('admits a browser session', () => {
    expect(() => requireSessionCredential(principal('session'), { kind: 'jwt' })).not.toThrow();
  });

  it.each([
    ['a personal access token', principal('pat'), { kind: 'pat', tokenId: 't' } as never],
    ['a device credential', principal('device'), { kind: 'jwt' } as never],
    ['a worker-node credential', principal('node'), { kind: 'node' } as never],
    ['an oat_ token', principal('oauth'), { kind: 'oauth', tokenId: 't', grantId: 'g', clientId: 'c', resourceId: 'r', scopes: [] as string[] } as never],
  ])('refuses %s with 403', (_label, who, credential) => {
    expect(() => requireSessionCredential(who, credential)).toThrow(ForbiddenException);
  });
});

describe('OAuthProtocolExceptionFilter', () => {
  function run(thrown: unknown) {
    const sent: { status?: number; headers: Record<string, string>; body?: unknown } = { headers: {} };
    const reply: Record<string, unknown> = {
      header(name: string, value: string) {
        sent.headers[name.toLowerCase()] = value;
        return reply;
      },
      code(status: number) {
        sent.status = status;
        return reply;
      },
      status(status: number) {
        sent.status = status;
        return reply;
      },
      send(body: unknown) {
        sent.body = body;
        return reply;
      },
    };
    const host = { switchToHttp: () => ({ getResponse: () => reply, getRequest: () => ({ method: 'POST', url: '/api/oauth/token?x=1' }) }) };
    new OAuthProtocolExceptionFilter().catch(thrown, host as never);
    return sent;
  }

  it('writes a protocol error as RFC 6749 JSON, with no-store and the CORS wildcard', () => {
    const sent = run(oauthError('invalid_grant', 'nope'));
    expect(sent.status).toBe(400);
    expect(sent.body).toEqual({ error: 'invalid_grant', error_description: 'nope' });
    expect(sent.headers['cache-control']).toBe('no-store');
    expect(sent.headers['access-control-allow-origin']).toBe('*');
  });

  it('adds WWW-Authenticate to invalid_client and Retry-After to a rate limit', () => {
    expect(run(invalidClient()).headers['www-authenticate']).toMatch(/^Basic /);
    const limited = run(rateLimited(7));
    expect(limited.status).toBe(429);
    expect(limited.headers['retry-after']).toBe('7');
    expect(limited.body).toMatchObject({ error: 'temporarily_unavailable' });
  });

  it('hands any other HttpException to the platform filter (a disabled server is the platform 404)', () => {
    const sent = run(new NotFoundException());
    expect(sent.status).toBe(404);
    expect(sent.body).toMatchObject({ statusCode: 404, code: expect.any(String) });
    const other = run(new HttpException('x', 418));
    expect(other.status).toBe(418);
  });

  it('answers a non-HTTP failure as server_error without the stack or message', () => {
    const sent = run(new Error('database password is hunter2'));
    expect(sent.status).toBe(500);
    expect(sent.body).toEqual({ error: 'server_error', error_description: expect.any(String) });
    expect(JSON.stringify(sent.body)).not.toContain('hunter2');
  });
});
