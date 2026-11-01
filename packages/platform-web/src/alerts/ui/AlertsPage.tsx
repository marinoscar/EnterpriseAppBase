// =============================================================================
// AlertsPage (issue #1047): the rules and the incidents they raised
// =============================================================================
//
// One destination (`/admin/settings/alerts`, `alerts:read`) with two tabs of
// PARALLEL content: Rules (the list with the enable switch, the editor, the
// dry-run "Test") and Incidents (filters, the table, the detail drawer,
// Acknowledge). The tab is kept in the URL (`?tab=incidents`) so the firing
// banner can link straight to it. Write controls are drawn only for a viewer
// holding `alerts:write`; the API enforces it either way. A built-in (starter)
// rule shows "Built-in" and has no Delete.
// =============================================================================

import AddIcon from '@mui/icons-material/Add';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import PlayArrowOutlinedIcon from '@mui/icons-material/PlayArrowOutlined';
import VisibilityOutlinedIcon from '@mui/icons-material/VisibilityOutlined';
import DoneIcon from '@mui/icons-material/Done';
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
  DialogTitle,
  Link,
  MenuItem,
  Stack,
  Switch,
  Tab,
  Tabs,
  TextField,
  Typography,
} from '@mui/material';
import { useCallback, useMemo, useState, type ReactElement } from 'react';
import { useSearchParams } from 'react-router-dom';

import { ALERT_INCIDENT_STATES, ALERT_PAGE_SIZE_DEFAULT, ALERT_PERMISSIONS, ALERT_SEVERITIES } from '@marinoscar/platform-contract/alerts';
import type {
  AlertIncident,
  AlertIncidentState,
  AlertRule,
  AlertRuleTestResponse,
  AlertSeverity,
  CreateAlertRule,
  UpdateAlertRule,
} from '@marinoscar/platform-contract/alerts';

import { PageSlotsFrame, useDisplayTimeZone, usePlatformViewer } from '../../core/index.js';
import type { PageSlotsBase } from '../../core/index.js';
import { DataTable, type DataTableColumn, type DataTableRowAction } from '../../datatable/index.js';
import {
  ALERT_SEVERITY_LABELS,
  ALERT_STATE_LABELS,
  alertKindLabel,
  formatAlertLabels,
  useAlertIncidents,
  useAlertKinds,
  useAlertMetricCatalog,
  useAlertMutations,
  useAlertRules,
} from '../headless/index.js';
import { AlertIncidentDrawer } from './AlertIncidentDrawer.js';
import { AlertRuleDialog } from './AlertRuleDialog.js';
import { AlertRuleTestResult } from './AlertRuleTestResult.js';
import { ALERTS_PAGE_COPY } from './copy.js';
import { ConfirmDialog, SeverityChip, StateChip, when } from './parts.js';

/**
 * The slots of {@link AlertsPage}: the page-slot contract.
 *
 * @example
 * ```tsx
 * <AlertsPage slots={{ BeforeContent: OnCallNotice }} />
 * ```
 *
 * @extensionPoint slot
 * @stability experimental
 */
export type AlertsPageSlots = PageSlotsBase;

/**
 * Props of {@link AlertsPage}.
 *
 * @stability experimental
 */
export interface AlertsPageProps {
  /** Optional extension slots; omitted, the page renders exactly its own markup. */
  slots?: AlertsPageSlots;
  /** The notification channel ids the rule editor offers; default `email`, `browser`, `push`. */
  channels?: readonly string[];
}

type AlertsTab = 'rules' | 'incidents';

