import { readdirSync, statSync, existsSync } from 'fs';
import { join, relative, sep, posix } from 'path';
import { apiUploadFile } from './api-client.js';
import {
  SyncDatabase,
  openSyncDatabase,
  TrackedFile,
  SyncStats,
} from './sync-database.js';
import type { StorageObjectResponse } from './storage-types.js';

/**
 * Local file info from filesystem scan
 */
export interface LocalFile {
  relativePath: string;
  absolutePath: string;
  size: number;
  mtime: number;
}

/**
 * Change detected during comparison
 */
export interface SyncChange {
  relativePath: string;
  action: 'new' | 'modified' | 'deleted';
  localFile?: LocalFile;
  trackedFile?: TrackedFile;
}

/**
 * Result of a sync operation
 */
export interface SyncResult {
  uploaded: number;
  failed: number;
  skipped: number;
  deleted: number;
  errors: Array<{ path: string; message: string }>;
}

/**
 * Sync options
 */
export interface SyncOptions {
  dryRun?: boolean;
  verbose?: boolean;
  onProgress?: (message: string) => void;
}

/**
 * Default patterns to ignore during sync
 */
const DEFAULT_IGNORE_PATTERNS = [
  'sync.db',
  'sync.db-journal',
  'sync.db-wal',
  'sync.db-shm',
  '.git',
  '.gitignore',
  'node_modules',
  '.DS_Store',
  'Thumbs.db',
  '.env',
  '.env.local',
];

/**
 * SyncEngine - Core sync logic for folder synchronization
 */
export class SyncEngine {
  private folderPath: string;
  private db: SyncDatabase;
  private ignorePatterns: string[];

  constructor(folderPath: string, ignorePatterns?: string[]) {
    this.folderPath = folderPath;
    this.db = openSyncDatabase(folderPath);
    this.ignorePatterns = ignorePatterns ?? DEFAULT_IGNORE_PATTERNS;
  }

  /**
   * Scan the folder recursively and return all files
   */
  scanDirectory(): LocalFile[] {
    const files: LocalFile[] = [];
    this.scanRecursive(this.folderPath, files);
    return files;
  }

  /**
   * Recursive directory scanning
   */
  private scanRecursive(currentPath: string, files: LocalFile[]): void {
    const entries = readdirSync(currentPath, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = join(currentPath, entry.name);
      const relativePath = this.toRelativePath(fullPath);

      // Skip ignored patterns
      if (this.shouldIgnore(entry.name, relativePath)) {
        continue;
      }

      if (entry.isDirectory()) {
        this.scanRecursive(fullPath, files);
      } else if (entry.isFile()) {
        try {
          const stats = statSync(fullPath);
          files.push({
            relativePath,
            absolutePath: fullPath,
            size: stats.size,
            mtime: stats.mtimeMs,
          });
        } catch {
          // Skip files we can't read
        }
      }
    }
  }

  /**
   * Convert absolute path to relative path (using forward slashes)
   */
  private toRelativePath(absolutePath: string): string {
    const rel = relative(this.folderPath, absolutePath);
    // Normalize to forward slashes for cross-platform consistency
    return rel.split(sep).join(posix.sep);
  }

  /**
   * Check if a file or directory should be ignored
   */
  private shouldIgnore(name: string, relativePath: string): boolean {
    for (const pattern of this.ignorePatterns) {
      if (name === pattern) return true;
      if (relativePath === pattern) return true;
      if (relativePath.startsWith(pattern + '/')) return true;
    }
    return false;
  }

  /**
   * Detect changes between local files and tracked state
   */
  detectChanges(): SyncChange[] {
    const localFiles = this.scanDirectory();
    const trackedFiles = this.db.getActiveFiles();

    const changes: SyncChange[] = [];

    // Build maps for efficient lookup
    const localMap = new Map<string, LocalFile>();
    for (const file of localFiles) {
      localMap.set(file.relativePath, file);
    }

    const trackedMap = new Map<string, TrackedFile>();
    for (const file of trackedFiles) {
      trackedMap.set(file.relativePath, file);
    }

    // Check for new and modified files
    for (const [path, localFile] of localMap) {
      const tracked = trackedMap.get(path);

      if (!tracked) {
        // New file
        changes.push({
          relativePath: path,
          action: 'new',
          localFile,
        });
      } else if (this.isModified(localFile, tracked)) {
        // Modified file
        changes.push({
          relativePath: path,
          action: 'modified',
          localFile,
          trackedFile: tracked,
        });
      }
    }

    // Check for deleted files
    for (const [path, tracked] of trackedMap) {
      if (!localMap.has(path)) {
        changes.push({
          relativePath: path,
          action: 'deleted',
          trackedFile: tracked,
        });
      }
    }

    return changes;
  }

