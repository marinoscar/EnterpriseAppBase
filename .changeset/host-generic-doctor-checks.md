---
"@marinoscar/platform-api": minor
---

Host slice: `PlatformHostCoreModule.forRoot()` now registers the generic Doctor checks that were app code (`db.connection`, `db.migrations`, `db.rls_role` and `secrets.encryption-key` in the `core` category, `core.deployment-mode`, and `network.egress`), reading the database through the `PLATFORM_PRISMA` port (each reports `skip` when it is unbound), and provides `DeploymentModeService` (`DEPLOYMENT_MODE`) and `DeploymentNetworkService` (`DEPLOYMENT_NETWORK`, bound as `DEPLOYMENT_NETWORK_SOURCE`) with their parsers and bootstrap verifiers. Check ids, results and report order are unchanged.
