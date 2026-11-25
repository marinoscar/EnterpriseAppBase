import 'reflect-metadata';

import { IS_PUBLIC_KEY, PERMISSIONS_KEY } from '../../src/identity/index';
import {
  DEFAULT_MAINTENANCE_READ_PERMISSION,
  DEFAULT_MAINTENANCE_WRITE_PERMISSION,
  PlatformHostCoreModule,
  createHealthController,
  createMaintenanceController,
  resolvePlatformHostCoreOptions,
} from '../../src/host/index';

// The host controllers take their access from the app (PP-14.13): the
// `PlatformHost` decorators and the two maintenance permission strings.

const permissionsOn = (controller: { prototype: object }, method: string) =>
  Reflect.getMetadata(PERMISSIONS_KEY, (controller.prototype as Record<string, object>)[method]) as string[] | undefined;

/** A host whose decorators leave a recognisable marker on whatever they decorate. */
function recordingHost() {
  const calls: string[] = [];
  const marker = (label: string) => (...args: unknown[]) => {
    const target = args[2] ? (args[2] as PropertyDescriptor).value : args[0];
    Reflect.defineMetadata(`host:${label}`, true, target as object);
    calls.push(label);
  };
  return {
    calls,
    host: {
      access: {
        requirePermissions: (permissions: readonly string[]) => marker(`perm:${permissions.join('+')}`) as never,
        requireAuthenticated: () => marker('authenticated') as never,
        allowPublic: () => marker('public') as never,
      },
    },
  };
}

describe('PlatformHostCoreModule options: host and permissions (PP-14.13)', () => {
  it('defaults to today: the identity decorators and system_settings:read / :write', () => {
    const resolved = resolvePlatformHostCoreOptions();
    expect(resolved.host).toBeUndefined();
    expect(resolved.permissions).toEqual({ maintenanceRead: 'system_settings:read', maintenanceWrite: 'system_settings:write' });
    expect(DEFAULT_MAINTENANCE_READ_PERMISSION).toBe('system_settings:read');
    expect(DEFAULT_MAINTENANCE_WRITE_PERMISSION).toBe('system_settings:write');

    const maintenance = createMaintenanceController();
    expect(permissionsOn(maintenance, 'getMaintenance')).toEqual(['system_settings:read']);
    expect(permissionsOn(maintenance, 'setMaintenance')).toEqual(['system_settings:write']);
  });

  it('keeps the controller names, which OpenAPI operation ids derive from', () => {
    expect(createMaintenanceController().name).toBe('MaintenanceController');
    expect(createHealthController().name).toBe('HealthController');
  });

  it('marks the health probes public with the identity marker when there is no host', () => {
    const health = createHealthController();
    for (const method of ['liveness', 'readiness', 'fullHealth']) {
      expect(Reflect.getMetadata(IS_PUBLIC_KEY, (health.prototype as Record<string, object>)[method])).toBe(true);
    }
  });

  it("routes the maintenance routes through the app's decorators with the configured strings", () => {
    const { host, calls } = recordingHost();
    const resolved = resolvePlatformHostCoreOptions({
      host: host as never,
      permissions: { maintenanceRead: 'ops:read', maintenanceWrite: 'ops:write' },
    });
    const maintenance = createMaintenanceController({
      host: resolved.host,
      readPermission: resolved.permissions.maintenanceRead,
      writePermission: resolved.permissions.maintenanceWrite,
    });
    const proto = maintenance.prototype as Record<string, object>;
    expect(Reflect.getMetadata('host:perm:ops:read', proto.getMaintenance)).toBe(true);
    expect(Reflect.getMetadata('host:perm:ops:write', proto.setMaintenance)).toBe(true);
    // not the identity decorator
    expect(permissionsOn(maintenance, 'getMaintenance')).toBeUndefined();
    expect(calls).toEqual(expect.arrayContaining(['perm:ops:read', 'perm:ops:write']));
  });

  it("marks the probes public with the app's own marker when the host binds one", () => {
    const { host } = recordingHost();
    const health = createHealthController(host as never);
    expect(Reflect.getMetadata('host:public', (health.prototype as Record<string, object>).liveness)).toBe(true);
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, (health.prototype as Record<string, object>).liveness)).toBeUndefined();
  });

  it('keeps the identity public marker when the host binds none (the probes are public either way)', () => {
    const { host } = recordingHost();
    const { allowPublic: _omit, ...access } = host.access;
    const health = createHealthController({ access } as never);
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, (health.prototype as Record<string, object>).liveness)).toBe(true);
  });

  it('wires the module with both controllers, in the document order', () => {
    const module = PlatformHostCoreModule.forRoot({ permissions: { maintenanceRead: 'ops:read' } });
    expect((module.controllers ?? []).map((controller) => (controller as { name: string }).name)).toEqual([
      'HealthController',
      'MaintenanceController',
    ]);
    const maintenance = module.controllers?.[1] as { prototype: object };
    expect(permissionsOn(maintenance, 'getMaintenance')).toEqual(['ops:read']);
    expect(permissionsOn(maintenance, 'setMaintenance')).toEqual(['system_settings:write']);
  });

  it.each([
    [{ permissions: { maintenanceRead: '' } }, /maintenanceRead must be a non-empty string/],
    [{ permissions: { maintenanceWrite: 5 } }, /maintenanceWrite must be a non-empty string/],
    [{ permissions: { maintenance: 'x' } }, /not a host permission/],
    [{ host: {} }, /definePlatformHost/],
  ])('refuses %j at forRoot', (options, message) => {
    expect(() => resolvePlatformHostCoreOptions(options as never)).toThrow(message);
  });
});
