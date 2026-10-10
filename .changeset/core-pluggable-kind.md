---
"@marinoscar/platform-api": minor
"@marinoscar/platform-contract": minor
---

Add the pluggable-kind primitive (PP-14.5, #923). `@marinoscar/platform-api/core` gains `definePluggableKind` (one registry of implementations per kind, each with its own zod settings schema, defaults, declared secrets and `build`; settings stored as a record keyed by implementation id with `parseSettings`, `mergeSettingsRecord` that rejects unknown ids on write and `readSettingsRecord` that drops them with one warning on read; `describe` and `describeAll` returning the descriptor a generated form renders, with presence flags for secrets), `PluggableUnknownError`, `PluggableSettingsError` and `describeConfigFields` (the organization settings field description, generalised, adding `label` and `help`). The new `@marinoscar/platform-api/core/testing` entry exports `describePluggableKindConformance`. `@marinoscar/platform-contract/settings` gains `configFieldSchema` (with a write-only `secret` kind), `pluggableDescriptorSchema`, `CONFIG_FIELD_KINDS` and `PLUGGABLE_ID_PATTERN`. `orgSettingsFieldSchema` and the organization settings response are unchanged.
