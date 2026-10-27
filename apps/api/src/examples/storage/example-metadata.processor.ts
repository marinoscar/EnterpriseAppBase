import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { Readable } from 'node:stream';
import {
  ObjectProcessorRegistry,
  type ObjectProcessor,
  type ObjectProcessorResult,
  type StorageObject,
} from '@marinoscar/platform-api/storage';

/**
 * The media type this example opts in to. Narrow on purpose: a processor that
 * accepts every object turns every upload in the reference app into a queued
 * `storage.object.process` job instead of an instantly `ready` object. Upload a
 * file with this type to watch the pipeline run.
 */
export const EXAMPLE_METADATA_MIME_TYPE = 'application/x-example-metadata';

/**
 * The reference example of the object-processor registry (#736): a processor
 * that reads the first bytes of an uploaded file and records basic metadata.
 *
 * It self-registers from `onModuleInit`, the pattern of job handlers and
 * Doctor checks; `ExamplesModule` provides it and imports
 * `ObjectProcessingModule` for the registry. Recipe: ./README.md.
 */
@Injectable()
export class ExampleMetadataProcessor implements ObjectProcessor, OnModuleInit {
  private readonly logger = new Logger(ExampleMetadataProcessor.name);

  constructor(private readonly registry: ObjectProcessorRegistry) {}

  /** Self-registration: the only wiring a processor needs. */
  onModuleInit(): void {
    this.registry.register(this);
  }

  readonly name = 'example-metadata';
  readonly priority = 100; // Default priority

  /**
   * This example processor handles all objects
   */
  canProcess(object: StorageObject): boolean {
    return object.mimeType === EXAMPLE_METADATA_MIME_TYPE;
  }

  async process(
    object: StorageObject,
    getStream: () => Promise<Readable>,
  ): Promise<ObjectProcessorResult> {
    try {
      this.logger.debug(`Processing object: ${object.id}`);

      // Example: Read first few bytes to detect file signature
      const stream = await getStream();
      const firstChunk = await this.readFirstChunk(stream, 16);

      // Example metadata extraction
      const metadata = {
        processedAt: new Date().toISOString(),
        objectId: object.id,
        fileName: object.name,
        fileSize: object.size.toString(),
        mimeType: object.mimeType,
        firstBytes: firstChunk ? this.bytesToHex(firstChunk) : null,
      };

      this.logger.debug(`Extracted metadata for object ${object.id}`);

      return {
        success: true,
        metadata,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`Failed to process object ${object.id}: ${errorMessage}`);

      return {
        success: false,
        error: errorMessage,
      };
    }
  }

  /**
   * Read first N bytes from stream
   */
  private async readFirstChunk(
    stream: Readable,
    bytes: number,
  ): Promise<Buffer | null> {
    return new Promise((resolve, reject) => {
      let chunk: Buffer | null = null;

      const onData = (data: Buffer) => {
        chunk = data.subarray(0, bytes);
        cleanup();
        resolve(chunk);
      };

      const onError = (error: Error) => {
        cleanup();
        reject(error);
      };

      const onEnd = () => {
        cleanup();
        resolve(chunk);
      };

      const cleanup = () => {
        stream.removeListener('data', onData);
        stream.removeListener('error', onError);
        stream.removeListener('end', onEnd);
        stream.destroy();
      };

      stream.once('data', onData);
      stream.once('error', onError);
      stream.once('end', onEnd);
    });
  }

  /**
   * Convert bytes to hex string
   */
  private bytesToHex(buffer: Buffer): string {
    return Array.from(buffer)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join(' ');
  }
}
