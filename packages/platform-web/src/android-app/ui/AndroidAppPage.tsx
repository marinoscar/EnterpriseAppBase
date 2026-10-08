// =============================================================================
// AndroidAppPage (#746): `/admin/settings/android`
// =============================================================================
//
// Merged from EvoPath's and MemoriaHub's admin page: the trusted apps (each
// pair becomes a Digital Asset Links statement at
// `/.well-known/assetlinks.json`, which lets the Trusted Web Activity open full
// screen), the apps paired devices report (one-click Trust), the assetlinks
// preview, the hosted APK releases (upload, make current, delete), and the
// Android test notification. Reachability is the app's route gate on
// `system_settings:read` (the card's permission, the string the API
// enforces); every write control is disabled without `system_settings:write`,
// and the API enforces it either way.
// =============================================================================

import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlined';
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  Container,
  FormControlLabel,
  IconButton,
  List,
  ListItem,
  ListItemText,
  Paper,
  Skeleton,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import { useCallback, useEffect, useState, type FormEvent, type ReactElement } from 'react';
import {
  ANDROID_PACKAGE_NAME_PATTERN,
  MAX_TRUSTED_ANDROID_APPS,
  SHA256_FINGERPRINT_PATTERN,
  normalizeSha256Fingerprint,
  trustedAppKey,
  type AdminRelease,
  type AndroidAppTestNotificationResponse,
  type TrustedAndroidApp,
} from '@marinoscar/platform-contract/android-app';

import { isPlatformApiError, usePlatformViewer } from '../../core/index.js';
import { useAndroidAppClient, useAndroidAppConfig } from '../headless/hooks.js';
import {
  ANDROID_APP_DESCRIPTION,
  ANDROID_APP_READ_ONLY_MESSAGE,
  ANDROID_APP_TITLE,
  ANDROID_APP_WRITE_PERMISSION,
} from './copy.js';
import { DownloadApkButton } from './DownloadApkButton.js';

const MONO = { fontFamily: 'monospace', fontSize: '0.8rem', overflowWrap: 'anywhere' } as const;

/**
 * The add-form's package error.
 *
 * @stability experimental
 */
export const ANDROID_PACKAGE_ERROR = 'Enter an Android package name, such as com.example.app.';

/**
 * The add-form's fingerprint error.
 *
 * @stability experimental
 */
export const ANDROID_SHA_ERROR = 'Enter a SHA-256 fingerprint: 32 pairs of hex digits separated by colons, or 64 hex digits.';

function messageOf(error: unknown): string {
  if (isPlatformApiError(error)) return error.message;
  return error instanceof Error ? error.message : String(error);
}

