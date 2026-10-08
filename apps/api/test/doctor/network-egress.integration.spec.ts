// =============================================================================
// Integration tests for the `network.egress` doctor check (issue #773)
// =============================================================================
//
// The package's `test/doctor/egress/` specs prove what the check DECIDES, and
// each contributor's own spec proves what it reads. This suite drives the
// check through the REAL AppModule — every module's real contributor, the
// real registry wiring, the guard stack and the response envelope — with the
// capabilities' source services replaced by test fakes:
//
//   1. `GET /api/admin/doctor?category=network` returns ONE `network.egress`
//      row, behind `system_settings:read`.
//   2. Online (DEPLOYMENT_NETWORK unset) it is an inventory `pass`.
//   3. Air-gapped: Google as the only provider fails; only OpenAI and the docs
//      CDN public warns; an all-internal deployment passes.
//   4. ⚠ NO URL PATH, QUERY, USERINFO, KEY OR PASSWORD on the wire, with
//      secrets seeded into every source (as in ai-secret-egress).
//   5. NO NETWORK I/O: with `fetch`, `dns.lookup` and `net.connect` stubbed to
//      throw, every contributor and the check still answer.
// =============================================================================

import dns from 'node:dns';
import net from 'node:net';

import request from 'supertest';

import {
  DoctorCheckRegistry,
  DoctorService,
  EgressRegistry,
  classifyHost,
  describeEgress,
} from '@marinoscar/platform-api/doctor';

import { AiConfigService, type AiPolicy } from '../../src/ai/config/ai-config.service';
import { AuthService } from '@marinoscar/platform-api/identity';
import { DeploymentNetworkService } from '../../src/common/deployment/deployment-network.service';
import { EmailSettingsService } from '@marinoscar/platform-api/email';
import { PushConfigService } from '../../src/notifications/push-config.service';
import { SystemSettingsService } from '@marinoscar/platform-api/settings';
import { StorageConfigAdminService } from '../../src/storage/config/storage-config-admin.service';
import { telemetryProviders } from '../../src/platform/telemetry/telemetry.config';
import { setupBaseMocks } from '../fixtures/mock-setup.helper';
import { authHeader, createMockAdminUser, createMockViewerUser } from '../helpers/auth-mock.helper';
import { TestContext, closeTestApp, createTestApp } from '../helpers/test-app.helper';
import { resetPrismaMock } from '../mocks/prisma.mock';

const { TelemetryConnectionService } = telemetryProviders;

const ROUTE = '/api/admin/doctor?category=network&refresh=true';

// Secrets seeded into every source. None may reach the wire.
const SECRETS = {
  userinfo: 'egress-user-SENTINEL',
  password: 'egress-pass-SENTINEL',
  apiKeyInQuery: 'sk-egress-query-SENTINEL',
  pushToken: 'push-capability-token-SENTINEL',
  smtpHint: 'smtp-hint-SENTINEL',
  storageKeyId: 'AKIAEGRESSSENTINEL',
  storageHint: 'storage-hint-SENTINEL',
  greptimePassword: 'greptime-SENTINEL',
};

type Slots = Record<string, Record<string, unknown>>;

function aiPolicy(enabled: boolean, slots: Slots): AiPolicy {
  const providers: Slots = {
    openai: { enabled: false },
    anthropic: { enabled: false },
    gemini: { enabled: false },
    'azure-openai': { enabled: false },
    'openai-compatible': { enabled: false },
  };
  for (const [id, slot] of Object.entries(slots)) providers[id] = { ...providers[id], ...slot };
  return { enabled, keyPolicy: 'org_only', providers } as unknown as AiPolicy;
}

interface Scenario {
  google: boolean;
  ai: AiPolicy;
  push: boolean;
  pushEndpoints: string[];
  email: Record<string, unknown>;
  storage: Record<string, unknown>;
  greptimeHost: string;
  docsCdn?: string;
}

