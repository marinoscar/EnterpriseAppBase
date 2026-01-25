import { existsSync, statSync } from 'fs';
import { resolve } from 'path';
import { Command } from 'commander';
import { apiRequest, apiUploadFile } from '../lib/api-client.js';
import * as output from '../utils/output.js';
import type {
  StorageObject,
  StorageObjectListResponse,
  StorageObjectResponse,
  DownloadUrlResponse,
  StorageObjectStatus,
} from '../lib/storage-types.js';

interface ErrorResponse {
  message?: string;
}

interface ListOptions {
  page?: number;
  limit?: number;
  status?: StorageObjectStatus;
  json?: boolean;
}

interface GetOptions {
  json?: boolean;
}

interface DownloadOptions {
  open?: boolean;
}

interface DeleteOptions {
  force?: boolean;
}

/**
 * Format file size in human readable format
 */
function formatSize(bytes: string | number): string {
  const size = typeof bytes === 'string' ? parseInt(bytes, 10) : bytes;
  if (size === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(size) / Math.log(1024));
  return `${(size / Math.pow(1024, i)).toFixed(i > 0 ? 1 : 0)} ${units[i]}`;
}

/**
 * Format date for display
 */
function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleString();
}

/**
 * List storage objects
 */
async function listObjects(options: ListOptions): Promise<void> {
  const params = new URLSearchParams();
  if (options.page) params.set('page', options.page.toString());
  if (options.limit) params.set('pageSize', options.limit.toString());
  if (options.status) params.set('status', options.status);

  const query = params.toString();
  const path = `/storage/objects${query ? `?${query}` : ''}`;

  const response = await apiRequest(path);

  if (!response.ok) {
    const error = (await response.json()) as ErrorResponse;
    throw new Error(error.message || 'Failed to list storage objects');
  }

  const result = (await response.json()) as StorageObjectListResponse;

  if (options.json) {
    console.log(JSON.stringify(result.data, null, 2));
    return;
  }

  output.header('Storage Objects');
  output.blank();

  if (result.data.items.length === 0) {
    output.info('No objects found');
    return;
  }

  const widths = [36, 30, 10, 12, 20];
  output.tableHeader(['ID', 'NAME', 'SIZE', 'STATUS', 'CREATED'], widths);

  for (const obj of result.data.items) {
    output.tableRow(
      [
        obj.id,
        obj.name.length > 28 ? obj.name.substring(0, 25) + '...' : obj.name,
        formatSize(obj.size),
        obj.status,
        formatDate(obj.createdAt),
      ],
      widths
    );
  }

  output.blank();
  output.dim(
    `Page ${result.data.meta.page} of ${result.data.meta.totalPages} (${result.data.meta.totalItems} total)`
  );
}

/**
 * Get a single storage object by ID
 */
async function getObject(id: string, options: GetOptions): Promise<void> {
  const response = await apiRequest(`/storage/objects/${id}`);

  if (!response.ok) {
    const error = (await response.json()) as ErrorResponse;
    throw new Error(error.message || 'Failed to get object');
  }

  const result = (await response.json()) as StorageObjectResponse;

  if (options.json) {
    console.log(JSON.stringify(result.data, null, 2));
    return;
  }

  const obj = result.data;
  output.header('Object Details');
  output.blank();
  output.keyValue('ID', obj.id);
  output.keyValue('Name', obj.name);
  output.keyValue('Size', formatSize(obj.size));
  output.keyValue('MIME Type', obj.mimeType);
  output.keyValue('Status', obj.status);
  output.keyValue('Created', formatDate(obj.createdAt));
  output.keyValue('Updated', formatDate(obj.updatedAt));

  if (obj.metadata && Object.keys(obj.metadata).length > 0) {
    output.blank();
    output.bold('Metadata:');
    console.log(JSON.stringify(obj.metadata, null, 2));
  }
}

/**
 * Get download URL for an object
 */
async function downloadObject(
  id: string,
  options: DownloadOptions
): Promise<void> {
  const response = await apiRequest(`/storage/objects/${id}/download`);

  if (!response.ok) {
    const error = (await response.json()) as ErrorResponse;
    throw new Error(error.message || 'Failed to get download URL');
  }

  const result = (await response.json()) as DownloadUrlResponse;

  if (options.open) {
    const open = (await import('open')).default;
    await open(result.data.url);
    output.success('Opened download URL in browser');
    return;
  }

  output.header('Download URL');
  output.blank();
  console.log(result.data.url);
  output.blank();
  output.dim(`Expires in ${result.data.expiresIn} seconds`);
}

