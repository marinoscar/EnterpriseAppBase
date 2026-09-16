import { describe, expect, it } from 'vitest';

import type { FetchLike } from './health.js';
import {
  GOOGLE_TOKEN_ENDPOINT,
  checkCallbackUrl,
  checkClientIdShape,
  compareAuthorizeRedirect,
  expectedCallbackUrl,
  listsGoogle,
  probeCredentials,
  smokeOAuth,
  verifyOAuthConfiguration,
} from './oauth-check.js';

const CLIENT_ID = '1234567890-abcdefghijklmnop.apps.googleusercontent.com';
const CLIENT_SECRET = 'GOCSPX-super-secret-value';
const DOMAIN = 'app.example.test';

interface Call {
  url: string;
  init: RequestInit | undefined;
}

/** A fetch that answers from a table, recording what it was asked. */
function fakeFetch(
  respond: (url: string) => { status?: number; body?: unknown; headers?: Record<string, string> } | Error,
): { fetch: FetchLike; calls: Call[] } {
  const calls: Call[] = [];

  const fetchLike = (async (input: unknown, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    calls.push({ url, init });

    const answer = respond(url);
    if (answer instanceof Error) throw answer;

    return {
      status: answer.status ?? 200,
      headers: new Headers(answer.headers ?? {}),
      json: async () => answer.body,
    } as unknown as Response;
  }) as unknown as FetchLike;

  return { fetch: fetchLike, calls };
}

describe('layer 1: the client id', () => {
  it('accepts a Google client id', () => {
    expect(checkClientIdShape(CLIENT_ID).status).toBe('pass');
  });

  it('rejects an empty one, because an empty id crashes bootstrap', () => {
    expect(checkClientIdShape('').status).toBe('fail');
    expect(checkClientIdShape(undefined).status).toBe('fail');
  });

  it('rejects the secret pasted into the id field', () => {
    const finding = checkClientIdShape(CLIENT_SECRET);
    expect(finding.status).toBe('fail');
    expect(finding.remedy).toContain('Client ID');
  });
});

describe('layer 2: the callback URL', () => {
  it('accepts the URL derived from the domain being deployed', () => {
    expect(checkCallbackUrl(expectedCallbackUrl(DOMAIN), DOMAIN).status).toBe('pass');
  });

  it('rejects one that names a different domain', () => {
    // The top row of the runbook's troubleshooting table: the login loop.
    const finding = checkCallbackUrl(
      'https://staging.example.test/api/auth/google/callback',
      DOMAIN,
    );

    expect(finding.status).toBe('fail');
    expect(finding.remedy).toContain(expectedCallbackUrl(DOMAIN));
  });

  it('rejects http, a missing path, and an empty value', () => {
    for (const value of ['', `http://${DOMAIN}/api/auth/google/callback`, `https://${DOMAIN}`]) {
      expect(checkCallbackUrl(value, DOMAIN).status).toBe('fail');
    }
  });
});

describe('layer 3: the live credential probe', () => {
  it('treats invalid_grant as SUCCESS, because the client was authenticated', async () => {
    // The counter-intuitive half of this whole check. Google authenticates the
    // CLIENT before it evaluates the GRANT, so rejecting only the deliberately
    // invalid code means the id and secret were accepted.
    const { fetch, calls } = fakeFetch(() => ({ status: 400, body: { error: 'invalid_grant' } }));

    const finding = await probeCredentials({
      clientId: CLIENT_ID,
      clientSecret: CLIENT_SECRET,
      redirectUri: expectedCallbackUrl(DOMAIN),
      fetch,
    });

    expect(finding.status).toBe('pass');
    expect(calls[0]?.url).toBe(GOOGLE_TOKEN_ENDPOINT);
    expect(String(calls[0]?.init?.body)).toContain('grant_type=authorization_code');
  });

  it('treats invalid_client as failure', async () => {
    const { fetch } = fakeFetch(() => ({ status: 401, body: { error: 'invalid_client' } }));

    const finding = await probeCredentials({
      clientId: CLIENT_ID,
      clientSecret: CLIENT_SECRET,
      redirectUri: expectedCallbackUrl(DOMAIN),
      fetch,
    });

    expect(finding.status).toBe('fail');
    expect(finding.detail).toContain('invalid_client');
  });

  it('treats a network failure as a WARNING, never a hard fail', async () => {
    // An air-gapped or egress-filtered server must still be able to install.
    const { fetch } = fakeFetch(() => new Error('getaddrinfo ENOTFOUND oauth2.googleapis.com'));

    const finding = await probeCredentials({
      clientId: CLIENT_ID,
      clientSecret: CLIENT_SECRET,
      redirectUri: expectedCallbackUrl(DOMAIN),
      fetch,
    });

    expect(finding.status).toBe('warn');
  });

  it('never repeats the secret back in any field of the finding', async () => {
    const { fetch } = fakeFetch(() => ({
      status: 401,
      // Even if the endpoint echoed it, which it does not, only the `error`
      // code is ever read out of the body.
      body: { error: 'invalid_client', error_description: `bad secret ${CLIENT_SECRET}` },
    }));

    const finding = await probeCredentials({
      clientId: CLIENT_ID,
      clientSecret: CLIENT_SECRET,
      redirectUri: expectedCallbackUrl(DOMAIN),
      fetch,
    });

    expect(JSON.stringify(finding)).not.toContain(CLIENT_SECRET);
  });
});