function RulesTab({ canWrite, channels }: { canWrite: boolean; channels: readonly string[] | undefined }): ReactElement {
  const { rules, isLoading, error, refresh } = useAlertRules();
  const { kinds } = useAlertKinds();
  const mutations = useAlertMutations();
  const [editing, setEditing] = useState<AlertRule | 'new' | null>(null);
  const metricsWanted = editing !== null && canWrite;
  const catalog = useAlertMetricCatalog({ enabled: metricsWanted });
  const [deleting, setDeleting] = useState<AlertRule | null>(null);
  const [testing, setTesting] = useState<{ rule: AlertRule; result: AlertRuleTestResponse | null } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const open = useCallback(
    (rule: AlertRule | 'new') => {
      mutations.reset();
      setNotice(null);
      setEditing(rule);
    },
    [mutations],
  );

  const save = async (body: CreateAlertRule | UpdateAlertRule) => {
    if (editing === null) return;
    const saved = editing === 'new' ? await mutations.create(body as CreateAlertRule) : await mutations.update(editing.id, body);
    if (!saved) return;
    setEditing(null);
    setNotice(editing === 'new' ? `Rule “${saved.name}” created.` : `Rule “${saved.name}” saved.`);
    await refresh();
  };

  const toggle = useCallback(
    async (rule: AlertRule, enabled: boolean) => {
      const updated = await mutations.toggle(rule.id, enabled);
      if (updated) await refresh();
    },
    [mutations, refresh],
  );

  const runTest = useCallback(
    async (rule: AlertRule) => {
      setTesting({ rule, result: null });
      const result = await mutations.test(rule.id);
      setTesting(result ? { rule, result } : null);
    },
    [mutations],
  );

  const remove = async () => {
    if (!deleting) return;
    const ok = await mutations.remove(deleting.id);
    const name = deleting.name;
    setDeleting(null);
    if (!ok) return;
    setEditing(null);
    setNotice(`Rule “${name}” deleted.`);
    await refresh();
  };

  const columns = useMemo<DataTableColumn<AlertRule>[]>(
    () => [
      {
        id: 'enabled',
        label: 'Enabled',
        priority: 'primary',
        value: (row) => (row.enabled ? 'On' : 'Off'),
        render: (row) => (
          <Switch
            checked={row.enabled}
            disabled={!canWrite || mutations.pending}
            onChange={(event) => void toggle(row, event.target.checked)}
            slotProps={{ input: { 'aria-label': `${row.enabled ? 'Disable' : 'Enable'} ${row.name}` } }}
          />
        ),
      },
      {
        id: 'name',
        label: 'Name',
        priority: 'primary',
        value: (row) => row.name,
        render: (row) => (
          <Stack direction="row" spacing={1} useFlexGap sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
            <Link component="button" type="button" variant="body2" onClick={() => open(row)} sx={{ textAlign: 'left', fontWeight: 600 }}>
              {row.name}
            </Link>
            {row.starter ? <Chip size="small" variant="outlined" label="Built-in" /> : null}
          </Stack>
        ),
      },
      { id: 'kind', label: 'Kind', priority: 'secondary', value: (row) => alertKindLabel(row.kind, kinds) },
      {
        id: 'severity',
        label: 'Severity',
        priority: 'secondary',
        value: (row) => ALERT_SEVERITY_LABELS[row.severity],
        render: (row) => <SeverityChip severity={row.severity} />,
      },
      { id: 'lastEvaluatedAt', label: 'Last evaluated', priority: 'detail', value: (row) => when(row.lastEvaluatedAt) },
      {
        id: 'lastError',
        label: 'Last error',
        priority: 'detail',
        value: (row) => row.lastError ?? '',
        render: (row) =>
          row.lastError ? (
            <Typography variant="body2" color="error">
              {row.lastError}
            </Typography>
          ) : (
            '—'
          ),
      },
    ],
    [canWrite, kinds, mutations.pending, open, toggle],
  );

  const rowActions = useMemo<DataTableRowAction<AlertRule>[]>(() => {
    const actions: DataTableRowAction<AlertRule>[] = [
      canWrite
        ? { id: 'edit', label: 'Edit rule', icon: <EditOutlinedIcon />, onClick: (row) => open(row) }
        : { id: 'view', label: 'View rule', icon: <VisibilityOutlinedIcon />, onClick: (row) => open(row) },
    ];
    if (canWrite) {
      actions.push({ id: 'test', label: 'Test rule', icon: <PlayArrowOutlinedIcon />, onClick: (row) => void runTest(row) });
    }
    return actions;
  }, [canWrite, open, runTest]);

  return (
    <Stack spacing={2}>
      {error ? <Alert severity="error">{error}</Alert> : null}
      {mutations.error && editing === null ? (
        <Alert severity="error" onClose={mutations.reset}>
          {mutations.error}
        </Alert>
      ) : null}
      {notice ? (
        <Alert severity="success" onClose={() => setNotice(null)}>
          {notice}
        </Alert>
      ) : null}
      {canWrite ? (
        <Box>
          <Button variant="contained" startIcon={<AddIcon />} onClick={() => open('new')} sx={{ minHeight: 44 }}>
            New rule
          </Button>
        </Box>
      ) : null}
      <Card variant="outlined">
        <CardContent>
          <DataTable<AlertRule>
            tableId="alert-rules"
            ariaLabel="Alert rules"
            columns={columns}
            rows={rules}
            rowId={(row) => row.id}
            loading={isLoading}
            rowActions={rowActions}
            emptyState={
              <Typography variant="body2" color="text.secondary" sx={{ p: 2 }}>
                No alert rules yet.{canWrite ? ' Create one to get told when something needs attention.' : ''}
              </Typography>
            }
            disableExport
          />
        </CardContent>
      </Card>

      <AlertRuleDialog
        open={editing !== null}
        rule={editing === 'new' ? null : editing}
        kinds={kinds}
        metrics={catalog.metrics}
        metricsError={metricsWanted ? catalog.error : null}
        {...(channels ? { channels } : {})}
        readOnly={!canWrite}
        saving={mutations.pending}
        error={editing !== null ? mutations.error : null}
        onSubmit={(body) => void save(body)}
        {...(canWrite && editing !== null && editing !== 'new'
          ? { onTest: () => mutations.test(editing.id) }
          : {})}
        {...(canWrite && editing !== null && editing !== 'new' && !editing.starter
          ? { onDelete: () => setDeleting(editing) }
          : {})}
        onClose={() => {
          setEditing(null);
          mutations.reset();
        }}
      />
      <ConfirmDialog
        open={deleting !== null}
        title="Delete this rule?"
        confirmLabel="Delete rule"
        destructive
        busy={mutations.pending}
        onConfirm={() => void remove()}
        onClose={() => setDeleting(null)}
      >
        {deleting ? <strong>{deleting.name}</strong> : 'The rule'} stops being evaluated now, and its incidents are deleted with
        it. This cannot be undone.
      </ConfirmDialog>
      <Dialog open={testing !== null} onClose={() => setTesting(null)} maxWidth="sm" fullWidth aria-labelledby="alert-test-title">
        <DialogTitle id="alert-test-title">Test: {testing?.rule.name}</DialogTitle>
        <DialogContent dividers>
          {testing?.result ? <AlertRuleTestResult result={testing.result} /> : <Typography color="text.secondary">Evaluating…</Typography>}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setTesting(null)} sx={{ minHeight: 44 }}>
            Close
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
}

