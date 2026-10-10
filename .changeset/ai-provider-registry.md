---
"@marinoscar/platform-api": minor
"@marinoscar/platform-contract": minor
---

Let an app or package add an AI provider (PP-14.6, #924): `registerAiProvider(AiProviderDefinition)` of `@marinoscar/platform-api/ai`, backed by the `ai-provider` pluggable kind. A definition carries the provider's id, label, Nest module, zod `settingsSchema` and `defaults` for its non-secret settings, `requiresKey`, `requiresBaseUrl`, `help` and `sdkPackages`; the five built-ins register through the same function. `AiModule.forRoot({ providers })` takes any registered id (default: every registered definition) and imports each definition's `module`; the closed `AiProviderModuleId` union (now `string`) and `PROVIDER_MODULES` are gone.

`ai.providers` is a record keyed by provider id (`aiProviderIdSchema`, `aiProviderSlotSchema`; `BUILTIN_AI_PROVIDER_IDS`, with `AI_PROVIDER_IDS` kept as a deprecated alias). The namespace reads, merges and validates each slot with its provider's `settingsSchema`: an unregistered id is `400 AI_UNKNOWN_PROVIDER` on write and dropped with one warning on read, so removing a provider never bricks the row. The stored shape of the five built-ins is unchanged. `AI_PROVIDER_SETTINGS_FIELDS` and `PROVIDERS_REQUIRING_BASE_URL` are replaced by the definition; `providerRequiresKey(slot, providerId?)` takes the provider id.

`GET /api/admin/ai/config` gains `descriptors` (one `PluggableDescriptor` per registered provider) and, per provider, `settings`, `requiresBaseUrl` and `help`; `settingsFields` is now `string[]`. `createAiRuntimeHarness` takes `extraProviders`, `extraAdapters` and `extraProviderSettings`; `ai-no-sdk-leak` takes `providerDirs` and bans the registered definitions' `sdkPackages` outside them; the provider conformance kit checks the provider id pattern (no underscore). `describeConfigField` unwraps `default` and `prefault`.
