// =============================================================================
// WebhooksPage (issue #1046): one page, three scopes
// =============================================================================
//
// `scope="user"` at `/settings/webhooks` (the caller's own endpoints),
// `scope="org"` at `/admin/settings/organization-webhooks` (the organization's)
// and `scope="system"` at `/admin/settings/webhooks` (the deployment's). The
// list of endpoints, the detail of one with its deliveries, and every write
// (create, edit, send a test, rotate the secret, delete, redeliver). Write
// controls are drawn only for a viewer holding the scope's `:write`
// permission; the API enforces it either way.
// =============================================================================

import AddIcon from '@mui/icons-material/Add';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Container,
  Link,
  Stack,
  Typography,
} from '@mui/material';
import { useCallback, useMemo, useState, type ReactElement } from 'react';

import type {
  CreateWebhookEndpointInput,
  UpdateWebhookEndpoint,
  WebhookDelivery,
  WebhookDeliveryDetail,
  WebhookEndpoint,
  WebhookScope,
} from '@marinoscar/platform-contract/webhooks';

import { PageSlotsFrame, useDisplayTimeZone, usePlatformViewer } from '../../core/index.js';
import type { PageSlotsBase, TableSlots } from '../../core/index.js';
import { DataTable, type DataTableColumn, type DataTableRowAction } from '../../datatable/index.js';
import {
  WEBHOOK_ALL_EVENTS,
  WEBHOOK_SCOPE_PERMISSIONS,
  useWebhookEndpoint,
  useWebhookEndpoints,
  useWebhookEventCatalog,
  useWebhookMutations,
  webhookEndpointStatus,
  webhookUrlHost,
} from '../headless/index.js';
import { WEBHOOK_ROTATION_OVERLAP_HOURS, WEBHOOKS_PAGE_COPY } from './copy.js';
import { ConfirmDialog, EndpointStatusChip, when } from './parts.js';
import { WebhookDeliveryDrawer } from './WebhookDeliveryDrawer.js';
import { WebhookEndpointDetail } from './WebhookEndpointDetail.js';
import { WebhookEndpointDialog } from './WebhookEndpointDialog.js';
import { WebhookSecretDialog } from './WebhookSecretDialog.js';
import { WebhookSignatureHelp } from './WebhookSignatureHelp.js';

/**
 * The slots of {@link WebhooksPage}: the page-slot contract
 * ({@link PageSlotsBase}) plus the deliveries table's slots (`Columns`,
 * `RowActions`, `DetailPanel`, `Toolbar`), applied to an endpoint's
 * deliveries.
 *
 * @example
 * ```tsx
 * <WebhooksPage scope="org" slots={{ BeforeContent: ReceiverPolicyNotice }} />
 * ```
 *
 * @extensionPoint slot
 * @stability experimental
 */
export interface WebhooksPageSlots extends PageSlotsBase, TableSlots<WebhookDelivery, DataTableColumn<WebhookDelivery>> {}

/**
 * Props of {@link WebhooksPage}.
 *
 * @stability experimental
 */
export interface WebhooksPageProps {
  /** Which endpoints the page manages: the caller's (`user`), the organization's (`org`) or the deployment's (`system`). */
  scope: WebhookScope;
  /** Optional extension slots; omitted, the page renders exactly its own markup. */
  slots?: WebhooksPageSlots;
}

type SecretView = { secret: string; reason: 'created' | 'rotated'; previousSecretValidUntil?: string | null };
type Confirm = 'rotate' | 'delete' | null;

function eventsSummary(endpoint: WebhookEndpoint): string {
  if (endpoint.eventKeys.includes(WEBHOOK_ALL_EVENTS)) return 'All events';
  const count = endpoint.eventKeys.length;
  return count === 1 ? '1 event' : `${count} events`;
}

/**
 * The webhooks page of one scope.
 *
 * @param props - see {@link WebhooksPageProps}.
 * @returns the page.
 *
 * @example
 * ```tsx
 * <Route path="/settings/webhooks" element={<WebhooksPage scope="user" />} />
 * ```
 *
 * @extensionPoint component
 * @stability experimental
 */
