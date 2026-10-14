import { createZodDto } from 'nestjs-zod';
import {
  ORG_SLUG_PATTERN,
  createOrganizationSchema,
  organizationListQuerySchema,
  organizationResponseSchema,
  renameOrganizationSchema,
} from '@marinoscar/platform-contract/identity';

// The schemas are the contract's (#727); re-exported so imports are unchanged.
export {
  ORG_SLUG_PATTERN,
  createOrganizationSchema,
  organizationListQuerySchema,
  organizationResponseSchema,
  renameOrganizationSchema,
};

// =============================================================================
// The deployment's organizations: `/api/admin/organizations` (#726, PP-6.7)
// =============================================================================

export class OrganizationListQueryDto extends createZodDto(organizationListQuerySchema) {}

export class CreateOrganizationDto extends createZodDto(createOrganizationSchema) {}

/** Rename only: the slug is immutable here, and `isDefault` cannot be changed. */
export class RenameOrganizationDto extends createZodDto(renameOrganizationSchema) {}

export class OrganizationResponseDto extends createZodDto(organizationResponseSchema) {}
