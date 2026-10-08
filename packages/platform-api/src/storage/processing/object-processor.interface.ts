import { Readable } from 'node:stream';
import type { StorageObject } from '../data/storage-db';

/**
 * What one processor run reports. A failure is recorded on the object's row
 * (`<name>_error` in its metadata) and marks the object `failed`; it never
 * stops the other processors.
 *
 * @stability experimental
 */
export interface ObjectProcessorResult {
  /** Whether the processor succeeded. */
  success: boolean;
  /** Metadata to merge into the object's row, under the processor's name. */
  metadata?: Record<string, unknown>;
  /** Why it failed. */
  error?: string;
}

/**
 * A post-upload processor: runs on a worker slot (the server-only
 * `storage.object.process` job) for every uploaded object its `canProcess`
 * accepts. Register it with {@link ObjectProcessorRegistry} from its
 * `onModuleInit`.
 *
 * @stability experimental
 */
export interface ObjectProcessor {
  /**
   * Unique name for this processor
   */
  readonly name: string;

  /**
   * Priority order (lower = earlier). Default: 100
   */
  readonly priority: number;

  /**
   * Check if this processor can handle the given object
   */
  canProcess(object: StorageObject): boolean;

  /**
   * Process the object asynchronously
   * @param object The storage object metadata
   * @param getStream Function to get a fresh stream of the object content
   * @returns Processing result with optional metadata
   */
  process(
    object: StorageObject,
    getStream: () => Promise<Readable>,
  ): Promise<ObjectProcessorResult>;
}
