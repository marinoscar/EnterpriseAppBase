import { useEffect, useRef } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { Box, Button, Card, CardContent, Stack, Typography, useTheme } from '@mui/material';
import {
  SIGN_IN_ERROR_CONTENT,
  type SignInErrorCode,
} from './signInErrorContent';

interface SignInErrorViewProps {
  code: SignInErrorCode;
  /** Restart Google sign-in showing the account chooser. */
  onSignInWithDifferentAccount: () => void;
  /** Restart Google sign-in as usual. */
  onTryAgain: () => void;
}

/**
 * Full-page screen for a failed sign-in (#652), in the visual language of
 * `LoginPage`: a centered card on the theme's default background.
 *
 * Refusals the person can act on (not on the allowlist, deactivated, cancelled)
 * use calm `info`/`warning` palette colours; only real faults use `error`.
 * The copy comes from `signInErrorContent.ts`; nothing from the URL is rendered.
 */
export function SignInErrorView({
  code,
  onSignInWithDifferentAccount,
  onTryAgain,
}: SignInErrorViewProps) {
  const theme = useTheme();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const { severity, Icon, headline, explanation, nextSteps, primaryAction } =
    SIGN_IN_ERROR_CONTENT[code];
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
                to="/login"
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
