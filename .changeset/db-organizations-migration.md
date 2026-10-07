---
"@marinoscar/platform-db": minor
---

Add `Organization`, `Membership` and `Invite` to the identity fragment (#721) and the nullable `org_id` columns on `refresh_tokens`, `personal_access_tokens` and `device_codes`, as platform migration `0023_add_organizations`. The migration backfills the default organization (slug `default`), one active membership per existing user and the default `org_id` on every existing credential row, and creates the raw-SQL partial unique index `organizations_default_uniq_idx` (exactly one default organization), now listed in `raw-sql-indexes.json`.
