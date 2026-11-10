import { createZodDto } from 'nestjs-zod';
import {
  ASSIGNABLE_ORG_ROLES,
  orgMemberListQuerySchema,
  orgMemberResponseSchema,
  updateOrgMemberSchema,
} from '@marinoscar/platform-contract/identity';

// The schemas are the contract's (#727); re-exported so imports are unchanged.
export {
  ASSIGNABLE_ORG_ROLES,
  orgMemberListQuerySchema,
  orgMemberResponseSchema,
  updateOrgMemberSchema,
};
export type { AssignableOrgRole } from '@marinoscar/platform-contract/identity';

// =============================================================================
// The active organization's members: `/api/org/members` (#726, PP-6.7)
// =============================================================================

export class OrgMemberListQueryDto extends createZodDto(orgMemberListQuerySchema) {}

export class UpdateOrgMemberDto extends createZodDto(updateOrgMemberSchema) {}

export class OrgMemberResponseDto extends createZodDto(orgMemberResponseSchema) {}
