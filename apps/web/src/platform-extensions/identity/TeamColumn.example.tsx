/**
 * Reference example (PP-14.25): an app adds a "Team" column to the packaged
 * Users page, and a team badge to its own chrome, from what the API's user
 * extensions put in `extensions.team`. No package edit.
 *
 * The API half is `apps/api/src/platform-extensions/identity/team-directory.extensions.ts`
 * (`registerUserListExtension` for each row of `GET /api/users`,
 * `registerCurrentUserExtension` for `GET /api/auth/me`). The column reads the
 * contribution from the row the page already holds (`userExtension`), so it
 * fetches nothing, sorts and filters nothing (the API cannot) and exports its
 * value with the page's CSV export.
 *
 * Wire it where the route renders the page (`App.tsx`):
 * `<UsersPage slots={TEAM_USERS_PAGE_SLOTS} />`. The reference app does not wire
 * it: it ships compiled and tested, like the other web examples.
 */
import { Chip } from '@mui/material';
import { useCurrentUserExtension, userExtension } from '@marinoscar/platform-web/identity/headless';
import type { IdentityTableColumn, UserListItem } from '@marinoscar/platform-web/identity/headless';
import type { UsersPageSlots } from '@marinoscar/platform-web/identity/ui';

/** The shape the API's `team` extension contributes. */
export interface TeamExtension {
  /** The team's name. */
  team: string;
  /** Whether the user leads it. */
  lead: boolean;
}

/** Id of the added column (stable: the table persists column visibility under it). */
export const TEAM_COLUMN_ID = 'team';

/** "Core (lead)", "Growth", or `null` when the API sent no team for this user. */
export function teamLabel(user: Pick<UserListItem, 'extensions'>): string | null {
  const team = userExtension<TeamExtension>(user, 'team');
  if (!team || typeof team.team !== 'string') return null;
  return team.lead ? `${team.team} (lead)` : team.team;
}

const TEAM_COLUMN: IdentityTableColumn<UserListItem> = {
  id: TEAM_COLUMN_ID,
  label: 'Team',
  priority: 'secondary',
  width: 160,
  value: (user) => teamLabel(user),
  render: (user) => {
    const label = teamLabel(user);
    return label ? <Chip label={label} size="small" /> : null;
  },
};

/** `slots.Columns`: the Users page's columns with "Team" placed after "Roles", or last when that column is gone. */
export function withTeamColumn(base: IdentityTableColumn<UserListItem>[]): IdentityTableColumn<UserListItem>[] {
  const at = base.findIndex((column) => column.id === 'roles');
  return at < 0 ? [...base, TEAM_COLUMN] : [...base.slice(0, at + 1), TEAM_COLUMN, ...base.slice(at + 1)];
}

/** The Users page slots this example fills. */
export const TEAM_USERS_PAGE_SLOTS: UsersPageSlots = { Columns: withTeamColumn };

/** The signed-in user's team as a small badge for the app's header: reads `/auth/me` `extensions.team`. */
export function CurrentTeamBadge() {
  const team = useCurrentUserExtension<TeamExtension>('team');
  if (!team || typeof team.team !== 'string') return null;
  return <Chip size="small" variant="outlined" label={team.team} />;
}
