---
"@marinoscar/platform-cli": patch
---

`deploy install` now creates the app's own database user when the database login is a superuser, without the operator having to know `--provision-app-role` (#1166). At the terminal it asks "Create a dedicated ordinary database user for the app?" (Enter answers yes), then the user name (Enter keeps `<app>_app`) and its password (Enter generates a strong one; a typed one needs at least 12 characters). The TUI asks for both as optional fields (the password masked) and creates the user by default; "Create no role" and "Run as a superuser anyway" opt out. The answers file accepts `APP_DB_PASSWORD` beside `APP_DB_USER`; the password is never a flag.

Fixes (#1167): a resumed install that names any database-role choice now reruns the `environment`, `validate-environment` and `ensure-database` steps instead of silently skipping past the new choice. And with `--create-database`, a missing database is no longer listed as a blocker beside another failure; the error says it will be created.
