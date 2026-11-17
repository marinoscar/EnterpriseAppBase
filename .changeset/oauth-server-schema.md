---
"@marinoscar/platform-db": minor
"@marinoscar/platform-api": minor
---

Add the OAuth server's database schema (#1180, PP-15.2). `@marinoscar/platform-db` adds the `oauth.prisma` fragment and migration `0043_add_oauth_server` (`oauth_clients`, `oauth_authorization_requests`, `oauth_grants`, `oauth_authorization_codes`, `oauth_tokens` and the raw-SQL partial unique index `oauth_grants_active_uniq_idx`, at most one active grant per user, client and resource). The tables are user-owned and carry no row-level security. `@marinoscar/platform-api` classifies the five models in the manifest ownership and user-owned inventories (a grant is deleted with its user and exported presentation-safe; a client is kept) and adds their user-data purge hints. No route or service reads the tables yet.
