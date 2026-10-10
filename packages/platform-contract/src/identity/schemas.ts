// =============================================================================
// The identity slice's wire shapes (issue #727, PP-6.6)
// =============================================================================
//
// What the sign-in, token, personal-access-token, device-authorization and
// organization routes accept and return, as zod schemas plus their inferred
// types. Shared by `@marinoscar/platform-api/identity` (which wraps the REQUEST
// schemas as its nestjs-zod DTOs, so the OpenAPI document is generated from
// them) and the web app (which takes the types).
//
// REQUEST SCHEMAS were moved here verbatim from the API's DTO files; their
// field order, messages, `.describe()` texts and enum orders are part of the
// published OpenAPI document. Change them only as a deliberate API change.
//
// RESPONSE SCHEMAS of the routes whose DTOs are `@ApiProperty` classes
// (`/api/auth/me`, the token responses, personal access tokens, the device
// flow) describe the same payload for clients. The classes stay the source of
// the OpenAPI document; `@marinoscar/platform-api` pins that the two declare
// the same fields (test/identity/contract-parity.spec.ts). The organization
// response schemas ARE the OpenAPI source (their DTOs wrap them).
// =============================================================================

import { z } from 'zod';

import {
  ASSIGNABLE_ORG_ROLES,
  AUTH_ERROR_CODES,
  DEVICE_SESSION_STATUSES,
  DEVICE_TOKEN_ERROR_CODES,
  DEVICE_TOKEN_TYPES,
  DEVICE_USER_CODE_PATTERN,
  ORG_INVITE_STATUSES,
  ORG_MEMBER_STATUSES,
  ORG_SLUG_PATTERN,
  PAT_DURATION_UNITS,
  PAT_LIMITS,
  TENANCY_MODES,
} from './constants.js';

// =============================================================================
// Enum schemas, typed through named entry types (so the API reference shows one
// named type instead of expanding every value)
// =============================================================================

/**
 * The entries of {@link authErrorCodeSchema}: each code keyed by itself.
 *
 * @stability stable
 */
export type AuthErrorCodeEnum = { [K in (typeof AUTH_ERROR_CODES)[number]]: K };

/**
 * The entries of a tenancy-mode enum: each mode keyed by itself.
 *
 * @stability stable
 */
export type TenancyModeEnum = { [K in (typeof TENANCY_MODES)[number]]: K };

/**
 * The entries of an assignable-org-role enum: each role keyed by itself.
 *
 * @stability stable
 */
export type AssignableOrgRoleEnum = { [K in (typeof ASSIGNABLE_ORG_ROLES)[number]]: K };

/**
 * The entries of a personal-access-token duration-unit enum.
 *
 * @stability stable
 */
export type PatDurationUnitEnum = { [K in (typeof PAT_DURATION_UNITS)[number]]: K };

/**
 * The entries of a device credential-type enum.
 *
 * @stability stable
 */
export type DeviceTokenTypeEnum = { [K in (typeof DEVICE_TOKEN_TYPES)[number]]: K };

/**
 * The entries of a device-session status enum.
 *
 * @stability stable
 */
export type DeviceSessionStatusEnum = { [K in (typeof DEVICE_SESSION_STATUSES)[number]]: K };

/**
 * The entries of a device token error-code enum.
 *
 * @stability stable
 */
export type DeviceTokenErrorCodeEnum = { [K in (typeof DEVICE_TOKEN_ERROR_CODES)[number]]: K };

/**
 * The entries of a membership-status enum.
 *
 * @stability stable
 */
export type OrgMemberStatusEnum = { [K in (typeof ORG_MEMBER_STATUSES)[number]]: K };

/**
 * The entries of an invitation-status enum.
 *
 * @stability stable
 */
export type OrgInviteStatusEnum = { [K in (typeof ORG_INVITE_STATUSES)[number]]: K };

/**
 * The entries of a list filter over membership statuses: `all` or one status.
 *
 * @stability stable
 */
export type OrgMemberStatusFilterEnum = { [K in 'all' | (typeof ORG_MEMBER_STATUSES)[number]]: K };

/**
 * The entries of a list filter over invitation statuses: `all` or one status.
 *
 * @stability stable
 */
export type OrgInviteStatusFilterEnum = { [K in 'all' | (typeof ORG_INVITE_STATUSES)[number]]: K };

