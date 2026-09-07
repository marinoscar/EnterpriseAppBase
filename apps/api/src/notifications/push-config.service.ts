import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { PrismaService } from '../prisma/prisma.service';
import { CredentialsService } from '../credentials/credentials.service';

// =============================================================================
// PushConfigService — runtime-configurable Web Push VAPID keys (issue #355)
// =============================================================================
//
// Scaffold only in this commit: the constant this configuration is stored
// under, and the service's dependencies. `describeForAdmin`/`generate`/
// `update`/`rotate`/`remove`/`resolveActiveVapidConfig` land in the commits
// that follow, one checkpoint at a time — see `email-settings.service.ts`,
// which this class mirrors throughout.
// =============================================================================

/** The `system_settings.key` this configuration is stored under. */
export const PUSH_CONFIG_KEY = 'webPush';

@Injectable()
export class PushConfigService {
  private readonly logger = new Logger(PushConfigService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    // The VAPID private key's only home. See push-vapid-credential.constants.ts.
    private readonly credentials: CredentialsService,
  ) {}
}
