/**
 * The immediate key actions of an AI provider card — Save key, Test, Remove
 * key, the typed-`REMOVE` confirmation and the alerts they raise — shared by
 * the bespoke built-in card (`AiProviderCard`) and the generic card
 * (`AiGenericProviderCard`, issue #924). The JSX is the bespoke card's own,
 * moved here unchanged, so the built-in cards' DOM did not move.
 *
 * The typed key itself is NOT held here: it stays in the card, write-only and
 * short-lived (see `AiProviderCard`'s header). This component receives it
 * only to decide which buttons are enabled.
 */

import { useEffect, useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import {
  Alert,
  AlertTitle,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  TextField,
  Typography,
} from '@mui/material';
import NetworkCheckIcon from '@mui/icons-material/NetworkCheck';
import SaveOutlinedIcon from '@mui/icons-material/SaveOutlined';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlined';
import { AI_KEY_REMOVE_CONFIRMATION } from '../../headless/types.js';
import type { AiProbeResult as AiProbeResultData, SecretStatus } from '../../headless/types.js';
import { AiProbeResult } from './AiProbeResult.js';

/** The API's minimum key length (`PUT …/key` body, `min(8)`). */
export const MIN_KEY_LENGTH = 8;

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


export interface AiProviderKeyActionsProps {
  providerName: string;
  canWrite: boolean;
  /** No adapter in this build: nothing to verify or test against. */
  unregistered: boolean;
  /** The stored key's masked status. */
  status: SecretStatus;
  /** The key as typed, trimmed. */
  typedKey: string;
  keyTooShort: boolean;
  /** The SAVED setting says this server is keyless: a test needs no key. */
  savedKeyless: boolean;
  busy: boolean;
  keyAction: 'save' | 'remove' | null;
  isProbing: boolean;
  /** Whether AI is switched on in the SAVED configuration. */
  aiEnabled: boolean;
  keyError: string | null;
  onClearKeyError: () => void;
  probeError: string | null;
  onClearProbeError: () => void;
  testResult: AiProbeResultData | null;
  onClearTestResult: () => void;
  onSave: () => void;
  /** Resolves `true` when the key was removed. */
  onRemove: () => Promise<boolean>;
  onTest: () => void;
}

export function AiProviderKeyActions({
  providerName,
  canWrite,
  unregistered,
  status,
  typedKey,
  keyTooShort,
  savedKeyless,
  busy,
  keyAction,
  isProbing,
  aiEnabled,
  keyError,
  onClearKeyError,
  probeError,
  onClearProbeError,
  testResult,
  onClearTestResult,
  onSave,
  onRemove,
  onTest,
}: AiProviderKeyActionsProps) {
  const [removeOpen, setRemoveOpen] = useState(false);

  const handleRemove = async () => {
    const ok = await onRemove();
    if (ok) setRemoveOpen(false);
  };

  const testBlockedReason = !canWrite
    ? 'Testing asks the provider to do work, so it needs ai_config:write.'
    : unregistered
      ? 'This provider is not available in this build, so there is nothing to test.'
      : !typedKey && !status.configured && !savedKeyless
        ? 'Type a key to test it — none is stored yet.'
        : null;

  return (
    <>
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
          onClick={onSave}
          disabled={!canWrite || unregistered || !typedKey || keyTooShort || busy}
        >
          {keyAction === 'save' ? 'Verifying…' : 'Save key'}
        </Button>
        <Button
          variant="outlined"
          startIcon={<NetworkCheckIcon />}
          onClick={onTest}
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
        providerName={providerName}
        isWorking={keyAction === 'remove'}
        error={removeOpen ? keyError : null}
        onConfirm={() => void handleRemove()}
        onClose={() => {
          setRemoveOpen(false);
          onClearKeyError();
        }}
      />
    </>
  );
}
