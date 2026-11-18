// =============================================================================
// Console → OAuth clients, `/admin/settings/oauth-clients` (PP-15.7, #1185;
// docs/specs/oauth-server.md §2.15 and §3)
// =============================================================================
//
// ONE destination with five sections, top to bottom (no tabs: the sections are
// not parallel content):
//
//   1. Status and switch: `oauthServer.enabled`, the issuer with a copy
//      button, a warning when the address is not `https:`.
//   2. Who may connect: the allowed client hosts, the app's suggested hosts,
//      loopback clients, any host (behind a confirmation), CIMD and DCR.
//   3. Refused attempts: the hosts the trust policy turned away, with "Allow
//      this host".
//   4. Clients: the list, disable/enable, delete (says how many connections
//      stop), add a client (the secret shown once), rotate a secret.
//   5. Token lifetimes.
//
// Permissions (the API enforces every one; these only hide controls):
//   - the card and the client list: `oauth_clients:read`;
//   - client writes: `oauth_clients:write`;
//   - the settings sections READ `/api/system-settings`
//     (`system_settings:read`) and SAVE through it (`system_settings:write`);
//     the spec gates their controls on `oauth_clients:write` too, so editing
//     them needs both. Without the right permission a control is ABSENT, not
//     disabled: a read-only administrator sees values as text.
// =============================================================================

import { useMemo, useState } from 'react';
import type { ReactElement, ReactNode } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Container,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Drawer,
  FormControlLabel,
  IconButton,
  List,
  ListItem,
  ListItemText,
  Stack,
  Switch,
  TextField,
  Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import BlockIcon from '@mui/icons-material/Block';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutlineOutlined';
import CloseIcon from '@mui/icons-material/Close';
import DeleteIcon from '@mui/icons-material/Delete';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import KeyIcon from '@mui/icons-material/Key';
import type { OAuthClientView, OAuthClientWithSecret } from '@marinoscar/platform-contract/identity';

import type { PageSlotsBase } from '../../../core/index.js';
import { NUMERIC_DATE, formatDate, useDisplayTimeZone, useOptionalPlatformHost } from '../../../core/index.js';
import {
  OAUTH_SERVER_SETTING_BOUNDS,
  useOAuthClients,
  useOAuthRefusedHosts,
  useOAuthServerSettings,
  useOAuthServerStatus,
  usePermissions,
} from '../../headless/index.js';
import type {
  IdentityTableColumn,
  IdentityTableRowAction,
  OAuthRefusedHost,
  OAuthServerApi,
  OAuthServerSettings,
  UseOAuthServerSettingsReturn,
} from '../../headless/index.js';
import { DefaultPageHeader } from '../PageHeader.js';
import { IdentityTable } from '../table.js';
import { AddOAuthClientDialog, CopyField, OAuthClientSecretDialog } from './OAuthClientDialogs.js';
import { clientHostProblem, relativeTime } from './oauth-display.js';

const PAGE_TITLE = 'OAuth clients';
const PAGE_DESCRIPTION =
  'Let other apps connect with OAuth: switch the server on, choose which client hosts may connect, and manage clients and token lifetimes.';

/** Persistence key for `user_settings.dataTables`. */
export const OAUTH_CLIENTS_TABLE_ID = 'admin-oauth-clients';

const KIND_LABELS: Record<OAuthClientView['kind'], string> = {
  cimd: 'Metadata document',
  dynamic: 'Registered itself',
  registered: 'Added by an administrator',
};

/**
 * The slots of {@link OAuthClientsPage}: the packaged-page slot contract.
 *
 * @extensionPoint slot
 * @stability experimental
 */
export type OAuthClientsPageSlots = PageSlotsBase;

/**
 * Props of {@link OAuthClientsPage}.
 *
 * @stability experimental
 */
