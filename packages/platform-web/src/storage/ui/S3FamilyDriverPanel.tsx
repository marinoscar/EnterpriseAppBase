/**
 * The bespoke form of the three built-in drivers (`s3`, `r2`, `s3compatible`)
 * on the admin storage page (issue #376; a registered panel since PP-14.7,
 * #925).
 *
 * This is the markup the page has always drawn between the provider radios and
 * the save bar, moved here verbatim so the built-ins register through the same
 * `registerStorageDriverPanel` an app uses and their DOM does not move: the
 * bucket and region grid, the block that belongs to the selected flavour, the
 * credentials, and the three-option path-style control. Its header comments
 * stay with the code they explain.
 *
 * =============================================================================
 * THE SECRET ACCESS KEY IS WRITE-ONLY, AND BLANK PRESERVES
 * =============================================================================
 *
 * The page holds it OUTSIDE the settings (`secrets`), because it is not a value
 * this page ever read — it is a write-only instruction. The field renders empty
 * because the stored key is encrypted and unreadable, never because nothing is
 * stored, so `config.secretStatus` — the only non-secret thing the API says
 * about it — writes the helper text rather than a fixed placeholder guessing at
 * it.
 *
 * =============================================================================
 * `forcePathStyle` IS THREE-STATE, AND A SWITCH CANNOT SAY IT
 * =============================================================================
 *
 * `boolean | null`, where `null` is "use this vendor's convention" — path style
 * for `s3compatible`, virtual-host style for `s3` and `r2`. That is NOT the
 * same as `false`, and #374 shipped the bug that proves it: a `false` nobody
 * chose reached the driver as an operator's explicit answer, suppressed the
 * vendor default and broke MinIO. A two-position `Switch` has no way to render
 * "unset", so the control is a three-option radio group, and `null` is a
 * first-class, selectable answer.
 */

import {
  Button,
  Divider,
  FormControl,
  FormControlLabel,
  FormHelperText,
  FormLabel,
  Grid,
  Radio,
  RadioGroup,
  TextField,
  Typography,
} from '@mui/material';

import type { StorageSecretStatus } from '../headless/index.js';
import type { StorageDriverPanelProps } from './storageDriverPanelRegistry.js';

/** Mirrors `deriveR2Endpoint` / `R2_ENDPOINT_HOST_SUFFIX` in `@marinoscar/platform-api/storage` (`drivers/s3/s3-config.ts`). */
const R2_ENDPOINT_HOST_SUFFIX = 'r2.cloudflarestorage.com';

function deriveR2Endpoint(accountId: string): string {
  return `https://${accountId.trim()}.${R2_ENDPOINT_HOST_SUFFIX}`;
}

/** The API's own ceilings (the built-in drivers' settings schemas), so the obvious typo does not round-trip. */
const MAX_FIELD_LENGTH = 255;
const MAX_ENDPOINT_LENGTH = 512;

/**
 * The three answers `forcePathStyle` can hold, as radio values.
 *
 * The mapping is the whole point of this table: `'vendor'` is `null`, and it is
 * a REAL saved value meaning "I have not overridden this", not the absence of
 * an answer. See the file header for why a `Switch` cannot express it.
 */
const FORCE_PATH_STYLE_CHOICES = {
  vendor: null,
  on: true,
  off: false,
} as const;

type ForcePathStyleChoice = keyof typeof FORCE_PATH_STYLE_CHOICES;

function forcePathStyleChoice(value: boolean | null): ForcePathStyleChoice {
  if (value === null) return 'vendor';
  return value ? 'on' : 'off';
}

/**
 * What the vendor convention actually IS for the selected provider, named in
 * prose next to the control.
 *
 * "Use this vendor's convention" is meaningless on its own — an operator
 * choosing it deserves to know what they just chose. The two answers come from
 * `buildS3ClientConfig` on the API side, which is the only place that knows
 * them; this sentence reports that table rather than duplicating the decision.
 */
function vendorConventionFor(provider: string): string {
  return provider === 's3compatible'
    ? 'path-style addressing (https://host/bucket/key)'
    : 'virtual-host addressing (https://bucket.host/key)';
}

/** A string setting, `''` when absent. */
function text(value: Readonly<Record<string, unknown>>, name: string): string {
  const raw = value[name];
  return typeof raw === 'string' ? raw : '';
}

