---
"@marinoscar/platform-api": minor
"@marinoscar/platform-web": minor
"@marinoscar/platform-contract": minor
---

Add the credentials slice (#735). platform-api: the `./credentials` subpath with `CredentialsModule`/`CredentialsService` (the deployment store), `UserCredentialsModule`/`UserCredentialsService` (a user's own keys) and the new `OrgCredentialsModule`/`OrgCredentialsService` (an organization's keys in `org_credentials`, under row-level security, encrypted under `org:<orgId>:<purpose>`), `UserCredentialResolver.resolve(userId, purpose, name?, { orgId })` (user, then the purpose's `fallback` of org and system, then none), the purpose registries `registerCredentialPurpose` and `registerUserCredentialPurpose` (writes to an undeclared purpose throw), `CREDENTIALS_MODEL_OWNERSHIP`/`CREDENTIALS_USER_OWNED_MODELS`, and `./credentials/testing` with the `credentials` conformance suite and `withCredentialPurposes`; core gains `orgCredentialPurpose` and `ORG_CREDENTIAL_DOMAIN_PREFIX`; telemetry exports `TELEMETRY_GREPTIME_CREDENTIAL_PURPOSE`. platform-web: `./credentials/headless` (`savedSecretHelperText`, `secretForSubmit`) and `./credentials/ui` (`SecretField`). platform-contract: `./credentials` (`credentialInfoSchema`, `userCredentialInfoSchema`, `orgCredentialInfoSchema`, `CREDENTIAL_TIERS`, `CREDENTIAL_SOURCES`, `SECRET_BEARING_KEYS`).
