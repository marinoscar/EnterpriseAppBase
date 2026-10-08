import { Module } from '@nestjs/common';

import { AiConfigModule } from '../config/ai-config.module';
import { AiKeysModule } from '../keys/ai-keys.module';
import { AiFeaturesController } from './ai-features.controller';
import { AiFeaturesService } from './ai-features.service';

/**
 * `GET /api/ai/features` (#739). `AiConfigModule` is here for `AiEnabledGuard`.
 *
 * @stability experimental
 */
@Module({
  imports: [AiConfigModule, AiKeysModule],
  controllers: [AiFeaturesController],
  providers: [AiFeaturesService],
  exports: [AiFeaturesService],
})
export class AiFeaturesModule {}
