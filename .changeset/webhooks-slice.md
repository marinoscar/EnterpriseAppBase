---
"@marinoscar/platform-api": minor
---

Add the `@marinoscar/platform-api/webhooks` slice and its `/testing` entry (issue #1046): signed outbound webhooks for a member, an organization or the deployment (`/api/webhooks`, `/api/org/webhooks`, `/api/admin/webhooks`), an open event registry (`registerWebhookEvent`) with built-in node and job events, `WebhooksService.emit`, an SSRF-safe egress guard with a pinned address, signing secrets in the credentials store, the server-only `webhooks.deliver`, `webhooks.fanout` and `webhooks.deliveries_purge` jobs with retries and a circuit breaker, the `webhook` notification channel and `webhooks.endpoint_disabled` event, the `webhooks:*`, `org_webhooks:*` and `system_webhooks:*` permissions (added to `@marinoscar/platform-api/manifest`), the `webhooks` conformance suite and an in-memory test kit. Core gains `isBlockedAddress` (public-address classification). Needs platform migration `0039_add_webhooks`.
