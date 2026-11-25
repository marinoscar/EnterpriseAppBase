---
"@marinoscar/platform-db": minor
---

Add the `webhooks` slice schema (#1046): `WebhookEndpoint` (`webhook_endpoints`) and `WebhookDelivery` (`webhook_deliveries`), with the `WebhookScope` and `WebhookDeliveryStatus` enums and back-relations on `User` and `Organization`. Both tables are org-owned with a nullable `org_id` (NULL only for a system-scope endpoint) under FORCEd `webhook_endpoints_org_isolation` and `webhook_deliveries_org_isolation` policies (listed in `RLS_POLICIES`). Endpoints cascade with their owning user and organization, deliveries with their endpoint. Migration `0039_add_webhooks`.
