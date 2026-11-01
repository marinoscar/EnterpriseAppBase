// The AI slice's resolved forRoot options, as a token (issue #739).

/**
 * Injection token of the resolved {@link AiResolvedOptions}, provided
 * globally by `AiModule.forRoot`. Optional everywhere: a unit test that
 * builds a service by hand gets the defaults.
 *
 * @stability experimental
 */
export const AI_MODULE_OPTIONS: unique symbol = Symbol.for('@marinoscar/platform/ai/MODULE_OPTIONS');

/**
 * The options every AI service reads at run time.
 *
 * @stability experimental
 */
export interface AiResolvedOptions {
  /**
   * Whether a user may pick their own default model (the `ai.defaultModel`
   * user setting). `false`: the default target resolver ignores it, and
   * `GET /api/ai/config` says so, so the web hides the picker.
   */
  readonly perUserDefaultModel: boolean;
}

/**
 * The defaults: every option as before #739.
 *
 * @stability experimental
 */
export const DEFAULT_AI_OPTIONS: AiResolvedOptions = Object.freeze({ perUserDefaultModel: true });
