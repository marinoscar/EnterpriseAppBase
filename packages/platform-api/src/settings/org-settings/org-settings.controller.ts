// =============================================================================
// `GET` / `PATCH /api/org-settings` (issue #733, PP-8.1)
// =============================================================================
//
// The caller's ACTIVE organization's settings overrides. Org-scope
// permissions (`org_settings:read|write`, held through `org_admin`); each
// namespace's own `org.readPermission` / `org.writePermission` then gates its
// fields inside the handler (`OrgSettingsService`). `If-Match` on PATCH: a
// stale version is a 409, `0` matches an organization that has no row yet.
// =============================================================================

import { Body, Controller, Get, Headers, Patch } from '@nestjs/common';
import { ApiHeader, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { orgSettingsResponseSchema, patchOrgSettingsSchema } from '@marinoscar/platform-contract/settings';
import { createZodDto } from 'nestjs-zod';

import { ApiDataResponse, ErrorDto } from '../../core/index';
import { Auth, CurrentOrg, CurrentUser, type RequestUser } from '../../identity/index';
import { ORG_SETTINGS_PERMISSIONS } from '../settings.permissions';
import { OrgSettingsService } from './org-settings.service';

/**
 * The `PATCH /api/org-settings` body: namespace key to a partial of its org
 * fields, or `null` to clear the organization's override of the namespace.
 *
 * @stability experimental
 */
export class PatchOrgSettingsDto extends createZodDto(patchOrgSettingsSchema) {}

/**
 * The `GET` / `PATCH /api/org-settings` payload.
 *
 * @stability experimental
 */
export class OrgSettingsResponseDto extends createZodDto(orgSettingsResponseSchema) {}

/** `If-Match`, parsed: an unparseable value is treated as absent (docs/API.md). */
function parseIfMatch(ifMatch: string | undefined): number | undefined {
  if (ifMatch === undefined) return undefined;
  const version = Number.parseInt(ifMatch.replace(/^W\/|"/g, ''), 10);
  return Number.isNaN(version) ? undefined : version;
}

/**
 * `/api/org-settings`: the active organization's settings overrides.
 *
 * @stability experimental
 */
@ApiTags('Organization Settings')
@Controller('org-settings')
export class OrgSettingsController {
  constructor(private readonly orgSettings: OrgSettingsService) {}

  /**
   * The active organization's overrides, the effective value of each
   * org-overridable namespace and the version.
   *
   * @param orgId - the caller's active organization.
   * @param user - the caller.
   * @returns the payload, filtered to the namespaces the caller may read.
   */
  @Get()
  @Auth({ permissions: [ORG_SETTINGS_PERMISSIONS.ORG_SETTINGS_READ.id] })
  @ApiOperation({
    summary: "Get the active organization's settings overrides",
    description:
      'Returns `{ value, effective, version, namespaces }` for the caller\'s active organization: the stored ' +
      'overrides, the system value merged with them per namespace, the row version for `If-Match` (`0` while ' +
      'the organization has none) and the descriptor of every org-overridable namespace. A namespace whose ' +
      'own read permission the caller lacks is omitted.',
  })
  @ApiDataResponse(OrgSettingsResponseDto)
  @ApiResponse({ status: 403, description: 'Missing `org_settings:read`, or no active organization', type: ErrorDto })
  async get(@CurrentOrg() orgId: string, @CurrentUser() user: RequestUser) {
    return this.orgSettings.get(orgId, { userId: user.id, permissions: user.permissions });
  }

  /**
   * Patches the active organization's overrides.
   *
   * @param orgId - the caller's active organization.
   * @param user - the caller.
   * @param body - the patch.
   * @param ifMatch - the expected version.
   * @returns the new payload.
   */
  @Patch()
  @Auth({ permissions: [ORG_SETTINGS_PERMISSIONS.ORG_SETTINGS_WRITE.id] })
  @ApiOperation({
    summary: "Partially update the active organization's settings overrides",
    description:
      'Each namespace branch is validated against that namespace\'s org schema. `null` clears a namespace ' +
      '(or, inside one, a field) so the system value applies again. A namespace that is unknown or cannot be ' +
      'overridden per organization is a 400; one whose write permission the caller lacks is a 403.',
  })
  @ApiHeader({ name: 'If-Match', description: 'Expected version for optimistic concurrency', required: false })
  @ApiDataResponse(OrgSettingsResponseDto)
  @ApiResponse({ status: 400, description: 'Unknown or non-overridable namespace, or an invalid value', type: ErrorDto })
  @ApiResponse({ status: 403, description: "Missing `org_settings:write` or a namespace's write permission", type: ErrorDto })
  @ApiResponse({ status: 409, description: 'Version conflict', type: ErrorDto })
  async patch(
    @CurrentOrg() orgId: string,
    @CurrentUser() user: RequestUser,
    @Body() body: PatchOrgSettingsDto,
    @Headers('if-match') ifMatch?: string,
  ) {
    return this.orgSettings.patch(orgId, body, { userId: user.id, permissions: user.permissions }, parseIfMatch(ifMatch));
  }
}
