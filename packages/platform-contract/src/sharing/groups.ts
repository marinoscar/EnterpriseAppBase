// =============================================================================
// Groups: the wire shapes of `/api/groups` (issue #728, PP-7.1)
// =============================================================================
//
// A group is a set of users inside ONE organization that can own and share
// content; it is never a tenant (spec decision D6). The API's sharing slice
// (`@marinoscar/platform-api/sharing`) wraps these schemas as its nestjs-zod
// DTOs, so the OpenAPI document is generated from them.
//
//   GET    /api/groups?scope=mine|all          groupListQuerySchema       -> groupListSchema
//   POST   /api/groups                         createGroupSchema          -> groupSchema
//   GET    /api/groups/:id                                                -> groupSchema
//   PATCH  /api/groups/:id (If-Match)          updateGroupSchema          -> groupSchema
//   GET    /api/groups/:id/members             pageQuerySchema            -> groupMemberListSchema
//   POST   /api/groups/:id/members             addGroupMemberSchema       -> groupMemberSchema
//   PATCH  /api/groups/:id/members/:userId     updateGroupMemberSchema    -> groupMemberSchema
//   GET    /api/groups/:id/invites             groupInviteListQuerySchema -> groupInviteListSchema
//   POST   /api/groups/:id/invites             createGroupInviteSchema    -> groupInviteSchema
//   GET    /api/groups/invites/mine                                       -> myGroupInviteListSchema
//   POST   /api/groups/invites/:inviteId/accept                           -> groupMembershipSchema
// =============================================================================

import { z } from 'zod';

import { GROUP_INVITE_LIST_FILTERS, GROUP_INVITE_STATUSES, GROUP_LIST_SCOPES, GROUP_ROLES, SHARING_LIMITS } from './constants.js';
import { wireEnum } from './enum.js';

/**
 * A group role on the wire.
 *
 * @stability experimental
 */
export const groupRoleSchema = wireEnum(GROUP_ROLES).describe('A group role: `admin`, `editor` or `viewer`.');

/**
 * An e-mail address, trimmed and lower-cased (invites are stored lower-cased).
 *
 * @stability experimental
 */
export const groupEmailSchema = z
  .string()
  .trim()
  .max(SHARING_LIMITS.emailMax)
  .pipe(z.email())
  .transform((email) => email.toLowerCase());

/**
 * `page` and `pageSize` of a list, coerced from the query string.
 *
 * @stability experimental
 */
export const pageQuerySchema = z.object({
  /** 1-based page number. */
  page: z.coerce.number().int().min(1).default(1),
  /** Items per page, 1..{@link SHARING_LIMITS}.pageSizeMax. */
  pageSize: z.coerce.number().int().min(1).max(SHARING_LIMITS.pageSizeMax).default(SHARING_LIMITS.pageSizeDefault),
});

/**
 * `GET /api/groups` query: `scope=mine` (groups the caller belongs to, the
 * default) or `scope=all` (every group of the organization; needs
 * `groups:admin`), plus the page.
 *
 * @stability experimental
 */
export const groupListQuerySchema = pageQuerySchema.extend({
  /** `mine` or `all`. */
  scope: wireEnum(GROUP_LIST_SCOPES)
    .default('mine')
    .describe('`mine`: groups you belong to. `all`: every group of the organization (needs `groups:admin`).'),
});

/**
 * Free-form app data on a group (`groups.metadata`): an object, at most 32
 * keys. Never secret material.
 *
 * @stability experimental
 */
export const groupMetadataSchema = z
  .record(z.string().max(64), z.unknown())
  .refine((value) => Object.keys(value).length <= 32, 'At most 32 metadata keys')
  .describe('App-defined fields of the group (JSON object, at most 32 keys). Never secret material.');

/**
 * `POST /api/groups` body.
 *
 * @stability experimental
 */
export const createGroupSchema = z
  .object({
    /** The group's display name. */
    name: z.string().trim().min(1).max(SHARING_LIMITS.groupNameMax),
    /** An optional description. */
    description: z.string().trim().max(SHARING_LIMITS.groupDescriptionMax).nullish(),
    /** App-defined fields. */
    metadata: groupMetadataSchema.nullish(),
  })
  .strict();

/**
 * `PATCH /api/groups/:id` body: at least one field. Send the group's
 * `version` in `If-Match`.
 *
 * @stability experimental
 */
export const updateGroupSchema = z
  .object({
    /** A new display name. */
    name: z.string().trim().min(1).max(SHARING_LIMITS.groupNameMax).optional(),
    /** A new description; `null` clears it. */
    description: z.string().trim().max(SHARING_LIMITS.groupDescriptionMax).nullable().optional(),
    /** New app-defined fields (replaces the object); `null` clears it. */
    metadata: groupMetadataSchema.nullable().optional(),
  })
  .strict()
  .refine((body) => Object.keys(body).length > 0, 'Send at least one field');

