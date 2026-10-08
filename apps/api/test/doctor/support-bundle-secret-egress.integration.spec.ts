// =============================================================================
// Support bundle secret no-egress (issue #772)
// =============================================================================
//
// The pattern of `test/ai/ai-secret-egress.integration.spec.ts`: seed a
// DISTINCT sentinel for every kind of secret the deployment holds, build a
// bundle through the real AppModule, and assert that no sentinel appears
// anywhere in the file, raw or encoded (base64, base64url, hex), nor in the
// download's audit row.
//
// Where each sentinel lives:
//   - JWT_SECRET and SECRETS_ENCRYPTION_KEY: the process environment, set
//     before the app loads;
//   - the VAPID private key, the SMTP password, the AI org key, the GreptimeDB
//     reader and admin passwords and the storage secret key: the encrypted
//     credential store (`CredentialsService.getSecret`, by purpose);
//   - a user's BYOK key: the per-user store (`UserCredentialsService.getSecret`);
//   - a PAT, a node token, a user's email, a user id and an IP address: the
//     `detail`, `error` and `data` of a deliberately leaky doctor check a test
//     module registers (a check that breaks rule 4), and the telemetry
//     verdict reasons. Here the CENTRAL REDACTION PASS is what stands between
//     them and the file.
// =============================================================================

import { randomBytes } from 'node:crypto';

// Set before the app (and `secret-cipher.ts`'s key cache) is loaded.
const JWT_SECRET = `jwt-${randomBytes(24).toString('base64url')}`;
const ENCRYPTION_KEY = randomBytes(32).toString('base64');
const ORIGINAL_ENV = { JWT_SECRET: process.env.JWT_SECRET, SECRETS_ENCRYPTION_KEY: process.env.SECRETS_ENCRYPTION_KEY };
process.env.JWT_SECRET = JWT_SECRET;
process.env.SECRETS_ENCRYPTION_KEY = ENCRYPTION_KEY;

import { Injectable, Module, OnModuleInit } from '@nestjs/common';
import request from 'supertest';

import { supportBundleSchema } from '@marinoscar/platform-contract/doctor';
import { DoctorCheckRegistry, DoctorService } from '@marinoscar/platform-api/doctor';

import { CredentialsService, UserCredentialsService } from '@marinoscar/platform-api/credentials';
import {
  GreptimeClient,
  TelemetrySettingsService,
} from '@marinoscar/platform-api/telemetry';
import { telemetryProviders } from '../../src/platform/telemetry/telemetry.config';
import { TestContext, closeTestApp, createTestApp } from '../helpers/test-app.helper';
import { resetPrismaMock } from '../mocks/prisma.mock';
import { setupBaseMocks } from '../fixtures/mock-setup.helper';
import { authHeader, createMockAdminUser } from '../helpers/auth-mock.helper';

const { TelemetryDashboardService, TelemetryStackService, TelemetryStatusService } = telemetryProviders;

const secret = (label: string) => `${label}-${randomBytes(18).toString('base64url')}`;

/** The credential store's secrets, by purpose (and name, for GreptimeDB). */
const STORE = {
  push_vapid: secret('vapid-private'),
  smtp: secret('smtp-password'),
  ai: secret('sk-org'),
  storage: secret('storage-secret-key'),
  greptimeReader: secret('greptime-reader'),
  greptimeAdmin: secret('greptime-admin'),
};
const BYOK_KEY = secret('sk-user-byok');
const PAT = `pat_${randomBytes(32).toString('hex')}`;
const NODE_TOKEN = `nod_${randomBytes(32).toString('hex')}`;
const USER_EMAIL = 'jane.customer@customer.example';
const USER_ID = '3f2b8c1e-9d4a-4e6b-a1c2-7d8e9f0a1b2c';
const IP_ADDRESS = '203.0.113.47';

const SENTINELS: Record<string, string> = {
  JWT_SECRET,
  SECRETS_ENCRYPTION_KEY: ENCRYPTION_KEY,
  'VAPID private key': STORE.push_vapid,
  'SMTP password': STORE.smtp,
  'AI org key': STORE.ai,
  'user BYOK key': BYOK_KEY,
  'GreptimeDB reader password': STORE.greptimeReader,
  'GreptimeDB admin password': STORE.greptimeAdmin,
  'storage secret key': STORE.storage,
  PAT,
  'node token': NODE_TOKEN,
  'user email': USER_EMAIL,
  'user id': USER_ID,
  'IP address': IP_ADDRESS,
};

/** Every encoding a value could leak in. */
function encodings(value: string): string[] {
  const forms = [value, Buffer.from(value).toString('base64'), Buffer.from(value).toString('base64url'), Buffer.from(value).toString('hex')];
  // A base64 key also leaks as its raw bytes in hex.
  if (/^[A-Za-z0-9+/]+={0,2}$/.test(value) && value.length % 4 === 0) forms.push(Buffer.from(value, 'base64').toString('hex'));
  return forms.map((form) => form.replace(/=+$/, ''));
}

/** A check that breaks rule 4 on purpose: everything it must never return. */
@Injectable()
class LeakyDoctorCheck implements OnModuleInit {
  readonly id = 'test.leaky';
  readonly category = 'core';
  readonly label = 'Leaky test check';

  constructor(private readonly registry: DoctorCheckRegistry) {}

  onModuleInit(): void {
    this.registry.register(this as never);
  }