/** Every capability configured against the public internet (the "online" test fake). */
const PUBLIC_EVERYTHING: Scenario = {
  google: true,
  ai: aiPolicy(true, {
    openai: { enabled: true, baseUrl: `https://${SECRETS.userinfo}:${SECRETS.password}@api.openai.com/v1?key=${SECRETS.apiKeyInQuery}` },
  }),
  push: true,
  pushEndpoints: [`https://fcm.googleapis.com/fcm/send/${SECRETS.pushToken}`],
  email: { provider: 'smtp', enabled: true, smtpHost: 'smtp.sendgrid.net', smtpUsername: SECRETS.userinfo },
  storage: { provider: 's3', region: 'us-east-1', effectiveEndpoint: null },
  greptimeHost: 'greptime.example.cloud',
};

describe('network.egress (Integration, #773)', () => {
  let context: TestContext;
  let savedDocsCdn: string | undefined;

  beforeAll(async () => {
    savedDocsCdn = process.env.API_DOCS_CDN;
    context = await createTestApp({ useMockDatabase: true });
  }, 60000);

  afterAll(async () => {
    await closeTestApp(context);
    if (savedDocsCdn === undefined) delete process.env.API_DOCS_CDN;
    else process.env.API_DOCS_CDN = savedDocsCdn;
  });

  beforeEach(() => {
    resetPrismaMock();
    setupBaseMocks();
    context.module.get(DoctorService).invalidate();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  const server = () => context.app.getHttpServer();
  const adminAuth = async () => authHeader((await createMockAdminUser(context)).accessToken);

  function useNetwork(network: 'online' | 'air-gapped') {
    jest.replaceProperty(context.module.get(DeploymentNetworkService), 'network', network);
  }

  /** Replaces every capability's source with a test fake. */
  function arrange(s: Scenario) {
    const get = <T>(token: new (...args: never[]) => T) => context.module.get(token, { strict: false });

    jest
      .spyOn(get(AuthService), 'getEnabledProviders')
      .mockResolvedValue(s.google ? [{ name: 'google', enabled: true }] : []);
    jest.spyOn(get(AiConfigService), 'resolve').mockResolvedValue(s.ai);
    jest.spyOn(get(SystemSettingsService), 'getAiPolicy').mockResolvedValue(s.ai as never);
    jest.spyOn(get(PushConfigService), 'describeForAdmin').mockResolvedValue({
      enabled: s.push,
      configured: s.push,
      settingsError: null,
      publicKey: s.push ? 'BPUBLIC' : null,
      privateKeyStatus: { configured: s.push, hint: SECRETS.smtpHint, updatedAt: null, updatedByUserId: null },
    } as never);
    context.prismaMock.pushSubscription.findMany.mockResolvedValue(
      s.pushEndpoints.map((endpoint) => ({ endpoint })) as never,
    );
    jest.spyOn(get(EmailSettingsService), 'describeForAdmin').mockResolvedValue({
      settingsError: null,
      smtpPasswordStatus: { configured: true, hint: SECRETS.smtpHint },
      ...s.email,
    } as never);
    jest.spyOn(get(StorageConfigAdminService), 'describeForAdmin').mockResolvedValue({
      bucket: 'acme-files',
      endpoint: '',
      accountId: '',
      accessKeyId: SECRETS.storageKeyId,
      forcePathStyle: null,
      configured: true,
      missing: [],
      secretAccessKeyStatus: { configured: true, hint: SECRETS.storageHint },
      ...s.storage,
    } as never);
    const telemetry = get(TelemetryConnectionService);
    jest.spyOn(telemetry, 'describeSnapshot').mockReturnValue({
      source: 'environment',
      host: s.greptimeHost,
      hostMode: 'auto',
      deploymentManaged: true,
      pgPort: 4003,
      database: 'public',
      reader: { user: 'reader', passwordSet: true, password: SECRETS.greptimePassword },
      admin: null,
    } as never);
    jest.spyOn(telemetry, 'isConfigured').mockReturnValue(s.greptimeHost !== '');
    if (s.docsCdn === undefined) delete process.env.API_DOCS_CDN;
    else process.env.API_DOCS_CDN = s.docsCdn;
  }

  async function report(network: 'online' | 'air-gapped', s: Scenario) {
    useNetwork(network);
    arrange(s);
    const res = await request(server()).get(ROUTE).set(await adminAuth()).expect(200);
    const checks = res.body.data.checks as Array<Record<string, any>>;
    return { text: res.text, checks, row: checks.find((c) => c.id === 'network.egress') };
  }

  describe('the route', () => {
    it('refuses a viewer: the report needs system_settings:read', async () => {
      const viewer = await createMockViewerUser(context);
      await request(server()).get(ROUTE).set(authHeader(viewer.accessToken)).expect(403);
    });

    it('returns exactly one network.egress row for category=network', async () => {
      const { checks } = await report('online', PUBLIC_EVERYTHING);

      expect(checks.map((c) => c.id)).toEqual(['network.egress']);
      expect(checks[0]).toMatchObject({
        category: 'network',
        label: 'Outbound dependencies (air-gap readiness)',
      });
    }, 30000);
  });

  describe('online (DEPLOYMENT_NETWORK unset)', () => {
    it('is the default network', () => {
      // The suite's environment does not set it; the service parsed `online`.
      expect(process.env.DEPLOYMENT_NETWORK ?? '').toBe('');
      expect(context.module.get(DeploymentNetworkService).network).toBe('online');
    });

    it('passes with an inventory of every enabled dependency, counted by scope', async () => {
      const { row } = await report('online', PUBLIC_EVERYTHING);

      expect(row?.status).toBe('pass');
      for (const capability of [
        'Google sign-in',
        'AI provider: OpenAI',
        'Web Push',
        'Email (SMTP relay)',
        'Object storage (Amazon S3)',
        'Telemetry store (GreptimeDB)',
        'API reference (Scalar bundle)',
      ]) {
        expect(row?.detail).toContain(capability);
      }
      expect(row?.detail).toMatch(/^\d+ outbound dependencies enabled \(\d+ public, \d+ private\): /);
      expect(row?.data).toMatchObject({ network: 'online', private: 0, unknown: 0 });
      expect(row?.data.enabled).toBe(row?.data.public);
      expect(row?.data.public).toBeGreaterThanOrEqual(9);
      expect(String(row?.data.public_ids)).toContain('auth.google');
    }, 30000);
  });

  describe('air-gapped', () => {
    it('fails when Google is the only sign-in provider, with the runbook as remedy', async () => {
      const { row } = await report('air-gapped', PUBLIC_EVERYTHING);

      expect(row?.status).toBe('fail');
      expect(row?.detail).toMatch(/^Google sign-in needs accounts\.google\.com/);
      expect(row?.detail).toContain('which an air-gapped network cannot reach');
      expect(row?.remedy).toContain('docs/runbooks/air-gapped.md');
      expect(row?.remedy).toContain('auth.google');
      expect(row?.data).toMatchObject({ network: 'air-gapped', required_public: 1 });
    }, 30000);

    it('warns when only an OpenAI provider and the docs CDN are public', async () => {
      const { row } = await report('air-gapped', {
        google: false,
        ai: aiPolicy(true, { openai: { enabled: true } }),
        push: false,
        pushEndpoints: [],
        email: { provider: 'smtp', enabled: true, smtpHost: 'smtp.corp.internal' },
        storage: { provider: 's3compatible', region: '', effectiveEndpoint: 'http://minio:9000' },
        greptimeHost: 'greptimedb',
      });

      expect(row?.status).toBe('warn');
      expect(row?.remedy).toContain('docs/runbooks/air-gapped.md');
      // The catalog refresh and realtime voice reach the same OpenAI host.
      expect(String(row?.data.public_ids).split(',').sort()).toEqual(
        ['ai.catalog-refresh.openai', 'ai.provider.openai', 'ai.realtime.openai', 'docs.scalar-cdn'].sort(),
      );
      expect(row?.data).toMatchObject({ required_public: 0, unknown: 0 });
    }, 30000);

    it('passes for an all-internal deployment', async () => {
      const { row } = await report('air-gapped', {
        google: false,
        ai: aiPolicy(true, {
          'openai-compatible': { enabled: true, baseUrl: 'http://ollama:11434', requiresKey: false },
        }),
        push: false,
        pushEndpoints: [],
        email: { provider: 'smtp', enabled: true, smtpHost: 'smtp.corp.internal' },
        storage: { provider: 's3compatible', region: '', effectiveEndpoint: 'http://minio:9000' },
        greptimeHost: 'greptimedb',
        docsCdn: 'https://static.corp.internal/npm/@scalar/api-reference',
      });

      expect(row).toMatchObject({
        status: 'pass',
        detail: 'Air-gap ready: every enabled dependency is on a private network',
      });
      expect(row?.data).toMatchObject({ public: 0, unknown: 0, required_public: 0 });
      expect(row?.data.private).toBeGreaterThanOrEqual(6);
    }, 30000);
  });

  describe('no secret material', () => {
    it.each(['online', 'air-gapped'] as const)(
      'puts no URL path, query, userinfo, key or password on the wire (%s)',
      async (network) => {
        const { text, row } = await report(network, PUBLIC_EVERYTHING);

        for (const secret of Object.values(SECRETS)) expect(text).not.toContain(secret);
        expect(text).not.toContain('acme-files');
        expect(text).not.toMatch(/\/v1|fcm\/send|\?key=|https?:\/\//);
        for (const value of Object.values(row?.data ?? {})) {
          expect(['string', 'number', 'boolean'].includes(typeof value) || value === null).toBe(true);
        }
      },
      30000,
    );

    it('leaves no secret in the full inventory either (what a support bundle would read)', async () => {
      arrange(PUBLIC_EVERYTHING);
      const deps = await describeEgress(context.module.get(EgressRegistry));
      const text = JSON.stringify(deps);

      for (const secret of Object.values(SECRETS)) expect(text).not.toContain(secret);
      expect(text).not.toMatch(/\/v1|fcm\/send|\?key=|:\/\/|:9000|:11434/);
      // Every entry carries bare hostnames, each classified by shape alone.
      for (const dep of deps) {
        for (const host of dep.hosts) expect(classifyHost(host)).not.toBe('unknown');
        if (dep.hosts.length > 0) {
          const scopes = dep.hosts.map((host) => classifyHost(host));
          expect(dep.scope).toBe(scopes.includes('public') ? 'public' : 'private');
        }
      }
    });
  });

  describe('no network I/O', () => {
    it('answers with fetch, dns.lookup and net.connect stubbed to throw', async () => {
      arrange(PUBLIC_EVERYTHING);
      useNetwork('air-gapped');
      const boom = () => {
        throw new Error('network I/O attempted from the egress inventory');
      };
      const stubs = [
        jest.spyOn(globalThis, 'fetch').mockImplementation(boom),
        jest.spyOn(dns, 'lookup').mockImplementation(boom as never),
        jest.spyOn(dns.promises, 'lookup').mockImplementation(boom as never),
        jest.spyOn(net, 'connect').mockImplementation(boom as never),
        jest.spyOn(net, 'createConnection').mockImplementation(boom as never),
      ];

      const deps = await describeEgress(context.module.get(EgressRegistry), (id, message) => {
        throw new Error(`contributor ${id} failed: ${message}`);
      });
      const outcome = await context.module.get(DoctorCheckRegistry).get('network.egress')!.run();

      expect(deps.length).toBeGreaterThanOrEqual(10);
      expect(deps.every((d) => d.scope !== 'unknown' || !d.enabled)).toBe(true);
      expect(outcome.status).toBe('fail');
      for (const stub of stubs) expect(stub).not.toHaveBeenCalled();
    });
  });

  describe('wiring', () => {
    it('registers every module contributor', () => {
      expect(
        context.module
          .get(EgressRegistry)
          .list()
          .map((c) => c.id)
          .sort(),
      ).toEqual(['ai.catalog-refresh', 'ai.providers', 'ai.realtime', 'auth', 'docs', 'email', 'push', 'storage', 'telemetry']);
    });
  });
});
