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

import { PageSlotsFrame } from '../../core/index.js';
import type { PageSlotsBase } from '../../core/index.js';
import { useOnboarding } from '../headless/provider.js';
import { GETTING_STARTED_DESCRIPTION, GETTING_STARTED_TITLE } from './copy.js';
import { OnboardingChecklist } from './OnboardingChecklist.js';

/**
 * The slots of {@link GettingStartedPage}: the page-slot contract. `Sections`
 * is drawn at both ends of the body (return `null` for the position you do not
 * want), so an app adds its own notes or steps above or below the checklist;
 * the platform's steps themselves come from the step registry on the API.
 *
 * @example
 * ```tsx
 * <GettingStartedPage slots={{ Sections: ({ position }) => (position === 'bottom' ? <TeamIntro /> : null) }} />
 * ```
 *
 * @extensionPoint slot
 * @stability experimental
 */
export type GettingStartedPageSlots = PageSlotsBase;

/**
 * What {@link GettingStartedPage} takes.
 *
 * @stability experimental
 */
export interface GettingStartedPageProps {
  /** Optional extension slots; omitted, the page renders exactly as it always did. */
  slots?: GettingStartedPageSlots;
}

/**
 * The Getting started page.
 *
 * @param props - see {@link GettingStartedPageProps}.
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
export function GettingStartedPage(props: GettingStartedPageProps = {}): ReactElement {
  const { state, isLoading, error, setSkipped, reopen } = useOnboarding();
  const user = state?.user ?? null;

  return (
    <Container maxWidth="md">
      <Box sx={{ py: { xs: 2, sm: 4 } }}>
        <PageSlotsFrame
          slots={props.slots}
          headerProps={{ title: GETTING_STARTED_TITLE, description: GETTING_STARTED_DESCRIPTION, actions: null }}
          header={
            <>
              <Typography variant="h4" component="h1" gutterBottom>
                {GETTING_STARTED_TITLE}
              </Typography>
              <Typography color="text.secondary" sx={{ mb: 3 }}>
                {GETTING_STARTED_DESCRIPTION}
              </Typography>
            </>
          }
        >
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
        </PageSlotsFrame>
      </Box>
    </Container>
  );
}
