---
'@marinoscar/platform-web': minor
---

Add the `webhooks` slice (issue #1046): `@marinoscar/platform-web/webhooks/headless` (`createWebhooksApi` for the `user`, `org` and `system` scopes, the endpoint, delivery and event catalog hooks, `useWebhookMutations`, the event picker's wildcard model and status helpers) and `@marinoscar/platform-web/webhooks/ui` (`WebhooksPage` with its create and edit dialog, grouped event picker, one-time secret dialog, deliveries table, delivery drawer with Redeliver and the "Verifying signatures" panel, plus the settings cards as data `webhooksUserSettingsSections` and `webhooksAdminSections`).
