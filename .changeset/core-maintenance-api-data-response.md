---
"@marinoscar/platform-api": minor
---

`@marinoscar/platform-api/core` gains `@AllowDuringMaintenance()` (with `ALLOW_DURING_MAINTENANCE_KEY`) and `@ApiDataResponse` (#727), moved from the reference app so packaged controllers can carry the maintenance exemption and document the `{ data: … }` envelope. Metadata keys and OpenAPI output are unchanged. Stability: `stable`.
