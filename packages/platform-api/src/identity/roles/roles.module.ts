import { Module } from '@nestjs/common';

import { RolesController } from './roles.controller';

/**
 * Roles: `RolesController` (`GET /api/roles`). Mounted by `IdentityModule.forRoot()`.
 *
 * @stability experimental
 */
@Module({ controllers: [RolesController] })
export class RolesModule {}
