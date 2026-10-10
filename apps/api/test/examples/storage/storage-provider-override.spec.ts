import { Test, type TestingModule } from '@nestjs/testing';
import { DbBackupModule } from '@marinoscar/platform-api/db-backup';
import { ExportsModule } from '@marinoscar/platform-api/exports';
import { ExportRunHandler } from '@marinoscar/platform-api/exports';
import {
  ObjectsService,
  ProfileImageModule,
  ProfileImageService,
  ResolvingStorageProvider,
  STORAGE_PROVIDER,
  StorageModule,
  type StorageProvider,
} from '@marinoscar/platform-api/storage';
import { DatabaseBackupRunnerService } from '@marinoscar/platform-api/db-backup';
import { Prisma } from '@prisma/client';

import { IN_MEMORY_STORAGE_KIND, InMemoryStorageProvider } from '../../../src/platform-extensions/storage/in-memory-storage.provider';

// =============================================================================
// PP-14.1 — `StorageModule.forRoot({ provider })` reaches EVERY package consumer
// =============================================================================
//
// The documented rung-3 override ("provide STORAGE_PROVIDER in your app module")
// never worked: every package module imports `StorageProvidersModule`, and Nest
// resolves a token from the consuming module's own imports first. This suite
// boots the REAL package modules (`StorageModule`, `ProfileImageModule`,
// `ExportsModule`, `DbBackupModule`), binds an in-memory provider through the
// `provider` option and asserts what each consumer was actually injected with.
//
// Dependencies the slice takes from the app (Prisma, the job queue, the system
// settings and the like) are stubbed by `useMocker`; they are not under test.
// =============================================================================

// Read a constructor-injected field of a consumer: the instance the consumer
// really holds, which is the property under test.
function injected(consumer: object, field: string): unknown {
  return (consumer as Record<string, unknown>)[field];
}

async function boot(storage: ReturnType<typeof StorageModule.forRoot>): Promise<TestingModule> {
  return Test.createTestingModule({
    imports: [
      storage,
      ProfileImageModule.forRoot(),
      ExportsModule.forRoot({ datamodel: Prisma.dmmf.datamodel }),
      DbBackupModule.forRoot({}),
    ],
  })
    // The app-supplied dependencies are stubs; the optional provider binding is
    // NOT one (an absent binding must stay absent for the default path).
    .useMocker((token) => (token === Symbol.for('@marinoscar/platform/storage/STORAGE_PROVIDER_BINDING') ? undefined : {}))
    .compile();
}

describe('StorageModule.forRoot({ provider }): the override reaches every package consumer', () => {
  it('binds the app provider for the objects API, profile images, exports and database backups', async () => {
    const appProvider = new InMemoryStorageProvider();
    const moduleRef = await boot(StorageModule.forRoot({ provider: { useFactory: () => appProvider } }));

    const consumers: Array<[string, object, string]> = [
      ['ObjectsService', moduleRef.get(ObjectsService, { strict: false }), 'storageProvider'],
      ['ProfileImageService', moduleRef.get(ProfileImageService, { strict: false }), 'storageProvider'],
      ['ExportRunHandler', moduleRef.get(ExportRunHandler, { strict: false }), 'storage'],
      ['DatabaseBackupRunnerService', moduleRef.get(DatabaseBackupRunnerService, { strict: false }), 'storage'],
    ];

    for (const [name, consumer, field] of consumers) {
      expect([name, injected(consumer, field)]).toEqual([name, appProvider]);
    }
    expect(moduleRef.get<StorageProvider>(STORAGE_PROVIDER, { strict: false }).kind).toBe(IN_MEMORY_STORAGE_KIND);
    await moduleRef.close();
  });

  it('accepts a class binding, instantiated once and shared by every consumer', async () => {
    const moduleRef = await boot(StorageModule.forRoot({ provider: { useClass: InMemoryStorageProvider } }));

    const viaObjects = injected(moduleRef.get(ObjectsService, { strict: false }), 'storageProvider');
    const viaExports = injected(moduleRef.get(ExportRunHandler, { strict: false }), 'storage');

    expect(viaObjects).toBeInstanceOf(InMemoryStorageProvider);
    expect(viaExports).toBe(viaObjects);
    await moduleRef.close();
  });
});

describe('StorageModule.forRoot() without `provider`: the default path is unchanged', () => {
  it('every consumer still receives the ResolvingStorageProvider', async () => {
    const moduleRef = await boot(StorageModule.forRoot({}));

    const resolving = moduleRef.get(ResolvingStorageProvider, { strict: false });
    for (const [consumer, field] of [
      [moduleRef.get(ObjectsService, { strict: false }), 'storageProvider'],
      [moduleRef.get(ProfileImageService, { strict: false }), 'storageProvider'],
      [moduleRef.get(ExportRunHandler, { strict: false }), 'storage'],
      [moduleRef.get(DatabaseBackupRunnerService, { strict: false }), 'storage'],
    ] as const) {
      expect(injected(consumer, field)).toBe(resolving);
    }
    await moduleRef.close();
  });
});
