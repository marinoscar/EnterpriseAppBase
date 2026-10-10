/**
 * Admin → Settings → Storage (`/admin/settings/storage`).
 *
 * Issue #376, epic #372. A STANDALONE PAGE, exactly like `EmailSettingsPage`
 * and `PushConfigPage` and for the same reason: it hits its own controller
 * (`/api/admin/storage-config`) with its own document and its own permission
 * pair, not the generic `system_settings` blob the `SettingsHub` pages share.
 * One entry in `ADMIN_SECTIONS` (`config/adminSections.tsx`), one route in
 * `App.tsx` gated on the same `storage_config:read` string, no tab anywhere —
 * `CLAUDE.md`'s "MANDATORY: Settings UI Pattern" rules 1–3.
 *
 * =============================================================================
 * SNACKBAR vs. ALERT, AND THE RULE THAT DECIDES
 * =============================================================================
 *
 * `EmailSettingsPage`'s header argues this explicitly and it holds here twice
 * over. A SAVE is the ordinary, expected outcome and says nothing an admin has
 * to read twice — `Snackbar`. Anything they must actually READ is a persistent,
 * dismissible `Alert`: a failed check, the provider's verbatim error string,
 * and above all the `guided` command block, which is a multi-line shell
 * snippet nobody can copy out of a toast that slides away in five seconds.
 *
 * =============================================================================
 * THE PAGE OWNS THE STATE AND THE SAVE; A PANEL DRAWS ONE DRIVER (PP-14.7, #925)
 * =============================================================================
 *
 * Which object store this deployment talks to is no longer a closed list: the
 * radios are the drivers the API describes (`descriptors`), and the form below
 * them is the selected driver's PANEL, chosen by `getStorageDriverPanel(id)`.
 * The built-in S3, R2 and S3-compatible drivers register their bespoke form
 * (`S3FamilyDriverPanel`: the markup this page always drew, including the
 * write-only secret access key and the three-state path-style control); any
 * other driver is drawn by `StorageGenericDriverPanel` from its descriptor. The
 * page keeps one settings object per driver and one set of typed secrets, and
 * saves `{ provider, drivers: { <id>: settings }, secrets: { <id>: { ... } } }`.
 *
 * ⚠ A SECRET IS WRITE-ONLY, AND BLANK PRESERVES. Typed secrets live OUTSIDE the
 * settings, in their own state, because they are not values this page ever
 * read — they are write-only instructions. A secret nobody retyped is omitted
 * from the body entirely, so the intent reaches the API as an absence rather
 * than as a value it has to interpret.
 *
 * ⚠ A CLEARED TEXT FIELD IS SENT AS `''`. The API merges `drivers.<id>` over the
 * stored settings, so an absent key would silently keep the old value.
 *
 * =============================================================================
 * THE TWO PROBES RUN AGAINST WHAT IS ON SCREEN, NOT WHAT IS SAVED
 * =============================================================================
 *
 * The opposite of `EmailSettingsPage`, deliberately, and it is the API's
 * contract rather than a UI preference: `POST /test` and `POST /bucket` both
 * take the configuration in the REQUEST BODY, so a new bucket can be proved
 * before the deployment is committed to it. There is therefore no "save first"
 * gate on the test button — gating it on a clean form would remove the one
 * workflow these endpoints were built for.
 */

import { useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import {
  Alert,
  AlertTitle,
  Box,
  CircularProgress,
  Button,
  Chip,
  Container,
  Divider,
  FormControl,
  FormControlLabel,
  FormHelperText,
  FormLabel,
  IconButton,
  Paper,
  Radio,
  RadioGroup,
  Snackbar,
  Stack,
  Tooltip,
  Typography,
} from '@mui/material';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import CheckIcon from '@mui/icons-material/Check';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import CreateNewFolderOutlinedIcon from '@mui/icons-material/CreateNewFolderOutlined';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutlineOutlined';
import RemoveCircleOutlineIcon from '@mui/icons-material/RemoveCircleOutlined';
import NetworkCheckIcon from '@mui/icons-material/NetworkCheck';
import { Navigate } from 'react-router-dom';
import { usePlatformViewer } from '../../core/index.js';
import { reportsBucketMissing, useStorageConfig } from '../headless/index.js';
import type {
  StorageBucketProvisionResult,
  StorageConfigInput,
  StorageConfigView,
  StorageConnectionCheck,
  StorageDriverSettings,
} from '../headless/index.js';
import type { PluggableDescriptor } from '@marinoscar/platform-contract/settings';
import { registerBuiltinStorageDriverPanels } from './builtinStorageDriverPanels.js';
import { StorageGenericDriverPanel } from './StorageGenericDriverPanel.js';
import { getStorageDriverPanel, getStorageDriverPanelValidator } from './storageDriverPanelRegistry.js';
import { StorageSwitchConfirmDialog } from './StorageSwitchConfirmDialog.js';

// The three built-in drivers draw their bespoke panel through the same registry
// an app uses (PP-14.7, #925); every other driver is drawn by
// `StorageGenericDriverPanel` from its descriptor.
registerBuiltinStorageDriverPanels();

/** The settings the page edits: every driver's own, by driver id. */
type DriverSettingsById = Record<string, StorageDriverSettings>;

/** The typed (write-only) secrets, by driver id and declared name. */
type TypedSecretsById = Record<string, Record<string, string>>;

/** The driver ids of the three built-ins, for an API that served no `descriptors` (an older one). */
const FALLBACK_DRIVER_LABELS: Record<string, string> = {
  s3: 'Amazon S3',
  r2: 'Cloudflare R2',
  s3compatible: 'S3-compatible (MinIO, Wasabi, Backblaze B2…)',
};

/** A copy of every driver's settings, to edit without touching the loaded configuration. */
function seedDrivers(config: StorageConfigView): DriverSettingsById {
  const drivers: DriverSettingsById = {};
  for (const [id, settings] of Object.entries(config.drivers ?? {})) drivers[id] = { ...settings };
  return drivers;
}

/**
 * The descriptors to draw: the API's, one per registered driver. An API that
 * sent none (older than #925) still has the three built-ins to choose from.
 */
function descriptorsOf(config: StorageConfigView): PluggableDescriptor[] {
  if (config.descriptors && config.descriptors.length > 0) return config.descriptors;
  return Object.entries(FALLBACK_DRIVER_LABELS).map(([id, label]) => ({
    kind: 'storage-driver',
    id,
    label,
    fields: [],
  }));
}

/**
 * A driver's settings with every text field its descriptor declares present.
 *
 * `PluggableConfigForm` removes a cleared text field (`undefined`), and the API
 * MERGES `drivers.<id>` over the stored settings, so an absent key would keep
 * the old value: a field the admin emptied must go out as `''`.
 */
function withTextDefaults(
  descriptor: PluggableDescriptor | undefined,
  settings: StorageDriverSettings | undefined,
): StorageDriverSettings {
  const out: StorageDriverSettings = { ...settings };
  for (const field of descriptor?.fields ?? []) {
    if (field.kind === 'string' && out[field.name] === undefined) out[field.name] = '';
  }
  return out;
}

/** A key-order-independent form of a settings object, for the dirty comparison. */
function comparable(settings: StorageDriverSettings): string {
  return JSON.stringify(Object.entries(settings).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}

/** A multi-line shell block: monospace, selectable, and copied whole. Mirrors `DbBackupRestoreDialog`'s. */
function CopyableBlock({ value, label, testId }: { value: string; label: string; testId: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 3000);
    } catch {
      // Clipboard access denied or unavailable. The block below is still
      // complete and still selectable, which is the right fallback.
    }
  };

  return (
    <Box sx={{ mt: 1 }}>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mb: 0.5 }}>
        <Typography variant="subtitle2" sx={{ flexGrow: 1 }}>
          {label}
        </Typography>
        <Tooltip title={copied ? 'Copied' : `Copy ${label.toLowerCase()}`}>
          <IconButton size="small" onClick={() => void handleCopy()} aria-label={`Copy ${label}`}>
            {copied ? (
              <CheckIcon fontSize="small" color="success" />
            ) : (
              <ContentCopyIcon fontSize="small" />
            )}
          </IconButton>
        </Tooltip>
      </Stack>
      <Paper variant="outlined" sx={{ p: 1.5, overflowX: 'auto', backgroundColor: 'action.hover' }}>
        <Typography
          component="pre"
          data-testid={testId}
          sx={{ m: 0, fontFamily: 'monospace', fontSize: '0.8125rem', whiteSpace: 'pre' }}
        >
          {value}
        </Typography>
      </Paper>
    </Box>
  );
}

