// =============================================================================
// AlertRuleDialog (issue #1047): create, edit or view one alert rule
// =============================================================================
//
// Kind first (fixed once the rule exists), then the kind's own form:
//   metric_threshold: metric (from the telemetry store's table list, or typed),
//                     aggregation, window, comparator, threshold, group-by
//                     attributes and attribute filters;
//   node_event:       event types (NODE_EVENT_TYPES, or a `prefix.*`), least
//                     severity, node ids, required attributes, recovery events
//                     and the auto-resolve delay;
//   verdict:          the least dashboard verdict level;
//   node_offline, telemetry_unavailable: nothing to configure;
//   any other kind:   its config as JSON.
// Then the common fields: severity, `for`, cooldown, notification channels and
// the webhook toggle. "Test" evaluates the SAVED rule now and shows what it
// observed. The draft is checked against the contract before sending; the API
// validates again and decides.
// =============================================================================

import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControl,
  FormControlLabel,
  FormGroup,
  FormHelperText,
  FormLabel,
  IconButton,
  MenuItem,
  Stack,
  Switch,
  TextField,
  Typography,
  useMediaQuery,
  useTheme,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlined';
import { useEffect, useMemo, useState, type ReactElement } from 'react';

import {
  ALERT_AGGREGATIONS,
  ALERT_COMPARATORS,
  ALERT_FILTERS_MAX,
  ALERT_GROUP_BY_MAX,
  ALERT_KIND_IDS,
  ALERT_SEVERITIES,
} from '@marinoscar/platform-contract/alerts';
import type { AlertKind, AlertRule, AlertRuleTestResponse, CreateAlertRule, UpdateAlertRule } from '@marinoscar/platform-contract/alerts';
import { NODE_EVENT_SEVERITIES, NODE_EVENT_TYPES } from '@marinoscar/platform-contract/nodes';
import { PLATFORM_NOTIFICATION_CHANNEL_IDS } from '@marinoscar/platform-contract/notifications';

import {
  ALERT_AGGREGATION_LABELS,
  ALERT_COMPARATOR_LABELS,
  ALERT_FORM_KINDS,
  ALERT_SEVERITY_LABELS,
  alertKindHasNoConfig,
  alertKindLabel,
  alertRuleDraftFromRule,
  buildAlertRulePayload,
  emptyAlertRuleDraft,
  formatAlertSeconds,
  type AlertAttrDraft,
  type AlertMetricCatalogEntry,
  type AlertRuleDraft,
  type MetricThresholdDraft,
  type NodeEventDraft,
} from '../headless/index.js';
import { AlertRuleTestResult } from './AlertRuleTestResult.js';

/** The node event types the picker offers, then the two prefixes. */
const EVENT_TYPE_OPTIONS: readonly string[] = [...Object.values(NODE_EVENT_TYPES), 'power.*', 'node.*'];

const CHANNEL_LABELS: Readonly<Record<string, string>> = { email: 'Email', browser: 'In-app', push: 'Push' };

/**
 * Props of {@link AlertRuleDialog}.
 *
 * @stability experimental
 */
export interface AlertRuleDialogProps {
  /** Whether the dialog is open. */
  open: boolean;
  /** The rule to edit or view; `null` creates one. */
  rule: AlertRule | null;
  /** The registered kinds (`useAlertKinds`); empty falls back to the built-in ones. */
  kinds: readonly AlertKind[];
  /** The metric picker's options (`useAlertMetricCatalog`). */
  metrics?: readonly AlertMetricCatalogEntry[];
  /** Why the metric list is unavailable; the picker still takes a typed name. */
  metricsError?: string | null;
  /** The notification channel ids offered; default `email`, `browser`, `push`. */
  channels?: readonly string[];
  /** Draw every field disabled and no Save (a viewer without `alerts:write`). */
  readOnly?: boolean;
  /** Whether a save is in flight. */
  saving?: boolean;
  /** The API's refusal of the last save, in words. */
  error?: string | null;
  /** Called with the body: a `CreateAlertRule` when `rule` is null, else an `UpdateAlertRule`. */
  onSubmit: (body: CreateAlertRule | UpdateAlertRule) => void;
  /** Runs the saved rule's dry run; omitted, no Test button. */
  onTest?: () => Promise<AlertRuleTestResponse | null>;
  /** Asks to delete the rule; omitted (a new or built-in rule, or a read-only viewer), no Delete button. */
  onDelete?: () => void;
  /** Closes the dialog. */
  onClose: () => void;
}

