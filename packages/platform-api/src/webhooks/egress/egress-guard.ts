// =============================================================================
// The webhook egress guard (issue #1046), now shared through core
// =============================================================================
//
// The guard moved to `core/egress/egress-guard.ts` (PP-15.5, #1183) so the
// identity slice's client metadata fetch can use it without depending on the
// webhooks slice (webhooks depends on identity). Nothing changed: this file
// re-exports it under the same names, so every webhooks import and the public
// `@marinoscar/platform-api/webhooks` surface are unchanged.
// =============================================================================

export { WebhookEgressError, hostForLog, parseWebhookUrl, resolveWebhookTarget, systemHostResolver } from '../../core/egress/egress-guard';
export type {
  HostResolver,
  ResolvedAddress,
  ResolvedWebhookTarget,
  WebhookEgressErrorCode,
  WebhookEgressPolicy,
} from '../../core/egress/egress-guard';
