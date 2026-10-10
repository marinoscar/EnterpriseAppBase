/**
 * The generic AI provider card (PP-14.6, issue #924, epic #918).
 *
 * Draws any provider no bespoke card is registered for — in practice a
 * provider an app or package added with `registerAiProvider`
 * (`@marinoscar/platform-api/ai`). Nothing about the provider is known here:
 * the card is generated from the descriptor the API serves in
 * `GET /admin/ai/config` (`descriptors`): a switch for `enabled`, a control per
 * settings field (a select for an enum, a text input for a string, ...) through
 * the settings slice's `PluggableConfigForm`, and, when the provider needs one,
 * the write-only key field.
 *
 * It saves exactly as the bespoke cards do (see `AiProviderCard`'s header):
 *
 *   - `enabled` and the provider's settings are part of the page's FORM, held
 *     as an `AiProviderFormValue` and saved with "Save changes" in the one
 *     `PUT /admin/ai/config`, as `{ enabled, ...settings }`;
 *   - the deployment KEY is not: "Save key", "Test" and "Remove key" act at
 *     once through `PUT`/`DELETE /admin/ai/providers/:provider/key`, and the
 *     key is typed into a write-only field that lives in this card's own state
 *     and is cleared the moment the server answers.
 *
 * The API validates every save; this card checks only what it can cheaply.
 */

import { useEffect, useMemo, useState } from 'react';
import { Accordion, AccordionDetails, AccordionSummary, Box, Chip, Divider, FormControlLabel, Paper, Stack, Switch, Typography } from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import type { ConfigField, PluggableDescriptor } from '@marinoscar/platform-contract/settings';
import { PluggableConfigForm } from '../../../settings/index.js';
import { aiProviderSettingsFields } from '../../headless/types.js';
import type { AiAdminProvider } from '../../headless/types.js';
import { AiCapabilityChips } from '../shared/AiCapabilityChips.js';
import { providerSettingValue, withProviderSetting } from './aiProviderForm.js';
import type { AiProviderCardProps } from './AiProviderCard.js';
import { AiProviderKeyActions, keyHelperText, MIN_KEY_LENGTH } from './AiProviderKeyActions.js';

/** The descriptor's name for the deployment key field. */
const KEY_FIELD = 'apiKey';

/**
 * A descriptor for a provider the API sent none for (an API older than #924):
 * its settings fields as text inputs and a key field.
 */
function fallbackDescriptor(provider: AiAdminProvider): PluggableDescriptor {
  return {
    kind: 'ai-provider',
    id: provider.id,
    label: provider.displayName,
    fields: [
      ...aiProviderSettingsFields(provider).map((name): ConfigField => ({ kind: 'string', name, label: name })),
      { kind: 'secret', name: KEY_FIELD, label: 'API key', hasValue: provider.keyStatus.configured, required: false },
    ],
  };
}

/** The key field's help when nothing is stored: the provider's own line, else a plain one. */
function emptyKeyHelp(provider: AiAdminProvider): string {
  return provider.help?.key ?? 'No organization key is stored yet.';
}

