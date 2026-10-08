// =============================================================================
// Reference example: a custom AI_TARGET_RESOLVER (issue #739, rung 3)
// =============================================================================
//
// An app that decides WHICH MODEL serves each of its features (EvoPath's
// administrator assignments, #751) binds its own `AiTargetResolver` to the
// `AI_TARGET_RESOLVER` token in a `@Global()` module it passes to
// `AiModule.forRoot({ imports })`:
//
//   @Global()
//   @Module({
//     providers: [{ provide: AI_TARGET_RESOLVER, useClass: FeatureMapTargetResolver }],
//     exports: [AI_TARGET_RESOLVER],
//   })
//   export class AiAssignmentsModule {}
//
// The reference app binds it in a TEST MODULE ONLY
// (`test/examples/ai/example-summary.spec.ts`): its own behaviour stays the
// default resolver's.
// =============================================================================

import type { AiTarget, AiTargetContext, AiTargetResolver } from '@marinoscar/platform-api/ai';

/**
 * Feature id -> target. A call for a mapped feature that names no model gets
 * the mapped one; a call that names a model keeps it; anything else is "no
 * model" (`null`), which the service answers with AI_INVALID_REQUEST.
 */
export class FeatureMapTargetResolver implements AiTargetResolver {
  constructor(private readonly map: Readonly<Record<string, AiTarget>>) {}

  async resolve(ctx: AiTargetContext): Promise<AiTarget | null> {
    if (ctx.requested.model) {
      return { provider: ctx.requested.provider ?? this.map[ctx.feature ?? '']?.provider ?? 'openai', model: ctx.requested.model };
    }

    return (ctx.feature && this.map[ctx.feature]) || null;
  }
}
