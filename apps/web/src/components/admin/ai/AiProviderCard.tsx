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
 */

import { useEffect, useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  AlertTitle,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControlLabel,
  Paper,
  Stack,
  Switch,
  TextField,
  Typography,
} from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import NetworkCheckIcon from '@mui/icons-material/NetworkCheck';
import SaveOutlinedIcon from '@mui/icons-material/SaveOutlined';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlined';
import { AI_KEY_REMOVE_CONFIRMATION } from '../../../services/ai';
import type { AiAdminProvider, AiProbeResult as AiProbeResultData, SecretStatus } from '../../../services/ai';
import { AiProbeResult } from './AiProbeResult';
import { AiCapabilityChips } from '../../ai/AiCapabilityChips';

/** The API's minimum key length (`PUT …/key` body, `min(8)`). */
const MIN_KEY_LENGTH = 8;

/**
 * What to say about the stored key — the storage page's `secretHelperText`.
 * `hint` is the credential store's own mask, so an admin who just rotated a
 * key can see WHICH one is live.
 */
export function keyHelperText(status: SecretStatus): string {
  if (!status.configured) {
    return 'No organization key is stored. Models cannot be discovered without one.';
  }
  const which = status.hint ? ` (${status.hint})` : '';
  const when = status.updatedAt
    ? `, last changed ${new Date(status.updatedAt).toLocaleDateString()}`
    : '';
  return `A key is saved${which}${when}. Leave this blank to keep it, or type a new one to replace it.`;
}

/** The typed-`REMOVE` confirmation — the `PushConfigConfirmDialog` pattern, not an import of it. */
function AiKeyRemoveDialog({
  open,
  providerName,
  isWorking,
  error,
  onConfirm,
  onClose,
}: {
  open: boolean;
  providerName: string;
  isWorking: boolean;
  error: string | null;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const [typed, setTyped] = useState('');

  // Every opening starts from nothing.
  useEffect(() => {
    if (open) setTyped('');
  }, [open]);

  const typedMatches = typed.trim() === AI_KEY_REMOVE_CONFIRMATION;

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Remove the {providerName} organization key?</DialogTitle>
      <DialogContent dividers>
        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}
        <Alert severity="warning">
          <AlertTitle>This cannot be undone</AlertTitle>
          The stored key is deleted. Model discovery for {providerName} stops, and if users fall
          back to the organization key, their calls start failing until a new key is saved.
        </Alert>
        <Box sx={{ mt: 3 }}>
          <TextField
            fullWidth
            label={`Type ${AI_KEY_REMOVE_CONFIRMATION} to confirm`}
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            autoComplete="off"
            helperText="This must be typed exactly, in capitals. Nothing happens until it matches."
          />
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={isWorking}>
          Cancel
        </Button>
        <Button
          variant="contained"
          color="error"
          disabled={!typedMatches || isWorking}
          onClick={onConfirm}
        >
          {isWorking ? 'Removing…' : 'Remove key'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

/** The provider's slice of the page form. */
export interface AiProviderFormValue {
  enabled: boolean;
  baseUrl: string;
}

export interface AiProviderCardProps {
  provider: AiAdminProvider;
  value: AiProviderFormValue;
  onChange: (next: AiProviderFormValue) => void;
  canWrite: boolean;
  /** Field-level error for `baseUrl`, if the page's validation found one. */
  baseUrlError?: string;

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
}

export function AiProviderCard({
  provider,
  value,
  onChange,
  canWrite,
  baseUrlError,
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
  const [removeOpen, setRemoveOpen] = useState(false);

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

  const handleRemove = async () => {
    const ok = await onRemoveKey();
    if (ok) setRemoveOpen(false);
  };

  // A provider with no adapter in this build (`registered: false`) exists
  // only as a settings row: it can be switched OFF, never on, and a key for
  // it cannot be verified or tested because there is nothing to call.
  const unregistered = !provider.registered;

  const testBlockedReason = !canWrite
    ? 'Testing asks the provider to do work, so it needs ai_config:write.'
    : unregistered
      ? 'This provider is not available in this build, so there is nothing to test.'
      : !typedKey && !status.configured
        ? 'Type a key to test it — none is stored yet.'
        : null;

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
        sx={{ mt: 2, '&::before': { display: 'none' }, backgroundColor: 'transparent' }}
      >
        <AccordionSummary
          expandIcon={<ExpandMoreIcon />}
          aria-controls={`ai-provider-${provider.id}-advanced`}
          sx={{ px: 0 }}
        >
          <Typography variant="subtitle2">Advanced</Typography>
        </AccordionSummary>
        <AccordionDetails sx={{ px: 0 }} id={`ai-provider-${provider.id}-advanced`}>
          <TextField
            fullWidth
            label="Base URL"
            value={value.baseUrl}
            onChange={(e) => onChange({ ...value, baseUrl: e.target.value })}
            disabled={!canWrite}
            error={!!baseUrlError}
            helperText={
              baseUrlError ??
              "Leave blank to use the provider's default endpoint. Set one only for a proxy or a compatible gateway."
            }
          />
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
            : keyHelperText(status)
        }
      />

      <Box
        sx={{
          mt: 2,
          display: 'flex',
          flexDirection: { xs: 'column', sm: 'row' },
          alignItems: { xs: 'stretch', sm: 'center' },
          gap: 1.5,
          flexWrap: 'wrap',
        }}
      >
        <Button
          variant="contained"
          startIcon={<SaveOutlinedIcon />}
          onClick={() => void handleSaveKey()}
          disabled={!canWrite || unregistered || !typedKey || keyTooShort || busy}
        >
          {keyAction === 'save' ? 'Verifying…' : 'Save key'}
        </Button>
        <Button
          variant="outlined"
          startIcon={<NetworkCheckIcon />}
          onClick={() => onTest(typedKey)}
          disabled={!!testBlockedReason || keyTooShort || busy}
        >
          {isProbing ? 'Testing…' : 'Test'}
        </Button>
        <Button
          color="error"
          startIcon={<DeleteOutlineIcon />}
          onClick={() => setRemoveOpen(true)}
          disabled={!canWrite || !status.configured || busy}
        >
          Remove key
        </Button>
        <Box sx={{ flexGrow: 1 }} />
        {aiEnabled ? (
          <Button component={RouterLink} to="/admin/settings/ai/models">
            Manage models →
          </Button>
        ) : (
          <Typography variant="body2" color="text.secondary">
            Switch AI on and save to manage models.
          </Typography>
        )}
      </Box>
      <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
        {testBlockedReason ??
          'Save key verifies the key with the provider before storing it. Test checks the typed key, or the stored one when the box is empty, and stores nothing.'}
      </Typography>

      {keyError && !removeOpen && (
        <Alert severity="error" sx={{ mt: 2 }} onClose={onClearKeyError}>
          <AlertTitle>Could not save the key</AlertTitle>
          {keyError}
        </Alert>
      )}

      {probeError && (
        <Alert severity="error" sx={{ mt: 2 }} onClose={onClearProbeError}>
          <AlertTitle>The request itself failed</AlertTitle>
          {probeError}
        </Alert>
      )}

      {testResult && (
        <Box sx={{ mt: 2 }}>
          <AiProbeResult result={testResult} onClose={onClearTestResult} />
        </Box>
      )}

      <AiKeyRemoveDialog
        open={removeOpen}
        providerName={provider.displayName}
        isWorking={keyAction === 'remove'}
        error={removeOpen ? keyError : null}
        onConfirm={() => void handleRemove()}
        onClose={() => {
          setRemoveOpen(false);
          onClearKeyError();
        }}
      />
    </Paper>
  );
}