function numberOf(text: string): number {
  return text.trim() === '' ? Number.NaN : Number(text);
}

function SecondsField({
  label,
  value,
  onChange,
  error,
  disabled,
  helper,
}: {
  label: string;
  value: number;
  onChange: (next: number) => void;
  error?: string | undefined;
  disabled: boolean;
  helper?: string;
}): ReactElement {
  return (
    <TextField
      label={label}
      type="number"
      value={Number.isFinite(value) ? value : ''}
      onChange={(event) => onChange(numberOf(event.target.value))}
      error={Boolean(error)}
      helperText={error ?? `${helper ? `${helper} ` : ''}${Number.isFinite(value) ? `(${formatAlertSeconds(value)})` : ''}`}
      disabled={disabled}
      slotProps={{ htmlInput: { min: 0, step: 1 } }}
      fullWidth
    />
  );
}

function AttrsEditor({
  label,
  attrs,
  onChange,
  disabled,
  error,
}: {
  label: string;
  attrs: AlertAttrDraft[];
  onChange: (next: AlertAttrDraft[]) => void;
  disabled: boolean;
  error?: string | undefined;
}): ReactElement {
  return (
    <FormControl component="fieldset" error={Boolean(error)} fullWidth>
      <FormLabel component="legend">{label}</FormLabel>
      <Stack spacing={1} sx={{ mt: 1 }}>
        {attrs.map((attr, index) => (
          <Stack key={index} direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ alignItems: { sm: 'center' } }}>
            <TextField
              label="Attribute"
              size="small"
              value={attr.key}
              disabled={disabled}
              onChange={(event) => onChange(attrs.map((a, i) => (i === index ? { ...a, key: event.target.value } : a)))}
            />
            <TextField
              label="Value"
              size="small"
              value={attr.value}
              disabled={disabled}
              onChange={(event) => onChange(attrs.map((a, i) => (i === index ? { ...a, value: event.target.value } : a)))}
            />
            {disabled ? null : (
              <IconButton aria-label={`Remove attribute ${index + 1}`} onClick={() => onChange(attrs.filter((_, i) => i !== index))}>
                <DeleteOutlineIcon />
              </IconButton>
            )}
          </Stack>
        ))}
        {disabled || attrs.length >= 5 ? null : (
          <Box>
            <Button size="small" startIcon={<AddIcon />} onClick={() => onChange([...attrs, { key: '', value: '' }])}>
              Add attribute
            </Button>
          </Box>
        )}
      </Stack>
      {error ? <FormHelperText>{error}</FormHelperText> : null}
    </FormControl>
  );
}

