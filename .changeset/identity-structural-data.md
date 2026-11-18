---
'@marinoscar/platform-api': minor
---

identity: depend on no generated Prisma client. The slice declares the identity fragment's tables structurally (`IdentityPrisma`, `IdentityTx`, `IdentityDelegate`, the `Identity*Row` types, `IdentityJsonValue`, `DEVICE_CODE_STATUS`, `isPrismaErrorCode`), so `@marinoscar/platform-api` builds, type-checks and tests before any `prisma generate`. `AuthenticatedUser` extends `IdentityUserRow` instead of the generated `User`; `resolveOrgId` / `resolveJobOrgId` take a `DefaultOrgReader`, which the app's own client satisfies as is.