function formatBytes(value: string): string {
  const bytes = Number(value);
  if (!Number.isFinite(bytes)) return `${value} B`;
  return bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.ceil(bytes / 1024)} KB`;
}

function TrustedAppsSection({ canWrite }: { canWrite: boolean }): ReactElement {
  const { config, isLoading, error, isSaving, saveError, save } = useAndroidAppConfig();
  const [packageName, setPackageName] = useState('');
  const [sha256, setSha256] = useState('');
  const [errors, setErrors] = useState<{ packageName?: string; sha256?: string; form?: string }>({});

  if (isLoading && !config) return <Skeleton variant="rounded" height={160} />;
  if (error && !config) return <Alert severity="error">{error}</Alert>;

  const trusted = config?.trustedApps ?? [];
  const reported = config?.reportedApps ?? [];
  const full = trusted.length >= MAX_TRUSTED_ANDROID_APPS;
  const disabled = !canWrite || isSaving;
  const isTrusted = (app: TrustedAndroidApp) => trusted.some((t) => trustedAppKey(t.packageName, t.sha256) === trustedAppKey(app.packageName, app.sha256));

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const candidate = { packageName: packageName.trim(), sha256: normalizeSha256Fingerprint(sha256) };
    const next: typeof errors = {};
    if (!ANDROID_PACKAGE_NAME_PATTERN.test(candidate.packageName)) next.packageName = ANDROID_PACKAGE_ERROR;
    if (!SHA256_FINGERPRINT_PATTERN.test(candidate.sha256)) next.sha256 = ANDROID_SHA_ERROR;
    if (!next.packageName && !next.sha256 && isTrusted(candidate)) next.form = 'That app is already trusted.';
    if (!next.packageName && !next.sha256 && !next.form && full) next.form = `At most ${MAX_TRUSTED_ANDROID_APPS} apps can be trusted.`;
    setErrors(next);
    if (Object.keys(next).length > 0) return;
    if (await save([...trusted, candidate])) {
      setPackageName('');
      setSha256('');
    }
  };

  return (
    <Stack spacing={2}>
      {saveError && <Alert severity="error">{saveError}</Alert>}
      {trusted.length === 0 ? (
        <Alert severity="info">No app is trusted yet: the Android app opens with a URL bar until its signing key is trusted here.</Alert>
      ) : (
        <List dense aria-label="Trusted apps">
          {trusted.map((app) => (
            <ListItem
              key={trustedAppKey(app.packageName, app.sha256)}
              secondaryAction={
                <Tooltip title="Stop trusting this app">
                  <span>
                    <IconButton
                      edge="end"
                      aria-label={`Remove ${app.packageName}`}
                      disabled={disabled}
                      onClick={() => void save(trusted.filter((t) => t !== app))}
                    >
                      <DeleteOutlineIcon />
                    </IconButton>
                  </span>
                </Tooltip>
              }
            >
              <ListItemText primary={app.packageName} secondary={<Box component="span" sx={MONO}>{app.sha256}</Box>} />
            </ListItem>
          ))}
        </List>
      )}
      <Box component="form" onSubmit={(event) => void onSubmit(event)} noValidate>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ alignItems: { sm: 'flex-start' } }}>
          <TextField
            label="Package name"
            size="small"
            value={packageName}
            onChange={(event) => setPackageName(event.target.value)}
            error={Boolean(errors.packageName)}
            helperText={errors.packageName}
            disabled={disabled}
          />
          <TextField
            label="SHA-256 fingerprint"
            size="small"
            value={sha256}
            onChange={(event) => setSha256(event.target.value)}
            error={Boolean(errors.sha256)}
            helperText={errors.sha256}
            disabled={disabled}
            sx={{ flexGrow: 1 }}
          />
          <Button type="submit" variant="contained" disabled={disabled || full} sx={{ minHeight: 40 }}>
            Trust
          </Button>
        </Stack>
        {errors.form && (
          <Alert severity="warning" sx={{ mt: 1 }}>
            {errors.form}
          </Alert>
        )}
      </Box>
      <Typography variant="subtitle1" component="h3">
        Reported by paired devices
      </Typography>
      {reported.length === 0 ? (
        <Typography color="text.secondary">No paired device has reported its app signature.</Typography>
      ) : (
        <List dense aria-label="Reported apps">
          {reported.map((app) => (
            <ListItem
              key={trustedAppKey(app.packageName, app.sha256)}
              secondaryAction={
                app.trusted ? (
                  <Chip size="small" label="Trusted" color="success" />
                ) : (
                  <Button
                    size="small"
                    aria-label={`Trust ${app.packageName}`}
                    disabled={disabled || full}
                    onClick={() => void save([...trusted, { packageName: app.packageName, sha256: app.sha256 }])}
                  >
                    Trust
                  </Button>
                )
              }
            >
              <ListItemText
                primary={`${app.packageName} (${app.deviceCount} device${app.deviceCount === 1 ? '' : 's'})`}
                secondary={<Box component="span" sx={MONO}>{app.sha256}</Box>}
              />
            </ListItem>
          ))}
        </List>
      )}
      <Typography variant="subtitle1" component="h3">
        assetlinks.json
      </Typography>
      <Paper variant="outlined" sx={{ p: 1.5, ...MONO, whiteSpace: 'pre-wrap' }} data-testid="assetlinks-preview">
        {JSON.stringify(config?.assetLinks ?? [], null, 2)}
      </Paper>
    </Stack>
  );
}

function ReleasesSection({ canWrite }: { canWrite: boolean }): ReactElement {
  const client = useAndroidAppClient();
  const [releases, setReleases] = useState<AdminRelease[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [fields, setFields] = useState({ packageName: '', versionName: '', versionCode: '', signingSha256: '', notes: '' });
  const [makeCurrent, setMakeCurrent] = useState(true);
  const [trust, setTrust] = useState(false);

  const load = useCallback(async () => {
    try {
      setReleases(await client.listReleases());
    } catch (e) {
      setError(messageOf(e));
    }
  }, [client]);

  useEffect(() => {
    void load();
  }, [load]);

  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
      await load();
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy(false);
    }
  };

  const upload = async (event: FormEvent) => {
    event.preventDefault();
    if (!file) return;
    await run(() =>
      client.uploadRelease(
        { ...fields, versionCode: Number(fields.versionCode), notes: fields.notes || undefined, makeCurrent, trust },
        file,
      ),
    );
  };

  const disabled = !canWrite || busy;
  return (
    <Stack spacing={2}>
      {error && <Alert severity="error">{error}</Alert>}
      {releases === null ? (
        <Skeleton variant="rounded" height={80} />
      ) : releases.length === 0 ? (
        <Typography color="text.secondary">No APK is published on this server.</Typography>
      ) : (
        <List dense aria-label="Releases">
          {releases.map((release) => (
            <ListItem key={release.id} sx={{ flexWrap: 'wrap', gap: 1 }}>
              <ListItemText
                primary={
                  <>
                    {release.versionName} ({release.versionCode}){' '}
                    {release.isCurrent && <Chip size="small" color="primary" label="Current" sx={{ ml: 1 }} />}
                  </>
                }
                secondary={`${release.packageName} · ${formatBytes(release.sizeBytes)} · ${new Date(release.createdAt).toLocaleString()}`}
              />
              <Stack direction="row" spacing={1}>
                <DownloadApkButton release={release} compact />
                {!release.isCurrent && (
                  <Button size="small" disabled={disabled} onClick={() => void run(() => client.makeCurrent(release.id))}>
                    Make current
                  </Button>
                )}
                {!release.isCurrent && (
                  <IconButton
                    size="small"
                    aria-label={`Delete ${release.versionName}`}
                    disabled={disabled}
                    onClick={() => void run(() => client.deleteRelease(release.id))}
                  >
                    <DeleteOutlineIcon fontSize="small" />
                  </IconButton>
                )}
              </Stack>
            </ListItem>
          ))}
        </List>
      )}
      <Box component="form" onSubmit={(event) => void upload(event)} aria-label="Upload a release">
        <Stack spacing={1}>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
            {(['packageName', 'versionName', 'versionCode', 'signingSha256'] as const).map((name) => (
              <TextField
                key={name}
                size="small"
                label={{ packageName: 'Package name', versionName: 'Version name', versionCode: 'Version code', signingSha256: 'Signing SHA-256' }[name]}
                value={fields[name]}
                onChange={(event) => setFields((previous) => ({ ...previous, [name]: event.target.value }))}
                disabled={disabled}
                required
              />
            ))}
          </Stack>
          <TextField
            size="small"
            label="Release notes"
            value={fields.notes}
            onChange={(event) => setFields((previous) => ({ ...previous, notes: event.target.value }))}
            disabled={disabled}
            multiline
          />
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ alignItems: { sm: 'center' } }}>
            <Button variant="outlined" component="label" disabled={disabled} sx={{ minHeight: 40 }}>
              {file ? file.name : 'Choose APK'}
              <input hidden type="file" accept=".apk,application/vnd.android.package-archive" onChange={(event) => setFile(event.target.files?.[0] ?? null)} />
            </Button>
            <FormControlLabel control={<Checkbox checked={makeCurrent} onChange={(_e, checked) => setMakeCurrent(checked)} disabled={disabled} />} label="Make current" />
            <FormControlLabel control={<Checkbox checked={trust} onChange={(_e, checked) => setTrust(checked)} disabled={disabled} />} label="Trust a new signing key" />
            <Button type="submit" variant="contained" disabled={disabled || !file} sx={{ minHeight: 40 }}>
              Upload
            </Button>
          </Stack>
        </Stack>
      </Box>
    </Stack>
  );
}

function NotificationsSection({ canWrite }: { canWrite: boolean }): ReactElement {
  const client = useAndroidAppClient();
  const { config } = useAndroidAppConfig();
  const [result, setResult] = useState<AndroidAppTestNotificationResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const send = async () => {
    setBusy(true);
    setError(null);
    try {
      setResult(await client.testNotification());
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy(false);
    }
  };
  const counts = config?.pushSubscriptions;
  return (
    <Stack spacing={2}>
      {counts && (
        <Typography color="text.secondary">
          {counts.androidApp} Android app subscription{counts.androidApp === 1 ? '' : 's'} ({counts.androidAppUsers} user
          {counts.androidAppUsers === 1 ? '' : 's'}), {counts.browser} browser subscription{counts.browser === 1 ? '' : 's'}.
        </Typography>
      )}
      <Box>
        <Button variant="outlined" disabled={!canWrite || busy} onClick={() => void send()} sx={{ minHeight: 40 }}>
          Send me a test notification
        </Button>
      </Box>
      {error && <Alert severity="error">{error}</Alert>}
      {result?.reason === 'PUSH_NOT_CONFIGURED' && <Alert severity="warning">Web Push is not configured on this deployment.</Alert>}
      {result?.reason === 'NO_ANDROID_SUBSCRIPTION' && (
        <Alert severity="info">You have not enabled notifications inside the Android app on any phone.</Alert>
      )}
      {result && !result.reason && (
        <List dense aria-label="Test notification results">
          {result.results.map((row) => (
            <ListItem key={row.subscriptionId}>
              <ListItemText primary={`${row.endpointHost}: ${row.status}`} secondary={row.error} />
            </ListItem>
          ))}
        </List>
      )}
    </Stack>
  );
}

function Section({ title, children }: { title: string; children: ReactElement }): ReactElement {
  return (
    <Paper variant="outlined" sx={{ p: { xs: 2, sm: 3 } }} component="section" aria-label={title}>
      <Typography variant="h6" component="h2" gutterBottom>
        {title}
      </Typography>
      {children}
    </Paper>
  );
}

/**
 * The admin Android app page: trusted apps, releases, test notification.
 * Route it behind the app's `system_settings:read` gate; writes are disabled
 * inside the page without `system_settings:write`.
 *
 * @returns the page.
 *
 * @example
 * ```tsx
 * <Route path="/admin/settings/android" element={<RequirePermission permission="system_settings:read"><AndroidAppPage /></RequirePermission>} />
 * ```
 *
 * @extensionPoint component
 * @stability experimental
 */
export function AndroidAppPage(): ReactElement {
  const viewer = usePlatformViewer();
  const canWrite = viewer.hasPermission(ANDROID_APP_WRITE_PERMISSION);
  return (
    <Container maxWidth="md">
      <Box sx={{ py: { xs: 2, sm: 4 } }}>
        <Typography variant="h4" component="h1" gutterBottom>
          {ANDROID_APP_TITLE}
        </Typography>
        <Typography color="text.secondary" sx={{ mb: 3 }}>
          {ANDROID_APP_DESCRIPTION}
        </Typography>
        {!canWrite && (
          <Alert severity="info" sx={{ mb: 2 }}>
            {ANDROID_APP_READ_ONLY_MESSAGE}
          </Alert>
        )}
        <Stack spacing={3}>
          <Section title="Trusted apps">
            <TrustedAppsSection canWrite={canWrite} />
          </Section>
          <Section title="Releases">
            <ReleasesSection canWrite={canWrite} />
          </Section>
          <Section title="Notifications">
            <NotificationsSection canWrite={canWrite} />
          </Section>
        </Stack>
      </Box>
    </Container>
  );
}
