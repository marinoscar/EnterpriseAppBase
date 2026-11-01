---
"@marinoscar/platform-web": minor
---

Export the AI slice's prop-driven presentational cards from `@marinoscar/platform-web/ai/ui` so other hosts (such as a desktop app) reuse them instead of copying them (#998): `UserAiKeyCard`, `KeylessProviderCard` with `KEYLESS_PROVIDER_TEXT`, `DefaultAiModelPicker`, and the `aiErrorText` and `aiCodeText` helpers, with their prop types. Adds `AccountSignInProviderCard`, a new presentational card for providers that sign in with an account rather than an API key (enable switch, blocking consent dialog, sign in and out, status, model picker, capability list, error with retry), driven entirely by props with no network or API hooks. `UserAiKeysPage` is unchanged.
