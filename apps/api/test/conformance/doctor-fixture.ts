// =============================================================================
// How the reference app builds itself for the `doctor-read-only` suite (PP-14.26)
// =============================================================================
//
// The suite cannot build this app. It hands the fixture two doubles, a Prisma
// client that records every call and a storage provider that refuses every write,
// and asks for the app booted with them installed under the app's own tokens. The
// suite then takes every check the booted `DoctorCheckRegistry` holds and runs it.
//
// Three overrides carry the doubles:
//   - `PrismaService`      what every service and `PLATFORM_PRISMA` (bound with
//                          `useExisting: PrismaService`) read through;
//   - `PrismaSystemService` the bypass client some checks and data ports use
//                          (`asSystem` and `runAsSystem` answer the same double);
//   - `STORAGE_PROVIDER`   the object store a storage check reads.
// Everything else is the real `AppModule`, over `createTestApp`'s mocked database.
// =============================================================================

import { STORAGE_PROVIDER } from '@marinoscar/platform-api/storage';
import type { DoctorConformanceFixture } from '@marinoscar/platform-api/doctor/testing';

import { PrismaSystemService } from '../../src/prisma/prisma-system.service';
import { PrismaService } from '../../src/prisma/prisma.service';
import { closeTestApp, createTestApp, type TestContext } from '../helpers/test-app.helper';

export const doctorConformanceFixture: DoctorConformanceFixture = {
  createContext: ({ prisma, storage }) =>
    createTestApp({
      useMockDatabase: true,
      overrideProviders: [
        { provide: PrismaService, useValue: prisma.client },
        {
          provide: PrismaSystemService,
          useValue: {
            asSystem: () => prisma.client,
            runAsSystem: (_reason: string, fn: (tx: unknown) => unknown) => fn(prisma.client),
            $connect: async () => undefined,
            $disconnect: async () => undefined,
          },
        },
        { provide: STORAGE_PROVIDER, useValue: storage.provider },
      ],
    }),
  closeContext: (context) => closeTestApp(context as TestContext),
};
