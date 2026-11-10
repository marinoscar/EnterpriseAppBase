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
 *  - switchless (no `onEnabledChange`): no switch; the host decides `enabled`.
 *  - enabled, consent required and not yet given: a blocking dialog; the
 *    sign-in button does not render until the user agrees.
 *  - consented, signed out: `Sign in with {name}`; disabled, with the reason
 *    shown under it, while `signInUnavailableReason` is set.
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

/**
 * The current sign-in state of the account behind an account-sign-in provider.
 *
 * @stability experimental
 */
export interface AccountSignInStatus {
  /** The user is signed in to the provider account. */
  signedIn: boolean;
  /** The signed-in account's login or display name, when known. */
  login?: string | null;
  /** A status check is in flight. */
  checking?: boolean;
  /** The last status check or sign-in failed with this message. */
  error?: string | null;
}

/**
 * The consent a provider requires before the user may enable and sign in.
 *
 * @stability experimental
 */
export interface AccountSignInConsent {
  /** Consent must be given before the provider can be used. */
  required: boolean;
  /** When the user agreed; absent or null while consent is still pending. */
  acceptedAt?: string | null;
  /** Heading of the consent notice. */
  title: string;
  /** The consent text shown to the user. */
  body: ReactNode;
  /** Defaults to `I agree`. */
  acceptLabel?: string;
  /** Record the user's consent. Rejects on failure. */
  onAccept: () => Promise<void>;
  /** When given, a signed-in user can withdraw consent. */
  onRevoke?: () => Promise<void>;
  /**
   * What **Not now** does; default `onEnabledChange(false)`. A host without
   * `onEnabledChange` passes it, for example to go back to its previous provider.
   */
  onDecline?: () => Promise<void>;
}

/**
 * Props of {@link AccountSignInProviderCard}.
 *
 * @stability experimental
 */
export interface AccountSignInProviderCardProps {
  /** The provider the card describes. */
  provider: {
    /** Stable provider id. */
    id: string;
    /** Name shown in the card header. */
    displayName: string;
    /** Optional text shown under the name. */
    description?: ReactNode;
    /** Optional icon shown beside the name. */
    icon?: ReactNode;
  };
  /** The user has switched this provider on. */
  enabled: boolean;
  /**
   * Persist the on/off switch. Omit it when the host decides elsewhere whether
   * this provider is used (for example a choice of one provider among several):
   * the card then renders no switch and `enabled` is the host's. Rejects on failure.
   */
  onEnabledChange?: (enabled: boolean) => Promise<void>;
  /** Consent gate; omit when the provider needs none. */
  consent?: AccountSignInConsent;
  /** The current sign-in state. */
  status: AccountSignInStatus;
  /** Start the sign-in flow. Rejects on failure. */
  onSignIn: () => Promise<void>;
  /**
   * Why the user cannot sign in yet (for example a runtime that is not installed).
   * While set and signed out: the Sign in button is disabled, this text is shown under
   * the buttons and tied to the button with aria-describedby, and Try again never starts
   * a sign-in. Ignored while signed in. Unset (the default): sign-in is offered as usual.
   */
  signInUnavailableReason?: ReactNode;
  /** Sign out of the provider account. Rejects on failure. */
  onSignOut: () => Promise<void>;
  /** Re-check the sign-in state; when omitted the refresh control is hidden. */
  onRefreshStatus?: () => Promise<void>;
  /** What the signed-in account can do, one row per capability. */
  capabilities?: {
    /** Capability name. */
    label: string;
    /** The account supports it. */
    available: boolean;
    /** Optional qualifier shown beside the label. */
    note?: string;
  }[];
  /** Models the user may choose from. */
  models?: {
    /** Model id. */
    id: string;
    /** Name shown in the model list. */
    label: string;
  }[];
  /** The chosen model id, or null/undefined when none is chosen. */
  model?: string | null;
  /** Persist a new model choice. Rejects on failure. */
  onModelChange?: (id: string) => Promise<void>;
  /** Extension slots. */
  slots?: {
    /** Content rendered at the bottom of the card. */
    footer?: ReactNode;
  };
}

type Busy = 'enable' | 'accept' | 'revoke' | 'signin' | 'signout' | 'model' | 'refresh' | null;

/**
 * A settings card for a provider that signs in with the user's own account
 * instead of an API key: optional enable switch, optional consent, sign-in state,
 * capabilities and model choice.
 *
 * @stability experimental
 */
export function AccountSignInProviderCard({
  provider,
  enabled,
  onEnabledChange,
  consent,
  status,
  onSignIn,
  signInUnavailableReason,
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
  const lastFailedKind = useRef<Busy>(null);

  const name = provider.displayName;
  const titleId = `account-signin-${provider.id}-title`;
  const consentTitleId = `account-signin-${provider.id}-consent-title`;
  const signInUnavailableId = `account-signin-${provider.id}-signin-unavailable`;
  const consentPending = enabled && !!consent?.required && !consent.acceptedAt;
  const ready = enabled && !consentPending;
  const errorText = actionError ?? status.error ?? null;
  // Sign-in is blocked only while signed out and the host gave a reason.
  const signInBlocked =
    !status.signedIn && signInUnavailableReason != null && signInUnavailableReason !== false;

  /** Run one action: busy while pending, a worded error and a retry if it rejects. */
  const run = async (kind: Exclude<Busy, null>, action: () => Promise<void>, fallback: string) => {
    setBusy(kind);
    setActionError(null);
    lastFailed.current = null;
    lastFailedKind.current = null;
    try {
      await action();
    } catch (err) {
      setActionError(aiErrorText(err, fallback));
      lastFailed.current = () => run(kind, action, fallback);
      lastFailedKind.current = kind;
    } finally {
      setBusy(null);
    }
  };

  const signIn = () => run('signin', onSignIn, 'Sign-in failed');
  // Not now: the host's decline, else switching the provider off; neither hides it.
  const decline =
    consent?.onDecline ?? (onEnabledChange ? () => onEnabledChange(false) : undefined);
  const retry = () => {
    if (onRefreshStatus) {
      void run('refresh', onRefreshStatus, 'Could not check status');
    } else if (lastFailed.current) {
      // A failed sign-in is not retried while sign-in is unavailable.
      if (!(signInBlocked && lastFailedKind.current === 'signin')) void lastFailed.current();
    } else if (!status.signedIn && !signInBlocked) {
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
            {onEnabledChange ? (
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
            ) : null}
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
                <>
                  <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap' }}>
                    <Button
                      variant="contained"
                      disabled={busy !== null || signInBlocked}
                      aria-describedby={signInBlocked ? signInUnavailableId : undefined}
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
                  {signInBlocked ? (
                    <Typography id={signInUnavailableId} variant="body2" color="text.secondary" component="div">
                      {signInUnavailableReason}
                    </Typography>
                  ) : null}
                </>
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
            {decline ? (
              <Button
                disabled={busy !== null}
                onClick={() => void run('enable', decline, `Could not update ${name}`)}
              >
                Not now
              </Button>
            ) : null}
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
