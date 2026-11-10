import type { CurrentUserExtension, UserListExtension } from '@marinoscar/platform-api/identity';

// =============================================================================
// A team on `/api/auth/me` and on each row of `/api/users` (PP-14.25)
// =============================================================================
//
// The worked example of the identity slice's user extensions: an app attaches
// its own fact about a user (here, the team they work in) to the two payloads
// the web app already reads, with no new route and no package edit.
//
//   - `registerCurrentUserExtension` adds `extensions.team` to `GET /api/auth/me`
//     (the signed-in user's own team: a header badge, a permission-free UI hint);
//   - `registerUserListExtension` adds `extensions.team` to each row of
//     `GET /api/users` (an extra column on the Users page).
//
// THE LIST RESOLVER IS BATCHED. `GET /api/users` returns up to a page of users;
// the resolver is called ONCE with every id of that page and answers a `Map`,
// so the page costs one lookup, not one per row (`teamDirectory.queries` counts
// both so the spec can prove it). A fork reads its own table here:
//
//   resolve: async (ids) => new Map((await prisma.teamMember.findMany({ where: { userId: { in: [...ids] } } })).map(...))
//
// WHAT IT MUST NOT DO. A contribution is small JSON that the BROWSER reads: no
// secret (a key named `token`, `apiKey`, `password`... is refused), no more than
// 4 KiB on `/auth/me` and 1 KiB per row of the list. A resolver that throws, is
// slow or breaks the rule is skipped and logged; it never fails the request.
//
// The directory below is in memory so the example needs no table. It starts
// EMPTY, so the reference app's payloads are unchanged until something assigns a
// team; a fork that does not want the example deletes the two calls in
// `app-registrations/identity.ts` and this file.
// =============================================================================

/** One user's team. */
export type TeamAssignment = {
  /** The team's name. */
  team: string;
  /** Whether the user leads it. */
  lead: boolean;
};

/** The example's data source. Replace it with a table. */
export const teamDirectory = {
  /** Team by user id. Empty by default. */
  assignments: new Map<string, TeamAssignment>(),
  /** How many times each resolver ran, to prove the list is not one query per row. */
  queries: { single: 0, batch: 0 },
  /** Forget everything (tests). */
  reset(): void {
    this.assignments.clear();
    this.queries.single = 0;
    this.queries.batch = 0;
  },
};

/** `extensions.team` of `GET /api/auth/me`. */
export const currentUserTeamExtension: CurrentUserExtension = {
  id: 'team',
  resolve: (userId) => {
    teamDirectory.queries.single += 1;
    const assignment = teamDirectory.assignments.get(userId);
    return assignment ? { ...assignment } : null;
  },
};

/** `extensions.team` of each row of `GET /api/users`, resolved for the whole page at once. */
export const userListTeamExtension: UserListExtension = {
  id: 'team',
  resolve: (userIds) => {
    teamDirectory.queries.batch += 1;
    const result = new Map<string, TeamAssignment>();
    for (const userId of userIds) {
      const assignment = teamDirectory.assignments.get(userId);
      if (assignment) result.set(userId, { ...assignment });
    }
    return result;
  },
};
