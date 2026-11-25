import type { PortBinding } from '@marinoscar/platform-api/core';
import { registerRestoreGate, type BackupTarget } from '@marinoscar/platform-api/db-backup';

import { cdnQuiescedGate } from '../platform-extensions/db-backup/cdn-quiesced.gate';

// =============================================================================
// This app's db-backup registrations (PP-14.12)
// =============================================================================
//
// Upstream keeps the two arrays EMPTY FOREVER; a fork fills them in and never
// edits the slice. `platform/db-backup/db-backup.config.ts` imports this file
// before it builds the module, and passes both to `DbBackupModule.forRoot`.
//
//   APP_BACKUP_TARGET          the PRIMARY backup target, when archives must go
//                              somewhere the active storage provider does not
//                              reach. `undefined` keeps today's behaviour: the
//                              default adapter over the active storage provider.
//                              Worth knowing: with an app target, a worker node
//                              cannot take backups (its presigned PUT writes
//                              through the storage provider), so node offload is
//                              withheld; the in-process worker streams the dump.
//   APP_BACKUP_MIRROR_TARGETS  targets that receive a COPY of every archive after
//                              the primary's was written and proven. A failed
//                              copy never fails the backup; it is recorded and
//                              the `backup.mirrors` Doctor check warns.
//                              `localDirMirror('/mnt/backup-mirror')` (the
//                              example in `platform-extensions/db-backup/`) is
//                              the one line a fork adds to keep a second copy.
//
//   restore gates              `registerRestoreGate(def)` AT IMPORT TIME (below).
//                              The registry freezes once the application has
//                              bootstrapped. The eight built-in gates run first,
//                              then these, in registration order.
//
// Recipe: docs/EXTENDING.md, "Add a backup target, a mirror or a restore gate".
// =============================================================================

/** This app's primary backup target; `undefined` uses the active storage provider. Upstream keeps this unset. */
export const APP_BACKUP_TARGET: PortBinding<BackupTarget> | undefined = undefined;

/** This app's mirror targets. Upstream keeps this array empty. */
export const APP_BACKUP_MIRROR_TARGETS: readonly PortBinding<BackupTarget>[] = [];

// The worked example gate. Registered so the example is the real thing, but
// INERT: it reads a `cdn` settings namespace this app does not register, so it
// passes ("nothing to quiesce"). A fork with a CDN registers the namespace and
// the gate blocks a restore until the operator has quiesced it; a fork without
// one deletes this call and `platform-extensions/db-backup/cdn-quiesced.gate.ts`.
registerRestoreGate(cdnQuiescedGate);