export function AiGenericProviderCard({
  provider,
  value,
  onChange,
  canWrite,
  errors,
  aiEnabled,
  keyAction,
  busy,
  keyError,
  onClearKeyError,
  onSaveKey,
  onRemoveKey,
  isProbing,
  probeError,
  onClearProbeError,
  testResult,
  onClearTestResult,
  onTest,
  descriptor,
}: AiProviderCardProps) {
  const switchId = `ai-provider-${provider.id}-enabled`;
  /** WRITE-ONLY: never part of the page form; cleared once the server answers. */
  const [apiKey, setApiKey] = useState('');

  useEffect(() => {
    setApiKey('');
  }, [provider.keyStatus]);

  const status = provider.keyStatus;
  const typedKey = apiKey.trim();
  const keyTooShort = typedKey.length > 0 && typedKey.length < MIN_KEY_LENGTH;
  const unregistered = !provider.registered;

  const full = descriptor ?? fallbackDescriptor(provider);
  // `enabled` is the header's switch; the endpoint's help is the provider's own when it declares one.
  const settingFields = useMemo(
    () =>
      full.fields
        .filter((field) => field.kind !== 'secret' && field.name !== 'enabled')
        .map((field) =>
          field.name === 'baseUrl' && field.kind === 'string' && provider.help?.baseUrl
            ? { ...field, help: provider.help.baseUrl }
            : field,
        ),
    [full, provider.help?.baseUrl],
  );
  const keyFields = useMemo(() => full.fields.filter((field) => field.kind === 'secret'), [full]);

  const settingsDescriptor = useMemo<PluggableDescriptor>(() => ({ ...full, fields: settingFields }), [full, settingFields]);
  const keyDescriptor = useMemo<PluggableDescriptor>(
    () => ({ ...full, label: `${full.label} key`, fields: keyFields }),
    [full, keyFields],
  );

  const formValue = useMemo(
    () => Object.fromEntries(settingFields.map((field) => [field.name, providerSettingValue(value, field.name)])),
    [settingFields, value],
  );

  const handleSaveKey = async () => {
    if (!typedKey || keyTooShort) return;
    // Cleared once the server has answered, WHATEVER it answered (see AiProviderCard).
    await onSaveKey(typedKey);
    setApiKey('');
  };

  return (
    <Paper variant="outlined" sx={{ p: { xs: 2, sm: 3 } }} data-testid={`ai-provider-${provider.id}`}>
      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        spacing={1}
        sx={{ alignItems: { sm: 'center' }, justifyContent: 'space-between' }}
      >
        <Box>
          <Typography variant="h6" component="h3">
            {provider.displayName}
          </Typography>
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
            <Typography variant="body2" color="text.secondary">
              {provider.id}
            </Typography>
            {unregistered && <Chip size="small" color="warning" label="Not available in this build" />}
          </Stack>
        </Box>
        <FormControlLabel
          control={
            <Switch
              id={switchId}
              checked={value.enabled}
              onChange={(e) => onChange({ ...value, enabled: e.target.checked })}
              // Off is always allowed; on only for a provider this build has.
              disabled={!canWrite || (unregistered && !value.enabled)}
              slotProps={{ input: { 'aria-label': `Enable ${provider.displayName}` } }}
            />
          }
          label={value.enabled ? 'Enabled' : 'Disabled'}
        />
      </Stack>

      {full.description && (
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
          {full.description}
        </Typography>
      )}

      {provider.supportedCapabilities.length > 0 && (
        <Box sx={{ mt: 1 }}>
          <AiCapabilityChips capabilities={provider.supportedCapabilities} />
        </Box>
      )}

      {settingFields.length > 0 && (
        <Accordion
          disableGutters
          elevation={0}
          defaultExpanded
          sx={{ mt: 2, '&::before': { display: 'none' }, backgroundColor: 'transparent' }}
        >
          <AccordionSummary
            expandIcon={<ExpandMoreIcon />}
            aria-controls={`ai-provider-${provider.id}-settings`}
            sx={{ px: 0 }}
          >
            <Typography variant="subtitle2">Settings</Typography>
          </AccordionSummary>
          <AccordionDetails sx={{ px: 0 }} id={`ai-provider-${provider.id}-settings`}>
            <PluggableConfigForm
              descriptor={settingsDescriptor}
              value={formValue}
              onChange={(name, next) => onChange(withProviderSetting(value, name, next))}
              secrets={{}}
              onSecretChange={() => undefined}
              disabled={!canWrite}
            />
            {(errors?.baseUrl || errors?.apiVersion) && (
              <Typography variant="body2" color="error" sx={{ mt: 1 }} role="alert">
                {errors.baseUrl ?? errors.apiVersion}
              </Typography>
            )}
          </AccordionDetails>
        </Accordion>
      )}

      <Divider sx={{ my: 2 }} />

      <Typography variant="subtitle1" component="h4" gutterBottom>
        Organization key
      </Typography>
      {keyFields.length > 0 ? (
        <PluggableConfigForm
          descriptor={keyDescriptor}
          value={{}}
          onChange={() => undefined}
          secrets={{ [KEY_FIELD]: apiKey }}
          onSecretChange={(_name, next) => setApiKey(next)}
          disabled={!canWrite}
          slots={{
            secretField: {
              textField: {
                label: `${provider.displayName} API key`,
                placeholder: status.configured ? (status.hint ?? '••••••••') : '',
                error: keyTooShort,
                helperText: keyTooShort
                  ? `An API key is at least ${MIN_KEY_LENGTH} characters.`
                  : status.configured
                    ? keyHelperText(status)
                    : emptyKeyHelp(provider),
              },
            },
          }}
        />
      ) : (
        <Typography variant="body2" color="text.secondary">
          No key needed — this provider does not use one.
        </Typography>
      )}

      <AiProviderKeyActions
        providerName={provider.displayName}
        canWrite={canWrite}
        unregistered={unregistered}
        status={status}
        typedKey={typedKey}
        keyTooShort={keyTooShort}
        savedKeyless={keyFields.length === 0}
        busy={busy}
        keyAction={keyAction}
        isProbing={isProbing}
        aiEnabled={aiEnabled}
        keyError={keyError}
        onClearKeyError={onClearKeyError}
        probeError={probeError}
        onClearProbeError={onClearProbeError}
        testResult={testResult}
        onClearTestResult={onClearTestResult}
        onSave={() => void handleSaveKey()}
        onRemove={onRemoveKey}
        onTest={() => onTest(typedKey)}
      />
    </Paper>
  );
}