// Factories, not shared instances: every field gets its own enum, exactly as
// when each was written inline (the generated OpenAPI document is unchanged).
const tenancyModeSchema = (): z.ZodEnum<TenancyModeEnum> => z.enum(TENANCY_MODES);
const assignableOrgRoleSchema = (): z.ZodEnum<AssignableOrgRoleEnum> => z.enum(ASSIGNABLE_ORG_ROLES);
const patDurationUnitSchema = (): z.ZodEnum<PatDurationUnitEnum> => z.enum(PAT_DURATION_UNITS);
const deviceSessionStatusSchema = (): z.ZodEnum<DeviceSessionStatusEnum> => z.enum(DEVICE_SESSION_STATUSES);
const deviceTokenErrorCodeSchema = (): z.ZodEnum<DeviceTokenErrorCodeEnum> => z.enum(DEVICE_TOKEN_ERROR_CODES);
const orgMemberStatusSchema = (): z.ZodEnum<OrgMemberStatusEnum> => z.enum(ORG_MEMBER_STATUSES);
const orgInviteStatusSchema = (): z.ZodEnum<OrgInviteStatusEnum> => z.enum(ORG_INVITE_STATUSES);

// =============================================================================
// Sign-in
// =============================================================================

/**
 * A sign-in failure code on the wire: the `error` query parameter of
 * `/auth/callback`. A client that receives anything else shows the generic
 * failure ({@link DEFAULT_AUTH_ERROR_CODE}) without echoing the value.
 *
 * @stability stable
 */
export const authErrorCodeSchema: z.ZodEnum<AuthErrorCodeEnum> = z.enum(AUTH_ERROR_CODES);

/**
 * One OAuth provider of `GET /api/auth/providers`.
 *
 * @stability stable
 */
export const authProviderSchema = z.object({
  /** The provider id, e.g. `google`. */
  name: z.string(),
  /** Whether the provider is configured and offered on the login page. */
  enabled: z.boolean(),
  /** `custom` for a provider that owns its sign-in flow; absent for a redirect provider (`/api/auth/<name>`). */
  mode: z.literal('custom').optional(),
});

/**
 * `GET /api/auth/providers`: every registered provider and whether it is enabled.
 *
 * @stability stable
 */
export const authProvidersResponseSchema = z.object({
  /** The registered providers, in registration order. */
  providers: z.array(authProviderSchema),
});

/**
 * A role of the current user (`/api/auth/me` `roles[]`).
 *
 * @stability stable
 */
export const authRoleSchema = z.object({
  /** The role name, e.g. `admin` or `viewer`. */
  name: z.string(),
});

/**
 * The organization the session acts in (`/api/auth/me` `activeOrg`).
 *
 * @stability stable
 */
export const activeOrgSchema = z.object({
  /** The organization's id (a UUID). */
  id: z.string(),
  /** The organization's name. */
  name: z.string(),
  /** The organization's slug. */
  slug: z.string(),
});

/**
 * One organization the user is an active member of (`/api/auth/me`
 * `memberships[]`).
 *
 * @stability stable
 */
export const authMembershipSchema = z.object({
  /** The organization's id (a UUID). */
  orgId: z.string(),
  /** The organization's name. */
  name: z.string(),
  /** The organization's slug. */
  slug: z.string(),
  /** The org role on this membership (`org_admin`, `contributor` or `viewer`). */
  role: z.string(),
});

/**
 * `GET /api/auth/me`: the signed-in user, their roles and effective
 * permissions in the active organization, the deployment's tenancy mode, the
 * active organization and every organization they may switch to.
 *
 * @extensionPoint schema
 * @stability stable
 */
export const currentUserSchema = z.object({
  /** The user's id. */
  id: z.string(),
  /** The user's email address. */
  email: z.string(),
  /** Display name (computed from the override or the provider), or `null`. */
  displayName: z.string().nullable(),
  /** The picture representing the user, resolved from `profile.imageSource`, or `null`. */
  profileImageUrl: z.string().nullable(),
  /** The OAuth provider picture, regardless of the selected source, or `null`. */
  providerProfileImageUrl: z.string().nullable(),
  /** Whether an uploaded picture is stored, regardless of the selected source. */
  hasUploadedProfileImage: z.boolean(),
  /** Whether the account is active. */
  isActive: z.boolean(),
  /** The system roles plus the role on the active organization membership. */
  roles: z.array(authRoleSchema),
  /** The effective permissions in the active organization. */
  permissions: z.array(z.string()),
  /** The deployment's tenancy mode (`TENANCY_MODE`). */
  tenancyMode: tenancyModeSchema(),
  /** The organization this session acts in, or `null` when the user has no active membership there. */
  activeOrg: activeOrgSchema.nullable(),
  /** Every organization the user is an active member of, with the org role on each. */
  memberships: z.array(authMembershipSchema),
});

