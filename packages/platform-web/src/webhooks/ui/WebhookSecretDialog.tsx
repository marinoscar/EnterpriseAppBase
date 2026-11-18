// =============================================================================
// The signing secret, shown once (issue #1046)
// =============================================================================
//
// The same arrangement as the node credential and personal access token
// reveal dialogs: a warning first, a read-only monospace field with a copy
// button, one "Done". The API stores the secret in the credentials store and
// never returns it again, so the copy states the consequence plainly. The
// secret lives in the page's state only while this dialog is open.
// =============================================================================

import CheckIcon from '@mui/icons-material/Check';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  InputAdornment,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import { useState, type ReactElement } from 'react';

import { formatDateTime, useDisplayTimeZone } from '../../core/index.js';

/**
 * The props of {@link WebhookSecretDialog}.
 *
 * @stability experimental
 */
export interface WebhookSecretDialogProps {
  /** The secret to show; `null` closes the dialog. */
  secret: string | null;
  /** Why it is shown: a new endpoint, or a rotation. */
  reason: 'created' | 'rotated';
  /** After a rotation: until when the previous secret is still accepted. */
  previousSecretValidUntil?: string | null;
  /** Closes the dialog (the caller drops the secret). */
  onClose: () => void;
}

/**
 * The one-time display of a webhook signing secret, with a copy button.
 *
 * @param props - see {@link WebhookSecretDialogProps}.
 * @returns the dialog.
 *
 * @extensionPoint component
 * @stability experimental
 */
export function WebhookSecretDialog({ secret, reason, previousSecretValidUntil, onClose }: WebhookSecretDialogProps): ReactElement {
  useDisplayTimeZone();
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    if (!secret) return;
    try {
      await navigator.clipboard.writeText(secret);
      setCopied(true);
    } catch {
      // Clipboard denied: the field stays complete and selectable.
    }
  };

  const close = () => {
    setCopied(false);
    onClose();
  };

  return (
    <Dialog open={secret !== null} onClose={close} maxWidth="sm" fullWidth aria-labelledby="webhook-secret-title">
      <DialogTitle id="webhook-secret-title">{reason === 'created' ? 'Endpoint created' : 'Secret rotated'}</DialogTitle>
      <DialogContent>
        <Box sx={{ pt: 1 }}>
          <Alert severity="warning" sx={{ mb: 2 }}>
            Copy this signing secret now. You won&apos;t see it again: if you lose it, rotate the secret to get a new one.
          </Alert>
          <TextField
            label="Signing secret"
            value={secret ?? ''}
            fullWidth
            slotProps={{
              input: {
                readOnly: true,
                sx: { fontFamily: 'monospace' },
                endAdornment: (
                  <InputAdornment position="end">
                    <Tooltip title={copied ? 'Copied' : 'Copy secret'}>
                      <IconButton onClick={() => void copy()} edge="end" aria-label="Copy signing secret" sx={{ width: 44, height: 44 }}>
                        {copied ? <CheckIcon color="success" /> : <ContentCopyIcon />}
                      </IconButton>
                    </Tooltip>
                  </InputAdornment>
                ),
              },
            }}
          />
          {copied ? (
            <Alert severity="success" sx={{ mt: 1 }}>
              Secret copied to the clipboard
            </Alert>
          ) : null}
          <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
            Your receiver uses it to verify the <code>webhook-signature</code> header of every delivery.
          </Typography>
          {reason === 'rotated' && previousSecretValidUntil ? (
            <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
              Deliveries are signed with both the old and the new secret until {formatDateTime(previousSecretValidUntil)}.
              Update your receiver before then.
            </Typography>
          ) : null}
        </Box>
      </DialogContent>
      <DialogActions>
        <Button variant="contained" onClick={close} sx={{ minHeight: 44 }}>
          Done
        </Button>
      </DialogActions>
    </Dialog>
  );
}
