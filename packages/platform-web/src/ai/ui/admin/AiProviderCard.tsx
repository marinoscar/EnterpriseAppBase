/**
 * One AI provider on the admin AI page (`/admin/settings/ai`) — issue #429,
 * epic #419.
 *
 * Two kinds of control live on this card, and they save differently:
 *
 *   - `enabled` and `baseUrl` are part of the page's FORM. They are edited
 *     here but saved with the page's "Save changes" button, in the one
 *     `PUT /admin/ai/config` that carries every other policy field — a
 *     provider switch is policy, exactly like the master switch above it.
 *   - The admin KEY is NOT in that form. "Save key", "Test" and "Remove key"
 *     act immediately: the API verifies a key with the provider before it
 *     stores it, a probe saves nothing, and removal is destructive and sits
 *     behind a typed `REMOVE` (the `PushConfigConfirmDialog` pattern).
 *
 * =============================================================================
 * THE TYPED KEY IS WRITE-ONLY AND SHORT-LIVED
 * =============================================================================
 *
 * It lives in this card's own `useState('')`, never in the page form (where an
 * empty string would have to mean both "unchanged" and "erase"), and it is
 * cleared the moment a save answers — success or failure — and whenever the
 * server hands back a new configuration. The stored key is never rendered:
 * the placeholder and helper text come from the masked `keyStatus` only.
 *
 * =============================================================================
 * PROVIDER-SPECIFIC FIELDS (#448)
 * =============================================================================
 *
 * The card renders exactly the provider's `settingsFields` — `baseUrl` for
 * every provider, plus `apiVersion`/`apiStyle`/`deployments` for Azure OpenAI
 * and `apiStyle`/`requiresKey` for an OpenAI-compatible server. The form model
 * (defaults, validation, the `PUT` entry) lives in `aiProviderForm.ts`.
 */

import { useEffect, useState } from 'react';
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  AlertTitle,
  Box,
  Button,
  Chip,
  Divider,
  FormControlLabel,
  IconButton,
  MenuItem,
  Paper,
  Stack,
  Switch,
  TextField,
  Typography,
} from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlined';
import AddIcon from '@mui/icons-material/Add';
import { AI_AZURE_DEFAULT_API_VERSION, AI_AZURE_DEPLOYMENTS_MAX, aiDefaultApiStyle, aiProviderSettingsFields } from '../../headless/types.js';
import type { AiAdminProvider, AiApiStyle, AiProbeResult as AiProbeResultData } from '../../headless/types.js';
import type { PluggableDescriptor } from '@marinoscar/platform-contract/settings';
import type { AiProviderFormErrors, AiProviderFormValue } from './aiProviderForm.js';
import { AiProviderKeyActions, keyHelperText, MIN_KEY_LENGTH } from './AiProviderKeyActions.js';
import { AiCapabilityChips } from '../shared/AiCapabilityChips.js';

export { keyHelperText } from './AiProviderKeyActions.js';
export type { AiProviderFormValue } from './aiProviderForm.js';

/** How each wire API reads in the `apiStyle` select. */
const API_STYLE_LABELS: Record<AiApiStyle, string> = {
  responses: 'Responses API',
  chat_completions: 'Chat Completions',
};

/**
 * Helper text under the endpoint field: the provider's own (`help.baseUrl`,
 * declared by its definition), else the generic line for a provider with a
 * default host.
 */
function baseUrlHelperText(provider: Pick<AiAdminProvider, 'help'>): string {
  return (
    provider.help?.baseUrl ??
    "Leave blank to use the provider's default endpoint. Set one only for a proxy or a compatible gateway."
  );
}

