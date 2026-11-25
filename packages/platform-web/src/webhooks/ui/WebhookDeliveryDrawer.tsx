// =============================================================================
// One delivery in detail (issue #1046): what was sent, what came back
// =============================================================================
//
// The body exactly as sent (pretty-printed), the request headers (the API
// never returns the signature), the response's first KiB, and Redeliver for a
// viewer holding the scope's write permission.
// =============================================================================

import CloseIcon from '@mui/icons-material/Close';
import ReplayIcon from '@mui/icons-material/Replay';
import {
  Alert,
  Box,
  Button,
  Divider,
  Drawer,
  IconButton,
  Skeleton,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableRow,
  Typography,
} from '@mui/material';
import type { ReactElement, ReactNode } from 'react';

import type { WebhookDeliveryDetail, WebhookScope } from '@marinoscar/platform-contract/webhooks';

import { useDisplayTimeZone } from '../../core/index.js';
import { formatWebhookDuration, useWebhookDelivery } from '../headless/index.js';
import { DeliveryStatusChip, when } from './parts.js';

/**
 * The props of {@link WebhookDeliveryDrawer}.
 *
 * @stability experimental
 */
export interface WebhookDeliveryDrawerProps {
  /** The scope whose routes to read. */
  scope: WebhookScope;
  /** The delivery to show; `null` closes the drawer. */
  deliveryId: string | null;
  /** Whether to offer Redeliver (the viewer holds the scope's write permission). */
  canWrite: boolean;
  /** Queues the delivery again; resolves `true` on success. */
  onRedeliver: (delivery: WebhookDeliveryDetail) => Promise<boolean>;
  /** Whether a redelivery is in flight. */
  redelivering?: boolean;
  /** Closes the drawer. */
  onClose: () => void;
}

function pretty(value: unknown): string {
  if (typeof value === 'string') {
    try {
      return JSON.stringify(JSON.parse(value), null, 2);
    } catch {
      return value;
    }
  }
  return JSON.stringify(value, null, 2) ?? '';
}

function Code({ label, children }: { label: string; children: string }): ReactElement {
  return (
    <Box
      component="pre"
      aria-label={label}
      tabIndex={0}
      sx={{
        m: 0,
        p: 1.5,
        bgcolor: 'action.hover',
        borderRadius: 1,
        fontFamily: 'monospace',
        fontSize: 13,
        overflowX: 'auto',
        whiteSpace: 'pre',
        maxHeight: 320,
      }}
    >
      {children}
    </Box>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }): ReactElement {
  return (
    <TableRow>
      <TableCell component="th" scope="row" sx={{ fontWeight: 600, width: '40%', pl: 0 }}>
        {label}
      </TableCell>
      <TableCell sx={{ pr: 0, wordBreak: 'break-word' }}>{children}</TableCell>
    </TableRow>
  );
}

/**
 * The delivery detail drawer.
 *
 * @param props - see {@link WebhookDeliveryDrawerProps}.
 * @returns the drawer.
 *
 * @extensionPoint component
 * @stability experimental
 */
export function WebhookDeliveryDrawer({
  scope,
  deliveryId,
  canWrite,
  onRedeliver,
  redelivering,
  onClose,
}: WebhookDeliveryDrawerProps): ReactElement {
  useDisplayTimeZone();
  const { delivery, isLoading, error, refresh } = useWebhookDelivery(scope, deliveryId);
  const headers = delivery ? Object.entries(delivery.requestHeaders) : [];

  const redeliver = async () => {
    if (!delivery) return;
    if (await onRedeliver(delivery)) await refresh();
  };

  return (
    <Drawer
      anchor="right"
      open={deliveryId !== null}
      onClose={onClose}
      slotProps={{ paper: { sx: { width: { xs: '100%', sm: 560 } }, role: 'dialog', 'aria-label': 'Delivery details' } }}
    >
      <Box sx={{ p: 2 }}>
        <Stack direction="row" spacing={1} sx={{ mb: 2, alignItems: 'center' }}>
          <Typography variant="h6" component="h2" sx={{ flexGrow: 1 }}>
            Delivery
          </Typography>
          <IconButton onClick={onClose} aria-label="Close delivery details" sx={{ width: 44, height: 44 }}>
            <CloseIcon />
          </IconButton>
        </Stack>
        {error ? <Alert severity="error">{error}</Alert> : null}
        {isLoading && !delivery ? (
          <Stack spacing={1} aria-label="Loading the delivery">
            <Skeleton variant="rounded" height={32} />
            <Skeleton variant="rounded" height={160} />
          </Stack>
        ) : null}
        {delivery ? (
          <Stack spacing={2}>
            <Table size="small" aria-label="Delivery summary">
              <TableBody>
                <Row label="Status">
                  <DeliveryStatusChip status={delivery.status} />
                </Row>
                <Row label="Event">
                  <Box component="span" sx={{ fontFamily: 'monospace' }}>
                    {delivery.eventKey}
                  </Box>
                </Row>
                <Row label="Event id">
                  <Box component="span" sx={{ fontFamily: 'monospace' }}>
                    {delivery.eventId}
                  </Box>
                </Row>
                <Row label="Created">{when(delivery.createdAt)}</Row>
                <Row label="Attempt">{delivery.attempt}</Row>
                <Row label="HTTP status">{delivery.responseStatus ?? '—'}</Row>
                <Row label="Duration">{formatWebhookDuration(delivery.durationMs) || '—'}</Row>
                {delivery.errorCode ? <Row label="Error">{delivery.errorCode}</Row> : null}
                {delivery.nextAttemptAt ? <Row label="Next attempt">{when(delivery.nextAttemptAt)}</Row> : null}
                {delivery.deliveredAt ? <Row label="Delivered">{when(delivery.deliveredAt)}</Row> : null}
              </TableBody>
            </Table>
            {canWrite ? (
              <Box>
                <Button
                  variant="outlined"
                  startIcon={<ReplayIcon />}
                  onClick={() => void redeliver()}
                  disabled={redelivering}
                  sx={{ minHeight: 44 }}
                >
                  Redeliver
                </Button>
              </Box>
            ) : null}
            <Divider />
            <Typography variant="subtitle1" component="h3">
              Payload
            </Typography>
            <Code label="Payload">{pretty(delivery.payload)}</Code>
            <Typography variant="subtitle1" component="h3">
              Request headers
            </Typography>
            {headers.length === 0 ? (
              <Typography variant="body2" color="text.secondary">
                None recorded.
              </Typography>
            ) : (
              <Table size="small" aria-label="Request headers">
                <TableBody>
                  {headers.map(([name, value]) => (
                    <Row key={name} label={name}>
                      <Box component="span" sx={{ fontFamily: 'monospace' }}>
                        {value}
                      </Box>
                    </Row>
                  ))}
                </TableBody>
              </Table>
            )}
            <Typography variant="body2" color="text.secondary">
              The signature header is never shown here.
            </Typography>
            <Typography variant="subtitle1" component="h3">
              Response
            </Typography>
            {delivery.responseSnippet ? (
              <Code label="Response">{delivery.responseSnippet}</Code>
            ) : (
              <Typography variant="body2" color="text.secondary">
                No response body recorded.
              </Typography>
            )}
          </Stack>
        ) : null}
      </Box>
    </Drawer>
  );
}