  /**
   * Check if a file has been modified based on mtime or size
   */
  private isModified(local: LocalFile, tracked: TrackedFile): boolean {
    // Check if mtime has changed (with 1 second tolerance for filesystem precision)
    const mtimeDiff = Math.abs(local.mtime - tracked.localMtime);
    if (mtimeDiff > 1000) {
      return true;
    }

    // Check if size has changed
    if (local.size !== tracked.fileSize) {
      return true;
    }

    return false;
  }

  /**
   * Run the sync process
   */
  async runSync(options: SyncOptions = {}): Promise<SyncResult> {
    const { dryRun = false, verbose = false, onProgress } = options;

    const log = (msg: string) => {
      if (verbose && onProgress) {
        onProgress(msg);
      }
    };

    const result: SyncResult = {
      uploaded: 0,
      failed: 0,
      skipped: 0,
      deleted: 0,
      errors: [],
    };

    // Detect changes
    log('Scanning directory...');
    const changes = this.detectChanges();

    if (changes.length === 0) {
      log('No changes detected');
      return result;
    }

    log(`Found ${changes.length} changes`);

    // Process changes
    for (const change of changes) {
      if (change.action === 'deleted') {
        // Mark as deleted in database
        if (!dryRun) {
          this.db.markDeleted(change.relativePath);
        }
        result.deleted++;
        log(`Deleted: ${change.relativePath}`);
        continue;
      }

      // New or modified file - upload it
      if (!change.localFile) {
        continue;
      }

      const localFile = change.localFile;
      log(
        `${change.action === 'new' ? 'Uploading' : 'Re-uploading'}: ${change.relativePath}`
      );

      if (dryRun) {
        result.uploaded++;
        continue;
      }

      try {
        // First, upsert the file record with pending status
        this.db.upsertFile({
          relativePath: localFile.relativePath,
          fileSize: localFile.size,
          localMtime: localFile.mtime,
          syncStatus: 'pending',
        });

        // Upload the file
        const metadata = {
          syncFolder: this.folderPath,
          relativePath: localFile.relativePath,
          localMtime: localFile.mtime,
        };

        const response = await apiUploadFile(localFile.absolutePath, {
          metadata,
        });

        if (!response.ok) {
          const error = await response.json();
          throw new Error(
            (error as { message?: string }).message || 'Upload failed'
          );
        }

        const uploadResult =
          (await response.json()) as StorageObjectResponse;

        // Mark as synced with remote object ID
        this.db.markSynced(localFile.relativePath, uploadResult.data.id);
        result.uploaded++;
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : 'Unknown error';
        this.db.markError(localFile.relativePath, errorMessage);
        result.failed++;
        result.errors.push({
          path: localFile.relativePath,
          message: errorMessage,
        });
        log(`Error: ${change.relativePath} - ${errorMessage}`);
      }
    }

    // Update last sync time
    if (!dryRun) {
      this.db.updateLastSyncTime();
    }

    return result;
  }

  /**
   * Get sync status/statistics
   */
  getStatus(): SyncStats {
    return this.db.getStats();
  }

  /**
   * Get last sync time
   */
  getLastSyncTime(): number {
    return this.db.getLastSyncTime();
  }

  /**
   * Get files with errors
   */
  getErrorFiles(): TrackedFile[] {
    return this.db.getFilesByStatus('error');
  }

  /**
   * Get pending files
   */
  getPendingFiles(): TrackedFile[] {
    return this.db.getFilesByStatus('pending');
  }

  /**
   * Close the database connection
   */
  close(): void {
    this.db.close();
  }
}

/**
 * Check if a folder is a valid sync folder (has sync.db)
 */
export function isSyncFolder(folderPath: string): boolean {
  return existsSync(join(folderPath, 'sync.db'));
}
