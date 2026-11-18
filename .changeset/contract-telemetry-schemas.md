---
"@marinoscar/platform-contract": minor
---

Add `@marinoscar/platform-contract/telemetry` (#702): the telemetry wire shapes (config, status, explorer, connection, stack, dashboard, assistant) and the `telemetry` settings namespace as zod schemas with their inferred types, plus the zod-free limits and enums they are built from, the `/metrics` schema builders for a server with its own metric-group registry, and the settings and connection no-secret proofs. Moved from the reference app's API DTOs and web mirrors without changing a field, a limit or a rule; the generated OpenAPI document is byte-identical.
