// The sign-in callback route (issue #652), moved from the reference app's
// `pages/AuthCallbackPage.tsx` (issue #727): takes the access token from the
// URL, reads the user, and returns to where the sign-in started; or shows the
// sign-in error screen for a known failure code (never the raw `?error=`).

import { useEffect, useState } from 'react';
import type { ReactElement } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Box, CircularProgress, Typography } from '@mui/material';
import { useAuth } from '../headless/index.js';
import { SignInErrorView } from './SignInErrorView.js';
import { DEFAULT_SIGN_IN_ERROR_CODE, resolveSignInErrorCode, type SignInErrorCode } from './sign-in-error-content.js';

/**
 * What {@link AuthCallbackPage} takes.
 *
 * @stability stable
 */
export interface AuthCallbackPageProps {
  /**
   * The provider the error screen's retry buttons restart.
   *
   * @defaultValue `'google'`
   */
  provider?: string;
}

/**
 * The `/auth/callback` route.
 *
 * @param props - see {@link AuthCallbackPageProps}.
 * @returns the page.
 *
 * @extensionPoint component
 * @stability stable
 */
export function AuthCallbackPage({ provider = 'google' }: AuthCallbackPageProps = {}): ReactElement {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { refreshUser, login, setAccessToken } = useAuth();
  // Only ever a known code: the `?error=` value is never rendered (#652).
  const [errorCode, setErrorCode] = useState<SignInErrorCode | null>(null);

  useEffect(() => {
    const handleCallback = async () => {
      const token = searchParams.get('token');
      const errorParam = searchParams.get('error');

      if (errorParam) {
        setErrorCode(resolveSignInErrorCode(errorParam));
        return;
      }

      if (!token) {
        setErrorCode(DEFAULT_SIGN_IN_ERROR_CODE);
        return;
      }

      try {
        // Store the access token
        setAccessToken(token);

        // Fetch user data
        await refreshUser();

        // Get the return URL and clear it
        const returnUrl = sessionStorage.getItem('auth_return_url') || '/';
        sessionStorage.removeItem('auth_return_url');

        navigate(returnUrl, { replace: true });
      } catch {
        setErrorCode(DEFAULT_SIGN_IN_ERROR_CODE);
        setAccessToken(null);
      }
    };

    void handleCallback();
    // `setAccessToken` is stable for a stable client; the effect keys on what it always did.
  }, [searchParams, navigate, refreshUser]);

  if (errorCode) {
    return (
      <SignInErrorView
        code={errorCode}
        onSignInWithDifferentAccount={() => login(provider, { selectAccount: true })}
        onTryAgain={() => login(provider)}
      />
    );
  }

  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100vh',
        gap: 2,
      }}
    >
      <CircularProgress />
      <Typography>Completing authentication...</Typography>
    </Box>
  );
}
