---
"@marinoscar/platform-db": minor
---

Add `OrgCredential` (`org_credentials`) to the `credentials` fragment (#735): an organization's own encrypted credentials, addressed by `(org_id, purpose, name)`, cascading with the organization, the last editor kept as provenance (SetNull). Migration `0029_add_org_credentials` creates the table with the FORCEd `org_credentials_org_isolation` row-level-security policy (listed in `RLS_POLICIES`).
