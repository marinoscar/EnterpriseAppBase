# @marinoscar/platform-contract/sharing

The wire shapes of the sharing routes: groups, their members and their invites (`/api/groups`, issue #728), as zod schemas with their inferred types and the zod-free role and status lists they are built from. The API's sharing slice (`@marinoscar/platform-api/sharing`) wraps the schemas as its nestjs-zod DTOs, so the OpenAPI document is generated from them. It depends on no other slice (`packages/platform-slices.json`).

## Purpose and scope

One source for what every group route sends and accepts, so the API and a client cannot drift apart: `groupRoleSchema` (`admin`, `editor`, `viewer`), the group, member and invite bodies and responses, the flat pagination shape (`page`, `pageSize`, `items`, `total`, `totalPages`) and `SHARING_LIMITS`. The slice follows the contract layout: `constants.ts` (zod-free: `GROUP_ROLES`, `GROUP_INVITE_STATUSES`, `SHARING_LIMITS`), `schemas.ts` (the barrel of `groups.ts`) and `index.ts`.

Not here: the services, controllers, the ownership contract, the principal enrichment and the permission strings (the API slice), and any UI (#731). Grants and link shares arrive with #729 and #730.

## Install and peer dependencies

Ships inside `@marinoscar/platform-contract`; import it by its subpath:

```ts
import { createGroupSchema, GROUP_ROLES } from '@marinoscar/platform-contract/sharing';
import type { GroupDto, GroupRole } from '@marinoscar/platform-contract/sharing';
```

None beyond the package's own peer, `zod` (`^4.4.3`).

## Quick start

Completed in #732 (the sharing README and reference examples). The API's own DTOs are the working example today: `packages/platform-api/src/sharing/dto/groups.dto.ts` wraps every schema with `createZodDto`.

## Configuration

None. Schemas and constants take no options; the routes, their permissions and the module options (`maxGroupsPerCreator`, `maxMembersPerGroup`, `inviteTtlDays`) are the API slice's.

## Extension-point catalog

None. The schemas are the wire contract of the API slice; an app that needs more fields on a group keeps them in `metadata` (`groupMetadataSchema`), never in a new column. Reviewed again in #732.

## Data

No tables. The shapes mirror the `sharing` fragment of `@marinoscar/platform-db` (`groups`, `group_members`, `group_invites`):

| Schema | Route | Notes |
|---|---|---|
| `groupListQuerySchema`, `groupListSchema` | `GET /api/groups` | `scope=mine` (default) or `all`; flat pagination |
| `createGroupSchema`, `updateGroupSchema`, `groupSchema` | `POST`, `PATCH`, `GET /api/groups/:id` | `version` goes back in `If-Match`; `myRole` is the caller's role or `null` |
| `addGroupMemberSchema`, `updateGroupMemberSchema`, `groupMemberSchema`, `groupMemberListSchema` | `/api/groups/:id/members` | exactly one of `email` and `userId` |
| `createGroupInviteSchema`, `groupInviteListQuerySchema`, `groupInviteSchema`, `groupInviteListSchema` | `/api/groups/:id/invites` | e-mail lower-cased; `status` derived at read time (`expired` included) |
| `myGroupInviteSchema`, `myGroupInviteListSchema`, `groupMembershipSchema` | `/api/groups/invites/mine`, `.../accept` | the caller's own invites carry no address |

## Permissions and settings

None declared here. The routes enforce `groups:read`, `groups:write` and `groups:admin` (organization scope), declared by the API slice.

## UI

None. The sharing UI is #731.

## Infra

None.

## Observability

None. The package emits nothing at run time.

## Security notes

The e-mail schema trims and lower-cases, so the API compares addresses exactly. `myGroupInviteSchema` deliberately omits the address. `groupMetadataSchema` caps the object at 32 keys and is never meant for secret material.

## Conformance suite

Completed in #732 (the sharing conformance suite).

## Upgrade notes

New in this version; nothing to migrate from.

## Troubleshooting

Completed in #732.

## Links

- [The API slice](../../../platform-api/src/sharing/README.md)
- [Platform packages spec, tenancy and access model](../../../../docs/specs/platform-packages.md#tenancy-and-access-model)
