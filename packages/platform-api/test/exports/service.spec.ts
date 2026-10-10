import { BadRequestException, ForbiddenException, HttpException, NotFoundException } from '@nestjs/common';
import { z } from 'zod';

import {
  BUILTIN_EXPORT_WRITERS,
  EXPORT_RUN_JOB_TYPE,
  ExportsService,
  ORG_DATA_EXPORT_SOURCE,
  USER_DATA_EXPORT_SOURCE,
  registerExportSource,
  registerExportWriter,
  resolveExportsModuleOptions,
  type ExportPrincipal,
  type ExportResult,
} from '../../src/exports';
import { FIXTURE_DATAMODEL, UUID, fakeDb } from './support';

for (const writer of BUILTIN_EXPORT_WRITERS) registerExportWriter(writer);
registerExportSource(USER_DATA_EXPORT_SOURCE);
registerExportSource(ORG_DATA_EXPORT_SOURCE);
registerExportSource({
  id: 'ranged',
  scope: 'user',
  label: 'Ranged',
  permission: 'ranged:read',
  requestSchema: z.object({ from: z.iso.date() }).strict(),
  formats: ['csv'],
  collect: async function* () {},
});

const NOW = new Date('2026-10-08T10:00:00.000Z');
const member: ExportPrincipal = { id: UUID.user, permissions: ['user_settings:read'], activeOrgId: UUID.orgA };
const orgAdmin: ExportPrincipal = { id: UUID.other, permissions: ['user_settings:read', 'org_members:read'], activeOrgId: UUID.orgA };
const sysAdmin: ExportPrincipal = { id: '55555555-5555-4555-8555-555555555555', permissions: ['organizations:read'], activeOrgId: UUID.orgB };

const result: ExportResult = {
  storageObjectId: UUID.object,
  fileName: 'app-user-data-2026-10-08.zip',
  mimeType: 'application/zip',
  sizeBytes: 10,
  rowCounts: { account: 1 },
  completedAt: NOW.toISOString(),
  expiresAt: new Date(NOW.getTime() + 86_400_000).toISOString(),
};

function setup(options: { inFlight?: number; jobs?: Array<Record<string, any>>; objects?: Array<Record<string, any>> } = {}) {
  const jobs = options.jobs ?? [];
  const enqueue = jest.fn(async (input: Record<string, any>) => ({
    id: UUID.job,
    status: 'pending',
    payload: input.payload,
    createdAt: NOW,
    finishedAt: null,
  }));
  const prisma = {
    job: {
      count: jest.fn(async () => options.inFlight ?? 0),
      findMany: jest.fn(async () => jobs),
      findFirst: jest.fn(async (args: { where: { id: string } }) => jobs.find((j) => j.id === args.where.id) ?? null),
    },
  };
  const system = fakeDb({ storageObject: options.objects ?? [], organization: [{ id: UUID.orgA }, { id: UUID.orgB }] });
  const storage = { getSignedDownloadUrl: jest.fn(async () => 'https://bucket.example.test/signed') };
  const service = new ExportsService(
    prisma as never,
    { enqueue } as never,
    storage as never,
    { asSystem: () => system } as never,
    resolveExportsModuleOptions({ datamodel: FIXTURE_DATAMODEL }),
  );
  service.now = () => NOW;
  return { service, prisma, enqueue, storage };
}

function job(payload: Record<string, unknown>, status = 'succeeded') {
  return { id: UUID.job, status, payload, createdAt: NOW, finishedAt: NOW, subjectType: 'user', subjectId: payload.subjectId };
}

