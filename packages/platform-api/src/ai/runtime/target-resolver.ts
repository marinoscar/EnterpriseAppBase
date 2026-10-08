// =============================================================================
// Which (provider, model) a call targets: the AI_TARGET_RESOLVER seam (#739)
// =============================================================================
//
// `AiService` asks the bound `AiTargetResolver` for the target of every call
// that goes through the chat target rules (responses, embeddings, images, and
// transcription, speech or realtime when the caller named a model). The
// DEFAULT is the base behaviour, extracted unchanged from the service:
//
//   a model named        -> that model, on the named provider, else the
//                           user's `ai.defaultModel` provider, else the sole
//                           registered provider (none: AI_INVALID_REQUEST
//                           "No provider selected.")
//   no model named       -> the user's `ai.defaultModel` (when the request
//                           names no other provider), else null: "no model"
//
// An app replaces it (rung 3) by binding `AI_TARGET_RESOLVER` in a global
// module it passes to `AiModule.forRoot({ imports })`: EvoPath's
// administrator assignments (feature -> model) are such a resolver.
// =============================================================================

import { Inject, Injectable, Optional } from '@nestjs/common';
import { userAiSettingsSchema } from '@marinoscar/platform-contract/ai';

import { PLATFORM_PRISMA } from '../../core/index';
import { AiError } from '../core/ai-error';
import { AiProviderRegistry } from '../core/provider-registry';
import type { AiPrisma } from '../data/ai-db';
import { AI_MODULE_OPTIONS, DEFAULT_AI_OPTIONS, type AiResolvedOptions } from '../ai.options';

/**
 * Injection token of the {@link AiTargetResolver} `AiService` uses. Optional:
 * without a binding the service uses {@link DefaultAiTargetResolver}.
 *
 * @example
 * ```ts
 * // a @Global() module passed to AiModule.forRoot({ imports }):
 * { provide: AI_TARGET_RESOLVER, useClass: AssignmentsTargetResolver }
 * ```
 *
 * @extensionPoint token
 * @stability experimental
 */
export const AI_TARGET_RESOLVER: unique symbol = Symbol.for('@marinoscar/platform/ai/TARGET_RESOLVER');

/**
 * What a target resolver is asked.
 *
 * @stability experimental
 */
export interface AiTargetContext {
  /** The caller. */
  readonly userId: string;
  /** The organization the call runs in, when already known. */
  readonly orgId?: string;
  /** The registered feature the call is made for (`registerAiFeature`), when the caller named one. */
  readonly feature?: string;
  /** What the request named; either may be absent. */
  readonly requested: { readonly provider?: string; readonly model?: string };
}

/**
 * A resolved target.
 *
 * @stability experimental
 */
export interface AiTarget {
  /** Provider id. */
  readonly provider: string;
  /** The provider's model id. */
  readonly model: string;
}

/**
 * Picks (provider, model) when the caller did not name one, or validates the
 * named one. The service still applies every gate afterwards (provider
 * enabled, model enabled, capabilities, key reach, the feature's `needs`).
 *
 * @stability experimental
 */
export interface AiTargetResolver {
  /**
   * The call's target, or `null` for "no model" (the service answers
   * `AI_INVALID_REQUEST` "No model selected."). May throw an `AiError` of its
   * own.
   *
   * @param ctx - the caller, organization, feature and what the request named.
   */
  resolve(ctx: AiTargetContext): Promise<AiTarget | null>;
}

/**
 * The base behaviour: the request's own model, else the user's
 * `ai.defaultModel` user setting, else the sole registered provider.
 *
 * @stability experimental
 */
@Injectable()
export class DefaultAiTargetResolver implements AiTargetResolver {
  constructor(
    @Inject(PLATFORM_PRISMA) private readonly prisma: AiPrisma,
    private readonly registry: AiProviderRegistry,
    @Optional() @Inject(AI_MODULE_OPTIONS) private readonly options: AiResolvedOptions = DEFAULT_AI_OPTIONS,
  ) {}

  /**
   * See the file header for the order.
   *
   * @param ctx - the caller and what the request named.
   */
  async resolve(ctx: AiTargetContext): Promise<AiTarget | null> {
    const requested = ctx.requested.model?.trim();

    if (requested) {
      const provider =
        ctx.requested.provider ?? (await this.defaultModel(ctx.userId))?.provider ?? this.soleProvider();

      if (!provider) {
        throw new AiError('AI_INVALID_REQUEST', 'No provider selected.', { details: { model: requested } });
      }

      return { provider, model: requested };
    }

    const fallback = await this.defaultModel(ctx.userId);

    if (!fallback || (ctx.requested.provider !== undefined && ctx.requested.provider !== fallback.provider)) {
      return null;
    }

    return { provider: fallback.provider, model: fallback.modelId };
  }

  /**
   * The user's `ai.defaultModel`, read RAW from `user_settings.value` — not
   * through `UserSettingsService.getSettings`, which creates a row when none
   * exists (see `NotificationsService.loadRecipient` for the full argument).
   */
  private async defaultModel(userId: string): Promise<{ provider: string; modelId: string } | null> {
    // `AiModule.forRoot({ perUserDefaultModel: false })` (#739): not offered.
    if (!this.options.perUserDefaultModel) return null;

    const row = await this.prisma.userSettings.findUnique({
      where: { userId },
      select: { value: true },
    });
    const value = row?.value as { ai?: unknown } | null | undefined;
    const parsed = userAiSettingsSchema.safeParse(value?.ai);

    return parsed.success ? parsed.data.defaultModel : null;
  }

  private soleProvider(): string | undefined {
    const ids = this.registry.ids();

    return ids.length === 1 ? ids[0] : undefined;
  }
}
