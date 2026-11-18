---
"@marinoscar/platform-api": minor
"@marinoscar/platform-web": minor
---

Fix the admin AI page failing to save once an app registers an AI adapter under a new provider id (#921). `GET /api/admin/ai/config` marks a provider that has no settings slot `configurable: false` (a new optional field of the admin provider shape, absent otherwise); `PUT /api/admin/ai/config` ignores such an entry when it is submitted as listed (disabled, no settings) and still answers `400 AI_UNKNOWN_PROVIDER` for any other payload for it and for an id the registry does not know. `AiConfigPage` shows these providers as "Registered, not configurable yet" and does not submit them. The page is unchanged when every provider has a slot.