export interface OAuthClientsPageProps {
  /** Add to the page without a fork. */
  slots?: OAuthClientsPageSlots;
  /** The OAuth client. Default `useOAuthServerApi()`'s. */
  api?: OAuthServerApi;
  /**
   * Client hosts the app suggests, each offered with "Add" until it is allowed:
   * the same list the app passes to the API as
   * `IdentityModule.forRoot({ oauthServer: { defaultAllowedClientHosts } })`.
   * Default none (the platform ships none).
   */
  suggestedHosts?: readonly string[];
}

/**
 * The admin `OAuth clients` page (`/admin/settings/oauth-clients`).
 *
 * @param props - see {@link OAuthClientsPageProps}.
 * @returns the page.
 *
 * @extensionPoint component
 * @stability experimental
 */
export function OAuthClientsPage({ slots, api, suggestedHosts = [] }: OAuthClientsPageProps = {}): ReactElement {
  const { hasPermission } = usePermissions();
  const canWriteClients = hasPermission('oauth_clients:write');
  const canReadSettings = hasPermission('system_settings:read');
  const canWriteSettings = canWriteClients && hasPermission('system_settings:write');

  const Header = slots?.Header;
  const BeforeContent = slots?.BeforeContent;
  const Sections = slots?.Sections;
  const AfterContent = slots?.AfterContent;
  const readOnly = !canWriteClients;

  return (
    <Container maxWidth="lg">
      <Box sx={{ py: { xs: 2, sm: 4 } }}>
        {Header ? (
          <Header title={PAGE_TITLE} description={PAGE_DESCRIPTION} readOnly={readOnly} actions={null} />
        ) : (
          <DefaultPageHeader title={PAGE_TITLE} description={PAGE_DESCRIPTION} />
        )}
        {readOnly && (
          <Alert severity="info" sx={{ mb: 2 }}>
            You can see the OAuth clients but not change them.
          </Alert>
        )}
        {BeforeContent && <BeforeContent />}
        {Sections && <Sections position="top" />}
        <Stack spacing={3}>
          {canReadSettings ? (
            <SettingsArea
              api={api}
              canWrite={canWriteSettings}
              suggestedHosts={suggestedHosts}
              clients={<ClientsSection api={api} canWrite={canWriteClients} />}
            />
          ) : (
            <>
              <Alert severity="info">
                Switching the OAuth server, the allowed hosts and the token lifetimes need the permission to read system
                settings.
              </Alert>
              <ClientsSection api={api} canWrite={canWriteClients} />
            </>
          )}
        </Stack>
        {Sections && <Sections position="bottom" />}
        {AfterContent && <AfterContent />}
      </Box>
    </Container>
  );
}

/** One titled section of the page. */
function PageSection({ id, title, description, children, action }: { id: string; title: string; description?: string; children: ReactNode; action?: ReactNode }): ReactElement {
  return (
    <Card component="section" aria-labelledby={id}>
      <CardContent>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ justifyContent: 'space-between', alignItems: { sm: 'flex-start' }, mb: 2 }}>
          <Box>
            <Typography id={id} variant="h6" component="h2">
              {title}
            </Typography>
            {description && (
              <Typography variant="body2" color="text.secondary">
                {description}
              </Typography>
            )}
          </Box>
          {action}
        </Stack>
        {children}
      </CardContent>
    </Card>
  );
}

/** A boolean setting: a switch for a writer, the value as text otherwise. */
function SettingSwitch({
  label,
  help,
  checked,
  canWrite,
  disabled,
  onChange,
}: {
  label: string;
  help?: string;
  checked: boolean;
  canWrite: boolean;
  disabled?: boolean;
  onChange: (next: boolean) => void;
}): ReactElement {
  return (
    <Box sx={{ py: 0.5 }}>
      {canWrite ? (
        <FormControlLabel
          sx={{ mx: 0, minHeight: 44 }}
          control={<Switch checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)} />}
          label={label}
        />
      ) : (
        <Typography variant="body2" sx={{ minHeight: 32, display: 'flex', alignItems: 'center', gap: 1 }}>
          {label}:{' '}
          <Box component="strong">{checked ? 'On' : 'Off'}</Box>
        </Typography>
      )}
      {help && (
        <Typography variant="caption" color="text.secondary" component="p" sx={{ ml: canWrite ? 6.5 : 0 }}>
          {help}
        </Typography>
      )}
    </Box>
  );
}

