import { Body, Controller, Get, Inject, Put } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { AllowDuringMaintenance, type PlatformHost } from '../../core/index';
import { CurrentUser } from '../../identity/index';
import { SETTINGS_PERMISSIONS } from '../../settings/index';
import { resolveHostAccess } from '../internal/host-access';
import { MaintenanceModeService } from './maintenance-mode.service';
import { MaintenanceStatusDto, UpdateMaintenanceDto } from './dto/update-maintenance.dto';

/** The permission `GET /api/admin/maintenance` requires unless the app configures another. */
export const DEFAULT_MAINTENANCE_READ_PERMISSION: string =
  SETTINGS_PERMISSIONS.SYSTEM_SETTINGS_READ.id;
/** The permission `PUT /api/admin/maintenance` requires unless the app configures another. */
export const DEFAULT_MAINTENANCE_WRITE_PERMISSION: string =
  SETTINGS_PERMISSIONS.SYSTEM_SETTINGS_WRITE.id;

/**
 * What {@link createMaintenanceController} takes.
 *
 * @stability experimental
 */
export interface MaintenanceControllerOptions {
  /** The app's access decorators; omitted, the identity slice's `@Auth()`. */
  host?: PlatformHost;
  /** Permission for the read route. Default `system_settings:read`. */
  readPermission?: string;
  /** Permission for the write route. Default `system_settings:write`. */
  writePermission?: string;
}

/** The maintenance controller's handlers. */
export interface MaintenanceControllerInstance {
  /** `GET /api/admin/maintenance`. */
  getMaintenance(): Promise<MaintenanceStatusDto>;
  /** `PUT /api/admin/maintenance`. */
  setMaintenance(dto: UpdateMaintenanceDto, userId: string): Promise<MaintenanceStatusDto>;
}

/** The maintenance controller class. */
export type MaintenanceControllerClass = new (
  maintenance: MaintenanceModeService
) => MaintenanceControllerInstance;

/**
 * The maintenance window's admin API (#257, epic #254).
 *
 * NO NEW PERMISSION. This IS a system setting — it is stored in the
 * `maintenance` namespace of the `system_settings` row and nowhere else — and
 * `system_settings:read` / `system_settings:write` already mean "may inspect /
 * may change global application behaviour". A dedicated `maintenance:manage`
 * would protect nothing that pair does not already cover, while adding a
 * permission to seed, to assign, and to get wrong. See
 * docs/specs/maintenance-mode.md.
 *
 * `@AllowDuringMaintenance()` on the class, for the obvious reason: the switch
 * that turns the window off must be reachable while the window is open. Note
 * that this exemption is about REACHABILITY only — `@Auth()` still runs, so a
 * caller without `system_settings:write` gets a 403 during a window exactly as
 * they would outside one.
 *
 * ACCESS COMES FROM THE APP. The two decorators are the app's
 * (`PlatformHost.access`, via `PlatformHostCoreModule.forRoot({ host })`), and the
 * two permission strings are `PlatformHostCoreModule.forRoot({ permissions })`,
 * defaulting to the pair above. With no `host` the identity slice's `@Auth()`
 * is used, which is what the reference app binds.
 *
 * Mounted by `PlatformHostCoreModule.forRoot()` (packaged by #867).
 *
 * @param options - the permissions and the host, as `PlatformHostCoreModule.forRoot` resolved them.
 * @returns the controller class.
 *
 * @stability experimental
 */
export function createMaintenanceController(
  options: MaintenanceControllerOptions = {}
): MaintenanceControllerClass {
  const access = resolveHostAccess(options.host);
  const requireRead = access.requirePermissions([
    options.readPermission ?? DEFAULT_MAINTENANCE_READ_PERMISSION,
  ]);
  const requireWrite = access.requirePermissions([
    options.writePermission ?? DEFAULT_MAINTENANCE_WRITE_PERMISSION,
  ]);

  @ApiTags('Maintenance')
  @Controller('admin/maintenance')
  @AllowDuringMaintenance()
  class MaintenanceController implements MaintenanceControllerInstance {
    constructor(
      @Inject(MaintenanceModeService) private readonly maintenance: MaintenanceModeService
    ) {}

    @Get()
    @requireRead
    @ApiOperation({
      summary: 'Get the maintenance window state',
      description:
        'Returns the effective state together with each contributing layer ' +
        '(environment override, in-memory override, persisted setting) so an ' +
        'operator can see which one is deciding the answer.',
    })
    @ApiResponse({
      status: 200,
      description: 'Effective maintenance state and its layers',
      type: MaintenanceStatusDto,
    })
    /**
     * The effective state and its layers, read fresh.
     *
     * @returns the state.
     */
    async getMaintenance(): Promise<MaintenanceStatusDto> {
      // `fresh: true`: the guard may read a value up to a few seconds old, but an
      // operator inspecting the switch must be shown the row as it is now.
      return (await this.maintenance.resolve({
        fresh: true,
      })) as MaintenanceStatusDto;
    }

    @Put()
    @requireWrite
    @ApiOperation({
      summary: 'Open or close the maintenance window',
      description:
        'Writes the persisted `maintenance` system-settings namespace and records ' +
        'an audit event. Opening a window stamps who opened it and when; closing ' +
        'one clears both. An environment override, if present, still outranks ' +
        'whatever this writes — check `source` in the response.',
    })
    @ApiResponse({
      status: 200,
      description: 'The state after the write, with its layers',
      type: MaintenanceStatusDto,
    })
    @ApiResponse({ status: 400, description: 'Validation error' })
    /**
     * Opens or closes the persisted window and audits the write.
     *
     * @param dto - the validated body.
     * @param userId - the caller.
     * @returns the state after the write.
     */
    async setMaintenance(
      @Body() dto: UpdateMaintenanceDto,
      @CurrentUser('id') userId: string
    ): Promise<MaintenanceStatusDto> {
      return (await this.maintenance.setMaintenance(
        {
          enabled: dto.enabled,
          message: dto.message,
          allowAdmins: dto.allowAdmins,
        },
        userId
      )) as MaintenanceStatusDto;
    }
  }

  return MaintenanceController;
}

/**
 * The maintenance controller with the default permissions and the identity slice's `@Auth()`.
 *
 * @stability experimental
 */
export const MaintenanceController: MaintenanceControllerClass = createMaintenanceController();
export type MaintenanceController = MaintenanceControllerInstance;