function MetricThresholdFields({
  value,
  onChange,
  metrics,
  metricsError,
  errors,
  disabled,
}: {
  value: MetricThresholdDraft;
  onChange: (next: MetricThresholdDraft) => void;
  metrics: readonly AlertMetricCatalogEntry[];
  metricsError: string | null;
  errors: Record<string, string>;
  disabled: boolean;
}): ReactElement {
  const metricNames = useMemo(() => metrics.map((metric) => metric.name), [metrics]);
  const attributes = useMemo(() => {
    const table = value.metric.replace(/\./g, '_');
    const entry = metrics.find((metric) => metric.name === value.metric || metric.name.startsWith(table));
    return entry?.attributes ?? [];
  }, [metrics, value.metric]);
  return (
    <Stack spacing={2}>
      <Autocomplete
        freeSolo
        options={metricNames}
        value={value.metric}
        disabled={disabled}
        onInputChange={(_, next) => onChange({ ...value, metric: next })}
        renderInput={(params) => (
          <TextField
            {...params}
            label="Metric"
            required
            error={Boolean(errors['metric'])}
            helperText={errors['metric'] ?? metricsError ?? 'A metric name (app.jobs.settled) or a table of the telemetry store.'}
          />
        )}
      />
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
        <TextField
          select
          label="Aggregation"
          value={value.aggregation}
          disabled={disabled}
          onChange={(event) => onChange({ ...value, aggregation: event.target.value as MetricThresholdDraft['aggregation'] })}
          fullWidth
        >
          {ALERT_AGGREGATIONS.map((aggregation) => (
            <MenuItem key={aggregation} value={aggregation}>
              {ALERT_AGGREGATION_LABELS[aggregation]}
            </MenuItem>
          ))}
        </TextField>
        <SecondsField
          label="Window (seconds)"
          value={value.windowSeconds}
          onChange={(windowSeconds) => onChange({ ...value, windowSeconds })}
          error={errors['windowSeconds']}
          disabled={disabled}
        />
      </Stack>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
        <TextField
          select
          label="Comparator"
          value={value.comparator}
          disabled={disabled}
          onChange={(event) => onChange({ ...value, comparator: event.target.value as MetricThresholdDraft['comparator'] })}
          fullWidth
        >
          {ALERT_COMPARATORS.map((comparator) => (
            <MenuItem key={comparator} value={comparator}>
              {ALERT_COMPARATOR_LABELS[comparator]}
            </MenuItem>
          ))}
        </TextField>
        <TextField
          label="Threshold"
          type="number"
          required
          value={value.threshold}
          disabled={disabled}
          onChange={(event) => onChange({ ...value, threshold: event.target.value })}
          error={Boolean(errors['threshold'])}
          helperText={errors['threshold'] ?? ' '}
          fullWidth
        />
      </Stack>
      <Autocomplete
        multiple
        freeSolo
        options={attributes}
        value={value.groupBy}
        disabled={disabled}
        onChange={(_, next) => onChange({ ...value, groupBy: (next as string[]).slice(0, ALERT_GROUP_BY_MAX) })}
        renderInput={(params) => (
          <TextField
            {...params}
            label="Group by"
            error={Boolean(errors['groupBy'])}
            helperText={errors['groupBy'] ?? `Up to ${ALERT_GROUP_BY_MAX} attributes; one incident per value.`}
          />
        )}
      />
      <FormControl component="fieldset" error={Boolean(errors['filters'])} fullWidth>
        <FormLabel component="legend">Filters</FormLabel>
        <Stack spacing={1} sx={{ mt: 1 }}>
          {value.filters.map((filter, index) => (
            <Stack key={index} direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ alignItems: { sm: 'center' } }}>
              <TextField
                label="Attribute"
                size="small"
                value={filter.attr}
                disabled={disabled}
                onChange={(event) =>
                  onChange({ ...value, filters: value.filters.map((f, i) => (i === index ? { ...f, attr: event.target.value } : f)) })
                }
              />
              <TextField
                select
                label="Operator"
                size="small"
                value={filter.op}
                disabled={disabled}
                onChange={(event) =>
                  onChange({
                    ...value,
                    filters: value.filters.map((f, i) => (i === index ? { ...f, op: event.target.value === 'neq' ? 'neq' : 'eq' } : f)),
                  })
                }
                sx={{ minWidth: 120 }}
              >
                <MenuItem value="eq">equals</MenuItem>
                <MenuItem value="neq">does not equal</MenuItem>
              </TextField>
              <TextField
                label="Value"
                size="small"
                value={filter.value}
                disabled={disabled}
                onChange={(event) =>
                  onChange({ ...value, filters: value.filters.map((f, i) => (i === index ? { ...f, value: event.target.value } : f)) })
                }
              />
              {disabled ? null : (
                <IconButton
                  aria-label={`Remove filter ${index + 1}`}
                  onClick={() => onChange({ ...value, filters: value.filters.filter((_, i) => i !== index) })}
                >
                  <DeleteOutlineIcon />
                </IconButton>
              )}
            </Stack>
          ))}
          {disabled || value.filters.length >= ALERT_FILTERS_MAX ? null : (
            <Box>
              <Button
                size="small"
                startIcon={<AddIcon />}
                onClick={() => onChange({ ...value, filters: [...value.filters, { attr: '', op: 'eq', value: '' }] })}
              >
                Add filter
              </Button>
            </Box>
          )}
        </Stack>
        {errors['filters'] ? <FormHelperText>{errors['filters']}</FormHelperText> : null}
      </FormControl>
    </Stack>
  );
}

