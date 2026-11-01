// Small building blocks of the alerts UI (issue #1047): the severity and state
// chips, the confirm dialog and the date text. Internal to the slice.

import { Button, Chip, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle } from '@mui/material';
import type { ReactElement, ReactNode } from 'react';

import type { AlertIncidentState, AlertSeverity } from '@marinoscar/platform-contract/alerts';

import { formatDateTime } from '../../core/index.js';
import {
  ALERT_SEVERITY_LABELS,
  ALERT_SEVERITY_TONES,
  ALERT_STATE_LABELS,
  ALERT_STATE_TONES,
  type AlertTone,
} from '../headless/index.js';

function chipColor(tone: AlertTone): 'success' | 'warning' | 'error' | 'info' | 'default' {
  return tone;
}

/** A severity as a labelled chip (the words carry the meaning, not the colour). */
export function SeverityChip({ severity, label }: { severity: AlertSeverity; label?: string }): ReactElement {
  return <Chip size="small" label={label ?? ALERT_SEVERITY_LABELS[severity]} color={chipColor(ALERT_SEVERITY_TONES[severity])} />;
}

/** An incident state as a labelled chip. */
export function StateChip({ state }: { state: AlertIncidentState }): ReactElement {
  const tone = ALERT_STATE_TONES[state];
  return <Chip size="small" label={ALERT_STATE_LABELS[state]} color={chipColor(tone)} variant={state === 'resolved' ? 'outlined' : 'filled'} />;
}

/** A timestamp in the display zone, or a dash. */
export function when(iso: string | null | undefined): string {
  return iso ? formatDateTime(iso) : '—';
}

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  children: ReactNode;
  confirmLabel: string;
  destructive?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}

/** A yes/no dialog whose text says what will happen. */
export function ConfirmDialog({ open, title, children, confirmLabel, destructive, busy, onConfirm, onClose }: ConfirmDialogProps): ReactElement {
  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth aria-labelledby="alerts-confirm-title">
      <DialogTitle id="alerts-confirm-title">{title}</DialogTitle>
      <DialogContent>
        <DialogContentText component="div">{children}</DialogContentText>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} sx={{ minHeight: 44 }}>
          Cancel
        </Button>
        <Button variant="contained" color={destructive ? 'error' : 'primary'} onClick={onConfirm} disabled={busy} sx={{ minHeight: 44 }}>
          {confirmLabel}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
