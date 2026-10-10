/**
 * The SMTP block of `/admin/settings/email` (issue #124; a panel since PP-14.8).
 *
 * MOVED VERBATIM out of `EmailSettingsPage`: the markup, the copy and the
 * helper-text rules are the page's own as they were before the transports
 * became pluggable, and `test/email/EmailSettingsPage.builtin-dom.test.tsx`
 * proves the rendered DOM did not move. The page hands it the transport's
 * settings (`host`, `port`, `useTls`, `username`), the typed write-only
 * `password` and its masked status, and it reports edits back.
 *
 * `port` is edited as TEXT (`toForm` / `toInput` below convert), because a
 * number-typed control cannot hold the intermediate empty value a user passes
 * through while retyping a port: binding it to a `number` makes the field
 * impossible to clear, which reads as a broken input.
 */

import { Divider, FormControlLabel, Grid, Switch, TextField, Typography } from '@mui/material';
import type { EmailCredentialStatusDto } from '@marinoscar/platform-contract/email';

import type { EmailTransportPanelOptions, EmailTransportPanelProps } from './emailTransportPanelRegistry.js';

const DEFAULT_SMTP_PORT = 587;

const text = (value: unknown): string => (typeof value === 'string' ? value : '');

/**
 * The port as the API wants it: a number, or `''` for "not configured".
 *
 * `Number('')` is 0 and `Number('abc')` is NaN, and both would reach the wire
 * as something wrong — 0 is below the schema's minimum, and NaN JSON-serialises
 * to `null`. Anything that is not a whole number in range becomes the explicit
 * empty box instead; `validate` is what stops a bad value being submitted while
 * it actually matters.
 */
function toPortValue(raw: string): number | '' {
  const trimmed = raw.trim();
  if (!trimmed) return '';
  const port = Number(trimmed);
  return Number.isInteger(port) && port >= 1 && port <= 65535 ? port : '';
}

/**
 * What to say about the stored SMTP password. `hint` is the credential store's
 * own mask (`••••` plus at most the last four characters), derived on write by
 * the code that held the plaintext. It beats a fixed placeholder outright: an
 * admin who has just rotated a credential can see WHICH one is live, not merely
 * that one exists. It can still be null, so the sentence is assembled to read
 * correctly without it.
 */
function smtpPasswordHelperText(status: EmailCredentialStatusDto): string {
  if (!status.configured) {
    return 'No password is saved yet. Leave blank if this server does not need one.';
  }
  const which = status.hint ? ` (${status.hint})` : '';
  const when = status.updatedAt ? `, last changed ${new Date(status.updatedAt).toLocaleDateString()}` : '';
  return `A password is saved${which}${when}. Leave this blank to keep it, or type a new one to replace it.`;
}

const NOT_SAVED: EmailCredentialStatusDto = { configured: false, hint: null, updatedAt: null, updatedByUserId: null };

/**
 * Client-side checks of the SMTP settings. The FORMAT rule runs whether or not
 * email is switched on, because the API's does; the REQUIRED rules run only
 * when mail is actually being sent: a deployment that has turned email off must
 * not be blocked from saving that fact by an empty host it will never use.
 */
export const validateSmtpSettings: NonNullable<EmailTransportPanelOptions['validate']> = (value, { enabled }) => {
  const errors: Record<string, string> = {};

  const port = text(value.port).trim();
  if (port && toPortValue(port) === '') {
    errors.port = 'Port must be a whole number between 1 and 65535.';
  }

  if (!enabled) return errors;

  if (!text(value.host).trim()) errors.host = 'A host is required.';
  if (!port) errors.port = 'A port is required.';
  return errors;
};

/** The settings the API stored, in the shape the panel edits: the port as text. An absent port renders as the STARTTLS default. */
export const smtpSettingsToForm: NonNullable<EmailTransportPanelOptions['toForm']> = (settings) => ({
  host: text(settings.host),
  port: typeof settings.port === 'number' ? String(settings.port) : String(DEFAULT_SMTP_PORT),
  // ABSENT MEANS TRUE, matching the transport (`useTls ?? true`). Defaulting
  // the toggle to off here would show every unconfigured deployment a screen
  // claiming TLS is not required when in fact it is.
  useTls: typeof settings.useTls === 'boolean' ? settings.useTls : true,
  username: text(settings.username),
});

