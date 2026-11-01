import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { Controller, Get, Global, Logger, Module, Req, UseGuards } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test, type TestingModule } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import {
  PlatformHostModule,
  ScopedAccessError,
  credentialKindRegistry,
  errorCodeRegistry,
  runAsSystem,
  systemAccessReasonRegistry,
} from '@marinoscar/platform-api/core';
import { describeVocabularyConformance } from '@marinoscar/platform-api/core/testing';
import { DoctorCheckRegistry, EgressRegistry } from '@marinoscar/platform-api/doctor';
import { MAINTENANCE_SYSTEM_SETTINGS, PlatformHostCoreModule } from '@marinoscar/platform-api/host';
import { SystemSettingsService } from '@marinoscar/platform-api/settings';
import { InMemoryAuditSink } from '@marinoscar/platform-api/testing';

// Registers the example entries, exactly as the application does at import time.
import { APP_ERROR_MAPPERS } from '../../../src/app-registrations/core';
import {
  API_KEY_CREDENTIAL_KIND,
  API_KEY_VERIFIER,
  ApiKeyGuard,
  RequiresApiKeyPermission,
  type ApiKeyOwner,
} from '../../../src/platform-extensions/core/api-key.credential-kind';
import { NOTE_TITLE_TAKEN, NoteTitleTakenException } from '../../../src/platform-extensions/core/note-title-taken.error-code';
import {
  TRANSCRIPT_REINDEX_REASON,
  TranscriptReindexHandler,
  type ReindexTransaction,
  type SystemWork,
} from '../../../src/platform-extensions/core/transcript-reindex.job';

// =============================================================================
// PP-14.14 — the open vocabularies, proven from the app side
// =============================================================================
//
// Four extensions, none of which edits a package:
//
//   1. a system access reason (`transcript-reindex`) used by an app job through
//      `runAsSystem`, with the proof that registering it opened WHICH reason and
//      nothing about WHO may bypass;
//   2. a credential kind (`api-key`) admitted by an app guard, with the
//      default-deny cases;
//   3. a domain error code returned by an app controller;
//   4. a Prisma `P2002` mapper -> 409, booted through the REAL
//      `PlatformHostCoreModule.forRoot({ errorMappers })` and its real filter.
// =============================================================================

describeVocabularyConformance({ describe, it, expect }, { expectedAppReasons: [TRANSCRIPT_REINDEX_REASON] });

// ---------------------------------------------------------------------------
// 1. A system access reason
// ---------------------------------------------------------------------------

/**
 * A system client that never reaches a database: the two methods `runAsSystem`
 * uses, plus the model operations the job calls on the transaction it is handed.
 */
function fakeSystemClient(stale: number) {
  const statements: string[] = [];
  const tx = {
    $executeRaw: (strings: TemplateStringsArray) => {
      statements.push(strings.join('?'));
      return Promise.resolve(1);
    },
    countStale: async () => stale,
    markIndexed: async () => stale,
  };
  // `$connect` and `$extends` make it look like a real client (not an interactive-transaction client).
  const client = {
    $connect: () => undefined,
    $extends: () => ({}),
    $executeRaw: tx.$executeRaw,
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(tx),
  };
  return { client, statements };
}

