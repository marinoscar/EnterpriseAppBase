// The viewer's pending group invitations, with Accept and Decline (issue #731).

import { Alert, Box, Button, Card, CardContent, List, ListItem, ListItemText, Stack, Typography } from '@mui/material';
import type { SxProps, Theme } from '@mui/material';
import type { MyGroupInviteDto } from '@marinoscar/platform-contract/sharing';
import { useState } from 'react';
import type { ComponentType, ReactElement } from 'react';

import type { SharingClient } from '../headless/client.js';
import { toSharingError } from '../headless/errors.js';
import { useGroupActions } from '../headless/useGroups.js';
import { useMyGroupInvites } from '../headless/useGroupInvites.js';
import { expiryText } from '../internal/format.js';
import { LiveRegion } from '../internal/live-region.js';
import { groupRoleLabel } from './copy.js';

/**
 * The parts of {@link PendingGroupInvites} an app may replace.
 *
 * @stability experimental
 */
export interface PendingGroupInvitesSlots {
  /** Wraps the list. Default an outlined MUI `Card` with a "Group invitations" heading. */
  Container?: ComponentType<{ children: ReactElement; count: number }>;
}

/**
 * The props of {@link PendingGroupInvites}.
 *
 * @stability experimental
 */
export interface PendingGroupInvitesProps {
  /** Called after an invitation was accepted or declined (refresh the group list). */
  onChanged?: (event: { inviteId: string; groupId: string; accepted: boolean }) => void;
  /** Render nothing while there is no pending invitation. Default `true`. */
  hideWhenEmpty?: boolean;
  /** The sharing client; default one over the host's transport. */
  client?: SharingClient;
  /** Parts to replace. */
  slots?: PendingGroupInvitesSlots;
  /** Styles for the root. */
  sx?: SxProps<Theme>;
  /** A class for the root. */
  className?: string;
}

function DefaultContainer({ children, count }: { children: ReactElement; count: number }): ReactElement {
  return (
    <Card variant="outlined">
      <CardContent>
        <Typography variant="h6" component="h2" gutterBottom>
          Group invitations{count > 0 ? ` (${count})` : ''}
        </Typography>
        {children}
      </CardContent>
    </Card>
  );
}

/**
 * The viewer's pending group invitations (`useMyGroupInvites`), each with
 * Accept and Decline (`useGroupActions`).
 *
 * @param props - see {@link PendingGroupInvitesProps}.
 * @returns the list, or nothing while it is empty (with `hideWhenEmpty`).
 *
 * @example
 * ```tsx
 * <PendingGroupInvites onChanged={() => void groups.refresh()} />
 * ```
 *
 * @stability experimental
 */
export function PendingGroupInvites(props: PendingGroupInvitesProps): ReactElement | null {
  const clientOption = props.client ? { client: props.client } : {};
  const invites = useMyGroupInvites(clientOption);
  const actions = useGroupActions(clientOption);
  const [error, setError] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const Container = props.slots?.Container ?? DefaultContainer;
  const items = invites.data?.items ?? [];

  const answer = async (invite: MyGroupInviteDto, accepted: boolean) => {
    setError(null);
    try {
      if (accepted) await actions.accept(invite.id);
      else await actions.decline(invite.id);
      setAnnouncement(accepted ? `You joined ${invite.groupName}.` : `Invitation to ${invite.groupName} declined.`);
      await invites.refresh();
      props.onChanged?.({ inviteId: invite.id, groupId: invite.groupId, accepted });
    } catch (err) {
      setError(toSharingError(err).message);
    }
  };

  if ((props.hideWhenEmpty ?? true) && items.length === 0 && error === null && invites.error === null) {
    return <LiveRegion message={announcement} />;
  }

  return (
    <Box sx={props.sx} className={props.className} data-testid="pending-group-invites">
      <Container count={items.length}>
        <Box>
          {(error ?? invites.error?.message) && (
            <Alert severity="error" sx={{ mb: 1 }}>
              {error ?? invites.error?.message}
            </Alert>
          )}
          {items.length === 0 ? (
            <Typography variant="body2" color="text.secondary">
              No pending invitations.
            </Typography>
          ) : (
            <List dense aria-label="Pending group invitations">
              {items.map((invite) => (
                <ListItem key={invite.id} disableGutters sx={{ flexWrap: 'wrap', gap: 1 }}>
                  <ListItemText
                    primary={invite.groupName}
                    secondary={`As ${groupRoleLabel(invite.role)} · ${expiryText(invite.expiresAt)}`}
                    sx={{ minWidth: 0 }}
                  />
                  <Stack direction="row" spacing={1}>
                    <Button
                      variant="contained"
                      size="small"
                      disabled={actions.pending}
                      onClick={() => void answer(invite, true)}
                      aria-label={`Accept the invitation to ${invite.groupName}`}
                    >
                      Accept
                    </Button>
                    <Button
                      size="small"
                      disabled={actions.pending}
                      onClick={() => void answer(invite, false)}
                      aria-label={`Decline the invitation to ${invite.groupName}`}
                    >
                      Decline
                    </Button>
                  </Stack>
                </ListItem>
              ))}
            </List>
          )}
          <LiveRegion message={announcement} />
        </Box>
      </Container>
    </Box>
  );
}
