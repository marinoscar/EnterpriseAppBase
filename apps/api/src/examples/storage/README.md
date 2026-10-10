# Storage Object Processors

The reference example of the storage slice's object-processor registry (`ObjectProcessorRegistry` of `@marinoscar/platform-api/storage`, issue #736): `example-metadata.processor.ts`, registered by `examples/examples.module.ts`, and its spec. The recipe below is how an app adds its own; the slice's [README](../../../../../packages/platform-api/src/storage/README.md) documents the contract.

## Overview

Processors are pluggable components that run asynchronously after a file is uploaded. They can:
- Extract metadata (dimensions, duration, etc.)
- Generate thumbnails or previews
- Scan for viruses
- Validate file integrity
- Index content for search
- Any other post-upload processing

## Creating a Processor

### 1. Implement the `ObjectProcessor` Interface

```typescript
import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { Readable } from 'node:stream';
import {
  ObjectProcessorRegistry,
  type ObjectProcessor,
  type ObjectProcessorResult,
  type StorageObject,
} from '@marinoscar/platform-api/storage';

@Injectable()
export class MyCustomProcessor implements ObjectProcessor, OnModuleInit {
  private readonly logger = new Logger(MyCustomProcessor.name);

  readonly name = 'my-custom-processor';
  readonly priority = 100; // Lower = runs earlier

  constructor(private readonly registry: ObjectProcessorRegistry) {}

  /** Self-registration: the only wiring a processor needs. */
  onModuleInit(): void {
    this.registry.register(this);
  }

  canProcess(object: StorageObject): boolean {
    // Return true if this processor should handle this object
    return object.mimeType.startsWith('image/');
  }

  async process(
    object: StorageObject,
    getStream: () => Promise<Readable>,
  ): Promise<ObjectProcessorResult> {
    try {
      // Get a fresh stream of the file content
      const stream = await getStream();

      // Do your processing...
      const metadata = {
        // Your extracted metadata
      };

      return {
        success: true,
        metadata,
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
      };
    }
  }
}
```

### 2. Provide it next to the registry

Provide the processor in a module that imports `ObjectProcessingModule` (a static module: every importer shares the one registry `StorageModule.forRoot()` uses):

```typescript
import { Module } from '@nestjs/common';
import { ObjectProcessingModule } from '@marinoscar/platform-api/storage';
import { MyCustomProcessor } from './my-custom.processor';

@Module({
  imports: [ObjectProcessingModule],
  providers: [MyCustomProcessor],
})
export class MyProcessorsModule {}
```

### 3. Several processors

Provide each one; each registers itself. Lower `priority` runs first (ties in registration order); a second processor with the same `name` replaces the first, with a warning. The optional `OBJECT_PROCESSOR` token of #520 is gone (#736).

### 4. Keep `canProcess` narrow

`canProcess(object)` is a synchronous, I/O-free predicate over the row, asked when an upload completes. Every upload a processor accepts becomes a queued job instead of an instantly `ready` object, which is why the example opts in to one media type only (`application/x-example-metadata`).

## Processor Lifecycle

Post-upload processing is the server-only queue job `storage.object.process`
(`packages/platform-api/src/storage/handlers/storage-object-process.handler.ts`), not an
event listener:

1. **Upload completes**: inside the same transaction that closes it,
   `ObjectsService` (`completeUpload`/`simpleUpload`) asks
   `ObjectProcessingService.appliesTo(object)`.
2. **No processor applies**: the row is marked `ready` right there — no job.
3. **A processor applies**: the row is marked `processing` and a
   `storage.object.process` job is enqueued in that same transaction
   (`enqueueWithin`), deduplicated per object.
4. **The job runs**: `StorageObjectProcessHandler.process` resolves the object
   and calls `ObjectProcessingService.run(object)` on a worker slot.
5. **Processor Selection**: `canProcess()` called on every processor in the registry.
6. **Priority Sorting**: applicable processors sorted by priority (lower first).
7. **Sequential Execution**: each processor runs in order.
8. **Metadata Aggregation**: results merged into object metadata.
9. **Status Update**: object marked as `ready` (or `failed` if any processor
   reported an error or threw).
10. **Give-up**: if the job exhausts its attempts, times out, or is reaped
    after a dead executor, a `job.settled` listener marks a still-`processing`
    object `failed` so it never stays `processing` forever.

The queue is **at-least-once**: a retry after a transient failure, or a
reaper requeue after a dead executor, can call a processor again for the same
object. Every processor MUST be idempotent — safe to run twice on the same
object without corrupting its metadata or duplicating a side effect (write a
thumbnail to a stable key and overwrite it, rather than appending a new one
each run).

## Metadata Storage

Each processor's results are stored in the object's metadata field:

```json
{
  "metadata": {
    "_processing": {
      "image-metadata": {
        "width": 1920,
        "height": 1080,
        "format": "jpeg"
      },
      "thumbnail-generator": {
        "thumbnailKey": "thumbnails/abc123.jpg"
      }
    },
    "_processedAt": "2025-01-24T10:30:00.000Z"
  }
}
```

## Error Handling

- Individual processor failures don't stop other processors
- Errors are logged and stored in metadata:
  ```json
  {
    "_processing": {
      "virus-scanner_error": "Scan timeout"
    },
    "_processingFailed": true
  }
  ```
- Object status set to `failed` if any processor fails

## Best Practices

1. **Idempotent Processing**: Ensure processors can be safely re-run
2. **Stream Handling**: Always destroy streams to prevent leaks
3. **Error Handling**: Catch all errors and return proper results
4. **Logging**: Use structured logging with object IDs
5. **Performance**: Keep processing fast; consider queues for heavy work
6. **Priority Order**: Set appropriate priority for dependencies

## Example Processors

See `example-metadata.processor.ts` for a basic implementation, and `example-metadata.processor.spec.ts` for it registered and run through the registry.

Common processor types:
- **Metadata Extraction**: Extract file properties (dimensions, duration, etc.)
- **Preview Generation**: Create thumbnails, previews, or transcoded versions
- **Content Analysis**: OCR, image recognition, content classification
- **Security Scanning**: Virus scanning, content policy validation
- **Indexing**: Extract searchable text, tags, or embeddings