/** Azure OpenAI's model id to deployment name map, as editable rows. */
function DeploymentsEditor({
  providerId,
  value,
  onChange,
  disabled,
  errors,
}: {
  providerId: string;
  value: AiProviderFormValue;
  onChange: (next: AiProviderFormValue) => void;
  disabled: boolean;
  errors?: AiProviderFormErrors;
}) {
  const rows = value.deployments;
  const atCap = rows.length >= AI_AZURE_DEPLOYMENTS_MAX;
  const setRow = (index: number, patch: Partial<AiProviderFormValue['deployments'][number]>) =>
    onChange({
      ...value,
      deployments: rows.map((row, i) => (i === index ? { ...row, ...patch } : row)),
    });

  return (
    <Box component="fieldset" sx={{ border: 0, p: 0, m: 0 }}>
      <Typography component="legend" variant="subtitle2" gutterBottom>
        Deployments
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
        Map a model id to the name of your Azure deployment of it. A model with no entry is called
        by its own id as the deployment name.
      </Typography>
      <Stack spacing={1.5}>
        {rows.map((row, index) => {
          const rowErrors = errors?.deploymentRows?.[index];
          return (
            <Stack
              key={index}
              direction={{ xs: 'column', sm: 'row' }}
              spacing={1}
              sx={{ alignItems: { sm: 'flex-start' } }}
              data-testid={`ai-provider-${providerId}-deployment-${index}`}
            >
              <TextField
                size="small"
                fullWidth
                label="Model id"
                value={row.modelId}
                onChange={(e) => setRow(index, { modelId: e.target.value })}
                disabled={disabled}
                error={!!rowErrors?.modelId}
                helperText={rowErrors?.modelId}
                placeholder="gpt-4o"
              />
              <TextField
                size="small"
                fullWidth
                label="Deployment name"
                value={row.deployment}
                onChange={(e) => setRow(index, { deployment: e.target.value })}
                disabled={disabled}
                error={!!rowErrors?.deployment}
                helperText={rowErrors?.deployment}
                placeholder="my-gpt-4o"
              />
              <IconButton
                aria-label={`Remove deployment ${index + 1}`}
                onClick={() => onChange({ ...value, deployments: rows.filter((_, i) => i !== index) })}
                disabled={disabled}
                sx={{ alignSelf: { xs: 'flex-end', sm: 'center' } }}
              >
                <DeleteOutlineIcon />
              </IconButton>
            </Stack>
          );
        })}
      </Stack>
      {errors?.deployments && (
        <Typography variant="body2" color="error" sx={{ mt: 1 }} role="alert">
          {errors.deployments}
        </Typography>
      )}
      <Button
        startIcon={<AddIcon />}
        sx={{ mt: 1 }}
        onClick={() => onChange({ ...value, deployments: [...rows, { modelId: '', deployment: '' }] })}
        disabled={disabled || atCap}
      >
        Add deployment
      </Button>
      {atCap && (
        <Typography variant="body2" color="text.secondary">
          At most {AI_AZURE_DEPLOYMENTS_MAX} deployments.
        </Typography>
      )}
    </Box>
  );
}

/**
 * A provider an app registered under a new id (#921): there is a working
 * adapter but the `ai` settings namespace has no slot for it, so there is
 * nothing to switch on or edit yet. Listed so the administrator can see it
 * exists; the page does not send it back on save.
 */
export function AiSlotlessProviderCard({ provider }: { provider: AiAdminProvider }) {
  return (
    <Paper variant="outlined" sx={{ p: { xs: 2, sm: 3 } }} data-testid={`ai-provider-${provider.id}`}>
      <Typography variant="h6" component="h3">
        {provider.displayName}
      </Typography>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
        <Typography variant="body2" color="text.secondary">
          {provider.id}
        </Typography>
        <Chip size="small" label="Registered, not configurable yet" />
      </Stack>
      {provider.supportedCapabilities.length > 0 && (
        <Box sx={{ mt: 1 }}>
          <AiCapabilityChips capabilities={provider.supportedCapabilities} />
        </Box>
      )}
    </Paper>
  );
}

export interface AiProviderCardProps {
  provider: AiAdminProvider;
  value: AiProviderFormValue;
  onChange: (next: AiProviderFormValue) => void;
  canWrite: boolean;
  /** Field-level errors for this provider's settings, if the page's validation found any. */
  errors?: AiProviderFormErrors;

  /** Whether AI is switched on in the SAVED configuration — the models page is unreachable otherwise. */
  aiEnabled: boolean;
  /** Which key write is running for THIS provider, if any. */
  keyAction: 'save' | 'remove' | null;
  /** True while any write or probe on the page is in flight — one at a time. */
  busy: boolean;
  keyError: string | null;
  onClearKeyError: () => void;
  /** Resolves `true` when the key was verified and stored. */
  onSaveKey: (apiKey: string) => Promise<boolean>;
  onRemoveKey: () => Promise<boolean>;

  isProbing: boolean;
  probeError: string | null;
  onClearProbeError: () => void;
  testResult: AiProbeResultData | null;
  onClearTestResult: () => void;
  /** Probe with the typed key, or the stored one when `apiKey` is blank. */
  onTest: (apiKey: string) => void;
  /**
   * The provider's generated-form description from `GET /admin/ai/config`
   * (`descriptors`, PP-14.6, #924). The bespoke built-in cards ignore it; the
   * generic card renders its fields.
   */
  descriptor?: PluggableDescriptor | undefined;
}

