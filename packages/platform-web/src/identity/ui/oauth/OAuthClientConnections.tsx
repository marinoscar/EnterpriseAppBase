// The "Connections" of one OAuth client (#1203), inside the client's Details
// drawer on the admin "OAuth clients" page: the users' grants to that client
// (`GET /api/admin/oauth/grants?clientId=`, `oauth_clients:read`), with an
// "Include revoked" switch, paging, and Revoke behind a confirmation
// (`DELETE /api/admin/oauth/grants/:id`, `oauth_clients:write`). Revoke is
// ABSENT without the write permission; the API enforces it either way.
//
// A list, not a table: the drawer is at most 480px wide, so each grant is a
// stacked block that reads the same at 360px. Slice-internal.

import { useState } from 'react';
import type { ReactElement } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  FormControlLabel,
  IconButton,
  Stack,
  Switch,
  Typography,
} from '@mui/material';
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import type { OAuthAdminGrantView, OAuthClientView } from '@marinoscar/platform-contract/identity';

import { NUMERIC_DATE, formatDate, useOptionalPlatformHost } from '../../../core/index.js';
import { useOAuthAdminGrants } from '../../headless/index.js';
import type { OAuthServerApi } from '../../headless/index.js';
import { relativeTime } from './oauth-display.js';

const REVOKED_REASON_LABELS: Readonly<Record<string, string>> = {
  user: 'disconnected by the user',
  admin: 'revoked by an administrator',
  reuse_detected: 'a refresh token was reused',
  client_disabled: 'the client was disabled',
  offboarding: 'the organization was offboarded',
};

/** Why a grant was revoked, in words; an unknown reason shows as its id. */
export function revokedReasonLabel(reason: string | null): string | null {
  if (!reason) return null;
  return REVOKED_REASON_LABELS[reason] ?? reason;
}