export function WebhooksPage({ scope, slots }: WebhooksPageProps): ReactElement {
  useDisplayTimeZone();
  const copy = WEBHOOKS_PAGE_COPY[scope];
  const viewer = usePlatformViewer();
  const canWrite = viewer.hasPermission(WEBHOOK_SCOPE_PERMISSIONS[scope].write);

  const { endpoints, isLoading, error, refresh } = useWebhookEndpoints(scope);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = useWebhookEndpoint(scope, selectedId);
  const mutations = useWebhookMutations(scope);

  const [editing, setEditing] = useState<WebhookEndpoint | 'new' | null>(null);
  const catalog = useWebhookEventCatalog(scope, { enabled: canWrite && editing !== null });
  const [secret, setSecret] = useState<SecretView | null>(null);
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [deliveryId, setDeliveryId] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);

  const resetMutations = mutations.reset;
  const open = useCallback(
    (id: string) => {
      setNotice(null);
      resetMutations();
      setSelectedId(id);
    },
    [resetMutations],
  );

  const back = () => {
    setSelectedId(null);
    setNotice(null);
    mutations.reset();
    void refresh();
  };

  const save = async (input: CreateWebhookEndpointInput) => {
    if (editing === 'new') {
      const created = await mutations.create(input);
      if (!created) return;
      setEditing(null);
      setSecret({ secret: created.secret, reason: 'created' });
      await refresh();
      setSelectedId(created.endpoint.id);
      return;
    }
    if (!editing) return;
    const patch: UpdateWebhookEndpoint = {
      name: input.name,
      url: input.url,
      description: input.description ?? null,
      eventKeys: input.eventKeys,
      ...(input.enabled === undefined ? {} : { enabled: input.enabled }),
    };
    const updated = await mutations.update(editing.id, patch);
    if (!updated) return;
    setEditing(null);
    await selected.refresh();
  };

  const sendTest = async () => {
    if (!selectedId) return;
    setNotice(null);
    const result = await mutations.sendTest(selectedId);
    if (!result) return;
    setNotice('Test event queued. It appears in the deliveries below within a few seconds.');
    setReloadKey((key) => key + 1);
  };

  const rotate = async () => {
    if (!selectedId) return;
    const result = await mutations.rotateSecret(selectedId);
    setConfirm(null);
    if (!result) return;
    setSecret({ secret: result.secret, reason: 'rotated', previousSecretValidUntil: result.previousSecretValidUntil });
    await selected.refresh();
  };

  const remove = async () => {
    if (!selectedId) return;
    const ok = await mutations.remove(selectedId);
    setConfirm(null);
    if (!ok) return;
    setSelectedId(null);
    setNotice('Endpoint deleted.');
    await refresh();
  };

  const redeliver = async (delivery: WebhookDeliveryDetail) => {
    const ok = await mutations.redeliver(delivery.id);
    if (ok) setReloadKey((key) => key + 1);
    return ok;
  };

  const columns = useMemo<DataTableColumn<WebhookEndpoint>[]>(
    () => [
      {
        id: 'name',
        label: 'Name',
        priority: 'primary',
        value: (row) => row.name,
        render: (row) => (
          <Link component="button" type="button" variant="body2" onClick={() => open(row.id)} sx={{ textAlign: 'left', fontWeight: 600 }}>
            {row.name}
          </Link>
        ),
      },
      { id: 'host', label: 'URL host', priority: 'primary', value: (row) => webhookUrlHost(row.url) },
      { id: 'events', label: 'Events', priority: 'secondary', value: (row) => eventsSummary(row) },
      {
        id: 'status',
        label: 'Status',
        priority: 'secondary',
        value: (row) => webhookEndpointStatus(row).label,
        render: (row) => <EndpointStatusChip endpoint={row} />,
      },
      { id: 'lastSuccessAt', label: 'Last success', priority: 'detail', value: (row) => when(row.lastSuccessAt) },
    ],
    [open],
  );
  const rowActions = useMemo<DataTableRowAction<WebhookEndpoint>[]>(
    () => [{ id: 'open', label: 'Open endpoint', icon: <ChevronRightIcon />, onClick: (row) => open(row.id) }],
    [open],
  );

  const endpoint = selectedId ? selected.endpoint : null;
  const pageError = error ?? (selectedId ? selected.error : null);

  return (
    <Container maxWidth="lg">
      <Box sx={{ py: { xs: 2, sm: 4 } }}>
        <PageSlotsFrame
          slots={slots}
          headerProps={{ title: copy.title, description: copy.description, readOnly: !canWrite, actions: null }}
          header={
            <>
              <Typography variant="h4" component="h1" gutterBottom>
                {copy.title}
                {canWrite ? null : ' (read-only)'}
              </Typography>
              <Typography color="text.secondary" sx={{ mb: 3 }}>
                {copy.description}
              </Typography>
            </>
          }
        >
          {pageError ? (
            <Alert severity="error" sx={{ mb: 2 }}>
              {pageError}
            </Alert>
          ) : null}
          {mutations.error && editing === null ? (
            <Alert severity="error" sx={{ mb: 2 }} onClose={mutations.reset}>
              {mutations.error}
            </Alert>
          ) : null}
          {notice ? (
            <Alert severity="success" sx={{ mb: 2 }} onClose={() => setNotice(null)}>
              {notice}
            </Alert>
          ) : null}
          {selectedId ? (
            endpoint ? (
              <WebhookEndpointDetail
                scope={scope}
                endpoint={endpoint}
                canWrite={canWrite}
                busy={mutations.pending}
                reloadKey={reloadKey}
                {...(slots ? { slots } : {})}
                onBack={back}
                onEdit={() => {
                  mutations.reset();
                  setEditing(endpoint);
                }}
                onSendTest={() => void sendTest()}
                onRotate={() => setConfirm('rotate')}
                onDelete={() => setConfirm('delete')}
                onOpenDelivery={(delivery) => setDeliveryId(delivery.id)}
              />
            ) : selected.isLoading ? (
              <Typography color="text.secondary">Loading the endpoint…</Typography>
            ) : (
              <Button onClick={back} sx={{ minHeight: 44 }}>
                All endpoints
              </Button>
            )
          ) : (
            <Stack spacing={2}>
              {canWrite ? (
                <Box>
                  <Button
                    variant="contained"
                    startIcon={<AddIcon />}
                    onClick={() => {
                      mutations.reset();
                      setEditing('new');
                    }}
                    sx={{ minHeight: 44 }}
                  >
                    New endpoint
                  </Button>
                </Box>
              ) : null}
              <Card variant="outlined">
                <CardContent>
                  <DataTable<WebhookEndpoint>
                    tableId={`webhook-endpoints-${scope}`}
                    ariaLabel="Webhook endpoints"
                    columns={columns}
                    rows={endpoints}
                    rowId={(row) => row.id}
                    loading={isLoading}
                    rowActions={rowActions}
                    emptyState={
                      <Typography variant="body2" color="text.secondary" sx={{ p: 2 }}>
                        No endpoints yet.{canWrite ? ' Create one to start receiving events.' : ''}
                      </Typography>
                    }
                    disableExport
                  />
                </CardContent>
              </Card>
            </Stack>
          )}
          <Box sx={{ mt: 3 }}>
            <WebhookSignatureHelp />
          </Box>
        </PageSlotsFrame>
      </Box>

      {canWrite ? (
        <WebhookEndpointDialog
          open={editing !== null}
          endpoint={editing === 'new' ? null : editing}
          groups={catalog.groups}
          catalogLoading={catalog.isLoading}
          catalogError={catalog.error}
          saving={mutations.pending}
          error={editing !== null ? mutations.error : null}
          onSubmit={(input) => void save(input)}
          onClose={() => {
            setEditing(null);
            mutations.reset();
          }}
        />
      ) : null}
      <WebhookSecretDialog
        secret={secret?.secret ?? null}
        reason={secret?.reason ?? 'created'}
        previousSecretValidUntil={secret?.previousSecretValidUntil ?? null}
        onClose={() => setSecret(null)}
      />
      <ConfirmDialog
        open={confirm === 'rotate'}
        title="Rotate the signing secret?"
        confirmLabel="Rotate secret"
        busy={mutations.pending}
        onConfirm={() => void rotate()}
        onClose={() => setConfirm(null)}
      >
        A new secret is created and shown once. For the next {WEBHOOK_ROTATION_OVERLAP_HOURS} hours every delivery is
        signed with both the old and the new secret, so you can update your receiver without missing an event. After
        that, only the new secret is accepted.
      </ConfirmDialog>
      <ConfirmDialog
        open={confirm === 'delete'}
        title="Delete this endpoint?"
        confirmLabel="Delete endpoint"
        destructive
        busy={mutations.pending}
        onConfirm={() => void remove()}
        onClose={() => setConfirm(null)}
      >
        {endpoint ? <strong>{endpoint.name}</strong> : 'The endpoint'} stops receiving events now, and its delivery
        history is deleted with it. This cannot be undone.
      </ConfirmDialog>
      <WebhookDeliveryDrawer
        scope={scope}
        deliveryId={deliveryId}
        canWrite={canWrite}
        onRedeliver={redeliver}
        redelivering={mutations.pending}
        onClose={() => setDeliveryId(null)}
      />
    </Container>
  );
}
