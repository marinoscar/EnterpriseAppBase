/**
 * The Invites tab of the Organization page (#726, PP-6.7): the ACTIVE
 * organization's invitations. The tab itself is gated on `org_invites:read`
 * by the page; the Invite and Revoke actions are disabled without
 * `org_invites:write` (the API enforces both).
 */
import type { ReactElement } from 'react';
import { useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  FormControl,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Stack,
  Typography,
} from '@mui/material';
import { Add as AddIcon } from '@mui/icons-material';
import { usePermissions } from '../../headless/index.js';
import { useOrgInvites } from '../../headless/index.js';
import type { OrgInviteStatus } from '../../headless/index.js';
import { INVITE_STATUS_COLOR, formatDate, orgRoleLabel } from './orgLabels.js';
import { InviteMemberDialog } from './InviteMemberDialog.js';

type StatusFilter = 'all' | OrgInviteStatus;

/**
 * The current organization's invitations: invite and revoke
 * (`org_invites:write`). The Invites tab of {@link OrganizationPage}.
 *
 * @returns the component.
 *
 * @stability stable
 */
export function OrgInvitesPanel(): ReactElement {
  const { hasPermission } = usePermissions();
  const canWrite = hasPermission('org_invites:write');
  const { invites, isLoading, error, fetchInvites, inviteMember, revokeInvite } = useOrgInvites();
  const [status, setStatus] = useState<StatusFilter>('pending');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    void fetchInvites({ page: 1, pageSize: 100, status });
  }, [fetchInvites, status]);

  return (
    <Stack spacing={2}>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ alignItems: { sm: 'center' } }}>
        <FormControl size="small" sx={{ minWidth: 180 }}>
          <InputLabel id="invite-status-filter">Status</InputLabel>
          <Select
            labelId="invite-status-filter"
            label="Status"
            value={status}
            onChange={(event) => setStatus(event.target.value as StatusFilter)}
          >
            <MenuItem value="pending">Pending</MenuItem>
            <MenuItem value="accepted">Accepted</MenuItem>
            <MenuItem value="revoked">Revoked</MenuItem>
            <MenuItem value="expired">Expired</MenuItem>
            <MenuItem value="all">All</MenuItem>
          </Select>
        </FormControl>
        <Box sx={{ flexGrow: 1 }} />
        <Button variant="contained" startIcon={<AddIcon />} disabled={!canWrite} onClick={() => setDialogOpen(true)}>
          Invite member
        </Button>
      </Stack>

      {error && <Alert severity="error">{error}</Alert>}

      {!isLoading && invites.length === 0 && !error && (
        <Typography color="text.secondary">No invitations.</Typography>
      )}

      {invites.map((invite) => (
        <Paper key={invite.id} variant="outlined" sx={{ p: 2 }} data-testid={`invite-${invite.id}`}>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ alignItems: { sm: 'center' } }}>
            <Box sx={{ flexGrow: 1, minWidth: 0 }}>
              <Typography noWrap sx={{ fontWeight: 600 }}>
                {invite.email}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {orgRoleLabel(invite.role)}
                {invite.invitedBy ? ` · invited by ${invite.invitedBy.email}` : ''}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {invite.status === 'pending'
                  ? `Expires ${formatDate(invite.expiresAt)}`
                  : invite.status === 'accepted'
                    ? `Accepted ${formatDate(invite.acceptedAt)}`
                    : `Sent ${formatDate(invite.createdAt)}`}
              </Typography>
            </Box>
            <Chip
              label={invite.status}
              color={INVITE_STATUS_COLOR[invite.status]}
              size="small"
              sx={{ alignSelf: { xs: 'flex-start', sm: 'center' }, textTransform: 'capitalize' }}
            />
            {invite.status === 'pending' && (
              <Button
                size="small"
                color="error"
                variant="outlined"
                disabled={!canWrite || busy === invite.id}
                onClick={async () => {
                  setBusy(invite.id);
                  try {
                    await revokeInvite(invite.id);
                  } catch {
                    // The hook holds the API's message in `error`.
                  } finally {
                    setBusy(null);
                  }
                }}
              >
                Revoke
              </Button>
            )}
          </Stack>
        </Paper>
      ))}

      <InviteMemberDialog open={dialogOpen} onClose={() => setDialogOpen(false)} onInvite={inviteMember} />
    </Stack>
  );
}
