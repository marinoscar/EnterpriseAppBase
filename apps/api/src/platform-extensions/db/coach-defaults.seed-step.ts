import type { Prisma } from '@prisma/client';
import type { SeedStep } from '@marinoscar/platform-db/seed';

// =============================================================================
// EXAMPLE: an app seed step (PP-14.27)
// =============================================================================
//
// `seedPlatform(prisma, input, { extras })` runs the app's steps after the
// platform's own, each in its own transaction, under the same log. A step is
// `{ id, run(tx, ctx) }` and keeps the seed's contract:
//
//   - IDEMPOTENT. Every write is an upsert on a natural unique; a second run
//     reports `created: 0` (`assertSeedIdempotent` proves it in the app's
//     real-database test).
//   - NEVER DELETES, and never overwrites a value an administrator may have
//     edited (`update: {}`).
//   - NEST-FREE. The seed runs under `ts-node --transpile-only` in an image with
//     no `src/`: a step that `prisma/seed.ts` runs imports nothing from here.
//     This example lives in `src/` only because the reference app has nothing
//     of its own to seed; a real step goes in `prisma/seed-app.ts`
//     (`APP_SEED_STEPS`) or in a file under `prisma/`.
//
// This example allowlists the address of an imaginary coaching programme.
// =============================================================================

/** The address the example step allowlists. */
export const COACH_PROGRAM_EMAIL = 'coach-program@example.test';

/** Allowlists the coach programme's address; the row is created once and never touched again. */
export const seedCoachDefaults: SeedStep<Prisma.TransactionClient> = {
  id: 'coach.defaults',
  async run(tx, ctx) {
    const existing = await tx.allowedEmail.findUnique({ where: { email: COACH_PROGRAM_EMAIL }, select: { id: true } });
    await tx.allowedEmail.upsert({
      where: { email: COACH_PROGRAM_EMAIL },
      update: {}, // an administrator's edit of the note is theirs
      create: { email: COACH_PROGRAM_EMAIL, notes: 'Coach programme (example seed step)' },
    });
    ctx.log.info(existing ? `  ${COACH_PROGRAM_EMAIL} already allowlisted` : `  allowlisted ${COACH_PROGRAM_EMAIL}`);
    return { created: existing ? 0 : 1, updated: 0 };
  },
};
