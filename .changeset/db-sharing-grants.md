---
"@marinoscar/platform-db": minor
---

Add the `Grant` model and platform migration `0027_add_grants` to the `sharing` fragment (#729): the `GrantGranteeKind` enum (`user`, `group`, `link`) and the `grants` table, a polymorphic `(resource_type, resource_id)` share with a role, an optional expiry and a soft revocation, the link columns #730 needs, a NOT NULL `org_id` under a forced `grants_org_isolation` policy, and a composite `(grantee_group_id, org_id)` key so a grant can never name another organization's group. The raw-SQL partial unique indexes `grants_active_user_uniq_idx` and `grants_active_group_uniq_idx` allow one active grant per resource and grantee, and `grants_grantee_consistency_check` keeps the grantee columns consistent with the kind; `RAW_SQL_INDEXES` and `RLS_POLICIES` list them.
