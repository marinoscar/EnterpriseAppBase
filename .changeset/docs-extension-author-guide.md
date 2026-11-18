---
"@marinoscar/platform-api": patch
"@marinoscar/platform-contract": patch
"@marinoscar/platform-web": patch
"@marinoscar/platform-db": patch
"@marinoscar/platform-cli": patch
"@marinoscar/platform-infra": patch
---

Documentation only: every slice README's Extension-point catalog links the new extension author guide (`docs/EXTENDING.md`); the email README no longer promises that a provider of `SmtpEmailProvider` in the app module replaces the transport (it does not reach the package's consumers; a transport registry is not supported yet); the AI READMEs say that a provider cannot be enabled from an app yet; the platform-db README documents `rlsPolicies` in `platform.lock` with the migration SQL for an app table protected by row-level security.
