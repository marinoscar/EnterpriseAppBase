---
"@marinoscar/platform-contract": minor
---

Add the `@marinoscar/platform-contract/webhooks` subpath (issue #1046): the endpoint, delivery, event-catalog and envelope schemas of the webhooks slice, the scope and delivery-status lists, the `webhooks:*`, `org_webhooks:*` and `system_webhooks:*` permission strings, the Standard Webhooks header names, `WEBHOOK_API_VERSION`, `WEBHOOK_ERROR_CODES`, the event key pattern (exact keys, `group.*` and `*`), and `signWebhookPayload` / `verifyWebhookSignature` (HMAC-SHA256 through Web Crypto, `whsec_` secrets, rotation-aware, constant time). Additive.
