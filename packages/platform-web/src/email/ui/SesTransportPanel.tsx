/**
 * The Amazon SES block of `/admin/settings/email` (issue #124, #585; a panel
 * since PP-14.8).
 *
 * MOVED VERBATIM out of `EmailSettingsPage`: the markup, the copy and the
 * helper-text rules are the page's own as they were before the transports
 * became pluggable, and `test/email/EmailSettingsPage.builtin-dom.test.tsx`
 * proves the rendered DOM did not move. What changed is where its state comes
 * from: the page hands it the transport's settings (`region`, `accessKeyId`),
 * the typed write-only secret (`secretAccessKey`) and the secret's masked
 * status, and it reports edits back.
 */

import { Divider, Grid, TextField, Typography } from '@mui/material';
import type { EmailCredentialStatusDto } from '@marinoscar/platform-contract/email';

import type { EmailTransportPanelOptions, EmailTransportPanelProps } from './emailTransportPanelRegistry.js';

const text = (value: unknown): string => (typeof value === 'string' ? value : '');

/**
 * What to say about the stored SES secret access key. This field is
 * BLANK-PRESERVES, so the box is honest about whether leaving it alone keeps
 * something or keeps nothing. `hint` is the credential store's own mask; it can
 * still be null (a secret too short to mask safely), so the sentence is
 * assembled to read correctly without it.
 */
function sesSecretAccessKeyHelperText(status: EmailCredentialStatusDto): string {
  if (!status.configured) {
    return 'No secret access key is saved yet. SES cannot send until one is.';
  }
  const which = status.hint ? ` (${status.hint})` : '';
  const when = status.updatedAt ? `, last changed ${new Date(status.updatedAt).toLocaleDateString()}` : '';
  return `A secret access key is saved${which}${when}. Leave this blank to keep it, or type a new one to replace it.`;
}

const NOT_SAVED: EmailCredentialStatusDto = { configured: false, hint: null, updatedAt: null, updatedByUserId: null };

/**
 * Client-side checks of the SES settings: the required rules apply only when
 * mail is switched on, exactly as the page's own did.
 */
export const validateSesSettings: NonNullable<EmailTransportPanelOptions['validate']> = (value, { enabled }) => {
  const errors: Record<string, string> = {};
  if (!enabled) return errors;

  if (!text(value.region).trim()) {
    errors.region = 'A region is required, e.g. us-east-1.';
  }
  // Access key ID is the visible/required half of the SES credential, exactly
  // like `host` for SMTP. The secret access key is the write-only,
  // blank-preserves half and is deliberately NOT checked here: blank means
  // "keep the stored one", which is a legal, even expected, state on every
  // load of this form.
  if (!text(value.accessKeyId).trim()) {
    errors.accessKeyId = 'An access key ID is required.';
  }
  return errors;
};

/** The settings the API stores for `ses`: the text trimmed. */
export const sesSettingsToInput: NonNullable<EmailTransportPanelOptions['toInput']> = (value) => ({
  region: text(value.region).trim(),
  accessKeyId: text(value.accessKeyId).trim(),
});

/**
 * The panel the admin email page draws for the `ses` transport.
 *
 * @param props - see {@link EmailTransportPanelProps}.
 * @returns the panel.
 *
 * @extensionPoint component
 * @stability experimental
 */
export function SesTransportPanel({ value, onChange, secrets, onSecretChange, secretStatuses, errors, canWrite }: EmailTransportPanelProps) {
  const status = secretStatuses.secretAccessKey ?? NOT_SAVED;

  return (
    <>
      <Divider sx={{ my: 3 }} />
      <Typography variant="h6" gutterBottom>
        Amazon SES
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Enter the AWS access key for a user or role authorised to call SES in the region below (issue #585 — these credentials are
        stored here, not read from the deployment's environment).
      </Typography>
      <Grid container spacing={2}>
        <Grid size={{ xs: 12, sm: 6 }}>
          <TextField
            fullWidth
            label="Access Key ID"
            value={text(value.accessKeyId)}
            onChange={(e) => onChange('accessKeyId', e.target.value)}
            disabled={!canWrite}
            autoComplete="off"
            error={!!errors.accessKeyId}
            helperText={errors.accessKeyId ?? 'e.g. AKIAIOSFODNN7EXAMPLE'}
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 6 }}>
          {/* THE BLANK-PRESERVES CONTRACT, SAID OUT LOUD — same shape as the
              SMTP password field, and for the same reason (#585). The field
              renders empty because the stored secret is encrypted and
              unreadable, not because nothing is stored. An empty box that
              silently means "keep" confuses; one that silently means "erase"
              destroys. So the helper text states which it is, and the secret's
              status — the only non-secret thing the API says about this
              credential — decides the wording, so the sentence is never a
              guess. Its `hint` is the store's own mask, which names WHICH
              credential is live rather than only that one exists. */}
          <TextField
            fullWidth
            type="password"
            label="Secret Access Key"
            value={secrets.secretAccessKey ?? ''}
            onChange={(e) => onSecretChange('secretAccessKey', e.target.value)}
            disabled={!canWrite}
            // A password manager filling this box would silently
            // re-send a credential the admin never typed.
            autoComplete="new-password"
            placeholder={status.configured ? (status.hint ?? '••••••••') : ''}
            helperText={sesSecretAccessKeyHelperText(status)}
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 6 }}>
          <TextField
            fullWidth
            label="Region"
            value={text(value.region)}
            onChange={(e) => onChange('region', e.target.value)}
            disabled={!canWrite}
            error={!!errors.region}
            helperText={
              errors.region ??
              'The region holding your verified sender identity, e.g. us-east-1. Leave blank to use the deployment default.'
            }
          />
        </Grid>
      </Grid>
    </>
  );
}