/** The settings the API stores for `smtp`: text trimmed, the port a number (the default when left blank). */
export const smtpSettingsToInput: NonNullable<EmailTransportPanelOptions['toInput']> = (value) => ({
  host: text(value.host).trim(),
  port: toPortValue(text(value.port)) || DEFAULT_SMTP_PORT,
  useTls: value.useTls !== false,
  username: text(value.username).trim(),
});

/**
 * The panel the admin email page draws for the `smtp` transport.
 *
 * @param props - see {@link EmailTransportPanelProps}.
 * @returns the panel.
 *
 * @extensionPoint component
 * @stability experimental
 */
export function SmtpTransportPanel({ value, onChange, secrets, onSecretChange, secretStatuses, errors, canWrite }: EmailTransportPanelProps) {
  const status = secretStatuses.password ?? NOT_SAVED;

  return (
    <>
      <Divider sx={{ my: 3 }} />
      <Typography variant="h6" gutterBottom>
        SMTP
      </Typography>
      <Grid container spacing={2}>
        <Grid size={{ xs: 12, sm: 8 }}>
          <TextField
            fullWidth
            label="Host"
            value={text(value.host)}
            onChange={(e) => onChange('host', e.target.value)}
            disabled={!canWrite}
            error={!!errors.host}
            helperText={errors.host ?? 'e.g. smtp.example.com'}
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 4 }}>
          <TextField
            fullWidth
            label="Port"
            // `inputMode` rather than `type="number"`: a number
            // input adds spinners nobody wants on a port and lets
            // the browser hand back an empty string for "1e5",
            // which validates as blank rather than as invalid.
            slotProps={{ htmlInput: { inputMode: 'numeric', pattern: '[0-9]*' } }}
            value={text(value.port)}
            onChange={(e) => onChange('port', e.target.value)}
            disabled={!canWrite}
            error={!!errors.port}
            helperText={errors.port ?? '587 for STARTTLS, 465 for implicit TLS.'}
          />
        </Grid>
        <Grid size={{ xs: 12 }}>
          <FormControlLabel
            control={
              <Switch checked={value.useTls !== false} onChange={(e) => onChange('useTls', e.target.checked)} disabled={!canWrite} />
            }
            label="Require TLS"
          />
          {/* THIS IS NOT THE "implicit TLS" FLAG. The API works
              that out from the port itself (465 is TLS from the
              first byte), so the only question left for an admin
              is whether an unencrypted connection is acceptable —
              and the answer is on by default, because a missing
              key in a stored blob must not be why a mail password
              crosses the network in the clear. */}
          <Typography variant="body2" color="text.secondary" sx={{ ml: 6, mt: -0.5 }}>
            On by default, and refuses to send over an unencrypted connection: port 465 is TLS from the first byte, every other port
            must complete STARTTLS. Turn this off only for a legacy relay that cannot do either.
          </Typography>
        </Grid>
        <Grid size={{ xs: 12, sm: 6 }}>
          <TextField
            fullWidth
            label="Username"
            value={text(value.username)}
            onChange={(e) => onChange('username', e.target.value)}
            disabled={!canWrite}
            autoComplete="off"
            helperText="Leave blank for a relay that authorises by source IP."
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 6 }}>
          {/* THE BLANK-PRESERVES CONTRACT, SAID OUT LOUD (#124,
              #115). The field renders empty because the stored
              password is encrypted and unreadable — not because
              there is nothing stored. An empty box that silently
              means "keep" confuses; one that silently means "erase"
              destroys. So the helper text states which it is, and
              the password's status — the only non-secret thing the
              API says about the password — decides the wording, so
              the sentence is never a guess. Its `hint` is the
              store's own mask, which names WHICH credential is
              live rather than only that one exists. */}
          <TextField
            fullWidth
            type="password"
            label="Password"
            value={secrets.password ?? ''}
            onChange={(e) => onSecretChange('password', e.target.value)}
            disabled={!canWrite}
            // A password manager filling this box would silently
            // re-send a credential the admin never typed.
            autoComplete="new-password"
            placeholder={status.configured ? (status.hint ?? '••••••••') : ''}
            helperText={smtpPasswordHelperText(status)}
          />
        </Grid>
      </Grid>
    </>
  );
}