/** The connections section of a client's Details drawer. */
export function OAuthClientConnections({
  client,
  api,
  canWrite,
  onRevoked,
}: {
  client: OAuthClientView;
  api: OAuthServerApi | undefined;
  canWrite: boolean;
  /** Called after a revoke, so the page can re-read the client's connection count. */
  onRevoked?: () => void;
}): ReactElement {
  const state = useOAuthAdminGrants({ clientId: client.id }, api);
  const { grants, total, page, pageSize, includeRevoked, isLoading, error } = state;
  const [confirming, setConfirming] = useState<OAuthAdminGrantView | null>(null);
  const [revoking, setRevoking] = useState<string | null>(null);
  const hostRelative = useOptionalPlatformHost()?.formatRelativeTime;
  const ago = (iso: string) => (hostRelative ? hostRelative(iso) : relativeTime(iso));

  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const first = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const last = Math.min(total, page * pageSize);

  const revoke = (grant: OAuthAdminGrantView) => {
    setConfirming(null);
    setRevoking(grant.id);
    void state
      .revoke(grant.id)
      .then(() => onRevoked?.())
      .catch(() => undefined)
      .finally(() => setRevoking(null));
  };

  return (
    <Box component="section" aria-labelledby="oauth-client-connections-title">
      <Typography id="oauth-client-connections-title" variant="subtitle2" component="h3">
        Connections
      </Typography>
      <Typography variant="body2" color="text.secondary">
        The people who connected this client, and what each allowed it to do.
      </Typography>
      <FormControlLabel
        sx={{ mx: 0, minHeight: 44 }}
        control={<Switch checked={includeRevoked} onChange={(event) => state.setIncludeRevoked(event.target.checked)} />}
        label="Include revoked"
      />
      {error && (
        <Alert severity="error" sx={{ mb: 1 }}>
          {error}
        </Alert>
      )}
      {isLoading && grants.length === 0 ? (
        <Typography variant="body2" color="text.secondary" role="status">
          Loading the connections…
        </Typography>
      ) : grants.length === 0 && !error ? (
        <Typography variant="body2" color="text.secondary">
          {includeRevoked ? 'Nobody has connected this client.' : 'No active connections.'}
        </Typography>
      ) : (
        <Stack component="ul" aria-label="Connections" sx={{ listStyle: 'none', p: 0, m: 0 }}>
          {grants.map((grant) => {
            const revoked = grant.revokedAt !== null;
            const reason = revokedReasonLabel(grant.revokedReason);
            return (
              <Box
                component="li"
                key={grant.id}
                aria-label={grant.user.email}
                sx={{ py: 1.5, borderBottom: 1, borderColor: 'divider' }}
              >
                <Stack direction="row" spacing={1} sx={{ alignItems: 'flex-start', justifyContent: 'space-between' }}>
                  <Typography variant="body2" sx={{ fontWeight: 500, overflowWrap: 'anywhere', minWidth: 0 }}>
                    {grant.user.email}
                  </Typography>
                  {revoked ? (
                    <Chip label="Revoked" size="small" sx={{ flexShrink: 0 }} />
                  ) : (
                    <Chip label="Active" size="small" color="success" variant="outlined" sx={{ flexShrink: 0 }} />
                  )}
                </Stack>
                {grant.scopes.length > 0 && (
                  <Stack direction="row" useFlexGap spacing={0.5} sx={{ flexWrap: 'wrap', mt: 0.5 }} aria-label="Scopes">
                    {grant.scopes.map((scope) => (
                      <Chip key={scope} label={scope} size="small" variant="outlined" sx={{ fontFamily: 'monospace' }} />
                    ))}
                  </Stack>
                )}
                <Typography variant="caption" color="text.secondary" component="p" sx={{ mt: 0.5 }}>
                  {grant.resource.name}
                  {grant.organization ? ` · ${grant.organization.name}` : ''}
                </Typography>
                <Typography variant="caption" color="text.secondary" component="p">
                  Connected {formatDate(grant.createdAt, NUMERIC_DATE)} · Last used {grant.lastUsedAt ? ago(grant.lastUsedAt) : 'never'}
                </Typography>
                {revoked && grant.revokedAt && (
                  <Typography variant="caption" color="text.secondary" component="p">
                    Revoked {formatDate(grant.revokedAt, NUMERIC_DATE)}
                    {reason ? `: ${reason}` : ''}
                  </Typography>
                )}
                {canWrite && !revoked && (
                  <Button
                    size="small"
                    color="error"
                    onClick={() => setConfirming(grant)}
                    disabled={revoking === grant.id}
                    aria-label={`Revoke the connection of ${grant.user.email}`}
                    sx={{ minHeight: 44, mt: 0.5, ml: -1 }}
                  >
                    Revoke
                  </Button>
                )}
              </Box>
            );
          })}
        </Stack>
      )}
      {total > pageSize && (
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center', justifyContent: 'flex-end', mt: 1 }}>
          <Typography variant="caption" color="text.secondary" role="status">
            {first}–{last} of {total}
          </Typography>
          <IconButton
            aria-label="Previous page of connections"
            disabled={page <= 1 || isLoading}
            onClick={() => state.setPagination({ page: page - 1, pageSize })}
            sx={{ width: 44, height: 44 }}
          >
            <ChevronLeftIcon />
          </IconButton>
          <IconButton
            aria-label="Next page of connections"
            disabled={page >= pageCount || isLoading}
            onClick={() => state.setPagination({ page: page + 1, pageSize })}
            sx={{ width: 44, height: 44 }}
          >
            <ChevronRightIcon />
          </IconButton>
        </Stack>
      )}

      <Dialog open={confirming !== null} onClose={() => setConfirming(null)} aria-labelledby="oauth-revoke-grant-title">
        <DialogTitle id="oauth-revoke-grant-title">Revoke this connection?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            {confirming
              ? `${client.name} (${client.host}) stops working for ${confirming.user.email} at once. They can connect it again later, unless the client is disabled.`
              : ''}
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirming(null)} sx={{ minHeight: 44 }}>
            Cancel
          </Button>
          <Button
            color="error"
            variant="contained"
            sx={{ minHeight: 44 }}
            onClick={() => {
              if (confirming) revoke(confirming);
            }}
          >
            Revoke
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