export function AiProviderCard({
  provider,
  value,
  onChange,
  canWrite,
  errors,
  aiEnabled,
  keyAction,
  busy,
  keyError,
  onClearKeyError,
  onSaveKey,
  onRemoveKey,
  isProbing,
  probeError,
  onClearProbeError,
  testResult,
  onClearTestResult,
  onTest,
}: AiProviderCardProps) {
  const switchId = `ai-provider-${provider.id}-enabled`;
  /** WRITE-ONLY — see the file header. */
  const [apiKey, setApiKey] = useState('');

  // A new configuration from the server is the new baseline: whatever was
  // typed has either been stored (and must not be sent twice) or belongs to a
  // state that no longer exists.
  useEffect(() => {
    setApiKey('');
  }, [provider.keyStatus]);

  const status = provider.keyStatus;
  const typedKey = apiKey.trim();
  const keyTooShort = typedKey.length > 0 && typedKey.length < MIN_KEY_LENGTH;

  const handleSaveKey = async () => {
    if (!typedKey || keyTooShort) return;
    // Cleared once the server has answered, WHATEVER it answered: a stored key
    // must not be sent twice, and a refused one is retyped, not resubmitted.
    await onSaveKey(typedKey);
    setApiKey('');
  };

  // A provider with no adapter in this build (`registered: false`) exists
  // only as a settings row: it can be switched OFF, never on, and a key for
  // it cannot be verified or tested because there is nothing to call.
  const unregistered = !provider.registered;

  const fields = aiProviderSettingsFields(provider);
  // Fields beyond `baseUrl` mean the endpoint is not optional (Azure, a
  // self-hosted server): show them open, as "Connection", not tucked away.
  const needsConnection = fields.some((field) => field !== 'baseUrl');
  const baseUrlLabel = provider.id === 'azure-openai' ? 'Endpoint' : 'Base URL';
  /** The SAVED setting — the probe and the runtime act on what is stored. */
  const savedKeyless = fields.includes('requiresKey') && provider.requiresKey === false;
  const keylessOnScreen = fields.includes('requiresKey') && !value.requiresKey;

  return (
    <Paper variant="outlined" sx={{ p: { xs: 2, sm: 3 } }} data-testid={`ai-provider-${provider.id}`}>
      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        spacing={1}
        sx={{ alignItems: { sm: 'center' }, justifyContent: 'space-between' }}
      >
        <Box>
          <Typography variant="h6" component="h3">
            {provider.displayName}
          </Typography>
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
            <Typography variant="body2" color="text.secondary">
              {provider.id}
            </Typography>
            {unregistered && (
              <Chip size="small" color="warning" label="Not available in this build" />
            )}
          </Stack>
        </Box>
        <FormControlLabel
          control={
            <Switch
              id={switchId}
              checked={value.enabled}
              onChange={(e) => onChange({ ...value, enabled: e.target.checked })}
              // Off is always allowed; on only for a provider this build has.
              disabled={!canWrite || (unregistered && !value.enabled)}
              slotProps={{ input: { 'aria-label': `Enable ${provider.displayName}` } }}
            />
          }
          label={value.enabled ? 'Enabled' : 'Disabled'}
        />
      </Stack>

      {provider.supportedCapabilities.length > 0 && (
        <Box sx={{ mt: 1 }}>
          <AiCapabilityChips capabilities={provider.supportedCapabilities} />
        </Box>
      )}

      <Accordion
        disableGutters
        elevation={0}
        defaultExpanded={needsConnection}
        sx={{ mt: 2, '&::before': { display: 'none' }, backgroundColor: 'transparent' }}
      >
        <AccordionSummary
          expandIcon={<ExpandMoreIcon />}
          aria-controls={`ai-provider-${provider.id}-advanced`}
          sx={{ px: 0 }}
        >
          <Typography variant="subtitle2">{needsConnection ? 'Connection' : 'Advanced'}</Typography>
        </AccordionSummary>
        <AccordionDetails sx={{ px: 0 }} id={`ai-provider-${provider.id}-advanced`}>
          <Stack spacing={2.5}>
            {fields.includes('baseUrl') && (
              <TextField
                fullWidth
                label={baseUrlLabel}
                value={value.baseUrl}
                onChange={(e) => onChange({ ...value, baseUrl: e.target.value })}
                disabled={!canWrite}
                error={!!errors?.baseUrl}
                helperText={errors?.baseUrl ?? baseUrlHelperText(provider)}
              />
            )}

            {fields.includes('apiVersion') && (
              <TextField
                fullWidth
                label="API version"
                value={value.apiVersion}
                onChange={(e) => onChange({ ...value, apiVersion: e.target.value })}
                disabled={!canWrite}
                placeholder={AI_AZURE_DEFAULT_API_VERSION}
                error={!!errors?.apiVersion}
                helperText={
                  errors?.apiVersion ??
                  `The api-version sent with every request. Leave blank for the default, ${AI_AZURE_DEFAULT_API_VERSION}.`
                }
              />
            )}

            {fields.includes('apiStyle') && (
              <TextField
                select
                fullWidth
                label="API style"
                value={value.apiStyle}
                onChange={(e) => onChange({ ...value, apiStyle: e.target.value as '' | AiApiStyle })}
                disabled={!canWrite}
                helperText={
                  provider.id === 'openai-compatible'
                    ? 'Most self-hosted servers speak Chat Completions only. Choose Responses API only if yours supports it.'
                    : 'Which OpenAI wire API to call. Older api-versions support Chat Completions only.'
                }
                slotProps={{ select: { displayEmpty: true }, inputLabel: { shrink: true } }}
              >
                <MenuItem value="">
                  Default ({API_STYLE_LABELS[aiDefaultApiStyle(provider.id)]})
                </MenuItem>
                <MenuItem value="responses">{API_STYLE_LABELS.responses}</MenuItem>
                <MenuItem value="chat_completions">{API_STYLE_LABELS.chat_completions}</MenuItem>
              </TextField>
            )}

            {fields.includes('deployments') && (
              <DeploymentsEditor
                providerId={provider.id}
                value={value}
                onChange={onChange}
                disabled={!canWrite}
                errors={errors}
              />
            )}

            {fields.includes('requiresKey') && (
              <Box>
                <FormControlLabel
                  control={
                    <Switch
                      checked={value.requiresKey}
                      onChange={(e) => onChange({ ...value, requiresKey: e.target.checked })}
                      disabled={!canWrite}
                    />
                  }
                  label="Requires an API key"
                />
                <Typography variant="body2" color="text.secondary">
                  Turn this off only for a server that takes no key, such as a local Ollama.
                </Typography>
                {keylessOnScreen && (
                  <Alert severity="warning" sx={{ mt: 1.5 }} data-testid={`ai-provider-${provider.id}-keyless-warning`}>
                    <AlertTitle>Requests to this server carry no key</AlertTitle>
                    Anyone with the ai:use permission can use it once its models are enabled, and
                    nothing identifies or bills them to the server. Only point this at a server you
                    trust. Reaching internal hosts is your decision as administrator — the base URL
                    is called as entered, and redirects are refused.
                  </Alert>
                )}
              </Box>
            )}
          </Stack>
        </AccordionDetails>
      </Accordion>

      <Divider sx={{ my: 2 }} />

      {/* ---------------------------------------------------------------
          THE ORGANIZATION KEY
          ------------------------------------------------------------- */}
      <Typography variant="subtitle1" component="h4" gutterBottom>
        Organization key
      </Typography>
      <TextField
        fullWidth
        type="password"
        label={`${provider.displayName} API key`}
        value={apiKey}
        onChange={(e) => setApiKey(e.target.value)}
        disabled={!canWrite}
        // A password manager filling this box would silently send a key the
        // admin never typed.
        autoComplete="new-password"
        placeholder={status.configured ? (status.hint ?? '••••••••') : ''}
        error={keyTooShort}
        helperText={
          keyTooShort
            ? `An API key is at least ${MIN_KEY_LENGTH} characters.`
            : savedKeyless && !status.configured
              ? 'No key needed — this server is keyless.'
              : keyHelperText(status)
        }
      />

      <AiProviderKeyActions
        providerName={provider.displayName}
        canWrite={canWrite}
        unregistered={unregistered}
        status={status}
        typedKey={typedKey}
        keyTooShort={keyTooShort}
        savedKeyless={savedKeyless}
        busy={busy}
        keyAction={keyAction}
        isProbing={isProbing}
        aiEnabled={aiEnabled}
        keyError={keyError}
        onClearKeyError={onClearKeyError}
        probeError={probeError}
        onClearProbeError={onClearProbeError}
        testResult={testResult}
        onClearTestResult={onClearTestResult}
        onSave={() => void handleSaveKey()}
        onRemove={onRemoveKey}
        onTest={() => onTest(typedKey)}
      />
    </Paper>
  );
}
