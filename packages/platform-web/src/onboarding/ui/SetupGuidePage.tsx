// =============================================================================
// SetupGuidePage (issue #745): `/admin/settings/setup`
// =============================================================================
//
// The administrator's checklist in its tier groups, a Re-check button
// (`refresh=true`, forwarded to the Doctor), a link to the Doctor for the
// full picture, and the Activation section. A registry card gated on
// `system_settings:read`, the permission under which `GET /api/onboarding`
// returns its admin block; the app's route gate keeps everyone else out.
// =============================================================================

import HealthAndSafetyOutlinedIcon from '@mui/icons-material/HealthAndSafetyOutlined';
import RefreshIcon from '@mui/icons-material/Refresh';
import { Alert, Box, Button, Card, CardContent, CircularProgress, Container, Skeleton, Stack, Typography } from '@mui/material';
import type { ReactElement, ReactNode } from 'react';
import { Link as RouterLink } from 'react-router-dom';

import { useOnboarding } from '../headless/provider.js';
import { ActivationMetrics } from './ActivationMetrics.js';
import { DOCTOR_PATH, SETUP_GUIDE_DESCRIPTION, SETUP_GUIDE_TITLE } from './copy.js';
import { OnboardingChecklist } from './OnboardingChecklist.js';

/**
 * What {@link SetupGuidePage} takes.
 *
 * @stability experimental
 */
export interface SetupGuidePageProps {
  /** Show the Activation section. Default true. */
  showActivation?: boolean;
  /** Extra content below the checklist (an app's own section). */
  footer?: ReactNode;
}

/**
 * The Setup guide.
 *
 * @param props - see {@link SetupGuidePageProps}.
 * @returns the page.
 *
 * @example
 * ```tsx
 * <Route path="/admin/settings/setup" element={<RequirePermission permission="system_settings:read"><SetupGuidePage /></RequirePermission>} />
 * ```
 *
 * @extensionPoint component
 * @stability experimental
 */
export function SetupGuidePage(props: SetupGuidePageProps = {}): ReactElement {
  const { state, appName, isLoading, isRefreshing, error, refresh } = useOnboarding();
  const admin = state?.admin ?? null;

  return (
    <Container maxWidth="md">
      <Box sx={{ py: { xs: 2, sm: 4 } }}>
        <Typography variant="h4" component="h1" gutterBottom>
          {SETUP_GUIDE_TITLE}
        </Typography>
        <Typography color="text.secondary" sx={{ mb: 3 }}>
          {SETUP_GUIDE_DESCRIPTION}
        </Typography>

        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={{ xs: 1, sm: 2 }} sx={{ mb: 3, alignItems: { xs: 'stretch', sm: 'center' } }}>
          <Button
            variant="contained"
            onClick={() => void refresh({ refresh: true })}
            disabled={isLoading || isRefreshing}
            startIcon={isRefreshing ? <CircularProgress size={16} color="inherit" /> : <RefreshIcon />}
            sx={{ minHeight: 44 }}
          >
            {isRefreshing ? 'Checking…' : 'Re-check'}
          </Button>
          <Button component={RouterLink} to={DOCTOR_PATH} startIcon={<HealthAndSafetyOutlinedIcon />} sx={{ minHeight: 44 }}>
            Open the Doctor
          </Button>
        </Stack>

        {error ? (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        ) : null}
        {admin?.requiredDone ? (
          <Alert severity="success" sx={{ mb: 2 }}>
            {`Everything required is set up. People can start using ${appName}.`}
          </Alert>
        ) : null}

        <Card variant="outlined" aria-busy={isLoading || isRefreshing}>
          <CardContent>
            {isLoading ? (
              <Stack spacing={1} data-testid="setup-guide-loading" aria-label="Loading setup steps">
                {[0, 1, 2, 3].map((index) => (
                  <Skeleton key={index} variant="rounded" height={48} />
                ))}
              </Stack>
            ) : admin ? (
              <OnboardingChecklist steps={admin.steps} completed={admin.completed} total={admin.total} label="Setup" grouped />
            ) : error ? null : (
              <Typography color="text.secondary">The setup steps are not available right now.</Typography>
            )}
          </CardContent>
        </Card>

        {props.footer}
        {props.showActivation === false ? null : <ActivationMetrics />}
      </Box>
    </Container>
  );
}
