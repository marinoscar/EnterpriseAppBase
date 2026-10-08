// =============================================================================
// Grants: the wire shapes of `/api/grants` and of link shares (issue #729)
// =============================================================================
//
// A grant shares ONE record of a registered resource type with a user, a
// group of the same organization, or (#730) anyone holding a link token, with
// one of the type's roles and an optional expiry. Every kind is described
// here, the link kind included, so the link routes (#730) and the share
// dialog (#731) build against one contract.
//
//   GET    /api/grants?resourceType&resourceId  grantListQuerySchema   -> grantListSchema
//   POST   /api/grants                          createGrantSchema      -> grantSchema
//   PATCH  /api/grants/:id                      updateGrantSchema      -> grantSchema
//   DELETE /api/grants/:id                                             -> 204
//   GET    /api/grants/shared-with-me           sharedWithMeQuerySchema -> sharedWithMeListSchema
//
//   (#730) link grants                          linkGrantCreateSchema  -> linkGrantViewSchema
//   (#730) public resolution                                           -> publicLinkResolutionSchema
// =============================================================================

import { z } from 'zod';

import { GRANT_GRANTEE_KINDS, SHARED_WITH_ME_VIA, SHARING_IDENTIFIER_PATTERN, SHARING_LIMITS } from './constants.js';
import { wireEnum } from './enum.js';
import { groupEmailSchema, pageQuerySchema } from './groups.js';

/**
 * A registered resource type id (`transcript`, `media_item`).
 *
 * @stability experimental
 */
export const resourceTypeSchema = z
  .string()
  .max(SHARING_LIMITS.grantIdentifierMax)
  .regex(SHARING_IDENTIFIER_PATTERN, 'A resource type is lower-case snake_case')
  .describe('A registered resource type id, lower-case snake_case (e.g. `transcript`).');

/**
 * One of a resource type's grantable roles (`viewer`, `editor`). `owner` is
 * implicit and never grantable; the API refuses a role the type does not list.
 *
 * @stability experimental
 */
export const grantRoleSchema = z
  .string()
  .max(SHARING_LIMITS.grantIdentifierMax)
  .regex(SHARING_IDENTIFIER_PATTERN, 'A role is lower-case snake_case')
  .describe("One of the resource type's grantable roles (e.g. `viewer`, `editor`).");

/**
 * A grantee kind on the wire.
 *
 * @stability experimental
 */
export const grantGranteeKindSchema = wireEnum(GRANT_GRANTEE_KINDS).describe('`user`, `group` or `link`.');

/** An ISO 8601 instant with an offset, for an expiry. */
const instantSchema = z.iso.datetime({ offset: true });

/**
 * A user grantee: exactly one of `email` and `userId`. The person must be an
 * active member of the resource's organization.
 *
 * @stability experimental
 */
export const userGranteeSchema = z
  .object({
    /** `user`. */
    kind: z.literal('user'),
    /** The person's e-mail (looked up among the organization's members; failed lookups are throttled). */
    email: groupEmailSchema.optional(),
    /** The person's user id. */
    userId: z.uuid().optional(),
  })
  .strict()
  .refine((body) => (body.email === undefined) !== (body.userId === undefined), 'Send exactly one of email and userId');

/**
 * A group grantee: a group of the resource's organization.
 *
 * @stability experimental
 */
export const groupGranteeSchema = z
  .object({
    /** `group`. */
    kind: z.literal('group'),
    /** The group. */
    groupId: z.uuid(),
  })
  .strict();

/**
 * Who `POST /api/grants` shares with: a user or a group. Link grants are
 * created through their own route (#730).
 *
 * @stability experimental
 */
export const grantGranteeInputSchema = z.discriminatedUnion('kind', [userGranteeSchema, groupGranteeSchema]);

/**
 * `POST /api/grants` body. Granting a grantee that already has an active
 * grant on the record replaces its role (one role per grantee).
 *
 * @stability experimental
 */
export const createGrantSchema = z
  .object({
    /** The record's resource type. */
    resourceType: resourceTypeSchema,
    /** The record. */
    resourceId: z.uuid(),
    /** Who to share with. */
    grantee: grantGranteeInputSchema,
    /** The role to grant. */
    role: grantRoleSchema,
    /** When the grant stops working; absent or `null` for never. Must be in the future. */
    expiresAt: instantSchema.nullish(),
  })
  .strict();

/**
 * `PATCH /api/grants/:id` body: at least one field.
 *
 * @stability experimental
 */
