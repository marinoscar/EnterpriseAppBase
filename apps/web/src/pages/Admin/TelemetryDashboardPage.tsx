/**
 * Console → Observability → Telemetry Dashboard — issue #578, epic #576.
 *
 * Gates: the route requires `telemetry:query` (what the dashboard controller
 * enforces) AND the `telemetry` feature (`RequireTelemetryEnabled`), exactly
 * like the Telemetry Explorer.
 */
import { useCallback, useMemo, useState } from 'react';
import { Box, Container, Typography } from '@mui/material';
import { Navigate, useSearchParams } from 'react-router-dom';
import { usePermissions } from '../../hooks/usePermissions';
import { useVisiblePolling } from '../../hooks/useVisiblePolling';
import {
  DASHBOARD_REFRESH_MS,
  dashboardStateToParams,
  parseDashboardState,
  type DashboardState,
} from '../../components/telemetry/dashboard/dashboardState';

/** Mirrors the `Telemetry Dashboard` card in `config/adminSections.tsx`. */
const PAGE_TITLE = 'Telemetry Dashboard';
const PAGE_DESCRIPTION =
  'See at a glance whether anything is wrong: error rate, latency, error logs and the top failing routes.';

export default function TelemetryDashboardPage() {
  const { hasPermission } = usePermissions();
  const [searchParams, setSearchParams] = useSearchParams();
  const state = useMemo(() => parseDashboardState(searchParams), [searchParams]);
  const [tick, setTick] = useState(0);

  const update = useCallback(
    (patch: Partial<DashboardState>) => {
      setSearchParams(dashboardStateToParams({ ...state, ...patch }), { replace: true });
    },
    [setSearchParams, state],
  );
  void update;

  useVisiblePolling(() => setTick((value) => value + 1), state.refresh ? DASHBOARD_REFRESH_MS : 0);
  void tick;

  // Defence, not the gate — `App.tsx` wraps the route in `RequirePermission`.
  if (!hasPermission('telemetry:query')) return <Navigate to="/" replace />;

  return (
    <Container maxWidth={false} sx={{ maxWidth: 1600, px: { xs: 0, sm: 2 } }}>
      <Box sx={{ py: { xs: 1, sm: 3 }, minWidth: 0 }}>
        <Typography variant="h4" component="h1" gutterBottom>
          {PAGE_TITLE}
        </Typography>
        <Typography color="text.secondary">{PAGE_DESCRIPTION}</Typography>
      </Box>
    </Container>
  );
}