/**
 * One group as the API returns it.
 *
 * @stability experimental
 */
export const groupSchema = z.object({
  /** The group's id. */
  id: z.uuid(),
  /** The organization the group lives in. */
  orgId: z.uuid(),
  /** Display name. */
  name: z.string(),
  /** Description, or `null`. */
  description: z.string().nullable(),
  /** App-defined fields, or `null`. */
  metadata: z.record(z.string(), z.unknown()).nullable(),
  /** Who created it, or `null` (deleted user). */
  createdById: z.uuid().nullable(),
  /** Optimistic-concurrency version: send it in `If-Match` to PATCH. */
  version: z.number().int(),
  /** The caller's role in the group, or `null` (a `groups:admin` holder who is not a member). */
  myRole: groupRoleSchema.nullable(),
  /** How many members the group has. */
  memberCount: z.number().int(),
  /** When it was created. */
  createdAt: z.iso.datetime(),
  /** When it last changed. */
  updatedAt: z.iso.datetime(),
});

/**
 * A page of groups (`page`, `pageSize`, `items`, `total`, `totalPages`).
 *
 * @stability experimental
 */
export const groupListSchema = z.object({
  /** The groups of this page. */
  items: z.array(groupSchema),
  /** Groups in the whole list. */
  total: z.number().int(),
  /** This page's number. */
  page: z.number().int(),
  /** The page size. */
  pageSize: z.number().int(),
  /** Pages in the whole list. */
  totalPages: z.number().int(),
});

/**
 * `POST /api/groups/:id/members` body: exactly one of `email` and `userId`,
 * plus the role (default `viewer`). The person must already be a member of the
 * group's organization.
 *
 * @stability experimental
 */
export const addGroupMemberSchema = z
  .object({
    /** The person's e-mail (looked up among the organization's members). */
    email: groupEmailSchema.optional(),
    /** The person's user id. */
    userId: z.uuid().optional(),
    /** Their role in the group. */
    role: groupRoleSchema.default('viewer'),
  })
  .strict()
  .refine((body) => (body.email === undefined) !== (body.userId === undefined), 'Send exactly one of email and userId');

/**
 * `PATCH /api/groups/:id/members/:userId` body.
 *
 * @stability experimental
 */
export const updateGroupMemberSchema = z
  .object({
    /** The member's new role. */
    role: groupRoleSchema,
  })
  .strict();

/**
 * One member of a group.
 *
 * @stability experimental
 */
export const groupMemberSchema = z.object({
  /** The group. */
  groupId: z.uuid(),
  /** The member. */
  userId: z.uuid(),
  /** Their role in the group. */
  role: groupRoleSchema,
  /** Their e-mail address. */
  email: z.string(),
  /** Their display name, or `null`. */
  displayName: z.string().nullable(),
  /** Who added them, or `null`. */
  addedById: z.uuid().nullable(),
  /** When they joined. */
  createdAt: z.iso.datetime(),
});

/**
 * A page of members (`page`, `pageSize`, `items`, `total`, `totalPages`).
 *
 * @stability experimental
 */
export const groupMemberListSchema = z.object({
  /** The members of this page, admins first. */
  items: z.array(groupMemberSchema),
  /** Members in the group. */
  total: z.number().int(),
  /** This page's number. */
  page: z.number().int(),
  /** The page size. */
  pageSize: z.number().int(),
  /** Pages in the whole list. */
  totalPages: z.number().int(),
});

/**
 * `POST /api/groups/:id/invites` body.
 *
 * @stability experimental
 */
export const createGroupInviteSchema = z
  .object({
    /** The address to invite (stored lower-cased). */
    email: groupEmailSchema,
    /** The role the invitee gets on acceptance. */
    role: groupRoleSchema.default('viewer'),
  })
  .strict();

/**
 * `GET /api/groups/:id/invites` query: the page, and `status=pending` (the
 * default) or `all`.
 *
 * @stability experimental
 */
export const groupInviteListQuerySchema = pageQuerySchema.extend({
  /** `pending` (default) or `all`. */
  status: wireEnum(GROUP_INVITE_LIST_FILTERS).default('pending'),
});

/**
 * One invitation to a group, as the group's administrators see it.
 *
 * @stability experimental
 */
export const groupInviteSchema = z.object({
  /** The invite's id. */
  id: z.uuid(),
  /** The group. */
  groupId: z.uuid(),
  /** The group's organization. */
  orgId: z.uuid(),
  /** The invited address. */
  email: z.string(),
  /** The role on acceptance. */
  role: groupRoleSchema,
  /** What the invite currently is. */
  status: wireEnum(GROUP_INVITE_STATUSES),
  /** Who sent it, or `null`. */
  invitedById: z.uuid().nullable(),
  /** After this instant the invite can no longer be accepted; `null` never expires. */
  expiresAt: z.iso.datetime().nullable(),
  /** When it was accepted, or `null`. */
  acceptedAt: z.iso.datetime().nullable(),
  /** When it was declined, or `null`. */
  declinedAt: z.iso.datetime().nullable(),
  /** When it was revoked, or `null`. */
  revokedAt: z.iso.datetime().nullable(),
  /** When it was sent. */
  createdAt: z.iso.datetime(),
});