export const updateGrantSchema = z
  .object({
    /** A new role. */
    role: grantRoleSchema.optional(),
    /** A new expiry; `null` removes it. */
    expiresAt: instantSchema.nullable().optional(),
  })
  .strict()
  .refine((body) => Object.keys(body).length > 0, 'Send at least one field');

/**
 * `GET /api/grants` query: the record whose active grants to list, and the
 * page.
 *
 * @stability experimental
 */
export const grantListQuerySchema = pageQuerySchema.extend({
  /** The record's resource type. */
  resourceType: resourceTypeSchema,
  /** The record. */
  resourceId: z.uuid(),
});

/**
 * The grantee of a grant as the API returns it. The fields of the other kinds
 * are `null`.
 *
 * @stability experimental
 */
export const grantGranteeViewSchema = z.object({
  /** `user`, `group` or `link`. */
  kind: grantGranteeKindSchema,
  /** The user (kind `user`). */
  userId: z.uuid().nullable(),
  /** Their e-mail (kind `user`). */
  email: z.email().nullable(),
  /** Their display name (kind `user`), or `null`. */
  displayName: z.string().nullable(),
  /** The group (kind `group`). */
  groupId: z.uuid().nullable(),
  /** The group's name (kind `group`). */
  groupName: z.string().nullable(),
});

/**
 * One user or group grant.
 *
 * @stability experimental
 */
export const grantSchema = z.object({
  /** The grant's id. */
  id: z.uuid(),
  /** The organization of the record. */
  orgId: z.uuid(),
  /** The record's resource type. */
  resourceType: z.string(),
  /** The record. */
  resourceId: z.uuid(),
  /** Who it shares with. */
  grantee: grantGranteeViewSchema,
  /** The granted role. */
  role: z.string(),
  /** When it stops working, or `null`. */
  expiresAt: z.iso.datetime().nullable(),
  /** When it was revoked, or `null` (an active grant). */
  revokedAt: z.iso.datetime().nullable(),
  /** Who granted it, or `null` (deleted user). */
  grantedById: z.uuid().nullable(),
  /** When it was created. */
  createdAt: z.iso.datetime(),
  /** When it last changed. */
  updatedAt: z.iso.datetime(),
});

/**
 * A page of grants.
 *
 * @stability experimental
 */
export const grantListSchema = z.object({
  /** The grants of this page. */
  items: z.array(grantSchema),
  /** Grants in the whole list. */
  total: z.number().int(),
  /** This page's number. */
  page: z.number().int(),
  /** The page size. */
  pageSize: z.number().int(),
  /** Pages in the whole list. */
  totalPages: z.number().int(),
});

/**
 * `GET /api/grants/shared-with-me` query: optionally one resource type, and
 * the page.
 *
 * @stability experimental
 */
export const sharedWithMeQuerySchema = pageQuerySchema.extend({
  /** Only records of this type. */
  resourceType: resourceTypeSchema.optional(),
});

/**
 * One record shared with the caller.
 *
 * @stability experimental
 */
export const sharedWithMeItemSchema = z.object({
  /** The grant that shares it. */
  grantId: z.uuid(),
  /** The record's resource type. */
  resourceType: z.string(),
  /** The record. */
  resourceId: z.uuid(),
  /** The granted role. */
  role: z.string(),
  /** `user_grant` (shared with you) or `group_grant` (shared with a group you belong to). */
  via: wireEnum(SHARED_WITH_ME_VIA),
  /** The group, for a group grant. */
  groupId: z.uuid().nullable(),
  /** The record's label, when its resource type describes it. */
  title: z.string().nullable(),
  /** The app path of the record, when its resource type describes it. */
  path: z.string().nullable(),
  /** Who shared it, or `null`. */
  grantedById: z.uuid().nullable(),
  /** When the grant stops working, or `null`. */
  expiresAt: z.iso.datetime().nullable(),
  /** When it was shared. */
  createdAt: z.iso.datetime(),
});

/**
 * A page of records shared with the caller, newest first.
 *
 * @stability experimental
 */
export const sharedWithMeListSchema = z.object({
  /** The items of this page. */
  items: z.array(sharedWithMeItemSchema),
  /** Items in the whole list. */
  total: z.number().int(),
  /** This page's number. */
  page: z.number().int(),
  /** The page size. */
  pageSize: z.number().int(),
  /** Pages in the whole list. */
  totalPages: z.number().int(),
});

// ---- link grants (the routes are #730) ------------------------------------------------

