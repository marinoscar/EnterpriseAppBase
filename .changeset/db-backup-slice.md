---
'@marinoscar/platform-contract': minor
'@marinoscar/platform-api': minor
'@marinoscar/platform-web': minor
---

Add the database backup and restore slice: `@marinoscar/platform-contract/db-backup` (the wire shapes and the `databaseBackup` namespace), `@marinoscar/platform-api/db-backup` (`DbBackupModule.forRoot` with the deployment-mode restore gate, the `RestoreCarryOver` registry, the `rls_bypass` pre-flight gate and the `database-backups/` key prefix) and `@marinoscar/platform-web/db-backup` (the admin page, its hook and client, and the admin section entry).
