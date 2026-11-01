// The firing-alerts banner (issue #1047): how many alerts are firing now, by
// severity, linking to the Alerts page's incidents. Built for the telemetry
// dashboard's `BeforeContent` slot (the app passes it; telemetry does not
// depend on alerts), and usable on any page. Draws nothing while nothing is
// firing, before the first answer, or for a viewer without `alerts:read`.

import { Alert, AlertTitle, Button, Stack } from '@mui/material';
import type { ReactElement } from 'react';
import { Link as RouterLink } from 'react-router-dom';

import { ALERT_PERMISSIONS, ALERT_SEVERITIES } from '@marinoscar/platform-contract/alerts';

import { usePlatformViewer } from '../../core/index.js';
import { ALERT_SEVERITY_LABELS, alertFiringTotal, alertTopSeverity, useAlertSummary } from '../headless/index.js';
import { ALERTS_PAGE_COPY } from './copy.js';
import { SeverityChip } from './parts.js';

/**
 * Props of {@link FiringAlertsBanner}.
 *
 * @stability experimental
 */
export interface FiringAlertsBannerProps {
  /** Where "View incidents" goes; default the Alerts page's Incidents tab. */
  to?: string;
  /** The poll interval in milliseconds; default 30 000. */
  intervalMs?: number;
}

const ALERT_SEVERITY_FOR: Readonly<Record<string, 'error' | 'warning' | 'info'>> = {
  critical: 'error',
  warning: 'warning',
  info: 'info',
};

/**
 * The number of firing alerts by severity, with a link to the incidents.
 *
 * @param props - see {@link FiringAlertsBannerProps}.
 * @returns the banner, or `null` when nothing is firing.
 *
 * @example
 * ```tsx
 * <TelemetryDashboardPage slots={{ BeforeContent: () => <FiringAlertsBanner /> }} />
 * ```
 *
 * @extensionPoint component
 * @stability experimental
 */
export function FiringAlertsBanner({ to = `${ALERTS_PAGE_COPY.path}?tab=incidents`, intervalMs }: FiringAlertsBannerProps = {}): ReactElement | null {
  const viewer = usePlatformViewer();
  const allowed = viewer.hasPermission(ALERT_PERMISSIONS.READ);
  const { summary } = useAlertSummary({ enabled: allowed, ...(intervalMs === undefined ? {} : { intervalMs }) });
  const total = alertFiringTotal(summary);
  const top = alertTopSeverity(summary);
  if (!allowed || !summary || total === 0 || !top) return null;
  return (
    <Alert
      severity={ALERT_SEVERITY_FOR[top] ?? 'warning'}
      sx={{ mb: 2 }}
      data-testid="firing-alerts-banner"
      action={
        <Button component={RouterLink} to={to} color="inherit" size="small" sx={{ minHeight: 44 }}>
          View incidents
        </Button>
      }
    >
      <AlertTitle>{total === 1 ? '1 alert is firing' : `${total} alerts are firing`}</AlertTitle>
      <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap' }}>
        {ALERT_SEVERITIES.filter((severity) => summary.firing[severity] > 0)
          .reverse()
          .map((severity) => (
            <SeverityChip
              key={severity}
              severity={severity}
              label={`${summary.firing[severity]} ${ALERT_SEVERITY_LABELS[severity].toLowerCase()}`}
            />
          ))}
      </Stack>
    </Alert>
  );
}
