import { existsSync, rmSync } from 'fs';
import { resolve } from 'path';
import { Command } from 'commander';
import * as output from '../utils/output.js';
import {
  createSyncDatabase,
  syncDbExists,
  openSyncDatabase,
} from '../lib/sync-database.js';
import { SyncEngine, isSyncFolder } from '../lib/sync-engine.js';

/**
 * Format file size in human readable format
 */
function formatSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(i > 0 ? 1 : 0)} ${units[i]}`;
}

/**
 * Format timestamp for display
 */
function formatTime(timestamp: number): string {
  if (timestamp === 0) return 'Never';
  return new Date(timestamp).toLocaleString();
}

/**
 * Initialize a sync folder
 */
async function initSync(folderPath: string): Promise<void> {
  const absolutePath = resolve(folderPath);

  if (!existsSync(absolutePath)) {
    throw new Error(`Folder does not exist: ${absolutePath}`);
  }

  if (syncDbExists(absolutePath)) {
    const inquirer = (await import('inquirer')).default;
    const { confirm } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'confirm',
        message: 'sync.db already exists. Reinitialize? (This will reset sync state)',
        default: false,
      },
    ]);

    if (!confirm) {
      output.info('Initialization cancelled');
      return;
    }

    // Remove existing sync.db files
    rmSync(resolve(absolutePath, 'sync.db'), { force: true });
    rmSync(resolve(absolutePath, 'sync.db-journal'), { force: true });
    rmSync(resolve(absolutePath, 'sync.db-wal'), { force: true });
    rmSync(resolve(absolutePath, 'sync.db-shm'), { force: true });
  }

  const db = createSyncDatabase(absolutePath);
  db.close();

  output.success(`Sync folder initialized at ${absolutePath}`);
  output.blank();
  output.info('Next steps:');
  output.dim(`  1. Run 'app sync run ${folderPath}' to sync files`);
  output.dim(`  2. Run 'app sync status ${folderPath}' to check sync status`);
}

interface RunSyncOptions {
  dryRun?: boolean;
  verbose?: boolean;
}

/**
 * Run sync for a folder
 */
async function runSync(
  folderPath: string,
  options: RunSyncOptions
): Promise<void> {
  const absolutePath = resolve(folderPath);

  if (!existsSync(absolutePath)) {
    throw new Error(`Folder does not exist: ${absolutePath}`);
  }

  if (!isSyncFolder(absolutePath)) {
    throw new Error(
      `Not a sync folder: ${absolutePath}\nRun 'app sync init ${folderPath}' first`
    );
  }

  const engine = new SyncEngine(absolutePath);

  try {
    if (options.dryRun) {
      output.info('Dry run mode - no changes will be made');
      output.blank();
    }

    output.info('Scanning for changes...');

    const result = await engine.runSync({
      dryRun: options.dryRun,
      verbose: options.verbose,
      onProgress: (msg) => {
        if (options.verbose) {
          output.dim(`  ${msg}`);
        }
      },
    });

    output.blank();

    if (
      result.uploaded === 0 &&
      result.failed === 0 &&
      result.deleted === 0
    ) {
      output.success('Already in sync - no changes needed');
      return;
    }

    output.header('Sync Results');
    output.blank();

    if (result.uploaded > 0) {
      output.success(`Uploaded: ${result.uploaded} file(s)`);
    }
    if (result.deleted > 0) {
      output.info(`Deleted locally: ${result.deleted} file(s)`);
    }
    if (result.failed > 0) {
      output.error(`Failed: ${result.failed} file(s)`);

      if (result.errors.length > 0) {
        output.blank();
        output.bold('Errors:');
        for (const error of result.errors) {
          output.dim(`  ${error.path}: ${error.message}`);
        }
      }
    }

    if (options.dryRun) {
      output.blank();
      output.info('This was a dry run. Run without --dry-run to apply changes.');
    }
  } finally {
    engine.close();
  }
}

/**
 * Show sync status for a folder
 */
async function syncStatus(folderPath: string): Promise<void> {
  const absolutePath = resolve(folderPath);

  if (!existsSync(absolutePath)) {
    throw new Error(`Folder does not exist: ${absolutePath}`);
  }

  if (!isSyncFolder(absolutePath)) {
    throw new Error(
      `Not a sync folder: ${absolutePath}\nRun 'app sync init ${folderPath}' first`
    );
  }

  const engine = new SyncEngine(absolutePath);

  try {
    const stats = engine.getStatus();
    const lastSync = engine.getLastSyncTime();
    const errorFiles = engine.getErrorFiles();
    const pendingFiles = engine.getPendingFiles();

    output.header('Sync Status');
    output.blank();
    output.keyValue('Folder', absolutePath);
    output.keyValue('Last Sync', formatTime(lastSync));
    output.blank();

    output.bold('Files:');
    output.keyValue('  Total', stats.totalFiles.toString());
    output.keyValue('  Synced', stats.syncedFiles.toString());
    output.keyValue('  Pending', stats.pendingFiles.toString());
    output.keyValue('  Errors', stats.errorFiles.toString());
    output.keyValue('  Deleted', stats.deletedFiles.toString());
    output.blank();

    output.bold('Storage:');
    output.keyValue('  Total Size', formatSize(stats.totalSize));
    output.keyValue('  Synced Size', formatSize(stats.syncedSize));

    // Check for pending changes
    const changes = engine.detectChanges();
    if (changes.length > 0) {
      output.blank();
      output.warn(`${changes.length} pending change(s) detected`);
      output.dim("Run 'app sync run' to synchronize");
    }

    // Show error files if any
    if (errorFiles.length > 0) {
      output.blank();
      output.bold('Files with errors:');
      for (const file of errorFiles.slice(0, 10)) {
        output.error(`  ${file.relativePath}`);
        if (file.errorMessage) {
          output.dim(`    ${file.errorMessage}`);
        }
      }
      if (errorFiles.length > 10) {
        output.dim(`  ... and ${errorFiles.length - 10} more`);
      }
    }

    // Show pending files if any (up to 10)
    if (pendingFiles.length > 0) {
      output.blank();
      output.bold('Files pending upload:');
      for (const file of pendingFiles.slice(0, 10)) {
        output.info(`  ${file.relativePath}`);
      }
      if (pendingFiles.length > 10) {
        output.dim(`  ... and ${pendingFiles.length - 10} more`);
      }
    }
  } finally {
    engine.close();
  }
}

interface ResetSyncOptions {
  force?: boolean;
}

/**
 * Reset sync state for a folder
 */
async function resetSync(
  folderPath: string,
  options: ResetSyncOptions
): Promise<void> {
  const absolutePath = resolve(folderPath);

  if (!existsSync(absolutePath)) {
    throw new Error(`Folder does not exist: ${absolutePath}`);
  }

  if (!isSyncFolder(absolutePath)) {
    throw new Error(`Not a sync folder: ${absolutePath}`);
  }

  if (!options.force) {
    const inquirer = (await import('inquirer')).default;
    const { confirm } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'confirm',
        message:
          'This will delete all sync tracking data. Files will not be deleted. Continue?',
        default: false,
      },
    ]);

    if (!confirm) {
      output.info('Reset cancelled');
      return;
    }
  }

  // Remove sync.db files
  rmSync(resolve(absolutePath, 'sync.db'), { force: true });
  rmSync(resolve(absolutePath, 'sync.db-journal'), { force: true });
  rmSync(resolve(absolutePath, 'sync.db-wal'), { force: true });
  rmSync(resolve(absolutePath, 'sync.db-shm'), { force: true });

  output.success('Sync state reset');
  output.info(`Run 'app sync init ${folderPath}' to reinitialize`);
}

/**
 * Register sync commands with Commander
 */
export function registerSyncCommands(program: Command): void {
  const syncCmd = program
    .command('sync')
    .description('Folder synchronization commands');

  syncCmd
    .command('init')
    .description('Initialize a folder for synchronization')
    .argument('<folder>', 'Folder path to initialize')
    .action(async (folder: string) => {
      try {
        await initSync(folder);
      } catch (error) {
        output.error((error as Error).message);
        process.exit(1);
      }
    });

  syncCmd
    .command('run')
    .description('Run synchronization for a folder')
    .argument('<folder>', 'Folder path to sync')
    .option('--dry-run', 'Preview changes without uploading')
    .option('--verbose', 'Show detailed progress')
    .action(async (folder: string, options) => {
      try {
        await runSync(folder, {
          dryRun: options.dryRun,
          verbose: options.verbose,
        });
      } catch (error) {
        output.error((error as Error).message);
        process.exit(1);
      }
    });

  syncCmd
    .command('status')
    .description('Show synchronization status for a folder')
    .argument('<folder>', 'Folder path to check')
    .action(async (folder: string) => {
      try {
        await syncStatus(folder);
      } catch (error) {
        output.error((error as Error).message);
        process.exit(1);
      }
    });

  syncCmd
    .command('reset')
    .description('Reset synchronization state for a folder')
    .argument('<folder>', 'Folder path to reset')
    .option('--force', 'Skip confirmation')
    .action(async (folder: string, options) => {
      try {
        await resetSync(folder, { force: options.force });
      } catch (error) {
        output.error((error as Error).message);
        process.exit(1);
      }
    });
}

// Export for interactive mode
export { initSync, runSync, syncStatus, resetSync };
