/**
 * Admin → Settings → AI (`/admin/settings/ai`) — issue #429, epic #419.
 *
 * A STANDALONE PAGE, exactly like `StorageConfigPage` and `PushConfigPage`
 * and for the same reason: it hits its own controller (`/api/admin/ai/*`)
 * with its own document and its own permission pair (`ai_config:read` /
 * `ai_config:write`). One card in `ADMIN_SECTIONS`, one route in `App.tsx`,
 * no tab — `CLAUDE.md`'s "MANDATORY: Settings UI Pattern" rules 1–3.
 *
 * =============================================================================
 * ONE FORM FOR POLICY, IMMEDIATE BUTTONS FOR KEYS
 * =============================================================================
 *
 * The master switch, the key policy, prompt logging, the defaults and each
 * provider's enable switch / base URL are POLICY: they travel together in one
 * `PUT /admin/ai/config` guarded by `If-Match: version`, so a colleague's
 * concurrent edit is detected rather than silently overwritten.
 *
 * A provider's admin KEY is not policy and is not in that form: it is
 * verified by the provider before it is stored, it can be tested on its own,
 * and removing it is destructive. Each of those is an immediate action on the
 * provider's card (`AiProviderCard`).
 *
 * =============================================================================
 * SNACKBAR vs. ALERT
 * =============================================================================
 *
 * A save is the ordinary outcome — `Snackbar`. Anything the admin must READ
 * (a failed check, the provider's verbatim error, a refused save) is a
 * persistent, dismissible `Alert`, as on the storage page.
 *
 * =============================================================================
 * READ-ONLY IS STATED, NOT MIMED
 * =============================================================================
 *
 * Without `ai_config:write` every control stays visible and DISABLED, and an
 * info alert says why — an admin diagnosing "why can nobody use AI" needs to
 * see the switch that is off.
 */

