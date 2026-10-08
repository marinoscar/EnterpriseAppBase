# @marinoscar/platform-contract/sharing

The wire shapes of the sharing routes: groups, their members and their invites (`/api/groups`, issue #728) and grants of every kind (`/api/grants`, issue #729; the link-share shapes #730 builds on included), as zod schemas with their inferred types and the zod-free role and status lists they are built from. The API's sharing slice (`@marinoscar/platform-api/sharing`) wraps the schemas as its nestjs-zod DTOs, so the OpenAPI document is generated from them. It depends on no other slice (`packages/platform-slices.json`).

## Purpose and scope

One source for what every group route sends and accepts, so the API and a client cannot drift apart: `groupRoleSchema` (`admin`, `editor`, `viewer`), the group, member and invite bodies and responses, the flat pagination shape (`page`, `pageSize`, `items`, `total`, `totalPages`) and `SHARING_LIMITS`; and for grants the create, update, list and "shared with me" shapes, the link-grant shapes (`linkGrantCreateSchema`, `issuedLinkGrantSchema`, `linkGrantViewSchema`, `linkGrantListSchema`, `publicLinkResolutionSchema`), `LINK_TOKEN_HEADER` (`x-link-token`) and `buildLinkUrl(appUrl, token)` (`${appUrl}/s#${token}`: the token travels in the URL fragment, never in a path or a query). The slice follows the contract layout: `constants.ts` (zod-free: `GROUP_ROLES`, `GROUP_INVITE_STATUSES`, `GRANT_GRANTEE_KINDS`, `ACCESS_SCOPES`, `SHARING_IDENTIFIER_PATTERN`, `SHARING_LIMITS`, `LINK_TOKEN_HEADER`, `LINK_TOKEN_PREFIX`, `LINK_TOKEN_PATTERN`, `buildLinkUrl`), `schemas.ts` (the barrel of `groups.ts` and `grants.ts`) and `index.ts`.

Not here: the services, controllers, the ownership contract, the resource-type registry, `AccessPolicy`, the principal enrichment and the permission strings and the link routes (the API slice), and any UI (#731).

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
| `grantListQuerySchema`, `grantListSchema`, `grantSchema` | `GET /api/grants?resourceType&resourceId` | the active grants of one record; `grantee` is flat, the other kind's fields `null` |
| `createGrantSchema` (`grantGranteeInputSchema`: `userGranteeSchema` or `groupGranteeSchema`) | `POST /api/grants` | a user by exactly one of `email` and `userId`; `expiresAt` an ISO instant with offset |
| `updateGrantSchema` | `PATCH /api/grants/:id` | `role` and/or `expiresAt` (`null` removes the expiry) |
| `sharedWithMeQuerySchema`, `sharedWithMeItemSchema`, `sharedWithMeListSchema` | `GET /api/grants/shared-with-me` | `via` is `user_grant` or `group_grant`; `title`/`path` when the type describes its records |
| `linkGrantCreateSchema`, `issuedLinkGrantSchema` | `POST /api/grants/links` (#730) | `role` optional (the weakest link role), `reuseActive`; the response carries the token ONCE |
| `grantListQuerySchema`, `linkGrantListSchema`, `linkGrantViewSchema` | `GET /api/grants/links?resourceType&resourceId` (#730) | newest first; `url` re-derived from the stored ciphertext, `null` for a revoked link |
| `updateGrantSchema` (`label`) | `PATCH /api/grants/:id` on a link (#730) | `label` applies to a link grant only |
| `publicLinkResolutionSchema` | `GET /api/public/links/current` with `X-Link-Token` (#730) | the generic 404 covers every failure |

## Permissions and settings

None declared here. The routes enforce `groups:read`, `groups:write`, `groups:admin`, `sharing:read`, `sharing:write` and `sharing:admin` (organization scope), declared by the API slice.

## UI

None. The sharing UI is #731.

## Infra

None.

## Observability

None. The package emits nothing at run time.

## Security notes

The e-mail schema trims and lower-cases, so the API compares addresses exactly. A resource type and a role are lower-case snake_case of at most 64 characters, so neither can smuggle SQL or a path. A link token appears in exactly one response schema, `issuedLinkGrantSchema` (the create response, once), and otherwise only as the fragment of `buildLinkUrl`'s result; `LINK_TOKEN_PATTERN` (`lnk_` and 43 base64url characters) lets a client and a secret scanner recognise one. `myGroupInviteSchema` deliberately omits the address. `groupMetadataSchema` caps the object at 32 keys and is never meant for secret material.

## Conformance suite

Completed in #732 (the sharing conformance suite).

## Upgrade notes

New in this version; nothing to migrate from.

## Troubleshooting

Completed in #732.

## Links

- [The API slice](../../../platform-api/src/sharing/README.md)
- [Platform packages spec, tenancy and access model](../../../../docs/specs/platform-packages.md#tenancy-and-access-model)
