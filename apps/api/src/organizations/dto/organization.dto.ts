import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

// =============================================================================
// The deployment's organizations: `/api/admin/organizations` (#726, PP-6.7)
// =============================================================================

/**
 * An organization slug: lower-case letters, digits and hyphens, 2..63
 * characters, starting and ending with a letter or digit (the rule
 * `organizations.slug` documents). Immutable once created.
 */
export const ORG_SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61})[a-z0-9]$/;

const orgName = z
  .string()
  .trim()
  .min(1, 'Name is required')
  .max(100, 'Name must be 100 characters or less');

export const organizationListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  /** Case-insensitive match on the name or the slug. */
  search: z.string().trim().max(100).optional(),
});

export class OrganizationListQueryDto extends createZodDto(organizationListQuerySchema) {}

export const createOrganizationSchema = z
  .object({
    name: orgName,
    slug: z
      .string()
      .trim()
      .toLowerCase()
      .regex(ORG_SLUG_PATTERN, 'Slug must be 2-63 lower-case letters, digits or hyphens, starting and ending with a letter or digit'),
    /** Receives a pending `org_admin` invitation (lower-cased). */
    firstAdminEmail: z
      .string()
      .trim()
      .email('Invalid email format')
      .transform((email) => email.toLowerCase()),
  })
  .strict();

export class CreateOrganizationDto extends createZodDto(createOrganizationSchema) {}

/** Rename only: the slug is immutable here, and `isDefault` cannot be changed. */
export const renameOrganizationSchema = z.object({ name: orgName }).strict();

export class RenameOrganizationDto extends createZodDto(renameOrganizationSchema) {}

export const organizationResponseSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  slug: z.string(),
  /** The deployment's default organization (exactly one). */
  isDefault: z.boolean(),
  /** Active (not suspended) members. */
  memberCount: z.number().int(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export class OrganizationResponseDto extends createZodDto(organizationResponseSchema) {}