/**
 * Delete a storage object
 */
async function deleteObject(id: string, options: DeleteOptions): Promise<void> {
  if (!options.force) {
    const inquirer = (await import('inquirer')).default;
    const { confirm } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'confirm',
        message: `Are you sure you want to delete object ${id}?`,
        default: false,
      },
    ]);

    if (!confirm) {
      output.info('Delete cancelled');
      return;
    }
  }

  const response = await apiRequest(`/storage/objects/${id}`, {
    method: 'DELETE',
  });

  if (!response.ok) {
    const error = (await response.json()) as ErrorResponse;
    throw new Error(error.message || 'Failed to delete object');
  }

  output.success(`Object ${id} deleted`);
}

interface UploadOptions {
  json?: boolean;
}

/**
 * Upload a file to storage
 */
async function uploadFile(
  filePath: string,
  options: UploadOptions
): Promise<void> {
  const absolutePath = resolve(filePath);

  if (!existsSync(absolutePath)) {
    throw new Error(`File not found: ${absolutePath}`);
  }

  const stats = statSync(absolutePath);
  if (!stats.isFile()) {
    throw new Error(`Not a file: ${absolutePath}`);
  }

  output.info(`Uploading ${filePath} (${formatSize(stats.size)})...`);

  const response = await apiUploadFile(absolutePath);

  if (!response.ok) {
    const error = (await response.json()) as ErrorResponse;
    throw new Error(error.message || 'Failed to upload file');
  }

  const result = (await response.json()) as StorageObjectResponse;

  if (options.json) {
    console.log(JSON.stringify(result.data, null, 2));
    return;
  }

  output.success('File uploaded successfully');
  output.blank();
  output.keyValue('ID', result.data.id);
  output.keyValue('Name', result.data.name);
  output.keyValue('Size', formatSize(result.data.size));
  output.keyValue('Status', result.data.status);
}

/**
 * Register storage commands with Commander
 */
export function registerStorageCommands(program: Command): void {
  const storageCmd = program
    .command('storage')
    .description('Storage management commands');

  storageCmd
    .command('list')
    .description('List storage objects')
    .option('--page <number>', 'Page number', '1')
    .option('--limit <number>', 'Items per page', '20')
    .option(
      '--status <status>',
      'Filter by status (pending, uploading, processing, ready, failed)'
    )
    .option('--json', 'Output as JSON')
    .action(async (options) => {
      try {
        await listObjects({
          page: parseInt(options.page, 10),
          limit: parseInt(options.limit, 10),
          status: options.status as StorageObjectStatus | undefined,
          json: options.json,
        });
      } catch (error) {
        output.error((error as Error).message);
        process.exit(1);
      }
    });

  storageCmd
    .command('get')
    .description('Get storage object details')
    .argument('<id>', 'Object ID')
    .option('--json', 'Output as JSON')
    .action(async (id: string, options) => {
      try {
        await getObject(id, { json: options.json });
      } catch (error) {
        output.error((error as Error).message);
        process.exit(1);
      }
    });

  storageCmd
    .command('download')
    .description('Get download URL for an object')
    .argument('<id>', 'Object ID')
    .option('--open', 'Open URL in browser')
    .action(async (id: string, options) => {
      try {
        await downloadObject(id, { open: options.open });
      } catch (error) {
        output.error((error as Error).message);
        process.exit(1);
      }
    });

  storageCmd
    .command('upload')
    .description('Upload a file to storage')
    .argument('<file>', 'File path to upload')
    .option('--json', 'Output as JSON')
    .action(async (file: string, options) => {
      try {
        await uploadFile(file, { json: options.json });
      } catch (error) {
        output.error((error as Error).message);
        process.exit(1);
      }
    });

  storageCmd
    .command('delete')
    .description('Delete a storage object')
    .argument('<id>', 'Object ID')
    .option('--force', 'Skip confirmation')
    .action(async (id: string, options) => {
      try {
        await deleteObject(id, { force: options.force });
      } catch (error) {
        output.error((error as Error).message);
        process.exit(1);
      }
    });
}

// Export for interactive mode
export { listObjects, getObject, downloadObject, uploadFile, deleteObject };