/**
 * Creating a link grant (#730): the record, the role (one the type lists under
 * `grantable.link`), an optional expiry and label.
 *
 * @stability experimental
 */
export const linkGrantCreateSchema = z
  .object({
    /** The record's resource type. */
    resourceType: resourceTypeSchema,
    /** The record. */
    resourceId: z.uuid(),
    /** The role anyone holding the link gets. */
    role: grantRoleSchema,
    /** When the link stops working; absent or `null` for never. Must be in the future. */
    expiresAt: instantSchema.nullish(),
    /** A label for the owner's list ("Shared with the printer"). */
    label: z.string().trim().min(1).max(SHARING_LIMITS.linkLabelMax).nullish(),
  })
  .strict();

/**
 * One link grant as its record's sharer sees it (#730).
 *
 * @stability experimental
 */
export const linkGrantViewSchema = z.object({
  /** The grant's id. */
  id: z.uuid(),
  /** The organization of the record. */
  orgId: z.uuid(),
  /** The record's resource type. */
  resourceType: z.string(),
  /** The record. */
  resourceId: z.uuid(),
  /** The role anyone holding the link gets. */
  role: z.string(),
  /** The label, or `null`. */
  label: z.string().nullable(),
  /**
   * The share URL (`buildLinkUrl`, token in the fragment), or `null` when the
   * token cannot be shown.
   */
  url: z.string().nullable(),
  /** When the link stops working, or `null`. */
  expiresAt: z.iso.datetime().nullable(),
  /** When it was revoked, or `null`. */
  revokedAt: z.iso.datetime().nullable(),
  /** Who created it, or `null`. */
  grantedById: z.uuid().nullable(),
  /** When it was created. */
  createdAt: z.iso.datetime(),
});

/**
 * What resolving a link token publicly returns (#730). An unknown, expired or
 * revoked token is a generic 404, never a different answer.
 *
 * @stability experimental
 */
export const publicLinkResolutionSchema = z.object({
  /** The record's resource type. */
  resourceType: z.string(),
  /** The record. */
  resourceId: z.uuid(),
  /** The role the link grants. */
  role: z.string(),
  /** When the link stops working, or `null`. */
  expiresAt: z.iso.datetime().nullable(),
  /** The record's label, when its resource type describes it. */
  title: z.string().nullable(),
});

// ---- types ------------------------------------------------------------------------

/**
 * The parsed `POST /api/grants` grantee.
 *
 * @stability experimental
 */
export type GrantGranteeInput = z.output<typeof grantGranteeInputSchema>;

/**
 * The parsed `POST /api/grants` body.
 *
 * @stability experimental
 */
export type CreateGrantInput = z.output<typeof createGrantSchema>;

/**
 * The parsed `PATCH /api/grants/:id` body.
 *
 * @stability experimental
 */
export type UpdateGrantInput = z.output<typeof updateGrantSchema>;

/**
 * The parsed `GET /api/grants` query.
 *
 * @stability experimental
 */
export type GrantListQuery = z.output<typeof grantListQuerySchema>;

/**
 * A grantee as the API returns it.
 *
 * @stability experimental
 */
export type GrantGranteeView = z.output<typeof grantGranteeViewSchema>;

/**
 * One user or group grant.
 *
 * @stability experimental
 */
export type GrantDto = z.output<typeof grantSchema>;

/**
 * A page of grants.
 *
 * @stability experimental
 */
export type GrantList = z.output<typeof grantListSchema>;

/**
 * The parsed `GET /api/grants/shared-with-me` query.
 *
 * @stability experimental
 */
export type SharedWithMeQuery = z.output<typeof sharedWithMeQuerySchema>;

/**
 * One record shared with the caller.
 *
 * @stability experimental
 */
export type SharedWithMeItem = z.output<typeof sharedWithMeItemSchema>;

/**
 * A page of records shared with the caller.
 *
 * @stability experimental
 */
export type SharedWithMeList = z.output<typeof sharedWithMeListSchema>;

/**
 * The parsed link grant creation body (#730).
 *
 * @stability experimental
 */
export type LinkGrantCreate = z.output<typeof linkGrantCreateSchema>;

/**
 * One link grant as its sharer sees it (#730).
 *
 * @stability experimental
 */
export type LinkGrantView = z.output<typeof linkGrantViewSchema>;

/**
 * The public resolution of a link token (#730).
 *
 * @stability experimental
 */
export type PublicLinkResolution = z.output<typeof publicLinkResolutionSchema>;
