// =============================================================================
// GET / PATCH /api/org-settings over HTTP (issue #733, PP-8.1)
// =============================================================================
//
// The RBAC matrix (org_settings:read|write, held through org_admin), the
// If-Match 409, and the 400s for a namespace without an org block or one the
// registry does not know. The org-overridable namespaces are the reference
// app's examples (`platform-extensions/settings/examples/`), registered for
// the duration of the suite; the org table is an in-memory map behind the
// mocked client, keyed by organization.
// =============================================================================

import request from 'supertest';
import { withTemporaryEntries } from '@marinoscar/platform-api/core';
import { systemSettingsNamespaceRegistry } from '@marinoscar/platform-api/settings';

import { ORG_OVERRIDABLE_EXAMPLES } from '../../src/platform-extensions/settings/examples/org-overridable.namespaces';
import { TestContext, createTestApp, closeTestApp } from '../helpers/test-app.helper';
import { prismaMock, resetPrismaMock } from '../mocks/prisma.mock';
import { setupBaseMocks } from '../fixtures/mock-setup.helper';
import { MOCK_DEFAULT_ORG_ID } from '../fixtures/test-data.factory';
import {
  authHeader,
  createMockAdminUser,
  createMockContributorUser,
  createMockViewerUser,
} from '../helpers/auth-mock.helper';

type Row = { id: string; orgId: string; value: unknown; version: number; updatedByUserId: string | null; updatedAt: Date };

describe('Organization settings (/api/org-settings)', () => {
  let context: TestContext;
  let rows: Map<string, Row>;

  beforeAll(async () => {
    context = await createTestApp({ useMockDatabase: true });
  });

  afterAll(async () => {
    await closeTestApp(context);
  });

  beforeEach(() => {
    resetPrismaMock();
    setupBaseMocks();
    rows = new Map();
    const orgSettings = prismaMock.orgSettings as unknown as Record<string, jest.Mock>;
    orgSettings.findUnique.mockImplementation(async ({ where }: { where: { orgId: string } }) => rows.get(where.orgId) ?? null);
    orgSettings.create.mockImplementation(async ({ data }: { data: Omit<Row, 'id' | 'version' | 'updatedAt'> }) => {
      const row: Row = { id: 'org-settings-1', version: 1, updatedAt: new Date(), ...data };
      rows.set(data.orgId, row);
      return row;
    });
    orgSettings.update.mockImplementation(async ({ where, data }: { where: { orgId: string }; data: { value: unknown } }) => {
      const current = rows.get(where.orgId)!;
      const row: Row = { ...current, value: data.value, version: current.version + 1, updatedAt: new Date() };
      rows.set(where.orgId, row);
      return row;
    });
    (prismaMock.auditEvent.create as jest.Mock).mockResolvedValue({ id: 'audit-1' });
  });

  const server = () => context.app.getHttpServer();
  const withExamples = (fn: () => Promise<void>) => () =>
    withTemporaryEntries(systemSettingsNamespaceRegistry, ORG_OVERRIDABLE_EXAMPLES, fn);

  describe('RBAC', () => {
    it('answers 401 without a session', async () => {
      await request(server()).get('/api/org-settings').expect(401);
      await request(server()).patch('/api/org-settings').send({}).expect(401);
    });

    it.each([
      ['a contributor', createMockContributorUser],
      ['a viewer', createMockViewerUser],
    ])('answers 403 to %s on GET and PATCH', async (_name, create) => {
      const user = await create(context);
      await request(server()).get('/api/org-settings').set(authHeader(user.accessToken)).expect(403);
      await request(server())
        .patch('/api/org-settings')
        .set(authHeader(user.accessToken))
        .send({ workspaceLabel: { label: 'x' } })
        .expect(403);
    });

    it(
      'serves the org admin the active organization, at version 0 until it writes',
      withExamples(async () => {
        const admin = await createMockAdminUser(context);
        const response = await request(server()).get('/api/org-settings').set(authHeader(admin.accessToken)).expect(200);
        expect(response.body.data).toMatchObject({
          orgId: MOCK_DEFAULT_ORG_ID,
          value: {},
          version: 0,
          effective: { exportPolicy: { enabled: true, maxRows: 10_000 }, workspaceLabel: { label: 'Workspace', accent: 'blue' } },
        });
        // `notifications` is the reference app's own org-overridable namespace
        // since #738 (an org may only tighten the browser policy); the two
        // examples follow it.
        expect(response.body.data.namespaces.map((n: { key: string }) => n.key)).toEqual([
          'notifications',
          'exportPolicy',
          'workspaceLabel',
        ]);
        expect(response.body.data.effective.notifications).toEqual({ browserEnabled: true, disabledEvents: [] });
      }),
    );
  });

  describe('PATCH', () => {
    it(
      'writes the override, resolves the effective value and bumps the version',
      withExamples(async () => {
        const admin = await createMockAdminUser(context);
        const response = await request(server())
          .patch('/api/org-settings')
          .set(authHeader(admin.accessToken))
          .set('If-Match', '0')
          .send({ exportPolicy: { enabled: false, maxRows: 50 }, workspaceLabel: { label: 'Acme' } })
          .expect(200);
        expect(response.body.data).toMatchObject({
          version: 1,
          value: { exportPolicy: { enabled: false, maxRows: 50 }, workspaceLabel: { label: 'Acme' } },
          effective: { exportPolicy: { enabled: false, maxRows: 50 }, workspaceLabel: { label: 'Acme', accent: 'blue' } },
        });
        expect(prismaMock.auditEvent.create).toHaveBeenCalledWith({
          data: expect.objectContaining({ action: 'org_settings:patch', orgId: MOCK_DEFAULT_ORG_ID, targetType: 'org_settings' }),
        });
      }),
    );

    it(
      'answers 409 to a stale If-Match and changes nothing',
      withExamples(async () => {
        const admin = await createMockAdminUser(context);
        await request(server()).patch('/api/org-settings').set(authHeader(admin.accessToken)).send({ workspaceLabel: { label: 'One' } }).expect(200);
        await request(server())
          .patch('/api/org-settings')
          .set(authHeader(admin.accessToken))
          .set('If-Match', '0')
          .send({ workspaceLabel: { label: 'Two' } })
          .expect(409);
        expect(rows.get(MOCK_DEFAULT_ORG_ID)?.value).toEqual({ workspaceLabel: { label: 'One' } });
      }),
    );

    it.each([
      ['a namespace without an org block', { jobs: { stuckThresholdMinutes: 5 } }],
      ['an unknown namespace', { nope: { a: 1 } }],
      ['a field the namespace does not let an organization set', { workspaceLabel: { color: 'red' } }],
      ['an invalid value', { exportPolicy: { maxRows: -1 } }],
    ])('answers 400 to %s', async (_name, body) => {
      await withExamples(async () => {
        const admin = await createMockAdminUser(context);
        await request(server()).patch('/api/org-settings').set(authHeader(admin.accessToken)).send(body).expect(400);
        expect(rows.size).toBe(0);
      })();
    });

    it(
      'never lets an organization loosen a tighten namespace',
      withExamples(async () => {
        const admin = await createMockAdminUser(context);
        const response = await request(server())
          .patch('/api/org-settings')
          .set(authHeader(admin.accessToken))
          .send({ exportPolicy: { maxRows: 999_999 } })
          .expect(200);
        expect(response.body.data.effective.exportPolicy).toEqual({ enabled: true, maxRows: 10_000 });
      }),
    );
  });
});
