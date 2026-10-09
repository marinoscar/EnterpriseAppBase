---
"@marinoscar/platform-api": patch
---

`POST /api/admin/ai/models/refresh` now answers `409` with `details.reason` `AI_DISABLED` or `AI_PROVIDER_DISABLED` when AI, or the provider, is switched off, instead of queueing an `ai.catalog.refresh` job that silently skipped. New `AiCatalogService.disabledReason(providerId)` is the single policy read behind both the route and the sync.