/**
 * The sections backed by the `oauthServer` settings (1, 2, 3 and 5) around the
 * client list (4): ONE settings load, so every save carries the version the
 * last save returned.
 */
function SettingsArea({
  api,
  canWrite,
  suggestedHosts,
  clients,
}: {
  api: OAuthServerApi | undefined;
  canWrite: boolean;
  suggestedHosts: readonly string[];
  clients: ReactNode;
}): ReactElement {
  const state = useOAuthServerSettings(api);
  return (
    <>
      <SettingsSections api={api} state={state} canWrite={canWrite} suggestedHosts={suggestedHosts} />
      {clients}
      <LifetimesSection state={state} canWrite={canWrite} />
    </>
  );
}

function SettingsSections({
  api,
  state,
  canWrite,
  suggestedHosts,
}: {
  api: OAuthServerApi | undefined;
  state: UseOAuthServerSettingsReturn;
  canWrite: boolean;
  suggestedHosts: readonly string[];
}): ReactElement {
  const { settings, isLoading, isSaving, error, update } = state;
  const status = useOAuthServerStatus();
  const refused = useOAuthRefusedHosts(api);
  const [hostInput, setHostInput] = useState('');
  const [hostTouched, setHostTouched] = useState(false);
  const [confirmAnyHost, setConfirmAnyHost] = useState(false);
  const hostRelative = useOptionalPlatformHost()?.formatRelativeTime;

  const issuer = status.issuer ?? (typeof window !== 'undefined' ? window.location.origin : '');
  const insecure = !issuer.startsWith('https:');

  const save = (patch: Partial<OAuthServerSettings>) => update(patch).catch(() => undefined);

  if (isLoading && !settings) {
    return (
      <PageSection id="oauth-status" title="Status">
        <Typography variant="body2" color="text.secondary" role="status">
          Loading the OAuth server settings…
        </Typography>
      </PageSection>
    );
  }
  if (!settings) {
    return <Alert severity="error">{error ?? 'Could not load the OAuth server settings.'}</Alert>;
  }

  const allowed = settings.allowedClientHosts;
  const trimmed = hostInput.trim();
  const hostProblem = clientHostProblem(trimmed) ?? (allowed.includes(trimmed) ? 'This host is already allowed.' : null);
  const addHost = (host: string) => save({ allowedClientHosts: [...allowed, host] });
  const removeHost = (host: string) => save({ allowedClientHosts: allowed.filter((entry) => entry !== host) });
  const suggestions = suggestedHosts.filter((host) => !allowed.includes(host));

  return (
    <>
      {error && <Alert severity="error">{error}</Alert>}

      {/* 1. Status and switch. */}
      <PageSection id="oauth-status" title="Status">
        <Stack spacing={2}>
          <SettingSwitch
            label="Let other apps connect with OAuth"
            help="Off: apps cannot connect, and apps already connected stop working until it is on again."
            checked={settings.enabled}
            canWrite={canWrite}
            disabled={isSaving}
            onChange={(enabled) => void save({ enabled }).then(() => status.refresh())}
          />
          <CopyField label="Issuer URL" value={issuer} testId="oauth-issuer" />
          {insecure && (
            <Alert severity="warning">
              This address is not https:. Other services cannot reach this address, or will refuse it. Set APP_URL to the
              public https: address of this deployment.
            </Alert>
          )}
        </Stack>
      </PageSection>

      {/* 2. Who may connect. */}
      <PageSection
        id="oauth-who"
        title="Who may connect"
        description="An app connects only when its host is allowed here, or when an administrator added it below."
      >
        <Stack spacing={2}>
          <Box>
            <Typography variant="subtitle2" component="h3" gutterBottom>
              Allowed client hosts
            </Typography>
            {allowed.length === 0 ? (
              <Typography variant="body2" color="text.secondary">
                No hosts are allowed yet.
              </Typography>
            ) : (
              <Stack direction="row" useFlexGap spacing={1} component="ul" sx={{ flexWrap: 'wrap', listStyle: 'none', p: 0, m: 0 }}>
                {allowed.map((host) => (
                  <Box component="li" key={host}>
                    <Chip
                      label={host}
                      {...(canWrite ? { onDelete: () => void removeHost(host), deleteIcon: <CloseIcon aria-label={`Remove ${host}`} /> } : {})}
                      disabled={isSaving}
                    />
                  </Box>
                ))}
              </Stack>
            )}
          </Box>
          {canWrite && (
            <Stack
              component="form"
              direction={{ xs: 'column', sm: 'row' }}
              spacing={1}
              sx={{ alignItems: { sm: 'flex-start' } }}
              onSubmit={(event) => {
                event.preventDefault();
                setHostTouched(true);
                if (hostProblem) return;
                void addHost(trimmed).then(() => {
                  setHostInput('');
                  setHostTouched(false);
                });
              }}
            >
              <TextField
                label="Add a host"
                placeholder="app.example.test"
                size="small"
                value={hostInput}
                onChange={(event) => setHostInput(event.target.value)}
                error={hostTouched && hostProblem !== null}
                helperText={hostTouched && hostProblem ? hostProblem : 'A host name only: no https://, port, path or wildcard.'}
                sx={{ flex: 1 }}
              />
              <Button type="submit" variant="outlined" disabled={isSaving} sx={{ minHeight: 44 }}>
                Add host
              </Button>
            </Stack>
          )}
          {suggestions.length > 0 && (
            <Box>
              <Typography variant="subtitle2" component="h3" gutterBottom>
                Suggested by this app
              </Typography>
              <Stack spacing={1}>
                {suggestions.map((host) => (
                  <Stack sx={{ alignItems: 'center' }} key={host} direction="row" spacing={1}>
                    <Typography variant="body2" sx={{ flex: 1, minWidth: 0 }}>
                      {host}
                    </Typography>
                    {canWrite && (
                      <Button size="small" onClick={() => void addHost(host)} disabled={isSaving} sx={{ minHeight: 44 }} aria-label={`Add ${host}`}>
                        Add
                      </Button>
                    )}
                  </Stack>
                ))}
              </Stack>
            </Box>
          )}
          <SettingSwitch
            label="Allow apps that run on the person’s own computer"
            help="Native apps whose every return address is on localhost."
            checked={settings.allowLoopbackClients}
            canWrite={canWrite}
            disabled={isSaving}
            onChange={(allowLoopbackClients) => void save({ allowLoopbackClients })}
          />
          <SettingSwitch
            label="Allow apps from any host"
            help="For development and open deployments only."
            checked={settings.allowAnyClientHost}
            canWrite={canWrite}
            disabled={isSaving}
            onChange={(next) => {
              if (next) setConfirmAnyHost(true);
              else void save({ allowAnyClientHost: false });
            }}
          />
          {settings.allowAnyClientHost && (
            <Alert severity="warning">Any app on the internet can ask people here to connect it.</Alert>
          )}
          <SettingSwitch
            label="Accept client metadata documents"
            help="Apps identify themselves with a URL that describes them."
            checked={settings.clientIdMetadataDocuments}
            canWrite={canWrite}
            disabled={isSaving}
            onChange={(clientIdMetadataDocuments) => void save({ clientIdMetadataDocuments })}
          />
          <SettingSwitch
            label="Let apps register themselves"
            help="Dynamic client registration. The allowed hosts still apply."
            checked={settings.dynamicClientRegistration}
            canWrite={canWrite}
            disabled={isSaving}
            onChange={(dynamicClientRegistration) => void save({ dynamicClientRegistration })}
          />
        </Stack>
      </PageSection>

      {/* 3. Refused attempts. */}
      <PageSection id="oauth-refused" title="Refused attempts" description="Apps that tried to connect in the last 30 days and were turned away.">
        <RefusedHosts
          hosts={refused.hosts}
          isLoading={refused.isLoading}
          available={refused.available}
          error={refused.error}
          allowed={allowed}
          canWrite={canWrite}
          disabled={isSaving}
          ago={(iso) => (hostRelative ? hostRelative(iso) : relativeTime(iso))}
          onAllow={(host) => void addHost(host)}
        />
      </PageSection>

      <Dialog open={confirmAnyHost} onClose={() => setConfirmAnyHost(false)} aria-labelledby="oauth-any-host-title">
        <DialogTitle id="oauth-any-host-title">Allow apps from any host?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            Any app on the internet will be able to ask people on this deployment to connect it. People still decide on
            the consent page, but a look-alike app can trick them. Use this only for development or an open deployment.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmAnyHost(false)} sx={{ minHeight: 44 }}>
            Cancel
          </Button>
          <Button
            color="warning"
            variant="contained"
            sx={{ minHeight: 44 }}
            onClick={() => {
              setConfirmAnyHost(false);
              void save({ allowAnyClientHost: true });
            }}
          >
            Allow any host
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}

