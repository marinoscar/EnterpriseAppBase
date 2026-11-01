// =============================================================================
// One endpoint (issue #1046): its settings, its actions and its deliveries
// =============================================================================
//
// Internal to `WebhooksPage`, which owns the writes and the dialogs: this view
// draws the endpoint and the server-paginated deliveries table, and reports
// which action the user picked.
// =============================================================================

import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlined';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import KeyOutlinedIcon from '@mui/icons-material/KeyOutlined';
import RefreshIcon from '@mui/icons-material/Refresh';
import SendOutlinedIcon from '@mui/icons-material/SendOutlined';
import VisibilityOutlinedIcon from '@mui/icons-material/VisibilityOutlined';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  FormControl,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react';

import { WEBHOOK_DELIVERIES_PAGE_SIZE_DEFAULT, WEBHOOK_DELIVERY_STATUSES } from '@marinoscar/platform-contract/webhooks';
import type {
  WebhookDelivery,
  WebhookDeliveryStatus,
  WebhookEndpoint,
  WebhookScope,
} from '@marinoscar/platform-contract/webhooks';

import { useDisplayTimeZone, useTableSlotColumns, type TableSlots } from '../../core/index.js';
import { DataTable, type DataTableColumn, type DataTableRowAction } from '../../datatable/index.js';
import {
  WEBHOOK_ALL_EVENTS,
  formatWebhookDuration,
  useWebhookDeliveries,
  webhookDeliveryStatusLabel,
  webhookEndpointStatus,
} from '../headless/index.js';
import { DeliveryStatusChip, EndpointStatusChip, when } from './parts.js';

export interface WebhookEndpointDetailProps {
  scope: WebhookScope;
  endpoint: WebhookEndpoint;
  canWrite: boolean;
  busy: boolean;
  /** Bumped by the page after a test or a redelivery, to reload the deliveries. */
  reloadKey: number;
  slots?: Pick<TableSlots<WebhookDelivery, DataTableColumn<WebhookDelivery>>, 'Columns' | 'RowActions' | 'DetailPanel' | 'Toolbar'>;
  onBack: () => void;
  onEdit: () => void;
  onSendTest: () => void;
  onRotate: () => void;
  onDelete: () => void;
  onOpenDelivery: (delivery: WebhookDelivery) => void;
}

