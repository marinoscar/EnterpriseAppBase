---
"@marinoscar/platform-web": minor
---

Move the AI web pages into `@marinoscar/platform-web/ai`: the admin AI, AI Models and AI Usage pages, the user AI Keys page and the Playground (`AiConfigPage`, `AiModelsPage`, `AiUsagePage`, `UserAiKeysPage`, `AiPlaygroundPage`, each also a subpath such as `/ai/ui/models-page`), the hooks behind them (`useAiConfig`, `AiConfigProvider`, `useAiAdminConfig`, `useAiModels`, `useAiUsage`, `useUserAiKeys`, `useUsableAiModels`, `useAiChat`, `useAiRun`, `useAiRealtimeSession`, `useMicrophonePermission`, `useAiUserSettings`) and the AI calls over the host transport (`createAiResponse`, `streamAiResponse`, ... each taking the `PlatformApiClient` first), with `AiWebAdaptersProvider` slots for the app's spinner and table. `PlatformApiClient` gains an optional `postFormData` (uploads) and `PlatformRequestOptions.jsonBody` (a DELETE with a typed confirmation); the storage and settings slices gain a sibling entry for the AI slice.
