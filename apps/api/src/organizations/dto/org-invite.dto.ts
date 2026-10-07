import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

import { ASSIGNABLE_ORG_ROLES } from './org-member.dto';

// =============================================================================
// The active organization's invitations: `/api/org/invites` (#726, PP-6.7)
// =============================================================================

export const orgInviteListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  status: z.enum(['all', 'pending', 'accepted', 'revoked', 'expired']).default('all'),
});

export class OrgInviteListQueryDto extends createZodDto(orgInviteListQuerySchema) {}

export const createOrgInviteSchema = z
  .object({
    email: z
      .string()
      .trim()
      .email('Invalid email format')
      .transform((email) => email.toLowerCase()),
    roleName: z.enum(ASSIGNABLE_ORG_ROLES),
    /** The administrator's private note; never sent to the invitee. */
    notes: z.string().max(500, 'Notes must be 500 characters or less').optional(),
  })
  .strict();

export class CreateOrgInviteDto extends createZodDto(createOrgInviteSchema) {}

const actorSchema = z.object({ id: z.uuid(), email: z.email() });

export const orgInviteResponseSchema = z.object({
  id: z.uuid(),
  email: z.email(),
  /** The org role the invitee gets on acceptance. */
  role: z.string(),
  status: z.enum(['pending', 'accepted', 'revoked', 'expired']),
  notes: z.string().nullable(),
  /** After this instant a pending invitation is no longer claimed (and is marked `expired`). */
  expiresAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
  acceptedAt: z.iso.datetime().nullable(),
  invitedBy: actorSchema.nullable(),
  acceptedBy: actorSchema.nullable(),
});

export class OrgInviteResponseDto extends createZodDto(orgInviteResponseSchema) {}
