import { CanActivate, Inject, Injectable } from '@nestjs/common';

import { TELEMETRY_AI, type TelemetryAiPort } from '../ports';

// =============================================================================
// TelemetryAiEnabledGuard (issue #703)
// =============================================================================
//
// The assistant route's AI kill switch: 403 `AI_DISABLED` while the AI
// platform is off. It calls the `TELEMETRY_AI` port's `assertEnabled()`, which
// the app binds to `AiConfigService.assertEnabled()`, the very call the app's
// `AiEnabledGuard` makes, so the response is byte-identical.
// =============================================================================

/**
 * Refuses a request while the AI platform is switched off (403 `AI_DISABLED`,
 * the app's own error).
 *
 * @stability experimental
 */
@Injectable()
export class TelemetryAiEnabledGuard implements CanActivate {
  constructor(@Inject(TELEMETRY_AI) private readonly ai: TelemetryAiPort) {}

  /** Throws the app's "AI is off" error while AI is disabled; otherwise lets the request through. */
  async canActivate(): Promise<boolean> {
    await this.ai.assertEnabled();

    return true;
  }
}
