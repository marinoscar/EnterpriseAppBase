/**
 * The reference app's dashboard panel view: "Sign-ups" (PP-14.18).
 *
 * The web half of the worked example of an app-owned Telemetry Dashboard card.
 * The API half is `registerDashboardPanel` of
 * `apps/api/src/platform-extensions/telemetry/signups.dashboard-panel.ts`: it
 * lists the panel at `GET /api/admin/telemetry/dashboard/panels` and serves its
 * payload at `…/panels/signups`. This file registers the VIEW that draws that
 * payload, for the same id, with `registerDashboardPanelView`; the packaged
 * dashboard draws the card (frame, loading skeleton, error with Retry, "Open in
 * Explorer" because the payload names its `sql`) around it, after the events feed.
 *
 * The view receives DATA only (`payload`, the window, the layout), never an API
 * client; what it may show is what the API's panel chose to send.
 *
 * `main.tsx` calls `registerSignupsPanelView()` once, before the first render.
 */
import { Box, Stack, Typography } from '@mui/material';
import { SparkLineChart } from '@mui/x-charts/SparkLineChart';
import { registerDashboardPanelView } from '@marinoscar/platform-web/telemetry/ui/dashboard-panels';
import type { DashboardPanelViewProps } from '@marinoscar/platform-web/telemetry/ui/dashboard-panels';

/** What the API's `signups` panel returns (the API file's `SignupsPayload`). */
export interface SignupsPayload {
  available: boolean;
  total: number;
  buckets: Array<{ t: string; signIns: number }>;
  bucketSeconds: number;
  sql?: string;
}

/** The panel's id: the one the API registered. */
export const SIGNUPS_PANEL_ID = 'signups';

export function SignupsPanelView({ payload, layout }: DashboardPanelViewProps<SignupsPayload>) {
  if (!payload.available) {
    return (
      <Typography variant="body2" color="text.secondary" data-testid="signups-empty">
        No sign-in data in the telemetry store yet.
      </Typography>
    );
  }
  return (
    <Stack spacing={1} data-testid="signups-view">
      <Typography variant="h4" component="p" sx={{ fontWeight: 600 }}>
        {payload.total.toLocaleString()}{' '}
        <Typography component="span" variant="body1" color="text.secondary">
          successful sign-ins in this window
        </Typography>
      </Typography>
      {payload.buckets.length > 1 ? (
        <Box aria-hidden sx={{ height: layout === 'phone' ? 40 : 64 }}>
          <SparkLineChart data={payload.buckets.map((bucket) => bucket.signIns)} height={layout === 'phone' ? 40 : 64} curve="linear" />
        </Box>
      ) : null}
    </Stack>
  );
}

/** Registers {@link SignupsPanelView} for the `signups` panel. Call once, at boot. */
export function registerSignupsPanelView(): void {
  registerDashboardPanelView<SignupsPayload>(SIGNUPS_PANEL_ID, SignupsPanelView);
}
