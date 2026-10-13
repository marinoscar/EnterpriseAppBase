// =============================================================================
// The grantee-kind route: GET /api/sharing/grantee-kinds (PP-14.16)
// =============================================================================
//
// What a share dialog needs to offer each registered grantee kind: its label,
// how it collects the grantee and whether a grant of it can be stored today.
// Read-only metadata of the registry (no fragment, no handler), so it needs
// `sharing:read`, the permission the dialog's other reads use.
// =============================================================================

import { Controller, Get, Type } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { GranteeKindList } from '@marinoscar/platform-contract/sharing';

import { describeGranteeKind, granteeKindRegistry } from '../access/grantee-kinds';
import { GranteeKindListResponseDto } from '../dto/grants.dto';
import { SHARING_PERMISSIONS } from '../permissions';
import type { ResolvedSharingModuleOptions } from '../sharing.options';

/**
 * Creates the `GranteeKindsController` class for one set of module options,
 * its route guarded by the app's access decorators. `SharingModule.forRoot()`
 * calls it.
 *
 * @param options - the resolved module options.
 * @returns the controller class.
 *
 * @stability experimental
 */
export function createGranteeKindsController(options: ResolvedSharingModuleOptions): Type<unknown> {
  const READ = options.host.access.requirePermissions([SHARING_PERMISSIONS.SHARING_READ]);

  @ApiTags('Grants')
  @Controller('sharing')
  class GranteeKindsController {
    @Get('grantee-kinds')
    @READ
    @ApiOperation({
      summary: 'List the grantee kinds',
      description:
        'The registered kinds of grantee (`user`, `group`, `link` and any the app registered with `registerGranteeKind`), ' +
        'in registration order, with the label and input type a share dialog needs and whether a grant of the kind can be ' +
        'stored (`persisted`). Requires `sharing:read`.',
    })
    @ApiResponse({ status: 200, type: GranteeKindListResponseDto })
    list(): GranteeKindList {
      return { items: granteeKindRegistry.list().map(describeGranteeKind) };
    }
  }

  return GranteeKindsController;
}