/**
 * `POST /api/auth/refresh` and `POST /api/auth/switch-org`: a new access token
 * (the refresh token travels in the HttpOnly cookie, never in the body).
 *
 * @stability stable
 */
export const tokenResponseSchema = z.object({
  /** The JWT access token, presented as `Authorization: Bearer <token>`. */
  accessToken: z.string(),
  /** Its lifetime in seconds. */
  expiresIn: z.number(),
});

/**
 * `POST /api/auth/switch-org` body: the organization to act in next. The ONLY
 * place an org id enters the auth path from request input, and it is checked
 * against the caller's active memberships before anything is issued.
 *
 * @stability stable
 */
export const switchOrgSchema = z.object({
  /** The organization to switch to (an active membership of the caller). */
  orgId: z.uuid('orgId must be a UUID').describe('The organization to switch to (an active membership of the caller).'),
});

// =============================================================================
// Personal access tokens
// =============================================================================

/**
 * `POST /api/pat` body: a name, a lifetime and, optionally, the organization
 * the token is bound to.
 *
 * @stability stable
 */
export const createPatSchema = z.object({
  /** A human-readable name, 1 to 100 characters after trimming. */
  name: z
    .string()
    .trim()
    .min(1, 'Name is required')
    .max(PAT_LIMITS.nameMaxLength, 'Name must be 100 characters or less'),
  /** The lifetime, in `durationUnit`, 1 to 999. */
  durationValue: z
    .number()
    .int('Duration value must be an integer')
    .min(PAT_LIMITS.durationMin, 'Duration value must be at least 1')
    .max(PAT_LIMITS.durationMax, 'Duration value must be at most 999'),
  /** The unit of `durationValue`. */
  durationUnit: (z.enum(PAT_DURATION_UNITS, {
    error: 'Duration unit must be one of: minutes, days, months',
  }) as z.ZodEnum<PatDurationUnitEnum>),
  /** The organization the token is bound to; defaults to the caller's active organization. */
  orgId: z
    .uuid('orgId must be a UUID')
    .optional()
    .describe(
      "The organization the token is bound to. Must be one you are an active member of; defaults to the caller's active organization.",
    ),
});

/**
 * `POST /api/pat` response: the new token, whose raw value is shown only once.
 *
 * @stability stable
 */
export const patCreatedResponseSchema = z.object({
  /** The raw token value (`pat_...`); shown only once. */
  token: z.string(),
  /** The token's id. */
  id: z.string(),
  /** Its name. */
  name: z.string(),
  /** Its prefix, for identification (`pat_xxxx`). */
  tokenPrefix: z.string(),
  /** ISO 8601 expiry. */
  expiresAt: z.string(),
  /** ISO 8601 creation time. */
  createdAt: z.string(),
  /** The organization the token is bound to. */
  orgId: z.string(),
});

/**
 * One row of `GET /api/pat`. Never carries the token value.
 *
 * @stability stable
 */
export const patListItemSchema = z.object({
  /** The token's id. */
  id: z.string(),
  /** Its name. */
  name: z.string(),
  /** Its prefix, for identification (`pat_xxxx`). */
  tokenPrefix: z.string(),
  /** The duration value used when creating it. */
  durationValue: z.number(),
  /** The duration unit used when creating it. */
  durationUnit: patDurationUnitSchema(),
  /** ISO 8601 expiry. */
  expiresAt: z.string(),
  /** ISO 8601 time of last use, `null` if never used. */
  lastUsedAt: z.string().nullable(),
  /** ISO 8601 creation time. */
  createdAt: z.string(),
  /** ISO 8601 revocation time, `null` if not revoked. */
  revokedAt: z.string().nullable(),
  /** The organization it is bound to; `null` only for a token created before tokens were bound. */
  orgId: z.string().nullable(),
});

// =============================================================================
// Device authorization (RFC 8628)
// =============================================================================

