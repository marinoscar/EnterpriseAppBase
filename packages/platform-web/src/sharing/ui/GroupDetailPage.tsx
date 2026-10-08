// =============================================================================
// GroupDetailPage: one group, its members and its invitations (issue #731)
// =============================================================================
//
// A route component (`/settings/groups/:id` in the reference app). What the
// viewer sees follows what the API will accept, never the reverse: a group
// admin (or a `groups:admin` holder) with `groups:write` manages members,
// invitations, the name and the group itself; every member may leave. The
// server's refusals are explained, not just shown:
//
//   409 VERSION_CONFLICT       someone renamed it meanwhile -> "Reload"
//   409 GROUP_OWNS_RESOURCES   the group still owns records -> the counts
//   409 LAST_GROUP_ADMIN       demoting or leaving would leave no admin
//
// Plain MUI `Table`: the app's datatable components are app code, which a
// package never imports.
// =============================================================================

import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  IconButton,
  MenuItem,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlined';
import type { SxProps, Theme } from '@mui/material';
import { SHARING_LIMITS } from '@marinoscar/platform-contract/sharing';
import type { GroupDto, GroupMemberDto, GroupRole } from '@marinoscar/platform-contract/sharing';
import { useId, useState } from 'react';
import type { ComponentType, FormEvent, ReactElement } from 'react';
import { Link as RouterLink, useNavigate, useParams } from 'react-router-dom';

import type { SharingClient } from '../headless/client.js';
import { toSharingError } from '../headless/errors.js';
import type { SharingError } from '../headless/types.js';
import { useGroupInvites } from '../headless/useGroupInvites.js';
import { useGroupMembers } from '../headless/useGroupMembers.js';
import { useGroup, useGroupActions } from '../headless/useGroups.js';
import { EMAIL_PATTERN, expiryText, formatDate, humanizeType } from '../internal/format.js';
import { LiveRegion } from '../internal/live-region.js';
import { useCan, useViewerId } from '../internal/use-can.js';
import { GROUP_ROLE_OPTIONS, groupRoleLabel } from './copy.js';

/**
 * The parts of {@link GroupDetailPage} an app may replace.
 *
 * @stability experimental
 */
export interface GroupDetailPageSlots {
  /** The page header. Default a back link, an `h1` with the name and the description. */
  Header?: ComponentType<{ group: GroupDto; backPath: string }>;
}

/**
 * The props of {@link GroupDetailPage}. All optional: the route renders
 * `<GroupDetailPage />` and the id comes from the `:id` route parameter.
 *
 * @stability experimental
 */
export interface GroupDetailPageProps {
  /** The group. Default the `:id` route parameter. */
  groupId?: string;
  /** Where "back" and a delete or a leave go. Default `/settings/groups`. */
  backPath?: string;
  /** The viewer's user id (for "leave"). Default the host viewer's. */
  currentUserId?: string | null;
  /** Permission check for hiding controls; default the host viewer's (`groups:write`, `groups:admin`). */
  can?: (permission: string) => boolean;
  /** The sharing client; default one over the host's transport. */
  client?: SharingClient;
  /** Parts to replace. */
  slots?: GroupDetailPageSlots;
  /** Styles for the root. */
  sx?: SxProps<Theme>;
  /** A class for the root. */
  className?: string;
}

function DefaultHeader({ group, backPath }: { group: GroupDto; backPath: string }): ReactElement {
  return (
    <Box sx={{ mb: 3 }}>
      <Button component={RouterLink} to={backPath} startIcon={<ArrowBackIcon />} sx={{ mb: 1 }}>
        Groups
      </Button>
      <Typography variant="h4" component="h1" gutterBottom sx={{ overflowWrap: 'anywhere' }}>
        {group.name}
      </Typography>
      {group.description && (
        <Typography variant="body1" color="text.secondary" sx={{ overflowWrap: 'anywhere' }}>
          {group.description}
        </Typography>
      )}
      <Typography variant="body2" color="text.secondary">
        {group.memberCount} {group.memberCount === 1 ? 'member' : 'members'}
        {group.myRole ? ` · You are ${groupRoleLabel(group.myRole).toLowerCase()}` : ''}
      </Typography>
    </Box>
  );
}