describe('verifyOAuthConfiguration', () => {
  function env(overrides: Record<string, string> = {}): Map<string, string> {
    return new Map(
      Object.entries({
        GOOGLE_CLIENT_ID: CLIENT_ID,
        GOOGLE_CLIENT_SECRET: CLIENT_SECRET,
        GOOGLE_CALLBACK_URL: expectedCallbackUrl(DOMAIN),
        ...overrides,
      }),
    );
  }

  it('runs all three layers on a well-formed environment', async () => {
    const { fetch } = fakeFetch(() => ({ status: 400, body: { error: 'invalid_grant' } }));

    const findings = await verifyOAuthConfiguration({ env: env(), domain: DOMAIN, fetch });

    expect(findings.map((finding) => finding.id)).toEqual([
      'oauth-client-id',
      'oauth-callback-url',
      'oauth-credentials',
    ]);
    expect(findings.every((finding) => finding.status === 'pass')).toBe(true);
  });

  it('does not spend a round trip when the id is already unusable', async () => {
    const { fetch, calls } = fakeFetch(() => ({ status: 400, body: { error: 'invalid_grant' } }));

    const findings = await verifyOAuthConfiguration({
      env: env({ GOOGLE_CLIENT_ID: 'not-a-client-id' }),
      domain: DOMAIN,
      fetch,
    });

    expect(findings[0]?.status).toBe('fail');
    expect(findings[2]?.status).toBe('warn');
    expect(calls).toEqual([]);
  });
});

describe('listsGoogle', () => {
  it('reads the API\'s own envelope', () => {
    expect(listsGoogle({ data: { providers: [{ name: 'google', enabled: true }] } })).toBe(true);
    expect(listsGoogle({ data: { providers: [] } })).toBe(false);
  });

  it('is undefined for a shape it does not recognise', () => {
    // A forked API that answers differently must not be reported as broken.
    expect(listsGoogle({ data: { something: 'else' } })).toBeUndefined();
    expect(listsGoogle(undefined)).toBeUndefined();
  });
});

describe('the post-deploy sign-in smoke test', () => {
  const BASE = 'http://127.0.0.1:3535';
  const AUTHORIZE = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${CLIENT_ID}&redirect_uri=${encodeURIComponent(expectedCallbackUrl(DOMAIN))}&response_type=code`;

  function wired(location = AUTHORIZE) {
    return fakeFetch((url) =>
      url.endsWith('/api/auth/providers')
        ? { status: 200, body: { data: { providers: [{ name: 'google', enabled: true }] } } }
        : { status: 302, headers: { location } },
    );
  }

  it('passes when the API lists google and redirects to it with the configured client', async () => {
    const { fetch } = wired();

    const finding = await smokeOAuth({
      baseUrl: BASE,
      clientId: CLIENT_ID,
      callbackUrl: expectedCallbackUrl(DOMAIN),
      fetch,
    });

    expect(finding.status).toBe('pass');
  });

  it('fails when the API does not consider google configured', async () => {
    const { fetch } = fakeFetch(() => ({ status: 200, body: { data: { providers: [] } } }));

    const finding = await smokeOAuth({ baseUrl: BASE, fetch });

    expect(finding.status).toBe('fail');
    expect(finding.remedy).toContain('GOOGLE_CLIENT_SECRET');
  });

  it('fails when the redirect carries a different client id', async () => {
    const { fetch } = wired(
      AUTHORIZE.replace(CLIENT_ID, '999-other.apps.googleusercontent.com'),
    );

    const finding = await smokeOAuth({
      baseUrl: BASE,
      clientId: CLIENT_ID,
      fetch,
    });

    expect(finding.status).toBe('fail');
    // The values are compared, never reported.
    expect(finding.detail).not.toContain(CLIENT_ID);
  });

  it('warns rather than fails when the application cannot be reached', async () => {
    const { fetch } = fakeFetch(() => new Error('connect ECONNREFUSED'));

    expect((await smokeOAuth({ baseUrl: BASE, fetch })).status).toBe('warn');
  });

  it('warns when the redirect goes somewhere this check does not recognise', async () => {
    const finding = compareAuthorizeRedirect('https://login.example.test/authorize', {
      clientId: CLIENT_ID,
    });

    expect(finding.status).toBe('warn');
  });

  it('fails when Google is asked to return to the wrong URL', async () => {
    const finding = compareAuthorizeRedirect(AUTHORIZE, {
      callbackUrl: 'https://other.example.test/api/auth/google/callback',
    });

    expect(finding.status).toBe('fail');
    expect(finding.remedy).toContain('registered');
  });
});
