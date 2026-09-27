import { TelemetryConnectionTestService, type TelemetryProbeClient } from './telemetry-connection-test.service';
import type { TestTelemetryConnectionInput } from './dto/telemetry-connection.dto';

// =============================================================================
// TelemetryConnectionTestService — tests (issue #558, epic #528)
// =============================================================================
//
// ALWAYS RESOLVES — never throws, whatever the probe does — with a per-role
// verdict; the admin login is skipped rather than probed when `adminUser` is
// null; a blank password means "the current one"; `end()` is always called,
// including on a timeout or an error; and the error text never carries the
// password.
// =============================================================================

const CANDIDATE: TestTelemetryConnectionInput = {
  host: 'candidate-host',
  pgPort: 4003,
  database: 'public',
  readerUser: 'reader',
  readerPassword: 'reader-pw',
  adminUser: 'admin',
  adminPassword: 'admin-pw',
};

class TestableService extends TelemetryConnectionTestService {
  readonly created: unknown[] = [];
  readonly hostsAsked: string[] = [];
  nextClient: () => TelemetryProbeClient = () => makeClient();
  /** `null` (host resolves) unless a test wires it otherwise. */
  hostResolution: (host: string) => Promise<string | null> = async () => null;

  protected override createClient(config: unknown): TelemetryProbeClient {
    this.created.push(config);
    return this.nextClient();
  }

  protected override resolveHost(host: string): Promise<string | null> {
    this.hostsAsked.push(host);
    return this.hostResolution(host);
  }
}

interface FakeClient extends TelemetryProbeClient {
  connect: jest.Mock;
  query: jest.Mock;
  end: jest.Mock;
  on: jest.Mock;
}

function makeClient(overrides: Partial<FakeClient> = {}): FakeClient {
  return {
    connect: jest.fn().mockResolvedValue(undefined),
    query: jest.fn().mockResolvedValue({ rows: [['PostgreSQL 16.3 GreptimeDB 1.2.1']] }),
    end: jest.fn().mockResolvedValue(undefined),
    on: jest.fn(),
    ...overrides,
  };
}

function build(currentPassword: (role: 'reader' | 'admin') => Promise<string | null> = async () => 'current-pw') {
  const connection = { currentPassword: jest.fn(currentPassword), deploymentHost: 'deploy-host' };
  const service = new TestableService(connection as never);
  return { service, connection };
}

