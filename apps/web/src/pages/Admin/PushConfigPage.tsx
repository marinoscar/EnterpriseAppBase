/**
 * Admin → Settings → Web Push (`/admin/settings/push`).
 *
 * Issue #355. A STANDALONE PAGE, exactly like `EmailSettingsPage.tsx` and for
 * the same reason: this hits its own controller (`/api/admin/push-config`)
 * with its own document, not the generic `system_settings` blob `SettingsHub`
 * pages share — see `CLAUDE.md`'s "MANDATORY: Settings UI Pattern" §2 and
 * `docs/specs/settings-ui.md`. One entry in `ADMIN_SECTIONS`
 * (`config/adminSections.tsx`), one route in `App.tsx` gated on the same
 * `push:read` string, no tab anywhere.
 *
 * =============================================================================
 * THE PRIVATE KEY NEVER APPEARS HERE. THE PUBLIC KEY IS SHOWN IN FULL.
 * =============================================================================
 *
 * `PushConfigAdminView.privateKeyStatus` is the masked view `SmtpPasswordStatus`
 * already established the shape for — a hint, a timestamp, who set it, never
 * the secret itself. `publicKey`, by contrast, is NOT secret: it is what a
 * client-side `pushManager.subscribe()` call is given, so it is rendered in
 * full, monospace, with a copy affordance, the same treatment
 * `DbBackupRestoreDialog`'s `CopyableBlock` gives a paste-ready command.
 *
 * THIS COMMIT: the status panel (always shown, read-only) and the empty-state
 * generate flow (`POST /generate`). The configured-state enable/disable
 * switch, subject editing and the rotate/remove confirmation dialogs land in
 * the next commit.
 */

import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import {
  Alert,
  AlertTitle,
  Box,
  Button,
  Chip,
  Container,
  IconButton,
  Paper,
  Snackbar,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import CheckIcon from '@mui/icons-material/Check';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import VpnKeyOutlinedIcon from '@mui/icons-material/VpnKeyOutlined';
import { Navigate } from 'react-router-dom';
import { usePermissions } from '../../hooks/usePermissions';
import { usePushConfig } from '../../hooks/usePushConfig';
import { LoadingSpinner } from '../../components/common/LoadingSpinner';

/** A `mailto:` or `https:` address — the VAPID subject/contact, exactly what `web-push` requires. */
function validateSubject(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null; // Optional — the API falls back to a default.
  if (!/^mailto:[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed) && !/^https:\/\/\S+$/.test(trimmed)) {
    return 'Must be a mailto: address or an https: URL, e.g. mailto:admin@example.com.';
  }
  return null;
}

/** What to say about the stored private key, mirroring `smtpPasswordHelperText` in `EmailSettingsPage.tsx`. */
function privateKeyProvenance(status: {
  configured: boolean;
  hint: string | null;
  updatedAt: string | null;
  updatedByUserId: string | null;
}): string {
  if (!status.configured) return 'No private key is stored.';
  const which = status.hint ? ` (${status.hint})` : '';
  const when = status.updatedAt ? ` on ${new Date(status.updatedAt).toLocaleString()}` : '';
  const who = status.updatedByUserId ? ` by user ${status.updatedByUserId}` : '';
  return `Private key last set${which}${when}${who}.`;
}

/** A single-line monospace value with a copy affordance — the public key is not secret, so it renders in full. */
function CopyableField({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 3000);
    } catch {
      // Clipboard access denied or unavailable — the field is still selectable text.
    }
  };

  return (
    <Box>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mb: 0.5 }}>
        <Typography variant="subtitle2" sx={{ flexGrow: 1 }}>
          {label}
        </Typography>
        <Tooltip title={copied ? 'Copied' : `Copy ${label.toLowerCase()}`}>
          <IconButton size="small" onClick={() => void handleCopy()} aria-label={`Copy ${label}`}>
            {copied ? <CheckIcon fontSize="small" color="success" /> : <ContentCopyIcon fontSize="small" />}
          </IconButton>
        </Tooltip>
      </Stack>
      <Paper
        variant="outlined"
        sx={{ p: 1.5, overflowX: 'auto', backgroundColor: 'action.hover' }}
      >
        <Typography
          component="pre"
          sx={{ m: 0, fontFamily: 'monospace', fontSize: '0.8125rem', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}
        >
          {value}
        </Typography>
      </Paper>
    </Box>
  );
}