/**
 * The extra sentence that turns a code into an action.
 *
 * ⚠ THE WHOLE REASON THE CHECKS ARE REPORTED SEPARATELY. `bucket_missing` (404)
 * and `bucket_forbidden` (403) are the pair the API refuses to collapse, and
 * they need OPPOSITE fixes: create the bucket, versus stop trying to create a
 * bucket that already belongs to somebody else and fix the policy or the typo.
 * A page that rendered both as "bucket check failed" would send an admin to
 * `POST /bucket` for a bucket that exists and is not theirs.
 *
 * `null` for everything else — the API's own `detail` is already actionable,
 * and adding a second sentence to every row would bury the two that matter.
 */
function remedyFor(check: StorageConnectionCheck): string | null {
  switch (check.code) {
    case 'bucket_missing':
      return 'The bucket does not exist. Create it below, or point the configuration at one that does.';
    case 'bucket_forbidden':
      return 'The bucket exists and this key may not see it. Widen the credential’s policy — or check for a typo that landed on somebody else’s bucket. Do NOT try to create it.';
    case 'bucket_region_mismatch':
      return 'The bucket is real but lives in another region. Correct the region rather than the bucket name.';
    case 'credentials_rejected':
      return 'The provider rejected the key pair itself. Check the access key id above, and retype the secret.';
    case 'endpoint_unreachable':
      return 'Nothing answered at the endpoint. Check the host, the port and that this deployment can reach it at all.';
    case 'not_configured':
      return 'Fill in the fields above first — there is not enough here to build a client.';
    default:
      return null;
  }
}

const CHECK_ICONS = {
  passed: <CheckCircleIcon color="success" fontSize="small" />,
  failed: <ErrorOutlineIcon color="error" fontSize="small" />,
  skipped: <RemoveCircleOutlineIcon color="disabled" fontSize="small" />,
} as const;

/**
 * ONE ROW PER CHECK, never a rolled-up verdict.
 *
 * The `code` is rendered as a chip beside the label, in full, because it is the
 * word an operator will search for in the runbook and in an issue — and because
 * it is what makes two rows that both say "failed" legibly different.
 */
function CheckRow({ check }: { check: StorageConnectionCheck }) {
  const remedy = remedyFor(check);

  return (
    <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'flex-start' }} data-testid={`storage-check-${check.id}`}>
      <Box sx={{ pt: 0.25 }}>{CHECK_ICONS[check.status]}</Box>
      <Box sx={{ minWidth: 0, flexGrow: 1 }}>
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
          <Typography variant="subtitle2">{check.label}</Typography>
          <Chip
            size="small"
            variant="outlined"
            label={check.code}
            data-testid={`storage-check-code-${check.id}`}
            color={
              check.status === 'passed' ? 'success' : check.status === 'failed' ? 'error' : 'default'
            }
          />
        </Stack>
        <Typography variant="body2" color="text.secondary">
          {check.detail}
        </Typography>
        {remedy && (
          <Typography variant="body2" sx={{ mt: 0.5 }}>
            {remedy}
          </Typography>
        )}
        {/* VERBATIM, wrapping rather than truncating. Provider errors carry
            codes, bucket names and quoted regions that ARE the diagnosis; an
            ellipsis in the middle of one costs the admin the answer. */}
        {check.error && (
          <Box
            component="pre"
            data-testid={`storage-check-error-${check.id}`}
            sx={{
              m: 0,
              mt: 1,
              fontFamily: 'monospace',
              fontSize: '0.8125rem',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
            }}
          >
            {check.error}
          </Box>
        )}
      </Box>
    </Box>
  );
}

/** Severity for a bucket action's outcome. `guided` is INFO — it is a successful 200, not a fault. */
function bucketAlertSeverity(
  outcome: StorageBucketProvisionResult['outcome'],
): 'success' | 'info' | 'warning' | 'error' {
  switch (outcome) {
    case 'created':
    case 'already_exists':
      return 'success';
    case 'guided':
      return 'info';
    case 'partial':
      return 'warning';
    default:
      return 'error';
  }
}

