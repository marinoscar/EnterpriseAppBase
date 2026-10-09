/**
 * Settings → AI Keys (`/settings/ai`) — issue #430, epic #419.
 *
 * Bring your own key: one card per provider the administrator has enabled,
 * where the user saves (server-verified), tests and removes their own key;
 * then the models that key (or the organisation's) can reach, and the user's
 * default model — the one part stored in the user settings document
 * (`ai.defaultModel`, PATCH `/api/user-settings`) — and, last, the user's own
 * usage over the last 30 days (#444), a section of this page rather than a tab.
 *
 * A THIN PAGE WRAPPER, NOT `UserSettingsSection` — the same call as
 * `UserTokensPage`. Keys are their own resource behind `/api/ai/keys`, not part
 * of the user settings document, and each card owns its own inline errors.
 *
 * Reachability is gated outside this file: the route wraps it in
 * `RequirePermission('ai:use')` and `RequireAiEnabled`, and the registry card
 * is feature-gated on AI being enabled (#425). The `ai:use` re-check below is
 * defence in depth for a render reached some other way.
 */
import { Alert, Box, CircularProgress, Container, Stack, Typography } from '@mui/material';
import { Navigate } from 'react-router-dom';
import { usePlatformViewer } from '../../core/index.js';
import { useAiConfig } from '../headless/use-ai-config.js';
import { useUserAiKeys } from '../headless/use-user-ai-keys.js';
import { useUsableAiModels } from '../headless/use-usable-ai-models.js';
import { useAiUserSettings } from '../headless/use-ai-user-settings.js';
import { UserAiKeyCard } from './user/UserAiKeyCard.js';
import { KeylessProviderCard } from './user/KeylessProviderCard.js';
import { UsableAiModelsList } from './user/UsableAiModelsList.js';
import { DefaultAiModelPicker } from './user/DefaultAiModelPicker.js';
import { MyAiUsageSection } from './user/MyAiUsageSection.js';
import type { AiDefaultModel } from '../headless/types.js';

/**
 * User AI keys page.
 *
 * @stability experimental
 */
export default function UserAiKeysPage() {
  const { hasPermission } = usePlatformViewer();
  const { config, isLoading: configLoading } = useAiConfig();
  const { keys, isLoading: keysLoading, error: keysError, setKey, deleteKey, testKey } =
    useUserAiKeys();
  const usable = useUsableAiModels();
  // `syncTheme: false` — this page never edits the theme, so loading the
  // settings document must not push the stored theme into the shell.
  const { settings, isLoading: settingsLoading, updateSettings } = useAiUserSettings();
  const refreshModels = usable.refresh;

  if (!hasPermission('ai:use')) {
    return <Navigate to="/" replace />;
  }

  const providers = config.providers.filter((provider) => provider.enabled);
  // Whose calls the organisation's key covers when they have no key of their
  // own. Everyone under `byok_with_org_fallback`; and an AI administrator
  // (`ai_config:write`, the string `/api/admin/ai/*` enforces) under ANY
  // policy — the API's key resolver serves them from the org key they
  // configured (#593), and `/api/ai/models` reports those models with
  // `keySource: 'org'`. This only shapes the copy; the API decides.
  const isAiAdmin = hasPermission('ai_config:write');
  const orgCoversCaller = config.keyPolicy === 'byok_with_org_fallback' || isAiAdmin;
  const showAdminOrgKeyNotice =
    isAiAdmin && providers.some((provider) => provider.requiresKey !== false && provider.hasOrgKey);
  const providerNames = Object.fromEntries(
    config.providers.map((provider) => [provider.id, provider.displayName]),
  );

  const saveDefaultModel = async (defaultModel: AiDefaultModel | null) => {
    await updateSettings({ ai: { defaultModel } });
  };

  return (
    <Container maxWidth="md">
      <Box sx={{ py: { xs: 2, md: 4 } }}>
        <Typography variant="h4" component="h1" gutterBottom>
          AI Keys
        </Typography>
        <Typography color="text.secondary" sx={{ mb: 3 }}>
          Your key is encrypted, never shown again, and only used for requests you make. You are
          billed by the provider.
        </Typography>

        {configLoading || keysLoading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
            <CircularProgress aria-label="Loading AI keys" />
          </Box>
        ) : providers.length === 0 ? (
          <Alert severity="info">Your administrator hasn&apos;t enabled any AI provider yet.</Alert>
        ) : (
          <Stack spacing={3}>
            {showAdminOrgKeyNotice && (
              <Alert severity="info">
                As an administrator, your AI calls use the organization key configured in Admin →
                AI. Add a personal key below only if you want to use your own account instead.
              </Alert>
            )}
            {keysError && <Alert severity="error">{keysError}</Alert>}

            {providers.map((provider) =>
              // A keyless server (#448) has no key to add — say so instead.
              provider.requiresKey === false ? (
                <KeylessProviderCard key={provider.id} provider={provider} />
              ) : (
                <UserAiKeyCard
                  key={provider.id}
                  provider={provider}
                  keyView={keys.find((entry) => entry.provider === provider.id)}
                  orgFallback={orgCoversCaller && provider.hasOrgKey}
                  onSave={setKey}
                  onTest={testKey}
                  onRemove={deleteKey}
                  onChanged={() => void refreshModels()}
                />
              ),
            )}

            <UsableAiModelsList
              models={usable.models}
              isLoading={usable.isLoading}
              error={usable.error}
              providerNames={providerNames}
            />

            {/* #739: hidden when the app's AI features pick their own model
                (`AiModule.forRoot({ perUserDefaultModel: false })`); absent
                from an older API means shown. */}
            {config.perUserDefaultModel !== false && (
              <DefaultAiModelPicker
                models={usable.models}
                value={settings?.ai?.defaultModel}
                onChange={saveDefaultModel}
                disabled={settingsLoading || usable.isLoading || !settings}
                providerNames={providerNames}
              />
            )}

            <MyAiUsageSection />
          </Stack>
        )}
      </Box>
    </Container>
  );
}