export default function PushConfigPage() {
  const { hasPermission } = usePermissions();
  const { config, isLoading, loadError, isActing, actionError, clearActionError, generate } =
    usePushConfig();

  // Draft state for the EMPTY-state subject field (feeds `generate`).
  const [generateSubject, setGenerateSubject] = useState('');
  const [savedMessage, setSavedMessage] = useState<string | null>(null);

  // Reset the draft whenever the config transitions back to unconfigured
  // (e.g. after a Remove in a future commit), so a stale subject is not
  // silently resubmitted on the next Generate.
  useEffect(() => {
    if (config && !config.configured) setGenerateSubject('');
  }, [config]);

  // Defence, not the gate — `App.tsx` wraps the route in `RequirePermission`
  // with this same string. This one catches the page mounted from anywhere
  // else. It sits after every hook so the hook order never changes.
  if (!hasPermission('push:read')) {
    return <Navigate to="/" replace />;
  }

  const canWrite = hasPermission('push:write');

  if (isLoading || !config) {
    if (loadError) {
      return (
        <Container maxWidth="lg">
          <Box sx={{ py: 4 }}>
            <Typography variant="h4" component="h1" gutterBottom>
              Web Push
            </Typography>
            <Alert severity="error">{loadError}</Alert>
          </Box>
        </Container>
      );
    }
    return <LoadingSpinner />;
  }

  const generateSubjectError = validateSubject(generateSubject);

  const handleGenerate = async (event: FormEvent) => {
    event.preventDefault();
    if (generateSubjectError || !canWrite) return;
    const trimmed = generateSubject.trim();
    const ok = await generate(trimmed ? { subject: trimmed } : {});
    if (ok) setSavedMessage('Web push generated and enabled');
  };

  return (
    <Container maxWidth="lg">
      <Box sx={{ py: 4 }}>
        {/* Title and description MIRROR the `Web Push` card in
            `config/adminSections.tsx`, exactly as `EmailSettingsPage` does for
            `Email`. */}
        <Typography variant="h4" component="h1" gutterBottom>
          Web Push
        </Typography>
        <Typography color="text.secondary" sx={{ mb: 2 }}>
          Generate a VAPID key pair, enable or rotate it, and control whether this deployment can
          send browser push notifications.
          {!canWrite && ' (read-only)'}
        </Typography>

        {loadError && (
          <Alert severity="error" sx={{ mb: 3 }}>
            {loadError}
          </Alert>
        )}

        {/* A STORED ROW THAT WOULD NOT PARSE — mirrors `EmailSettingsPage`'s
            treatment of `settingsError`. The page still works; the data
            behind it does not, so the fields below are defaults. */}
        {config.settingsError && (
          <Alert severity="warning" sx={{ mb: 3 }}>
            <AlertTitle>The stored web push configuration could not be read</AlertTitle>
            {config.settingsError}
            <Box sx={{ mt: 1 }}>
              Until it is repaired, the fields below are defaults rather than your saved values.
            </Box>
          </Alert>
        )}

        {/* ==================================================================
            STATUS PANEL — always shown, read-only.
            =============================================================== */}
        <Paper sx={{ p: { xs: 2, sm: 3 } }}>
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mb: 2 }}>
            <VpnKeyOutlinedIcon color="action" />
            <Typography variant="h6" sx={{ flexGrow: 1 }}>
              Status
            </Typography>
            {!config.configured ? (
              <Chip label="Not configured" color="default" size="small" />
            ) : config.enabled ? (
              <Chip label="Enabled" color="success" size="small" />
            ) : (
              <Chip label="Disabled" color="warning" size="small" />
            )}
          </Stack>

          {config.configured && config.publicKey ? (
            <Stack spacing={2}>
              <CopyableField label="Public key" value={config.publicKey} />
              <Typography variant="body2" color="text.secondary">
                Subject: {config.subject || 'not set'}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {privateKeyProvenance(config.privateKeyStatus)}
              </Typography>
            </Stack>
          ) : (
            <Typography variant="body2" color="text.secondary">
              No key pair has been generated yet. Web push is unavailable to every user until one
              is.
            </Typography>
          )}

          {config.updatedAt && (
            <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
              Last updated {new Date(config.updatedAt).toLocaleString()}
              {config.updatedBy ? ` by ${config.updatedBy}` : ''}
            </Typography>
          )}
        </Paper>

        {/* ==================================================================
            EMPTY STATE — nothing configured yet.
            =============================================================== */}
        {!config.configured && (
          <Paper sx={{ mt: 3, p: { xs: 2, sm: 3 } }}>
            <Box component="form" onSubmit={handleGenerate} noValidate>
              <Typography variant="h6" gutterBottom>
                Generate a key pair
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                Creates a new VAPID key pair and switches web push on immediately. This is a
                one-time action for a fresh deployment — once a key pair exists, use Rotate to
                replace it.
              </Typography>
              <TextField
                fullWidth
                label="Subject (contact address)"
                placeholder="mailto:admin@example.com"
                value={generateSubject}
                onChange={(e) => setGenerateSubject(e.target.value)}
                disabled={!canWrite || isActing}
                error={!!generateSubjectError}
                helperText={
                  generateSubjectError ??
                  'A mailto: address or an https: URL push services may contact if something goes wrong. Optional — leave blank for the deployment default.'
                }
                sx={{ mb: 2 }}
              />
              {actionError && (
                <Alert severity="error" sx={{ mb: 2 }} onClose={clearActionError}>
                  {actionError}
                </Alert>
              )}
              <Button
                type="submit"
                variant="contained"
                disabled={!canWrite || isActing || !!generateSubjectError}
              >
                {isActing ? 'Generating…' : 'Generate & enable'}
              </Button>
            </Box>
          </Paper>
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