function RefusedHosts({
  hosts,
  isLoading,
  available,
  error,
  allowed,
  canWrite,
  disabled,
  ago,
  onAllow,
}: {
  hosts: OAuthRefusedHost[];
  isLoading: boolean;
  available: boolean;
  error: string | null;
  allowed: readonly string[];
  canWrite: boolean;
  disabled: boolean;
  ago: (iso: string) => string;
  onAllow: (host: string) => void;
}): ReactElement {
  if (error) return <Alert severity="error">{error}</Alert>;
  if (!available) {
    return (
      <Typography variant="body2" color="text.secondary">
        This server does not list refused attempts. They are in the audit log as oauth:client.refused.
      </Typography>
    );
  }
  if (isLoading && hosts.length === 0) {
    return (
      <Typography variant="body2" color="text.secondary" role="status">
        Loading…
      </Typography>
    );
  }
  if (hosts.length === 0) {
    return (
      <Typography variant="body2" color="text.secondary">
        No refused attempts in the last 30 days.
      </Typography>
    );
  }
  return (
    <List disablePadding aria-label="Refused hosts">
      {hosts.map((entry) => {
        const isAllowed = allowed.includes(entry.host);
        return (
          <ListItem
            key={entry.host}
            divider
            disableGutters
            secondaryAction={
              canWrite && !isAllowed ? (
                <Button size="small" onClick={() => onAllow(entry.host)} disabled={disabled} sx={{ minHeight: 44 }} aria-label={`Allow ${entry.host}`}>
                  Allow this host
                </Button>
              ) : isAllowed ? (
                <Typography variant="caption" color="text.secondary">
                  Allowed
                </Typography>
              ) : undefined
            }
            sx={{ pr: canWrite ? 16 : 8 }}
          >
            <ListItemText
              primary={entry.host}
              secondary={`${entry.count} ${entry.count === 1 ? 'attempt' : 'attempts'}, last ${ago(entry.lastSeenAt)}`}
              slotProps={{ primary: { sx: { overflowWrap: 'anywhere' } } }}
            />
          </ListItem>
        );
      })}
    </List>
  );
}

