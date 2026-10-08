import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import type { Observable } from 'rxjs';

import { activeOrgIdOf, type RequestWithPrincipal } from '../../identity/index';
import { AiConfigService } from './ai-config.service';

// =============================================================================
// The organization's own kill switch on the consumer routes (issue #739)
// =============================================================================
//
// `AiEnabledGuard` answers the DEPLOYMENT's switch before authentication (so
// an unauthenticated caller already gets 403 AI_DISABLED). An organization can
// switch AI off for its members too (`ai.enabled: false` in its org layer),
// and which organization a caller acts in is only known AFTER `@Auth()` has
// run — so that half is this interceptor, which Nest runs after every guard.
// It answers 403 AI_DISABLED with `details.scope: 'org'`.
//
// Applied next to `@UseGuards(AiEnabledGuard)` on every consumer controller
// under /api/ai, never on /api/admin/ai (an administrator can always turn AI
// back on) nor on `GET /api/ai/config`.
// =============================================================================

/**
 * Refuses a consumer AI route with 403 `AI_DISABLED` (`details.scope: 'org'`)
 * when the caller's active organization switched AI off.
 *
 * @stability experimental
 */
@Injectable()
export class AiOrgEnabledInterceptor implements NestInterceptor {
  constructor(private readonly aiConfig: AiConfigService) {}

  /**
   * Checks the caller's organization, then continues.
   *
   * @param context - the request.
   * @param next - the handler.
   */
  async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<unknown>> {
    const orgId = activeOrgIdOf(context.switchToHttp().getRequest<RequestWithPrincipal>());

    await this.aiConfig.assertEnabled(orgId);

    return next.handle();
  }
}
