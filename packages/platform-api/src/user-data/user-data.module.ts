// =============================================================================
// UserDataModule: the user-data slice (issue #743, PP-9.1)
// =============================================================================

import { DynamicModule, Module } from '@nestjs/common';

import { OrganizationsModule } from '../identity/index';
import { StorageProvidersModule } from '../storage/index';
import { FactoryResetHandler } from './handlers/factory-reset.handler';
import { OrgOffboardHandler } from './handlers/org-offboard.handler';
import { LegacyUserDataPurgeHandlers, UserDataPurgeHandler } from './handlers/user-data-purge.handler';
import { UserDataPlanService } from './user-data-plan.service';
import { UserDataRegistriesDoctorCheck } from './doctor/user-data-registries.doctor-check';
import { USER_DATA_ENVIRONMENT } from './ports';
import { createUserDataControllers } from './user-data.controller';
import { USER_DATA_OPTIONS, resolveUserDataModuleOptions, type UserDataModuleOptions } from './user-data.options';
import { FactoryResetService, OrgOffboardingService, UserDataService } from './user-data.service';
import { UserPurgeRunner } from './user-purge.runner';

/**
 * The user-data slice: the per-user deletion (`user.data.purge`), the admin
 * factory reset (`admin.factory_reset`) and organization offboarding
 * (`org.offboard`), with their routes.
 *
 * Needs, from the app: `JobsModule.forRoot()` (global), the core platform
 * host (`AUDIT_SINK`, global), the host core (`DeploymentModeService`), the
 * storage provider's dependencies, the Doctor module and `options.imports`
 * binding `USER_DATA_DB`.
 *
 * @stability experimental
 */
@Module({})
export class UserDataModule {
  /**
   * The slice for one app. Call once, after the app's user-data manifest ran
   * (the registries must be filled before the plan is computed at bootstrap).
   *
   * @param options - see {@link UserDataModuleOptions}.
   * @returns the dynamic module. It exports `UserDataService`,
   *   `FactoryResetService`, `OrgOffboardingService`, `UserPurgeRunner` and
   *   `UserDataPlanService`.
   * @throws Error when an option is invalid; at bootstrap, `UserDataPlanError`
   *   when no delete order exists (a cycle names its models).
   *
   * @example
   * ```ts
   * import './user-data.manifest';
   * export const userDataModule = UserDataModule.forRoot({ imports: [UserDataHostModule], datamodel: readAppDatamodel });
   * ```
   *
   * @extensionPoint option
   * @stability experimental
   */
  static forRoot(options: UserDataModuleOptions): DynamicModule {
    const resolved = resolveUserDataModuleOptions(options);
    const exported = [UserDataService, FactoryResetService, OrgOffboardingService, UserPurgeRunner, UserDataPlanService];
    return {
      module: UserDataModule,
      // `OrganizationsModule`: `TenancyService`, for the default environment.
      imports: [...resolved.imports, StorageProvidersModule, OrganizationsModule],
      controllers: createUserDataControllers(),
      providers: [
        { provide: USER_DATA_OPTIONS, useValue: resolved },
        { provide: USER_DATA_ENVIRONMENT, useClass: resolved.environment },
        UserDataRegistriesDoctorCheck,
        ...exported,
        UserDataPurgeHandler,
        LegacyUserDataPurgeHandlers,
        FactoryResetHandler,
        OrgOffboardHandler,
      ],
      exports: [USER_DATA_OPTIONS, ...exported],
    };
  }
}
