---
"@marinoscar/platform-contract": minor
"@marinoscar/platform-api": minor
"@marinoscar/platform-web": minor
---

Add `@marinoscar/platform-contract/doctor`, the first contract slice (#701): the Doctor's report, row, status and query schemas, their types and the zod-free status constants. `platform-api`'s Doctor DTOs now wrap these schemas and `platform-web`'s Doctor takes its types from them; both re-export the old names (`DOCTOR_STATUS_ORDER` and `DoctorReportQuery` in `platform-web` are deprecated aliases). No wire or OpenAPI change. Sets the contract conventions (slice layout, zod-free constants, import rules, `schema` catalog kind).
