import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/**
 * `roleNames` keeps its pre-split vocabulary (`admin`, `contributor`,
 * `viewer`). In single-org mode `admin` is the system administrator role (and
 * makes the default-org membership `org_admin`); `contributor`/`viewer` set
 * the membership role. In multi-org mode only system roles are accepted; an
 * org role name is a 400 (organization roles are managed per organization).
 */
export const updateUserRolesSchema = z.object({
  roleNames: z
    .array(z.string())
    .min(1, 'At least one role is required')
    .describe(
      'Role names. Single-org mode: `admin` (system administrator, plus `org_admin` on the default organization), `contributor` or `viewer` (the membership role). Multi-org mode: system roles only.',
    ),
});

export class UpdateUserRolesDto extends createZodDto(updateUserRolesSchema) {}
