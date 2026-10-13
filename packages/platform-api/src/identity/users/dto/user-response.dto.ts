import { createZodDto } from 'nestjs-zod';
import { userExtensionsSchema } from '@marinoscar/platform-contract/identity';
import { z } from 'zod';

export const userResponseSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  displayName: z.string().nullable(),
  providerDisplayName: z.string().nullable(),
  // Resolved from the user's `profile.imageSource` (#367): null, the provider
  // URL, or a root-relative avatar path — hence not `.url()`.
  profileImageUrl: z.string().nullable(),
  providerProfileImageUrl: z.string().url().nullable(),
  isActive: z.boolean(),
  roles: z
    .array(z.string())
    .describe(
      'System roles (`admin`) plus the role on the current organization membership (`org_admin`, `contributor` or `viewer`)',
    ),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export class UserResponseDto extends createZodDto(userResponseSchema) {}

/**
 * One row of `GET /api/users`: a {@link userResponseSchema} user plus, when the
 * app registered user-list extensions (`registerUserListExtension`) and one
 * contributed for this user, their `extensions`.
 */
export const userListItemSchema = userResponseSchema.extend({
  extensions: userExtensionsSchema
    .optional()
    .describe(
      "What the app's user-list extensions added for this user (`registerUserListExtension`), keyed by extension id: small JSON objects, never secrets. Absent when none contributed.",
    ),
});

export class UserListItemDto extends createZodDto(userListItemSchema) {}

// List response with pagination
export const userListResponseSchema = z.object({
  items: z.array(userListItemSchema),
  total: z.number(),
  page: z.number(),
  pageSize: z.number(),
  totalPages: z.number(),
});

export class UserListResponseDto extends createZodDto(userListResponseSchema) {}

/**
 * `GET /api/users/{id}` returns everything in {@link userResponseSchema} plus
 * the linked OAuth identities. It is the one user payload that differs, so it
 * gets its own schema rather than being documented as a `UserResponseDto` that
 * silently omits a field the endpoint actually sends.
 */
export const userDetailResponseSchema = userResponseSchema.extend({
  identities: z.array(
    z.object({
      provider: z.string(),
      providerEmail: z.string().nullable(),
      createdAt: z.iso.datetime(),
    }),
  ),
});

export class UserDetailResponseDto extends createZodDto(userDetailResponseSchema) {}
