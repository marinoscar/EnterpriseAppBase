import { DynamicModule, Module } from '@nestjs/common';

import { AboutSupportBundleSection } from './about-support-bundle.section';
import { ABOUT_OPTIONS, type AboutModuleOptions } from './about.options';
import { AboutController } from './about.controller';
import { AboutService } from './about.service';

// =============================================================================
// AboutModule (issue #401, epic #397; packaged by #891)
// =============================================================================
//
// One controller, one service, one `forRoot`.
//
// The database liveness fact is one `SELECT 1` through core's `PLATFORM_PRISMA`
// host port (the same port the `db.connection` Doctor check probes), so the
// module imports nothing from the app: the old `HealthModule` import, which
// existed only to reuse the readiness indicator, is gone.
//
// This module reads no settings. The deploy document comes off the local
// filesystem and the API version comes from the app's `apiVersion` option.
// `DeploymentModeService` comes from `PlatformHostCoreModule` (global).
//
// Import it where `/api/admin/about` belongs in the generated OpenAPI document,
// which lists paths in module order. Nothing is exported.
// =============================================================================

/**
 * `GET /api/admin/about`: what is actually deployed here (the API version, the
 * deploy document `appctl deploy` left on disk, the deployment mode and a
 * database liveness fact), plus the `versions` support-bundle section.
 *
 * @stability experimental
 */
@Module({})
export class AboutModule {
  /**
   * The about module for one app.
   *
   * @param options - see {@link AboutModuleOptions}.
   * @returns the dynamic module.
   *
   * @extensionPoint option
   * @stability experimental
   */
  static forRoot(options: AboutModuleOptions): DynamicModule {
    return {
      module: AboutModule,
      controllers: [AboutController],
      providers: [
        { provide: ABOUT_OPTIONS, useValue: Object.freeze({ ...options }) },
        AboutService,
        // The `versions` support-bundle section (#772) registers itself with the
        // global `SupportBundleRegistry` (`@marinoscar/platform-api/doctor`).
        AboutSupportBundleSection,
      ],
    };
  }
}