function EventTypesField({
  label,
  value,
  onChange,
  disabled,
  error,
  helper,
  required,
}: {
  label: string;
  value: string[];
  onChange: (next: string[]) => void;
  disabled: boolean;
  error?: string | undefined;
  helper: string;
  required?: boolean;
}): ReactElement {
  return (
    <Autocomplete
      multiple
      freeSolo
      options={EVENT_TYPE_OPTIONS as string[]}
      value={value}
      disabled={disabled}
      onChange={(_, next) => onChange(next as string[])}
      renderInput={(params) => (
        <TextField {...params} label={label} required={required ?? false} error={Boolean(error)} helperText={error ?? helper} />
      )}
    />
  );
}

function NodeEventFields({
  value,
  onChange,
  errors,
  disabled,
}: {
  value: NodeEventDraft;
  onChange: (next: NodeEventDraft) => void;
  errors: Record<string, string>;
  disabled: boolean;
}): ReactElement {
  return (
    <Stack spacing={2}>
      <EventTypesField
        label="Event types"
        required
        value={value.eventTypes}
        onChange={(eventTypes) => onChange({ ...value, eventTypes })}
        disabled={disabled}
        error={errors['eventTypes']}
        helper="The node events that raise the alert; a prefix such as power.* matches every power event."
      />
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
        <TextField
          select
          label="Least severity"
          value={value.minSeverity}
          disabled={disabled}
          onChange={(event) => onChange({ ...value, minSeverity: event.target.value as NodeEventDraft['minSeverity'] })}
          fullWidth
        >
          <MenuItem value="">Any severity</MenuItem>
          {NODE_EVENT_SEVERITIES.map((severity) => (
            <MenuItem key={severity} value={severity}>
              {ALERT_SEVERITY_LABELS[severity]}
            </MenuItem>
          ))}
        </TextField>
        <SecondsField
          label="Resolve after (seconds)"
          value={value.resolveAfterSeconds}
          onChange={(resolveAfterSeconds) => onChange({ ...value, resolveAfterSeconds })}
          error={errors['resolveAfterSeconds']}
          disabled={disabled}
          helper="Without a recovery event."
        />
      </Stack>
      <Autocomplete
        multiple
        freeSolo
        options={[] as string[]}
        value={value.nodeIds}
        disabled={disabled}
        onChange={(_, next) => onChange({ ...value, nodeIds: next as string[] })}
        renderInput={(params) => (
          <TextField
            {...params}
            label="Only these nodes"
            error={Boolean(errors['nodeIds'])}
            helperText={errors['nodeIds'] ?? 'Node ids; leave empty for every node. Press Enter after each.'}
          />
        )}
      />
      <AttrsEditor
        label="The event must carry"
        attrs={value.attrs}
        onChange={(attrs) => onChange({ ...value, attrs })}
        disabled={disabled}
        error={errors['attrs']}
      />
      <Divider />
      <EventTypesField
        label="Recovery event types"
        value={value.recoveryEventTypes}
        onChange={(recoveryEventTypes) => onChange({ ...value, recoveryEventTypes })}
        disabled={disabled}
        error={errors['recovery']}
        helper="Events that resolve the incident early; leave empty to resolve only after the delay."
      />
      {value.recoveryEventTypes.length > 0 ? (
        <AttrsEditor
          label="The recovery event must carry"
          attrs={value.recoveryAttrs}
          onChange={(recoveryAttrs) => onChange({ ...value, recoveryAttrs })}
          disabled={disabled}
        />
      ) : null}
    </Stack>
  );
}

/**
 * The create, edit and view dialog of one alert rule.
 *
 * @param props - see {@link AlertRuleDialogProps}.
 * @returns the dialog.
 *
 * @extensionPoint component
 * @stability experimental
 */
