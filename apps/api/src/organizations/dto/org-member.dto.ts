import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

// =============================================================================
// The active organization's members: `/api/org/members` (#726, PP-6.7)
// =============================================================================

/** The platform's org roles an org administrator may assign, highest first. */
export const ASSIGNABLE_ORG_ROLES = ['org_admin', 'contributor', 'viewer'] as const;
export type AssignableOrgRole = (typeof ASSIGNABLE_ORG_ROLES)[number];

export const orgMemberListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  /** Case-insensitive match on the email or the display name. */
  search: z.string().trim().max(200).optional(),
  status: z.enum(['all', 'active', 'suspended']).default('all'),
});

export class OrgMemberListQueryDto extends createZodDto(orgMemberListQuerySchema) {}

export const updateOrgMemberSchema = z
  .object({
    roleName: z.enum(ASSIGNABLE_ORG_ROLES).optional(),
    status: z.enum(['active', 'suspended']).optional(),
  })
  .strict()
  .refine((value) => value.roleName !== undefined || value.status !== undefined, {
    message: 'Provide roleName, status or both',
  });

export class UpdateOrgMemberDto extends createZodDto(updateOrgMemberSchema) {}

export const orgMemberResponseSchema = z.object({
  userId: z.uuid(),
  email: z.email(),
  /** The override, else the provider's name, else null. */
  displayName: z.string().nullable(),
  /** The member's org role. */
  role: z.string(),
  status: z.enum(['active', 'suspended']),
  /** When the member last signed in to, or switched to, this organization. */
  lastActiveAt: z.iso.datetime().nullable(),
  /** When the membership was created. */
  joinedAt: z.iso.datetime(),
});

export class OrgMemberResponseDto extends createZodDto(orgMemberResponseSchema) {}