function IncidentsTab({ canWrite }: { canWrite: boolean }): ReactElement {
  const [state, setState] = useState<AlertIncidentState | ''>('');
  const [severity, setSeverity] = useState<AlertSeverity | ''>('');
  const [paging, setPaging] = useState({ page: 0, pageSize: ALERT_PAGE_SIZE_DEFAULT });
  const { incidents, total, isLoading, error, refresh } = useAlertIncidents({
    ...(state ? { state } : {}),
    ...(severity ? { severity } : {}),
    page: paging.page + 1,
    pageSize: paging.pageSize,
  });
  const mutations = useAlertMutations();
  const [openId, setOpenId] = useState<string | null>(null);

  const acknowledge = useCallback(
    async (incident: AlertIncident) => {
      const updated = await mutations.acknowledge(incident.id);
      if (updated) await refresh();
      return updated;
    },
    [mutations, refresh],
  );

  const columns = useMemo<DataTableColumn<AlertIncident>[]>(
    () => [
      {
        id: 'state',
        label: 'State',
        priority: 'primary',
        value: (row) => ALERT_STATE_LABELS[row.state],
        render: (row) => <StateChip state={row.state} />,
      },
      {
        id: 'rule',
        label: 'Rule',
        priority: 'primary',
        value: (row) => row.ruleName,
        render: (row) => (
          <Link component="button" type="button" variant="body2" onClick={() => setOpenId(row.id)} sx={{ textAlign: 'left', fontWeight: 600 }}>
            {row.ruleName}
          </Link>
        ),
      },
      {
        id: 'severity',
        label: 'Severity',
        priority: 'secondary',
        value: (row) => ALERT_SEVERITY_LABELS[row.severity],
        render: (row) => <SeverityChip severity={row.severity} />,
      },
      { id: 'summary', label: 'Summary', priority: 'secondary', value: (row) => row.summary },
      { id: 'labels', label: 'Labels', priority: 'detail', value: (row) => formatAlertLabels(row.labels) || '—' },
      { id: 'firedAt', label: 'Fired', priority: 'detail', value: (row) => when(row.firedAt ?? row.pendingSince) },
      {
        id: 'acknowledged',
        label: 'Acknowledged',
        priority: 'detail',
        value: (row) => (row.acknowledgedAt ? when(row.acknowledgedAt) : 'No'),
      },
    ],
    [],
  );

  const rowActions = useMemo<DataTableRowAction<AlertIncident>[]>(() => {
    const actions: DataTableRowAction<AlertIncident>[] = [
      { id: 'view', label: 'View incident', icon: <VisibilityOutlinedIcon />, onClick: (row) => setOpenId(row.id) },
    ];
    if (canWrite) {
      actions.push({
        id: 'acknowledge',
        label: 'Acknowledge',
        icon: <DoneIcon />,
        onClick: (row) => void acknowledge(row),
        disabled: (row) => row.acknowledgedAt !== null || row.state === 'resolved',
      });
    }
    return actions;
  }, [acknowledge, canWrite]);

  return (
    <Stack spacing={2}>
      {error ? <Alert severity="error">{error}</Alert> : null}
      {mutations.error ? (
        <Alert severity="error" onClose={mutations.reset}>
          {mutations.error}
        </Alert>
      ) : null}
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
        <TextField
          select
          label="State"
          value={state}
          onChange={(event) => {
            setState(event.target.value as AlertIncidentState | '');
            setPaging((current) => ({ ...current, page: 0 }));
          }}
          sx={{ minWidth: 180 }}
        >
          <MenuItem value="">Any state</MenuItem>
          {ALERT_INCIDENT_STATES.map((value) => (
            <MenuItem key={value} value={value}>
              {ALERT_STATE_LABELS[value]}
            </MenuItem>
          ))}
        </TextField>
        <TextField
          select
          label="Severity"
          value={severity}
          onChange={(event) => {
            setSeverity(event.target.value as AlertSeverity | '');
            setPaging((current) => ({ ...current, page: 0 }));
          }}
          sx={{ minWidth: 180 }}
        >
          <MenuItem value="">Any severity</MenuItem>
          {ALERT_SEVERITIES.map((value) => (
            <MenuItem key={value} value={value}>
              {ALERT_SEVERITY_LABELS[value]}
            </MenuItem>
          ))}
        </TextField>
      </Stack>
      <Card variant="outlined">
        <CardContent>
          <DataTable<AlertIncident>
            tableId="alert-incidents"
            ariaLabel="Alert incidents"
            columns={columns}
            rows={incidents}
            rowId={(row) => row.id}
            loading={isLoading}
            rowActions={rowActions}
            pagination={{
              page: paging.page,
              pageSize: paging.pageSize,
              total,
              onPaginationChange: (next) => setPaging(next),
            }}
            emptyState={
              <Typography variant="body2" color="text.secondary" sx={{ p: 2 }}>
                No incidents match.
              </Typography>
            }
            disableExport
          />
        </CardContent>
      </Card>
      <AlertIncidentDrawer
        incidentId={openId}
        canWrite={canWrite}
        onAcknowledge={acknowledge}
        acknowledging={mutations.pending}
        onClose={() => setOpenId(null)}
      />
    </Stack>
  );
}

