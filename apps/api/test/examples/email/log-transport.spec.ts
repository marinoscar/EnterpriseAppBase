// =============================================================================
// The `log` example: an app adds an email transport WITHOUT touching a package (PP-14.8)
// =============================================================================
//
// `apps/api/src/platform-extensions/email/log-transport.ts` is registered from
// `app-registrations/email.ts` with `registerEmailTransport`, the same function
// `ses` and `smtp` use. This spec proves the whole story the issue lists,
// against the REAL application wiring (the real EmailModule, settings service,
// resolver, notification channel, Doctor check and egress contributor; only
// Prisma and the credential store are mocked):
//
//   1. the transport passes the email transport conformance kit;
//   2. it is listed beside the built-ins with a generated form, and OFF until
//      selected: a fresh install keeps its transport;
//   3. an administrator selects it through `PUT /api/email-settings`, secret
//      included, and the secret is write-only;
//   4. the admin "Send test email" goes through it, naming it by its label;
//   5. a notification with an email channel is delivered through it;
//   6. the Doctor and the network-egress view name it by its label;
//   7. a failure comes back as a result with the credential redacted, and
//      selecting a transport nobody registered is a 400.
// =============================================================================

import request from 'supertest';

import { CredentialsService } from '@marinoscar/platform-api/credentials';
import { EmailConfigDoctorCheck, EmailEgressContributor, emailTransportIds, getEmailTransport } from '@marinoscar/platform-api/email';
import { NotificationsService } from '@marinoscar/platform-api/notifications';
import { describeEmailTransportConformance, type ReceivedEmail } from '@marinoscar/platform-api/email/testing';

import {
  LOG_TRANSPORT_ID,
  logEmailTransport,
  logTransportRecorder,
  maskAddress,
} from '../../../src/platform-extensions/email/log-transport';
// The registration under test: what `platform/email/email.config.ts` imports.
import '../../../src/app-registrations/email';
import { setupBaseMocks } from '../../fixtures/mock-setup.helper';
import { authHeader, createMockAdminUser } from '../../helpers/auth-mock.helper';
import { closeTestApp, createTestApp, type TestContext } from '../../helpers/test-app.helper';
import { prismaMock, resetPrismaMock } from '../../mocks/prisma.mock';

const SINK_TOKEN = 'sink-token-Zq81-NEVER-LOGGED-0001';

const received = (): ReceivedEmail[] =>
  logTransportRecorder.sent.map((message) => ({
    to: message.to,
    from: message.from,
    subject: message.subject,
    html: message.html,
    text: message.text,
    headers: message.headers,
    attachments: message.attachments?.map((part) => ({
      filename: part.filename,
      contentType: part.contentType,
      contentBase64: part.contentBase64,
      contentId: part.contentId,
      disposition: part.disposition,
    })),
  }));

// ---- 1. the conformance kit -------------------------------------------------------------

beforeEach(() => logTransportRecorder.reset());

describeEmailTransportConformance(LOG_TRANSPORT_ID, {
  describe,
  it,
  expect,
  settings: { keep: 5 },
  secrets: { sinkToken: SINK_TOKEN },
  backend: {
    accept: () => {
      logTransportRecorder.reset();
      return received;
    },
    failWith: (error) => {
      logTransportRecorder.failure = error;
    },
  },
});

describe('log transport helpers', () => {
  it('masks the local part of an address and keeps the domain', () => {
    expect(maskAddress('jane.doe@example.test')).toBe('j***@example.test');
    expect(maskAddress('nonsense')).toBe('***');
  });
});

// ---- 2 to 7. the real application ---------------------------------------------------