function ClientsSection({ api, canWrite }: { api: OAuthServerApi | undefined; canWrite: boolean }): ReactElement {
  const clients = useOAuthClients(api);
  const [adding, setAdding] = useState(false);
  const [secret, setSecret] = useState<OAuthClientWithSecret | null>(null);
  const [details, setDetails] = useState<OAuthClientView | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const timeZone = useDisplayTimeZone();
  const hostRelative = useOptionalPlatformHost()?.formatRelativeTime;
  const { setDisabled, rotateSecret, deleteClient } = clients;

  const columns = useMemo<IdentityTableColumn<OAuthClientView>[]>(() => {
    const ago = (iso: string) => (hostRelative ? hostRelative(iso) : relativeTime(iso));
    return [
      {
        id: 'name',
        label: 'Name',
        priority: 'primary',
        hideable: false,
        minWidth: 160,
        flex: 1,
        value: (client) => `${client.name} (${client.host})`,
        render: (client) => (
          <Box>
            <Typography variant="body2" sx={{ fontWeight: 500 }}>
              {client.name}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {client.host}
            </Typography>
          </Box>
        ),
      },
      { id: 'kind', label: 'Kind', priority: 'secondary', minWidth: 140, value: (client) => KIND_LABELS[client.kind] },
      {
        id: 'status',
        label: 'Status',
        priority: 'primary',
        width: 110,
        value: (client) => (client.disabled ? 'Disabled' : 'Active'),
        render: (client) =>
          client.disabled ? (
            <Chip label="Disabled" size="small" icon={<BlockIcon />} />
          ) : (
            <Chip label="Active" size="small" color="success" variant="outlined" icon={<CheckCircleOutlineIcon />} />
          ),
      },
      { id: 'activeGrantCount', label: 'Connections', priority: 'secondary', width: 120, value: (client) => client.activeGrantCount },
      {
        id: 'lastUsedAt',
        label: 'Last used',
        priority: 'detail',
        value: (client) => (client.lastUsedAt ? ago(client.lastUsedAt) : 'Never'),
      },
      { id: 'createdAt', label: 'First seen', priority: 'detail', value: (client) => formatDate(client.createdAt, NUMERIC_DATE) },
    ];
  }, [timeZone, hostRelative]);

  const rowActions = useMemo<IdentityTableRowAction<OAuthClientView>[]>(() => {
    const actions: IdentityTableRowAction<OAuthClientView>[] = [
      {
        id: 'details',
        label: 'Details',
        icon: <InfoOutlinedIcon fontSize="small" />,
        onClick: (client) => setDetails(client),
      },
    ];
    if (!canWrite) return actions;
    const run = (id: string, call: () => Promise<unknown>) => {
      setBusy(id);
      void call()
        .catch(() => undefined)
        .finally(() => setBusy(null));
    };
    actions.push(
      {
        id: 'toggle',
        label: 'Disable or enable',
        icon: <BlockIcon fontSize="small" />,
        disabled: (client) => busy === client.id,
        confirm: {
          title: 'Change this client?',
          description: (client) =>
            client.disabled
              ? `Enable ${client.name} (${client.host})? People can connect it again.`
              : `Disable ${client.name} (${client.host})? Its ${client.activeGrantCount} active ${client.activeGrantCount === 1 ? 'connection stops' : 'connections stop'} working at once.`,
          confirmLabel: 'Change',
        },
        onClick: (client) => run(client.id, () => setDisabled(client.id, !client.disabled)),
      },
      {
        id: 'rotate',
        label: 'Rotate secret',
        icon: <KeyIcon fontSize="small" />,
        disabled: (client) => busy === client.id || client.tokenEndpointAuthMethod === 'none',
        disabledReason: (client) => (client.tokenEndpointAuthMethod === 'none' ? 'A public client has no secret.' : undefined),
        confirm: {
          title: 'Rotate the secret?',
          description: (client) => `The current secret of ${client.name} stops working at once. You will see the new one once.`,
          confirmLabel: 'Rotate',
        },
        onClick: (client) =>
          run(client.id, async () => {
            setSecret(await rotateSecret(client.id));
          }),
      },
      {
        id: 'delete',
        label: 'Delete',
        icon: <DeleteIcon fontSize="small" />,
        destructive: true,
        disabled: (client) => busy === client.id,
        confirm: {
          title: 'Delete this client?',
          description: (client) =>
            `${client.name} (${client.host}) has ${client.activeGrantCount} active ${client.activeGrantCount === 1 ? 'connection' : 'connections'}. ` +
            `${client.activeGrantCount === 1 ? 'The person who made it loses' : 'The people who made them lose'} access at once. This cannot be undone.`,
          confirmLabel: 'Delete',
        },
        onClick: (client) => run(client.id, () => deleteClient(client.id)),
      },
    );
    return actions;
  }, [canWrite, busy, setDisabled, rotateSecret, deleteClient]);

  return (
    <PageSection
      id="oauth-clients"
      title="Clients"
      description="Every app that connected, registered itself, or was added by an administrator."
      action={
        canWrite ? (
          <Button variant="outlined" startIcon={<AddIcon />} onClick={() => setAdding(true)} sx={{ minHeight: 44, flexShrink: 0 }}>
            Add a client
          </Button>
        ) : undefined
      }
    >
      {clients.error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {clients.error}
        </Alert>
      )}
      <IdentityTable<OAuthClientView>
        tableId={OAUTH_CLIENTS_TABLE_ID}
        data-testid="admin-oauth-clients-table"
        ariaLabel="OAuth clients"
        density="standard"
        columns={columns}
        rows={clients.clients}
        rowId={(client) => client.id}
        loading={clients.isLoading}
        emptyState={
          <Typography variant="body2" color="text.secondary">
            No clients yet.
          </Typography>
        }
        pagination={{
          page: clients.page - 1,
          pageSize: clients.pageSize,
          total: clients.total,
          onPaginationChange: ({ page, pageSize }) => clients.setPagination({ page: page + 1, pageSize }),
          pageSizeOptions: [10, 20, 50, 100],
        }}
        quickSearch={{ value: clients.search, onChange: clients.setSearch, placeholder: 'Search by name or host', ariaLabel: 'Search clients' }}
        rowActions={rowActions}
      />

      <AddOAuthClientDialog
        open={adding}
        onClose={() => setAdding(false)}
        onCreate={async (input) => {
          const created = await clients.createClient(input);
          setAdding(false);
          setSecret(created);
        }}
      />
      <OAuthClientSecretDialog client={secret} onClose={() => setSecret(null)} />
      <Drawer
        anchor="right"
        open={details !== null}
        onClose={() => setDetails(null)}
        slotProps={{ paper: { sx: { width: { xs: '100%', sm: 420 } } } }}
      >
        {details && (
          <Box sx={{ p: 2 }} role="region" aria-labelledby="oauth-client-details-title">
            <Stack sx={{ alignItems: 'center', justifyContent: 'space-between' }} direction="row">
              <Typography id="oauth-client-details-title" variant="h6" component="h2" sx={{ overflowWrap: 'anywhere' }}>
                {details.name}
              </Typography>
              <IconButton aria-label="Close details" onClick={() => setDetails(null)} sx={{ width: 44, height: 44 }}>
                <CloseIcon />
              </IconButton>
            </Stack>
            <Stack spacing={2} sx={{ mt: 2 }}>
              <CopyField label="Client id" value={details.clientId} />
              <Typography variant="body2">
                Host: <strong>{details.host}</strong>
              </Typography>
              <Typography variant="body2">Kind: {KIND_LABELS[details.kind]}</Typography>
              <Typography variant="body2">
                Type: {details.tokenEndpointAuthMethod === 'none' ? 'Public (no secret)' : 'Confidential (has a secret)'}
              </Typography>
              <Box>
                <Typography variant="subtitle2" component="h3">
                  Redirect URIs
                </Typography>
                <List dense disablePadding>
                  {details.redirectUris.map((uri) => (
                    <ListItem key={uri} disableGutters>
                      <ListItemText primary={uri} slotProps={{ primary: { sx: { overflowWrap: 'anywhere', fontFamily: 'monospace' } } }} />
                    </ListItem>
                  ))}
                </List>
              </Box>
            </Stack>
          </Box>
        )}
      </Drawer>
    </PageSection>
  );
}

