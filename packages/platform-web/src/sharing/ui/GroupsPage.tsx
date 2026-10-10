// =============================================================================
// GroupsPage: the viewer's groups (issue #731, PP-7.4)
// =============================================================================
//
// A route component (`/settings/groups` in the reference app): pending
// invitations on top, then the viewer's groups, with an "All groups" switch for
// a `groups:admin` holder (ONE destination with an in-page toggle, never a
// second admin card: reachability versus content, docs/specs/settings-ui.md)
// and a create dialog for a `groups:write` holder. It renders inside the app's
// shell and imports none of its layout, navigation or auth context.
// =============================================================================

import AddIcon from '@mui/icons-material/Add';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  List,
  ListItemButton,
  ListItemText,
  Paper,
  Stack,
  Switch,
  TextField,
  Typography,
} from '@mui/material';
import type { SxProps, Theme } from '@mui/material';
import { SHARING_LIMITS } from '@marinoscar/platform-contract/sharing';
import { useId, useState } from 'react';
import type { ComponentType, FormEvent, ReactElement } from 'react';
import { Link as RouterLink, useNavigate } from 'react-router-dom';

import type { SharingClient } from '../headless/client.js';
import { toSharingError } from '../headless/errors.js';
import { useGroupActions, useGroups } from '../headless/useGroups.js';
import { LiveRegion } from '../internal/live-region.js';
import { useCan } from '../internal/use-can.js';
import { GROUPS_PAGE_DESCRIPTION, GROUPS_PAGE_TITLE, groupRoleLabel } from './copy.js';
import { PendingGroupInvites } from './PendingGroupInvites.js';

/**
 * The parts of {@link GroupsPage} an app may replace.
 *
 * @stability experimental
 */
export interface GroupsPageSlots {
  /** The page header. Default an `h1` with the title and the description. */
  Header?: ComponentType<{
    /** The page title (the card's). */
    title: string;
    /** The page subtitle (the card's description). */
    description: string;
  }>;
}

/**
 * The props of {@link GroupsPage}. All optional: the route renders `<GroupsPage />`.
 *
 * @stability experimental
 */
export interface GroupsPageProps {
  /** Permission check for hiding controls; default the host viewer's (`groups:write`, `groups:admin`). */
  can?: (permission: string) => boolean;
  /** The sharing client; default one over the host's transport. */
  client?: SharingClient;
  /** The detail route of a group. Default `/settings/groups/<id>`. */
  detailPath?: (groupId: string) => string;
  /** Parts to replace. */
  slots?: GroupsPageSlots;
  /** Styles for the root. */
  sx?: SxProps<Theme>;
  /** A class for the root. */
  className?: string;
}

function DefaultHeader({ title, description }: { title: string; description: string }): ReactElement {
  return (
    <Box sx={{ mb: 3 }}>
      <Typography variant="h4" component="h1" gutterBottom>
        {title}
      </Typography>
      <Typography variant="body1" color="text.secondary">
        {description}
      </Typography>
    </Box>
  );
}

const defaultDetailPath = (groupId: string) => `/settings/groups/${encodeURIComponent(groupId)}`;

/**
 * The groups page: pending invitations, the viewer's groups (or, with
 * `groups:admin`, every group of the organization) and a create dialog.
 *
 * @param props - see {@link GroupsPageProps}.
 * @returns the page.
 *
 * @example
 * ```tsx
 * <Route path="/settings/groups" element={<GroupsPage />} />
 * ```
 *
 * @extensionPoint component
 * @stability experimental
 */
