---
"@marinoscar/platform-api": minor
---

Add `@marinoscar/platform-api/storage` and `/storage/testing` (#736): `StorageModule.forRoot({ maxSimpleUploadBytes, partSizeBytes, staleUploadHours, imports })`, `STORAGE_PROVIDER` with the runtime-configured S3 driver (`s3`, `r2`, `s3compatible`), `StorageConfigModule` (the `/api/admin/storage-config` routes, connection test, bucket provisioning, the `storage.config` and `storage.bucket` Doctor checks), the objects API with org-aware keys (`uploads/<orgId>/…`; legacy keys keep working), the `ObjectProcessorRegistry` (replacing the optional `OBJECT_PROCESSOR` injection), the key-prefix registry with scopes, `buildObjectKey`, `allKeyPrefixes` and `orgKeyPrefixes`, `runStoragePurge`, `ProfileImageModule.forRoot()`, `nodeObjectStoreBinding`, the `STORAGE_SYSTEM_DATA` port and the `storage` conformance suite. Job types, routes, permissions and the settings namespace are unchanged.