/** `forcePathStyle` as the tri-state it is: anything but a boolean is "vendor convention". */
function triState(value: Readonly<Record<string, unknown>>): boolean | null {
  return typeof value.forcePathStyle === 'boolean' ? value.forcePathStyle : null;
}

/**
 * What to say about the stored secret access key.
 *
 * `hint` is the credential store's own mask, derived on write by the code that
 * held the plaintext. It beats a fixed placeholder outright: an admin who has
 * just rotated a key can see WHICH one is live, not merely that one exists. It
 * can still be null — for a secret too short to mask safely, or a row written
 * outside `CredentialsService` — so the sentence is assembled to read correctly
 * without it rather than assuming it is there. Mirrors
 * `smtpPasswordHelperText` in `EmailSettingsPage`.
 */
function secretHelperText(status: StorageSecretStatus): string {
  if (!status.configured) {
    return 'No secret access key is stored yet. Storage cannot work without one.';
  }
  const which = status.hint ? ` (${status.hint})` : '';
  const when = status.updatedAt
    ? `, last changed ${new Date(status.updatedAt).toLocaleDateString()}`
    : '';
  return `A secret access key is saved${which}${when}. Leave this blank to keep it, or type a new one to replace it.`;
}

/**
 * Field-level validation of the S3 family's settings, client-side only and
 * deliberately thin.
 *
 * The API validates for real — it must, since this page is not the only
 * possible caller — and this exists to stop the obvious typo round-tripping.
 * NOTE WHAT IS NOT REQUIRED: an empty `bucket` is how a deployment is
 * un-configured, so blanking the form is a legitimate save rather than an
 * error. What IS checked is anything that would produce a confusing failure
 * several layers down: an endpoint that is not a URL (the S3 client rejects it
 * at construction, far from this form), and an R2 account id missing while a
 * bucket is named (the endpoint would be derived from an empty string and the
 * request would go to a host that cannot exist).
 *
 * @param provider - `s3`, `r2` or `s3compatible`.
 * @param value - that driver's settings as edited.
 * @returns the error text by setting name; empty when there is nothing to fix.
 */
export function validateS3FamilySettings(
  provider: string,
  value: Readonly<Record<string, unknown>>,
): Record<string, string> {
  const errors: Record<string, string> = {};

  const bucket = text(value, 'bucket').trim();
  const region = text(value, 'region').trim();
  const accessKeyId = text(value, 'accessKeyId').trim();

  if (bucket.length > MAX_FIELD_LENGTH) {
    errors.bucket = `Keep the bucket name to ${MAX_FIELD_LENGTH} characters or fewer.`;
  }
  if (region.length > MAX_FIELD_LENGTH) {
    errors.region = `Keep the region to ${MAX_FIELD_LENGTH} characters or fewer.`;
  }
  if (accessKeyId.length > MAX_FIELD_LENGTH) {
    errors.accessKeyId = `Keep the access key id to ${MAX_FIELD_LENGTH} characters or fewer.`;
  }

  const endpoint = text(value, 'endpoint').trim();
  if (endpoint) {
    if (endpoint.length > MAX_ENDPOINT_LENGTH) {
      errors.endpoint = `Keep the endpoint to ${MAX_ENDPOINT_LENGTH} characters or fewer.`;
    } else if (!/^https?:\/\/\S+$/i.test(endpoint)) {
      errors.endpoint = 'Must be a full URL, e.g. https://minio.example.com:9000.';
    }
  }

  if (provider === 's3compatible' && bucket && !endpoint) {
    errors.endpoint = 'An S3-compatible provider needs an endpoint — there is no default host.';
  }

  if (provider === 'r2') {
    const accountId = text(value, 'accountId').trim();
    if (!accountId && bucket && !endpoint) {
      errors.accountId = 'R2 needs an account id — the endpoint is derived from it.';
    }
    if (accountId.length > MAX_FIELD_LENGTH) {
      errors.accountId = `Keep the account id to ${MAX_FIELD_LENGTH} characters or fewer.`;
    }
  }

  if (provider === 's3' && bucket && !region) {
    errors.region = 'Amazon S3 needs a region, e.g. us-east-1.';
  }

  return errors;
}

