---
"@marinoscar/platform-contract": minor
"@marinoscar/platform-api": patch
"@marinoscar/platform-web": minor
---

Add the worker-node admin response schemas to `@marinoscar/platform-contract/nodes` (`adminNodeSchema`, `adminNodeCredentialSchema`, `nodeCredentialListItemSchema`, `nodeCredentialCreatedSchema`, `NODE_STATUSES`, `NODE_HEALTHS`) that the API's Swagger classes now implement (#881), and add `@marinoscar/platform-web/nodes` (`/nodes/headless`, `/nodes/ui`): the fleet and credential client, hooks, adapters and the Worker Nodes page, which `@marinoscar/platform-web/jobs` re-exports for compatibility.