/**
 * A page of invites (`page`, `pageSize`, `items`, `total`, `totalPages`).
 *
 * @stability experimental
 */
export const groupInviteListSchema = z.object({
  /** The invites of this page, newest first. */
  items: z.array(groupInviteSchema),
  /** Invites in the whole list. */
  total: z.number().int(),
  /** This page's number. */
  page: z.number().int(),
  /** The page size. */
  pageSize: z.number().int(),
  /** Pages in the whole list. */
  totalPages: z.number().int(),
});

/**
 * One pending invitation addressed to the caller (`GET /api/groups/invites/mine`).
 * It carries the group's name, never the address (it is the caller's own).
 *
 * @stability experimental
 */
export const myGroupInviteSchema = z.object({
  /** The invite's id: accept or decline it by this id. */
  id: z.uuid(),
  /** The group. */
  groupId: z.uuid(),
  /** The group's display name. */
  groupName: z.string(),
  /** The group's organization. */
  orgId: z.uuid(),
  /** The role on acceptance. */
  role: groupRoleSchema,
  /** Who sent it, or `null`. */
  invitedById: z.uuid().nullable(),
  /** When it expires, or `null`. */
  expiresAt: z.iso.datetime().nullable(),
  /** When it was sent. */
  createdAt: z.iso.datetime(),
});

/**
 * The caller's pending invitations, across every organization they belong to.
 *
 * @stability experimental
 */
export const myGroupInviteListSchema = z.object({
  /** Newest first. */
  items: z.array(myGroupInviteSchema),
});

/**
 * The membership an accepted invite produced.
 *
 * @stability experimental
 */
export const groupMembershipSchema = z.object({
  /** The group joined. */
  groupId: z.uuid(),
  /** Its organization. */
  orgId: z.uuid(),
  /** The role held. */
  role: groupRoleSchema,
});

/**
 * The `GET /api/groups` query, parsed.
 *
 * @stability experimental
 */
export type GroupListQuery = z.output<typeof groupListQuerySchema>;
/**
 * A list's page parameters, parsed.
 *
 * @stability experimental
 */
export type PageQuery = z.output<typeof pageQuerySchema>;
/**
 * The `POST /api/groups` body, parsed.
 *
 * @stability experimental
 */
export type CreateGroupInput = z.output<typeof createGroupSchema>;
/**
 * The `PATCH /api/groups/:id` body, parsed.
 *
 * @stability experimental
 */
export type UpdateGroupInput = z.output<typeof updateGroupSchema>;
/**
 * One group on the wire.
 *
 * @stability experimental
 */
export type GroupDto = z.output<typeof groupSchema>;
/**
 * A page of groups.
 *
 * @stability experimental
 */
export type GroupList = z.output<typeof groupListSchema>;
/**
 * The `POST /api/groups/:id/members` body, parsed.
 *
 * @stability experimental
 */
export type AddGroupMemberInput = z.output<typeof addGroupMemberSchema>;
/**
 * The `PATCH /api/groups/:id/members/:userId` body, parsed.
 *
 * @stability experimental
 */
export type UpdateGroupMemberInput = z.output<typeof updateGroupMemberSchema>;
/**
 * One member on the wire.
 *
 * @stability experimental
 */
export type GroupMemberDto = z.output<typeof groupMemberSchema>;
/**
 * A page of members.
 *
 * @stability experimental
 */
export type GroupMemberList = z.output<typeof groupMemberListSchema>;
/**
 * The `POST /api/groups/:id/invites` body, parsed.
 *
 * @stability experimental
 */
export type CreateGroupInviteInput = z.output<typeof createGroupInviteSchema>;
/**
 * The `GET /api/groups/:id/invites` query, parsed.
 *
 * @stability experimental
 */
export type GroupInviteListQuery = z.output<typeof groupInviteListQuerySchema>;
/**
 * One invite on the wire.
 *
 * @stability experimental
 */
export type GroupInviteDto = z.output<typeof groupInviteSchema>;
/**
 * A page of invites.
 *
 * @stability experimental
 */
export type GroupInviteList = z.output<typeof groupInviteListSchema>;
/**
 * One of the caller's pending invites.
 *
 * @stability experimental
 */
export type MyGroupInviteDto = z.output<typeof myGroupInviteSchema>;
/**
 * The caller's pending invites.
 *
 * @stability experimental
 */
export type MyGroupInviteList = z.output<typeof myGroupInviteListSchema>;
/**
 * The membership an accepted invite produced.
 *
 * @stability experimental
 */
export type GroupMembershipDto = z.output<typeof groupMembershipSchema>;
