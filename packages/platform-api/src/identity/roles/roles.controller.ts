import { Controller, ForbiddenException, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import type { RoleScopeValue } from '@marinoscar/platform-contract/identity';

import { ApiDataResponse, type Principal } from '../../core/index';
import { Auth } from '../auth/decorators/auth.decorator';
import { CurrentPrincipal } from '../auth/decorators/current-principal.decorator';
import { PERMISSIONS } from '../identity.constants';
import { RoleDescriptorDto, RoleListQueryDto } from './dto/roles.dto';
import { listRoles } from './role-catalog';

/**
 * The roles the caller may read: the vocabulary the invite, member and
 * user-role dialogs offer (PP-14.15).
 *
 * Two scopes, two permissions, one route: `scope=system` needs `users:read`
 * (the roles held in `user_roles`), `scope=org` needs `org_members:read` (the
 * roles on a membership). The guard admits a holder of either
 * (`anyPermissions`); the handler narrows to the scope each permission opens.
 */
@ApiTags('Roles')
@Controller('roles')
export class RolesController {
  @Get()
  @Auth({ anyPermissions: [PERMISSIONS.USERS_READ, PERMISSIONS.ORG_MEMBERS_READ] })
  @ApiOperation({
    summary: 'List the roles',
    description:
      'The roles the application knows, each with its label, scope and whether the invite, member and user-role routes may assign it ' +
      '(`assignable`). `scope=system` needs `users:read`, `scope=org` needs `org_members:read`; without `scope` every scope the caller may read ' +
      'is listed. A scope the caller may not read answers 403.',
  })
  @ApiQuery({ name: 'scope', required: false, enum: ['system', 'org'] })
  @ApiDataResponse(RoleDescriptorDto, { isArray: true, description: 'The roles, in registration order' })
  list(@Query() query: RoleListQueryDto, @CurrentPrincipal() principal: Principal) {
    const readable: RoleScopeValue[] = [];
    if (principal.permissions.includes(PERMISSIONS.USERS_READ)) readable.push('system');
    if (principal.permissions.includes(PERMISSIONS.ORG_MEMBERS_READ)) readable.push('org');

    if (query.scope !== undefined) {
      if (!readable.includes(query.scope)) {
        throw new ForbiddenException(`You may not read ${query.scope} roles`);
      }
      return listRoles(query.scope);
    }
    // In registration order across scopes, not grouped by the order above.
    return listRoles().filter((role) => readable.includes(role.scope));
  }
}
