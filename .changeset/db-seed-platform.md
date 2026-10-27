---
"@marinoscar/platform-db": minor
---

Add the `@marinoscar/platform-db/seed` slice: `seedPlatform(prisma, input)` upserts the platform's roles, permissions, default grants, the `global` system settings row and the initial administrator's allowlist entry (never deleting, never overwriting an admin-edited value), with `platformSeedInputFrom` and `readSeedSnapshot` to build the input from the registries' committed catalogs.