type LifetimeField = keyof typeof OAUTH_SERVER_SETTING_BOUNDS;

const LIFETIME_FIELDS: { field: LifetimeField; label: string; help: string }[] = [
  { field: 'accessTokenTtlMinutes', label: 'Access token life (minutes)', help: '5 to 1440.' },
  { field: 'refreshTokenTtlDays', label: 'Stay connected for (days)', help: 'Restarts each time the app refreshes. 1 to 365.' },
  { field: 'refreshTokenMaxAgeDays', label: 'Reconnect at least every (days)', help: '0 means never. Up to 3650.' },
  { field: 'dynamicClientUnusedDays', label: 'Delete unused self-registered apps after (days)', help: '1 to 90.' },
];

function LifetimesSection({ state, canWrite }: { state: UseOAuthServerSettingsReturn; canWrite: boolean }): ReactElement | null {
  const { settings, isSaving, update } = state;
  const [draft, setDraft] = useState<Partial<Record<LifetimeField, string>>>({});
  const [saved, setSaved] = useState(false);
  if (!settings) return null;

  const valueOf = (field: LifetimeField) => draft[field] ?? String(settings[field]);
  const problemOf = (field: LifetimeField): string | null => {
    const raw = valueOf(field);
    const { min, max } = OAUTH_SERVER_SETTING_BOUNDS[field];
    if (!/^\d+$/.test(raw)) return 'Enter a whole number.';
    const value = Number(raw);
    if (value < min || value > max) return `Enter ${min} to ${max}.`;
    return null;
  };
  const dirty = LIFETIME_FIELDS.some(({ field }) => draft[field] !== undefined && draft[field] !== String(settings[field]));
  const invalid = LIFETIME_FIELDS.some(({ field }) => problemOf(field) !== null);

  return (
    <PageSection id="oauth-lifetimes" title="Token lifetimes" description="How long a connection lasts before the app must refresh or reconnect.">
      <Stack spacing={2}>
        {LIFETIME_FIELDS.map(({ field, label, help }) =>
          canWrite ? (
            <TextField
              key={field}
              label={label}
              value={valueOf(field)}
              onChange={(event) => {
                setSaved(false);
                setDraft((current) => ({ ...current, [field]: event.target.value.trim() }));
              }}
              error={problemOf(field) !== null}
              helperText={problemOf(field) ?? help}
              slotProps={{ htmlInput: { inputMode: 'numeric', pattern: '[0-9]*' } }}
              sx={{ maxWidth: 360 }}
            />
          ) : (
            <Typography key={field} variant="body2">
              {label}: <strong>{settings[field]}</strong>
            </Typography>
          ),
        )}
        <SettingSwitch
          label="Always issue a refresh token"
          help="Some apps never ask to stay connected, and would have to reconnect every hour without it."
          checked={settings.alwaysIssueRefreshToken}
          canWrite={canWrite}
          disabled={isSaving}
          onChange={(alwaysIssueRefreshToken) => void update({ alwaysIssueRefreshToken }).catch(() => undefined)}
        />
        {canWrite && (
          <Box>
            <Button
              variant="contained"
              disabled={!dirty || invalid || isSaving}
              sx={{ minHeight: 44 }}
              onClick={() => {
                const patch: Partial<OAuthServerSettings> = {};
                for (const { field } of LIFETIME_FIELDS) patch[field] = Number(valueOf(field));
                void update(patch)
                  .then(() => {
                    setDraft({});
                    setSaved(true);
                  })
                  .catch(() => undefined);
              }}
            >
              Save lifetimes
            </Button>
            {saved && (
              <Typography variant="caption" color="text.secondary" sx={{ ml: 2 }} role="status">
                Saved.
              </Typography>
            )}
          </Box>
        )}
      </Stack>
    </PageSection>
  );
}
