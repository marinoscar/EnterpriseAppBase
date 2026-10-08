import { Inject, Injectable, Module, type OnModuleInit } from '@nestjs/common';

import { AI_OBJECT_STORE, type AiObjectStore } from '../ports';
import { useStorageFailureClassifier } from './ai-storage-errors';

import { AiOutputWriter } from './ai-output-writer';
import { AiStorageInputResolver } from './ai-storage-input.resolver';

// =============================================================================
// AiStorageModule (issue #437, epic #420) — storage objects in and out of AI
// =============================================================================
//
// The two reusable pieces every media story shares (images #437, audio
// #438/#439, file inputs #441, hosted image generation #442):
//
//   AiStorageInputResolver   a storage object id -> an ownership-checked input
//   AiOutputWriter           produced bytes -> storage objects the user owns
//
// Both reach the object store through the `AI_OBJECT_STORE` host port (#739),
// bound by the app (the reference app: over its `STORAGE_PROVIDER` and
// `StorageConfigService`), so the AI slice depends on no storage internals.
// =============================================================================

/** Binds the app's recogniser of its "storage not configured" error. */
@Injectable()
export class AiStorageFailureClassifierBinding implements OnModuleInit {
  constructor(@Inject(AI_OBJECT_STORE) private readonly store: AiObjectStore) {}

  onModuleInit(): void {
    useStorageFailureClassifier(this.store);
  }
}

@Module({
  providers: [AiStorageInputResolver, AiOutputWriter, AiStorageFailureClassifierBinding],
  exports: [AiStorageInputResolver, AiOutputWriter],
})
export class AiStorageModule {}
