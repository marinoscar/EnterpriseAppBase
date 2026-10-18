/**
 * One provider that signs in with an ACCOUNT instead of an API key — issue #998.
 *
 * A presentational card for hosts whose AI provider is reached through the
 * user's own account (a desktop sign-in, a device flow) rather than a stored
 * key, the counterpart of `UserAiKeyCard`. It makes no network call and reads
 * no hook: the host owns enabling, consent, sign-in, status and the model
 * choice, and passes them as props. Every action prop returns a promise; a
 * rejection is worded with `aiErrorText` and shown inline with a Try again.
 *
 * State machine (accessible names are part of the contract):
 *  - disabled: only the title, description and the `Enable {name}` switch.
 *  - enabled, consent required and not yet given: a blocking dialog; the
 *    sign-in button does not render until the user agrees.
 *  - consented, signed out: `Sign in with {name}`.
 *  - signed in: `Signed in as {login}`, model picker, capabilities, `Sign out`.
 */
import { useRef, useState, type ReactNode } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  FormControlLabel,
  InputLabel,
  List,
  ListItem,
  ListItemText,
  MenuItem,
  Select,
  Stack,
  Switch,
  Typography,
} from '@mui/material';
import { aiErrorText } from './aiErrorText.js';

export interface AccountSignInStatus {
  signedIn: boolean;
  login?: string | null;
  /** A status check is in flight. */
  checking?: boolean;
  /** The last status check or sign-in failed with this message. */
  error?: string | null;
}

export interface AccountSignInConsent {
  required: boolean;
  /** When the user agreed; absent or null while consent is still pending. */
  acceptedAt?: string | null;
  title: string;
  body: ReactNode;
  /** Defaults to `I agree`. */
  acceptLabel?: string;
  onAccept: () => Promise<void>;
  /** When given, a signed-in user can withdraw consent. */
  onRevoke?: () => Promise<void>;
}

export interface AccountSignInProviderCardProps {
  provider: { id: string; displayName: string; description?: ReactNode; icon?: ReactNode };
  enabled: boolean;
  onEnabledChange: (enabled: boolean) => Promise<void>;
  consent?: AccountSignInConsent;
  status: AccountSignInStatus;
  onSignIn: () => Promise<void>;
  onSignOut: () => Promise<void>;
  onRefreshStatus?: () => Promise<void>;
  capabilities?: { label: string; available: boolean; note?: string }[];
  models?: { id: string; label: string }[];
  model?: string | null;
  onModelChange?: (id: string) => Promise<void>;
  slots?: { footer?: ReactNode };
}

type Busy = 'enable' | 'accept' | 'revoke' | 'signin' | 'signout' | 'model' | 'refresh' | null;