describe('log, selected by an administrator, serves every email consumer', () => {
  let context: TestContext;
  let stored: { value: Record<string, unknown>; version: number } | null;
  const server = () => context.app.getHttpServer();
  const credentials = { describe: jest.fn(), setSecret: jest.fn(), getSecret: jest.fn(), deleteSecret: jest.fn() };

  beforeAll(async () => {
    context = await createTestApp({ useMockDatabase: true, overrideProviders: [{ provide: CredentialsService, useValue: credentials }] });
  });

  afterAll(async () => {
    await closeTestApp(context);
  });

  beforeEach(() => {
    resetPrismaMock();
    setupBaseMocks();
    logTransportRecorder.reset();

    credentials.describe.mockReset().mockResolvedValue(null);
    credentials.setSecret.mockReset().mockResolvedValue(undefined);
    credentials.getSecret.mockReset().mockImplementation(async (purpose: string, name: string) => (purpose === 'email_log' && name === 'sinkToken' ? SINK_TOKEN : null));

    // A stateful `email` row (key 'email'): a fresh install, nothing stored.
    stored = null;
    const rowOf = (key: string, value: Record<string, unknown>, version: number) => ({
      id: `settings-${key}`,
      key,
      value,
      version,
      updatedAt: new Date('2026-03-03T00:00:00.000Z'),
      updatedByUserId: 'admin-1',
      updatedByUser: { id: 'admin-1', email: 'admin@example.com' },
    });
    prismaMock.systemSettings.findUnique.mockImplementation(async ({ where }: { where: { key: string } }) =>
      where.key === 'email' ? (stored ? rowOf('email', stored.value, stored.version) : null) : rowOf(where.key, {}, 1),
    );
    prismaMock.systemSettings.upsert.mockImplementation(async ({ where, create, update }: { where: { key: string }; create: { value: Record<string, unknown> }; update: { value: Record<string, unknown> } }) => {
      if (where.key !== 'email') return rowOf(where.key, update.value, 2);
      stored = { value: stored ? update.value : create.value, version: (stored?.version ?? 0) + 1 };
      return rowOf('email', stored.value, stored.version);
    });
    prismaMock.auditEvent.create.mockResolvedValue({} as never);
    // The bookkeeping writes of a notification dispatch.
    (prismaMock.notificationDelivery.create as jest.Mock).mockResolvedValue({ id: 'delivery-1' });
    (prismaMock.notificationDelivery.update as jest.Mock).mockResolvedValue({});
    (prismaMock.notification.create as jest.Mock).mockResolvedValue({ id: 'notification-1', createdAt: new Date('2026-01-01T00:00:00.000Z') });
  });

  const adminView = async () => {
    const admin = await createMockAdminUser(context);
    return (await request(server()).get('/api/email-settings').set(authHeader(admin.accessToken)).expect(200)).body.data;
  };

  /** Selects the transport the way the admin page does. */
  async function selectLog(extra: Record<string, unknown> = {}) {
    const admin = await createMockAdminUser(context);
    return request(server())
      .put('/api/email-settings')
      .set(authHeader(admin.accessToken))
      .send({
        provider: LOG_TRANSPORT_ID,
        enabled: true,
        fromAddress: 'no-reply@example.test',
        transports: { [LOG_TRANSPORT_ID]: { keep: 5 } },
        secrets: { [LOG_TRANSPORT_ID]: { sinkToken: SINK_TOKEN } },
        ...extra,
      })
      .expect(200);
  }

  it('is registered after the built-ins, listed with a generated form, and OFF until selected', async () => {
    expect(emailTransportIds()).toEqual(['ses', 'smtp', LOG_TRANSPORT_ID]);
    expect(getEmailTransport(LOG_TRANSPORT_ID)).toBe(logEmailTransport);

    const view = await adminView();

    // A fresh install has no transport chosen; the example only appears in the list.
    expect(view).toMatchObject({ provider: null, enabled: false, settingsError: null });
    expect(view.descriptors.map((d: { id: string }) => d.id)).toEqual(['ses', 'smtp', LOG_TRANSPORT_ID]);
    const descriptor = view.descriptors.find((d: { id: string }) => d.id === LOG_TRANSPORT_ID);
    expect(descriptor).toMatchObject({ kind: 'email-transport', id: LOG_TRANSPORT_ID, label: 'Log (in memory)' });
    expect(descriptor.fields).toEqual([
      expect.objectContaining({ name: 'keep', kind: 'number', min: 1, max: 1000, integer: true, label: 'Messages kept' }),
      expect.objectContaining({ name: 'sinkToken', kind: 'secret', hasValue: false, required: false }),
    ]);
    expect(view.transports[LOG_TRANSPORT_ID]).toEqual({ keep: 100 });
  });

  it('is selected through the admin route; the secret is stored at (email_log, sinkToken) and never echoed', async () => {
    const response = await selectLog();

    expect(credentials.setSecret).toHaveBeenCalledWith('email_log', 'sinkToken', SINK_TOKEN, { label: 'Sink token', updatedByUserId: expect.any(String) });
    expect(response.body.data).toMatchObject({ provider: LOG_TRANSPORT_ID, enabled: true, transports: { log: { keep: 5 } } });
    expect(JSON.stringify(response.body)).not.toContain(SINK_TOKEN);
    expect(JSON.stringify(prismaMock.auditEvent.create.mock.calls)).not.toContain(SINK_TOKEN);
    // The stored row carries the settings, never the secret.
    expect(stored?.value).toEqual({ provider: 'log', enabled: true, fromAddress: 'no-reply@example.test', transports: { log: { keep: 5 } } });
  });

  it('sends the admin test email through it, naming it by its label', async () => {
    await selectLog();
    const admin = await createMockAdminUser(context);

    const tested = await request(server()).post('/api/email-settings/test').set(authHeader(admin.accessToken)).expect(200);

    expect(tested.body.data).toMatchObject({ success: true, providerKind: LOG_TRANSPORT_ID, messageId: 'log-1', error: null, sentTo: admin.email });
    expect(logTransportRecorder.sent).toHaveLength(1);
    expect(logTransportRecorder.sent[0]).toMatchObject({ to: admin.email, from: 'no-reply@example.test' });
    expect(logTransportRecorder.sent[0]!.text).toContain('Log (in memory)');
  });

  it('delivers a notification with an email channel through it', async () => {
    await selectLog();
    const admin = await createMockAdminUser(context);

    await context.module.get(NotificationsService).notifyNow('user.welcome', admin.id, { recipientEmail: admin.email, roles: ['viewer'] });

    expect(logTransportRecorder.sent).toHaveLength(1);
    expect(logTransportRecorder.sent[0]).toMatchObject({ to: admin.email, from: 'no-reply@example.test' });
    expect(logTransportRecorder.sent[0]!.subject).toBeTruthy();
  });

  it('keeps only the latest `keep` messages', async () => {
    await selectLog({ transports: { [LOG_TRANSPORT_ID]: { keep: 2 } } });
    const admin = await createMockAdminUser(context);
    const notifications = context.module.get(NotificationsService);

    for (let i = 0; i < 3; i += 1) await notifications.notifyNow('user.welcome', admin.id, { recipientEmail: admin.email, roles: ['viewer'] });

    expect(logTransportRecorder.total).toBe(3);
    expect(logTransportRecorder.sent).toHaveLength(2);
  });

  it('is named by its label in the Doctor check and the network-egress view, with no host', async () => {
    await selectLog();

    const outcome = await context.module.get(EmailConfigDoctorCheck, { strict: false }).run();
    expect(outcome).toMatchObject({ status: 'pass', data: { provider: LOG_TRANSPORT_ID } });
    expect(outcome.detail).toBe('In-memory log, keeping 5 messages, from no-reply@example.test');

    const dependencies = await context.module.get(EmailEgressContributor, { strict: false }).describe();
    expect(dependencies.map((d) => d.id)).toEqual(['email.ses', 'email.smtp', 'email.log']);
    expect(dependencies.find((d) => d.id === 'email.log')).toMatchObject({ capability: 'Email (in-memory log)', enabled: true, hosts: [] });
    expect(dependencies.filter((d) => d.enabled)).toHaveLength(1);
  });

  it('reports a failed send as a result with the credential redacted, never as an error', async () => {
    await selectLog();
    const admin = await createMockAdminUser(context);
    logTransportRecorder.failure = new Error(`upstream rejected token ${SINK_TOKEN}`);

    const tested = await request(server()).post('/api/email-settings/test').set(authHeader(admin.accessToken)).expect(200);

    expect(tested.body.data).toMatchObject({ success: false, providerKind: LOG_TRANSPORT_ID });
    expect(tested.body.data.error).toContain('Log: upstream rejected token [redacted]');
    expect(JSON.stringify(tested.body)).not.toContain(SINK_TOKEN);
  });

  it('refuses to select a transport nobody registered, naming the registered ones', async () => {
    const admin = await createMockAdminUser(context);

    const refused = await request(server())
      .put('/api/email-settings')
      .set(authHeader(admin.accessToken))
      .send({ provider: 'carrier-pigeon', enabled: true })
      .expect(400);

    expect(JSON.stringify(refused.body)).toContain('Registered: ses, smtp, log');
    expect(stored).toBeNull();
  });
});
