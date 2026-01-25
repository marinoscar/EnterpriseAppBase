import {
  describe,
  expect,
  it,
  beforeEach,
  afterEach,
} from '@jest/globals';
import { mkdtempSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

// Import directly since this module doesn't need API mocking
import {
  SyncDatabase,
  createSyncDatabase,
  openSyncDatabase,
  syncDbExists,
} from '../../src/lib/sync-database.js';

describe('SyncDatabase', () => {
  let tempDir: string;
  let db: SyncDatabase;

  beforeEach(() => {
    // Create a temp directory for each test
    tempDir = mkdtempSync(join(tmpdir(), 'sync-test-'));
    db = createSyncDatabase(tempDir);
  });

  afterEach(() => {
    // Clean up
    if (db) {
      db.close();
    }
    if (tempDir && existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe('initialization', () => {
    it('should create sync.db file', () => {
      expect(existsSync(join(tempDir, 'sync.db'))).toBe(true);
    });

    it('should set initial config values', () => {
      expect(db.getConfig('schema_version')).toBe('1');
      expect(db.getConfig('sync_folder_path')).toBe(tempDir);
      expect(db.getConfig('initialized_at')).toBeDefined();
    });

    it('should initialize with zero last sync time', () => {
      expect(db.getLastSyncTime()).toBe(0);
    });
  });

  describe('file operations', () => {
    it('should upsert a new file', () => {
      db.upsertFile({
        relativePath: 'test/file.txt',
        fileSize: 1024,
        localMtime: 1000000000000,
      });

      const file = db.getFile('test/file.txt');
      expect(file).toBeDefined();
      expect(file?.relativePath).toBe('test/file.txt');
      expect(file?.fileSize).toBe(1024);
      expect(file?.localMtime).toBe(1000000000000);
      expect(file?.syncStatus).toBe('pending');
    });

    it('should update existing file on upsert', () => {
      db.upsertFile({
        relativePath: 'test/file.txt',
        fileSize: 1024,
        localMtime: 1000000000000,
      });

      db.upsertFile({
        relativePath: 'test/file.txt',
        fileSize: 2048,
        localMtime: 2000000000000,
      });

      const file = db.getFile('test/file.txt');
      expect(file?.fileSize).toBe(2048);
      expect(file?.localMtime).toBe(2000000000000);
    });

    it('should get all files', () => {
      db.upsertFile({
        relativePath: 'file1.txt',
        fileSize: 100,
        localMtime: 1000,
      });
      db.upsertFile({
        relativePath: 'file2.txt',
        fileSize: 200,
        localMtime: 2000,
      });

      const files = db.getAllFiles();
      expect(files.length).toBe(2);
    });

    it('should get files by status', () => {
      db.upsertFile({
        relativePath: 'pending.txt',
        fileSize: 100,
        localMtime: 1000,
        syncStatus: 'pending',
      });
      db.upsertFile({
        relativePath: 'synced.txt',
        fileSize: 200,
        localMtime: 2000,
        syncStatus: 'synced',
      });

      const pendingFiles = db.getFilesByStatus('pending');
      expect(pendingFiles.length).toBe(1);
      expect(pendingFiles[0].relativePath).toBe('pending.txt');

      const syncedFiles = db.getFilesByStatus('synced');
      expect(syncedFiles.length).toBe(1);
      expect(syncedFiles[0].relativePath).toBe('synced.txt');
    });

    it('should mark file as synced', () => {
      db.upsertFile({
        relativePath: 'file.txt',
        fileSize: 100,
        localMtime: 1000,
      });

      db.markSynced('file.txt', 'remote-object-id-123');

      const file = db.getFile('file.txt');
      expect(file?.syncStatus).toBe('synced');
      expect(file?.remoteObjectId).toBe('remote-object-id-123');
      expect(file?.lastSyncAt).toBeGreaterThan(0);
      expect(file?.errorMessage).toBeNull();
    });

    it('should mark file as error', () => {
      db.upsertFile({
        relativePath: 'file.txt',
        fileSize: 100,
        localMtime: 1000,
      });

      db.markError('file.txt', 'Upload failed');

      const file = db.getFile('file.txt');
      expect(file?.syncStatus).toBe('error');
      expect(file?.errorMessage).toBe('Upload failed');
    });

    it('should mark file as deleted', () => {
      db.upsertFile({
        relativePath: 'file.txt',
        fileSize: 100,
        localMtime: 1000,
      });

      db.markDeleted('file.txt');

      const file = db.getFile('file.txt');
      expect(file?.syncStatus).toBe('deleted');
    });

    it('should remove file record', () => {
      db.upsertFile({
        relativePath: 'file.txt',
        fileSize: 100,
        localMtime: 1000,
      });

      db.removeFile('file.txt');

      const file = db.getFile('file.txt');
      expect(file).toBeUndefined();
    });
  });

  describe('statistics', () => {
    it('should return correct stats', () => {
      db.upsertFile({
        relativePath: 'pending.txt',
        fileSize: 100,
        localMtime: 1000,
        syncStatus: 'pending',
      });
      db.upsertFile({
        relativePath: 'synced.txt',
        fileSize: 200,
        localMtime: 2000,
        syncStatus: 'synced',
      });
      db.upsertFile({
        relativePath: 'error.txt',
        fileSize: 300,
        localMtime: 3000,
        syncStatus: 'error',
      });

      const stats = db.getStats();
      expect(stats.totalFiles).toBe(3);
      expect(stats.pendingFiles).toBe(1);
      expect(stats.syncedFiles).toBe(1);
      expect(stats.errorFiles).toBe(1);
      expect(stats.deletedFiles).toBe(0);
      expect(stats.totalSize).toBe(600);
      expect(stats.syncedSize).toBe(200);
    });

    it('should return zero stats for empty database', () => {
      const stats = db.getStats();
      expect(stats.totalFiles).toBe(0);
      expect(stats.totalSize).toBe(0);
    });
  });

  describe('config operations', () => {
    it('should set and get config values', () => {
      db.setConfig('custom_key', 'custom_value');
      expect(db.getConfig('custom_key')).toBe('custom_value');
    });

    it('should update last sync time', () => {
      const before = Date.now();
      db.updateLastSyncTime();
      const after = Date.now();

      const lastSync = db.getLastSyncTime();
      expect(lastSync).toBeGreaterThanOrEqual(before);
      expect(lastSync).toBeLessThanOrEqual(after);
    });
  });

  describe('transactions', () => {
    it('should execute operations in transaction', () => {
      db.transaction(() => {
        db.upsertFile({
          relativePath: 'file1.txt',
          fileSize: 100,
          localMtime: 1000,
        });
        db.upsertFile({
          relativePath: 'file2.txt',
          fileSize: 200,
          localMtime: 2000,
        });
      });

      expect(db.getAllFiles().length).toBe(2);
    });
  });
});

describe('helper functions', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'sync-test-'));
  });

  afterEach(() => {
    if (tempDir && existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe('syncDbExists', () => {
    it('should return false when sync.db does not exist', () => {
      expect(syncDbExists(tempDir)).toBe(false);
    });

    it('should return true when sync.db exists', () => {
      const db = createSyncDatabase(tempDir);
      db.close();
      expect(syncDbExists(tempDir)).toBe(true);
    });
  });

  describe('openSyncDatabase', () => {
    it('should throw when sync.db does not exist', () => {
      expect(() => openSyncDatabase(tempDir)).toThrow(/No sync.db found/);
    });

    it('should open existing database', () => {
      const db1 = createSyncDatabase(tempDir);
      db1.upsertFile({
        relativePath: 'test.txt',
        fileSize: 100,
        localMtime: 1000,
      });
      db1.close();

      const db2 = openSyncDatabase(tempDir);
      const file = db2.getFile('test.txt');
      db2.close();

      expect(file).toBeDefined();
      expect(file?.relativePath).toBe('test.txt');
    });
  });
});
