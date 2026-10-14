---
"@marinoscar/platform-api": minor
"@marinoscar/platform-contract": minor
---

Move the retention engine into the slices that own the data. `@marinoscar/platform-api/jobs` now exports the one shared `purgeInBatches` / `runRetentionPolicyPurge` loop (the duplicate under `ai/runtime` is gone), the `RetentionPurgeRegistry` a purge handler declares its `retention.*` policy in, the 01:00 enqueue-only `RetentionPurgeTask`, the `retention` settings namespace (`RETENTION_SYSTEM_SETTINGS`, registered by `JobsModule.forRoot()` unless the app's manifest lists it) and `AuditEventsPurgeHandler`; `@marinoscar/platform-api/notifications` provides `notifications.inbox.purge` and `notifications.deliveries.purge`; `ai.runs.purge` uses the shared loop; `@marinoscar/platform-contract/jobs` carries the `retention` schemas. Job type strings and the OpenAPI document are unchanged.
