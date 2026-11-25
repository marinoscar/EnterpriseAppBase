import { createZodDto } from 'nestjs-zod';
import {
  createOrgInviteSchema,
  orgInviteListQuerySchema,
  orgInviteResponseSchema,
} from '@marinoscar/platform-contract/identity';

// The schemas are the contract's (#727); re-exported so imports are unchanged.
export {
  createOrgInviteSchema,
  orgInviteListQuerySchema,
  orgInviteResponseSchema,
};

// =============================================================================
// The active organization's invitations: `/api/org/invites` (#726, PP-6.7)
// =============================================================================

export class OrgInviteListQueryDto extends createZodDto(orgInviteListQuerySchema) {}

export class CreateOrgInviteDto extends createZodDto(createOrgInviteSchema) {}

export class OrgInviteResponseDto extends createZodDto(orgInviteResponseSchema) {}