/**
 * The credential a device flow mints: `session` (default) or `pat`.
 *
 * `'session'` is the historical behaviour and MUST stay the default: the web
 * activation page sends no `tokenType` at all.
 *
 * @stability stable
 */
export const deviceTokenTypeSchema: z.ZodEnum<DeviceTokenTypeEnum> = z.enum(DEVICE_TOKEN_TYPES);

/**
 * Client information of a device authorization request.
 *
 * WARNING: every field arrives from an UNAUTHENTICATED caller, is persisted
 * verbatim and is later rendered where a human trusts it (the activation
 * page, the Access Tokens list). Treat it as hostile at every point of use.
 *
 * `tokenType` defaults to `session`; an unknown value is rejected with a 400,
 * never quietly replaced.
 *
 * @stability stable
 */
export const deviceClientInfoSchema = z.object({
  /** A name for the device, shown to the approving user. */
  deviceName: z.string().optional(),
  /** The device's user agent. */
  userAgent: z.string().optional(),
  /** The credential to mint on the poll after approval. */
  tokenType: deviceTokenTypeSchema.default('session'),
});

/**
 * `POST /api/auth/device/code` body.
 *
 * @stability stable
 */
export const deviceCodeRequestSchema = z.object({
  /** Optional client information. */
  clientInfo: deviceClientInfoSchema.optional(),
});

/**
 * `POST /api/auth/device/code` response.
 *
 * @stability stable
 */
export const deviceCodeResponseSchema = z.object({
  /** The opaque device verification code the device polls with. */
  deviceCode: z.string(),
  /** The human-readable user code (`XXXX-XXXX`). */
  userCode: z.string(),
  /** The `/activate` page of this deployment. */
  verificationUri: z.string(),
  /** The same URI with the user code pre-filled as `code`. */
  verificationUriComplete: z.string(),
  /** Lifetime of the codes, in seconds. */
  expiresIn: z.number(),
  /** Minimum polling interval, in seconds. */
  interval: z.number(),
});

/**
 * `POST /api/auth/device/token` body.
 *
 * @stability stable
 */
export const deviceTokenRequestSchema = z.object({
  /** The `deviceCode` of `POST /api/auth/device/code`. */
  deviceCode: z.string().min(1, 'Device code is required'),
});

/**
 * `POST /api/auth/device/token` success: a session credential (access plus
 * refresh token) or, when `credentialType` is `pat`, a personal access token.
 *
 * @stability stable
 */
export const deviceTokenResponseSchema = z.object({
  /** The credential, presented as `Authorization: Bearer <token>`. */
  accessToken: z.string(),
  /** The refresh token; session credential only. */
  refreshToken: z.string().optional(),
  /** Always `Bearer`. */
  tokenType: z.string(),
  /** Lifetime in seconds. */
  expiresIn: z.number(),
  /** `pat` when a personal access token was issued; absent for a session credential. */
  credentialType: z.literal('pat').optional(),
  /** Absolute ISO 8601 expiry; PAT only. */
  expiresAt: z.string().optional(),
  /** The issued PAT's id; PAT only. */
  tokenId: z.string().optional(),
  /** The issued PAT's name; PAT only. */
  tokenName: z.string().optional(),
});

/**
 * `POST /api/auth/device/token` failure (RFC 8628 section 3.5). Branch on
 * `error`, never on the description or the status.
 *
 * @stability stable
 */
export const deviceTokenErrorSchema = z.object({
  /** The RFC error code. */
  error: deviceTokenErrorCodeSchema(),
  /** Human-readable prose; may change. */
  error_description: z.string(),
});

/**
 * `POST /api/auth/device/authorize` body: approve or deny a user code.
 *
 * @stability stable
 */
export const deviceAuthorizeRequestSchema = z.object({
  /** The user code shown on the device (`XXXX-XXXX`). */
  userCode: z
    .string()
    .min(1, 'User code is required')
    .regex(DEVICE_USER_CODE_PATTERN, 'Invalid user code format'),
  /** `true` approves, `false` denies. */
  approve: z.boolean(),
});

/**
 * `POST /api/auth/device/authorize` response.
 *
 * @stability stable
 */
export const deviceAuthorizeResponseSchema = z.object({
  /** Whether the operation succeeded. */
  success: z.boolean(),
  /** A result message. */
  message: z.string(),
});

