// The login page (issue #727), moved from the reference app's
// `pages/LoginPage.tsx`. "Packages own behaviour, apps own appearance": the
// page owns the flow (redirect when signed in, the session-expired notice,
// one button per provider the API offers); the app restyles it through the
// theme and replaces parts through `slots`.

import { useEffect } from 'react';
import type { ComponentType, ReactElement } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Alert, Box, Card, CardContent, CircularProgress, Divider, Stack, Typography, useTheme } from '@mui/material';
import { useAuth, useIdentityWebAdapters } from '../headless/index.js';
import { OAuthButton } from './OAuthButton.js';
import type { OAuthButtonProps } from './OAuthButton.js';

interface LocationState {
  from?: { pathname: string; search: string };
}

/**
 * The replaceable parts of {@link LoginPage}. Each slot defaults to the
 * package's own rendering.
 *
 * @stability experimental
 */
export interface LoginPageSlots {
  /** Rendered above the title (nothing by default). */
  Logo?: ComponentType;
  /** The heading block (default: "Welcome" and "Sign in to continue"). */
  Title?: ComponentType;
  /** The block under the providers (default: the terms caption). */
  Footer?: ComponentType;
  /** One provider's button (default: {@link OAuthButton}). */
  ProviderButton?: ComponentType<OAuthButtonProps>;
}

/**
 * What {@link LoginPage} takes.
 *
 * @stability experimental
 */
export interface LoginPageProps {
  /** Replace parts of the page. */
  slots?: LoginPageSlots;
}

function DefaultTitle(): ReactElement {
  return (
    <>
      <Typography variant="h4" component="h1" sx={{ fontWeight: 'bold' }}>
        Welcome
      </Typography>
      <Typography color="text.secondary" sx={{ mt: 1 }}>
        Sign in to continue
      </Typography>
    </>
  );
}

function DefaultFooter(): ReactElement {
  return (
    <Typography variant="caption" color="text.secondary">
      By signing in, you agree to our Terms of Service and Privacy Policy
    </Typography>
  );
}

function DefaultFullScreenSpinner(): ReactElement {
  return (
    <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', width: '100vw' }}>
      <CircularProgress size={40} />
    </Box>
  );
}

/**
 * The login route: a centered card with one button per sign-in provider the
 * API offers, the session-expired notice, and a redirect back to `state.from`
 * once signed in.
 *
 * @param props - see {@link LoginPageProps}.
 * @returns the page.
 *
 * @example
 * ```tsx
 * <LoginPage slots={{ Logo: AppLogo, Footer: AppLegalLinks }} />
 * ```
 *
 * @extensionPoint slot
 * @stability experimental
 */
export function LoginPage({ slots = {} }: LoginPageProps = {}): ReactElement {
  const { isAuthenticated, isLoading, providers, login, sessionExpired } = useAuth();
  const { Spinner } = useIdentityWebAdapters();
  const navigate = useNavigate();
  const location = useLocation();
  const theme = useTheme();
  const { Logo, Title = DefaultTitle, Footer = DefaultFooter, ProviderButton = OAuthButton } = slots;

  // The return URL from location state (set by RequireAuth)
  const state = location.state as LocationState | null;
  const returnUrl = state?.from ? `${state.from.pathname}${state.from.search || ''}` : '/';

  // Redirect if already authenticated
  useEffect(() => {
    if (isAuthenticated && !isLoading) {
      navigate(returnUrl, { replace: true });
    }
  }, [isAuthenticated, isLoading, navigate, returnUrl]);

  if (isLoading) {
    return Spinner ? <Spinner fullScreen /> : <DefaultFullScreenSpinner />;
  }

  return (
    <Box
      sx={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: theme.palette.background.default,
        p: 2,
      }}
    >
      <Card
        sx={{
          maxWidth: 400,
          width: '100%',
          boxShadow: theme.shadows[10],
        }}
      >
        <CardContent sx={{ p: 4 }}>
          {/* Logo/Header */}
          <Box sx={{ textAlign: 'center', mb: 4 }}>
            {Logo && <Logo />}
            <Title />
          </Box>

          {/* The server refused to refresh a signed-in session. */}
          {sessionExpired && (
            <Alert severity="info" sx={{ mb: 3 }} data-testid="session-expired-notice">
              Your session expired. Please sign in again.
            </Alert>
          )}

          <Divider sx={{ mb: 3 }}>
            <Typography variant="body2" color="text.secondary">
              Sign in with
            </Typography>
          </Divider>

          {/* OAuth Providers */}
          <Stack spacing={2}>
            {providers.length > 0 ? (
              providers.map((provider) => (
                <ProviderButton key={provider.name} provider={provider.name} onClick={() => login(provider.name)} />
              ))
            ) : (
              <Typography color="text.secondary" sx={{ textAlign: 'center' }}>
                No authentication providers configured
              </Typography>
            )}
          </Stack>

          {/* Footer */}
          <Box sx={{ mt: 4, textAlign: 'center' }}>
            <Footer />
          </Box>
        </CardContent>
      </Card>
    </Box>
  );
}
