---
"@marinoscar/platform-contract": minor
"@marinoscar/platform-api": minor
---

Add `@marinoscar/platform-contract/jobs` and `/nodes` (#734): the admin job routes' list query and row (with the new `orgId`), summary, insights and bulk-action schemas, and the worker-node control plane, data plane, per-job secret and node credential request schemas, moved from the API slices' `dto/` files with their comments, plus the zod-free status, reason, window and node bounds. `@marinoscar/platform-api/jobs` and `/nodes` wrap them with `createZodDto` and still re-export every schema under its old name.
