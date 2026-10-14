// =============================================================================
// Prisma's raw-SQL builders and its known-request error, from the runtime
// (issue #734)
// =============================================================================
//
// `@prisma/client-runtime-utils` is the NON-GENERATED half of Prisma 7: the
// `Sql` class with its `sql`, `raw`, `join` and `empty` builders, and the
// error classes. The generated client loads the very same module (its
// `Prisma.sql` IS this `sql`, its `Prisma.PrismaClientKnownRequestError` IS
// this class), so a fragment built here nests inside the app's `$queryRaw`
// and an error thrown by the app's client passes `instanceof` here.
//
// It needs no `prisma generate` and knows no model, so it keeps the rule of
// `test/no-generated-client.spec.ts`: the package never depends on an app's
// generated client. It is a peer dependency, resolved to the copy the app's
// `@prisma/client` depends on.
// =============================================================================

export { PrismaClientKnownRequestError, Sql, empty, join, raw, sql } from '@prisma/client-runtime-utils';