/** "3 records (transcript: 2, album: 1)" from `details.counts` of `GROUP_OWNS_RESOURCES`. */
function ownedResourcesMessage(error: SharingError): string {
  const counts = (error.details as { counts?: Record<string, number> } | undefined)?.counts ?? {};
  const entries = Object.entries(counts).filter(([, n]) => typeof n === 'number' && n > 0);
  const total = entries.reduce((sum, [, n]) => sum + n, 0);
  if (total === 0) return 'This group still owns records. Move them to another owner or delete them, then try again.';
  const parts = entries.map(([type, n]) => `${humanizeType(type).toLowerCase()}: ${n}`).join(', ');
  return `This group still owns ${total} ${total === 1 ? 'record' : 'records'} (${parts}). Move them to another owner or delete them, then try again.`;
}

function explain(error: unknown): SharingError & { reload?: boolean } {
  const e = toSharingError(error);
  if (e.reason === 'GROUP_OWNS_RESOURCES') return { ...e, message: ownedResourcesMessage(e) };
  if (e.reason === 'LAST_GROUP_ADMIN') {
    return { ...e, message: 'A group needs at least one admin. Make another member an admin first.' };
  }
  if (e.reason === 'VERSION_CONFLICT') return { ...e, reload: true };
  return e;
}

function memberName(member: GroupMemberDto): string {
  return member.displayName ?? member.email;
}

/**
 * One group: its header, members (role, remove, leave), invitations (create,
 * revoke), rename and delete. See the module header for the refusals it
 * explains.
 *
 * @param props - see {@link GroupDetailPageProps}.
 * @returns the page.
 *
 * @example
 * ```tsx
 * <Route path="/settings/groups/:id" element={<GroupDetailPage />} />
 * ```
 *
 * @extensionPoint component
 * @stability experimental
 */
