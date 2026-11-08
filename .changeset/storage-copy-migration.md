---
"@marinoscar/platform-db": minor
"@marinoscar/platform-contract": minor
"@marinoscar/platform-api": minor
"@marinoscar/platform-web": minor
---

Add copy-only storage provider migration (#1093). An administrator starts a run from one storage driver to another (`POST /api/admin/storage/migrations`, `storage_config:write`; list, get and cancel need `storage_config:read` / `storage_config:write`); every `ready` object recorded on the source is copied by streaming, verified (byte count and sha256 of the bytes read back from the target), and only then repointed, while the source object is left in place as a fallback. Platform migration `0042_add_storage_migrations` adds `storage_migration_runs` and `storage_migration_items` (both under forced row-level security on `org_id`; an item links to its object by the composite `(object_id, org_id)` key) and the raw-SQL partial unique index `storage_migration_runs_active_uniq_idx`, so at most one run is pending or running (a second start is a 409 naming `details.activeRunId`). Two server-only job types do the work: `storage.migrate_plan` (one per run, lists the objects and queues them, resumable) and `storage.migrate_object` (one per object, `skipDedup`, background priority). A cancelled run stops before its next unclaimed object, and a re-run skips objects already on the target. The contract gains the run wire shapes, and `StorageConfigPage` gains a migration panel with live progress and run history.
