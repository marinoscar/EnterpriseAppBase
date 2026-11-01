// =============================================================================
// Create or edit a webhook endpoint (issue #1046)
// =============================================================================
//
// Name, URL (with an https hint: the API refuses plain http unless the
// deployment allows it, and refuses private addresses), description, enabled
// and the events. The form checks only what helps the user type (required
// fields, a parsable URL, at least one event); the API validates everything.
// =============================================================================

import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  Stack,
  Switch,
  TextField,
  useMediaQuery,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import { useEffect, useState, type ReactElement } from 'react';

import {
  WEBHOOK_DESCRIPTION_MAX,
  WEBHOOK_NAME_MAX,
  WEBHOOK_URL_MAX,
} from '@marinoscar/platform-contract/webhooks';
import type { CreateWebhookEndpointInput, WebhookEndpoint } from '@marinoscar/platform-contract/webhooks';

import { isHttpsWebhookUrl, webhookEndpointStatus, type WebhookEventGroup } from '../headless/index.js';
import { WebhookEventPicker } from './WebhookEventPicker.js';

/**
 * The props of {@link WebhookEndpointDialog}.
 *
 * @stability experimental
 */
export interface WebhookEndpointDialogProps {
  /** Whether the dialog is open. */
  open: boolean;
  /** The endpoint to edit, or `null` to create one. */
  endpoint: WebhookEndpoint | null;
  /** The grouped event catalog. */
  groups: readonly WebhookEventGroup[];
  /** Whether the catalog is still loading. */
  catalogLoading?: boolean;
  /** A catalog load failure, in words. */
  catalogError?: string | null;
  /** Whether a save is in flight. */
  saving?: boolean;
  /** The API's refusal of the last save, in words. */
  error?: string | null;
  /** Saves the form; the caller closes the dialog once the API accepted it. */
  onSubmit: (input: CreateWebhookEndpointInput) => void;
  /** Closes without saving. */
  onClose: () => void;
}

function parsesAsHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
}

/**
 * The create and edit form of a webhook endpoint.
 *
 * @param props - see {@link WebhookEndpointDialogProps}.
 * @returns the dialog.
 *
 * @extensionPoint component
 * @stability experimental
 */
export function WebhookEndpointDialog({
  open,
  endpoint,
  groups,
  catalogLoading,
  catalogError,
  saving,
  error,
  onSubmit,
  onClose,
}: WebhookEndpointDialogProps): ReactElement {
  const theme = useTheme();
  const fullScreen = useMediaQuery(theme.breakpoints.down('sm'));
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [description, setDescription] = useState('');
  const [enabled, setEnabled] = useState(true);
  const [eventKeys, setEventKeys] = useState<string[]>([]);
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName(endpoint?.name ?? '');
    setUrl(endpoint?.url ?? '');
    setDescription(endpoint?.description ?? '');
    setEnabled(endpoint?.enabled ?? true);
    setEventKeys(endpoint ? [...endpoint.eventKeys] : []);
    setTouched(false);
  }, [open, endpoint]);

  const nameError = name.trim() === '' ? 'Give the endpoint a name.' : null;
  const urlError = !parsesAsHttpUrl(url.trim()) ? 'Enter the full URL, starting with https://.' : null;
  const eventsError = eventKeys.length === 0 ? 'Choose at least one event.' : null;
  const invalid = nameError !== null || urlError !== null || eventsError !== null;
  const platformDisabled = endpoint && !endpoint.enabled && endpoint.disabledReason ? webhookEndpointStatus(endpoint) : null;

  const submit = () => {
    setTouched(true);
    if (invalid) return;
    const trimmed = description.trim();
    onSubmit({
      name: name.trim(),
      url: url.trim(),
      description: trimmed === '' ? null : trimmed,
      enabled,
      eventKeys,
    });
  };

  const urlHelp =
    touched && urlError
      ? urlError
      : url.trim() !== '' && parsesAsHttpUrl(url.trim()) && !isHttpsWebhookUrl(url.trim())
        ? 'Use https:// - plain http is refused unless this deployment allows it for development.'
        : 'An https:// URL on the public internet. Private and internal addresses are refused.';

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth fullScreen={fullScreen} aria-labelledby="webhook-endpoint-title">
      <DialogTitle id="webhook-endpoint-title">{endpoint ? 'Edit endpoint' : 'New endpoint'}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          {error ? <Alert severity="error">{error}</Alert> : null}
          <TextField
            label="Name"
            required
            value={name}
            onChange={(event) => setName(event.target.value)}
            error={touched && nameError !== null}
            helperText={touched ? nameError : null}
            slotProps={{ htmlInput: { maxLength: WEBHOOK_NAME_MAX } }}
            fullWidth
          />
          <TextField
            label="URL"
            required
            type="url"
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            placeholder="https://receiver.example.test/hook"
            error={touched && urlError !== null}
            helperText={urlHelp}
            slotProps={{ htmlInput: { maxLength: WEBHOOK_URL_MAX } }}
            fullWidth
          />
          <TextField
            label="Description"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            multiline
            minRows={2}
            slotProps={{ htmlInput: { maxLength: WEBHOOK_DESCRIPTION_MAX } }}
            fullWidth
          />
          <FormControlLabel
            control={<Switch checked={enabled} onChange={(event) => setEnabled(event.target.checked)} />}
            label="Enabled"
          />
          {platformDisabled && enabled ? (
            <Alert severity="info">
              {platformDisabled.label}. Saving with Enabled on switches it back on and resets the failure count.
            </Alert>
          ) : null}
          {catalogError ? <Alert severity="error">{catalogError}</Alert> : null}
          {catalogLoading ? null : (
            <WebhookEventPicker
              groups={groups}
              value={eventKeys}
              onChange={setEventKeys}
              error={touched ? eventsError : null}
            />
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} sx={{ minHeight: 44 }}>
          Cancel
        </Button>
        <Button variant="contained" onClick={submit} disabled={saving} sx={{ minHeight: 44 }}>
          {endpoint ? 'Save' : 'Create endpoint'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