/**
 * The form of the three built-in S3-family drivers: what the admin storage page
 * has always drawn for them, registered as their panel.
 *
 * @param props - see {@link StorageDriverPanelProps}.
 * @returns the form fields (a fragment, so the markup around it is the page's).
 *
 * @extensionPoint component
 * @stability experimental
 */
export function S3FamilyDriverPanel({
  provider,
  descriptor,
  config,
  value,
  onChange,
  secrets,
  onSecretChange,
  errors,
  canWrite,
}: StorageDriverPanelProps) {
  const endpoint = text(value, 'endpoint');
  const accountId = text(value, 'accountId');
  const forcePathStyle = triState(value);
  const secretAccessKey = secrets.secretAccessKey ?? '';

  const effectiveEndpointPreview =
    provider === 'r2' ? endpoint.trim() || (accountId.trim() ? deriveR2Endpoint(accountId) : '') : '';

  return (
    <>
      <Grid container spacing={2} sx={{ mt: 1 }}>
        <Grid size={{ xs: 12, sm: 6 }}>
          <TextField
            fullWidth
            label="Bucket"
            value={text(value, 'bucket')}
            onChange={(e) => onChange('bucket', e.target.value)}
            disabled={!canWrite}
            error={!!errors.bucket}
            helperText={
              errors.bucket ?? 'Clearing this un-configures storage for the whole deployment.'
            }
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 6 }}>
          <TextField
            fullWidth
            label="Region"
            value={text(value, 'region')}
            onChange={(e) => onChange('region', e.target.value)}
            disabled={!canWrite}
            error={!!errors.region}
            helperText={
              errors.region ??
              (provider === 'r2'
                ? 'Leave blank for R2 — it signs with "auto". Set one only for a jurisdiction-restricted bucket (eu, fedramp).'
                : provider === 's3compatible'
                  ? 'Leave blank to sign with us-east-1, which most S3-compatible servers ignore.'
                  : 'The region holding the bucket, e.g. us-east-1.')
            }
          />
        </Grid>
      </Grid>

      {/* ================================================================
          PROVIDER-SPECIFIC FIELDS. Rendered per provider, but their
          VALUES live in one form state and are resubmitted untouched, so
          switching provider never discards a configuration the admin may
          switch back to. (The same rule `SettingsHub` follows for its two
          responsive treatments: what is not shown is not mounted, because
          a hidden duplicate doubles the tab order with targets a keyboard
          user can reach but not see.)
          ============================================================= */}
      {provider === 'r2' && (
        <>
          <Divider sx={{ my: 3 }} />
          <Typography variant="h6" gutterBottom>
            Cloudflare R2
          </Typography>
          <Grid container spacing={2}>
            <Grid size={{ xs: 12, sm: 6 }}>
              <TextField
                fullWidth
                label="Account ID"
                value={accountId}
                onChange={(e) => onChange('accountId', e.target.value)}
                disabled={!canWrite}
                error={!!errors.accountId}
                helperText={
                  errors.accountId ?? 'Your Cloudflare account id. The endpoint is built from it.'
                }
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              {/* ⚠ READ-ONLY, AND NEVER A FIELD TO TYPE INTO. R2's
                  endpoint is a pure function of the account id
                  (`deriveR2Endpoint`), so asking an operator to type it
                  is asking them to reproduce a derivation the server
                  already performs — and to get it subtly wrong once,
                  permanently, in a place nothing else looks. */}
              <TextField
                fullWidth
                label="Endpoint (derived)"
                value={effectiveEndpointPreview}
                disabled
                slotProps={{ htmlInput: { readOnly: true, 'data-testid': 'r2-derived-endpoint' } }}
                placeholder={`https://<account id>.${R2_ENDPOINT_HOST_SUFFIX}`}
                helperText={
                  endpoint.trim()
                    ? 'A stored endpoint override is in force and takes precedence over the derived host.'
                    : 'Built from the account id — there is nothing to type here.'
                }
              />
              {/* The override is invisible on this provider otherwise,
                  which is exactly how a value left behind by an earlier
                  S3-compatible configuration silently keeps winning. */}
              {endpoint.trim() && (
                <Button
                  size="small"
                  sx={{ mt: 1 }}
                  disabled={!canWrite}
                  onClick={() => onChange('endpoint', '')}
                >
                  Clear the override and use the derived endpoint
                </Button>
              )}
            </Grid>
          </Grid>
        </>
      )}

      {provider === 's3compatible' && (
        <>
          <Divider sx={{ my: 3 }} />
          <Typography variant="h6" gutterBottom>
            S3-compatible endpoint
          </Typography>
          <Grid container spacing={2}>
            <Grid size={{ xs: 12 }}>
              <TextField
                fullWidth
                label="Endpoint"
                value={endpoint}
                onChange={(e) => onChange('endpoint', e.target.value)}
                disabled={!canWrite}
                error={!!errors.endpoint}
                helperText={
                  errors.endpoint ??
                  'The full URL of the server, e.g. https://minio.example.com:9000.'
                }
              />
            </Grid>
          </Grid>
        </>
      )}

      {provider === 's3' && (
        <>
          <Divider sx={{ my: 3 }} />
          <Typography variant="h6" gutterBottom>
            Amazon S3
          </Typography>
          <Typography variant="body2" color="text.secondary">
            No endpoint is needed — the AWS SDK builds one from the region and the bucket.
          </Typography>
        </>
      )}

      <Divider sx={{ my: 3 }} />
      <Typography variant="h6" gutterBottom>
        Credentials
      </Typography>
      <Grid container spacing={2}>
        <Grid size={{ xs: 12, sm: 6 }}>
          <TextField
            fullWidth
            label="Access key ID"
            value={text(value, 'accessKeyId')}
            onChange={(e) => onChange('accessKeyId', e.target.value)}
            disabled={!canWrite}
            autoComplete="off"
            error={!!errors.accessKeyId}
            helperText={
              errors.accessKeyId ??
              'Shown in full on purpose: it travels in the clear in every signed request, and it is what tells a rotated key from a mistyped one.'
            }
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 6 }}>
          {/* THE BLANK-PRESERVES CONTRACT, SAID OUT LOUD. The field
              renders empty because the stored secret is encrypted and
              unreadable — not because there is nothing stored. An empty
              box that silently means "keep" confuses; one that silently
              means "erase" destroys. So the helper text states which it
              is, and `secretStatus` decides the wording so the sentence
              is never a guess. */}
          <TextField
            fullWidth
            type="password"
            label="Secret access key"
            value={secretAccessKey}
            onChange={(e) => onSecretChange('secretAccessKey', e.target.value)}
            disabled={!canWrite}
            // A password manager filling this box would silently
            // re-send a credential the admin never typed.
            autoComplete="new-password"
            placeholder={
              config.secretStatus.configured ? (config.secretStatus.hint ?? '••••••••') : ''
            }
            helperText={secretHelperText(config.secretStatus)}
          />
        </Grid>
      </Grid>

      <Divider sx={{ my: 3 }} />

      {/* THREE OPTIONS, NOT A SWITCH — see the file header. `null` is a
          first-class, selectable answer here rather than a state the
          control has to invent a boolean for. */}
      <FormControl>
        <FormLabel id="storage-force-path-style-label">Path-style addressing</FormLabel>
        <RadioGroup
          aria-labelledby="storage-force-path-style-label"
          value={forcePathStyleChoice(forcePathStyle)}
          onChange={(e) =>
            onChange('forcePathStyle', FORCE_PATH_STYLE_CHOICES[e.target.value as ForcePathStyleChoice])
          }
          sx={{ flexDirection: { xs: 'column', sm: 'row' }, columnGap: 3 }}
        >
          <FormControlLabel
            value="vendor"
            control={<Radio />}
            label="Use this provider's convention"
            disabled={!canWrite}
          />
          <FormControlLabel
            value="on"
            control={<Radio />}
            label="Force path-style on"
            disabled={!canWrite}
          />
          <FormControlLabel
            value="off"
            control={<Radio />}
            label="Force path-style off"
            disabled={!canWrite}
          />
        </RadioGroup>
        <FormHelperText>
          {descriptor.label} uses {vendorConventionFor(provider)} unless you override it. Leaving
          this on the provider&apos;s convention is not the same as forcing it off — an explicit
          &quot;off&quot; suppresses the default and is what breaks a MinIO deployment.
        </FormHelperText>
      </FormControl>
    </>
  );
}
