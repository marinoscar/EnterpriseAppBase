# App schema fragments

This folder holds the app's own Prisma models. It is empty of `*.prisma` files because the reference app adds no model of its own yet; the platform's models come from `@marinoscar/platform-db` (`packages/platform-db/schema/`).

`prisma/schema/` is **generated** from the platform fragments plus the `*.prisma` files in this folder by `npm run db:compose`, and committed. Never edit a file there: `npm run db:compose:check` (CI) fails when it differs from a fresh compose.

## Adding a model that points at a platform model

Write the model and, in the same file, an `extend model` block that declares the back-relation. Prisma requires the field on both sides, and it cannot extend a model across files, so this block is how an app adds the platform model's side without editing a platform file:

```prisma
model Workout {
  id        String   @id @default(uuid()) @db.Uuid
  userId    String   @map("user_id") @db.Uuid
  title     String
  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId])
  @@map("workouts")
}

extend model User {
  workouts Workout[]
}
```

Only a model its owner marked `// @extensible` can be extended: `User`, `Job` and `StorageObject`. An `extend` block holds back-relation fields only: no scalar field, no `fields: [...]` relation, no `@@` attribute (each is a composer error with a stable code, a file and a line).

Then:

```bash
cd apps/api
npm run db:compose                           # regenerate prisma/schema/
npm run prisma:generate
npm run prisma:migrate:dev -- --name add_workouts
```

A working version of this example is compiled and type-checked by `packages/platform-db/test/fixtures/app-with-domain/` (`include: { workouts: true }`).

## Changing the generator or datasource

An app that needs another generator option (`output`, `previewFeatures`) adds a `base.prisma` here. It replaces the package's `base.prisma` entirely, and the composer warns that it did.

Full reference: [`packages/platform-db/README.md`](../../../../packages/platform-db/README.md) and [ADR 0002](../../../../docs/adr/0002-database-packaging-and-rls.md) (D2).
