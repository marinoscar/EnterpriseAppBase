import { Injectable, Logger } from '@nestjs/common';

import type { ObjectProcessor } from './object-processor.interface';

// =============================================================================
// ObjectProcessorRegistry — where post-upload processors register (issue #736)
// =============================================================================
//
// Replaces the optional `OBJECT_PROCESSOR` injection (#520), which took one
// provider or an array under one token: an app could only add a processor by
// editing the module that provided the token, and `example-metadata.processor.ts`
// was never wired at all. Processors now self-register from their own
// `onModuleInit`, exactly as job handlers do with `JobHandlerRegistry` and
// Doctor checks with `DoctorCheckRegistry`.
//
// ⚠ REGISTRATION IS AN `onModuleInit` CONCERN, and reading it happens later:
// `ObjectProcessingService.appliesTo` is asked when an upload completes and
// `run` when a `storage.object.process` job runs, both long after every
// module initialised. Nothing reads the registry at construction time.
//
// Priority order and the `canProcess` contract are unchanged: lower `priority`
// runs first; `canProcess` is a synchronous, I/O-free predicate over the row.
// =============================================================================

/**
 * The post-upload processors of this app. Inject it and call
 * {@link ObjectProcessorRegistry.register} from your processor's
 * `onModuleInit`; `ObjectProcessingService` reads it when an upload completes
 * (does any processor want this object?) and when the
 * `storage.object.process` job runs.
 *
 * Provided and exported by `ObjectProcessingModule` (which `StorageModule`
 * imports); a processor's module imports `ObjectProcessingModule`.
 *
 * @example
 * ```ts
 * @Injectable()
 * export class ExampleMetadataProcessor implements ObjectProcessor, OnModuleInit {
 *   constructor(private readonly registry: ObjectProcessorRegistry) {}
 *   onModuleInit() { this.registry.register(this); }
 *   // name, priority, canProcess, process ...
 * }
 * ```
 *
 * @extensionPoint registry
 * @stability experimental
 */
@Injectable()
export class ObjectProcessorRegistry {
  private readonly logger = new Logger(ObjectProcessorRegistry.name);
  private readonly processors = new Map<string, ObjectProcessor>();

  /**
   * Registers a processor. A second processor with the same `name` replaces
   * the first, with a warning (the last registration wins, as with job
   * handlers).
   *
   * @param processor - the processor; its `name` must be non-empty.
   * @throws Error when `processor.name` is empty or `priority` is not a finite number.
   */
  register(processor: ObjectProcessor): void {
    if (typeof processor.name !== 'string' || processor.name.trim() === '') {
      throw new Error('ObjectProcessorRegistry.register(): a processor needs a non-empty name');
    }
    if (typeof processor.priority !== 'number' || !Number.isFinite(processor.priority)) {
      throw new Error(`ObjectProcessorRegistry.register(): processor "${processor.name}" needs a finite priority`);
    }

    const existing = this.processors.get(processor.name);
    if (existing && existing !== processor) {
      this.logger.warn(
        `Duplicate object processor "${processor.name}": ${existing.constructor.name} is being replaced by ` +
          `${processor.constructor.name}. The last registration wins.`,
      );
    }
    this.processors.set(processor.name, processor);
  }

  /**
   * Every registered processor, lowest `priority` first (ties: registration order).
   *
   * @returns a fresh array.
   */
  list(): ObjectProcessor[] {
    return [...this.processors.values()].sort((a, b) => a.priority - b.priority);
  }

  /**
   * The registered names, in priority order.
   *
   * @returns the names.
   */
  names(): string[] {
    return this.list().map((processor) => processor.name);
  }
}
