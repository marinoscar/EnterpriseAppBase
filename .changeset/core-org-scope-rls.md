---
"@marinoscar/platform-api": minor
---

Add organisation scoping and row-level security to the core data-access slice (#725, ADR 0002 D5): `forOrg`, `forScope`, `orgScopeExtension` and `runInOrg`/`runInScope` set the transaction-local `app.org_id` and `app.user_id` before every operation; `forSystem`, `systemScopeExtension` and `runAsSystem` do the same for the bypass flag on a separate system client, with a closed list of `SystemAccessReason`s recorded on the active span. A scoped client refuses to run inside an interactive transaction (its operations would escape it), and `runInOrg` reuses an outer transaction when nested in the same scope. Also adds the model ownership registry (`modelOwnershipRegistry`, `registerModelOwnership`, `modelsOfKind`, `orgFieldOf`, `orgColumnOf`) that classifies every model as `org`, `org-optional`, `user` or `system`.