import { useContext, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import {
  Alert,
  AlertTitle,
  Box,
  Button,
  Container,
  Divider,
  FormControl,
  FormControlLabel,
  FormHelperText,
  FormLabel,
  Grid,
  Paper,
  Radio,
  RadioGroup,
  Snackbar,
  Stack,
  Switch,
  TextField,
  Typography,
} from '@mui/material';
import { Navigate } from 'react-router-dom';
import { usePermissions } from '../../hooks/usePermissions';
import { useAiAdminConfig } from '../../hooks/useAiAdminConfig';
import { AiConfigContext } from '../../hooks/useAiConfig';
import { LoadingSpinner } from '../../components/common/LoadingSpinner';
import { AiProviderCard } from '../../components/admin/ai/AiProviderCard';
import type { AiProviderFormValue } from '../../components/admin/ai/AiProviderCard';
import type { AiAdminConfig, AiAdminConfigInput, AiKeyPolicy } from '../../services/ai';

/** The form's own state — strings for the number field so "blank" is representable. */
interface AiFormState {
  enabled: boolean;
  keyPolicy: AiKeyPolicy;
  logPromptContent: boolean;
  maxOutputTokensCap: string;
  allowBackgroundRuns: boolean;
  providers: Record<string, AiProviderFormValue>;
}

const MAX_BASE_URL_LENGTH = 512;

function toFormState(config: AiAdminConfig): AiFormState {
  const providers: Record<string, AiProviderFormValue> = {};
  for (const provider of config.providers) {
    providers[provider.id] = { enabled: provider.enabled, baseUrl: provider.baseUrl ?? '' };
  }
  return {
    enabled: config.enabled,
    keyPolicy: config.keyPolicy,
    logPromptContent: config.logPromptContent,
    maxOutputTokensCap:
      config.defaults.maxOutputTokensCap === null ? '' : String(config.defaults.maxOutputTokensCap),
    allowBackgroundRuns: config.defaults.allowBackgroundRuns,
    providers,
  };
}

/**
 * The `PUT` body.
 *
 * ⚠ THE PUT IS A FULL REPLACE. For every provider it names, an omitted
 * `baseUrl` CLEARS the stored override, and an omitted cap clears the cap. So
 * every value is sent EXPLICITLY, every time — the current override to keep
 * it, `null` to clear it — and every provider on screen is included. Omitting
 * "unchanged" fields, the instinct from a PATCH, would silently wipe them.
 */
function toInput(form: AiFormState): AiAdminConfigInput {
  const providers: AiAdminConfigInput['providers'] = {};
  for (const [id, value] of Object.entries(form.providers)) {
    providers[id] = { enabled: value.enabled, baseUrl: value.baseUrl.trim() || null };
  }
  const cap = form.maxOutputTokensCap.trim();
  return {
    enabled: form.enabled,
    keyPolicy: form.keyPolicy,
    logPromptContent: form.logPromptContent,
    defaults: {
      maxOutputTokensCap: cap ? Number(cap) : null,
      allowBackgroundRuns: form.allowBackgroundRuns,
    },
    providers,
  };
}

interface FormErrors {
  maxOutputTokensCap?: string;
  baseUrl: Record<string, string>;
}

/** Thin client-side validation — the API validates for real; this stops the obvious typo. */
function validate(form: AiFormState): FormErrors {
  const errors: FormErrors = { baseUrl: {} };
  const cap = form.maxOutputTokensCap.trim();
  if (cap && (!/^\d+$/.test(cap) || Number(cap) <= 0)) {
    errors.maxOutputTokensCap = 'Must be a whole number greater than zero, or blank for no cap.';
  }
  for (const [id, value] of Object.entries(form.providers)) {
    const baseUrl = value.baseUrl.trim();
    if (!baseUrl) continue;
    if (baseUrl.length > MAX_BASE_URL_LENGTH) {
      errors.baseUrl[id] = `Keep the base URL to ${MAX_BASE_URL_LENGTH} characters or fewer.`;
    } else if (!/^https?:\/\/\S+$/i.test(baseUrl)) {
      errors.baseUrl[id] = 'Must be a full URL, e.g. https://gateway.example.com/v1.';
    }
  }
  return errors;
}

function hasErrors(errors: FormErrors): boolean {
  return !!errors.maxOutputTokensCap || Object.keys(errors.baseUrl).length > 0;
}

export default function AiConfigPage() {
  const { hasPermission } = usePermissions();
  const {
    config,
    isLoading,
    loadError,
    isSaving,
    saveError,
    clearSaveError,
    save,
    keyAction,
    keyError,
    clearKeyError,
    keyWarnings,
    clearKeyWarnings,
    setKey,
    removeKey,
    probingProvider,
    probeError,
    clearProbeError,
    testResults,
    clearTestResult,
    test,
  } = useAiAdminConfig();
  // The shell's shared `GET /ai/config` answer. Refreshed after a save so the
  // hub, the rail and the AI routes learn at once that AI was switched on or
  // off. Read from context directly — with no shell above (a test), there is
  // nothing to refresh and no request is made.
  const sharedAiConfig = useContext(AiConfigContext);

  const [form, setForm] = useState<AiFormState | null>(null);
  const [savedMessage, setSavedMessage] = useState<string | null>(null);

  // The server's answer is the new baseline after every load and every save.
  useEffect(() => {
    if (config) setForm(toFormState(config));
  }, [config]);

  // Defence, not the gate — `App.tsx` wraps the route in `RequirePermission`
  // with this same string. After every hook so the hook order never changes.
  if (!hasPermission('ai_config:read')) {
    return <Navigate to="/" replace />;
  }

  const canWrite = hasPermission('ai_config:write');

  if (isLoading || (!form && !loadError)) {
    return <LoadingSpinner />;
  }

  const errors = form ? validate(form) : { baseUrl: {} };
  const invalid = hasErrors(errors);
  const isDirty =
    !!form && !!config && JSON.stringify(form) !== JSON.stringify(toFormState(config));

  const update = <K extends keyof AiFormState>(key: K, value: AiFormState[K]) => {
    setForm((prev) => (prev ? { ...prev, [key]: value } : prev));
  };

  /** One write or probe at a time, page-wide — they all replace `config`. */
  const busy = isSaving || keyAction !== null || probingProvider !== null;

  const handleSaveKey = async (providerId: string, displayName: string, apiKey: string) => {
    const ok = await setKey(providerId, apiKey);
    if (ok) setSavedMessage(`${displayName} key verified and saved`);
    return ok;
  };

  const handleRemoveKey = async (providerId: string, displayName: string) => {
    const ok = await removeKey(providerId);
    if (ok) setSavedMessage(`${displayName} key removed`);
    return ok;
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!form || invalid || !canWrite) return;
    const ok = await save(toInput(form));
    if (ok) {
      setSavedMessage('AI configuration saved');
      void sharedAiConfig?.refresh();
    }
  };

  // Providers that would leave the org-fallback policy without a key to fall
  // back to. The API refuses that save with `AI_KEY_REQUIRED`; saying so
  // BEFORE the click is kinder than decoding the refusal after it.
  const keylessEnabledProviders =
    form && config
      ? config.providers.filter(
          (provider) => form.providers[provider.id]?.enabled && !provider.keyStatus.configured,
        )
      : [];

  return (
    <Container maxWidth="lg">
      <Box sx={{ py: 4 }}>
        {/* Title and description MIRROR the `AI` card in `config/adminSections.tsx`. */}
        <Typography variant="h4" component="h1" gutterBottom>
          AI
        </Typography>
        <Typography color="text.secondary" sx={{ mb: 2 }}>
          Switch AI on for this deployment, choose whose keys pay for calls, and configure each
          provider.
          {!canWrite && ' (read-only)'}
        </Typography>

        {config?.updatedBy && config.updatedAt && (
          <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
            Last updated by {config.updatedBy.email} on {new Date(config.updatedAt).toLocaleString()}
          </Typography>
        )}

        {loadError && (
          <Alert severity="error" sx={{ mb: 3 }}>
            {loadError}
          </Alert>
        )}

        {!canWrite && !loadError && (
          <Alert severity="info" sx={{ mb: 3 }} data-testid="ai-read-only-notice">
            You can read this configuration but not change it. Saving, storing or testing a key and
            editing models all need <code>ai_config:write</code>.
          </Alert>
        )}

        {form && config && (
          <Box component="form" onSubmit={handleSubmit} noValidate>
            <Paper sx={{ p: { xs: 2, sm: 3 } }}>
              {/* ---------------------------------------------------------
                  THE MASTER SWITCH
                  ------------------------------------------------------- */}
              <FormControlLabel
                control={
                  <Switch
                    checked={form.enabled}
                    onChange={(e) => update('enabled', e.target.checked)}
                    disabled={!canWrite}
                    slotProps={{ input: { 'aria-label': 'Enable AI for this deployment' } }}
                  />
                }
                label="Enable AI for this deployment"
              />
              <FormHelperText sx={{ mt: 0 }}>
                The kill switch. Turning it off stops every AI feature at once, without touching
                keys or models.
              </FormHelperText>
              {!form.enabled && (
                <Alert severity="info" sx={{ mt: 2 }} data-testid="ai-disabled-notice">
                  AI is completely disabled: users see no AI features, and no AI requests are made.
                </Alert>
              )}

              <Divider sx={{ my: 3 }} />

              {/* ---------------------------------------------------------
                  KEY POLICY
                  ------------------------------------------------------- */}
              <FormControl>
                <FormLabel id="ai-key-policy-label">Whose key pays for a call</FormLabel>
                <RadioGroup
                  aria-labelledby="ai-key-policy-label"
                  value={form.keyPolicy}
                  onChange={(e) => update('keyPolicy', e.target.value as AiKeyPolicy)}
                >
                  <FormControlLabel
                    value="byok"
                    control={<Radio />}
                    label="Users bring their own key (recommended)"
                    disabled={!canWrite}
                  />
                  <FormControlLabel
                    value="byok_with_org_fallback"
                    control={<Radio />}
                    label="Users bring their own key; fall back to the organization key"
                    disabled={!canWrite}
                  />
                </RadioGroup>
                <FormHelperText>
                  The organization key below is always used to discover models. This choice decides
                  whether it also pays for users&apos; calls.
                </FormHelperText>
              </FormControl>
              {form.keyPolicy === 'byok_with_org_fallback' && (
                <Alert severity="warning" sx={{ mt: 2 }} data-testid="ai-org-fallback-warning">
                  <AlertTitle>The organization pays for users without a key</AlertTitle>
                  Every user who has not saved their own key will make calls on the organization
                  key, and its provider bill.
                  {keylessEnabledProviders.length > 0 && (
                    <Box sx={{ mt: 1 }}>
                      No organization key is stored yet for{' '}
                      <strong>
                        {keylessEnabledProviders.map((provider) => provider.displayName).join(', ')}
                      </strong>
                      . Save one below first — the configuration cannot be saved with this policy
                      until then.
                    </Box>
                  )}
                </Alert>
              )}

              <Divider sx={{ my: 3 }} />

              {/* ---------------------------------------------------------
                  PRIVACY AND DEFAULTS
                  ------------------------------------------------------- */}
              <FormControlLabel
                control={
                  <Switch
                    checked={form.logPromptContent}
                    onChange={(e) => update('logPromptContent', e.target.checked)}
                    disabled={!canWrite}
                    slotProps={{ input: { 'aria-label': 'Log prompt content' } }}
                  />
                }
                label="Log prompt content"
              />
              <FormHelperText sx={{ mt: 0 }}>
                Off by default. Usage is always recorded; this adds what users actually typed.
              </FormHelperText>
              {form.logPromptContent && (
                <Alert severity="warning" sx={{ mt: 2 }} data-testid="ai-log-prompts-warning">
                  Prompts and responses can contain personal or confidential data. With this on,
                  they are stored in the application&apos;s logs where operators can read them.
                </Alert>
              )}

              <Typography variant="h6" component="h2" sx={{ mt: 3, mb: 1 }}>
                Defaults
              </Typography>
              <Grid container spacing={2} sx={{ alignItems: 'center' }}>
                <Grid size={{ xs: 12, sm: 6 }}>
                  <TextField
                    fullWidth
                    label="Maximum output tokens per call"
                    value={form.maxOutputTokensCap}
                    onChange={(e) => update('maxOutputTokensCap', e.target.value)}
                    disabled={!canWrite}
                    slotProps={{ htmlInput: { inputMode: 'numeric' } }}
                    error={!!errors.maxOutputTokensCap}
                    helperText={
                      errors.maxOutputTokensCap ??
                      'A ceiling applied to every request. Leave blank for no cap.'
                    }
                  />
                </Grid>
                <Grid size={{ xs: 12, sm: 6 }}>
                  <FormControlLabel
                    control={
                      <Switch
                        checked={form.allowBackgroundRuns}
                        onChange={(e) => update('allowBackgroundRuns', e.target.checked)}
                        disabled={!canWrite}
                        slotProps={{ input: { 'aria-label': 'Allow background runs' } }}
                      />
                    }
                    label="Allow background runs"
                  />
                  <FormHelperText sx={{ mt: 0 }}>
                    Long requests run on the job queue instead of holding a connection open.
                  </FormHelperText>
                </Grid>
              </Grid>
            </Paper>

            {/* -------------------------------------------------------------
                PROVIDERS
                ----------------------------------------------------------- */}
            <Typography variant="h5" component="h2" sx={{ mt: 4, mb: 2 }}>
              Providers
            </Typography>
            {config.providers.length === 0 ? (
              <Alert severity="info">No AI providers are registered in this build.</Alert>
            ) : (
              <Stack spacing={2}>
                {config.providers.map((provider) => (
                  <AiProviderCard
                    key={provider.id}
                    provider={provider}
                    value={form.providers[provider.id] ?? { enabled: false, baseUrl: '' }}
                    onChange={(next) =>
                      setForm((prev) =>
                        prev ? { ...prev, providers: { ...prev.providers, [provider.id]: next } } : prev,
                      )
                    }
                    canWrite={canWrite}
                    baseUrlError={errors.baseUrl[provider.id]}
                    aiEnabled={config.enabled}
                    keyAction={keyAction?.provider === provider.id ? keyAction.action : null}
                    busy={busy}
                    keyError={keyError?.provider === provider.id ? keyError.message : null}
                    onClearKeyError={clearKeyError}
                    onSaveKey={(apiKey) =>
                      handleSaveKey(provider.id, provider.displayName, apiKey)
                    }
                    onRemoveKey={() => handleRemoveKey(provider.id, provider.displayName)}
                    isProbing={probingProvider === provider.id}
                    probeError={probeError?.provider === provider.id ? probeError.message : null}
                    onClearProbeError={clearProbeError}
                    testResult={testResults[provider.id] ?? null}
                    onClearTestResult={() => clearTestResult(provider.id)}
                    onTest={(apiKey) =>
                      void test(provider.id, {
                        apiKey,
                        // The base URL ON SCREEN, saved or not — so a gateway
                        // can be proved before it is committed to.
                        baseUrl: form.providers[provider.id]?.baseUrl.trim() || undefined,
                      })
                    }
                  />
                ))}
              </Stack>
            )}

            {keyWarnings.includes('ORG_FALLBACK_WITHOUT_KEY') && (
              <Alert
                severity="warning"
                sx={{ mt: 3 }}
                onClose={clearKeyWarnings}
                data-testid="ai-org-fallback-without-key"
              >
                <AlertTitle>Users can no longer fall back to the organization key</AlertTitle>
                The key policy still falls back to the organization key, but no key is stored for
                that provider any more. Users without their own key will be refused until a new
                organization key is saved or the policy is changed.
              </Alert>
            )}

            {saveError && (
              <Alert severity="error" sx={{ mt: 3 }} onClose={clearSaveError}>
                <AlertTitle>Could not save</AlertTitle>
                {saveError}
              </Alert>
            )}

            <Box
              sx={{
                mt: 3,
                display: 'flex',
                flexDirection: { xs: 'column', sm: 'row' },
                alignItems: { xs: 'stretch', sm: 'center' },
                gap: 2,
              }}
            >
              <Button
                type="submit"
                variant="contained"
                disabled={!canWrite || !isDirty || invalid || busy}
              >
                {isSaving ? 'Saving…' : 'Save changes'}
              </Button>
              <Typography variant="body2" color="text.secondary">
                Saves the switches, the policy, the defaults and each provider&apos;s settings.
                Keys are saved separately, on each provider.
              </Typography>
            </Box>
          </Box>
        )}

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
