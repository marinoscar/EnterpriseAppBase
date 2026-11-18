// Small building blocks of the webhooks UI (issue #1046): the status chips,
// the confirm dialog and the date text. Internal to the slice.

import { Button, Chip, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle } from '@mui/material';
import type { ReactElement, ReactNode } from 'react';

import type { WebhookDeliveryStatus, WebhookEndpoint } from '@marinoscar/platform-contract/webhooks';

import { formatDateTime } from '../../core/index.js';
import {
  webhookDeliveryStatusLabel,
  webhookDeliveryStatusTone,
  webhookEndpointStatus,
  type WebhookStatusTone,
} from '../headless/index.js';

function chipColor(tone: WebhookStatusTone): 'success' | 'warning' | 'error' | 'info' | 'default' {
  return tone;
}

/** The endpoint's status as a labelled chip (the words carry the meaning, not the colour). */
export function EndpointStatusChip({ endpoint }: { endpoint: Pick<WebhookEndpoint, 'enabled' | 'disabledReason'> }): ReactElement {
  const status = webhookEndpointStatus(endpoint);
  return <Chip size="small" label={status.label} color={chipColor(status.tone)} variant={status.tone === 'default' ? 'outlined' : 'filled'} />;
}

/** A delivery's status as a labelled chip. */
export function DeliveryStatusChip({ status }: { status: WebhookDeliveryStatus }): ReactElement {
  const tone = webhookDeliveryStatusTone(status);
  return <Chip size="small" label={webhookDeliveryStatusLabel(status)} color={chipColor(tone)} variant={tone === 'default' ? 'outlined' : 'filled'} />;
}

/** A timestamp in the display zone, or a dash. */
export function when(iso: string | null): string {
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
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth aria-labelledby="webhooks-confirm-title">
      <DialogTitle id="webhooks-confirm-title">{title}</DialogTitle>
      <DialogContent>
        <DialogContentText component="div">{children}</DialogContentText>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} sx={{ minHeight: 44 }}>
          Cancel
        </Button>
        <Button
          variant="contained"
          color={destructive ? 'error' : 'primary'}
          onClick={onConfirm}
          disabled={busy}
          sx={{ minHeight: 44 }}
        >
          {confirmLabel}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
