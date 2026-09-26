import { Module } from '@nestjs/common';

import { AiConfigModule } from '../config/ai-config.module';
import { AiCoreModule } from '../core/ai-core.module';
import { AiKeyResolver } from './ai-key-resolver.service';
import { UserAiKeysController } from './user-ai-keys.controller';
import { UserAiKeysService } from './user-ai-keys.service';

// =============================================================================
// AiKeysModule (issue #431, epic #419)
// =============================================================================
//
// Each user's own (BYOK) provider keys, the key-resolution rule, and the
// usable-models answer. `UserAiKeysService` is deliberately NOT exported: its
// `getDecrypted` is plaintext, and the only thing outside this module that may
// obtain a user's key is `AiKeyResolver`, which applies the policy rule.
// =============================================================================

@Module({
  imports: [AiCoreModule, AiConfigModule],
  controllers: [UserAiKeysController],
  providers: [UserAiKeysService, AiKeyResolver],
  exports: [AiKeyResolver],
})
export class AiKeysModule {}
