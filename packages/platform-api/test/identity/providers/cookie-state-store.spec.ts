import { createCookieStateStore } from '../../../src/identity/auth/providers/cookie-state-store';

const SECRET = 'cookie-state-store-test-secret';

function fixture(options: Partial<Parameters<typeof createCookieStateStore>[0]> = {}) {
  const store = createCookieStateStore({ secret: SECRET, secure: false, ...options });
  const headers: string[] = [];
  const res = { appendHeader: (_name: string, value: string) => headers.push(value) };
  const issue = () => {
    let state = '';
    store.store({ res } as never, (error, value) => {
      expect(error).toBeNull();
      state = value!;
    });
    const cookie = headers.at(-1)!.split(';')[0]!;
    return { state, cookie, header: headers.at(-1)! };
  };
  const verify = (cookie: string | undefined, provided: string) => {
    const req = { headers: cookie ? { cookie } : {} } as { headers: { cookie?: string }; clearAuthStateCookie?: string };
    let result: [boolean | undefined, { message: string } | undefined] = [undefined, undefined];
    store.verify(req as never, provided, (_e, ok, info) => (result = [ok, info]));
    return { ok: result[0], info: result[1], req };
  };
  return { issue, verify, store };
}

describe('createCookieStateStore', () => {
  it('sets a signed HttpOnly, SameSite=Lax cookie scoped to /api/auth with a short life', () => {
    const { header, state } = fixture().issue();
    expect(header).toMatch(/^oauth_state=/);
    expect(header).toContain('HttpOnly');
    expect(header).toContain('SameSite=Lax');
    expect(header).toContain('Path=/api/auth');
    expect(header).toContain('Max-Age=600');
    expect(header).not.toContain('Secure');
    expect(state.length).toBeGreaterThanOrEqual(32);
    expect(header).toContain(state);
  });

  it('is Secure in production', () => {
    expect(fixture({ secure: true }).issue().header).toContain('; Secure');
  });

  it('accepts the matching state and marks the cookie for clearing (single use)', () => {
    const f = fixture();
    const { cookie, state } = f.issue();
    const out = f.verify(cookie, state);
    expect(out.ok).toBe(true);
    expect(out.req.clearAuthStateCookie).toBe('oauth_state');
  });

  it.each([
    ['no cookie', () => ({ cookie: undefined as string | undefined, provided: 'whatever' })],
    ['a different state', (f: ReturnType<typeof fixture>) => ({ cookie: f.issue().cookie, provided: 'attacker-chosen' })],
    ['a missing provider state', (f: ReturnType<typeof fixture>) => ({ cookie: f.issue().cookie, provided: undefined as unknown as string })],
    ['an edited state', (f: ReturnType<typeof fixture>) => {
      const { cookie, state } = f.issue();
      return { cookie: cookie.replace(state, 'forged-state'), provided: 'forged-state' };
    }],
    ['a signature from another key', (f: ReturnType<typeof fixture>) => {
      const other = fixture({ secret: 'another-secret' }).issue();
      return { cookie: other.cookie, provided: other.state };
    }],
  ])('refuses %s', (_name, make) => {
    const f = fixture();
    const { cookie, provided } = make(f);
    const out = f.verify(cookie, provided);
    expect(out.ok).toBe(false);
    expect(out.info?.message).toBeTruthy();
  });

  it('refuses an expired state', () => {
    const f = fixture({ ttlSeconds: -1 });
    const { cookie, state } = f.issue();
    expect(f.verify(cookie, state).ok).toBe(false);
  });

  it('needs a secret, and the response', () => {
    expect(() => createCookieStateStore({ secret: '' })).toThrow(/secret/);
    const store = createCookieStateStore({ secret: SECRET });
    let error: Error | null = null;
    store.store({} as never, (e) => (error = e));
    expect(error).toBeInstanceOf(Error);
  });
});