const BUCKET_OUTCOME_TITLES: Record<StorageBucketProvisionResult['outcome'], string> = {
  created: 'Bucket created and configured',
  already_exists: 'Bucket already existed — settings re-applied',
  partial: 'Bucket created, but not everything could be applied',
  guided: 'This credential cannot create buckets — here is how to do it',
  failed: 'The bucket could not be created',
};

/**
 * The `/admin/settings/storage` page: the deployment's object-storage
 * configuration (`storage_config:read` to view, `storage_config:write` for
 * every control), the connection test, bucket provisioning and the typed
 * `SWITCH` confirmation. Reads the viewer's permissions from the
 * `PlatformHostProvider`.
 *
 * @returns the page.
 *
 * @extensionPoint component
 * @stability experimental
 */
export default function StorageConfigPage() {
  const { hasPermission } = usePlatformViewer();
  const {
    config,
    isLoading,
    loadError,
    isSaving,
    saveError,
    switchRequired,
    clearSwitchRequired,
    save,
    clearSaveError,
    isProbing,
    probeError,
    clearProbeError,
    testResult,
    clearTestResult,
    bucketResult,
    clearBucketResult,
    test,
    createBucket,
  } = useStorageConfig();

  /** The active driver. */
  const [provider, setProvider] = useState<string | null>(null);
  /** Every driver's settings as edited; seeded from the server, never written back to it wholesale. */
  const [drivers, setDrivers] = useState<DriverSettingsById | null>(null);
  /** WRITE-ONLY, and held outside the settings on purpose — see the file header. */
  const [typedSecrets, setTypedSecrets] = useState<TypedSecretsById>({});
  const [savedMessage, setSavedMessage] = useState<string | null>(null);

  const descriptors = useMemo(() => (config ? descriptorsOf(config) : []), [config]);

  // The server's response is the new baseline after every load AND every save,
  // so this also clears the secret boxes once a save has consumed them. Leaving
  // a typed key on screen after a successful save would imply it is still
  // pending, and the next save would send it again.
  useEffect(() => {
    if (config) {
      setProvider(config.provider);
      setDrivers(seedDrivers(config));
      setTypedSecrets({});
    }
  }, [config]);

  // Defence, not the gate — `App.tsx` wraps the route in `RequirePermission`
  // with this same string. This one catches the page mounted from anywhere
  // else. It sits after every hook so the hook order never changes.
  if (!hasPermission('storage_config:read')) {
    return <Navigate to="/" replace />;
  }

  const canWrite = hasPermission('storage_config:write');

  if (isLoading || ((provider === null || drivers === null) && !loadError)) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', p: 3 }}>
        <CircularProgress size={40} />
      </Box>
    );
  }

  /** The selected driver's id; `''` only while nothing has loaded (then nothing below renders). */
  const id = provider ?? '';
  const ready = provider !== null && drivers !== null && config !== null;
  const descriptor: PluggableDescriptor | undefined = descriptors.find((entry) => entry.id === id);
  /** What the panel is handed, whether or not the API described the driver. */
  const panelDescriptor: PluggableDescriptor = descriptor ?? {
    kind: 'storage-driver',
    id,
    label: id,
    fields: [],
  };
  const activeSettings: StorageDriverSettings = drivers?.[id] ?? {};
  const activeSecrets: Record<string, string> = typedSecrets[id] ?? {};

  const validator = getStorageDriverPanelValidator(id);
  const errors: Record<string, string> = ready && validator ? validator(activeSettings) : {};
  const hasErrors = Object.keys(errors).length > 0;

  // A typed secret counts as a change even when every other field matches: it
  // is the one edit that leaves no visible trace in the settings baseline.
  const hasTypedSecret = Object.values(activeSecrets).some((value) => value !== '');
  const isDirty =
    ready &&
    (id !== config.provider ||
      comparable(withTextDefaults(descriptor, activeSettings)) !==
        comparable(withTextDefaults(descriptor, config.drivers?.[id])) ||
      hasTypedSecret);

  /** Reports one changed setting of the active driver; `undefined` removes it. */
  const updateSetting = (name: string, next: unknown) => {
    setDrivers((prev) => {
      const current = { ...(prev?.[id] ?? {}) };
      if (next === undefined) delete current[name];
      else current[name] = next;
      return { ...prev, [id]: current };
    });
  };

  /** Reports one typed secret of the active driver. */
  const updateSecret = (name: string, next: string) => {
    setTypedSecrets((prev) => ({ ...prev, [id]: { ...(prev[id] ?? {}), [name]: next } }));
  };

  /**
   * The body all three write endpoints take.
   *
   * ONLY THE ACTIVE DRIVER'S SETTINGS GO. The API merges `drivers.<id>` over
   * what is stored and leaves every other driver's settings alone, so switching
   * between drivers and back loses nothing (the edits to a driver that is not
   * selected stay on this page until it is reloaded). EMPTY TEXT BOXES GO AS
   * `''`, NOT AS OMITTED KEYS — that is how an operator drops an endpoint
   * override, or un-configures storage entirely by clearing the bucket.
   *
   * THE ONE EXCEPTION, AND THE OPPOSITE MEANING: a secret is omitted entirely
   * when it was not retyped. The intent reaches the API as an absence rather
   * than as a value it has to interpret, and no code path can ever send an
   * empty secret that a future server revision might read as "clear it".
   */
  const toInput = (): StorageConfigInput => {
    const typed = Object.fromEntries(Object.entries(activeSecrets).filter(([, value]) => value !== ''));
    return {
      provider: id,
      drivers: { [id]: withTextDefaults(descriptor, activeSettings) },
      ...(Object.keys(typed).length > 0 ? { secrets: { [id]: typed } } : {}),
    };
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!ready || hasErrors || !canWrite) return;
    const ok = await save(toInput());
    if (ok) {
      setSavedMessage('Storage configuration saved');
      // The previous probes described a configuration that may no longer be the
      // one on screen. Keeping them would leave a green "connected" — or a red
      // error the admin has just fixed — sitting next to settings it never
      // exercised. (Deliberately asymmetric with plain EDITING, which does NOT
      // clear them: reading the provider's error is precisely what the admin is
      // doing while typing the fix.)
      clearTestResult();
      clearBucketResult();
    }
  };

  /** The confirmed re-send: the identical body, plus the typed literal. */
  const handleConfirmSwitch = async () => {
    if (!ready) return;
    const ok = await save(toInput(), { confirmSwitch: true });
    if (ok) {
      clearSwitchRequired();
      setSavedMessage('Storage configuration saved — this deployment now uses the new location');
      clearTestResult();
      clearBucketResult();
    }
  };

  /**
   * Why a probe is unavailable, or `null` when it is available.
   *
   * Rendered as prose next to the buttons rather than left as a mysteriously
   * greyed control: "disabled with no explanation" is indistinguishable from
   * "broken", and these are the buttons anybody came here to press.
   *
   * NOTE WHAT IS ABSENT: a dirty check. Unlike the email test, these endpoints
   * take the configuration in the request body, so testing unsaved fields is
   * the intended workflow rather than a trap.
   */
  const probeBlockedReason: string | null = !canWrite
    ? 'Testing writes a throwaway object and asks the provider to do work, so it needs permission to change the storage configuration.'
    : isSaving
      ? 'Saving — wait for the save to finish, then test.'
      : hasErrors
        ? 'Fix the highlighted fields first.'
        : null;

  // OFFERED WHEN THE TEST SAID THE BUCKET IS NOT THERE (the S3 family), or when
  // a driver that reports only a message said it failed: whether it can set
  // itself up is the DRIVER's to answer, and the answer (`outcome`, `message`)
  // is rendered either way.
  const bucketMissing =
    reportsBucketMissing(testResult) ||
    (!!testResult && !testResult.success && testResult.checks.length === 0);
  const testedDescriptor = testResult ? descriptors.find((entry) => entry.id === testResult.provider) : undefined;
  const testedWithSecret = testedDescriptor?.fields.some((field) => field.kind === 'secret') ?? true;
  const Panel = getStorageDriverPanel(id) ?? StorageGenericDriverPanel;

  return (
    <Container maxWidth="lg">
      <Box sx={{ py: 4 }}>
        {/* Title and description MIRROR the `Storage` card in
            `config/adminSections.tsx` so the hub card, the rail row, the
            compact AppBar title and this `h1` all name the page identically. */}
        <Typography variant="h4" component="h1" gutterBottom>
          Storage
        </Typography>
        <Typography color="text.secondary" sx={{ mb: 2 }}>
          Point this deployment at an object store, prove the credentials work, and create the
          bucket if it is not there yet.
          {!canWrite && ' (read-only)'}
        </Typography>

        {config?.updatedBy && config.updatedAt && (
          <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
            Last updated by {config.updatedBy.email} on{' '}
            {new Date(config.updatedAt).toLocaleString()}
          </Typography>
        )}

        {loadError && (
          <Alert severity="error" sx={{ mb: 3 }}>
            {loadError}
          </Alert>
        )}

        {/* READ-ONLY IS STATED, NOT MIMED. Every control below stays visible and
            disabled rather than being hidden: a read-only admin diagnosing
            "why did that upload fail" needs to SEE the bucket and the endpoint,
            and a page that hid half its fields would read as broken. */}
        {!canWrite && !loadError && (
          <Alert severity="info" sx={{ mb: 3 }} data-testid="storage-read-only-notice">
            You can read this configuration but not change it. Saving, testing the connection and
            creating a bucket all need <code>storage_config:write</code>.
          </Alert>
        )}

        {/* WHETHER STORAGE WORKS AT ALL, ANSWERED BY THE API AND NOT RE-DERIVED
            HERE. `configured` is the same function the upload path asks, and
            `missing` names every field standing in the way — recomputing either
            from the form would be a second copy of the rule, free to disagree
            with the one that actually decides whether a file can be stored. */}
        {config && !config.configured && !loadError && (
          <Alert severity="warning" sx={{ mb: 3 }} data-testid="storage-not-configured">
            <AlertTitle>Object storage is not configured</AlertTitle>
            Uploads, avatars, job artifacts and database backups all fail until this is complete.
            {config.missing.length > 0 && (
              <Box sx={{ mt: 1 }}>
                Still needed: <strong>{config.missing.join(', ')}</strong>
              </Box>
            )}
          </Alert>
        )}

        {ready && config && (
          <Paper sx={{ mt: 2, p: { xs: 2, sm: 3 } }}>
            <Box component="form" onSubmit={handleSubmit} noValidate>
              <FormControl sx={{ mb: 1 }}>
                <FormLabel id="storage-provider-label">Provider</FormLabel>
                {/* Column on phones, row from `sm` up, expressed in `sx` rather
                    than a `useMediaQuery` — this is pure layout and must not
                    become a sixth breakpoint gate alongside the five coupled
                    ones documented in `common/Layout.tsx`. One radio per driver
                    the API describes (`descriptors`), labelled by the driver. */}
                <RadioGroup
                  aria-labelledby="storage-provider-label"
                  value={id}
                  onChange={(e) => setProvider(e.target.value)}
                  sx={{ flexDirection: { xs: 'column', sm: 'row' }, columnGap: 3 }}
                >
                  {descriptors.map((entry) => (
                    <FormControlLabel
                      key={entry.id}
                      value={entry.id}
                      control={<Radio />}
                      label={entry.label}
                      disabled={!canWrite}
                    />
                  ))}
                </RadioGroup>
                <FormHelperText>
                  Which object store this deployment talks to. Fields for the providers you are
                  not using are kept, so switching back loses nothing.
                </FormHelperText>
              </FormControl>

              {/* The active driver is no longer registered in this build (its
                  package was removed): saying so beats an empty radio group. */}
              {!descriptor && (
                <Alert severity="warning" sx={{ mt: 2 }} data-testid="storage-driver-unavailable">
                  The storage driver <strong>{id}</strong> is not available in this build. Choose
                  another provider above.
                </Alert>
              )}

              {/* THE SELECTED DRIVER'S FORM. The three built-ins register their
                  bespoke panel (the markup this page always drew); any other
                  driver is generated from its descriptor. */}
              {descriptor && (
                <Panel
                  provider={id}
                  descriptor={panelDescriptor}
                  config={config}
                  value={activeSettings}
                  onChange={updateSetting}
                  secrets={activeSecrets}
                  onSecretChange={updateSecret}
                  errors={errors}
                  canWrite={canWrite}
                />
              )}

              {saveError && (
                <Alert severity="error" sx={{ mt: 3 }} onClose={clearSaveError}>
                  <AlertTitle>Could not save</AlertTitle>
                  {saveError}
                </Alert>
              )}

              <Divider sx={{ my: 3 }} />

              {/* Column on phones so no button is squeezed to an unreadable
                  width; a row from `sm` up, where there is space. */}
              <Box
                sx={{
                  display: 'flex',
                  flexDirection: { xs: 'column', sm: 'row' },
                  alignItems: { xs: 'stretch', sm: 'center' },
                  gap: 2,
                  flexWrap: 'wrap',
                }}
              >
                <Button
                  type="submit"
                  variant="contained"
                  disabled={!canWrite || !isDirty || hasErrors || isSaving || isProbing}
                >
                  {isSaving ? 'Saving…' : 'Save changes'}
                </Button>
                <Button
                  variant="outlined"
                  startIcon={<NetworkCheckIcon />}
                  onClick={() => void test(toInput())}
                  disabled={!!probeBlockedReason || isProbing}
                >
                  {isProbing ? 'Working…' : 'Test connection'}
                </Button>
                {/* OFFERED ONLY WHEN THE TEST SAID THE BUCKET IS NOT THERE (or a
                    driver that reports no checks said it failed; see
                    `bucketMissing`). `bucket_forbidden` deliberately does NOT offer it: creating a
                    bucket that already exists and belongs to somebody else is
                    not the fix, and offering the button would send an admin
                    down exactly the wrong path. See `remedyFor`. */}
                {bucketMissing && (
                  <Button
                    variant="outlined"
                    color="secondary"
                    startIcon={<CreateNewFolderOutlinedIcon />}
                    onClick={() => void createBucket(toInput())}
                    disabled={!!probeBlockedReason || isProbing}
                    data-testid="storage-create-bucket"
                  >
                    Create bucket
                  </Button>
                )}
                <Typography variant="body2" color="text.secondary">
                  {probeBlockedReason ??
                    'Tests what is on screen, saved or not — so a new bucket can be proved before you commit to it. One small object is written and deleted again.'}
                </Typography>
              </Box>
            </Box>
          </Paper>
        )}

        {/* THE DIAGNOSTIC SURFACE, persistent and dismissible rather than a
            snackbar. `NoSuchBucket: The specified bucket does not exist` and a
            paste-ready `aws s3api create-bucket` block are the entire reason an
            admin opened this page, and neither fits in a toast. */}
        {probeError && (
          <Alert severity="error" sx={{ mt: 3 }} onClose={clearProbeError}>
            <AlertTitle>The request itself failed</AlertTitle>
            {probeError}
          </Alert>
        )}

        {testResult && (
          <Alert
            severity={testResult.success ? 'success' : 'error'}
            sx={{ mt: 3 }}
            onClose={clearTestResult}
            data-testid="storage-test-result"
          >
            <AlertTitle>
              {testResult.success
                ? 'Storage is reachable and writable'
                : 'The storage configuration did not pass'}
            </AlertTitle>
            <Typography variant="body2" sx={{ mb: 1 }}>
              {testResult.provider} · {testResult.bucket}
              {testResult.effectiveEndpoint ? ` at ${testResult.effectiveEndpoint}` : ''} ·{' '}
              {testedWithSecret
                ? testResult.usedStoredSecret
                  ? 'tested with the stored secret key'
                  : 'tested with the key typed above'
                : 'no secret needed'}
            </Typography>
            {/* A CUSTOM DRIVER'S OWN VERDICT. The four S3 checks are the built-ins'
                vocabulary; a driver that does not report them answers in
                `message` (already redacted of secret material by the API), with
                a few safe facts in `details`. Rendered as text, never as HTML. */}
            {testResult.message && (
              <Typography variant="body2" sx={{ mb: 1 }} data-testid="storage-test-message">
                {testResult.message}
              </Typography>
            )}
            {testResult.details && Object.keys(testResult.details).length > 0 && (
              <Box
                component="dl"
                data-testid="storage-test-details"
                sx={{ m: 0, mb: 1, display: 'grid', gridTemplateColumns: 'max-content 1fr', columnGap: 2 }}
              >
                {Object.entries(testResult.details).map(([key, value]) => (
                  <Box key={key} sx={{ display: 'contents' }}>
                    <Typography component="dt" variant="body2" color="text.secondary">
                      {key}
                    </Typography>
                    <Typography component="dd" variant="body2" sx={{ m: 0, wordBreak: 'break-word' }}>
                      {String(value)}
                    </Typography>
                  </Box>
                ))}
              </Box>
            )}
            {/* ONE ROW PER CHECK. The API refuses to collapse them and so does
                this: `bucket_missing` and `bucket_forbidden` need opposite
                actions, and a single rolled-up verdict cannot say which. */}
            <Stack spacing={1.5} sx={{ mt: 1 }}>
              {testResult.checks.map((check) => (
                <CheckRow key={check.id} check={check} />
              ))}
            </Stack>
          </Alert>
        )}

        {bucketResult && (
          <Alert
            severity={bucketAlertSeverity(bucketResult.outcome)}
            sx={{ mt: 3 }}
            onClose={clearBucketResult}
            data-testid="storage-bucket-result"
          >
            <AlertTitle>{BUCKET_OUTCOME_TITLES[bucketResult.outcome]}</AlertTitle>

            {/* The driver's own one-line outcome: what a driver that cannot
                provision says, and the sentence a custom driver adds. */}
            {bucketResult.message && (
              <Typography variant="body2" sx={{ mt: 1 }} data-testid="storage-bucket-message">
                {bucketResult.message}
              </Typography>
            )}

            {/* ⚠ `guided` IS NOT A FAILURE. A least-privilege credential without
                `s3:CreateBucket` is the ORDINARY configuration — an IAM policy
                scoped to one bucket's objects, or an R2 token minted
                object-read-write. So it renders as INFO carrying a block with
                this deployment's real names already substituted, because a
                block with a placeholder in it is homework, not a deliverable. */}
            {bucketResult.guidance && (
              <>
                <Typography variant="body2" sx={{ mt: 1 }}>
                  {bucketResult.guidance.reason}
                </Typography>
                <CopyableBlock
                  label="Run these, then test the connection again"
                  value={bucketResult.guidance.commands}
                  testId="storage-bucket-guidance-commands"
                />
                {bucketResult.guidance.runbook && (
                  <Typography variant="body2" sx={{ mt: 1 }}>
                    More detail: {bucketResult.guidance.runbook}
                  </Typography>
                )}
              </>
            )}

            {/* PER-STEP OUTCOMES, because partial success is the common case: a
                bucket that was created but could not be hardened must say which
                step failed rather than reporting a success that hides it. */}
            <Stack spacing={1.5} sx={{ mt: 2 }}>
              {bucketResult.steps.map((step) => (
                <Box
                  key={step.id}
                  sx={{ display: 'flex', gap: 1.5, alignItems: 'flex-start' }}
                  data-testid={`storage-bucket-step-${step.id}`}
                >
                  <Box sx={{ pt: 0.25 }}>{CHECK_ICONS[step.status]}</Box>
                  <Box sx={{ minWidth: 0, flexGrow: 1 }}>
                    <Typography variant="subtitle2">{step.label}</Typography>
                    <Typography variant="body2" color="text.secondary">
                      {step.detail}
                    </Typography>
                    {step.error && (
                      <Box
                        component="pre"
                        sx={{
                          m: 0,
                          mt: 1,
                          fontFamily: 'monospace',
                          fontSize: '0.8125rem',
                          whiteSpace: 'pre-wrap',
                          wordBreak: 'break-word',
                        }}
                      >
                        {step.error}
                      </Box>
                    )}
                  </Box>
                </Box>
              ))}
            </Stack>

            {bucketResult.corsOrigin && (
              <Typography variant="body2" sx={{ mt: 2 }}>
                Browser uploads were allowed from <strong>{bucketResult.corsOrigin}</strong>.
              </Typography>
            )}
          </Alert>
        )}

        {/* Opened only once the API has already refused with
            `STORAGE_LOCATION_IN_USE` — the row counts behind that refusal are
            the server's to know, not this page's to guess. */}
        <StorageSwitchConfirmDialog
          open={!!switchRequired}
          message={switchRequired?.message ?? ''}
          details={switchRequired?.details ?? null}
          isWorking={isSaving}
          onConfirm={() => void handleConfirmSwitch()}
          onClose={clearSwitchRequired}
        />

        {/* Saving is the ordinary, expected outcome, so it gets the transient
            snackbar the sibling settings pages use. The probe results
            deliberately do NOT — see the file header. */}
        <Snackbar
          open={!!savedMessage}
          autoHideDuration={3000}
          onClose={() => setSavedMessage(null)}
          message={savedMessage}
        />
      </Box>
    </Container>
  );
}