/**
 * `GET /api/auth/device/activate` response: what the activation page shows.
 *
 * @stability stable
 */
export const deviceActivateResponseSchema = z.object({
  /** The `/activate` page of this deployment. */
  verificationUri: z.string(),
  /** The user code, when one was given in the query. */
  userCode: z.string().optional(),
  /** The device's client information, when the code is valid. */
  clientInfo: z.record(z.string(), z.unknown()).optional(),
  /** The code's expiry, when the code is valid. */
  expiresAt: z.string().optional(),
});

/**
 * One device session of `GET /api/auth/device/sessions`.
 *
 * @stability stable
 */
export const deviceSessionSchema = z.object({
  /** The session's id. */
  id: z.string(),
  /** Its user code. */
  userCode: z.string(),
  /** Its status. */
  status: deviceSessionStatusSchema(),
  /** The device's client information. */
  clientInfo: z.record(z.string(), z.unknown()).optional(),
  /** When the device started the flow. */
  createdAt: z.string(),
  /** When the device CODE expires. */
  expiresAt: z.string(),
  /** When the device collected its credential, `null` until then. */
  collectedAt: z.string().nullable(),
  /** When the collected credential expires, `null` until collection. */
  credentialExpiresAt: z.string().nullable(),
  /** The kind of credential collected, `null` until collection. */
  credentialType: deviceTokenTypeSchema.nullable(),
});

/**
 * `GET /api/auth/device/sessions`: one page of device sessions, newest first.
 *
 * @stability stable
 */
export const deviceSessionsResponseSchema = z.object({
  /** The sessions on this page. */
  sessions: z.array(deviceSessionSchema),
  /** The number of listed sessions across all pages. */
  total: z.number(),
  /** The current page. */
  page: z.number(),
  /** The page size. */
  limit: z.number(),
});

// =============================================================================
// Organizations, members and invitations (issue #726)
// =============================================================================

const orgName = z
  .string()
  .trim()
  .min(1, 'Name is required')
  .max(100, 'Name must be 100 characters or less');

/**
 * `GET /api/admin/organizations` query: paging and an optional name or slug search.
 *
 * @stability stable
 */
export const organizationListQuerySchema = z.object({
  /** One-based page number. */
  page: z.coerce.number().int().min(1).default(1),
  /** Page size, 1 to 100. */
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  /** Matches the name or slug, case-insensitively. */
  search: z.string().trim().max(100).optional(),
});

/**
 * `POST /api/admin/organizations` body: a name, a slug and the email of the
 * first organization administrator (invited).
 *
 * @stability stable
 */
export const createOrganizationSchema = z
  .object({
    /** The organization's name. */
    name: orgName,
    /** The organization's slug, see {@link ORG_SLUG_PATTERN}. */
    slug: z
      .string()
      .trim()
      .toLowerCase()
      .regex(ORG_SLUG_PATTERN, 'Slug must be 2-63 lower-case letters, digits or hyphens, starting and ending with a letter or digit'),
    /** Who is invited as the first organization administrator. */
    firstAdminEmail: z
      .string()
      .trim()
      .email('Invalid email format')
      .transform((email) => email.toLowerCase()),
  })
  .strict();

/**
 * `PATCH /api/admin/organizations/:id` body: a new name. The slug never changes.
 *
 * @stability stable
 */
export const renameOrganizationSchema = z
  .object({
    /** The new name. */
    name: orgName,
  })
  .strict();

/**
 * One organization, as the admin organization routes return it.
 *
 * @stability stable
 */
export const organizationResponseSchema = z.object({
  /** The organization's id. */
  id: z.uuid(),
  /** Its name. */
  name: z.string(),
  /** Its slug. */
  slug: z.string(),
  /** Whether it is the deployment's default organization. */
  isDefault: z.boolean(),
  /** Its number of memberships. */
  memberCount: z.number().int(),
  /** ISO 8601 creation time. */
  createdAt: z.iso.datetime(),
  /** ISO 8601 last update time. */
  updatedAt: z.iso.datetime(),
});

/**
 * `GET /api/org/members` query: paging, a search and a status filter.
 *
 * @stability stable
 */
export const orgMemberListQuerySchema = z.object({
  /** One-based page number. */
  page: z.coerce.number().int().min(1).default(1),
  /** Page size, 1 to 100. */
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  /** Matches the email or display name. */
  search: z.string().trim().max(200).optional(),
  /** Which memberships to list. */
  status: (z.enum(['all', ...ORG_MEMBER_STATUSES]) as z.ZodEnum<OrgMemberStatusFilterEnum>).default('all'),
});

