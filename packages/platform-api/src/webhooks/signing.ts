// =============================================================================
// Signing (issue #1046)
// =============================================================================
//
// Standard Webhooks, scheme v1, through the contract's `signWebhookPayload`
// (the same helper a receiver verifies with). The slice never invents a second
// implementation: what is signed here is what `verifyWebhookSignature` checks.
// During a rotation overlap the header carries two space-separated signatures,
// the current secret's first.
// =============================================================================

import { randomBytes } from 'node:crypto';

import { WEBHOOK_HEADERS, WEBHOOK_SECRET_PREFIX, signWebhookPayload } from '@marinoscar/platform-contract/webhooks';

/**
 * A fresh signing secret: `whsec_` and 32 random bytes in base64.
 *
 * @returns the secret. Shown once to its owner; stored only in the credentials store.
 *
 * @stability experimental
 */
export function generateWebhookSecret(): string {
  return `${WEBHOOK_SECRET_PREFIX}${randomBytes(32).toString('base64')}`;
}

/** What {@link signedHeaders} takes. @stability experimental */
export interface SignedHeadersInput {
  /** The `webhook-id`: the event id, identical across retries. */
  readonly id: string;
  /** Unix seconds at signing time. */
  readonly timestamp: number;
  /** The exact body. */
  readonly body: string;
  /** The current secret first, then the previous one while the overlap lasts. */
  readonly secrets: readonly string[];
  /** The `User-Agent`. */
  readonly userAgent: string;
}

/**
 * The request headers of one delivery attempt, including `webhook-signature`.
 *
 * @param input - see {@link SignedHeadersInput}.
 * @returns the headers.
 *
 * @stability experimental
 */
export async function signedHeaders(input: SignedHeadersInput): Promise<Record<string, string>> {
  const signatures: string[] = [];
  for (const secret of input.secrets) {
    signatures.push(await signWebhookPayload({ secret, id: input.id, timestamp: input.timestamp, body: input.body }));
  }
  return {
    'content-type': 'application/json',
    'user-agent': input.userAgent,
    [WEBHOOK_HEADERS.ID]: input.id,
    [WEBHOOK_HEADERS.TIMESTAMP]: String(input.timestamp),
    [WEBHOOK_HEADERS.SIGNATURE]: signatures.join(' '),
  };
}