export function AlertRuleDialog({
  open,
  rule,
  kinds,
  metrics = [],
  metricsError = null,
  channels = PLATFORM_NOTIFICATION_CHANNEL_IDS,
  readOnly = false,
  saving = false,
  error = null,
  onSubmit,
  onTest,
  onDelete,
  onClose,
}: AlertRuleDialogProps): ReactElement {
  const theme = useTheme();
  const fullScreen = useMediaQuery(theme.breakpoints.down('sm'));
  const [draft, setDraft] = useState<AlertRuleDraft>(() => (rule ? alertRuleDraftFromRule(rule) : emptyAlertRuleDraft()));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [testResult, setTestResult] = useState<AlertRuleTestResponse | null>(null);
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    if (!open) return;
    setDraft(rule ? alertRuleDraftFromRule(rule) : emptyAlertRuleDraft());
    setErrors({});
    setTestResult(null);
  }, [open, rule]);

  const kindOptions = useMemo(() => {
    const ids = kinds.length > 0 ? kinds.map((kind) => kind.id) : [...ALERT_FORM_KINDS];
    if (rule && !ids.includes(rule.kind)) ids.push(rule.kind);
    return ids;
  }, [kinds, rule]);
  const kindDescription = kinds.find((kind) => kind.id === draft.kind)?.description;
  const channelOptions = useMemo(() => [...new Set([...channels, ...draft.notifyChannels])], [channels, draft.notifyChannels]);

  const disabled = readOnly || saving;
  const set = (patch: Partial<AlertRuleDraft>) => setDraft((current) => ({ ...current, ...patch }));

  const submit = () => {
    const result = rule ? buildAlertRulePayload(draft, 'update') : buildAlertRulePayload(draft, 'create');
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    setErrors({});
    onSubmit(result.value);
  };

  const runTest = async () => {
    if (!onTest) return;
    setTesting(true);
    try {
      setTestResult(await onTest());
    } finally {
      setTesting(false);
    }
  };

  const title = rule ? (readOnly ? rule.name : `Edit ${rule.name}`) : 'New alert rule';

  return (
    <Dialog open={open} onClose={onClose} fullScreen={fullScreen} maxWidth="md" fullWidth aria-labelledby="alert-rule-dialog-title">
      <DialogTitle id="alert-rule-dialog-title">{title}</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2}>
          {error ? <Alert severity="error">{error}</Alert> : null}
          {rule?.starter ? (
            <Alert severity="info">
              This is a built-in rule. You can edit, enable and disable it; it cannot be deleted.
            </Alert>
          ) : null}
          <TextField
            label="Name"
            required
            value={draft.name}
            disabled={disabled}
            onChange={(event) => set({ name: event.target.value })}
            error={Boolean(errors['name'])}
            helperText={errors['name'] ?? ' '}
            fullWidth
          />
          <TextField
            label="Description"
            value={draft.description}
            disabled={disabled}
            onChange={(event) => set({ description: event.target.value })}
            multiline
            minRows={2}
            fullWidth
          />
          <TextField
            select
            label="Kind"
            value={draft.kind}
            disabled={disabled || rule !== null}
            onChange={(event) => {
              const kind = event.target.value;
              setDraft((current) => ({ ...emptyAlertRuleDraft(kind), name: current.name, description: current.description }));
              setErrors({});
            }}
            helperText={rule ? 'The kind of an existing rule cannot change.' : (kindDescription ?? ' ')}
            fullWidth
          >
            {kindOptions.map((id) => (
              <MenuItem key={id} value={id}>
                {alertKindLabel(id, kinds)}
              </MenuItem>
            ))}
          </TextField>

          <Typography variant="subtitle2" component="h3">
            Condition
          </Typography>
          {draft.kind === ALERT_KIND_IDS.METRIC_THRESHOLD ? (
            <MetricThresholdFields
              value={draft.metric}
              onChange={(metric) => set({ metric })}
              metrics={metrics}
              metricsError={metricsError}
              errors={errors}
              disabled={disabled}
            />
          ) : draft.kind === ALERT_KIND_IDS.NODE_EVENT ? (
            <NodeEventFields value={draft.nodeEvent} onChange={(nodeEvent) => set({ nodeEvent })} errors={errors} disabled={disabled} />
          ) : draft.kind === ALERT_KIND_IDS.VERDICT ? (
            <TextField
              select
              label="Least verdict level"
              value={draft.verdict.minLevel}
              disabled={disabled}
              onChange={(event) => set({ verdict: { minLevel: event.target.value === 'degraded' ? 'degraded' : 'critical' } })}
              helperText="Fires when the telemetry dashboard verdict is at this level or worse."
              fullWidth
            >
              <MenuItem value="degraded">Degraded</MenuItem>
              <MenuItem value="critical">Critical</MenuItem>
            </TextField>
          ) : alertKindHasNoConfig(draft.kind) ? (
            <Typography variant="body2" color="text.secondary">
              This kind has nothing to configure.
            </Typography>
          ) : (
            <TextField
              label="Configuration (JSON)"
              value={draft.rawConfig}
              disabled={disabled}
              onChange={(event) => set({ rawConfig: event.target.value })}
              error={Boolean(errors['config'])}
              helperText={errors['config'] ?? 'Validated by the API against the kind’s schema.'}
              multiline
              minRows={4}
              fullWidth
              slotProps={{ htmlInput: { spellCheck: false, style: { fontFamily: 'monospace' } } }}
            />
          )}
          {errors['config'] && ALERT_FORM_KINDS.includes(draft.kind) ? <Alert severity="error">{errors['config']}</Alert> : null}

          <Typography variant="subtitle2" component="h3">
            Firing and notifications
          </Typography>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            <TextField
              select
              label="Severity"
              value={draft.severity}
              disabled={disabled}
              onChange={(event) => set({ severity: event.target.value as AlertRuleDraft['severity'] })}
              fullWidth
            >
              {ALERT_SEVERITIES.map((severity) => (
                <MenuItem key={severity} value={severity}>
                  {ALERT_SEVERITY_LABELS[severity]}
                </MenuItem>
              ))}
            </TextField>
            <SecondsField
              label="For (seconds)"
              value={draft.forSeconds}
              onChange={(forSeconds) => set({ forSeconds })}
              error={errors['forSeconds']}
              disabled={disabled}
              helper="How long the condition must hold."
            />
            <SecondsField
              label="Cooldown (seconds)"
              value={draft.cooldownSeconds}
              onChange={(cooldownSeconds) => set({ cooldownSeconds })}
              error={errors['cooldownSeconds']}
              disabled={disabled}
              helper="Quiet time before firing again."
            />
          </Stack>
          <FormControl component="fieldset" error={Boolean(errors['notifyChannels'])}>
            <FormLabel component="legend">Notification channels</FormLabel>
            <FormGroup row>
              {channelOptions.map((channel) => (
                <FormControlLabel
                  key={channel}
                  label={CHANNEL_LABELS[channel] ?? channel}
                  control={
                    <Checkbox
                      checked={draft.notifyChannels.includes(channel)}
                      disabled={disabled}
                      onChange={(event) =>
                        set({
                          notifyChannels: event.target.checked
                            ? [...draft.notifyChannels, channel]
                            : draft.notifyChannels.filter((id) => id !== channel),
                        })
                      }
                    />
                  }
                />
              ))}
            </FormGroup>
            <FormHelperText>
              {errors['notifyChannels'] ?? 'None checked: every channel the recipients have turned on for alerts.'}
            </FormHelperText>
          </FormControl>
          <FormControlLabel
            control={<Switch checked={draft.webhook} disabled={disabled} onChange={(event) => set({ webhook: event.target.checked })} />}
            label="Also send alerts.alert.fired and alerts.alert.resolved webhooks"
          />
          <FormControlLabel
            control={<Switch checked={draft.enabled} disabled={disabled} onChange={(event) => set({ enabled: event.target.checked })} />}
            label="Enabled"
          />

          {rule && onTest ? (
            <Box>
              <Divider sx={{ mb: 2 }} />
              <Stack direction="row" spacing={2} sx={{ mb: 1, alignItems: 'center' }}>
                <Button variant="outlined" onClick={() => void runTest()} disabled={testing} sx={{ minHeight: 44 }}>
                  {testing ? 'Testing…' : 'Test'}
                </Button>
                <Typography variant="body2" color="text.secondary">
                  Evaluates the saved rule now. Save your changes first to test them.
                </Typography>
              </Stack>
              {testResult ? <AlertRuleTestResult result={testResult} /> : null}
            </Box>
          ) : null}
        </Stack>
      </DialogContent>
      <DialogActions>
        {onDelete && rule && !rule.starter && !readOnly ? (
          <Button color="error" startIcon={<DeleteOutlineIcon />} onClick={onDelete} disabled={saving} sx={{ minHeight: 44, mr: 'auto' }}>
            Delete
          </Button>
        ) : null}
        <Button onClick={onClose} sx={{ minHeight: 44 }}>
          {readOnly ? 'Close' : 'Cancel'}
        </Button>
        {readOnly ? null : (
          <Button variant="contained" onClick={submit} disabled={saving} sx={{ minHeight: 44 }}>
            {rule ? 'Save' : 'Create rule'}
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
}
