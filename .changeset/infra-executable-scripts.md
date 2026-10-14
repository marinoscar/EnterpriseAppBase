---
"@marinoscar/platform-infra": minor
---

`platform-infra sync` ships executable scripts: a generated file marked `executable` keeps its `#!` shebang on line 1 (the header goes after it), is written with mode 0755 and listed under its fragment's `executable` key in `infra/platform-infra.lock.json`, and `sync --check` fails when it loses its executable bit. The compose fragment now ships `postgres-init/10-application-role.sh`, the init script `devdb.compose.yml` and `test.compose.yml` mount to create the ordinary (NOSUPERUSER NOBYPASSRLS) role the API runs as.
