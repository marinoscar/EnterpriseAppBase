import { Module } from '@nestjs/common';

import { StorageProvidersModule } from '../providers/storage-providers.module';
import { ObjectProcessingService } from './object-processing.service';
import { ObjectProcessorRegistry } from './object-processor.registry';

/**
 * The post-upload processing chain: the processor registry and its runner.
 * Import it from the module that provides an app's processor, so the
 * processor can inject {@link ObjectProcessorRegistry}. A static module: every
 * importer shares one registry.
 *
 * @stability experimental
 */
@Module({
  imports: [StorageProvidersModule],
  providers: [ObjectProcessorRegistry, ObjectProcessingService],
  exports: [ObjectProcessorRegistry, ObjectProcessingService],
})
export class ObjectProcessingModule {}