export function AccountSignInProviderCard({
  provider,
  enabled,
  onEnabledChange,
  consent,
  status,
  onSignIn,
  onSignOut,
  onRefreshStatus,
  capabilities,
  models,
  model,
  onModelChange,
  slots,
}: AccountSignInProviderCardProps) {
  const [busy, setBusy] = useState<Busy>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  // The last action that failed, so Try again can run it again.
  const lastFailed = useRef<(() => Promise<void>) | null>(null);

  const name = provider.displayName;
  const titleId = `account-signin-${provider.id}-title`;
  const consentTitleId = `account-signin-${provider.id}-consent-title`;
  const consentPending = enabled && !!consent?.required && !consent.acceptedAt;
  const ready = enabled && !consentPending;
  const errorText = actionError ?? status.error ?? null;

  /** Run one action: busy while pending, a worded error and a retry if it rejects. */
  const run = async (kind: Exclude<Busy, null>, action: () => Promise<void>, fallback: string) => {
    setBusy(kind);
    setActionError(null);
    lastFailed.current = null;
    try {
      await action();
    } catch (err) {
      setActionError(aiErrorText(err, fallback));
      lastFailed.current = () => run(kind, action, fallback);
    } finally {
      setBusy(null);
    }
  };

  const signIn = () => run('signin', onSignIn, 'Sign-in failed');
  const retry = () => {
    if (onRefreshStatus) {
      void run('refresh', onRefreshStatus, 'Could not check status');
    } else if (lastFailed.current) {
      void lastFailed.current();
    } else if (!status.signedIn) {
      void signIn();
    }
  };

  return (
    <Card component="section" aria-label={`${name} sign-in`}>
      <CardContent>
        <Stack spacing={2}>
          <Stack direction="row" spacing={2} sx={{ alignItems: 'flex-start', justifyContent: 'space-between' }}>
            <Stack direction="row" spacing={1.5} sx={{ alignItems: 'flex-start', minWidth: 0 }}>
              {provider.icon ? <Box sx={{ display: 'flex', pt: 0.5 }}>{provider.icon}</Box> : null}
              <Box sx={{ minWidth: 0 }}>
                <Typography id={titleId} variant="h6" component="h2" gutterBottom>
                  {name}
                </Typography>
                {provider.description ? (
                  <Typography variant="body2" color="text.secondary" component="div">
                    {provider.description}
                  </Typography>
                ) : null}
              </Box>
            </Stack>
            <FormControlLabel
              sx={{ mr: 0, flexShrink: 0 }}
              label=""
              control={
                <Switch
                  checked={enabled}
                  disabled={busy === 'enable'}
                  onChange={(e) => {
                    const next = e.target.checked;
                    void run('enable', () => onEnabledChange(next), `Could not update ${name}`);
                  }}
                  slotProps={{ input: { 'aria-label': `Enable ${name}` } }}
                />
              }
            />
          </Stack>

          {ready ? (
            <>
              {errorText ? (
                <Alert
                  severity="error"
                  action={
                    <Button color="inherit" size="small" onClick={retry} disabled={busy !== null}>
                      Try again
                    </Button>
                  }
                >
                  {errorText}
                </Alert>
              ) : null}

              {status.checking ? (
                <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                  <CircularProgress size={16} aria-hidden="true" />
                  <Typography variant="body2" color="text.secondary">
                    Checking status…
                  </Typography>
                </Stack>
              ) : null}

              {status.signedIn ? (
                <>
                  <Box>
                    <Chip
                      color="success"
                      size="small"
                      label={status.login ? `Signed in as ${status.login}` : 'Signed in'}
                    />
                  </Box>

                  {models && models.length > 0 ? (
                    <FormControl size="small" fullWidth sx={{ maxWidth: 360 }}>
                      <InputLabel id={`account-signin-${provider.id}-model-label`}>Model</InputLabel>
                      <Select
                        labelId={`account-signin-${provider.id}-model-label`}
                        label="Model"
                        value={model ?? ''}
                        disabled={busy === 'model'}
                        onChange={(e) => {
                          const id = String(e.target.value);
                          if (onModelChange) {
                            void run('model', () => onModelChange(id), 'Could not change the model');
                          }
                        }}
                      >
                        {models.map((m) => (
                          <MenuItem key={m.id} value={m.id}>
                            {m.label}
                          </MenuItem>
                        ))}
                      </Select>
                    </FormControl>
                  ) : null}

                  {capabilities && capabilities.length > 0 ? (
                    <List dense disablePadding aria-label={`${name} capabilities`}>
                      {capabilities.map((c) => (
                        <ListItem
                          key={c.label}
                          disableGutters
                          secondaryAction={
                            <Chip
                              size="small"
                              variant="outlined"
                              color={c.available ? 'success' : 'default'}
                              label={c.available ? 'Available' : 'Not available'}
                            />
                          }
                        >
                          <ListItemText primary={c.label} secondary={c.note} />
                        </ListItem>
                      ))}
                    </List>
                  ) : null}

                  <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap' }}>
                    <Button
                      variant="outlined"
                      disabled={busy !== null}
                      startIcon={busy === 'signout' ? <CircularProgress size={16} /> : undefined}
                      onClick={() => void run('signout', onSignOut, 'Sign-out failed')}
                    >
                      {busy === 'signout' ? 'Signing out…' : 'Sign out'}
                    </Button>
                    {onRefreshStatus ? (
                      <Button
                        disabled={busy !== null || !!status.checking}
                        onClick={() => void run('refresh', onRefreshStatus, 'Could not check status')}
                      >
                        Check status
                      </Button>
                    ) : null}
                    {consent?.onRevoke ? (
                      <Button
                        disabled={busy !== null}
                        onClick={() => void run('revoke', consent.onRevoke!, 'Could not withdraw consent')}
                      >
                        Withdraw consent
                      </Button>
                    ) : null}
                  </Stack>
                </>
              ) : (
                <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap' }}>
                  <Button
                    variant="contained"
                    disabled={busy !== null}
                    startIcon={busy === 'signin' ? <CircularProgress size={16} color="inherit" /> : undefined}
                    onClick={() => void signIn()}
                  >
                    {busy === 'signin' ? 'Signing in…' : `Sign in with ${name}`}
                  </Button>
                  {onRefreshStatus ? (
                    <Button
                      disabled={busy !== null || !!status.checking}
                      onClick={() => void run('refresh', onRefreshStatus, 'Could not check status')}
                    >
                      Check status
                    </Button>
                  ) : null}
                  {consent?.onRevoke && consent.required && consent.acceptedAt ? (
                    <Button
                      disabled={busy !== null}
                      onClick={() => void run('revoke', consent.onRevoke!, 'Could not withdraw consent')}
                    >
                      Withdraw consent
                    </Button>
                  ) : null}
                </Stack>
              )}

              {slots?.footer ? <Box>{slots.footer}</Box> : null}
            </>
          ) : null}
        </Stack>
      </CardContent>

      {consentPending && consent ? (
        <Dialog open aria-labelledby={consentTitleId} maxWidth="sm" fullWidth>
          <DialogTitle id={consentTitleId}>{consent.title}</DialogTitle>
          <DialogContent>
            <Typography variant="body2" component="div">
              {consent.body}
            </Typography>
            {errorText ? (
              <Alert severity="error" sx={{ mt: 2 }}>
                {errorText}
              </Alert>
            ) : null}
          </DialogContent>
          <DialogActions>
            <Button
              disabled={busy !== null}
              onClick={() => void run('enable', () => onEnabledChange(false), `Could not update ${name}`)}
            >
              Not now
            </Button>
            <Button
              variant="contained"
              disabled={busy !== null}
              onClick={() => void run('accept', consent.onAccept, 'Could not record consent')}
            >
              {consent.acceptLabel ?? 'I agree'}
            </Button>
          </DialogActions>
        </Dialog>
      ) : null}
    </Card>
  );
}
