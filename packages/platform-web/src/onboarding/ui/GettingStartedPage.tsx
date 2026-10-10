// =============================================================================
// GettingStartedPage (issue #745): `/settings/getting-started`
// =============================================================================
//
// The caller's own checklist, with Skip on the skippable steps, and a way to
// see the welcome again. A user settings card with no permission: every role
// holds `user_settings:read`.
// =============================================================================

import { Alert, Box, Button, Card, CardContent, Container, Skeleton, Stack, Typography } from '@mui/material';
import type { ReactElement } from 'react';

import { useOnboarding } from '../headless/provider.js';
import { GETTING_STARTED_DESCRIPTION, GETTING_STARTED_TITLE } from './copy.js';
import { OnboardingChecklist } from './OnboardingChecklist.js';

/**
 * The Getting started page.
 *
 * @returns the page.
 *
 * @example
 * ```tsx
 * <Route path="/settings/getting-started" element={<GettingStartedPage />} />
 * ```
 *
 * @extensionPoint component
 * @stability experimental
 */
export function GettingStartedPage(): ReactElement {
  const { state, isLoading, error, setSkipped, reopen } = useOnboarding();
  const user = state?.user ?? null;

  return (
    <Container maxWidth="md">
      <Box sx={{ py: { xs: 2, sm: 4 } }}>
        <Typography variant="h4" component="h1" gutterBottom>
          {GETTING_STARTED_TITLE}
        </Typography>
        <Typography color="text.secondary" sx={{ mb: 3 }}>
          {GETTING_STARTED_DESCRIPTION}
        </Typography>
        {error ? (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        ) : null}
        <Card variant="outlined" aria-busy={isLoading}>
          <CardContent>
            {isLoading ? (
              <Stack spacing={1} aria-label="Loading your steps">
                {[0, 1, 2].map((index) => (
                  <Skeleton key={index} variant="rounded" height={48} />
                ))}
              </Stack>
            ) : user && user.total > 0 ? (
              <OnboardingChecklist
                steps={user.steps}
                completed={user.completed}
                total={user.total}
                onSkip={(id, skipped) => void setSkipped(id, skipped)}
              />
            ) : error ? null : (
              <Typography color="text.secondary">Nothing to set up right now.</Typography>
            )}
          </CardContent>
        </Card>
        <Button onClick={() => void reopen()} sx={{ mt: 2, minHeight: 44 }}>
          Show the welcome again
        </Button>
      </Box>
    </Container>
  );
}
