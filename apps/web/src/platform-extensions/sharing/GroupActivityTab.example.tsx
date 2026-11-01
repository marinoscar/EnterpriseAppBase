/**
 * Reference example (PP-14.25): an app adds an "Activity" tab to the packaged
 * group page through `slots.Tabs`, and a row action to each member through
 * `slots.MemberRowActions`, with no package edit.
 *
 * A tab holds content that is PARALLEL to Members and Invitations (another view
 * of the same group). The page keeps those two and appends the app's. The panel
 * receives the loaded group as data; what it shows is the app's (here, a fixed
 * summary; a fork would call its own endpoint with `usePlatformApi()`).
 *
 * Wire it where the route renders the page (`App.tsx`):
 * `<GroupDetailPage slots={GROUP_ACTIVITY_SLOTS} />`. The reference app does not
 * wire it: it ships compiled and tested, like the other web examples.
 */
import { Box, Button, Typography } from '@mui/material';
import type { GroupDetailPageSlots, GroupDetailTab, GroupMemberRowActionsProps } from '@marinoscar/platform-web/sharing/ui';

/** The panel of the "Activity" tab. */
export const GroupActivityPanel: GroupDetailTab['Panel'] = ({ group }) => (
  <Box component="section" aria-label="Group activity">
    <Typography variant="h6" component="h2" gutterBottom>
      Activity in {group.name}
    </Typography>
    <Typography variant="body2" color="text.secondary">
      {group.memberCount} {group.memberCount === 1 ? 'member' : 'members'} · nothing has happened here yet.
    </Typography>
  </Box>
);

/** A per-member action: say hello. Shown to everyone who can see the member, managers or not. */
export const MessageMemberAction = ({ member, isSelf }: GroupMemberRowActionsProps) =>
  isSelf ? null : (
    <Button size="small" href={`mailto:${member.email}`} aria-label={`Email ${member.displayName ?? member.email}`}>
      Email
    </Button>
  );

/** The group page slots this example fills. Keep it a module constant. */
export const GROUP_ACTIVITY_SLOTS: GroupDetailPageSlots = {
  Tabs: [{ id: 'activity', label: 'Activity', Panel: GroupActivityPanel }],
  MemberRowActions: MessageMemberAction,
};
