---
"@marinoscar/platform-api": minor
"@marinoscar/platform-contract": minor
---

Storage drivers are pluggable (PP-14.7, #925). `registerStorageDriver` adds an object store (Azure Blob, Google Cloud Storage, a local disk) from an app or a package: its own settings schema, declared secrets (stored encrypted at the credential purpose `storage_<id>`, never in settings or the environment), `build`, `testConnection`, and optionally `provision`, `listKeys` and `purge`. `s3`, `r2` and `s3compatible` are drivers registered through the same function, and all S3-specific code (the connection test, bucket provisioning, the purge lister, the per-flavour requirements and region fallback, the Doctor egress host) moved into them. The connection test, provisioning, purge, egress and the resolving provider delegate to the active driver. `describeStorageDriverConformance` (`@marinoscar/platform-api/storage/testing`) is the kit every driver runs.

The `storage` settings namespace stores `provider` (a driver id) and a `drivers` record validated per driver. A row stored before this release loads unchanged (its flat fields become `drivers.<provider>`, field by field), and the flat fields (`bucket`, `region`, `endpoint`, `accountId`, `accessKeyId`, `forcePathStyle`) stay accepted on PUT, PATCH and the admin routes and published as a deprecated read view. `databaseBackup.storageProvider` accepts any driver id.

Contract: `BUILTIN_STORAGE_PROVIDER_KINDS` (`STORAGE_PROVIDER_KINDS` stays as a deprecated alias), `storageDriverIdSchema`, `StorageProviderKind` widens to `string`; the admin config view gains `drivers` and `descriptors` and `missing` becomes a list of strings; the admin PUT, test and bucket bodies gain optional `drivers` and `secrets`; the test and provisioning results gain `message`. The `storage` contract slice now depends on the `settings` slice.

Migration notes for code that builds these by hand: `ResolvedStorageConfig` is the generic active configuration (`provider`, `bucket`, `region`, `endpoint?`, `settings`, `secrets`; the S3 family's is `ResolvedS3Config`); `StorageConnectionTestService` and `StorageBucketProvisionService` take a `StorageSubmissionService`; `resolveStorageConfig` (S3 only) is deprecated; `npm run storage:purge` exits `3` for a driver that can neither purge nor list its keys. New installs seed `storage` as `{ provider, drivers }`.
