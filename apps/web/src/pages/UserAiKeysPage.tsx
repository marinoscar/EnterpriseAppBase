/**
 * Settings → AI Keys (`/settings/ai`) — issue #430, epic #419.
 *
 * Bring your own key: one card per provider the administrator has enabled,
 * where the user saves (server-verified), tests and removes their own key.
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
import { usePermissions } from '../hooks/usePermissions';
import { useAiConfig } from '../hooks/useAiConfig';
import { useUserAiKeys } from '../hooks/useUserAiKeys';
import { UserAiKeyCard } from '../components/settings/ai/UserAiKeyCard';

export default function UserAiKeysPage() {
  const { hasPermission } = usePermissions();
  const { config, isLoading: configLoading } = useAiConfig();
  const { keys, isLoading: keysLoading, error: keysError, setKey, deleteKey, testKey } =
    useUserAiKeys();

  if (!hasPermission('ai:use')) {
    return <Navigate to="/" replace />;
  }

  const providers = config.providers.filter((provider) => provider.enabled);
  const fallbackPolicy = config.keyPolicy === 'byok_with_org_fallback';

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
            {keysError && <Alert severity="error">{keysError}</Alert>}

            {providers.map((provider) => (
              <UserAiKeyCard
                key={provider.id}
                provider={provider}
                keyView={keys.find((entry) => entry.provider === provider.id)}
                orgFallback={fallbackPolicy && provider.hasOrgKey}
                onSave={setKey}
                onTest={testKey}
                onRemove={deleteKey}
              />
            ))}
          </Stack>
        )}
      </Box>
    </Container>
  );
}
