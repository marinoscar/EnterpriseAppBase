import { AuthLoginDeniedException } from '../../../src/identity/auth/auth-error-codes';
import {
  REFRESH_TOKEN_COOKIE,
  REFRESH_TOKEN_COOKIE_OPTIONS,
  buildSignInSuccessRedirectUrl,
  respondToSignIn,
  setRefreshTokenCookie,
} from '../../../src/identity/auth/sign-in-response';
import { AuthController } from '../../../src/identity/auth/auth.controller';
import { DatabaseSeedException } from '../../../src/core/index';

// =============================================================================
// The browser half of a sign-in (PP-14.9): the refresh cookie and the redirect,
// shared by Google's callback and every other provider's. The literals below
// are what Google's callback set before the helper existed; a change to any of
// them is a change to every session.
// =============================================================================

function reply() {
  return { setCookie: jest.fn(), status: jest.fn().mockReturnThis(), redirect: jest.fn().mockReturnThis() };
}
const logger = () => ({ log: jest.fn(), error: jest.fn() });

describe('the refresh cookie', () => {
  it('has exactly the attributes Google\'s callback always set', () => {
    expect(REFRESH_TOKEN_COOKIE).toBe('refresh_token');
    expect({ ...REFRESH_TOKEN_COOKIE_OPTIONS }).toEqual({
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/api/auth',
      maxAge: 1_209_600,
    });
  });

  it('is set through setCookie with a copy of the options', () => {
    const r = reply();
    setRefreshTokenCookie(r as never, 'rt-1');
    expect(r.setCookie).toHaveBeenCalledWith('refresh_token', 'rt-1', { ...REFRESH_TOKEN_COOKIE_OPTIONS });
    expect(r.setCookie.mock.calls[0]![2]).not.toBe(REFRESH_TOKEN_COOKIE_OPTIONS);
  });
});

describe('respondToSignIn', () => {
  it('sets the cookie, then redirects 302 to /auth/callback with the access token and lifetime', async () => {
    const r = reply();
    await respondToSignIn({
      reply: r as never,
      appUrl: 'https://app.example.com',
      signIn: async () => ({ accessToken: 'at-1', refreshToken: 'rt-1', expiresIn: 900 }),
      logger: logger(),
      label: 'test callback',
    });

    expect(r.setCookie).toHaveBeenCalledWith('refresh_token', 'rt-1', { ...REFRESH_TOKEN_COOKIE_OPTIONS });
    expect(r.status).toHaveBeenCalledWith(302);
    expect(r.redirect).toHaveBeenCalledWith('https://app.example.com/auth/callback?token=at-1&expiresIn=900');
    // Access token in the URL only; the refresh token never is.
    expect(r.redirect.mock.calls[0]![0]).not.toContain('rt-1');
  });

  it('never writes the access token (the redirect URL) to the log', async () => {
    const r = reply();
    const log = logger();
    await respondToSignIn({
      reply: r as never,
      appUrl: 'https://app.example.com',
      signIn: async () => ({ accessToken: 'at-secret', refreshToken: 'rt-secret', expiresIn: 900 }),
      logger: log,
      label: 'test callback',
    });
    expect(JSON.stringify([log.log.mock.calls, log.error.mock.calls])).not.toMatch(/at-secret|rt-secret/);
  });

  it.each([
    ['not_allowlisted', new AuthLoginDeniedException('not_allowlisted', 'secret text')],
    ['access_denied', new AuthLoginDeniedException('access_denied', 'secret text')],
    ['server_misconfigured', new DatabaseSeedException('roles')],
    ['authentication_failed', new Error('secret text')],
  ])('redirects a failure with an explicit 302 and error=%s, setting no cookie and leaking no message', async (code, thrown) => {
    const r = reply();
    await respondToSignIn({
      reply: r as never,
      appUrl: 'https://app.example.com',
      signIn: async () => {
        throw thrown;
      },
      logger: logger(),
      label: 'test callback',
    });

    expect(r.setCookie).not.toHaveBeenCalled();
    expect(r.status).toHaveBeenCalledWith(302);
    expect(r.redirect).toHaveBeenCalledWith(`https://app.example.com/auth/callback?error=${code}`);
  });

  it('builds the success URL from the app origin', () => {
    expect(buildSignInSuccessRedirectUrl('https://app.example.com/', { accessToken: 'a b', expiresIn: 60 })).toBe(
      'https://app.example.com/auth/callback?token=a+b&expiresIn=60',
    );
  });
});

describe('Google\'s callback through the shared helper (byte-identical)', () => {
  const profile = { id: 'g-1', email: 'p@example.com', displayName: 'P' };

  function controller(handleGoogleLogin: jest.Mock) {
    return new AuthController({ handleGoogleLogin } as never, { get: (key: string) => (key === 'appUrl' ? 'https://app.example.com' : undefined) } as never);
  }

  it('sets the refresh cookie with the historical attributes and redirects exactly as before', async () => {
    const r = reply();
    const login = jest.fn().mockResolvedValue({ accessToken: 'at', refreshToken: 'rt', expiresIn: 900 });

    await controller(login).googleAuthCallback({ user: profile } as never, r as never);

    expect(login).toHaveBeenCalledWith(profile);
    expect(r.setCookie).toHaveBeenCalledWith('refresh_token', 'rt', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/api/auth',
      maxAge: 14 * 24 * 60 * 60,
    });
    expect(r.status).toHaveBeenCalledWith(302);
    expect(r.redirect).toHaveBeenCalledWith('https://app.example.com/auth/callback?token=at&expiresIn=900');
  });

  it('keeps refresh rotation and switch-org on the same cookie', async () => {
    const r = reply();
    const refresh = jest.fn().mockResolvedValue({ accessToken: 'at2', refreshToken: 'rt2', expiresIn: 900 });
    const c = new AuthController({ refreshAccessToken: refresh } as never, { get: () => undefined } as never);

    const out = await c.refresh({ cookies: { refresh_token: 'rt1' } } as never, r as never);

    expect(refresh).toHaveBeenCalledWith('rt1');
    expect(r.setCookie).toHaveBeenCalledWith('refresh_token', 'rt2', { ...REFRESH_TOKEN_COOKIE_OPTIONS });
    expect(out).toEqual({ accessToken: 'at2', expiresIn: 900 });
  });
});