export function GroupDetailPage(props: GroupDetailPageProps): ReactElement {
  const params = useParams();
  const groupId = props.groupId ?? params.id;
  const backPath = props.backPath ?? '/settings/groups';
  const can = useCan(props.can);
  const viewerId = useViewerId(props.currentUserId);
  const navigate = useNavigate();
  const ids = useId();
  const clientOption = props.client ? { client: props.client } : {};
  const Header = props.slots?.Header ?? DefaultHeader;

  const group = useGroup(groupId, clientOption);
  const members = useGroupMembers(groupId, clientOption);
  const isManager = group.data !== null && (group.data.myRole === 'admin' || can('groups:admin'));
  const canManage = isManager && can('groups:write');
  const invites = useGroupInvites(groupId, { enabled: isManager, ...clientOption });
  const actions = useGroupActions(clientOption);

  const [pageError, setPageError] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<GroupRole>('viewer');
  const [inviteTouched, setInviteTouched] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameName, setRenameName] = useState('');
  const [renameDescription, setRenameDescription] = useState('');
  const [renameError, setRenameError] = useState<(SharingError & { reload?: boolean }) | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [leaveOpen, setLeaveOpen] = useState(false);
  const [leaveError, setLeaveError] = useState<string | null>(null);

  if (!groupId) {
    return (
      <Alert severity="error" sx={props.sx} className={props.className}>
        No group was named.
      </Alert>
    );
  }

  if (group.loading && group.data === null) {
    return (
      <Box sx={props.sx} className={props.className}>
        <CircularProgress aria-label="Loading the group" />
      </Box>
    );
  }

  if (group.data === null) {
    const notFound = group.error?.status === 404;
    return (
      <Box sx={props.sx} className={props.className}>
        <Button component={RouterLink} to={backPath} startIcon={<ArrowBackIcon />} sx={{ mb: 2 }}>
          Groups
        </Button>
        <Alert
          severity={notFound ? 'info' : 'error'}
          action={notFound ? undefined : <Button onClick={() => void group.refresh()}>Retry</Button>}
        >
          {notFound ? 'This group does not exist, or you are not a member of it.' : (group.error?.message ?? 'Could not load the group.')}
        </Alert>
      </Box>
    );
  }

  const current = group.data;
  const memberItems = members.data?.items ?? [];
  const inviteItems = invites.data?.items ?? [];
  const isMember = current.myRole !== null;
  const inviteValid = EMAIL_PATTERN.test(inviteEmail.trim());

  const changeRole = async (member: GroupMemberDto, role: GroupRole) => {
    setPageError(null);
    try {
      await actions.updateMember(current.id, member.userId, role);
      setAnnouncement(`${memberName(member)} is now ${groupRoleLabel(role).toLowerCase()}.`);
      await Promise.all([members.refresh(), member.userId === viewerId ? group.refresh() : Promise.resolve()]);
    } catch (err) {
      setPageError(explain(err).message);
    }
  };

  const removeMember = async (member: GroupMemberDto) => {
    setPageError(null);
    try {
      await actions.removeMember(current.id, member.userId);
      setAnnouncement(`${memberName(member)} was removed from the group.`);
      await Promise.all([members.refresh(), group.refresh()]);
    } catch (err) {
      setPageError(explain(err).message);
    }
  };

  const leave = async () => {
    if (!viewerId) return;
    setLeaveError(null);
    try {
      await actions.removeMember(current.id, viewerId);
      setLeaveOpen(false);
      navigate(backPath);
    } catch (err) {
      setLeaveError(explain(err).message);
    }
  };

  const submitInvite = async (event: FormEvent) => {
    event.preventDefault();
    setInviteTouched(true);
    setInviteError(null);
    if (!inviteValid) return;
    const email = inviteEmail.trim().toLowerCase();
    try {
      await actions.invite(current.id, { email, role: inviteRole });
      setInviteEmail('');
      setInviteTouched(false);
      setAnnouncement(`Invitation sent to ${email}.`);
      await invites.refresh();
    } catch (err) {
      setInviteError(explain(err).message);
    }
  };

  const revokeInvite = async (inviteId: string, email: string) => {
    setInviteError(null);
    try {
      await actions.revokeInvite(current.id, inviteId);
      setAnnouncement(`Invitation to ${email} revoked.`);
      await invites.refresh();
    } catch (err) {
      setInviteError(explain(err).message);
    }
  };

  const openRename = () => {
    setRenameName(current.name);
    setRenameDescription(current.description ?? '');
    setRenameError(null);
    setRenameOpen(true);
  };

  const submitRename = async (event: FormEvent) => {
    event.preventDefault();
    const name = renameName.trim();
    if (!name) {
      setRenameError({ message: 'Enter a name for the group.', status: null, reason: null, retryAfterSeconds: null, details: undefined });
      return;
    }
    setRenameError(null);
    try {
      await actions.update(current.id, { name, description: renameDescription.trim() || null }, current.version);
      setRenameOpen(false);
      setAnnouncement('Group saved.');
      await group.refresh();
    } catch (err) {
      setRenameError(explain(err));
    }
  };

  const reloadForRename = async () => {
    await group.refresh();
    setRenameError(null);
    setRenameOpen(false);
  };

  const confirmDelete = async () => {
    setDeleteError(null);
    try {
      await actions.remove(current.id);
      setDeleteOpen(false);
      navigate(backPath);
    } catch (err) {
      setDeleteError(explain(err).message);
    }
  };

  return (
    <Box sx={props.sx} className={props.className}>
      <Header group={current} backPath={backPath} />

      <Stack direction="row" spacing={1} sx={{ mb: 3, flexWrap: 'wrap', rowGap: 1 }}>
        {canManage && (
          <Button variant="outlined" onClick={openRename}>
            Rename
          </Button>
        )}
        {isMember && viewerId && (
          <Button variant="outlined" onClick={() => setLeaveOpen(true)}>
            Leave group
          </Button>
        )}
        {canManage && (
          <Button variant="outlined" color="error" onClick={() => setDeleteOpen(true)}>
            Delete group
          </Button>
        )}
      </Stack>

      {pageError && (
        <Alert severity="error" sx={{ mb: 2 }} data-testid="group-error" onClose={() => setPageError(null)}>
          {pageError}
        </Alert>
      )}

      {/* ---- Members ---- */}
      <Card variant="outlined" sx={{ mb: 3 }}>
        <CardContent>
          <Typography variant="h6" component="h2" gutterBottom id={`${ids}-members`}>
            Members
          </Typography>
          {members.loading && members.data === null ? (
            <CircularProgress size={24} aria-label="Loading members" />
          ) : members.error ? (
            <Alert severity="error" action={<Button onClick={() => void members.refresh()}>Retry</Button>}>
              {members.error.message}
            </Alert>
          ) : (
            <TableContainer>
              <Table size="small" aria-labelledby={`${ids}-members`}>
                <TableHead>
                  <TableRow>
                    <TableCell>Member</TableCell>
                    <TableCell>Role</TableCell>
                    {canManage && (
                      <TableCell align="right">
                        <Box component="span" sx={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clipPath: 'inset(50%)' }}>
                          Actions
                        </Box>
                      </TableCell>
                    )}
                  </TableRow>
                </TableHead>
                <TableBody>
                  {memberItems.map((member) => {
                    const name = memberName(member);
                    const isSelf = member.userId === viewerId;
                    return (
                      <TableRow key={member.userId} data-testid={`member-${member.userId}`}>
                        <TableCell sx={{ overflowWrap: 'anywhere' }}>
                          <Typography variant="body2">
                            {name}
                            {isSelf ? ' (you)' : ''}
                          </Typography>
                          {member.displayName && (
                            <Typography variant="caption" color="text.secondary">
                              {member.email}
                            </Typography>
                          )}
                        </TableCell>
                        <TableCell>
                          {canManage ? (
                            <TextField
                              select
                              label="Role"
                              value={member.role}
                              onChange={(event) => void changeRole(member, event.target.value as GroupRole)}
                              size="small"
                              sx={{ minWidth: 120 }}
                              slotProps={{ select: { inputProps: { 'aria-label': `Role for ${name}` } } }}
                            >
                              {GROUP_ROLE_OPTIONS.map((option) => (
                                <MenuItem key={option.value} value={option.value}>
                                  {option.label}
                                </MenuItem>
                              ))}
                            </TextField>
                          ) : (
                            groupRoleLabel(member.role)
                          )}
                        </TableCell>
                        {canManage && (
                          <TableCell align="right">
                            {!isSelf && (
                              <Tooltip title="Remove from the group">
                                <IconButton aria-label={`Remove ${name}`} onClick={() => void removeMember(member)}>
                                  <DeleteOutlineIcon />
                                </IconButton>
                              </Tooltip>
                            )}
                          </TableCell>
                        )}
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </TableContainer>
          )}
        </CardContent>
      </Card>

      {/* ---- Invitations (group admins only) ---- */}
      {isManager && (
        <Card variant="outlined" sx={{ mb: 3 }}>
          <CardContent>
            <Typography variant="h6" component="h2" gutterBottom>
              Invitations
            </Typography>
            {canManage && (
              <Box component="form" onSubmit={submitInvite} noValidate sx={{ mb: 2 }}>
                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ alignItems: { sm: 'flex-start' } }}>
                  <TextField
                    label="E-mail address"
                    type="email"
                    value={inviteEmail}
                    onChange={(event) => setInviteEmail(event.target.value)}
                    error={inviteTouched && !inviteValid}
                    helperText={inviteTouched && !inviteValid ? 'Enter a valid e-mail address.' : ' '}
                    size="small"
                    fullWidth
                    autoComplete="email"
                  />
                  <TextField
                    select
                    label="Invite as"
                    value={inviteRole}
                    onChange={(event) => setInviteRole(event.target.value as GroupRole)}
                    size="small"
                    sx={{ minWidth: 130 }}
                    helperText=" "
                  >
                    {GROUP_ROLE_OPTIONS.map((option) => (
                      <MenuItem key={option.value} value={option.value}>
                        {option.label}
                      </MenuItem>
                    ))}
                  </TextField>
                  <Button type="submit" variant="contained" disabled={actions.pending} sx={{ flexShrink: 0 }}>
                    Invite
                  </Button>
                </Stack>
              </Box>
            )}
            {inviteError && (
              <Alert severity="error" sx={{ mb: 1 }} data-testid="invite-error">
                {inviteError}
              </Alert>
            )}
            {invites.loading && invites.data === null ? (
              <CircularProgress size={24} aria-label="Loading invitations" />
            ) : invites.error ? (
              <Alert severity="error">{invites.error.message}</Alert>
            ) : inviteItems.length === 0 ? (
              <Typography variant="body2" color="text.secondary">
                No pending invitations.
              </Typography>
            ) : (
              <TableContainer>
                <Table size="small" aria-label="Pending invitations">
                  <TableHead>
                    <TableRow>
                      <TableCell>Address</TableCell>
                      <TableCell>Role</TableCell>
                      <TableCell>Expiry</TableCell>
                      {canManage && <TableCell align="right">Revoke</TableCell>}
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {inviteItems.map((invite) => (
                      <TableRow key={invite.id}>
                        <TableCell sx={{ overflowWrap: 'anywhere' }}>{invite.email}</TableCell>
                        <TableCell>{groupRoleLabel(invite.role)}</TableCell>
                        <TableCell>{invite.expiresAt ? formatDate(invite.expiresAt) : expiryText(null)}</TableCell>
                        {canManage && (
                          <TableCell align="right">
                            <Button
                              size="small"
                              color="error"
                              onClick={() => void revokeInvite(invite.id, invite.email)}
                              aria-label={`Revoke the invitation to ${invite.email}`}
                            >
                              Revoke
                            </Button>
                          </TableCell>
                        )}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            )}
          </CardContent>
        </Card>
      )}

      {/* ---- Rename ---- */}
      <Dialog open={renameOpen} onClose={() => setRenameOpen(false)} fullWidth maxWidth="xs" aria-labelledby={`${ids}-rename`}>
        <Box component="form" onSubmit={submitRename} noValidate>
          <DialogTitle id={`${ids}-rename`}>Rename group</DialogTitle>
          <DialogContent>
            <Stack spacing={2} sx={{ pt: 1 }}>
              {renameError && (
                <Alert
                  severity={renameError.reload ? 'warning' : 'error'}
                  data-testid="rename-error"
                  action={renameError.reload ? <Button onClick={() => void reloadForRename()}>Reload</Button> : undefined}
                >
                  {renameError.message}
                </Alert>
              )}
              <TextField
                label="Name"
                value={renameName}
                onChange={(event) => setRenameName(event.target.value)}
                required
                autoFocus
                slotProps={{ htmlInput: { maxLength: SHARING_LIMITS.groupNameMax } }}
              />
              <TextField
                label="Description"
                value={renameDescription}
                onChange={(event) => setRenameDescription(event.target.value)}
                multiline
                minRows={2}
                slotProps={{ htmlInput: { maxLength: SHARING_LIMITS.groupDescriptionMax } }}
              />
            </Stack>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setRenameOpen(false)}>Cancel</Button>
            <Button type="submit" variant="contained" disabled={actions.pending}>
              Save
            </Button>
          </DialogActions>
        </Box>
      </Dialog>

      {/* ---- Delete ---- */}
      <Dialog open={deleteOpen} onClose={() => setDeleteOpen(false)} aria-labelledby={`${ids}-delete`}>
        <DialogTitle id={`${ids}-delete`}>Delete {current.name}?</DialogTitle>
        <DialogContent>
          {deleteError && (
            <Alert severity="error" sx={{ mb: 2 }} data-testid="delete-error">
              {deleteError}
            </Alert>
          )}
          <DialogContentText>
            The group, its members and its invitations are removed. Records shared with the group stop being shared with its members.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteOpen(false)}>Cancel</Button>
          <Button color="error" variant="contained" onClick={() => void confirmDelete()} disabled={actions.pending}>
            Delete
          </Button>
        </DialogActions>
      </Dialog>

      {/* ---- Leave ---- */}
      <Dialog open={leaveOpen} onClose={() => setLeaveOpen(false)} aria-labelledby={`${ids}-leave`}>
        <DialogTitle id={`${ids}-leave`}>Leave {current.name}?</DialogTitle>
        <DialogContent>
          {leaveError && (
            <Alert severity="error" sx={{ mb: 2 }} data-testid="leave-error">
              {leaveError}
            </Alert>
          )}
          <DialogContentText>You lose access to what is shared with the group. An admin can invite you again.</DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setLeaveOpen(false)}>Cancel</Button>
          <Button color="error" variant="contained" onClick={() => void leave()} disabled={actions.pending}>
            Leave
          </Button>
        </DialogActions>
      </Dialog>

      <LiveRegion message={announcement} />
    </Box>
  );
}
