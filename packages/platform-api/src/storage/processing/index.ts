/**
 * Storage Processing Barrel Export
 * Centralizes imports for processing pipeline components
 */

export { ObjectProcessingService } from './object-processing.service';
export { ObjectProcessingModule } from './object-processing.module';
export type { ObjectProcessor, ObjectProcessorResult } from './object-processor.interface';
export { ObjectProcessorRegistry } from './object-processor.registry';
export type { ObjectProcessingOutcome } from './object-processing.service';
export { buildProcessedMetadata } from './processing-metadata';
