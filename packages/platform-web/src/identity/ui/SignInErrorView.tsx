import { useEffect, useMemo, useRef } from 'react';
import type { ReactElement } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { Box, Button, Card, CardContent, Stack, Typography, useTheme } from '@mui/material';
import { useIdentityWebAdapters } from '../headless/index.js';
import { createSignInErrorContent, type SignInErrorCode } from './sign-in-error-content.js';

/**
 * What {@link SignInErrorView} takes.
 *
 * @stability stable
 */
export interface SignInErrorViewProps {
  /** The (already narrowed) failure code; nothing from the URL is rendered. */
  code: SignInErrorCode;
  /** Restart Google sign-in showing the account chooser. */
  onSignInWithDifferentAccount: () => void;
  /** Restart Google sign-in as usual. */
  onTryAgain: () => void;
  /**
   * The login route the "Back to sign in" button links to.
   *
   * @defaultValue `'/login'`
   */
  loginPath?: string;
}

/**
 * Full-page screen for a failed sign-in (#652), in the visual language of
 * `LoginPage`: a centered card on the theme's default background.
 *
 * Refusals the person can act on (not on the allowlist, deactivated, cancelled)
 * use calm `info`/`warning` palette colours; only real faults use `error`.
 * The copy comes from {@link createSignInErrorContent}, naming the identity
 * adapters' `appName`; nothing from the URL is rendered.
 *
 * @param props - see {@link SignInErrorViewProps}.
 * @returns the screen.
 *
 * @extensionPoint component
 * @stability stable
 */
export function SignInErrorView({
  code,
  onSignInWithDifferentAccount,
  onTryAgain,
  loginPath = '/login',
}: SignInErrorViewProps): ReactElement {
  const theme = useTheme();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const { appName = 'this app' } = useIdentityWebAdapters();
  const content = useMemo(() => createSignInErrorContent(appName), [appName]);
  const { severity, Icon, headline, explanation, nextSteps, primaryAction } = content[code];
  const accent = theme.palette[severity];

  // Move focus to the heading so a screen reader announces the outcome and
  // keyboard users start at the top of the content.
  useEffect(() => {
    headingRef.current?.focus();
  }, [code]);

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
      <Card sx={{ maxWidth: 440, width: '100%', boxShadow: theme.shadows[10] }}>
        <CardContent sx={{ p: { xs: 3, sm: 4 } }}>
          <Stack spacing={3} sx={{ alignItems: 'center', textAlign: 'center' }}>
            <Box
              aria-hidden
              sx={{
                width: 72,
                height: 72,
                borderRadius: '50%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: accent.main,
                backgroundColor: theme.palette.action.hover,
                border: 2,
                borderColor: accent.main,
              }}
            >
              <Icon sx={{ fontSize: 36 }} />
            </Box>

            <Box role={severity === 'error' ? 'alert' : 'status'}>
              <Typography
                ref={headingRef}
                tabIndex={-1}
                variant="h5"
                component="h1"
                sx={{ fontWeight: 'bold', outline: 'none' }}
              >
                {headline}
              </Typography>
              <Typography color="text.secondary" sx={{ mt: 1 }}>
                {explanation}
              </Typography>
            </Box>

            <Stack
              component="ul"
              spacing={1}
              sx={{ m: 0, p: 0, listStyle: 'none', width: '100%' }}
            >
              {nextSteps.map((step) => (
                <Typography key={step} component="li" variant="body2">
                  {step}
                </Typography>
              ))}
            </Stack>

            <Stack spacing={1.5} sx={{ width: '100%' }}>
              {primaryAction === 'different-account' && (
                <Button
                  fullWidth
                  size="large"
                  variant="contained"
                  onClick={onSignInWithDifferentAccount}
                >
                  Sign in with a different account
                </Button>
              )}
              {primaryAction === 'try-again' && (
                <Button fullWidth size="large" variant="contained" onClick={onTryAgain}>
                  Try again
                </Button>
              )}
              <Button
                fullWidth
                size="large"
                variant={primaryAction === 'none' ? 'contained' : 'text'}
                component={RouterLink}
                to={loginPath}
              >
                Back to sign in
              </Button>
            </Stack>
          </Stack>
        </CardContent>
      </Card>
    </Box>
  );
}