/**
 * `PATCH /api/org/members/:userId` body: a new org role, a new status, or both.
 *
 * @stability stable
 */
export const updateOrgMemberSchema = z
  .object({
    /** The new org role. */
    roleName: assignableOrgRoleSchema().optional(),
    /** The new status. */
    status: orgMemberStatusSchema().optional(),
  })
  .strict()
  .refine((value) => value.roleName !== undefined || value.status !== undefined, {
    message: 'Provide roleName, status or both',
  });

/**
 * One member of the active organization.
 *
 * @stability stable
 */
export const orgMemberResponseSchema = z.object({
  /** The member's user id. */
  userId: z.uuid(),
  /** Their email. */
  email: z.email(),
  /** Their display name, or `null`. */
  displayName: z.string().nullable(),
  /** Their org role. */
  role: z.string(),
  /** The membership's status. */
  status: orgMemberStatusSchema(),
  /** ISO 8601 time of their last activity, or `null`. */
  lastActiveAt: z.iso.datetime().nullable(),
  /** ISO 8601 time the membership was created. */
  joinedAt: z.iso.datetime(),
});

/**
 * `GET /api/org/invites` query: paging and a status filter.
 *
 * @stability stable
 */
export const orgInviteListQuerySchema = z.object({
  /** One-based page number. */
  page: z.coerce.number().int().min(1).default(1),
  /** Page size, 1 to 100. */
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  /** Which invitations to list. */
  status: (z.enum(['all', ...ORG_INVITE_STATUSES]) as z.ZodEnum<OrgInviteStatusFilterEnum>).default('all'),
});

/**
 * `POST /api/org/invites` body: who to invite, with which org role. Takes no
 * org id: the invitation is always for the caller's active organization.
 *
 * @stability stable
 */
export const createOrgInviteSchema = z
  .object({
    /** The invitee's email, lower-cased. */
    email: z
      .string()
      .trim()
      .email('Invalid email format')
      .transform((email) => email.toLowerCase()),
    /** The org role the invitee gets on accepting. */
    roleName: assignableOrgRoleSchema(),
    /** An optional note, up to 500 characters. */
    notes: z.string().max(500, 'Notes must be 500 characters or less').optional(),
  })
  .strict();

const actorSchema = z.object({
  /** The user's id. */
  id: z.uuid(),
  /** The user's email. */
  email: z.email(),
});

/**
 * One invitation of the active organization.
 *
 * @stability stable
 */
export const orgInviteResponseSchema = z.object({
  /** The invitation's id. */
  id: z.uuid(),
  /** The invitee's email. */
  email: z.email(),
  /** The org role it grants. */
  role: z.string(),
  /** Its status. */
  status: orgInviteStatusSchema(),
  /** The note, or `null`. */
  notes: z.string().nullable(),
  /** ISO 8601 expiry, or `null`. */
  expiresAt: z.iso.datetime().nullable(),
  /** ISO 8601 creation time. */
  createdAt: z.iso.datetime(),
  /** ISO 8601 acceptance time, or `null`. */
  acceptedAt: z.iso.datetime().nullable(),
  /** Who sent it, or `null`. */
  invitedBy: actorSchema.nullable(),
  /** Who accepted it, or `null`. */
  acceptedBy: actorSchema.nullable(),
});

// =============================================================================
// Inferred types
// =============================================================================

/**
 * `GET /api/auth/providers` response.
 *
 * @stability stable
 */
export type AuthProvidersResponse = z.infer<typeof authProvidersResponseSchema>;
/**
 * `GET /api/auth/me` response.
 *
 * @stability stable
 */
export type CurrentUser = z.infer<typeof currentUserSchema>;
/**
 * `/api/auth/me` `activeOrg`.
 *
 * @stability stable
 */
export type ActiveOrg = z.infer<typeof activeOrgSchema>;
/**
 * One of `/api/auth/me` `memberships`.
 *
 * @stability stable
 */
export type AuthMembership = z.infer<typeof authMembershipSchema>;
/**
 * An access-token response.
 *
 * @stability stable
 */
export type TokenResponse = z.infer<typeof tokenResponseSchema>;
/**
 * `POST /api/auth/switch-org` body.
 *
 * @stability stable
 */