describe('a system access reason (transcript-reindex)', () => {
  it('is registered by the app, after the platform\'s nine', () => {
    expect(systemAccessReasonRegistry.ids()).toHaveLength(10);
    expect(systemAccessReasonRegistry.ids().at(-1)).toBe(TRANSCRIPT_REINDEX_REASON);
    expect(systemAccessReasonRegistry.require(TRANSCRIPT_REINDEX_REASON).description).toMatch(/re-index/);
  });

  it('an app job runs cross-organization work under it, through the allowlisted host module\'s port', async () => {
    const { client, statements } = fakeSystemClient(3);
    // What the app's allowlisted host module does with PrismaSystemService.runAsSystem.
    const system: SystemWork = { run: (reason, fn) => runAsSystem(client as never, reason, (tx) => fn(tx as unknown as ReindexTransaction)) };
    const handler = new TranscriptReindexHandler(system);

    await handler.process({} as never);

    expect(handler.lastIndexed).toBe(3);
    // The bypass flag is set first, transaction-locally, by the core function.
    expect(statements).toEqual(["SELECT set_config('app.rls_bypass', 'on', true)"]);
    expect(handler.type).toBe('app.transcript.reindex');
    expect(handler.profile).toEqual({ maxRuntimeMs: 600_000, maxAttempts: 2 });
  });

  it('does nothing when there is nothing stale', async () => {
    const { client } = fakeSystemClient(0);
    const handler = new TranscriptReindexHandler({ run: (reason, fn) => runAsSystem(client as never, reason, (tx) => fn(tx as unknown as ReindexTransaction)) });
    await handler.process({} as never);
    expect(handler.lastIndexed).toBe(0);
  });

  it('still refuses a reason nobody registered (a near miss included)', async () => {
    const { client } = fakeSystemClient(0);
    await expect(runAsSystem(client as never, 'transcript-reindexx', async () => 1)).rejects.toThrow(ScopedAccessError);
  });

  it('opens WHICH reason, not WHO may bypass: the job never names the system client', () => {
    const source = readFileSync(join(__dirname, '..', '..', '..', 'src', 'platform-extensions', 'core', 'transcript-reindex.job.ts'), 'utf8');
    const code = source.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
    expect(code).not.toMatch(/PrismaSystemService/);
  });
});

// ---------------------------------------------------------------------------
// 2 and 3 and 4. HTTP: a guard, a domain error code, a mapper
// ---------------------------------------------------------------------------

/** The owner holds notes:read and notes:write through a system role; the key lists only notes:read. */
const OWNER: ApiKeyOwner = {
  id: 'user-1',
  email: 'owner@example.test',
  userRoles: [
    { role: { name: 'contributor', rolePermissions: [{ permission: { name: 'notes:read' } }, { permission: { name: 'notes:write' } }] } },
  ],
  keyPermissions: ['notes:read', 'notes:export'],
};

class UnregisteredKindGuard extends ApiKeyGuard {
  protected override readonly kind = 'not-registered-key';
}

@Controller('integration')
class IntegrationController {
  @Get('notes')
  @UseGuards(ApiKeyGuard)
  @RequiresApiKeyPermission('notes:read')
  read(@Req() request: { principal?: { kind: string; credential: string; permissions: string[] } }): unknown {
    return { kind: request.principal?.kind, credential: request.principal?.credential, permissions: request.principal?.permissions };
  }

  @Get('notes-admin')
  @UseGuards(ApiKeyGuard)
  @RequiresApiKeyPermission('notes:write')
  write(): { ok: true } {
    return { ok: true };
  }

  @Get('legacy')
  @UseGuards(UnregisteredKindGuard)
  legacy(): { ok: true } {
    return { ok: true };
  }

  @Get('title-taken')
  titleTaken(): never {
    throw new NoteTitleTakenException('Quarterly review');
  }

  @Get('duplicate')
  duplicate(): never {
    throw new Prisma.PrismaClientKnownRequestError('Unique constraint failed on the fields: (`email`) at db-7', {
      code: 'P2002',
      clientVersion: 'test',
      meta: { target: ['email'] },
    });
  }

  @Get('missing')
  missing(): never {
    throw new Prisma.PrismaClientKnownRequestError('Record not found', { code: 'P2025', clientVersion: 'test' });
  }
}

/** The global settings slice, as far as maintenance reads it. */
@Global()
@Module({
  providers: [
    {
      provide: SystemSettingsService,
      useValue: {
        getMaintenancePolicy: async () => ({ ...MAINTENANCE_SYSTEM_SETTINGS.defaults }),
        readNamespaceValue: async () => ({ ...MAINTENANCE_SYSTEM_SETTINGS.defaults }),
        patchSettings: async () => undefined,
      },
    },
    DoctorCheckRegistry,
    EgressRegistry,
  ],
  exports: [SystemSettingsService, DoctorCheckRegistry, EgressRegistry],
})
class FakeSettingsModule {}

@Module({
  controllers: [IntegrationController],
  providers: [
    Reflector,
    { provide: API_KEY_VERIFIER, useValue: { verify: async (key: string) => (key === 'ak_valid' ? OWNER : null) } },
    ApiKeyGuard,
    UnregisteredKindGuard,
  ],
})
class IntegrationModule {}

