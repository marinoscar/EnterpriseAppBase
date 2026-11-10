---
"@marinoscar/platform-api": minor
---

db-backup: the `BackupTarget` receives a run's recorded location (#1121). `openRead`, `delete` and `signedDownloadUrl` take an optional last argument, `BackupObjectLocation` (`{ provider, bucket }`: the run's `storage_provider` and `bucket`; `recordedLocationOf(run)` builds it), passed by the restore, the node-run verification, the admin download and delete, retention and the stale sweep to the primary target. An app target serves a run's archive without looking the run up by key; existing targets ignore the argument. The default `StorageProviderBackupTarget` resolves it through `StorageProviderRouter`, so a backup taken before the active storage driver or bucket changed is read, signed and deleted where it really is. The README documents binding a target in an app that does not configure object storage.