/**
 * The Alerts page: the Rules and Incidents tabs.
 *
 * @param props - see {@link AlertsPageProps}.
 * @returns the page.
 *
 * @example
 * ```tsx
 * <Route path="/admin/settings/alerts" element={<AlertsPage />} />
 * ```
 *
 * @extensionPoint component
 * @stability experimental
 */
export function AlertsPage({ slots, channels }: AlertsPageProps = {}): ReactElement {
  useDisplayTimeZone();
  const viewer = usePlatformViewer();
  const canWrite = viewer.hasPermission(ALERT_PERMISSIONS.WRITE);
  const [params, setParams] = useSearchParams();
  const tab: AlertsTab = params.get('tab') === 'incidents' ? 'incidents' : 'rules';
  const setTab = (next: AlertsTab) => {
    const updated = new URLSearchParams(params);
    if (next === 'rules') updated.delete('tab');
    else updated.set('tab', next);
    setParams(updated, { replace: true });
  };

  return (
    <Container maxWidth="lg">
      <Box sx={{ py: { xs: 2, sm: 4 } }}>
        <PageSlotsFrame
          slots={slots}
          headerProps={{ title: ALERTS_PAGE_COPY.title, description: ALERTS_PAGE_COPY.description, readOnly: !canWrite, actions: null }}
          header={
            <>
              <Typography variant="h4" component="h1" gutterBottom>
                {ALERTS_PAGE_COPY.title}
                {canWrite ? null : ' (read-only)'}
              </Typography>
              <Typography color="text.secondary" sx={{ mb: 2 }}>
                {ALERTS_PAGE_COPY.description}
              </Typography>
            </>
          }
        >
          <Tabs
            value={tab}
            onChange={(_, next: AlertsTab) => setTab(next)}
            aria-label="Alerts sections"
            variant="scrollable"
            allowScrollButtonsMobile
            sx={{ mb: 2, borderBottom: 1, borderColor: 'divider' }}
          >
            <Tab value="rules" label="Rules" id="alerts-tab-rules" aria-controls="alerts-panel-rules" sx={{ minHeight: 48 }} />
            <Tab value="incidents" label="Incidents" id="alerts-tab-incidents" aria-controls="alerts-panel-incidents" sx={{ minHeight: 48 }} />
          </Tabs>
          <Box role="tabpanel" id={`alerts-panel-${tab}`} aria-labelledby={`alerts-tab-${tab}`}>
            {tab === 'rules' ? <RulesTab canWrite={canWrite} channels={channels} /> : <IncidentsTab canWrite={canWrite} />}
          </Box>
        </PageSlotsFrame>
      </Box>
    </Container>
  );
}
