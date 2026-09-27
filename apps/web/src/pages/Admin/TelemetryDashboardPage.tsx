/**
 * Console → Observability → Telemetry Dashboard — issue #578, epic #576.
 *
 * "Is anything wrong?" at a glance: a verdict, headline tiles, API and log
 * timelines, the top failing routes and error messages, and a feed of recent
 * error and warning logs — all read from `/api/admin/telemetry/dashboard/*`
 * (#577). The verdict, tiles, bands and routes are the API's; this page only
 * presents them.
 *
 * Gates: the route requires `telemetry:query` (what the dashboard controller
 * enforces) AND the `telemetry` feature (`RequireTelemetryEnabled`), exactly
 * like the Telemetry Explorer. Every request is still authorised by the API.
 *
 * Data: every panel fetches INDEPENDENTLY (`hooks/useTelemetryDashboard.ts`),
 * so one failing or slow endpoint never blanks another. Auto-refresh (30 s,
 * `?refresh=off` to stop) pauses while the tab is hidden and refreshes at once
 * on return (`useVisiblePolling`). A store-level failure on the summary —
 * telemetry switched off, not configured, or unreachable — replaces the page
 * with one Alert linking to the Telemetry settings, as the explorer does.
 *
 * State lives in the URL (`dashboardState.ts`), so a link reproduces the view.
 *
 * Layout: phone < 600 (`xs`), tablet 600–1199 (`sm`–`md`), desktop ≥ 1200
 * (`lg`), decided HERE only — none of the shell's five coupled breakpoint
 * gates is touched.
 */
import { useCallback, useMemo, useState } from 'react';
import { Alert, AlertTitle, Box, Button, Container, Stack, Typography } from '@mui/material';
import { Navigate, Link as RouterLink, useSearchParams } from 'react-router-dom';
import { usePermissions } from '../../hooks/usePermissions';
import { useVisiblePolling } from '../../hooks/useVisiblePolling';
import { useDashboardSummary } from '../../hooks/useTelemetryDashboard';
import { telemetryErrorTitle, type TelemetryErrorInfo } from '../../hooks/useTelemetryExplorer';
import {
  DASHBOARD_REFRESH_MS,
  dashboardQuery,
  dashboardStateToParams,
  parseDashboardState,
  type DashboardState,
} from '../../components/telemetry/dashboard/dashboardState';
import { DashboardPanel, type PanelAction } from '../../components/telemetry/dashboard/DashboardPanel';
import { VerdictBanner } from '../../components/telemetry/dashboard/VerdictBanner';
import { KpiTiles } from '../../components/telemetry/dashboard/KpiTiles';

/** Mirrors the `Telemetry Dashboard` card in `config/adminSections.tsx`. */
const PAGE_TITLE = 'Telemetry Dashboard';
const PAGE_DESCRIPTION =
  'See at a glance whether anything is wrong: error rate, latency, error logs and the top failing routes.';

/** Store-level reasons: nothing on this page can work, so say so once. */
const UNAVAILABLE_REASONS = new Set(['TELEMETRY_DISABLED', 'TELEMETRY_NOT_CONFIGURED', 'TELEMETRY_UNREACHABLE']);

/**
 * The actions every panel header offers. Empty until #579 adds "Open in
 * Explorer" and "Ask assistant"; each action receives its panel's `sql`.
 */
const PANEL_ACTIONS: PanelAction[] = [];

function UnavailableAlert({ error, onRetry }: { error: TelemetryErrorInfo; onRetry: () => void }) {
  return (
    <Alert
      severity="warning"
      data-testid="telemetry-unavailable"
      action={
        <Button color="inherit" size="small" onClick={onRetry} sx={{ minHeight: 44 }}>
          Retry
        </Button>
      }
    >
      <AlertTitle>{telemetryErrorTitle(error)}</AlertTitle>
      <Box component="span" sx={{ display: 'block', wordBreak: 'break-word' }}>
        {error.message}
      </Box>
      <Box component="span" sx={{ display: 'block', mt: 1 }}>
        Check the connection and collection settings in{' '}
        <RouterLink to="/admin/settings/telemetry">Telemetry settings</RouterLink>.
      </Box>
      {error.reason && (
        <Typography variant="caption" component="div" sx={{ mt: 0.5, opacity: 0.8 }}>
          {error.reason}
        </Typography>
      )}
    </Alert>
  );
}

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

  const query = useMemo(() => dashboardQuery(state), [state]);
  const summary = useDashboardSummary(query, tick);

  // Defence, not the gate — `App.tsx` wraps the route in `RequirePermission`.
  if (!hasPermission('telemetry:query')) return <Navigate to="/" replace />;

  const unavailable = summary.error && UNAVAILABLE_REASONS.has(summary.error.reason ?? '') ? summary.error : null;

  return (
    <Container maxWidth={false} sx={{ maxWidth: 1600, px: { xs: 0, sm: 2 } }}>
      <Box sx={{ py: { xs: 1, sm: 3 }, minWidth: 0 }}>
        <Typography variant="h4" component="h1" gutterBottom sx={{ fontSize: { xs: '1.5rem', sm: '2.125rem' } }}>
          {PAGE_TITLE}
        </Typography>
        <Typography color="text.secondary" sx={{ mb: 2, display: { xs: 'none', sm: 'block' } }}>
          {PAGE_DESCRIPTION}
        </Typography>

        {unavailable ? (
          <UnavailableAlert error={unavailable} onRetry={summary.reload} />
        ) : (
          <Stack spacing={{ xs: 1.5, sm: 2 }} sx={{ minWidth: 0 }}>
            <VerdictBanner
              verdict={summary.data?.verdict ?? null}
              isLoading={summary.isLoading}
              error={summary.error}
              onRetry={summary.reload}
            />

            <DashboardPanel
              id="panel-tiles"
              title="Key indicators"
              actions={PANEL_ACTIONS}
              sql={summary.data?.sql}
              isLoading={summary.isLoading}
              isRefreshing={summary.isRefreshing}
              error={summary.error}
              onRetry={summary.reload}
              isEmpty={!!summary.data && summary.data.tiles.length === 0}
              skeletonHeight={120}
            >
              {summary.data && <KpiTiles tiles={summary.data.tiles} runtime={summary.data.runtime} />}
            </DashboardPanel>
          </Stack>
        )}
      </Box>
    </Container>
  );
}