describe('TelemetryConnectionTestService', () => {
  // ==========================================================================
  // Always resolves
  // ==========================================================================

  describe('always resolves', () => {
    it('never throws when the reader probe rejects for an unexpected reason', async () => {
      const { service } = build();
      service.nextClient = () => makeClient({ connect: jest.fn().mockRejectedValue(new Error('kaboom')) });

      await expect(service.test(CANDIDATE, 'admin-1')).resolves.toMatchObject({
        reader: { success: false },
      });
    });

    it('reports per-role success/failure independently', async () => {
      const { service } = build();
      let call = 0;
      service.nextClient = () => {
        call += 1;
        return call === 1
          ? makeClient()
          : makeClient({ connect: jest.fn().mockRejectedValue(new Error('admin refused')) });
      };

      const result = await service.test(CANDIDATE, 'admin-1');

      expect(result.reader.success).toBe(true);
      expect('success' in result.admin && result.admin.success).toBe(false);
    });
  });

  // ==========================================================================
  // Automatic host (issue #562)
  // ==========================================================================

  describe('host', () => {
    it('an automatic (null) host probes the deployment host, and reports it as `host`', async () => {
      const { service } = build();

      const result = await service.test({ ...CANDIDATE, host: null }, 'admin-1');

      expect(result.host).toBe('deploy-host');
      expect(service.created).toHaveLength(2);
      for (const config of service.created) {
        expect(config).toMatchObject({ host: 'deploy-host', port: 4003, database: 'public' });
      }
    });

    it('a custom host probes exactly that host, and reports it as `host`', async () => {
      const { service } = build();

      const result = await service.test(CANDIDATE, 'admin-1');

      expect(result.host).toBe('candidate-host');
      expect(service.created[0]).toMatchObject({ host: 'candidate-host' });
    });
  });

  // ==========================================================================
  // A host that does not resolve (issue #564)
  // ==========================================================================

  describe('a host that does not resolve', () => {
    it('reports the host-not-found message for both reader and admin, and creates no client', async () => {
      const { service } = build();
      service.hostResolution = async () => 'host not found: try telemetry.compose.yml';

      const result = await service.test(CANDIDATE, 'admin-1');

      expect(result.reader.success).toBe(false);
      expect(result.reader.error).toBe('host not found: try telemetry.compose.yml');
      expect('success' in result.admin && result.admin.success).toBe(false);
      expect('error' in result.admin && result.admin.error).toBe('host not found: try telemetry.compose.yml');
      expect(service.created).toHaveLength(0);
    });

    it('still reports admin as skipped when adminUser is null', async () => {
      const { service } = build();
      service.hostResolution = async () => 'host not found';

      const result = await service.test({ ...CANDIDATE, adminUser: null }, 'admin-1');

      expect(result.admin).toEqual({ skipped: true });
      expect(service.created).toHaveLength(0);
    });

    it('lets a missing password win over a host that does not resolve', async () => {
      const { service } = build(async () => null);
      service.hostResolution = async () => 'host not found';

      const result = await service.test({ ...CANDIDATE, readerPassword: '' }, 'admin-1');

      expect(result.reader.error).toContain('No reader password was supplied');
      expect(service.created).toHaveLength(0);
    });

    it('resolves the host once, with the effective (candidate) host', async () => {
      const { service } = build();

      await service.test(CANDIDATE, 'admin-1');

      expect(service.hostsAsked).toEqual(['candidate-host']);
    });

    it('resolves the deployment host once when the candidate host is automatic (null)', async () => {
      const { service } = build();

      await service.test({ ...CANDIDATE, host: null }, 'admin-1');

      expect(service.hostsAsked).toEqual(['deploy-host']);
    });
  });

  // ==========================================================================
  // A DNS error surfacing from the probe itself
  // ==========================================================================

  describe('a DNS error from the connect attempt', () => {
    it('is reported as host-not-found, naming the host, the driver message and telemetry.compose.yml', async () => {
      const { service } = build();
      service.nextClient = () =>
        makeClient({
          connect: jest
            .fn()
            .mockRejectedValue(
              Object.assign(new Error('getaddrinfo EAI_AGAIN candidate-host'), { code: 'EAI_AGAIN' }),
            ),
        });

      const result = await service.test({ ...CANDIDATE, adminUser: null }, 'admin-1');

      expect(result.reader.success).toBe(false);
      expect(result.reader.error).toContain('candidate-host');
      expect(result.reader.error).toContain('getaddrinfo EAI_AGAIN candidate-host');
      expect(result.reader.error).toContain('telemetry.compose.yml');
    });

    it('still masks a password that happens to appear in the DNS error text', async () => {
      const { service } = build();
      service.nextClient = () =>
        makeClient({
          connect: jest
            .fn()
            .mockRejectedValue(
              Object.assign(new Error('getaddrinfo EAI_AGAIN reader-pw'), { code: 'EAI_AGAIN' }),
            ),
        });

      const result = await service.test({ ...CANDIDATE, adminUser: null }, 'admin-1');

      expect(result.reader.error).not.toContain('reader-pw');
      expect(result.reader.error).toContain('••••');
    });
  });

  // ==========================================================================
  // Admin skipped when adminUser is null
  // ==========================================================================

  describe('admin login', () => {
    it('is skipped, not probed, when adminUser is null', async () => {
      const { service } = build();

      const result = await service.test({ ...CANDIDATE, adminUser: null }, 'admin-1');

      expect(result.admin).toEqual({ skipped: true });
      // Only the reader client was built.
      expect(service.created).toHaveLength(1);
    });
  });

  // ==========================================================================
  // Blank password uses the current password
  // ==========================================================================

  describe('a blank password', () => {
    it('uses the connection in force\'s current password for that role', async () => {
      const { service, connection } = build(async (role) => (role === 'reader' ? 'the-current-reader-pw' : null));

      await service.test({ ...CANDIDATE, readerPassword: '' }, 'admin-1');

      expect(connection.currentPassword).toHaveBeenCalledWith('reader');
      expect(service.created[0]).toMatchObject({ password: 'the-current-reader-pw' });
    });

    it('reports missing-password, not a probe attempt, when there is no current password either', async () => {
      const { service } = build(async () => null);

      const result = await service.test({ ...CANDIDATE, readerPassword: '', adminUser: null }, 'admin-1');

      expect(result.reader.success).toBe(false);
      expect(result.reader.error).toContain('No reader password was supplied');
      expect(service.created).toHaveLength(0);
    });

    it('does not touch currentPassword when a password is supplied', async () => {
      const { service, connection } = build();

      await service.test(CANDIDATE, 'admin-1');

      expect(connection.currentPassword).not.toHaveBeenCalledWith('reader');
    });
  });

  // ==========================================================================
  // client.end() is always called
  // ==========================================================================

  describe('client.end()', () => {
    it('is called on a successful probe', async () => {
      const { service } = build();
      const client = makeClient();
      service.nextClient = () => client;

      await service.test({ ...CANDIDATE, adminUser: null }, 'admin-1');

      expect(client.end).toHaveBeenCalledTimes(1);
    });

    it('is called even when the probe errors', async () => {
      const { service } = build();
      const client = makeClient({ connect: jest.fn().mockRejectedValue(new Error('refused')) });
      service.nextClient = () => client;

      await service.test({ ...CANDIDATE, adminUser: null }, 'admin-1');

      expect(client.end).toHaveBeenCalledTimes(1);
    });

    it('is called even when the query hangs past the timeout', async () => {
      const { service } = build();
      const client = makeClient({ query: jest.fn(() => new Promise(() => undefined)) });
      service.nextClient = () => client;

      const result = await service.test({ ...CANDIDATE, adminUser: null }, 'admin-1');

      expect(result.reader.success).toBe(false);
      expect(result.reader.error).toContain('did not answer in time');
      expect(client.end).toHaveBeenCalledTimes(1);
    }, 10_000);

    it('does not let a hanging end() block the result', async () => {
      const { service } = build();
      const client = makeClient({ end: jest.fn(() => new Promise(() => undefined)) });
      service.nextClient = () => client;

      const result = await service.test({ ...CANDIDATE, adminUser: null }, 'admin-1');

      expect(result.reader.success).toBe(true);
    }, 10_000);
  });

  // ==========================================================================
  // The error message never contains the password
  // ==========================================================================

  describe('error masking', () => {
    it('masks the password out of an error message that echoed it back', async () => {
      const { service } = build();
      service.nextClient = () =>
        makeClient({
          connect: jest.fn().mockRejectedValue(new Error('auth failed for password "reader-pw"')),
        });

      const result = await service.test({ ...CANDIDATE, adminUser: null }, 'admin-1');

      expect(result.reader.error).not.toContain('reader-pw');
      expect(result.reader.error).toContain('••••');
    });

    it("masks each probe's own password out of ITS OWN error, never the other login's", async () => {
      const { service } = build();
      // Both probes hit the exact same failure text; each must mask only the
      // password IT was connecting with, proving the mask is per-call, not global.
      service.nextClient = () =>
        makeClient({
          connect: jest.fn().mockRejectedValue(new Error('auth failed for reader-pw and admin-pw')),
        });

      const result = await service.test(CANDIDATE, 'admin-1');

      expect(result.reader.error).not.toContain('reader-pw');
      expect('error' in result.admin && result.admin.error).not.toContain('admin-pw');
    });
  });

  // ==========================================================================
  // Reader vs admin SQL
  // ==========================================================================

  describe('the SQL each login runs', () => {
    it('runs SELECT version() as the reader and SHOW CREATE DATABASE as the admin', async () => {
      const { service } = build();
      const clients: FakeClient[] = [];
      service.nextClient = () => {
        const client = makeClient();
        clients.push(client);
        return client;
      };

      await service.test(CANDIDATE, 'admin-1');

      expect(clients[0].query).toHaveBeenCalledWith({ text: 'SELECT version()', rowMode: 'array' });
      expect(clients[1].query).toHaveBeenCalledWith({ text: 'SHOW CREATE DATABASE "public"', rowMode: 'array' });
    });
  });
});
