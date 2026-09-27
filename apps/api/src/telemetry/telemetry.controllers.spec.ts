import { PERMISSIONS_KEY } from '../auth/decorators/permissions.decorator';
import { RBAC_EXTENSION_KEY } from '../auth/decorators/auth.decorator';
import { PERMISSIONS } from '../common/constants/roles.constants';
import { TelemetryAdminController } from './telemetry-admin.controller';
import { TelemetryConfigController } from './telemetry-config.controller';
import { TelemetryExplorerController } from './telemetry-explorer.controller';

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

  describe('TelemetryExplorerController', () => {
    const proto = TelemetryExplorerController.prototype;

    it.each(['query', 'getSchema', 'export'] as const)('gates %s on telemetry:query', (method) => {
      expect(permissionsOf(proto[method])).toEqual([PERMISSIONS.TELEMETRY_QUERY]);
      expect(PERMISSIONS.TELEMETRY_QUERY).toBe('telemetry:query');
    });

    it('passes the explorer source and maxRows to the query service', async () => {
      const queries = { run: jest.fn().mockResolvedValue({}) };
      const controller = new TelemetryExplorerController(queries as never, {} as never, {} as never);

      await controller.query({ sql: 'SELECT 1', maxRows: 7 } as never, 'user-1');

      expect(queries.run).toHaveBeenCalledWith('user-1', 'SELECT 1', { maxRows: 7, source: 'explorer' });
    });

    it('sends an export as an uncached attachment', async () => {
      const exports = {
        export: jest.fn().mockResolvedValue({
          buffer: Buffer.from('a\r\n'),
          contentType: 'text/csv; charset=utf-8',
          filename: 'telemetry-20260927-142501.csv',
          rowCount: 0,
          truncated: false,
        }),
      };
      const headers: Record<string, string> = {};
      const reply = {
        status: jest.fn().mockReturnThis(),
        header: jest.fn(function (this: unknown, name: string, value: string) {
          headers[name] = value;
          return this;
        }),
        send: jest.fn().mockReturnThis(),
      };
      const controller = new TelemetryExplorerController({} as never, {} as never, exports as never);

      await controller.export({ sql: 'SELECT a FROM t', format: 'csv' } as never, 'user-1', reply as never);

      expect(exports.export).toHaveBeenCalledWith('user-1', 'SELECT a FROM t', 'csv');
      expect(reply.status).toHaveBeenCalledWith(200);
      expect(headers).toEqual({
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': 'attachment; filename="telemetry-20260927-142501.csv"',
        'Content-Length': '3',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
        'X-Telemetry-Row-Count': '0',
        'X-Telemetry-Truncated': 'false',
      });
      expect(reply.send).toHaveBeenCalledWith(Buffer.from('a\r\n'));
    });
  });
});