describe('ExportsService', () => {
  it('lists the sources the caller holds the permission for, with formats and fields', () => {
    const { service } = setup();
    expect(service.sources(member).items.map((s) => s.id)).toEqual(['user-data']);
    const admin = service.sources(orgAdmin).items;
    expect(admin.map((s) => s.id)).toEqual(['user-data', 'org-data']);
    expect(admin[0]!.formats.map((f) => f.id)).toEqual(['json', 'csv', 'xlsx']);
    expect(admin[1]).toMatchObject({ scope: 'org', crossOrg: false, fields: [] });
    expect(service.sources(sysAdmin).items.find((s) => s.id === 'org-data')!.crossOrg).toBe(true);
    expect(service.sources({ ...member, permissions: ['user_settings:read', 'ranged:read'] }).items[1]!.fields).toEqual([
      { key: 'from', label: 'From', kind: 'date', required: true },
    ]);
  });

  it('queues a user export: 202 payload, subject user:<id>, skipDedup, the active organization', async () => {
    const { service, enqueue } = setup();
    const view = await service.create(member, { source: 'user-data', format: 'json', request: {} });
    expect(view).toMatchObject({ id: UUID.job, status: 'pending', source: 'user-data', format: 'json', scope: 'user', download: null });
    expect(enqueue).toHaveBeenCalledWith({
      type: EXPORT_RUN_JOB_TYPE,
      reason: 'rerun',
      subjectType: 'user',
      subjectId: UUID.user,
      payload: { source: 'user-data', format: 'json', request: {}, requestedById: UUID.user, scope: 'user', subjectId: UUID.user, orgId: UUID.orgA },
      skipDedup: true,
      orgId: UUID.orgA,
    });
  });

  it('400 for an unknown source, an unknown format and a request the source refuses', async () => {
    const { service } = setup();
    await expect(service.create(member, { source: 'nope', format: 'json', request: {} })).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.create(member, { source: 'user-data', format: 'pdf', request: {} })).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.create(member, { source: 'user-data', format: 'json', request: { extra: 1 } })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    const ranged = { ...member, permissions: ['ranged:read'] };
    await expect(service.create(ranged, { source: 'ranged', format: 'csv', request: { from: 'yesterday' } })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it("403 without the source's permission", async () => {
    const { service } = setup();
    await expect(service.create({ ...member, permissions: [] }, { source: 'user-data', format: 'json', request: {} })).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    await expect(service.create(member, { source: 'org-data', format: 'json', request: {} })).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('429 over the in-flight cap per subject', async () => {
    const { service, prisma } = setup({ inFlight: 3 });
    const error = await service.create(member, { source: 'user-data', format: 'csv', request: {} }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(HttpException);
    expect((error as HttpException).getStatus()).toBe(429);
    expect(prisma.job.count).toHaveBeenCalledWith({
      where: { type: EXPORT_RUN_JOB_TYPE, subjectType: 'user', subjectId: UUID.user, status: { in: ['pending', 'running'] } },
    });
  });

  it("org-data: the org admin exports the active organization; another needs organizations:read; an unknown one is 404", async () => {
    const { service, enqueue } = setup();
    await service.create(orgAdmin, { source: 'org-data', format: 'xlsx', request: {} });
    expect(enqueue).toHaveBeenLastCalledWith(expect.objectContaining({ subjectType: 'organization', subjectId: UUID.orgA, orgId: UUID.orgA }));

    await expect(service.create(orgAdmin, { source: 'org-data', format: 'json', request: {}, orgId: UUID.orgB })).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    await service.create(sysAdmin, { source: 'org-data', format: 'json', request: {}, orgId: UUID.orgA });
    expect(enqueue).toHaveBeenLastCalledWith(expect.objectContaining({ subjectId: UUID.orgA }));
    await expect(
      service.create(sysAdmin, { source: 'org-data', format: 'json', request: {}, orgId: '66666666-6666-4666-8666-666666666666' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it("get: ready with a 5-minute signed URL and a Content-Disposition; another user's export is a 404", async () => {
    const payload = { source: 'user-data', format: 'csv', request: {}, requestedById: UUID.user, scope: 'user', subjectId: UUID.user, orgId: UUID.orgA, result };
    const { service, storage } = setup({
      jobs: [job(payload)],
      objects: [{ id: UUID.object, status: 'ready', storageKey: `exports/users/${UUID.user}/${UUID.job}.zip` }],
    });
    const view = await service.get(member, UUID.job);
    expect(view.status).toBe('ready');
    expect(view.download).toEqual({ url: 'https://bucket.example.test/signed', expiresAt: '2026-10-08T10:05:00.000Z' });
    expect(storage.getSignedDownloadUrl).toHaveBeenCalledWith(`exports/users/${UUID.user}/${UUID.job}.zip`, {
      expiresIn: 300,
      responseContentDisposition: 'attachment; filename="app-user-data-2026-10-08.zip"',
    });

    await expect(service.get({ ...orgAdmin, id: '77777777-7777-4777-8777-777777777777' }, UUID.job)).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.get(member, '88888888-8888-4888-8888-888888888888')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('get: expired when the file is gone; never mints a URL for an unsafe file name', async () => {
    const payload = { source: 'user-data', format: 'csv', request: {}, requestedById: UUID.user, scope: 'user', subjectId: UUID.user, orgId: UUID.orgA, result };
    const gone = setup({ jobs: [job(payload)], objects: [] });
    expect((await gone.service.get(member, UUID.job)).status).toBe('expired');
    expect(gone.storage.getSignedDownloadUrl).not.toHaveBeenCalled();

    const unsafe = setup({
      jobs: [job({ ...payload, result: { ...result, fileName: 'evil".zip' } })],
      objects: [{ id: UUID.object, status: 'ready', storageKey: 'exports/users/x/y.zip' }],
    });
    await expect(unsafe.service.get(member, UUID.job)).rejects.toThrow(/unexpected file name/);
    expect(unsafe.storage.getSignedDownloadUrl).not.toHaveBeenCalled();
  });

  it("get: an org export is visible to that org's admin and a system admin, not to a member", async () => {
    const payload = { source: 'org-data', format: 'json', request: {}, requestedById: sysAdmin.id, scope: 'org', subjectId: UUID.orgA, orgId: UUID.orgA };
    const { service } = setup({ jobs: [job(payload, 'running')] });
    expect((await service.get(orgAdmin, UUID.job)).status).toBe('running');
    expect((await service.get(sysAdmin, UUID.job)).status).toBe('running');
    await expect(service.get(member, UUID.job)).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.get({ ...orgAdmin, activeOrgId: UUID.orgB }, UUID.job)).rejects.toBeInstanceOf(NotFoundException);
  });

  it("list: the caller's exports and the ones of their own data, newest first, at most 20", async () => {
    const payload = { source: 'user-data', format: 'json', request: {}, requestedById: UUID.user, scope: 'user', subjectId: UUID.user, orgId: UUID.orgA };
    const { service, prisma } = setup({ jobs: [job(payload, 'pending')] });
    const list = await service.list(member);
    expect(list.items.map((i) => i.status)).toEqual(['pending']);
    expect(prisma.job.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          type: EXPORT_RUN_JOB_TYPE,
          OR: [{ subjectType: 'user', subjectId: UUID.user }, { payload: { path: ['requestedById'], equals: UUID.user } }],
        },
        orderBy: { createdAt: 'desc' },
        take: 20,
      }),
    );
  });
});
