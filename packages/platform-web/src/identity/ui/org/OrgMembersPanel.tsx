/**
 * The Members tab of the Organization page (#726, PP-6.7): the ACTIVE
 * organization's members, with their org role and status.
 *
 * Controls are disabled without `org_members:write` (the API enforces it
 * anyway), and on the viewer's own row: the API refuses self-demotion,
 * self-suspension and self-removal, so the page does not offer them. Every
 * other rule (the last active administrator) is the API's to decide; its
 * refusal is shown as returned.
 *
 * Laid out as a list of rows that wrap, not a wide table, so it works at
 * phone width without horizontal scrolling.
 */
import type { ReactElement } from 'react';
import { useEffect, useState } from 'react';
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
  FormControl,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { useAuth } from '../../headless/index.js';
import { usePermissions } from '../../headless/index.js';
import { useOrgMembers } from '../../headless/index.js';
import { ORG_ROLES, type OrgMember, type OrgRole } from '../../headless/index.js';
import { MEMBER_STATUS_COLOR, formatDate, orgRoleLabel } from './orgLabels.js';

/**
 * The current organization's members: role and status changes and removal
 * (`org_members:write`). The Members tab of {@link OrganizationPage}.
 *
 * @returns the component.
 *
 * @stability stable
 */
export function OrgMembersPanel(): ReactElement {
  const { user } = useAuth();
  const { hasPermission } = usePermissions();
  const canWrite = hasPermission('org_members:write');
  const { members, total, isLoading, error, fetchMembers, updateMember, removeMember } = useOrgMembers();
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<OrgMember | null>(null);

  useEffect(() => {
    void fetchMembers({ page: 1, pageSize: 100, search: search.trim() || undefined });
  }, [fetchMembers, search]);

  async function run(userId: string, action: () => Promise<void>) {
    setBusy(userId);
    try {
      await action();
    } catch {
      // The hook already holds the API's message in `error`.
    } finally {
      setBusy(null);
    }
  }

  return (
    <Stack spacing={2}>
      <TextField
        label="Search members"
        size="small"
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        sx={{ maxWidth: { sm: 360 } }}
      />

      {error && <Alert severity="error">{error}</Alert>}

      {!isLoading && members.length === 0 && !error && (
        <Typography color="text.secondary">No members match.</Typography>
      )}

      {members.map((member) => {
        const isSelf = member.userId === user?.id;
        const disabled = !canWrite || isSelf || busy === member.userId;
        return (
          <Paper key={member.userId} variant="outlined" sx={{ p: 2 }} data-testid={`member-${member.userId}`}>
            <Stack
              direction={{ xs: 'column', sm: 'row' }}
              spacing={2}
              sx={{ alignItems: { xs: 'stretch', sm: 'center' } }}
            >
              <Box sx={{ flexGrow: 1, minWidth: 0 }}>
                <Typography noWrap sx={{ fontWeight: 600 }}>
                  {member.displayName ?? member.email}
                  {isSelf ? ' (you)' : ''}
                </Typography>
                <Typography variant="body2" color="text.secondary" noWrap>
                  {member.email}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  Last active {formatDate(member.lastActiveAt)}
                </Typography>
              </Box>

              <Chip
                label={member.status === 'active' ? 'Active' : 'Suspended'}
                color={MEMBER_STATUS_COLOR[member.status]}
                size="small"
                sx={{ alignSelf: { xs: 'flex-start', sm: 'center' } }}
              />

              <FormControl size="small" sx={{ minWidth: 160 }} disabled={disabled}>
                <InputLabel id={`role-${member.userId}`}>Role</InputLabel>
                <Select
                  labelId={`role-${member.userId}`}
                  label="Role"
                  value={member.role}
                  onChange={(event) =>
                    void run(member.userId, () =>
                      updateMember(member.userId, { roleName: event.target.value as OrgRole }),
                    )
                  }
                >
                  {!(ORG_ROLES as readonly string[]).includes(member.role) && (
                    <MenuItem value={member.role} disabled>
                      {orgRoleLabel(member.role)}
                    </MenuItem>
                  )}
                  {ORG_ROLES.map((role) => (
                    <MenuItem key={role} value={role}>
                      {orgRoleLabel(role)}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>

              <Stack direction="row" spacing={1}>
                <Button
                  size="small"
                  variant="outlined"
                  disabled={disabled}
                  onClick={() =>
                    void run(member.userId, () =>
                      updateMember(member.userId, {
                        status: member.status === 'active' ? 'suspended' : 'active',
                      }),
                    )
                  }
                >
                  {member.status === 'active' ? 'Suspend' : 'Reactivate'}
                </Button>
                <Button
                  size="small"
                  color="error"
                  variant="outlined"
                  disabled={disabled}
                  onClick={() => setConfirmRemove(member)}
                >
                  Remove
                </Button>
              </Stack>
            </Stack>
          </Paper>
        );
      })}

      {total > members.length && (
        <Typography variant="body2" color="text.secondary">
          Showing {members.length} of {total}. Search to narrow the list.
        </Typography>
      )}

      <Dialog open={confirmRemove !== null} onClose={() => setConfirmRemove(null)}>
        <DialogTitle>Remove member?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            {confirmRemove?.email} loses access to this organization at once: their sessions, personal access
            tokens and device sign-ins for it stop working. Their other organizations are not affected.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmRemove(null)}>Cancel</Button>
          <Button
            color="error"
            onClick={() => {
              const target = confirmRemove;
              setConfirmRemove(null);
              if (target) void run(target.userId, () => removeMember(target.userId));
            }}
          >
            Remove
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
}
