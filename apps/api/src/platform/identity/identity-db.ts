// =============================================================================
// The app's client, as the identity slice sees it (issue #727)
// =============================================================================
//
// `@marinoscar/platform-api/identity` depends on no generated Prisma client:
// it declares its tables structurally (`IdentityPrisma`, the package's
// `identity/data/identity-db.ts`), so the package builds before any app's
// `prisma generate`. Inside the app the client reaches the slice through Nest
// injection (`PLATFORM_PRISMA`, bound in `identity-host.module.ts`), which is
// untyped and needs nothing here.
//
// Code that hands the client to an identity service BY HAND (a real-database
// spec that builds the services with `new`) says so with this one function:
// the generated client's generic delegates are a superset of the slice's
// structural ones at run time, but TypeScript cannot prove it for generic
// methods, so this is the single, named cast.
// =============================================================================

import type { IdentityPrisma } from '@marinoscar/platform-api/identity';

import type { PrismaService } from '../../prisma/prisma.service';

/** The app's Prisma client (or `PrismaService`) as the identity slice's `IdentityPrisma`. */
export function asIdentityPrisma(client: PrismaService): IdentityPrisma {
  return client as unknown as IdentityPrisma;
}
