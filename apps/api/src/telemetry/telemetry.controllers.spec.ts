import { PERMISSIONS_KEY } from '../auth/decorators/permissions.decorator';
import { RBAC_EXTENSION_KEY } from '../auth/decorators/auth.decorator';
import { PERMISSIONS } from '../common/constants/roles.constants';
import { TelemetryAdminController } from './telemetry-admin.controller';
import { TelemetryConfigController } from './telemetry-config.controller';

// `@ApiExtension` stores its value under `swagger/apiExtension`.
const API_EXTENSION = 'swagger/apiExtension';

function permissionsOf(handler: object): unknown {
  return Reflect.getMetadata(PERMISSIONS_KEY, handler);
}

function rbacOf(handler: object): unknown {
  return (Reflect.getMetadata(API_EXTENSION, handler) as Record<string, unknown> | undefined)?.[
    RBAC_EXTENSION_KEY
  ];
}

describe('Telemetry controllers — access declarations', () => {
  describe('TelemetryAdminController', () => {
    const proto = TelemetryAdminController.prototype;

    it('gates GET config on telemetry:read', () => {
      expect(permissionsOf(proto.getConfig)).toEqual([PERMISSIONS.TELEMETRY_READ]);
    });

    it('gates PUT config on telemetry:write', () => {
      expect(permissionsOf(proto.replaceConfig)).toEqual([PERMISSIONS.TELEMETRY_WRITE]);
    });

    it('gates GET status on telemetry:read', () => {
      expect(permissionsOf(proto.getStatus)).toEqual([PERMISSIONS.TELEMETRY_READ]);
    });

    it('uses the exact seeded permission strings', () => {
      expect(PERMISSIONS.TELEMETRY_READ).toBe('telemetry:read');
      expect(PERMISSIONS.TELEMETRY_WRITE).toBe('telemetry:write');
    });

    it('parses If-Match and treats an unparseable one as absent', async () => {
      const settings = { replace: jest.fn().mockResolvedValue({}) };
      const controller = new TelemetryAdminController(settings as never, {} as never);
      const body = {} as never;

      await controller.replaceConfig(body, 'user-1', '7');
      await controller.replaceConfig(body, 'user-1', 'W/"abc"');
      await controller.replaceConfig(body, 'user-1');

      expect(settings.replace.mock.calls.map((call) => call[2])).toEqual([7, undefined, undefined]);
    });
  });

  describe('TelemetryConfigController', () => {
    it('requires authentication but no permission', () => {
      const handler = TelemetryConfigController.prototype.getConfig;

      expect(rbacOf(handler)).toEqual({ authenticated: true, roles: [], permissions: [] });
      expect(permissionsOf(handler)).toBeUndefined();
    });
  });
});