  async run() {
    return {
      status: 'warn' as const,
      detail: `user ${USER_EMAIL} (${USER_ID}) from ${IP_ADDRESS} used ${PAT}; node ${NODE_TOKEN}`,
      remedy: `Revoke ${PAT} and rotate ${NODE_TOKEN}.`,
      error: `Authorization: Bearer ${PAT}`,
      data: { userId: USER_ID, email: USER_EMAIL, ip: IP_ADDRESS, token: NODE_TOKEN },
    };
  }
}

@Module({ providers: [LeakyDoctorCheck] })
class LeakyCheckModule {}

describe('Support bundle: no secret egress (Integration)', () => {
  let context: TestContext;

  beforeAll(async () => {
    context = await createTestApp({ useMockDatabase: true, imports: [LeakyCheckModule] });
  }, 60000);

  afterAll(async () => {
    await closeTestApp(context);
    for (const [key, value] of Object.entries(ORIGINAL_ENV)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  beforeEach(() => {
    resetPrismaMock();
    setupBaseMocks();
    context.prismaMock.$queryRaw.mockResolvedValue([{ '?column?': 1 }]);
    context.module.get(DoctorService).invalidate();
    jest.restoreAllMocks();
  });

  const get = <T>(token: abstract new (...args: never[]) => T) => context.module.get(token as never, { strict: false }) as T;

  function seedStores() {
    jest.spyOn(get(CredentialsService), 'getSecret').mockImplementation(async (purpose: string, name: string) => {
      if (purpose === 'telemetry_greptime') return /admin/i.test(name) ? STORE.greptimeAdmin : STORE.greptimeReader;
      return (STORE as Record<string, string>)[purpose] ?? null;
    });
    jest.spyOn(get(UserCredentialsService), 'getSecret').mockResolvedValue(BYOK_KEY);
  }

  function telemetryOn() {
    jest.spyOn(get(GreptimeClient), 'isConfigured').mockReturnValue(true);
    jest.spyOn(get(TelemetrySettingsService), 'getPolicy').mockResolvedValue({ enabled: true } as never);
    jest.spyOn(get(TelemetryStatusService), 'getStatus').mockResolvedValue({
      configured: true,
      reachable: true,
      version: '0.17.0',
      database: 'public',
      ttl: { raw: '30days', days: 30 },
      retentionDays: 30,
      tables: [],
      error: `login as reader from ${IP_ADDRESS} failed`,
    });
    jest.spyOn(get(TelemetryStackService), 'getStatus').mockResolvedValue({ agent: 'not_configured', agentError: null, services: [], deploy: null });
    jest.spyOn(get(TelemetryDashboardService), 'summary').mockResolvedValue({
      range: { from: '2026-10-05T00:00:00.000Z', to: '2026-10-06T00:00:00.000Z', bucketSeconds: 2880 },
      truncated: false,
      sql: [`SELECT 1 -- ${STORE.greptimeAdmin}`],
      verdict: { level: 'critical', reasons: [`5xx spike for ${USER_EMAIL} from ${IP_ADDRESS}`] },
      tiles: [],
    } as never);
  }

  it('puts no seeded secret or personal value in the bundle or the audit row, raw or encoded', async () => {
    seedStores();
    const admin = await createMockAdminUser(context);
    // The leaky check runs once, through the real Doctor, with the stores seeded.
    await context.module.get(DoctorService).run({ refresh: true });
    telemetryOn();
    const create = context.prismaMock.auditEvent.create as jest.Mock;
    create.mockClear();

    const response = await request(server()).get('/api/admin/doctor/support-bundle').set(authHeader(admin.accessToken));
    const text = typeof response.text === 'string' && response.text !== '' ? response.text : JSON.stringify(response.body);

    expect(response.status).toBe(200);
    const bundle = supportBundleSchema.parse(JSON.parse(text));

    // The leaky check reached the file, scrubbed.
    const checks = (bundle.sections.doctor as { data: { checks: Array<Record<string, unknown>> } }).data.checks;
    const leaky = checks.find((check) => check.id === 'test.leaky');
    expect(leaky).toMatchObject({
      detail: 'user [email] ([redacted]) from [ip] used [token]; node [token]',
      error: 'Authorization: Bearer [redacted]',
      data: { userId: '[redacted]', email: '[email]', ip: '[ip]', token: '[redacted]' },
    });
    expect(bundle.sections.telemetry.status).toBe('ok');
    expect(bundle.redaction.replacements).toBeGreaterThanOrEqual(10);

    const audit = JSON.stringify(create.mock.calls.map(([args]) => args.data));
    const haystacks = { body: text, headers: JSON.stringify(response.headers), audit };
    expect(audit).toContain('support_bundle:download');
    const leaks: string[] = [];
    for (const [name, value] of Object.entries({ ...SENTINELS, 'access token': admin.accessToken, 'admin email': admin.email, 'admin id': admin.id })) {
      for (const form of encodings(value)) {
        for (const [where, haystack] of Object.entries(haystacks)) {
          // The audit row names its actor by id, by design (never by email).
          if (name === 'admin id' && where === 'audit') continue;
          if (haystack.includes(form)) leaks.push(`${name} in ${where}`);
        }
      }
    }
    expect(leaks).toEqual([]);
  }, 30000);

  const server = () => context.app.getHttpServer();
});