export function WebhookEndpointDetail({
  scope,
  endpoint,
  canWrite,
  busy,
  reloadKey,
  slots,
  onBack,
  onEdit,
  onSendTest,
  onRotate,
  onDelete,
  onOpenDelivery,
}: WebhookEndpointDetailProps): ReactElement {
  useDisplayTimeZone();
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(WEBHOOK_DELIVERIES_PAGE_SIZE_DEFAULT);
  const [status, setStatus] = useState<WebhookDeliveryStatus | ''>('');
  const [eventInput, setEventInput] = useState('');
  const [eventKey, setEventKey] = useState('');

  useEffect(() => {
    const timer = setTimeout(() => {
      setEventKey(eventInput.trim());
      setPage(0);
    }, 300);
    return () => clearTimeout(timer);
  }, [eventInput]);

  const { deliveries, total, isLoading, error, refresh } = useWebhookDeliveries(scope, endpoint.id, {
    page: page + 1,
    pageSize,
    ...(status ? { status } : {}),
    ...(eventKey ? { eventKey } : {}),
  });

  // Only a bump of the key reloads; `refresh` changes with the filters, which reload on their own.
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;
  useEffect(() => {
    if (reloadKey > 0) void refreshRef.current();
  }, [reloadKey]);

  const baseColumns = useMemo<DataTableColumn<WebhookDelivery>[]>(
    () => [
      { id: 'createdAt', label: 'Time', priority: 'primary', render: (row) => when(row.createdAt), value: (row) => row.createdAt },
      {
        id: 'eventKey',
        label: 'Event',
        priority: 'primary',
        render: (row) => (
          <Box component="span" sx={{ fontFamily: 'monospace' }}>
            {row.eventKey}
          </Box>
        ),
        value: (row) => row.eventKey,
      },
      {
        id: 'status',
        label: 'Status',
        priority: 'secondary',
        render: (row) => <DeliveryStatusChip status={row.status} />,
        value: (row) => webhookDeliveryStatusLabel(row.status),
      },
      { id: 'responseStatus', label: 'HTTP status', priority: 'secondary', value: (row) => row.responseStatus ?? '—' },
      {
        id: 'durationMs',
        label: 'Duration',
        priority: 'detail',
        value: (row) => formatWebhookDuration(row.durationMs) || '—',
      },
      { id: 'attempt', label: 'Attempt', priority: 'detail', value: (row) => row.attempt },
    ],
    [],
  );
  const columns = useTableSlotColumns(baseColumns, slots);
  const rowActions = useMemo<DataTableRowAction<WebhookDelivery>[]>(
    () => [{ id: 'view', label: 'View delivery', icon: <VisibilityOutlinedIcon />, onClick: onOpenDelivery }],
    [onOpenDelivery],
  );

  const status_ = webhookEndpointStatus(endpoint);
  const allEvents = endpoint.eventKeys.includes(WEBHOOK_ALL_EVENTS);
  const Toolbar = slots?.Toolbar;
  const rotationActive = endpoint.previousSecretUntil !== null && Date.parse(endpoint.previousSecretUntil) > Date.now();

  return (
    <Stack spacing={2}>
      <Box>
        <Button startIcon={<ArrowBackIcon />} onClick={onBack} sx={{ minHeight: 44 }}>
          All endpoints
        </Button>
      </Box>
      <Card variant="outlined">
        <CardContent>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ mb: 1, alignItems: { sm: 'center' } }}>
            <Typography variant="h5" component="h2" sx={{ flexGrow: 1, wordBreak: 'break-word' }}>
              {endpoint.name}
            </Typography>
            <EndpointStatusChip endpoint={endpoint} />
          </Stack>
          {status_.hint ? (
            <Alert severity={status_.tone === 'error' ? 'error' : 'warning'} sx={{ mb: 2 }}>
              {status_.hint}
            </Alert>
          ) : null}
          <Typography variant="body2" sx={{ fontFamily: 'monospace', wordBreak: 'break-all' }}>
            {endpoint.url}
          </Typography>
          {endpoint.description ? (
            <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
              {endpoint.description}
            </Typography>
          ) : null}
          <Stack direction="row" spacing={1} useFlexGap sx={{ mt: 1.5, flexWrap: 'wrap' }} aria-label="Subscribed events">
            {allEvents ? (
              <Chip size="small" label="All events" />
            ) : (
              endpoint.eventKeys.map((key) => <Chip key={key} size="small" label={key} sx={{ fontFamily: 'monospace' }} />)
            )}
          </Stack>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1.5 }}>
            Last success: {when(endpoint.lastSuccessAt)} · Last delivery: {when(endpoint.lastDeliveryAt)}
            {endpoint.consecutiveFailures > 0 ? ` · ${endpoint.consecutiveFailures} failures in a row` : ''}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Secret version {endpoint.secretVersion}
            {rotationActive ? ` · the previous secret is still accepted until ${when(endpoint.previousSecretUntil)}` : ''}
          </Typography>
          {canWrite ? (
            <Stack direction="row" spacing={1} useFlexGap sx={{ mt: 2, flexWrap: 'wrap' }}>
              <Button variant="contained" startIcon={<SendOutlinedIcon />} onClick={onSendTest} disabled={busy} sx={{ minHeight: 44 }}>
                Send test event
              </Button>
              <Button variant="outlined" startIcon={<EditOutlinedIcon />} onClick={onEdit} disabled={busy} sx={{ minHeight: 44 }}>
                Edit
              </Button>
              <Button variant="outlined" startIcon={<KeyOutlinedIcon />} onClick={onRotate} disabled={busy} sx={{ minHeight: 44 }}>
                Rotate secret
              </Button>
              <Button
                variant="outlined"
                color="error"
                startIcon={<DeleteOutlineIcon />}
                onClick={onDelete}
                disabled={busy}
                sx={{ minHeight: 44 }}
              >
                Delete
              </Button>
            </Stack>
          ) : null}
        </CardContent>
      </Card>

      <Card variant="outlined">
        <CardContent>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ mb: 2, alignItems: { sm: 'center' } }}>
            <Typography variant="h6" component="h3" sx={{ flexGrow: 1 }}>
              Deliveries
            </Typography>
            <Button startIcon={<RefreshIcon />} onClick={() => void refresh()} sx={{ minHeight: 44 }}>
              Refresh
            </Button>
          </Stack>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ mb: 2 }}>
            <FormControl size="small" sx={{ minWidth: 180 }}>
              <InputLabel id="webhook-delivery-status-label">Status</InputLabel>
              <Select
                labelId="webhook-delivery-status-label"
                label="Status"
                value={status}
                onChange={(event) => {
                  setStatus(event.target.value as WebhookDeliveryStatus | '');
                  setPage(0);
                }}
              >
                <MenuItem value="">Any status</MenuItem>
                {WEBHOOK_DELIVERY_STATUSES.map((value) => (
                  <MenuItem key={value} value={value}>
                    {webhookDeliveryStatusLabel(value)}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
            <TextField
              size="small"
              label="Event key"
              placeholder="nodes.node.offline"
              value={eventInput}
              onChange={(event) => setEventInput(event.target.value)}
            />
          </Stack>
          {Toolbar ? <Toolbar /> : null}
          {error ? (
            <Alert severity="error" sx={{ mb: 2 }}>
              {error}
            </Alert>
          ) : null}
          <DataTable<WebhookDelivery>
            tableId={`webhook-deliveries-${scope}`}
            ariaLabel="Deliveries"
            columns={columns}
            rows={deliveries}
            rowId={(row) => row.id}
            loading={isLoading}
            rowActions={rowActions}
            emptyState={
              <Typography variant="body2" color="text.secondary" sx={{ p: 2 }}>
                No deliveries yet.{canWrite ? ' Send a test event to try the endpoint.' : ''}
              </Typography>
            }
            pagination={{
              page,
              pageSize,
              total,
              pageSizeOptions: [10, 20, 50, 100],
              onPaginationChange: (next) => {
                setPage(next.page);
                setPageSize(next.pageSize);
              },
            }}
            disableExport
          />
        </CardContent>
      </Card>
    </Stack>
  );
}
