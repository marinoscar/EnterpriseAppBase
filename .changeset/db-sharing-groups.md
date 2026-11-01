---
"@marinoscar/platform-db": minor
---

Add the `sharing` fragment and platform migration `0026_add_groups` (#728): the `GroupRole` enum and the `Group` (`// @extensible`), `GroupMember` and `GroupInvite` models (tables `groups`, `group_members`, `group_invites`), each with a NOT NULL `org_id`, `ENABLE` and `FORCE ROW LEVEL SECURITY` and a `<table>_org_isolation` policy. Members and invites reach their group through the composite key `(group_id, org_id)` -> `groups (id, org_id)`, so a row can never name another organization's group. The raw-SQL partial unique index `group_invites_pending_uniq_idx` allows one pending invite per group and address; `RAW_SQL_INDEXES` and `RLS_POLICIES` list the new index and the three policies.
