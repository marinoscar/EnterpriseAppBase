// The admin page's dialogs (PP-15.7, #1185): pre-register a client, and show a
// client secret ONCE (after create and after rotate). Slice-internal.

import { useState } from 'react';
import type { ReactElement } from 'react';
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  FormControlLabel,
  FormLabel,
  IconButton,
  InputAdornment,
  Radio,
  RadioGroup,
  Stack,
  TextField,
  Tooltip,
} from '@mui/material';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import type { OAuthClientWithSecret } from '@marinoscar/platform-contract/identity';

import type { OAuthClientCreateInput } from '../../headless/index.js';

/** Copies `text`; resolves `false` when the browser refuses. */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** A read-only value with a copy button (the issuer, a client id, a secret). */
export function CopyField({ label, value, testId }: { label: string; value: string; testId?: string }): ReactElement {
  const [copied, setCopied] = useState(false);
  return (
    <TextField
      label={label}
      value={value}
      fullWidth
      size="small"
      slotProps={{
        htmlInput: { readOnly: true, 'data-testid': testId, style: { fontFamily: 'monospace' } },
        input: {
          endAdornment: (
            <InputAdornment position="end">
              <Tooltip title={copied ? 'Copied' : 'Copy'}>
                <IconButton
                  aria-label={`Copy ${label.toLowerCase()}`}
                  onClick={() => void copyText(value).then(setCopied)}
                  edge="end"
                  sx={{ width: 44, height: 44 }}
                >
                  <ContentCopyIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            </InputAdornment>
          ),
        },
      }}
    />
  );
}

/** The client id and, once, the secret of a client just created or rotated. */
export function OAuthClientSecretDialog({
  client,
  onClose,
}: {
  client: OAuthClientWithSecret | null;
  onClose: () => void;
}): ReactElement {
  return (
    <Dialog open={client !== null} onClose={onClose} fullWidth maxWidth="sm" aria-labelledby="oauth-client-secret-title">
      <DialogTitle id="oauth-client-secret-title">{client?.clientSecret ? 'Copy the client secret now' : 'Client added'}</DialogTitle>
      <DialogContent>
        {client && (
          <Stack spacing={2} sx={{ pt: 1 }}>
            {client.clientSecret ? (
              <Alert severity="warning">
                This is the only time the secret is shown. Store it somewhere safe and give it to the app’s developer.
              </Alert>
            ) : (
              <Alert severity="info">A public client has no secret. Give the client id to the app’s developer.</Alert>
            )}
            <CopyField label="Client id" value={client.clientId} testId="oauth-client-id" />
            {client.clientSecret && <CopyField label="Client secret" value={client.clientSecret} testId="oauth-client-secret" />}
          </Stack>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} variant="contained" sx={{ minHeight: 44 }}>
          Done
        </Button>
      </DialogActions>
    </Dialog>
  );
}

/** Splits the redirect URI box into URIs: one per line, blanks ignored. */
export function parseRedirectUris(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function redirectUriProblem(uris: string[]): string | null {
  if (uris.length === 0) return 'Enter at least one redirect URI.';
  if (uris.length > 10) return 'Enter at most 10 redirect URIs.';
  for (const uri of uris) {
    let url: URL;
    try {
      url = new URL(uri);
    } catch {
      return `Not a URL: ${uri}`;
    }
    const loopback = url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]';
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) {
      return 'Use https:, or http: on localhost only.';
    }
    if (url.hash) return 'A redirect URI cannot have a #fragment.';
  }
  return null;
}

/** Pre-register a client: name, redirect URIs, public or confidential. */
export function AddOAuthClientDialog({
  open,
  onClose,
  onCreate,
}: {
  open: boolean;
  onClose: () => void;
  onCreate: (input: OAuthClientCreateInput) => Promise<void>;
}): ReactElement {
  const [name, setName] = useState('');
  const [uris, setUris] = useState('');
  const [type, setType] = useState<'public' | 'confidential'>('public');
  const [touched, setTouched] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const parsed = parseRedirectUris(uris);
  const nameProblem = name.trim() === '' ? 'Enter a name.' : null;
  const uriProblem = redirectUriProblem(parsed);

  const reset = () => {
    setName('');
    setUris('');
    setType('public');
    setTouched(false);
    setError(null);
  };

  const submit = async () => {
    setTouched(true);
    if (nameProblem || uriProblem) return;
    setSubmitting(true);
    setError(null);
    try {
      await onCreate({
        name: name.trim(),
        redirectUris: parsed,
        tokenEndpointAuthMethod: type === 'public' ? 'none' : 'client_secret_basic',
      });
      reset();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add the client.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={() => {
        if (submitting) return;
        reset();
        onClose();
      }}
      fullWidth
      maxWidth="sm"
      aria-labelledby="oauth-add-client-title"
    >
      <DialogTitle id="oauth-add-client-title">Add a client</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          {error && <Alert severity="error">{error}</Alert>}
          <TextField
            label="Name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            error={touched && nameProblem !== null}
            helperText={touched && nameProblem ? nameProblem : 'People see this name on the consent page.'}
            required
            fullWidth
            slotProps={{ htmlInput: { maxLength: 200 } }}
          />
          <TextField
            label="Redirect URIs"
            value={uris}
            onChange={(event) => setUris(event.target.value)}
            error={touched && uriProblem !== null}
            helperText={
              touched && uriProblem ? uriProblem : 'One per line. https:, or http: on localhost. All on one host.'
            }
            required
            fullWidth
            multiline
            minRows={2}
          />
          <FormControl>
            <FormLabel id="oauth-add-client-type">Client type</FormLabel>
            <RadioGroup
              aria-labelledby="oauth-add-client-type"
              value={type}
              onChange={(event) => setType(event.target.value as 'public' | 'confidential')}
            >
              <FormControlLabel
                value="public"
                control={<Radio sx={{ p: 1.25 }} />}
                label="Public: a browser or desktop app that cannot keep a secret"
              />
              <FormControlLabel
                value="confidential"
                control={<Radio sx={{ p: 1.25 }} />}
                label="Confidential: a server that keeps a secret"
              />
            </RadioGroup>
          </FormControl>
          <Box />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button
          onClick={() => {
            reset();
            onClose();
          }}
          disabled={submitting}
          sx={{ minHeight: 44 }}
        >
          Cancel
        </Button>
        <Button onClick={() => void submit()} variant="contained" disabled={submitting} sx={{ minHeight: 44 }}>
          Add client
        </Button>
      </DialogActions>
    </Dialog>
  );
}
