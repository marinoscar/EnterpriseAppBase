---
"@marinoscar/platform-api": patch
"@marinoscar/platform-web": patch
---

`POST /api/admin/ai/models/refresh` now answers `409` with `details.reason` `AI_DISABLED` or `AI_PROVIDER_DISABLED` when AI, or the provider, is switched off, instead of queueing an `ai.catalog.refresh` job that silently skipped. New `AiCatalogService.disabledReason(providerId)` is the single policy read behind both the route and the sync.

In `@marinoscar/platform-web`, `useAiModels().refreshCatalog` no longer clears `refreshError` per call: it shows the server's own message for these refusals and collects (de-duplicated) the refusals of several providers, and `AiModelsPage` clears the error once before refreshing and shows the "Refresh queued" snackbar only when a job was queued.
