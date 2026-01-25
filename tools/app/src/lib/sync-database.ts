import Database from 'better-sqlite3';
import { existsSync } from 'fs';
import { join } from 'path';

/**
 * Sync status for tracked files
 */
export type SyncStatus = 'pending' | 'synced' | 'error' | 'deleted';

/**
 * Tracked file record
 */
export interface TrackedFile {
  id: number;
  relativePath: string;
  fileSize: number;
  localMtime: number;
  remoteObjectId: string | null;
  syncStatus: SyncStatus;
  lastSyncAt: number | null;
  errorMessage: string | null;
  createdAt: number;
  updatedAt: number;
}

/**
 * Sync statistics
 */
export interface SyncStats {
  totalFiles: number;
  syncedFiles: number;
  pendingFiles: number;
  errorFiles: number;
  deletedFiles: number;
  totalSize: number;
  syncedSize: number;
}

/**
 * File data for upserting
 */
export interface FileData {
  relativePath: string;
  fileSize: number;
  localMtime: number;
  remoteObjectId?: string | null;
  syncStatus?: SyncStatus;
  errorMessage?: string | null;
}

const SCHEMA_SQL = `
-- Schema version for future migrations
CREATE TABLE IF NOT EXISTS schema_version (
  version INTEGER PRIMARY KEY
);

-- Tracked files
CREATE TABLE IF NOT EXISTS files (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  relative_path TEXT NOT NULL UNIQUE,
  file_size INTEGER NOT NULL,
  local_mtime INTEGER NOT NULL,
  remote_object_id TEXT,
  sync_status TEXT NOT NULL DEFAULT 'pending',
  last_sync_at INTEGER,
  error_message TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_files_sync_status ON files(sync_status);
CREATE INDEX IF NOT EXISTS idx_files_relative_path ON files(relative_path);

-- Sync configuration
CREATE TABLE IF NOT EXISTS sync_config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;

const INITIAL_CONFIG_SQL = `
INSERT OR IGNORE INTO sync_config (key, value) VALUES ('schema_version', '1');
INSERT OR IGNORE INTO sync_config (key, value) VALUES ('last_sync_at', '0');
`;

/**
 * SyncDatabase - SQLite database wrapper for sync.db operations
 */
export class SyncDatabase {
  private db: Database.Database;
  private folderPath: string;

  constructor(folderPath: string) {
    this.folderPath = folderPath;
    const dbPath = join(folderPath, 'sync.db');
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
  }

  /**
   * Initialize the database schema
   */
  initSchema(): void {
    this.db.exec(SCHEMA_SQL);
    this.db.exec(INITIAL_CONFIG_SQL);

    // Store the folder path in config
    const stmt = this.db.prepare(
      'INSERT OR REPLACE INTO sync_config (key, value) VALUES (?, ?)'
    );
    stmt.run('sync_folder_path', this.folderPath);
    stmt.run('initialized_at', Date.now().toString());
  }

  /**
   * Get a tracked file by relative path
   */
  getFile(relativePath: string): TrackedFile | undefined {
    const stmt = this.db.prepare(
      'SELECT * FROM files WHERE relative_path = ?'
    );
    const row = stmt.get(relativePath) as TrackedFileRow | undefined;
    return row ? this.mapRowToFile(row) : undefined;
  }

  /**
   * Get all tracked files
   */
  getAllFiles(): TrackedFile[] {
    const stmt = this.db.prepare('SELECT * FROM files');
    const rows = stmt.all() as TrackedFileRow[];
    return rows.map((row) => this.mapRowToFile(row));
  }

  /**
   * Get files by sync status
   */
  getFilesByStatus(status: SyncStatus): TrackedFile[] {
    const stmt = this.db.prepare('SELECT * FROM files WHERE sync_status = ?');
    const rows = stmt.all(status) as TrackedFileRow[];
    return rows.map((row) => this.mapRowToFile(row));
  }

  /**
   * Get files that are not deleted (for comparison with local files)
   */
  getActiveFiles(): TrackedFile[] {
    const stmt = this.db.prepare(
      "SELECT * FROM files WHERE sync_status != 'deleted'"
    );
    const rows = stmt.all() as TrackedFileRow[];
    return rows.map((row) => this.mapRowToFile(row));
  }

  /**
   * Upsert a file record
   */
  upsertFile(data: FileData): void {
    const now = Date.now();
    const existing = this.getFile(data.relativePath);

    if (existing) {
      const stmt = this.db.prepare(`
        UPDATE files SET
          file_size = ?,
          local_mtime = ?,
          remote_object_id = COALESCE(?, remote_object_id),
          sync_status = COALESCE(?, sync_status),
          error_message = ?,
          updated_at = ?
        WHERE relative_path = ?
      `);
      stmt.run(
        data.fileSize,
        data.localMtime,
        data.remoteObjectId ?? null,
        data.syncStatus ?? null,
        data.errorMessage ?? null,
        now,
        data.relativePath
      );
    } else {
      const stmt = this.db.prepare(`
        INSERT INTO files (
          relative_path, file_size, local_mtime, remote_object_id,
          sync_status, error_message, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);
      stmt.run(
        data.relativePath,
        data.fileSize,
        data.localMtime,
        data.remoteObjectId ?? null,
        data.syncStatus ?? 'pending',
        data.errorMessage ?? null,
        now,
        now
      );
    }
  }

  /**
   * Mark a file as synced
   */
  markSynced(relativePath: string, remoteObjectId: string): void {
    const now = Date.now();
    const stmt = this.db.prepare(`
      UPDATE files SET
        remote_object_id = ?,
        sync_status = 'synced',
        last_sync_at = ?,
        error_message = NULL,
        updated_at = ?
      WHERE relative_path = ?
    `);
    stmt.run(remoteObjectId, now, now, relativePath);
  }

  /**
   * Mark a file as having an error
   */
  markError(relativePath: string, errorMessage: string): void {
    const now = Date.now();
    const stmt = this.db.prepare(`
      UPDATE files SET
        sync_status = 'error',
        error_message = ?,
        updated_at = ?
      WHERE relative_path = ?
    `);
    stmt.run(errorMessage, now, relativePath);
  }

  /**
   * Mark a file as deleted (locally)
   */
  markDeleted(relativePath: string): void {
    const now = Date.now();
    const stmt = this.db.prepare(`
      UPDATE files SET
        sync_status = 'deleted',
        updated_at = ?
      WHERE relative_path = ?
    `);
    stmt.run(now, relativePath);
  }

  /**
   * Remove a file record completely
   */
  removeFile(relativePath: string): void {
    const stmt = this.db.prepare('DELETE FROM files WHERE relative_path = ?');
    stmt.run(relativePath);
  }

  /**
   * Get sync statistics
   */
  getStats(): SyncStats {
    const stmt = this.db.prepare(`
      SELECT
        COUNT(*) as total_files,
        SUM(CASE WHEN sync_status = 'synced' THEN 1 ELSE 0 END) as synced_files,
        SUM(CASE WHEN sync_status = 'pending' THEN 1 ELSE 0 END) as pending_files,
        SUM(CASE WHEN sync_status = 'error' THEN 1 ELSE 0 END) as error_files,
        SUM(CASE WHEN sync_status = 'deleted' THEN 1 ELSE 0 END) as deleted_files,
        COALESCE(SUM(file_size), 0) as total_size,
        COALESCE(SUM(CASE WHEN sync_status = 'synced' THEN file_size ELSE 0 END), 0) as synced_size
      FROM files
    `);
    const row = stmt.get() as StatsRow;

    return {
      totalFiles: row.total_files,
      syncedFiles: row.synced_files,
      pendingFiles: row.pending_files,
      errorFiles: row.error_files,
      deletedFiles: row.deleted_files,
      totalSize: row.total_size,
      syncedSize: row.synced_size,
    };
  }

  /**
   * Get the last sync timestamp
   */
  getLastSyncTime(): number {
    const stmt = this.db.prepare(
      "SELECT value FROM sync_config WHERE key = 'last_sync_at'"
    );
    const row = stmt.get() as { value: string } | undefined;
    return row ? parseInt(row.value, 10) : 0;
  }

  /**
   * Update the last sync timestamp
   */
  updateLastSyncTime(): void {
    const stmt = this.db.prepare(
      "UPDATE sync_config SET value = ? WHERE key = 'last_sync_at'"
    );
    stmt.run(Date.now().toString());
  }

  /**
   * Get a config value
   */
  getConfig(key: string): string | undefined {
    const stmt = this.db.prepare(
      'SELECT value FROM sync_config WHERE key = ?'
    );
    const row = stmt.get(key) as { value: string } | undefined;
    return row?.value;
  }

  /**
   * Set a config value
   */
  setConfig(key: string, value: string): void {
    const stmt = this.db.prepare(
      'INSERT OR REPLACE INTO sync_config (key, value) VALUES (?, ?)'
    );
    stmt.run(key, value);
  }

  /**
   * Run operations in a transaction
   */
  transaction<T>(fn: () => T): T {
    return this.db.transaction(fn)();
  }

  /**
   * Close the database connection
   */
  close(): void {
    this.db.close();
  }

  /**
   * Map database row to TrackedFile interface
   */
  private mapRowToFile(row: TrackedFileRow): TrackedFile {
    return {
      id: row.id,
      relativePath: row.relative_path,
      fileSize: row.file_size,
      localMtime: row.local_mtime,
      remoteObjectId: row.remote_object_id,
      syncStatus: row.sync_status as SyncStatus,
      lastSyncAt: row.last_sync_at,
      errorMessage: row.error_message,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}

/**
 * Internal type for database rows
 */
interface TrackedFileRow {
  id: number;
  relative_path: string;
  file_size: number;
  local_mtime: number;
  remote_object_id: string | null;
  sync_status: string;
  last_sync_at: number | null;
  error_message: string | null;
  created_at: number;
  updated_at: number;
}

interface StatsRow {
  total_files: number;
  synced_files: number;
  pending_files: number;
  error_files: number;
  deleted_files: number;
  total_size: number;
  synced_size: number;
}

/**
 * Check if a sync.db exists in a folder
 */
export function syncDbExists(folderPath: string): boolean {
  return existsSync(join(folderPath, 'sync.db'));
}

/**
 * Open an existing sync database
 */
export function openSyncDatabase(folderPath: string): SyncDatabase {
  if (!syncDbExists(folderPath)) {
    throw new Error(`No sync.db found in ${folderPath}. Run: app sync init`);
  }
  return new SyncDatabase(folderPath);
}

/**
 * Create a new sync database
 */
export function createSyncDatabase(folderPath: string): SyncDatabase {
  const db = new SyncDatabase(folderPath);
  db.initSchema();
  return db;
}
