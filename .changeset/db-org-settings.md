---
"@marinoscar/platform-db": minor
---

Add `OrgSettings` to the `settings` fragment and migration `0028_add_org_settings` (#733): one row per organization holding its settings overrides, with its own version, FORCEd row-level security and the `org_settings_org_isolation` policy (listed in `RLS_POLICIES`).