describe('app extensions over HTTP, through the real host core', () => {
  let moduleRef: TestingModule;
  let app: NestFastifyApplication;
  const get = (url: string, headers: Record<string, string> = {}) => app.inject({ method: 'GET', url: `/api${url}`, headers });

  beforeAll(async () => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true, load: [() => ({ jwt: { secret: 'example-secret' } })] }),
        FakeSettingsModule,
        PlatformHostModule.forRoot({ audit: { useFactory: () => new InMemoryAuditSink() } }),
        PlatformHostCoreModule.forRoot({ metricsGauges: false, errorMappers: APP_ERROR_MAPPERS }),
        IntegrationModule,
      ],
    })
      .useMocker(() => ({}))
      .compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    app.setGlobalPrefix('api');
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => {
    await app.close();
    jest.restoreAllMocks();
  });

  describe('a credential kind with a guard', () => {
    it('is registered against the user principal kind, after the platform\'s four', () => {
      expect(credentialKindRegistry.ids()).toEqual(['session', 'device', 'pat', 'node', API_KEY_CREDENTIAL_KIND]);
      expect(credentialKindRegistry.require(API_KEY_CREDENTIAL_KIND).principalKind).toBe('user');
    });

    it('admits a valid key that lists the route\'s permission', async () => {
      const response = await get('/integration/notes', { 'x-api-key': 'ak_valid' });
      expect(response.statusCode).toBe(200);
      // A user principal carrying the app's credential kind, and only the permissions BOTH the owner and the key hold.
      expect(response.json().data).toEqual({ kind: 'user', credential: 'api-key', permissions: ['notes:read'] });
    });

    it('answers 401 for a missing, malformed or unknown key and 403 for a key without the permission', async () => {
      expect((await get('/integration/notes')).statusCode).toBe(401);
      expect((await get('/integration/notes', { 'x-api-key': 'valid' })).statusCode).toBe(401);
      expect((await get('/integration/notes', { 'x-api-key': 'ak_revoked' })).statusCode).toBe(401);
      expect((await get('/integration/notes-admin', { 'x-api-key': 'ak_valid' })).statusCode).toBe(403);
    });

    it('DENIES a credential kind nobody registered (default deny), without echoing it', async () => {
      const response = await get('/integration/legacy', { 'x-api-key': 'ak_valid' });
      expect(response.statusCode).toBe(401);
      expect(response.json()).toMatchObject({ statusCode: 401, code: 'UNAUTHORIZED', message: 'Unrecognised credential' });
      expect(response.body).not.toContain('not-registered-key');
    });
  });

  describe('a domain error code', () => {
    it('is registered for its status, after the platform\'s ten', () => {
      expect(errorCodeRegistry.get(NOTE_TITLE_TAKEN)).toMatchObject({ status: 409 });
      expect(errorCodeRegistry.ids().slice(0, 10)).toContain('CONFLICT');
    });

    it('an app controller answers it in the envelope, with details', async () => {
      const response = await get('/integration/title-taken');
      expect(response.statusCode).toBe(409);
      expect(response.json()).toMatchObject({
        statusCode: 409,
        code: 'NOTE_TITLE_TAKEN',
        message: 'A note with this title already exists',
        details: { field: 'title', title: 'Quarterly review' },
        path: '/api/integration/title-taken',
      });
    });
  });

  describe('a Prisma P2002 mapper', () => {
    it('answers 409 RESOURCE_ALREADY_EXISTS and never the Prisma message', async () => {
      const response = await get('/integration/duplicate');
      expect(response.statusCode).toBe(409);
      expect(response.json()).toMatchObject({ statusCode: 409, code: 'RESOURCE_ALREADY_EXISTS' });
      expect(response.body).not.toMatch(/Unique constraint|email|db-7/);
    });

    it('leaves every other Prisma error as the pre-existing 500', async () => {
      const response = await get('/integration/missing');
      expect(response.statusCode).toBe(500);
      expect(response.json()).toMatchObject({ statusCode: 500, code: 'INTERNAL_ERROR' });
    });
  });
});
