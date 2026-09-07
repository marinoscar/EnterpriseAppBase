import { Controller } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';

import { PushConfigService } from './push-config.service';

// =============================================================================
// PushConfigController (issue #355)
// =============================================================================
//
// The HTTP surface behind `/admin/settings/push`. Scaffold only in this
// commit — routes land in the commits that follow. See
// `../email/email-settings.controller.ts`, which this mirrors throughout, and
// this feature's plan for the full endpoint table (GET/PUT/generate/rotate,
// gated `push:read`/`push:write`).
// =============================================================================

@ApiTags('Push Configuration')
@Controller('admin/push-config')
export class PushConfigController {
  constructor(private readonly pushConfig: PushConfigService) {}
}
