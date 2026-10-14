// =============================================================================
// Stand-ins for the reference app's services, for the storage specs (#736)
// =============================================================================
//
// The specs moved here from apps/api with the code they test. Where a spec
// named an app service, it now names the host port the slice injects instead;
// each export below is BOTH the port's injection token (a value, for
// `{ provide: X, useValue }`) and its type, under the app service's old name,
// so the specs read as they did.
// =============================================================================

import { PLATFORM_PRISMA } from '../../../src/core/index';
import type { StoragePrisma } from '../../../src/storage/data/storage-db';
import { STORAGE_SYSTEM_DATA, type StorageSystemData } from '../../../src/storage/ports';

/** The tenant database port (the app's `PrismaService`). */
export const PrismaService = PLATFORM_PRISMA;
export type PrismaService = StoragePrisma;

/** The bypass client port (the app's `PrismaSystemService`). */
export const PrismaSystemService = STORAGE_SYSTEM_DATA;
export type PrismaSystemService = StorageSystemData;
