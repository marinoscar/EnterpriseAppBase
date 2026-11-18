// PKCE, redirect URI matching, resource normalisation, the rate limiter, the
// protocol errors and the token endpoint's form parsing (PP-15.4, #1182): the
// pure parts, with no database.
import { createHash } from 'node:crypto';

import { createOAuthTestPkce } from '../../../src/identity/testing/oauth';
import {
  InMemoryOAuthRateLimiter,
  isLoopbackRedirectUri,
  isWellFormedChallenge,
  isWellFormedVerifier,
  matchesRedirectUri,
  normalizeResourceIdentifier,
  redirectHostOf,
  s256Challenge,
  verifyPkce,
} from '../../../src/identity/index';
import { invalidClient, oauthError, rateLimited } from '../../../src/identity/oauth-server/oauth-protocol.error';
import { parseOAuthForm } from '../../../src/identity/oauth-server/oauth-token.service';
import { oauthBodyViolation } from '../../../src/identity/oauth-server/oauth-body-guard';

describe('PKCE (RFC 7636, S256)', () => {
  it('computes BASE64URL(SHA256(verifier)); the RFC 7636 appendix B vector', () => {
    expect(s256Challenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
  });

  it('verifies a matching pair and refuses a wrong, truncated or empty verifier', () => {
    const { verifier, challenge } = createOAuthTestPkce();
    expect(verifyPkce(verifier, challenge)).toBe(true);
    expect(verifyPkce(`${verifier}x`, challenge)).toBe(false);
    expect(verifyPkce(verifier.slice(0, -1), challenge)).toBe(false);
    expect(verifyPkce('', challenge)).toBe(false);
  });

  it('never accepts the challenge as the verifier (the "plain" method)', () => {
    const { challenge } = createOAuthTestPkce();
    expect(verifyPkce(challenge, challenge)).toBe(false);
  });

  it('refuses a verifier outside 43..128 unreserved characters', () => {
    expect(isWellFormedVerifier('a'.repeat(42))).toBe(false);
    expect(isWellFormedVerifier('a'.repeat(43))).toBe(true);
    expect(isWellFormedVerifier('a'.repeat(128))).toBe(true);
    expect(isWellFormedVerifier('a'.repeat(129))).toBe(false);
    expect(isWellFormedVerifier(`${'a'.repeat(43)} `)).toBe(false);
    // a verifier that hashes to the same digest as the challenge is impossible; a malformed one cannot match even if hashed
    const odd = `${'a'.repeat(42)}!`;
    expect(verifyPkce(odd, createHash('sha256').update(odd).digest('base64url'))).toBe(false);
  });

  it('a challenge is exactly 43 base64url characters', () => {
    expect(isWellFormedChallenge('a'.repeat(43))).toBe(true);
    expect(isWellFormedChallenge('a'.repeat(44))).toBe(false);
    expect(isWellFormedChallenge(`${'a'.repeat(42)}=`)).toBe(false);
    expect(isWellFormedChallenge('')).toBe(false);
  });
});

describe('redirect URI matching (RFC 8252 section 7.3)', () => {
  const https = ['https://client.example.test/cb'];

  it('matches an exact string and nothing else for an https URI', () => {
    expect(matchesRedirectUri(https, 'https://client.example.test/cb')).toBe(true);
    expect(matchesRedirectUri(https, 'https://client.example.test/cb/')).toBe(false);
    expect(matchesRedirectUri(https, 'https://client.example.test/cb/extra')).toBe(false);
    expect(matchesRedirectUri(https, 'https://client.example.test/CB')).toBe(false);
    expect(matchesRedirectUri(https, 'https://client.example.test/cb?x=1')).toBe(false);
    expect(matchesRedirectUri(https, 'https://client.example.test:8443/cb')).toBe(false);
    expect(matchesRedirectUri(https, 'https://evil.example.test/cb')).toBe(false);
    expect(matchesRedirectUri(https, 'https://client.example.test/cb#frag')).toBe(false);
    expect(matchesRedirectUri([], 'https://client.example.test/cb')).toBe(false);
  });

  it('is never a prefix or a wildcard match', () => {
    expect(matchesRedirectUri(['https://client.example.test/*'], 'https://client.example.test/anything')).toBe(false);
    expect(matchesRedirectUri(['https://client.example.test'], 'https://client.example.test/cb')).toBe(false);
  });

  it.each([
    ['http://127.0.0.1/cb', 'http://127.0.0.1:54321/cb'],
    ['http://127.0.0.1:1234/cb', 'http://127.0.0.1:9999/cb'],
    ['http://[::1]/cb', 'http://[::1]:8080/cb'],
    ['http://localhost/cb', 'http://localhost:3000/cb'],
    ['http://localhost:5000/cb?x=1', 'http://localhost:6000/cb?x=1'],
  ])('ignores the port for the loopback URI %s', (registered, requested) => {
    expect(matchesRedirectUri([registered], requested)).toBe(true);
  });

  it.each([
    ['http://127.0.0.1/cb', 'http://localhost:3000/cb', 'a different loopback name'],
    ['http://localhost/cb', 'http://127.0.0.1:3000/cb', 'a different loopback name'],
    ['http://127.0.0.1/cb', 'http://[::1]:3000/cb', 'a different loopback name'],
    ['http://127.0.0.1/cb', 'http://127.0.0.1:3000/other', 'a different path'],
    ['http://127.0.0.1/cb', 'http://127.0.0.1:3000/cb?x=1', 'a different query'],
    ['http://127.0.0.1/cb', 'https://127.0.0.1:3000/cb', 'a different scheme'],
    ['http://127.0.0.1/cb', 'http://127.0.0.1.evil.example.test/cb', 'a lookalike host'],
    ['http://127.0.0.1/cb', 'http://127.0.0.1@evil.example.test/cb', 'credentials in the authority'],
    ['http://localhost/cb', 'http://localhost.evil.example.test:3000/cb', 'a lookalike host'],
    ['http://127.0.0.1/cb', 'http://127.0.0.1:99999/cb', 'an invalid port'],
    ['http://127.0.0.1/cb', 'http://127.0.0.1:0/cb', 'port zero'],
    ['http://127.0.0.1/cb', 'http://127.0.0.1:3000/cb#x', 'a fragment'],
  ])('refuses %s vs %s (%s)', (registered, requested) => {
    expect(matchesRedirectUri([registered], requested)).toBe(false);
  });

  it('never applies the loopback exception to a non-loopback host', () => {
    expect(matchesRedirectUri(['http://client.example.test/cb'], 'http://client.example.test:8080/cb')).toBe(false);
  });

  it('knows a loopback redirect and the host a person returns to', () => {
    expect(isLoopbackRedirectUri('http://127.0.0.1:1/cb')).toBe(true);
    expect(isLoopbackRedirectUri('http://[::1]/cb')).toBe(true);
    expect(isLoopbackRedirectUri('http://localhost:8/cb')).toBe(true);
    expect(isLoopbackRedirectUri('https://localhost/cb')).toBe(false);
    expect(isLoopbackRedirectUri('https://client.example.test/cb')).toBe(false);
    expect(redirectHostOf('https://client.example.test:8443/cb')).toBe('client.example.test:8443');
    expect(redirectHostOf('com.example.app://cb')).toBe('com.example.app://');
    expect(redirectHostOf('not a url')).toBe('');
  });
});

describe('resource identifier normalisation (RFC 8707)', () => {
  it.each([
    ['HTTPS://App.Example.Test/api/mcp', 'https://app.example.test/api/mcp'],
    ['https://app.example.test/api/mcp/', 'https://app.example.test/api/mcp'],
    ['https://app.example.test/api/mcp#frag', 'https://app.example.test/api/mcp'],
    ['https://app.example.test:443/api/mcp', 'https://app.example.test/api/mcp'],
  ])('normalises %s', (input, expected) => {
    expect(normalizeResourceIdentifier(input)).toBe(expected);
  });

  it.each(['', 'not a url', 'ftp://app.example.test/x', 'https://user:pw@app.example.test/x'])('refuses %j', (input) => {
    expect(normalizeResourceIdentifier(input)).toBeNull();
  });
});

describe('the in-memory fixed-window rate limiter', () => {
  it('allows the limit, refuses the next hit with whole seconds to wait, and resets after the window', () => {
    let now = 1_000_000;
    const limiter = new InMemoryOAuthRateLimiter(() => now);
    for (let i = 0; i < 3; i += 1) expect(limiter.consume('k', 3, 60_000).allowed).toBe(true);
    const refused = limiter.consume('k', 3, 60_000);
    expect(refused.allowed).toBe(false);
    expect(refused.retryAfterSeconds).toBe(60);
    now += 30_500;
    expect(limiter.consume('k', 3, 60_000)).toMatchObject({ allowed: false, retryAfterSeconds: 30 });
    now += 30_000;
    expect(limiter.consume('k', 3, 60_000).allowed).toBe(true);
  });

  it('counts each key on its own', () => {
    const limiter = new InMemoryOAuthRateLimiter(() => 0);
    expect(limiter.consume('a', 1, 1000).allowed).toBe(true);
    expect(limiter.consume('a', 1, 1000).allowed).toBe(false);
    expect(limiter.consume('b', 1, 1000).allowed).toBe(true);
  });
});

describe('protocol errors', () => {
  it('carry the RFC 6749 body, status and headers', () => {
    const bad = oauthError('invalid_grant', 'nope');
    expect(bad.getStatus()).toBe(400);
    expect(bad.getResponse()).toEqual({ error: 'invalid_grant', error_description: 'nope' });
    const client = invalidClient();
    expect(client.getStatus()).toBe(401);
    expect(client.headers['WWW-Authenticate']).toMatch(/^Basic /);
    const limited = rateLimited(12.2);
    expect(limited.getStatus()).toBe(429);
    expect(limited.getResponse()).toMatchObject({ error: 'temporarily_unavailable' });
    expect(limited.headers['Retry-After']).toBe('13');
  });
});

describe('the token endpoint form', () => {
  it('accepts string parameters', () => {
    expect(parseOAuthForm({ grant_type: 'refresh_token', refresh_token: 'x' })).toEqual({ grant_type: 'refresh_token', refresh_token: 'x' });
  });

  it.each([[null], [undefined], ['text'], [['a']], [{ grant_type: ['a', 'b'] }]])('refuses %j as invalid_request', (raw) => {
    expect(() => parseOAuthForm(raw)).toThrow(expect.objectContaining({ code: 'invalid_request' }));
  });

  it('refuses a body larger than 16 KiB', () => {
    expect(() => parseOAuthForm({ code: 'x'.repeat(17 * 1024) })).toThrow(expect.objectContaining({ code: 'invalid_request' }));
  });
});

describe('the body guard of /token and /revoke', () => {
  const form = { 'content-type': 'application/x-www-form-urlencoded', 'content-length': '40' };

  it('lets a small form through', () => {
    expect(oauthBodyViolation('POST', '/api/oauth/token', form)).toBeNull();
    expect(oauthBodyViolation('POST', '/api/oauth/revoke?x=1', { ...form, 'content-type': 'application/x-www-form-urlencoded; charset=utf-8' })).toBeNull();
  });

  it('refuses JSON, text and a missing content type', () => {
    for (const type of ['application/json', 'text/plain', undefined]) {
      expect(oauthBodyViolation('POST', '/api/oauth/token', { 'content-type': type })).toMatch(/x-www-form-urlencoded/);
    }
  });

  it('refuses a body over 16 KiB by Content-Length', () => {
    expect(oauthBodyViolation('POST', '/api/oauth/token', { ...form, 'content-length': String(16 * 1024 + 1) })).toMatch(/too large/);
    expect(oauthBodyViolation('POST', '/api/oauth/token', { ...form, 'content-length': String(16 * 1024) })).toBeNull();
  });

  it('leaves every other route alone, JSON included', () => {
    expect(oauthBodyViolation('POST', '/api/oauth/requests/x/decision', { 'content-type': 'application/json' })).toBeNull();
    expect(oauthBodyViolation('POST', '/api/pat', { 'content-type': 'application/json' })).toBeNull();
    expect(oauthBodyViolation('GET', '/api/oauth/token', {})).toBeNull();
    expect(oauthBodyViolation('OPTIONS', '/api/oauth/token', {})).toBeNull();
  });
});