export type SwitchOrgRequest = z.infer<typeof switchOrgSchema>;
/**
 * `POST /api/pat` body, as a client sends it.
 *
 * @stability stable
 */
export type CreatePatRequest = z.input<typeof createPatSchema>;
/**
 * `POST /api/pat` response.
 *
 * @stability stable
 */
export type PatCreatedResponse = z.infer<typeof patCreatedResponseSchema>;
/**
 * One row of `GET /api/pat`.
 *
 * @stability stable
 */
export type PatListItem = z.infer<typeof patListItemSchema>;
/**
 * Device client information, as parsed (`tokenType` filled in).
 *
 * @stability stable
 */
export type DeviceClientInfo = z.infer<typeof deviceClientInfoSchema>;
/**
 * `POST /api/auth/device/code` body, as a client sends it.
 *
 * @stability stable
 */
export type DeviceCodeRequest = z.input<typeof deviceCodeRequestSchema>;
/**
 * `POST /api/auth/device/code` response.
 *
 * @stability stable
 */
export type DeviceCodeResponse = z.infer<typeof deviceCodeResponseSchema>;
/**
 * `POST /api/auth/device/token` body.
 *
 * @stability stable
 */
export type DeviceTokenRequest = z.infer<typeof deviceTokenRequestSchema>;
/**
 * `POST /api/auth/device/token` success.
 *
 * @stability stable
 */
export type DeviceTokenResponse = z.infer<typeof deviceTokenResponseSchema>;
/**
 * `POST /api/auth/device/token` failure.
 *
 * @stability stable
 */
export type DeviceTokenError = z.infer<typeof deviceTokenErrorSchema>;
/**
 * `POST /api/auth/device/authorize` body.
 *
 * @stability stable
 */
export type DeviceAuthorizeRequest = z.infer<typeof deviceAuthorizeRequestSchema>;
/**
 * `POST /api/auth/device/authorize` response.
 *
 * @stability stable
 */
export type DeviceAuthorizeResponse = z.infer<typeof deviceAuthorizeResponseSchema>;
/**
 * `GET /api/auth/device/activate` response.
 *
 * @stability stable
 */
export type DeviceActivateResponse = z.infer<typeof deviceActivateResponseSchema>;
/**
 * One device session.
 *
 * @stability stable
 */
export type DeviceSession = z.infer<typeof deviceSessionSchema>;
/**
 * `GET /api/auth/device/sessions` response.
 *
 * @stability stable
 */
export type DeviceSessionsResponse = z.infer<typeof deviceSessionsResponseSchema>;
/**
 * `GET /api/admin/organizations` query, as parsed.
 *
 * @stability stable
 */
export type OrganizationListQuery = z.infer<typeof organizationListQuerySchema>;
/**
 * `POST /api/admin/organizations` body, as parsed.
 *
 * @stability stable
 */
export type CreateOrganizationRequest = z.infer<typeof createOrganizationSchema>;
/**
 * `PATCH /api/admin/organizations/:id` body.
 *
 * @stability stable
 */
export type RenameOrganizationRequest = z.infer<typeof renameOrganizationSchema>;
/**
 * One organization.
 *
 * @stability stable
 */
export type OrganizationResponse = z.infer<typeof organizationResponseSchema>;
/**
 * `GET /api/org/members` query, as parsed.
 *
 * @stability stable
 */
export type OrgMemberListQuery = z.infer<typeof orgMemberListQuerySchema>;
/**
 * `PATCH /api/org/members/:userId` body.
 *
 * @stability stable
 */
export type UpdateOrgMemberRequest = z.infer<typeof updateOrgMemberSchema>;
/**
 * One member of the active organization.
 *
 * @stability stable
 */
export type OrgMemberResponse = z.infer<typeof orgMemberResponseSchema>;
/**
 * `GET /api/org/invites` query, as parsed.
 *
 * @stability stable
 */
export type OrgInviteListQuery = z.infer<typeof orgInviteListQuerySchema>;
/**
 * `POST /api/org/invites` body, as parsed.
 *
 * @stability stable
 */
export type CreateOrgInviteRequest = z.infer<typeof createOrgInviteSchema>;
/**
 * One invitation of the active organization.
 *
 * @stability stable
 */
export type OrgInviteResponse = z.infer<typeof orgInviteResponseSchema>;
