import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { platformSeedInputFrom, seedPlatform } from '@marinoscar/platform-db/seed';
// The registries' snapshot, split out (#256) so a Jest test can import it: this
// file instantiates a PrismaClient and calls `main()` at import time, so nothing
// can import IT to check the data. See seed-data.ts.
import { SEED_SNAPSHOT } from './seed-data';
// The app's own seed rows, run after the platform's. See seed-app.ts.
import { seedApp } from './seed-app';

// Prisma 7 requires a driver adapter — PrismaClient can no longer be
// instantiated with no options. The seed script is invoked as a standalone
// ts-node process (see prisma.config.ts: migrations.seed), not through
// Nest's DI container, so it can't reuse PrismaService's buildConnectionString()
// without also pulling in @nestjs/common. Every Prisma CLI invocation in this
// project (npm run prisma:*, or `npx prisma db seed` per the README) already
// guarantees DATABASE_URL is set before the CLI — and therefore this seed
// script — runs, either via scripts/prisma-env.js or an explicit export, so
// reading it directly here is sufficient and keeps the script framework-free.
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error(
    'DATABASE_URL is not set. Run this script via `npm run prisma:seed` ' +
      '(or export DATABASE_URL) so Prisma can connect to the database.',
  );
}

const adapter = new PrismaPg(databaseUrl);
const prisma = new PrismaClient({ adapter });

// =============================================================================
// Main Seed Function
// =============================================================================
//
// The platform half (roles, permissions, default grants, the `global` system
// settings row, the initial administrator's allowlist entry) is
// `seedPlatform` from `@marinoscar/platform-db/seed`: upserts only, never a
// delete, never an overwrite of an admin-edited value, so this script can run
// on every deploy. The input is built from the registries' snapshot
// (`prisma/catalog/`). The app's own rows follow, in `seed-app.ts`. Both halves
// log through the console, which is what operators read during `appctl deploy`.
//
// This script must stay standalone and Nest-free: it runs under
// `ts-node --transpile-only` (prisma.config.ts) in an image without `src/`.

async function main() {
  console.log('Starting database seed...\n');

  const log = { info: (msg: string) => console.log(msg) };

  await seedPlatform(prisma, platformSeedInputFrom(SEED_SNAPSHOT, process.env), log);
  await seedApp(prisma);

  console.log('\n✓ Database seeding completed successfully');
}

main()
  .catch((e) => {
    console.error('Seed error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
