/**
 * Admin → Settings → Email (`/admin/settings/email`).
 *
 * Issue #124, epic #109. The first settings page added since `CLAUDE.md`'s
 * `MANDATORY: Settings UI Pattern` section landed, so it is deliberately a
 * REGISTRY CARD and nothing else: one entry in `ADMIN_SECTIONS`, one route in
 * `App.tsx` gated on the same permission string, and no tab anywhere. The hub,
 * the Console rail and the compact AppBar title all pick it up from that single
 * declaration — see `docs/specs/settings-ui.md`.
 *
 * WHY THIS DOES NOT USE `SystemSettingsSection` (the render-prop wrapper
 * `NotificationSettingsPage` uses). That component is bound to
 * `useSystemSettings`: it loads THE system settings document, saves one branch
 * of it by PATCH, and hands the page a non-null `SystemSettings`. Email is a
 * different controller with a different document and a save contract this page
 * exists to make visible (blank password preserves), plus a second, non-saving
 * action — the test send — that the wrapper has no notion of. Threading all
 * that through it would generalise a shared component to serve exactly one
 * caller. What IS shared is the chrome, reproduced here field for field —
 * container, `h4` title, mirrored card description, "(read-only)" suffix, last
 * updated line, `Paper` body — so the page reads as a sibling rather than as a
 * one-off.
 *
 * THE TEST BUTTON IS THE POINT OF THE PAGE (#124). A wrong SES region, an
 * unverified sender identity and a bad SMTP password all fail, and they fail
 * differently; the provider's own error text is the only thing that tells them
 * apart. So the failure surface here is a persistent, dismissible alert with
 * room for a multi-line provider message — never a snackbar that slides away in
 * five seconds carrying the one string the admin needed to read twice.
 *
 * -----------------------------------------------------------------------------
 * TRANSPORTS ARE PLUGGABLE, AND "OFF" IS TWO FIELDS
 * -----------------------------------------------------------------------------
 *
 * The API describes every registered email transport (`descriptors`) and
 * carries each one's settings (`transports.<id>`) and the masked status of its
 * secrets (`secretStatuses`). The page draws one radio per descriptor and the
 * selected transport's form below it. WHICH component draws that form is the
 * panel registry's decision (`./emailTransportPanelRegistry.ts`): the two
 * built-ins register their bespoke panels (`SesTransportPanel`,
 * `SmtpTransportPanel`, moved verbatim, so their markup did not change), every
 * other transport gets `EmailGenericTransportPanel`, generated from its
 * descriptor.
 *
 * "Email is turned off" is `enabled: false`, NOT a third `provider` value. See
 * `providerChoice` below for how the two fields reach one radio group without
 * either being lost.
 *
 * ONLY THE SELECTED TRANSPORT'S SETTINGS AND TYPED SECRETS ARE SENT. The API
 * merges `transports.<id>` over what is stored and leaves every other
 * transport's settings alone, so switching between transports and back loses
 * nothing in the stored row (the edits to a transport that is not selected
 * stay on this page until it is reloaded).
 */

import { useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import {
  Alert,
  AlertTitle,
  Box,
  Button,
  CircularProgress,
  Container,
  Divider,
  FormControl,
  FormControlLabel,
  FormHelperText,
  FormLabel,
  Grid,
  Paper,
  Radio,
  RadioGroup,
  Snackbar,
  Switch,
  TextField,
  Typography,
} from '@mui/material';
import SendIcon from '@mui/icons-material/Send';
import type { PluggableDescriptor } from '@marinoscar/platform-contract/settings';
import { Navigate } from 'react-router-dom';
import { usePlatformViewer } from '../../core/index.js';
import { useEmailSettings } from '../headless/index.js';
import type { EmailProviderKind, EmailSettings, EmailSettingsInput } from '../headless/index.js';
import { withTransportDefaults } from '../headless/normalize-email-settings.js';
import { registerBuiltinEmailTransportPanels } from './builtinEmailTransportPanels.js';
import { EmailGenericTransportPanel } from './EmailGenericTransportPanel.js';
import { getEmailTransportPanel, getEmailTransportPanelOptions } from './emailTransportPanelRegistry.js';

// The two built-in transports draw their bespoke panel through the same
// registry an app uses (PP-14.8); every other transport is drawn by
// `EmailGenericTransportPanel` from its descriptor.
registerBuiltinEmailTransportPanels();

/** One transport's settings as edited, by setting name. */
type TransportValue = Record<string, unknown>;

/** The typed (write-only) secrets, by transport id and declared name. */
type TypedSecretsById = Record<string, Record<string, string>>;

/**
 * The form's own state: the four settings every transport shares, and the
 * edited settings of every transport the API described, by transport id.
 */
interface EmailFormState {
  /** `null` is "no transport chosen", exactly as on the wire. */
  provider: EmailProviderKind | null;
  enabled: boolean;
  fromAddress: string;
  fromName: string;
  /** Every described transport's settings in the shape its panel edits. */
  transports: Record<string, TransportValue>;
}

/** The API's own ceiling on `fromName` (`emailSettingsSchema`, `.max(100)`). */
const MAX_FROM_NAME_LENGTH = 100;

/**
 * The value the provider radio group renders.
 *
 * `''` — no radio selected — is `provider: null`, i.e. a fresh install where
 * nothing has been chosen yet. That reads correctly as "you have not picked
 * one", and it is the honest rendering of a nullable field: MUI needs a string,
 * and no option matches.
 *
 * NOTE WHAT IS NOT HERE: there is no radio for "off". Turning email off is the
 * `enabled` switch, a separate control for a separate field, and the reason is
 * that one three-way radio cannot express what the API's two fields do. "Off,
 * SMTP retained" and "off, SES retained" would collapse into the same choice,
 * so switching mail off for a maintenance window would cost the admin the
 * transport they had configured — the exact loss `enabled` exists to prevent.
 *
 * The mapping, in full:
 *
 *   provider  enabled | radio        switch | meaning
 *   ----------------------------------------------------------------------
 *   null      false   | (none)       off    | fresh install, nothing set up
 *   null      true    | (none)       on     | rejected by `validate` — on with
 *                                           |   nothing to send through
 *   '<id>'    true    | <its label>  on     | sending via that transport
 *   '<id>'    false   | <its label>  off    | configured, deliberately off
 *
 * There is deliberately no control that returns `provider` to `null` once a
 * transport has been picked. "I do not want mail sent" is the switch; going
 * back to "never configured" is not a state an admin needs to author, and a
 * fourth radio labelled to explain the difference from "off" would be a
 * distinction only this comment could justify.
 */
function providerChoice(provider: EmailProviderKind | null): string {
  return provider ?? '';
}

/** A copy of `value` with the text settings the descriptor declares and nobody filled in as `''`. */
function withTextDefaults(descriptor: PluggableDescriptor | undefined, value: Readonly<TransportValue>): TransportValue {
  const out: TransportValue = { ...value };
  for (const field of descriptor?.fields ?? []) {
    if (field.kind === 'string' && out[field.name] === undefined) out[field.name] = '';
  }
  return out;
}

function toFormState(settings: EmailSettings, descriptors: readonly PluggableDescriptor[]): EmailFormState {
  const transports: Record<string, TransportValue> = {};
  for (const descriptor of descriptors) {
    const stored: TransportValue = { ...(settings.transports[descriptor.id] ?? {}) };
    const toForm = getEmailTransportPanelOptions(descriptor.id).toForm;
    transports[descriptor.id] = toForm ? toForm(stored) : stored;
  }
  return {
    provider: settings.provider,
    enabled: settings.enabled,
    // Every optional field is ABSENT rather than empty when unconfigured (the
    // API strips empties before writing), so `?? ''` is the whole conversion.
    fromAddress: settings.fromAddress ?? '',
    fromName: settings.fromName ?? '',
    transports,
  };
}

/**
 * Field-level validation, client-side only.
 *
 * Deliberately thin: the API validates for real (it must, since this page is
 * not the only possible caller), and this exists to stop the obvious typo
 * round-tripping.
 *
 * Two tiers, and the split is not cosmetic. The FORMAT rules run whether or not
 * email is switched on, because the API's do: `blankable` tolerates an empty
 * box, but a non-empty one is still checked by `emailSettingsSchema`'s own rule
 * — `z.email()`, the 100-character name cap — regardless of `enabled`. A rule
 * skipped here that the API applies is a 400 the admin could not see coming.
 * The REQUIRED rules run only when mail is actually being sent: a deployment
 * that has turned email off must not be blocked from saving that fact by an
 * empty SMTP host it will never use. The selected transport's own rules come
 * from its registered panel.
 */
function validate(
  form: EmailFormState,
  descriptors: readonly PluggableDescriptor[],
): { common: Partial<Record<'provider' | 'fromAddress' | 'fromName', string>>; transport: Record<string, string> } {
  const common: Partial<Record<'provider' | 'fromAddress' | 'fromName', string>> = {};
  let transport: Record<string, string> = {};

  const fromAddress = form.fromAddress.trim();
  if (fromAddress && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(fromAddress)) {
    common.fromAddress = 'That does not look like an email address.';
  }

  if (form.fromName.trim().length > MAX_FROM_NAME_LENGTH) {
    common.fromName = `Keep the display name to ${MAX_FROM_NAME_LENGTH} characters or fewer.`;
  }

  // Only the SELECTED transport's settings are sent, so only they are checked.
  const validateTransport = form.provider ? getEmailTransportPanelOptions(form.provider).validate : undefined;
  if (form.provider && validateTransport) {
    transport = validateTransport(form.transports[form.provider] ?? {}, { enabled: form.enabled });
  }

  if (!form.enabled) return { common, transport };

  if (!form.provider) {
    common.provider = 'Choose a provider, or leave email switched off.';
  } else if (!descriptors.some((descriptor) => descriptor.id === form.provider)) {
    common.provider = `The selected transport "${form.provider}" is not available. Choose another.`;
  }

  if (!fromAddress) {
    common.fromAddress = 'A from address is required to send mail.';
  }

  return { common, transport };
}

/**
 * `/admin/settings/email`: the email transport, sender and secrets, and the
 * test send. Routed behind `system_settings:read` (the `Email` card's
 * permission, the exact string the API enforces on `GET /api/email-settings`);
 * saving and test-sending need `system_settings:write`, and the page disables
 * both without it. Reads the viewer from the `PlatformHostProvider`.
 *
 * @returns the page.
 *
 * @extensionPoint component
 * @stability experimental
 */
export default function EmailSettingsPage() {
  const viewer = usePlatformViewer();
  const { hasPermission } = viewer;
  const user = { email: viewer.email ?? undefined };
  const {
    settings: loaded,
    isLoading,
    loadError,
    isSaving,
    saveError,
    isTesting,
    testResult,
    save,
    sendTest,
    clearTestResult,
    clearSaveError,
  } = useEmailSettings();

  // A response from an API older than the transports is completed from its
  // flat fields (`withTransportDefaults`); a current one is returned as it is.
  const settings = useMemo(() => (loaded ? withTransportDefaults(loaded) : null), [loaded]);
  /** The transports the API described, in its order. */
  const descriptors: readonly PluggableDescriptor[] = settings?.descriptors ?? [];

  const [form, setForm] = useState<EmailFormState | null>(null);
  /**
   * Held OUTSIDE `form` because it is not a value the page ever read — it is a
   * write-only instruction. Keeping it in the form object would put it in the
   * dirty comparison's baseline, where an empty string would have to mean both
   * "unchanged" and "erase", which is the exact ambiguity this contract exists
   * to remove. By transport id and declared secret name (the SMTP password is
   * `smtp.password`, the SES secret access key `ses.secretAccessKey`).
   */
  const [typedSecrets, setTypedSecrets] = useState<TypedSecretsById>({});
  const [savedMessage, setSavedMessage] = useState<string | null>(null);

  // The server's response is the new baseline after every load AND every save,
  // so this also clears the typed secrets once a save has consumed them.
  // Leaving a typed secret on screen after a successful save would imply it is
  // still pending, and the next save would send it again.
  useEffect(() => {
    if (settings) {
      setForm(toFormState(settings, settings.descriptors));
      setTypedSecrets({});
    }
  }, [settings]);

  // Defence, not the gate — `App.tsx` wraps the route in `RequirePermission`
  // with this same string, exactly as the four sibling admin pages do via
  // `SystemSettingsSection`. This one catches the page mounted from anywhere
  // else. It sits after every hook so the hook order never changes.
  if (!hasPermission('system_settings:read')) {
    return <Navigate to="/" replace />;
  }

  const canWrite = hasPermission('system_settings:write');

  if (isLoading || (!form && !loadError)) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', p: 3 }}>
        <CircularProgress size={40} />
      </Box>
    );
  }

  const checks = form ? validate(form, descriptors) : { common: {}, transport: {} };
  const errors = checks.common;
  const hasErrors = Object.keys(errors).length > 0 || Object.keys(checks.transport).length > 0;

  /** The selected transport's descriptor, or `undefined` for none (or one the API no longer describes). */
  const activeDescriptor = form?.provider ? descriptors.find((descriptor) => descriptor.id === form.provider) : undefined;
  const activeSecrets: Record<string, string> = (form?.provider && typedSecrets[form.provider]) || {};

  // A typed secret counts as a change even when every other field matches: it
  // is the one edit that leaves no visible trace in the form baseline.
  const isDirty =
    !!form &&
    !!settings &&
    (JSON.stringify(form) !== JSON.stringify(toFormState(settings, descriptors)) ||
      Object.values(activeSecrets).some((value) => value !== ''));

  const update = <K extends keyof EmailFormState>(key: K, value: EmailFormState[K]) => {
    setForm((prev) => (prev ? { ...prev, [key]: value } : prev));
  };

  /** Reports one changed setting of transport `id`; `undefined` removes it. */
  const updateTransport = (id: string, name: string, next: unknown) => {
    setForm((prev) => {
      if (!prev) return prev;
      const current = { ...(prev.transports[id] ?? {}) };
      if (next === undefined) delete current[name];
      else current[name] = next;
      return { ...prev, transports: { ...prev.transports, [id]: current } };
    });
  };

  /** Reports one typed secret of transport `id`. */
  const updateSecret = (id: string, name: string, next: string) => {
    setTypedSecrets((prev) => ({ ...prev, [id]: { ...(prev[id] ?? {}), [name]: next } }));
  };

  /**
   * The radio group's inverse: a picked transport is always also a picked
   * `provider`, and nothing else moves.
   *
   * In particular `enabled` is left alone. Choosing SMTP on a deployment whose
   * mail is deliberately switched off must not switch it back on as a side
   * effect of the admin looking at the SMTP fields — the two axes are separate
   * on the wire precisely so they can be separate here.
   */
  const applyProviderChoice = (value: string) => {
    update('provider', value === '' ? null : (value as EmailProviderKind));
  };

  const toInput = (state: EmailFormState): EmailSettingsInput => {
    const id = state.provider;
    const descriptor = descriptors.find((entry) => entry.id === id);
    const toTransportInput = id ? getEmailTransportPanelOptions(id).toInput : undefined;
    const value = (id && state.transports[id]) || {};
    const typed = Object.fromEntries(Object.entries(activeSecrets).filter(([, secret]) => secret !== ''));

    return {
      // Both required, neither blankable: `null` is a real persisted value for
      // `provider`, and `enabled` is a boolean the API always expects.
      provider: state.provider,
      enabled: state.enabled,

      // EMPTY BOXES GO AS `''`, NOT AS OMITTED KEYS. `updateEmailSettingsSchema`
      // wraps every optional field in `blankable`, whose entire purpose is to
      // accept what a cleared form control actually produces and convert it to
      // "absent" exactly once, server-side, in `stripUnsetSettingFields`. Sending
      // `''` says what the admin did — they cleared the field — instead of
      // reimplementing that conversion in a seventh place.
      fromAddress: state.fromAddress.trim(),
      fromName: state.fromName.trim(),

      // ONLY THE SELECTED TRANSPORT'S SETTINGS GO. The API merges
      // `transports.<id>` over what is stored and leaves every other
      // transport's settings alone, so switching provider does not discard a
      // configuration the admin may switch back to.
      ...(id && descriptor
        ? { transports: { [id]: toTransportInput ? toTransportInput(value) : withTextDefaults(descriptor, value) } }
        : {}),

      // THE ONE EXCEPTION, AND THE OPPOSITE MEANING. For every setting above,
      // `''` means "not configured". For a secret it means "I did not retype
      // it", so blank PRESERVES the stored value. The key is omitted entirely
      // rather than sent as `''` — the intent reaches the API as an absence
      // rather than as a value it has to interpret, and no code path can ever
      // send an empty secret that a future server revision might read as
      // "clear it". See `EmailSettingsInput`.
      ...(id && Object.keys(typed).length > 0 ? { secrets: { [id]: typed } } : {}),
    };
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!form || hasErrors || !canWrite) return;
    const ok = await save(toInput(form));
    if (ok) {
      setSavedMessage('Email settings saved');
      // The previous test described a configuration that is no longer the one
      // on screen. Keeping it would leave a green "sent" — or a red error the
      // admin has just fixed — sitting next to settings it never exercised.
      // (Note the deliberate asymmetry with plain EDITING, which does NOT clear
      // it: reading the provider's error is precisely what the admin is doing
      // while typing the fix.)
      clearTestResult();
    }
  };

  /**
   * Why the test button is unavailable, or `null` when it is available.
   *
   * Rendered as prose next to the button rather than left as a mysteriously
   * greyed control: "disabled with no explanation" is indistinguishable from
   * "broken", and this is the one button on the page anybody came here to press.
   *
   * The dirty check is the load-bearing one (#124): the test sends with the
   * SAVED settings, so offering it over an edited form invites an admin to test
   * the previous configuration and believe they tested the new one. It also
   * subsumes the "disabled while a save is pending" requirement, since a save in
   * flight is by definition a form whose changes are not stored yet — but
   * `isSaving` is still checked explicitly, because it is true for a moment
   * after the fields stop being dirty and before the response lands.
   *
   * The last two branches read the SAVED `enabled` and `provider`, not the
   * form's: with no unsaved changes the two agree, and these are the values the
   * test would actually run against. They are checked separately because they
   * fail for different reasons and the fix differs — "turn it on" versus
   * "choose a transport".
   */
  const testBlockedReason: string | null = !canWrite
    ? 'Sending a test needs permission to change system settings.'
    : isSaving
      ? 'Saving — wait for the save to finish, then test.'
      : isDirty
        ? 'Save your changes first. The test uses the saved configuration, not what is on screen.'
        : !settings?.enabled
          ? 'Email is switched off, so nothing would be sent. Turn it on and save first.'
          : !settings.provider
            ? 'No provider is configured, so there is nothing to send with.'
            : null;

  /** The component that draws the selected transport's form: its registered panel, else the generated one. */
  const TransportPanel = (form?.provider && getEmailTransportPanel(form.provider)) || EmailGenericTransportPanel;

  /** The label of the transport the last test went through, from the descriptors; none for one the API no longer describes. */
  const testedTransportLabel = testResult?.providerKind
    ? descriptors.find((descriptor) => descriptor.id === testResult.providerKind)?.label
    : undefined;

  return (
    <Container maxWidth="lg">
      <Box sx={{ py: 4 }}>
        {/* Title and description MIRROR the `Email` card in
            `config/adminSections.tsx` so the hub card, the rail row, the
            compact AppBar title and this `h1` all name the page identically. */}
        <Typography variant="h4" component="h1" gutterBottom>
          Email
        </Typography>
        <Typography color="text.secondary" sx={{ mb: 2 }}>
          Choose how the application sends email, and send yourself a test message to prove it
          works.
          {/* Stated up front rather than left for the user to discover by
              finding every control disabled. */}
          {!canWrite && ' (read-only)'}
        </Typography>

        {settings?.updatedBy && settings.updatedAt && (
          <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
            Last updated by {settings.updatedBy.email} on{' '}
            {new Date(settings.updatedAt).toLocaleString()}
          </Typography>
        )}

        {loadError && (
          <Alert severity="error" sx={{ mb: 3 }}>
            {loadError}
          </Alert>
        )}

        {/* A STORED ROW THAT WOULD NOT PARSE. The API degrades rather than
            500ing, on the grounds that a broken row must not take down the one
            screen able to repair it — but that means the form below is showing
            DEFAULTS, not this deployment's configuration, and an admin who is
            not told would "fix" a page that never described their system and
            overwrite the row they came to rescue. So the silent fallback is
            made loud, here, above the form it invalidates.

            `warning` rather than `error`: the red band on this page belongs to
            a load that failed and a test that failed, and this is neither —
            the page works, the data behind it does not. The title carries the
            weight instead. */}
        {settings?.settingsError && (
          <Alert severity="warning" sx={{ mb: 3 }}>
            <AlertTitle>The stored email configuration could not be read</AlertTitle>
            {settings.settingsError}
            <Box sx={{ mt: 1 }}>
              Until it is repaired, the application cannot send mail, and the fields below are
              defaults rather than your saved values. Re-enter the configuration and save to
              replace the stored row.
            </Box>
          </Alert>
        )}

        {form && settings && (
          <Paper sx={{ mt: 2, p: { xs: 2, sm: 3 } }}>
            <Box component="form" onSubmit={handleSubmit} noValidate>
              {/* THE MASTER SWITCH, ABOVE THE TRANSPORT AND SEPARATE FROM IT.
                  `enabled` and `provider` are two fields on the wire and two
                  controls here — see `providerChoice` for the full mapping and
                  for why folding "off" into the radio group would lose a state
                  the API deliberately keeps. */}
              <FormControlLabel
                control={
                  <Switch
                    checked={form.enabled}
                    onChange={(e) => update('enabled', e.target.checked)}
                    disabled={!canWrite}
                  />
                }
                label="Send email from this application"
              />

              {!form.enabled && (
                <Alert severity="info" sx={{ mt: 1, mb: 1 }}>
                  Email is switched off — no notifications, no test messages. The configuration
                  below is kept as it is, so switching it back on needs no retyping.
                </Alert>
              )}

              <Divider sx={{ my: 3 }} />

              <FormControl sx={{ mb: 1 }} error={!!errors.provider}>
                <FormLabel id="email-provider-label">Provider</FormLabel>
                {/* Row from `sm` up, column below, expressed in `sx` rather
                    than a `useMediaQuery` — this is pure layout and must not
                    become a sixth breakpoint gate alongside the five coupled
                    ones documented in `common/Layout.tsx`. */}
                <RadioGroup
                  aria-labelledby="email-provider-label"
                  // `''` when nothing has been chosen: no radio is selected,
                  // which is the truthful rendering of `provider: null`.
                  value={providerChoice(form.provider)}
                  onChange={(e) => applyProviderChoice(e.target.value)}
                  sx={{ flexDirection: { xs: 'column', sm: 'row' }, columnGap: 3 }}
                >
                  {descriptors.map((descriptor) => (
                    <FormControlLabel
                      key={descriptor.id}
                      value={descriptor.id}
                      control={<Radio />}
                      label={descriptor.label}
                      disabled={!canWrite}
                    />
                  ))}
                </RadioGroup>
                <FormHelperText>
                  {errors.provider ??
                    (form.provider === null
                      ? 'No transport has been chosen yet. Pick one to configure it.'
                      : 'Where the application hands its mail off for delivery.')}
                </FormHelperText>
              </FormControl>

              <Grid container spacing={2} sx={{ mt: 1 }}>
                <Grid size={{ xs: 12, sm: 6 }}>
                  <TextField
                    fullWidth
                    label="From address"
                    value={form.fromAddress}
                    onChange={(e) => update('fromAddress', e.target.value)}
                    disabled={!canWrite}
                    error={!!errors.fromAddress}
                    helperText={
                      errors.fromAddress ?? 'The address recipients see, and reply to.'
                    }
                  />
                </Grid>
                <Grid size={{ xs: 12, sm: 6 }}>
                  <TextField
                    fullWidth
                    label="From name"
                    value={form.fromName}
                    onChange={(e) => update('fromName', e.target.value)}
                    disabled={!canWrite}
                    error={!!errors.fromName}
                    helperText={
                      errors.fromName ??
                      'Shown instead of the raw address in most mail clients.'
                    }
                  />
                </Grid>
              </Grid>

              {/* THE SELECTED TRANSPORT'S FORM IS MOUNTED, never rendered and
                  hidden. The same rule `SettingsHub` follows for its two
                  responsive treatments: a hidden duplicate doubles the tab
                  order with targets a keyboard user can reach but not see.

                  It is shown whether or not `enabled` is on, deliberately:
                  configuring a transport before switching mail on, and fixing
                  one while mail is off, are both ordinary. The values of the
                  transports NOT selected stay in form state, so switching
                  between them loses nothing on this page. Which component draws
                  the form is the panel registry's decision: the two built-ins'
                  bespoke panels, or a form generated from the descriptor. */}
              {activeDescriptor && form.provider && (
                <TransportPanel
                  transport={form.provider}
                  descriptor={activeDescriptor}
                  settings={settings}
                  value={form.transports[form.provider] ?? {}}
                  onChange={(name, next) => updateTransport(form.provider as string, name, next)}
                  secrets={activeSecrets}
                  onSecretChange={(name, next) => updateSecret(form.provider as string, name, next)}
                  secretStatuses={settings.secretStatuses[form.provider] ?? {}}
                  errors={checks.transport}
                  canWrite={canWrite}
                />
              )}

              {saveError && (
                <Alert severity="error" sx={{ mt: 3 }} onClose={clearSaveError}>
                  <AlertTitle>Could not save</AlertTitle>
                  {saveError}
                </Alert>
              )}

              <Divider sx={{ my: 3 }} />

              {/* Column on phones so neither button is squeezed to an
                  unreadable width; a row from `sm` up, where there is space. */}
              <Box
                sx={{
                  display: 'flex',
                  flexDirection: { xs: 'column', sm: 'row' },
                  alignItems: { xs: 'stretch', sm: 'center' },
                  gap: 2,
                }}
              >
                <Button
                  type="submit"
                  variant="contained"
                  disabled={!canWrite || !isDirty || hasErrors || isSaving || isTesting}
                >
                  {isSaving ? 'Saving…' : 'Save changes'}
                </Button>
                <Button
                  variant="outlined"
                  startIcon={<SendIcon />}
                  onClick={sendTest}
                  disabled={!!testBlockedReason || isTesting}
                >
                  {isTesting ? 'Sending…' : 'Send test email'}
                </Button>
                <Typography variant="body2" color="text.secondary">
                  {/* Where it goes is stated before the click, not after: the
                      test has no recipient field on purpose (#124 — a free-text
                      "send to" on an admin form is an open relay wearing a
                      diagnostic hat), so the admin has to be told where to look. */}
                  {testBlockedReason ?? `Sends a real message to your own address, ${user?.email}.`}
                </Typography>
              </Box>

              {/* THE DIAGNOSTIC SURFACE. Persistent and dismissible, not a
                  snackbar: `MessageRejected: Email address is not verified in
                  region us-east-1` does not fit in a toast and is the entire
                  reason an admin opened this page. Success and failure differ by
                  severity, title AND wording, so neither can be mistaken for the
                  other at a glance.

                  It is driven by `testResult.success` and never by "the call
                  resolved" — the endpoint answers 200 for a refused send, and
                  that refusal is the diagnosis this page exists to show. */}
              {testResult && (
                <Alert
                  severity={testResult.success ? 'success' : 'error'}
                  sx={{ mt: 3 }}
                  onClose={clearTestResult}
                >
                  {testResult.success ? (
                    <>
                      <AlertTitle>Test email accepted by the provider</AlertTitle>
                      {/* "Accepted", never "delivered". The provider taking the
                          message is the last fact this app can observe; a bounce
                          happens minutes later and somewhere else, so claiming
                          delivery here would be a claim the page cannot back. */}
                      Sent to {testResult.sentTo ?? user?.email}
                      {testedTransportLabel ? ` via ${testedTransportLabel}` : ''}
                      . Acceptance is not delivery — check that inbox, and its spam folder.
                      {testResult.messageId && (
                        <Box
                          component="div"
                          sx={{ mt: 1, fontFamily: 'monospace', fontSize: '0.8125rem' }}
                        >
                          Message id: {testResult.messageId}
                        </Box>
                      )}
                    </>
                  ) : (
                    <>
                      <AlertTitle>Test email failed</AlertTitle>
                      {/* VERBATIM, in monospace, wrapping rather than
                          truncating. Provider errors carry codes, region names
                          and quoted addresses that are the diagnosis; an
                          ellipsis in the middle of one costs the admin the
                          answer. `wordBreak` keeps a long unbroken token from
                          widening the page on a phone. */}
                      <Box
                        component="pre"
                        sx={{
                          m: 0,
                          mt: 1,
                          fontFamily: 'monospace',
                          fontSize: '0.8125rem',
                          whiteSpace: 'pre-wrap',
                          wordBreak: 'break-word',
                        }}
                      >
                        {testResult.error ?? 'The provider reported a failure with no message.'}
                      </Box>
                    </>
                  )}
                </Alert>
              )}
            </Box>
          </Paper>
        )}

        {/* Saving is the ordinary, expected outcome, so it gets the same
            transient snackbar the sibling settings pages use. The test result
            deliberately does NOT — see above. */}
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