export function GroupsPage(props: GroupsPageProps): ReactElement {
  const can = useCan(props.can);
  const canAdmin = can('groups:admin');
  const canWrite = can('groups:write');
  const [showAll, setShowAll] = useState(false);
  const scope = showAll && canAdmin ? 'all' : 'mine';
  const clientOption = props.client ? { client: props.client } : {};
  const groups = useGroups({ scope, ...clientOption });
  const actions = useGroupActions(clientOption);
  const navigate = useNavigate();
  const detailPath = props.detailPath ?? defaultDetailPath;
  const Header = props.slots?.Header ?? DefaultHeader;
  const ids = useId();

  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [createError, setCreateError] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState('');

  const openCreate = () => {
    setName('');
    setDescription('');
    setCreateError(null);
    setCreateOpen(true);
  };

  const submitCreate = async (event: FormEvent) => {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      setCreateError('Enter a name for the group.');
      return;
    }
    setCreateError(null);
    try {
      const created = await actions.create({ name: trimmed, description: description.trim() || null, metadata: null });
      setCreateOpen(false);
      setAnnouncement(`Group ${created.name} created.`);
      navigate(detailPath(created.id));
    } catch (err) {
      setCreateError(toSharingError(err).message);
    }
  };

  const items = groups.data?.items ?? [];

  return (
    <Box sx={props.sx} className={props.className}>
      <Header title={GROUPS_PAGE_TITLE} description={GROUPS_PAGE_DESCRIPTION} />

      <PendingGroupInvites {...clientOption} onChanged={() => void groups.refresh()} sx={{ mb: 3 }} />

      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        spacing={2}
        sx={{ mb: 2, alignItems: { sm: 'center' }, justifyContent: 'space-between' }}
      >
        <Typography variant="h6" component="h2">
          {scope === 'all' ? 'All groups in the organization' : 'Your groups'}
        </Typography>
        <Stack direction="row" spacing={2} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
          {canAdmin && (
            <FormControlLabel
              control={<Switch checked={showAll} onChange={(event) => setShowAll(event.target.checked)} />}
              label="All groups"
            />
          )}
          {canWrite && (
            <Button variant="contained" startIcon={<AddIcon />} onClick={openCreate}>
              New group
            </Button>
          )}
        </Stack>
      </Stack>

      {groups.loading && groups.data === null ? (
        <CircularProgress aria-label="Loading groups" />
      ) : groups.error ? (
        <Alert severity="error" action={<Button onClick={() => void groups.refresh()}>Retry</Button>}>
          {groups.error.message}
        </Alert>
      ) : items.length === 0 ? (
        <Paper variant="outlined" sx={{ p: 3 }}>
          <Typography color="text.secondary">
            {scope === 'all' ? 'This organization has no groups yet.' : 'You are not in any group yet.'}
          </Typography>
        </Paper>
      ) : (
        <Paper variant="outlined">
          <List aria-label={scope === 'all' ? 'All groups' : 'Your groups'} disablePadding>
            {items.map((group) => (
              <ListItemButton key={group.id} component={RouterLink} to={detailPath(group.id)} divider>
                <ListItemText
                  primary={group.name}
                  secondary={`${group.memberCount} ${group.memberCount === 1 ? 'member' : 'members'}${
                    group.description ? ` · ${group.description}` : ''
                  }`}
                  slotProps={{ secondary: { noWrap: true } }}
                  sx={{ minWidth: 0 }}
                />
                {group.myRole && <Chip size="small" label={groupRoleLabel(group.myRole)} sx={{ ml: 1 }} />}
              </ListItemButton>
            ))}
          </List>
        </Paper>
      )}

      <Dialog open={createOpen} onClose={() => setCreateOpen(false)} fullWidth maxWidth="xs" aria-labelledby={`${ids}-create`}>
        <Box component="form" onSubmit={submitCreate} noValidate>
          <DialogTitle id={`${ids}-create`}>New group</DialogTitle>
          <DialogContent>
            <Stack spacing={2} sx={{ pt: 1 }}>
              {createError && <Alert severity="error">{createError}</Alert>}
              <TextField
                label="Name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                required
                autoFocus
                slotProps={{ htmlInput: { maxLength: SHARING_LIMITS.groupNameMax } }}
              />
              <TextField
                label="Description"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                multiline
                minRows={2}
                slotProps={{ htmlInput: { maxLength: SHARING_LIMITS.groupDescriptionMax } }}
              />
            </Stack>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button type="submit" variant="contained" disabled={actions.pending}>
              Create
            </Button>
          </DialogActions>
        </Box>
      </Dialog>
      <LiveRegion message={announcement} />
    </Box>
  );
}
