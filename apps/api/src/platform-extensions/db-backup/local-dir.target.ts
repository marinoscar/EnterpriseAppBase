// =============================================================================
// The `local-dir` backup target: a mirror that writes archives to a directory
// (PP-14.12)
// =============================================================================
//
// The worked example of `BackupTarget` (`@marinoscar/platform-api/db-backup`):
// where a backup archive lives is a port, so an app can keep a second copy
// somewhere the platform's object-storage drivers do not reach. This one writes
// each archive as a file under a directory (an NFS mount, a USB disk, a path a
// host backup agent sweeps), reading it back the same way. It needs no
// credential and no network, so it runs in CI.
//
// HOW AN APP USES IT
//
//   // apps/api/src/app-registrations/db-backup.ts
//   export const APP_BACKUP_MIRROR_TARGETS = [localDirMirror('/mnt/backup-mirror')];
//
// `platform/db-backup/db-backup.config.ts` passes that array to
// `DbBackupModule.forRoot({ mirrorTargets })`. The engine then copies every
// verified archive here AFTER the primary storage target holds and has proven
// it, streams the bytes (nothing is buffered), reads the copy back and compares
// its SHA-256 with the primary's, and records the result: a failed copy never
// fails the backup, it raises the `backup.mirrors` Doctor warning. Retention and
// the admin delete remove the copy with the original.
//
// The reference app ships it compiled and tested but UNBOUND (the array in
// `app-registrations/db-backup.ts` is empty): a fresh install writes one copy,
// to the object storage the administrator configured. A fork that wants the
// mirror adds the one line above. It can equally be the PRIMARY target:
// `target: { useFactory: () => new LocalDirBackupTarget(dir, 'local-dir') }`.
//
// THE RULES IT KEEPS (the conformance kit, `describeBackupTargetConformance`,
// asserts each; `apps/api/test/examples/db-backup/local-dir.target.spec.ts` runs it):
//   - the key is the server's, and a key that would leave the directory
//     (`..`, an absolute path) is refused;
//   - the archive is never buffered: `pipeline` from the dump's stream into a
//     file, and a file read stream out;
//   - a failed write removes its partial file, and `done` rejects;
//   - deleting a missing file is not an error.
// =============================================================================

import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { PassThrough, type Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

import type { PortBinding } from '@marinoscar/platform-api/core';
import type {
  BackupSink,
  BackupTarget,
  BackupTargetObject,
  BackupWriteMeta,
} from '@marinoscar/platform-api/db-backup';

/**
 * The id the target records on each copy (`audit_events.meta.targetId`) and the
 * `backup.mirrors` Doctor check reports under.
 */
export const LOCAL_DIR_TARGET_ID = 'local-dir';

/**
 * Where the example writes when the app names no directory: a folder under the
 * system temp directory. Suitable for development and tests, not for backups
 * you intend to keep.
 *
 * @returns an absolute path.
 */
export function defaultLocalDirBackupDirectory(): string {
  return join(tmpdir(), 'app-backup-mirror');
}

/**
 * A {@link BackupTarget} over a directory. Keys map to relative paths under
 * `directory` (`database-backups/<slug>/<yyyy>/<mm>/<file>.dump`).
 */
export class LocalDirBackupTarget implements BackupTarget {
  /** The directory, as an absolute path. */
  readonly directory: string;

  /**
   * @param directory - the directory archives are written under (created on first write). Default {@link defaultLocalDirBackupDirectory}.
   * @param id - the target id; default {@link LOCAL_DIR_TARGET_ID}. Must differ from every other target's.
   */
  constructor(
    directory: string = defaultLocalDirBackupDirectory(),
    readonly id: string = LOCAL_DIR_TARGET_ID,
  ) {
    this.directory = resolve(directory);
  }

  /** Recorded as the run's `bucket` when this is the primary target. */
  get location(): string {
    return this.directory;
  }

  /** The file for `key`, refusing a key that would escape the directory. */
  private pathOf(key: string): string {
    const full = resolve(this.directory, key);
    if (!full.startsWith(this.directory + sep)) {
      throw new Error(`The backup key "${key}" would leave the target directory and was refused.`);
    }
    return full;
  }

  openWrite(key: string, _meta: BackupWriteMeta): BackupSink {
    const file = this.pathOf(key);
    const stream = new PassThrough();

    // `pipeline` settles when the file is closed OR when `stream` is destroyed,
    // even before the directory exists; a failed write removes its partial file.
    const done = mkdir(dirname(file), { recursive: true })
      .then(() => pipeline(stream, createWriteStream(file)))
      .catch(async (error: unknown) => {
        await rm(file, { force: true });
        throw error;
      });
    // The engine awaits `done`; a rejection before it does is not unhandled.
    done.catch(() => undefined);

    return { stream, done };
  }

  async openRead(key: string): Promise<Readable> {
    const file = this.pathOf(key);
    // Missing is a rejection here, not an error event later on the stream.
    await stat(file);
    return createReadStream(file);
  }

  async delete(key: string): Promise<void> {
    await rm(this.pathOf(key), { force: true });
  }

  async *list(prefix: string): AsyncIterable<BackupTargetObject> {
    const start = this.pathOf(prefix);
    const walk = async function* (directory: string): AsyncIterable<string> {
      let entries;
      try {
        entries = await readdir(directory, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        const full = join(directory, entry.name);
        if (entry.isDirectory()) yield* walk(full);
        else yield full;
      }
    };

    for await (const file of walk(start)) {
      const info = await stat(file);
      yield {
        key: file.slice(this.directory.length + 1).split(sep).join('/'),
        sizeBytes: info.size,
        lastModified: info.mtime,
      };
    }
  }
}

/**
 * The `mirrorTargets` binding for a directory: what an app puts in
 * `APP_BACKUP_MIRROR_TARGETS`.
 *
 * @param directory - the directory (default the system temp directory).
 * @param id - the target id.
 * @returns a provider binding the module builds the target from.
 */
export function localDirMirror(directory?: string, id?: string): PortBinding<BackupTarget> {
  return { useFactory: () => new LocalDirBackupTarget(directory, id) };
}
