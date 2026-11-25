// =============================================================================
// Reference example: a feature service that uses AI (issue #739)
// =============================================================================
//
// The recipe of `@marinoscar/platform-api/ai`'s README, at its smallest: a
// feature injects `AiService` and calls `forUser(userId, { feature })`. It
// never imports a provider SDK and never names a key: the gate pipeline (kill
// switch, the organization's switches, provider and model, capabilities, the
// feature's `needs`, key resolution, limits) is the platform's.
// =============================================================================

import { Injectable } from '@nestjs/common';
import { AiService } from '@marinoscar/platform-api/ai';

import { EXAMPLE_SUMMARY_FEATURE_ID } from './example-summary.feature';

@Injectable()
export class ExampleSummaryService {
  constructor(private readonly ai: AiService) {}

  /**
   * One short summary of `text`, for `userId`, in `orgId`.
   *
   * @param userId - the caller (their key, or their organization's, pays).
   * @param text - what to summarize.
   * @param opts - the organization (the principal's active one) and, optionally, a model.
   */
  async summarize(userId: string, text: string, opts: { orgId?: string; model?: string } = {}): Promise<string> {
    const response = await this.ai
      .forUser(userId, { feature: EXAMPLE_SUMMARY_FEATURE_ID, ...(opts.orgId ? { orgId: opts.orgId } : {}) })
      .respond({
        ...(opts.model ? { model: opts.model } : {}),
        instructions: 'Summarize the text in one short sentence.',
        input: text,
      });

    return response.outputText;
  }
}
