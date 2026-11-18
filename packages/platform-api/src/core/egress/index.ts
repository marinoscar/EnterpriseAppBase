// The outbound egress guard and the pinned GET transport (issue #1046, PP-15.5).
// Explicit named exports only.

export { WebhookEgressError, hostForLog, parseWebhookUrl, resolveWebhookTarget, systemHostResolver } from './egress-guard';
export type { HostResolver, ResolvedAddress, ResolvedWebhookTarget, WebhookEgressErrorCode, WebhookEgressPolicy } from './egress-guard';
export { PinnedGetError, nodePinnedGetTransport } from './pinned-get';
export type { PinnedGetRequest, PinnedGetResponse, PinnedGetTransport } from './pinned-get';
