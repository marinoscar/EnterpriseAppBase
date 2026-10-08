/**
 * Admin → Settings → Organization AI keys (`/admin/settings/organization/ai`).
 *
 * Issue #739 (PP-8.6). The active organization's OWN AI provider keys: one
 * row per registered provider with its masked status and set / remove
 * actions, plus the organization's effective AI policy (read-only). A
 * registry card of its own, appended last in the Organizations section
 * (`permission: 'org_ai_config:read'`, `feature: 'ai'`), never a tab on the
 * deployment's AI page: "which key does MY organization pay with" is a
 * different question from "how is AI configured for the deployment".
 *
 * Writes are gated inside the page (`org_ai_config:write`), as every
 * settings page does. The key is WRITE-ONLY: typed, sent once, verified by
 * the provider before it is stored, and never shown again (only its last
 * characters).
 */

import { useState } from 'react';
import type { ReactElement } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Container,
  Divider,
  Paper,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import type { OrgAiKeyView } from '@marinoscar/platform-contract/ai';

import { usePlatformViewer } from '../../core/index.js';
import { useOrgAiKeys, useOrgAiPolicy } from '../headless/index.js';

/**
 * The card's description, mirrored as the page's subtitle.
 *
 * @stability experimental
 */
export const ORG_AI_KEYS_DESCRIPTION = "Set your organization's own AI provider keys and see its effective AI policy.";

function ProviderRow(props: {
  entry: OrgAiKeyView;
  canWrite: boolean;
  pending: boolean;
  onSet: (provider: string, apiKey: string) => Promise<boolean>;
  onRemove: (provider: string) => Promise<boolean>;
}): ReactElement {
  const { entry, canWrite, pending } = props;
  const [draft, setDraft] = useState('');
  const fieldId = `org-ai-key-${entry.provider}`;

  return (
    <Box data-testid={`org-ai-key-${entry.provider}`} sx={{ py: 2 }}>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ alignItems: { sm: 'center' } }}>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="subtitle1">{entry.displayName}</Typography>
          {entry.configured ? (
            <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
              <Chip size="small" color="success" label="Key set" />
              <Typography variant="body2" color="text.secondary">
                {entry.hint ?? ''}
                {entry.verifiedAt ? ` · verified ${new Date(entry.verifiedAt).toLocaleDateString()}` : ''}
              </Typography>
            </Stack>
          ) : (
            <Typography variant="body2" color="text.secondary">
              No organization key
            </Typography>
          )}
        </Box>
        <TextField
          id={fieldId}
          size="small"
          type="password"
          autoComplete="off"
          label={entry.configured ? 'Replace key' : 'API key'}
          value={draft}
          disabled={!canWrite || pending}
          onChange={(event) => setDraft(event.target.value)}
          sx={{ minWidth: { sm: 260 } }}
        />
        <Stack direction="row" spacing={1}>
          <Button
            variant="contained"
            disabled={!canWrite || pending || draft.trim().length === 0}
            onClick={() => {
              void props.onSet(entry.provider, draft).then((ok) => {
                if (ok) setDraft('');
              });
            }}
          >
            {pending ? <CircularProgress size={18} /> : 'Save'}
          </Button>
          <Button
            color="error"
            disabled={!canWrite || pending || !entry.configured}
            onClick={() => void props.onRemove(entry.provider)}
          >
            Remove
          </Button>
        </Stack>
      </Stack>
    </Box>
  );
}

/**
 * The Organization AI keys page.
 *
 * @returns the page.
 *
 * @extensionPoint component
 * @stability experimental
 */
export default function OrgAiKeysPage(): ReactElement {
  const viewer = usePlatformViewer();
  const canWrite = viewer.hasPermission('org_ai_config:write');
  const { keys, error, isLoading, pendingProvider, set, remove } = useOrgAiKeys();
  const { policy, isLoading: policyLoading, unavailable } = useOrgAiPolicy();

  return (
    <Container maxWidth="md" sx={{ py: 3 }}>
      <Typography variant="h4" component="h1" gutterBottom>
        Organization AI keys{canWrite ? '' : ' (read-only)'}
      </Typography>
      <Typography variant="body1" color="text.secondary" sx={{ mb: 2 }}>
        {ORG_AI_KEYS_DESCRIPTION}
      </Typography>

      <Alert severity="info" sx={{ mb: 2 }}>
        A key set here pays for your organization's AI calls (a member's own key still comes first). In a
        single-organization deployment, the deployment key on the AI settings page (/admin/settings/ai) applies
        unless an organization key is set here.
      </Alert>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }} role="alert" data-testid="org-ai-keys-error">
          {error}
        </Alert>
      )}

      <Paper variant="outlined" sx={{ px: 2, mb: 3 }}>
        {isLoading ? (
          <Box sx={{ py: 3, display: 'flex', justifyContent: 'center' }}>
            <CircularProgress aria-label="Loading organization keys" />
          </Box>
        ) : (keys ?? []).length === 0 ? (
          <Typography sx={{ py: 3 }} color="text.secondary">
            No AI provider is available in this deployment.
          </Typography>
        ) : (
          (keys ?? []).map((entry, index) => (
            <Box key={entry.provider}>
              {index > 0 && <Divider />}
              <ProviderRow
                entry={entry}
                canWrite={canWrite}
                pending={pendingProvider === entry.provider}
                onSet={set}
                onRemove={remove}
              />
            </Box>
          ))
        )}
      </Paper>

      <Typography variant="h6" component="h2" gutterBottom>
        Effective AI policy
      </Typography>
      <Paper variant="outlined" sx={{ p: 2 }} data-testid="org-ai-policy">
        {policyLoading ? (
          <CircularProgress size={20} aria-label="Loading the AI policy" />
        ) : unavailable || !policy ? (
          <Typography color="text.secondary">The organization's AI policy is not available.</Typography>
        ) : (
          <Stack spacing={0.5}>
            <Typography>AI: {policy.enabled ? 'on' : 'off'}</Typography>
            <Typography>
              Key policy:{' '}
              {policy.keyPolicy === 'byok'
                ? "members' own keys only (administrators may use the organization key)"
                : "members' own keys, then the organization's key"}
            </Typography>
            <Typography>
              Requests per day for the organization: {policy.limits.perOrg?.requestsPerDay ?? 'unlimited'}
            </Typography>
            <Typography>
              Output tokens per day for the organization: {policy.limits.perOrg?.outputTokensPerDay ?? 'unlimited'}
            </Typography>
            <Typography color="text.secondary" variant="body2">
              Change these in Organization settings; an organization can only tighten the deployment's policy.
            </Typography>
          </Stack>
        )}
      </Paper>
    </Container>
  );
}
