// The detail of one incident (issue #1047): what fired, on which labels, when
// it went pending, fired and resolved, the last value and summary, and who
// acknowledged it. "Acknowledge" is drawn only for a viewer who may write; the
// API enforces `alerts:write` either way.

import CloseIcon from '@mui/icons-material/Close';
import { Alert, Box, Button, Divider, Drawer, IconButton, Stack, Typography } from '@mui/material';
import type { ReactElement, ReactNode } from 'react';

import type { AlertIncident } from '@marinoscar/platform-contract/alerts';

import { formatAlertLabels, useAlertIncident } from '../headless/index.js';
import { SeverityChip, StateChip, when } from './parts.js';

/**
 * Props of {@link AlertIncidentDrawer}.
 *
 * @stability experimental
 */
export interface AlertIncidentDrawerProps {
  /** The incident to show; `null` closes the drawer. */
  incidentId: string | null;
  /** Whether the viewer holds `alerts:write` (draws Acknowledge). */
  canWrite: boolean;
  /** Acknowledges the incident; resolves with the updated incident, or `null` when refused. */
  onAcknowledge: (incident: AlertIncident) => Promise<AlertIncident | null>;
  /** Whether an acknowledge is in flight. */
  acknowledging?: boolean;
  /** Closes the drawer. */
  onClose: () => void;
}

function Row({ label, children }: { label: string; children: ReactNode }): ReactElement {
  return (
    <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '10rem 1fr' }, gap: 0.5, py: 0.75 }}>
      <Typography variant="body2" color="text.secondary">
        {label}
      </Typography>
      <Typography variant="body2" component="div" sx={{ wordBreak: 'break-word' }}>
        {children}
      </Typography>
    </Box>
  );
}

/**
 * The incident detail drawer.
 *
 * @param props - see {@link AlertIncidentDrawerProps}.
 * @returns the drawer.
 *
 * @extensionPoint component
 * @stability experimental
 */
export function AlertIncidentDrawer({ incidentId, canWrite, onAcknowledge, acknowledging = false, onClose }: AlertIncidentDrawerProps): ReactElement {
  const { incident, isLoading, error, refresh } = useAlertIncident(incidentId);
  const acknowledge = async () => {
    if (!incident) return;
    const updated = await onAcknowledge(incident);
    if (updated) await refresh();
  };
  return (
    <Drawer anchor="right" open={incidentId !== null} onClose={onClose} slotProps={{ paper: { sx: { width: { xs: '100%', sm: 480 } } } }}>
      <Box sx={{ p: 2 }} role="region" aria-label="Incident detail">
        <Stack direction="row" sx={{ mb: 1, alignItems: 'center', justifyContent: 'space-between' }}>
          <Typography variant="h6" component="h2">
            {incident ? incident.ruleName : 'Incident'}
          </Typography>
          <IconButton aria-label="Close" onClick={onClose}>
            <CloseIcon />
          </IconButton>
        </Stack>
        {error ? <Alert severity="error">{error}</Alert> : null}
        {!incident && isLoading ? <Typography color="text.secondary">Loading the incident…</Typography> : null}
        {incident ? (
          <>
            <Stack direction="row" spacing={1} sx={{ mb: 2 }}>
              <StateChip state={incident.state} />
              <SeverityChip severity={incident.severity} />
            </Stack>
            <Typography variant="body1" sx={{ mb: 2 }}>
              {incident.summary}
            </Typography>
            <Divider />
            <Row label="Labels">{formatAlertLabels(incident.labels) || 'None'}</Row>
            <Row label="Last value">{incident.lastValue === null ? '—' : String(incident.lastValue)}</Row>
            <Row label="Pending since">{when(incident.pendingSince)}</Row>
            <Row label="Fired">{when(incident.firedAt)}</Row>
            <Row label="Resolved">{when(incident.resolvedAt)}</Row>
            <Row label="Last seen">{when(incident.lastSeenAt)}</Row>
            <Row label="Acknowledged">{incident.acknowledgedAt ? when(incident.acknowledgedAt) : 'Not yet'}</Row>
            {canWrite && !incident.acknowledgedAt && incident.state !== 'resolved' ? (
              <Box sx={{ mt: 2 }}>
                <Button variant="contained" onClick={() => void acknowledge()} disabled={acknowledging} sx={{ minHeight: 44 }}>
                  Acknowledge
                </Button>
              </Box>
            ) : null}
          </>
        ) : null}
      </Box>
    </Drawer>
  );
}
